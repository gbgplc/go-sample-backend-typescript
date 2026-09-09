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

/** POST {baseUrl}journey/interaction/submit request body. */
export interface GoInteractionSubmitRequest {
  instanceId: string;
  interactionId: string;
  participants: { domainElementId: string }[];
  context: { subject: Record<string, unknown> };
}

/**
 * POST {baseUrl}journey/state/fetch response. Per-module results are nested
 * at context.process.steps, not at the root: `steps` stays for any response
 * that does put them there, and `allSteps()` reads whichever is populated.
 */
export interface GoStateResponse {
  instanceId?: string;
  status?: string;
  journey?: { id?: string; name?: string; version?: string; startedAt?: string; endedAt?: string };
  steps?: GoStateStep[];
  result?: GoResult;
  context?: { process?: { steps?: GoStateStep[] } };
}

export interface GoStateStep {
  nodeId?: string;
  name?: string;
  outcome?: string;
  outcomeClassification?: string;
  result?: GoStateStepResult;
}

/** A step's own result. Present on the nested `result` object, not the step root. */
export interface GoStateStepResult {
  status?: string;
  outcome?: string;
  error?: GoStateStepError;
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

export function firstStepErrorAction(step: GoStateStep): string | undefined {
  return step.result?.error?.errors?.[0]?.action;
}

/** GBG Go v2's own error envelope — distinct from, and translated into, this service's front-end-facing one. */
export interface GoErrorEnvelope {
  errors?: { code?: string; name?: string; problem?: string; action?: string; location?: string }[];
}
