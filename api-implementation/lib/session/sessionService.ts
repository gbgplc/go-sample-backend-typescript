import { randomUUID } from 'node:crypto';
import {
  AppConfigResponse,
  Interaction,
  RecordResponse,
  StartSessionResponse,
  StateResponse,
  SubmitInteractionResponse,
} from '../dto/types';
import { marketConfig } from '../config';
import { OnboardingException } from '../errors/onboardingException';
import { getGoClient } from '../go/goClient';
import { Session } from './session';
import { sessionStore } from './sessionStore';
import { withSessionLock } from './sessionMutex';

export interface Started {
  body: StartSessionResponse;
  cookieToken: string;
}

/**
 * Orchestrates one onboarding session: mints it against Go, tracks the
 * session-to-instance mapping, enforces the cookie check and interaction
 * idempotency, and forwards everything else straight to GoClient.
 * Deliberately thin — the journey itself lives in Go.
 */

function authorize(sessionId: string, cookieToken: string | null | undefined): Session {
  const session = sessionStore.find(sessionId);
  if (!session) {
    throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
  }
  if (!cookieToken || cookieToken !== session.cookieToken) {
    throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
  }
  return session;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Rejects a submission that omits a field the current screen marks required.
 *
 * Go accepts such a submission: the journey advances, the domain element is
 * never populated, and the failure surfaces several screens later as "Required
 * domain element 'CurrentAddress' data is missing from context" — naming an
 * element the caller has already moved past, on a step they cannot return to.
 * A 422 here names the fields instead, while the caller is still on the screen
 * that collects them.
 *
 * The browser clients check this too, so in practice this catches the other
 * kind of caller: someone writing their own client against this API, who would
 * otherwise meet that 400 with nothing to act on.
 *
 * `required` is optional — the mock's fixtures leave it unset, and a live
 * journey's `collects` sets it explicitly. Only an explicit true blocks, so an
 * unknown requirement is never invented. Whitespace alone is not an answer.
 */
async function requireCollectedFields(
  goInstanceId: string,
  data: Record<string, unknown> | undefined
): Promise<void> {
  const goClient = await getGoClient();
  const current = (await goClient.fetchInteraction(goInstanceId)).interaction;
  if (!current?.collects) return;

  const submitted = data ?? {};
  const missing: Record<string, string> = {};
  for (const field of current.collects) {
    if (field.required === true && isBlank(submitted[field.name])) {
      missing[field.name] = 'This is required.';
    }
  }

  if (Object.keys(missing).length > 0) {
    throw OnboardingException.validationFailed('One or more required fields are missing.', missing);
  }
}

export const sessionService = {
  async startSession(
    prefill: Record<string, unknown> | undefined,
    scenarioHint: string | null
  ): Promise<Started> {
    const goClient = await getGoClient();
    const result = await goClient.startJourney(marketConfig.app.resourceId, prefill, scenarioHint);
    const sessionId = randomUUID();
    const cookieToken = randomUUID();
    const initialInteractionId = result.interaction?.interactionId ?? null;

    const session = new Session(sessionId, cookieToken, result.instanceId, initialInteractionId);
    sessionStore.save(session);

    return {
      body: { sessionId, status: result.status, interaction: result.interaction },
      cookieToken,
    };
  },

  async getInteraction(sessionId: string, cookieToken: string | null | undefined): Promise<Interaction> {
    const session = authorize(sessionId, cookieToken);
    // Locked the same as submitInteraction: a live-mode capture disambiguation
    // cache keyed off calls exactly like this one could otherwise interleave
    // with a concurrent submit and read a snapshot from the wrong moment.
    return withSessionLock(session.id, async () => {
      const goClient = await getGoClient();
      const response = await goClient.fetchInteraction(session.goInstanceId);
      return response.interaction;
    });
  },

  async submitInteraction(
    sessionId: string,
    cookieToken: string | null | undefined,
    interactionId: string,
    data: Record<string, unknown> | undefined
  ): Promise<SubmitInteractionResponse> {
    const session = authorize(sessionId, cookieToken);

    // Locked per-session so two near-simultaneous identical submits (a
    // double-tap, a client retry) can't both pass the retry check before
    // either records the advance.
    return withSessionLock(session.id, async () => {
      if (session.isRetryOf(interactionId, data)) {
        return session.cachedResponse()!;
      }
      if (session.currentInteractionId !== null && session.currentInteractionId !== interactionId) {
        throw OnboardingException.interactionStale('This step has moved on. Refetching the current one.');
      }

      const goClient = await getGoClient();
      await requireCollectedFields(session.goInstanceId, data);
      const response = await goClient.submitInteraction(session.goInstanceId, interactionId, data);
      session.recordAdvance(interactionId, data, response);
      return response;
    });
  },

  async getState(sessionId: string, cookieToken: string | null | undefined): Promise<StateResponse> {
    const session = authorize(sessionId, cookieToken);
    // Locked the same as getInteraction/submitInteraction: a status poll is
    // exactly the concurrent caller sessionMutex's own doc comment cites as
    // the reason this lock exists.
    return withSessionLock(session.id, async () => {
      const goClient = await getGoClient();
      return goClient.fetchState(session.goInstanceId);
    });
  },

  async getRecord(sessionId: string, cookieToken: string | null | undefined): Promise<RecordResponse> {
    const session = authorize(sessionId, cookieToken);
    const goClient = await getGoClient();
    return goClient.fetchRecord(session.goInstanceId);
  },

  /**
   * Returns the captured image as base64, which the front end then submits
   * verbatim as its attachmentRef. No server-side storage — matches the
   * Java backend's own placeholder status for capture generally.
   */
  async uploadAttachment(
    sessionId: string,
    cookieToken: string | null | undefined,
    content: Buffer
  ): Promise<{ attachmentRef: string }> {
    authorize(sessionId, cookieToken);
    if (!content || content.length === 0) {
      throw OnboardingException.validationFailed('That image could not be read. Try again.');
    }
    return { attachmentRef: content.toString('base64') };
  },

  getConfig(): AppConfigResponse {
    const { brand, mark, tagline, accent, accentSoft, helpLine, journeyName, resourceId } = marketConfig.app;
    return { brand, mark, tagline, accent, accentSoft, helpLine, journeyName, resourceId };
  },
};
