/**
 * The read model the mapper works on: one interaction view and one state
 * view, whichever SDK response type they came from.
 *
 * `@gbg/go-core` returns a union of a full and a slim variant for both
 * interaction/fetch and state/fetch, and types most of what the mapper reads
 * loosely (`interaction`, `result` and `context` are records, `outstanding`
 * and `instructions` are `any` on the full variant). `sdkResponses.ts`
 * narrows both variants into these views once, so the screen-selection logic
 * in `sdkInteractionMapper.ts` stays identical to api-implementation's
 * `defaultInteractionMapper.ts` and never has to know which variant arrived.
 */

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

/** An interaction/fetch response, from either SDK variant. */
export interface GoInteractionView {
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
export function collectsOf(response: GoInteractionView): GoCollect[] {
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

/** The journey's own name/version/timing, from `context.process.journey`. */
export interface GoJourneyInfo {
  id?: string;
  name?: string;
  version?: string;
  startedAt?: string;
  endedAt?: string;
}

/**
 * A state/fetch response (full view). Per-module results are nested at
 * `context.process.steps` and journey timing at `context.process.journey` —
 * the SDK's `StateFetchResponse` carries both inside its untyped `context`
 * record, and drops any other top-level key, so there is no root-level
 * `steps`/`journey` to fall back to as api-implementation does.
 */
export interface GoStateView {
  instanceId?: string;
  status?: string;
  result?: GoResult;
  context?: { process?: { steps?: GoStateStep[]; journey?: GoJourneyInfo } };
}

/**
 * `durationMilliSec`, `startedAt` and `endedAt` live at `process.step.*` —
 * verified against a real completed run, 2026-09-16.
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
 * A step's own result. `subject` is that module's own contribution to the
 * journey's subject data — e.g. Document Classification's own result carries
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

export function allSteps(response: GoStateView): GoStateStep[] {
  return response.context?.process?.steps ?? [];
}

export function journeyInfo(response: GoStateView): GoJourneyInfo | undefined {
  return response.context?.process?.journey;
}

export function firstStepErrorAction(step: GoStateStep): string | undefined {
  return step.result?.error?.errors?.[0]?.action;
}
