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

export type GoMode = 'mock' | 'test-scenarios' | 'live';

const GO_MODES: GoMode[] = ['mock', 'test-scenarios', 'live'];

/**
 * GO_MODE, any case. Unset is mock. Anything else is a typo — fail fast
 * rather than quietly run mock while the tester believes they are on Go.
 */
export function parseGoMode(raw: string | undefined): GoMode {
  if (raw === undefined || raw.trim() === '') return 'mock';
  const mode = raw.trim().toLowerCase();
  if (!GO_MODES.includes(mode as GoMode)) {
    throw new Error(`Unknown GO_MODE "${raw}" — expected one of: ${GO_MODES.join(', ')}`);
  }
  return mode as GoMode;
}

/**
 * - mock (default): canned fixtures, no credentials or network, mirroring
 *   the front end's own mock-mode requirement.
 * - test-scenarios: the real GBG Go v2 API, with every journey started on a
 *   named test scenario (no live checks, no verification charges) — see
 *   `testScenario` in each market's config.
 * - live: the real GBG Go v2 API with real checks.
 */
export const goMode: GoMode = parseGoMode(process.env.GO_MODE);

/** Whether a mode calls the real GBG Go API — live and test-scenarios both do. The one place that rule lives. */
export function callsGo(mode: GoMode): boolean {
  return mode === 'live' || mode === 'test-scenarios';
}

/** GBG Go's rule for a test scenario name. Checked before a name goes into a header. */
export const SCENARIO_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * The market's default test scenario, trimmed, or undefined if not set.
 * Checked at load in test-scenarios mode, so a bad name in a market file
 * fails at startup, not on the first customer.
 */
function resolveTestScenario(): string | undefined {
  const configured = marketConfig.go.testScenario?.trim() || undefined;
  if (goMode === 'test-scenarios' && configured !== undefined && !SCENARIO_NAME.test(configured)) {
    throw new Error(
      `go.testScenario "${configured}" for market "${marketConfig.app.market}" is not a valid test scenario name: ` +
        'use letters, numbers, _ and -, up to 64 characters.'
    );
  }
  if (goMode === 'test-scenarios') {
    console.info(
      `Test scenarios mode: journeys start on ${
        configured === undefined ? 'no default scenario (go.testScenario is not set)' : `scenario '${configured}'`
      } unless the front end names one with ?mock_scenario=`
    );
  }
  return configured;
}

export const defaultTestScenario: string | undefined = resolveTestScenario();

/** Full API base URL, trailing slash guaranteed. Composes the documented public-platform host from region unless go.baseUrl is set explicitly. */
export function resolveGoBaseUrl(): string {
  const { baseUrl, region } = marketConfig.go;
  if (baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }
  return `https://${region}.platform.go.gbgplc.com/v2/captain/`;
}

export { MARKETS };
