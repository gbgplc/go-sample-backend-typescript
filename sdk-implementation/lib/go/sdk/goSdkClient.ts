import { Go } from '@gbg/go-core';
import {
  GoError,
  HTTPClientError,
  ResponseValidationError,
  SDKValidationError,
} from '@gbg/go-core/models/errors';
import type { StartJourneyRequest, SubmitInteractionSecurity } from '@gbg/go-core/models/operations';
import { Interaction, JourneyStatus, RecordResponse, StateResponse, SubmitInteractionResponse } from '../../dto/types';
import { marketConfig, sdkServerUrl } from '../../config';
import { OnboardingException } from '../../errors/onboardingException';
import { GoClient, GoStartResult } from '../goClient';
import { buildSdkSubmitRequest, START_SUBJECT_KEYS } from './buildSdkSubmitRequest';
import { getAccessToken, invalidate } from './goSdkAuthService';
import { GoInteractionView, GoStateView } from './goViews';
import { isFailed, defaultInteractionMapper as mapper } from './sdkInteractionMapper';
import { startedInstanceId, toInteractionView, toStateView } from './sdkResponses';

/**
 * Real GBG Go v2 integration built on `@gbg/go-core` — the SDK sibling of
 * api-implementation's `goApiClient`. Same caches, attachment routing,
 * mark-a-stage-complete-only-on-success rule and three-way terminal check in
 * `fetchState`; only the transport differs. What the SDK changes, and why
 * each workaround below exists, is in this module's README ("Known gaps").
 */

const TIMEOUT_MS = 15_000;

/**
 * One SDK client for the process. The global `customerAccess` is a token
 * provider the SDK resolves on every request, so a rotated token needs no
 * rebuild. It covers journeys.start and journeys.getState only:
 * interactions.fetch/submit ignore it and take their token per call (see
 * `interactionSecurity`). Retries are off — start and submit are POSTs and
 * must not be replayed.
 */
const globalForSdk = globalThis as unknown as { __goSdk?: Go };
const go: Go =
  globalForSdk.__goSdk ??
  new Go({
    serverURL: sdkServerUrl(),
    customerAccess: getAccessToken,
    timeoutMs: TIMEOUT_MS,
    retryConfig: { strategy: 'none' },
  });
globalForSdk.__goSdk = go;

/**
 * Fetch and submit carry their own security and never fall back to the
 * client's: with neither field set, the SDK sends no Authorization header at
 * all. `interactionAccess` takes the same bearer token as `customerAccess`
 * (confirmed live on the Java SDK, which has the same two schemes).
 */
function interactionSecurity(token: string): SubmitInteractionSecurity {
  return { interactionAccess: token };
}

// ---------------------------------------------------------------------------
// Per-instance caches — same purpose and bound as goApiClient's.
// ---------------------------------------------------------------------------

const MAX_CACHED_INSTANCES = 10_000;

function boundedCache<V>(key: string): Map<string, V> {
  const holder = globalThis as unknown as Record<string, Map<string, V> | undefined>;
  return (holder[key] ??= new Map<string, V>());
}

function remember<V>(cache: Map<string, V>, instanceId: string, value: V): void {
  cache.delete(instanceId);
  cache.set(instanceId, value);
  if (cache.size > MAX_CACHED_INSTANCES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

const lastOutstandingByInstance = boundedCache<string[]>('__sdkLastOutstandingByInstance');
const lastInstructionsByInstance = boundedCache<string[]>('__sdkLastInstructionsByInstance');
/** Stage names already submitted per instance — Go's `outstanding` never shrinks, so progress is tracked here. */
const completedStagesByInstance = boundedCache<Set<string>>('__sdkCompletedStagesByInstance');

function completedStages(instanceId: string): Set<string> {
  return new Set(completedStagesByInstance.get(instanceId) ?? []);
}

function recordStage(instanceId: string, stageName: string): void {
  const done = completedStagesByInstance.get(instanceId) ?? new Set<string>();
  done.add(stageName);
  remember(completedStagesByInstance, instanceId, done);
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Runs `request` with the current access token, retrying once with a freshly
 * minted one if Go answers 401/403 — a token Go stopped accepting before its
 * expiry would otherwise stay cached and fail every call until it lapsed.
 * Anything else, including a second rejection, propagates to `call`.
 */
export async function authorized<T>(request: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  try {
    return await request(token);
  } catch (e) {
    const status = e instanceof GoError ? e.statusCode : undefined;
    if (status !== 401 && status !== 403) throw e;
    console.warn(`GBG Go rejected the access token (${status}); minting a new one and retrying once`);
    invalidate(token);
  }
  return request(await getAccessToken());
}

/** Every `errors[].problem` in a Go error body, joined with "; " — empty if it isn't that shape. */
export function goProblems(body: string | undefined): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body) as { errors?: { problem?: unknown }[] };
    return (parsed.errors ?? [])
      .map((error) => (typeof error.problem === 'string' ? error.problem : ''))
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

/**
 * Submitted field → Go's message, for every `path: message` segment in
 * `problems` whose path this submit sent (live format:
 * `context.subject.identity.emails.0.email: Invalid email address`).
 */
export function rejectedFields(problems: string, fieldsByGoPath: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const segment of problems.split(/;\s*/)) {
    const colon = segment.indexOf(': ');
    if (colon <= 0) continue;
    const field = fieldsByGoPath[segment.slice(0, colon).trim()];
    if (field && !(field in fields)) fields[field] = segment.slice(colon + 2).trim();
  }
  return fields;
}

export function classifyStatus(status: number): OnboardingException {
  if (status === 404 || status === 410) {
    return OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
  }
  if (status === 400 || status === 422) {
    return OnboardingException.validationFailed('Some of the details you entered could not be verified.');
  }
  if (status === 429) {
    return OnboardingException.rateLimited('Too many attempts. Wait a moment and try again.');
  }
  return OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
}

/**
 * Translates whatever the SDK threw into the contract's error codes.
 *
 * Order matters: `ResponseValidationError` is a `GoError` (and, through a
 * loose `Symbol.hasInstance`, also passes `instanceof SDKValidationError`),
 * so it is checked first. It means the response did not match the SDK's
 * schema — on a 2XX that is a shape problem, not the customer's fault.
 */
export async function call<T>(request: () => Promise<T>, fieldsByGoPath: Record<string, string> = {}): Promise<T> {
  try {
    return await request();
  } catch (e) {
    if (e instanceof OnboardingException) throw e;
    if (e instanceof ResponseValidationError) {
      console.warn(`GBG Go response did not match the SDK's schema (${e.statusCode}): ${e.body}`);
      if (e.statusCode >= 400) throw classifyStatus(e.statusCode);
      throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
    }
    if (e instanceof GoError) {
      const problems = goProblems(e.body);
      console.warn(`GBG Go call failed: ${e.statusCode} ${problems || e.body}`);
      if ((e.statusCode === 400 || e.statusCode === 422) && Object.keys(fieldsByGoPath).length > 0) {
        const fields = rejectedFields(problems, fieldsByGoPath);
        if (Object.keys(fields).length > 0) {
          throw OnboardingException.validationFailed('Some of the details you entered could not be verified.', fields);
        }
      }
      throw classifyStatus(e.statusCode);
    }
    if (e instanceof SDKValidationError) {
      console.error('Request rejected by the SDK before sending', e.pretty());
    } else if (e instanceof HTTPClientError) {
      console.error(`Could not reach GBG Go: ${e.name}: ${e.message}`);
    } else {
      // Includes a raw SyntaxError the SDK lets escape on an empty or
      // malformed JSON body.
      console.error('Unexpected error calling GBG Go', e);
    }
    throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function statusFrom(interaction: Interaction): JourneyStatus {
  if (interaction.kind === 'processing') return 'InProgress';
  if (interaction.kind === 'result') return interaction.decision !== undefined ? 'Completed' : 'PendingInput';
  return 'PendingInput';
}

async function fetchView(instanceId: string): Promise<GoInteractionView> {
  const response = await call(() =>
    authorized((token) => go.interactions.fetch(interactionSecurity(token), { body: { instanceId } }))
  );
  return toInteractionView(response);
}

async function fetchInteraction(instanceId: string): Promise<SubmitInteractionResponse> {
  const view = await fetchView(instanceId);
  // Always overwritten, empty when Go omits the field: keeping the last
  // non-empty value let a stale Side2Required outlive the document screen.
  remember(lastOutstandingByInstance, instanceId, view.outstanding ?? []);
  remember(lastInstructionsByInstance, instanceId, view.instructions ?? []);
  const interaction = mapper.toInteraction(view, completedStages(instanceId));
  return { status: statusFrom(interaction), interaction };
}

/**
 * Rewrites the front end's capture submission ({attachmentRef}) into the
 * field the submit mapping recognises: document back when Go has asked for
 * side 2, otherwise document or selfie by the stage the customer is on.
 * Same rules as goApiClient's resolveAttachment.
 */
async function resolveAttachment(
  instanceId: string,
  data: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  const ref = data?.['attachmentRef'];
  if (ref === undefined) return data;

  if (!lastOutstandingByInstance.has(instanceId)) {
    await fetchInteraction(instanceId);
  }
  const outstanding = lastOutstandingByInstance.get(instanceId) ?? [];
  const instructions = lastInstructionsByInstance.get(instanceId) ?? [];

  if (instructions.some((i) => i.toLowerCase() === 'side2required') || outstanding.includes('PrimaryDocument/side2Image')) {
    const back = { ...data };
    delete back['attachmentRef'];
    back['documentBack'] = ref;
    return back;
  }

  const fromStage = mapper.currentCaptureIsDocument(outstanding, completedStages(instanceId));
  const document = fromStage ?? outstanding.some((o) => o.startsWith('PrimaryDocument/'));

  const rewritten = { ...data };
  delete rewritten['attachmentRef'];
  rewritten[document ? 'documentImage' : 'selfieImage'] = ref;
  return rewritten;
}

async function fetchGoState(instanceId: string): Promise<GoStateView> {
  const response = await call(() => authorized(() => go.journeys.getState({ body: { instanceId } })));
  const view = toStateView(response);
  if (!view) {
    console.warn(
      `Journey-state response for instance ${instanceId} arrived as the SDK's slim variant, ` +
        'which lacks the step detail the record needs',
      response
    );
    throw OnboardingException.upstreamUnavailable('Could not read your verification status. Try again shortly.');
  }
  return view;
}

/**
 * The start request, with the prefill as `context.subject` like
 * api-implementation. The SDK types the subject and strips keys it has no
 * field for, so those are logged here rather than vanishing silently.
 */
function startRequest(resourceId: string, prefill: Record<string, unknown> | undefined): StartJourneyRequest {
  const request: StartJourneyRequest = { resourceId, context: { config: { delivery: 'api' } } };
  if (prefill && Object.keys(prefill).length > 0) {
    const dropped = Object.keys(prefill).filter((key) => !START_SUBJECT_KEYS.includes(key));
    if (dropped.length > 0) {
      console.warn(`The SDK's start subject has no field for prefill keys ${dropped.join(', ')}; they are not sent`);
    }
    request.context.subject = prefill as StartJourneyRequest['context']['subject'];
  }
  return request;
}

/** True for the SDK rejecting our own request before sending it (not a response that failed validation). */
function isRequestValidationError(e: unknown): boolean {
  return e instanceof SDKValidationError && !(e instanceof ResponseValidationError);
}

async function start(request: StartJourneyRequest): Promise<string | undefined> {
  const started = await call(async () => {
    try {
      return await authorized(() => go.journeys.start(request));
    } catch (e) {
      // A prefill the SDK's typed subject rejects (wrong types, say) fails
      // validation before anything is sent. Start without it rather than
      // refusing the customer a journey.
      if (!isRequestValidationError(e) || request.context.subject === undefined) throw e;
      console.warn('The SDK rejected the journey prefill; starting without it', (e as SDKValidationError).pretty());
      delete request.context.subject;
      return authorized(() => go.journeys.start(request));
    }
  });
  return startedInstanceId(started);
}

export const goSdkClient: GoClient = {
  async startJourney(resourceId, prefill, _scenarioHint): Promise<GoStartResult> {
    const instanceId = await start(startRequest(resourceId, prefill));
    if (!instanceId) {
      throw OnboardingException.upstreamUnavailable('Could not start your verification. Try again shortly.');
    }
    const first = await fetchInteraction(instanceId);
    return { instanceId, status: first.status, interaction: first.interaction };
  },

  fetchInteraction,

  async submitInteraction(instanceId, interactionId, data): Promise<SubmitInteractionResponse> {
    const payload = await resolveAttachment(instanceId, data);
    // Read before the call so a Go rejection leaves progress untouched.
    const submittedStage = mapper.stageFor(Object.keys(payload ?? {}), completedStages(instanceId));
    const { request, fieldsByGoPath } = buildSdkSubmitRequest(
      instanceId,
      interactionId,
      payload,
      marketConfig.app.consentUrl,
      marketConfig.app.consentTerms
    );
    // The SDK only accepts {status: "success"}; any other status fails its
    // schema and surfaces through `call` as a ResponseValidationError, so a
    // rejected submit is never marked complete.
    await call(
      () => authorized((token) => go.interactions.submit(interactionSecurity(token), request)),
      fieldsByGoPath
    );
    if (submittedStage) recordStage(instanceId, submittedStage);
    return fetchInteraction(instanceId);
  },

  async fetchState(instanceId): Promise<StateResponse> {
    const view = await fetchGoState(instanceId);
    const asRecord = mapper.toRecord(view);
    // Same three-way terminal check as goApiClient.fetchState: Completed,
    // Failed/Error, or a real decision with every module settled (Northbank
    // settles on `refer` while its status stays InProgress).
    const carriesRealResult = view.result?.outcomeClassification !== undefined;
    const everyModuleSettled =
      asRecord.moduleRuns !== undefined &&
      asRecord.moduleRuns.length > 0 &&
      !asRecord.moduleRuns.some((run) => run.state === 'Running');
    const decided = carriesRealResult && everyModuleSettled;
    const status: JourneyStatus =
      view.status?.toLowerCase() === 'completed' || isFailed(view.status) || decided ? 'Completed' : 'InProgress';
    return { status, decision: asRecord.decision, moduleRuns: asRecord.moduleRuns };
  },

  async fetchRecord(instanceId): Promise<RecordResponse> {
    return mapper.toRecord(await fetchGoState(instanceId));
  },
};
