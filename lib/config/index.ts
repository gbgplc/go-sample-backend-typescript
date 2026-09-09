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

/** "mock" (default) needs no live Go credentials, mirroring the front end's own mock-mode requirement. Set GO_MODE=live to proxy the real GBG Go v2 API. */
export const goMode: 'mock' | 'live' = process.env.GO_MODE === 'live' ? 'live' : 'mock';

/** Full API base URL, trailing slash guaranteed. Composes the documented public-platform host from region unless go.baseUrl is set explicitly. */
export function resolveGoBaseUrl(): string {
  const { baseUrl, region } = marketConfig.go;
  if (baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }
  return `https://${region}.platform.go.gbgplc.com/v2/captain/`;
}

export { MARKETS };
