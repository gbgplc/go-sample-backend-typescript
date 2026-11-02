import type { JourneyStartResponse } from '@gbg/go-core/models';
import type { FetchInteractionResponse, GetJourneyStateResponse } from '@gbg/go-core/models/operations';
import { GoInteractionView, GoResult, GoStateView } from './goViews';

/**
 * Narrows `@gbg/go-core` responses into the `goViews` read model.
 *
 * interaction/fetch and state/fetch both return a TS union of a full and a
 * slim variant. Since 0.2.0-alpha.1 the SDK picks the variant by the
 * response's `view` property (alpha.0 guessed by best field match), and adds
 * a third member, `Unknown`, for a body with no or an unrecognised `view` —
 * or one whose `view` is known but whose fields fail that variant's schema.
 * `Unknown` wraps the body in `raw`, so it is unwrapped first; the fields
 * both variants share are then read structurally, whichever arrived.
 */

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Whether the SDK returned its `Unknown` member: Go's body is then in `raw`. */
export function arrivedAsUnknown(response: unknown): boolean {
  return record(response)?.isUnknown === true;
}

/** The response's fields, from `raw` when the SDK returned its `Unknown` member. */
function bodyOf(response: unknown): Record<string, unknown> {
  const value = record(response) ?? {};
  return arrivedAsUnknown(value) ? (record(value.raw) ?? {}) : value;
}

export function toInteractionView(response: FetchInteractionResponse): GoInteractionView {
  const body = bodyOf(response);
  const journey = record(body.journey);
  return {
    instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined,
    interactionId: typeof body.interactionId === 'string' ? body.interactionId : undefined,
    journey: { status: typeof journey?.status === 'string' ? journey.status : undefined },
    interaction: record(body.interaction),
    processing: typeof body.processing === 'boolean' ? body.processing : undefined,
    // Typed `any` on the full variant and `string[]` on the slim one; a
    // non-string entry is skipped rather than stringified into a ref that
    // could never match a screen-plan prefix.
    outstanding: stringList(body.outstanding),
    instructions: stringList(body.instructions),
    result: record(body.result) as GoResult | undefined,
  };
}

/**
 * The full state view, or undefined for the slim one. Slim steps carry only
 * `nodeId`/`name`/`outcome`/`outcomeClassification` — no status, timing or
 * module error — so a record built from them would misreport every module
 * as still running. Callers treat undefined as "could not read the state".
 */
export function toStateView(response: GetJourneyStateResponse): GoStateView | undefined {
  // Go names the view it sent. Without one (the Unknown member), fall back
  // to shape: only slim has top-level `steps`/`journey`; only full has
  // `context`.
  const body = bodyOf(response);
  const looksSlim =
    body.view === 'slim' || (body.context === undefined && (body.steps !== undefined || body.journey !== undefined));
  if (looksSlim) return undefined;
  return {
    instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    result: record(body.result) as GoResult | undefined,
    context: record(body.context) as GoStateView['context'],
  };
}

export function startedInstanceId(response: JourneyStartResponse): string | undefined {
  return response.instanceId || undefined;
}
