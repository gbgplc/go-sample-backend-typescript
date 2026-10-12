/** GBG Go v2 wire shapes — one file, mirrors Java's go/live/dto/*.java package. */

/** POST https://api.auth.gbgplc.com/as/token.oauth2 response (or the fabric-tenant Keycloak equivalent). */
export interface GoTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** POST {baseUrl}journey/start request body. */
export interface GoStartRequest {
  resourceId: string;
  context: {
    config: { delivery: string };
    subject: Record<string, unknown>;
  };
}

export interface GoStartResponse {
  instanceId?: string;
  status?: string;
  message?: string;
}

/** The {instanceId} body shared by /journey/interaction/fetch and /journey/state/fetch. */
export interface GoInstanceRequest {
  instanceId: string;
}

/** The `result` object shared by interaction/fetch and state/fetch responses. */
export interface GoResult {
  outcome?: string;
  status?: string;
  outcomeClassification?: string;
  errors?: Record<string, unknown>[];
  data?: Record<string, unknown>;
}

/**
 * One collectable domain element ref.
 *
 * `spec` is the field's own requirement, `parentSpec` its element group's.
 * A ref whose parent is optional is never listed in `outstanding`, which is
 * why the two fields answer different questions.
 */
export interface GoCollect {
  ref: string;
  spec?: string;
  parentSpec?: string;
}

/** POST {baseUrl}journey/interaction/fetch response. */
export interface GoInteractionFetchResponse {
  instanceId?: string;
  journey?: { status?: string };
  interactionId?: string;
  interaction?: Record<string, unknown>;
  processing?: boolean;
  outstanding?: string[];
  instructions?: string[];
  result?: GoResult;
}

/**
 * Every domain element ref this interaction collects, required or not.
 *
 * `outstanding` is the narrower field: only what Go is currently blocking on.
 * An element whose parent is optional never appears there — the Meridian
 * journey lists 47 refs under `collects` against 8 in `outstanding`, and its
 * consent, personal-details, contact-details and address pages are all in
 * that difference. Selecting screens on `outstanding` silently drops them.
 *
 * Empty when the interaction carries no collects (the mock, or a journey
 * predating the field), and callers fall back to `outstanding`.
 */
export function collectsOf(response: GoInteractionFetchResponse): GoCollect[] {
  const raw = response.interaction?.collects;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { ref, spec, parentSpec } = entry as Record<string, unknown>;
    if (typeof ref !== 'string') return [];
    return [
      {
        ref,
        spec: typeof spec === 'string' ? spec : undefined,
        parentSpec: typeof parentSpec === 'string' ? parentSpec : undefined,
      },
    ];
  });
}

/** POST {baseUrl}journey/interaction/submit request body. */
export interface GoInteractionSubmitRequest {
  instanceId: string;
  interactionId: string;
  participants: { domainElementId: string }[];
  context: { subject: Record<string, unknown> };
}

/** The journey's own name/version/timing, wherever a state-fetch response carries it. */
export interface GoJourneyInfo {
  id?: string;
  name?: string;
  version?: string;
  startedAt?: string;
  endedAt?: string;
}

/**
 * POST {baseUrl}journey/state/fetch response. Per-module results are nested
 * at context.process.steps, not at the root: `steps` stays for any response
 * that does put them there, and `allSteps()` reads whichever is populated.
 * Journey timing has the same split — see `journeyInfo()`.
 */
export interface GoStateResponse {
  instanceId?: string;
  status?: string;
  journey?: GoJourneyInfo;
  steps?: GoStateStep[];
  result?: GoResult;
  context?: { process?: { steps?: GoStateStep[]; journey?: GoJourneyInfo } };
}

/**
 * `durationMilliSec`, `startedAt` and `endedAt` live at `process.step.*` —
 * verified against a real completed run, 2026-09-16 — not as siblings of
 * `result` as an earlier version of this type assumed (that guess always
 * read back undefined).
 */
export interface GoStateStepDetail {
  startedAt?: string;
  endedAt?: string;
  durationMilliSec?: number;
  moduleName?: string;
}

export interface GoStateStep {
  nodeId?: string;
  name?: string;
  outcome?: string;
  outcomeClassification?: string;
  result?: GoStateStepResult;
  process?: { step?: GoStateStepDetail };
}

/** How long this step's module took to run, in milliseconds, or undefined if not yet finished. */
export function stepDurationMs(step: GoStateStep): number | undefined {
  return step.process?.step?.durationMilliSec;
}

/** When this step's module finished (ISO-8601), or undefined if not yet finished. */
export function stepEndedAt(step: GoStateStep): string | undefined {
  return step.process?.step?.endedAt;
}

/**
 * A step's own result. Present on the nested `result` object, not the step
 * root. `subject` is that module's own contribution to the journey's subject
 * data — e.g. Document Classification's own result carries
 * `subject.documents[0].classification`, which is where the classified
 * document type actually surfaces (verified against a real completed run,
 * 2026-09-16) — the top-level `GoResult` never carries it.
 */
export interface GoStateStepResult {
  status?: string;
  outcome?: string;
  error?: GoStateStepError;
  subject?: Record<string, unknown>;
}

/**
 * What a module reports when it could not run — distinct from a module that
 * ran and declined. Go states the problem and what to do about it, which is
 * worth far more to the customer than a generic failure message.
 */
export interface GoStateStepError {
  errors?: { error?: string; location?: string; problem?: string; action?: string; code?: string }[];
  correlationId?: string;
}

export function allSteps(response: GoStateResponse): GoStateStep[] {
  if (response.steps && response.steps.length > 0) return response.steps;
  return response.context?.process?.steps ?? [];
}

/** The journey's own name/version/timing, from wherever this response carries it — see `GoJourneyInfo`. */
export function journeyInfo(response: GoStateResponse): GoJourneyInfo | undefined {
  return response.journey ?? response.context?.process?.journey;
}

export function firstStepErrorAction(step: GoStateStep): string | undefined {
  return step.result?.error?.errors?.[0]?.action;
}

/** GBG Go v2's own error envelope — distinct from, and translated into, this service's front-end-facing one. */
export interface GoErrorEnvelope {
  errors?: { code?: string; name?: string; problem?: string; action?: string; location?: string }[];
}
