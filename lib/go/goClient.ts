import { Interaction, JourneyStatus, RecordResponse, StateResponse, SubmitInteractionResponse } from '../dto/types';
import { goMode } from '../config';

export interface GoStartResult {
  instanceId: string;
  status: JourneyStatus;
  interaction: Interaction;
}

/**
 * Everything the session layer needs from GBG Go, named after the v2
 * endpoints each method wraps (journey/start, interaction/fetch,
 * interaction/submit, state/fetch). Two implementations: MockGoClient for
 * local/demo running with no live credentials, and GoApiClient for the real
 * thing. The session layer never knows which one is wired in.
 */
export interface GoClient {
  /**
   * @param scenarioHint mock-mode-only affordance (mirrors the front end's own
   * ?mock_scenario= query param) so every designed outcome can be reached on
   * demand. A live client ignores it — which branch plays is Go's decision.
   */
  startJourney(
    resourceId: string,
    prefill: Record<string, unknown> | undefined,
    scenarioHint: string | null
  ): Promise<GoStartResult>;

  fetchInteraction(instanceId: string): Promise<SubmitInteractionResponse>;

  submitInteraction(
    instanceId: string,
    interactionId: string,
    data: Record<string, unknown> | undefined
  ): Promise<SubmitInteractionResponse>;

  fetchState(instanceId: string): Promise<StateResponse>;

  fetchRecord(instanceId: string): Promise<RecordResponse>;
}

/**
 * Selected once by GO_MODE — the TS equivalent of Spring's
 * @ConditionalOnProperty choosing which single bean implements GoClient.
 * Resolved lazily via dynamic import (rather than a static import of both
 * implementations) so a mock-mode deployment never has to load the live-mode
 * module graph, and vice versa.
 */
let cached: GoClient | undefined;

export async function getGoClient(): Promise<GoClient> {
  if (cached) return cached;
  cached =
    goMode === 'live'
      ? (await import('./live/goApiClient')).goApiClient
      : (await import('./mock/mockGoClient')).mockGoClient;
  return cached;
}
