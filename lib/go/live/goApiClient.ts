import { Interaction, JourneyStatus, RecordResponse, StateResponse, SubmitInteractionResponse } from '../../dto/types';
import { marketConfig, resolveGoBaseUrl } from '../../config';
import { OnboardingException } from '../../errors/onboardingException';
import { GoClient, GoStartResult } from '../goClient';
import { buildSubmitRequest } from './buildSubmitRequest';
import { defaultInteractionMapper, isFailed } from './defaultInteractionMapper';
import {
  GoErrorEnvelope,
  GoInstanceRequest,
  GoInteractionFetchResponse,
  GoStartRequest,
  GoStartResponse,
  GoStateResponse,
} from './dto';
import { getAccessToken } from './goTokenService';

/**
 * Real GBG Go v2 integration. Every path here corresponds to a documented
 * endpoint: token mint, POST journey/start, POST journey/interaction/fetch,
 * POST journey/interaction/submit, POST journey/state/fetch.
 *
 * Structurally complete against the documented shapes, but not run against a
 * live tenant in building this port — there is no published journey or
 * credential set available here to test against. Treat first use against a
 * real environment as an integration test, not an assumption.
 */

/**
 * Last outstanding-elements list seen per Go instance, so a capture submit
 * can tell document from selfie without an extra fetch. Bounded (LRU-ish via
 * delete+reinsert) rather than unbounded — nothing here ever removes an
 * instance on session expiry or journey completion.
 */
const MAX_CACHED_INSTANCES = 10_000;
const lastOutstandingByInstance = new Map<string, string[]>();

function rememberOutstanding(instanceId: string, outstanding: string[] | undefined): void {
  if (!outstanding) return;
  lastOutstandingByInstance.delete(instanceId);
  lastOutstandingByInstance.set(instanceId, outstanding);
  if (lastOutstandingByInstance.size > MAX_CACHED_INSTANCES) {
    const oldest = lastOutstandingByInstance.keys().next().value;
    if (oldest !== undefined) lastOutstandingByInstance.delete(oldest);
  }
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${resolveGoBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function call<T>(request: () => Promise<Response>): Promise<T | undefined> {
  let response: Response;
  try {
    response = await request();
  } catch (e) {
    console.error('Unexpected error calling GBG Go', e);
    throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
  }

  if (response.ok) {
    const text = await response.text();
    return (text ? (JSON.parse(text) as T) : undefined);
  }

  let detail = '';
  try {
    const envelope = (await response.json()) as GoErrorEnvelope;
    detail = envelope.errors?.map((e) => e.problem).filter(Boolean).join('; ') ?? '';
  } catch {
    detail = await response.text().catch(() => '');
  }
  console.warn(`GBG Go call failed: ${response.status} ${detail}`);

  if (response.status === 404 || response.status === 410) {
    throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
  }
  if (response.status === 400 || response.status === 422) {
    throw OnboardingException.validationFailed('Some of the details you entered could not be verified.');
  }
  if (response.status === 429) {
    throw OnboardingException.rateLimited('Too many attempts. Wait a moment and try again.');
  }
  throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
}

function statusFrom(interaction: Interaction): JourneyStatus {
  if (interaction.kind === 'processing') return 'InProgress';
  if (interaction.kind === 'result') return interaction.decision !== undefined ? 'Completed' : 'PendingInput';
  return 'PendingInput';
}

async function fetchInteraction(instanceId: string): Promise<SubmitInteractionResponse> {
  const response = await call<GoInteractionFetchResponse>(() =>
    authedFetch('journey/interaction/fetch', { instanceId } satisfies GoInstanceRequest)
  );
  if (!response) {
    throw OnboardingException.upstreamUnavailable('Could not read your verification status. Try again shortly.');
  }
  rememberOutstanding(instanceId, response.outstanding);
  const interaction = defaultInteractionMapper.toInteraction(response);
  return { status: statusFrom(interaction), interaction };
}

async function fetchOutstanding(instanceId: string): Promise<string[]> {
  const response = await call<GoInteractionFetchResponse>(() =>
    authedFetch('journey/interaction/fetch', { instanceId } satisfies GoInstanceRequest)
  );
  return response?.outstanding ?? [];
}

/**
 * Rewrites the front end's capture submission into a field the submit
 * mapping recognises. The capture screen posts {attachmentRef: <base64>}
 * for both a document and a selfie, so the distinction has to come from the
 * journey's own state: whichever image element is still outstanding is the
 * one being answered. The front end always fetches the current interaction
 * to render the screen it's now submitting, so fetchInteraction has already
 * populated the cache for this instance — a live fetch is only the
 * fallback, for the unlikely case nothing has been cached yet.
 */
async function resolveAttachment(
  instanceId: string,
  data: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  const ref = data?.['attachmentRef'];
  if (ref === undefined) return data;

  let outstanding = lastOutstandingByInstance.get(instanceId);
  if (!outstanding) {
    outstanding = await fetchOutstanding(instanceId);
  }
  const document = outstanding.some((o) => o.startsWith('PrimaryDocument/'));

  const rewritten = { ...data };
  delete rewritten['attachmentRef'];
  rewritten[document ? 'documentImage' : 'selfieImage'] = ref;
  return rewritten;
}

async function fetchGoState(instanceId: string): Promise<GoStateResponse> {
  const response = await call<GoStateResponse>(() =>
    authedFetch('journey/state/fetch', { instanceId } satisfies GoInstanceRequest)
  );
  if (!response) {
    throw OnboardingException.upstreamUnavailable('Could not read your verification status. Try again shortly.');
  }
  return response;
}

export const goApiClient: GoClient = {
  async startJourney(resourceId, prefill, _scenarioHint): Promise<GoStartResult> {
    const request: GoStartRequest = {
      resourceId,
      context: { config: { delivery: 'api' }, subject: prefill ?? {} },
    };
    const started = await call<GoStartResponse>(() => authedFetch('journey/start', request));
    if (!started?.instanceId) {
      throw OnboardingException.upstreamUnavailable('Could not start your verification. Try again shortly.');
    }
    const first = await fetchInteraction(started.instanceId);
    return { instanceId: started.instanceId, status: first.status, interaction: first.interaction };
  },

  fetchInteraction,

  async submitInteraction(instanceId, interactionId, data): Promise<SubmitInteractionResponse> {
    const payload = await resolveAttachment(instanceId, data);
    await call(() =>
      authedFetch(
        'journey/interaction/submit',
        buildSubmitRequest(instanceId, interactionId, payload, marketConfig.app.consentUrl)
      )
    );
    // The submit response only acknowledges receipt; the next screen comes
    // from re-fetching the interaction, same as the mock's own response shape.
    return fetchInteraction(instanceId);
  },

  async fetchState(instanceId): Promise<StateResponse> {
    const response = await fetchGoState(instanceId);
    // A Failed journey is terminal. Reporting IN_PROGRESS would leave the
    // front end's processing screen polling an instance that will never
    // advance, so it reports Completed — the decision it carries is fail.
    const status: JourneyStatus =
      response.status?.toLowerCase() === 'completed' || isFailed(response.status) ? 'Completed' : 'InProgress';
    const asRecord = defaultInteractionMapper.toRecord(response);
    return { status, decision: asRecord.decision, moduleRuns: asRecord.moduleRuns };
  },

  async fetchRecord(instanceId): Promise<RecordResponse> {
    return defaultInteractionMapper.toRecord(await fetchGoState(instanceId));
  },
};
