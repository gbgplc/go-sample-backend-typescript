import type { JourneyStartResponse } from '@gbg/go-core/models';
import type { FetchInteractionResponse, GetJourneyStateResponse } from '@gbg/go-core/models/operations';
import { GoInteractionView, GoResult, GoStateView } from './goViews';

/**
 * Narrows `@gbg/go-core` responses into the `goViews` read model.
 *
 * interaction/fetch and state/fetch both return a TS union of a full and a
 * slim variant, picked by the SDK's own best-match heuristic rather than by
 * the `view` we asked for. Neither field set is a superset the other can be
 * told apart by — a full response without `context` looks like a slim one —
 * so the fields both variants share are read structurally instead of
 * branching on which variant arrived.
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

export function toInteractionView(response: FetchInteractionResponse): GoInteractionView {
  const body = response as unknown as Record<string, unknown>;
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
  // Both variants have instanceId/status/result. Only slim has top-level
  // `steps`/`journey`; only full has `context`.
  const body = response as unknown as Record<string, unknown>;
  const looksSlim = body.context === undefined && (body.steps !== undefined || body.journey !== undefined);
  if (looksSlim) return undefined;
  return {
    instanceId: response.instanceId,
    status: response.status,
    result: record(body.result) as GoResult | undefined,
    context: record(body.context) as GoStateView['context'],
  };
}

export function startedInstanceId(response: JourneyStartResponse): string | undefined {
  return response.instanceId || undefined;
}
