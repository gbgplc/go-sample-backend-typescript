import { MarketConfig, ScreenPlanStage } from './types';
import { northbank } from './markets/northbank';
import { meridianHealth } from './markets/meridianHealth';
import { ridgelinePlay } from './markets/ridgelinePlay';

const MARKETS: Record<string, MarketConfig> = {
  northbank,
  'meridian-health': meridianHealth,
  'ridgeline-play': ridgelinePlay,
};

/** A stage missing a required field is a config typo — fail fast at module load, not with an NPE-equivalent the first time a request reaches it. Mirrors ScreenPlanProperties' @Validated. */
export function validateScreenPlanStage(stage: ScreenPlanStage, market: string, index: number): void {
  const required: (keyof ScreenPlanStage)[] = ['name', 'kind', 'prefix', 'stage', 'title', 'body'];
  for (const field of required) {
    const value = stage[field];
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `Invalid screen-plan config for market "${market}": stages[${index}].${field} is required but missing.`
      );
    }
  }
}

function resolveMarket(): MarketConfig {
  const marketId = process.env.MARKET ?? 'northbank';
  const config = MARKETS[marketId];
  if (!config) {
    throw new Error(
      `Unknown MARKET "${marketId}" — expected one of: ${Object.keys(MARKETS).join(', ')}`
    );
  }
  config.screenPlan.stages.forEach((stage, index) => validateScreenPlanStage(stage, marketId, index));
  return config;
}

export const marketConfig: MarketConfig = resolveMarket();

export const sessionConfig = {
  ttlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'onboarding_session',
};

export type GoMode = 'mock' | 'live';

const GO_MODES: GoMode[] = ['mock', 'live'];

/**
 * GO_MODE, any case. Unset is mock. Anything else is a typo — fail fast
 * rather than quietly run mock while the tester believes they are on Go.
 * test-scenarios is api-implementation's alone: it needs the x-gbg-scenario
 * header on journey/start, which the SDK cannot send.
 */
export function parseGoMode(raw: string | undefined): GoMode {
  if (raw === undefined || raw.trim() === '') return 'mock';
  const mode = raw.trim().toLowerCase();
  if (mode === 'test-scenarios') {
    throw new Error(
      `GO_MODE "${raw}" is not available in sdk-implementation: @gbg/go-core cannot send the x-gbg-scenario ` +
        'header (README, "Known gaps" (k)). Use api-implementation for test scenarios.'
    );
  }
  if (!GO_MODES.includes(mode as GoMode)) {
    throw new Error(`Unknown GO_MODE "${raw}" — expected one of: ${GO_MODES.join(', ')}`);
  }
  return mode as GoMode;
}

/**
 * - mock (default): canned fixtures, no credentials or network, mirroring
 *   the front end's own mock-mode requirement.
 * - live: the real GBG Go v2 API through @gbg/go-core.
 */
export const goMode: GoMode = parseGoMode(process.env.GO_MODE);

/** Full API base URL, trailing slash guaranteed. Composes the documented public-platform host from region unless go.baseUrl is set explicitly. */
export function resolveGoBaseUrl(): string {
  const { baseUrl, region } = marketConfig.go;
  if (baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }
  return `https://${region}.platform.go.gbgplc.com/v2/captain/`;
}

/**
 * The base URL for the SDK's `serverURL`: the full API base, `/v2/captain`
 * included, without the trailing slash (every operation path starts with one).
 *
 * `@gbg/go-core` 0.2.0-alpha.1 put `/v2/captain` back into its server URLs
 * and took it out of the operation paths, reversing alpha.0. Under alpha.0
 * this stripped it; under alpha.1 stripping it would send every call to
 * `https://host/journey/...`. Mirrors go-sample-backend-java's
 * GoSdkProperties.sdkServerUrl() on go-core-sdk 0.2.0-alpha02.
 */
export function sdkServerUrl(baseUrl: string = resolveGoBaseUrl()): string {
  return baseUrl.replace(/\/$/, '');
}

export { MARKETS };
