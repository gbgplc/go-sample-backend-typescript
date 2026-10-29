import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingException } from '@/lib/errors/onboardingException';

/**
 * GO_MODE=test-scenarios: journeys start on a named GBG Go test scenario,
 * picked by the front end's ?mock_scenario= or the market's go.testScenario.
 * Runs the live client against a fake Go (stubbed global fetch). Parity with
 * go-sample-backend-java's GoApiClientTestScenariosTest.
 */

interface Seen {
  path: string;
  scenario: string | null;
}

type Handler = () => Response;

let seen: Seen[] = [];
let routes: Record<string, Handler> = {};
let tokenCount = 0;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const START_PATH = '/v2/captain/journey/start';
const FETCH_PATH = '/v2/captain/journey/interaction/fetch';
const STATE_PATH = '/v2/captain/journey/state/fetch';

const TEST_START = { instanceId: 'test_abc', status: 'started', test: true, scenario: 'northbank-pass' };
const PROCESSING_FETCH = { instanceId: 'test_abc', journey: { status: 'InProgress' }, processing: true, outstanding: [] };

beforeEach(() => {
  vi.resetModules();
  for (const key of [
    '__goClient',
    '__lastOutstandingByInstance',
    '__lastInstructionsByInstance',
    '__lastCollectableByInstance',
    '__completedStagesByInstance',
    '__testScenarioByInstance',
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  vi.stubEnv('GO_MODE', 'test-scenarios');
  seen = [];
  tokenCount = 0;
  routes = {
    '/as/token.oauth2': () => json(200, { access_token: `token-${++tokenCount}`, expires_in: 3600 }),
    [START_PATH]: () => json(200, TEST_START),
    [FETCH_PATH]: () => json(200, PROCESSING_FETCH),
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    seen.push({ path, scenario: new Headers(init?.headers).get('x-gbg-scenario') });
    const handler = routes[path];
    return handler ? handler() : json(404, { errors: [{ problem: 'no route' }] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function client() {
  return (await import('@/lib/go/live/goApiClient')).goApiClient;
}

const calls = (path: string) => seen.filter((s) => s.path === path);

async function failure(promise: Promise<unknown>): Promise<OnboardingException> {
  return (await promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: unknown) => e
  )) as OnboardingException;
}

describe('goApiClient in test-scenarios mode', () => {
  it('sends no scenario header in live mode', async () => {
    vi.stubEnv('GO_MODE', 'live');
    routes[START_PATH] = () => json(200, { instanceId: 'i-1', status: 'started' });

    await (await client()).startJourney('journey@v1', undefined, 'northbank-refer');

    expect(calls(START_PATH).map((c) => c.scenario)).toEqual([null]);
  });

  it("starts on the market's default scenario when the front end names none, and only the start carries it", async () => {
    const started = await (await client()).startJourney('journey@v1', undefined, null);

    expect(started.instanceId).toBe('test_abc');
    expect(calls(START_PATH).map((c) => c.scenario)).toEqual(['northbank-pass']);
    expect(calls(FETCH_PATH).map((c) => c.scenario)).toEqual([null]);
  });

  it("lets the front end's ?mock_scenario= pick the scenario, trimmed", async () => {
    routes[START_PATH] = () => json(200, { ...TEST_START, scenario: 'northbank-refer' });

    await (await client()).startJourney('journey@v1', undefined, ' northbank-refer ');

    expect(calls(START_PATH).map((c) => c.scenario)).toEqual(['northbank-refer']);
  });

  /** Falling back would run the default (pass) scenario when the tester asked for another. */
  it('refuses an invalid scenario name from the front end without calling Go', async () => {
    const goClient = await client();

    for (const hint of ['bad name\r\nx-injected: 1', 'northbank refer', 'x'.repeat(65)]) {
      const error = await failure(goClient.startJourney('journey@v1', undefined, hint));
      expect(error.code, hint).toBe('BAD_REQUEST');
      expect(error.httpStatus).toBe(400);
    }
    expect(seen).toEqual([]);
  });

  it('fails without calling Go when there is no scenario at all', async () => {
    const markets = await import('@/lib/config/markets/northbank');
    const configured = markets.northbank.go.testScenario;
    markets.northbank.go.testScenario = undefined;
    try {
      const error = await failure((await client()).startJourney('journey@v1', undefined, null));
      expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(seen).toEqual([]);
    } finally {
      markets.northbank.go.testScenario = configured;
    }
  });

  it('goes no further when Go did not start a test run', async () => {
    routes[START_PATH] = () => json(200, { instanceId: 'i-live', status: 'started' });

    const error = await failure((await client()).startJourney('journey@v1', undefined, null));

    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    // No interaction fetch, so nothing further happens on the live instance.
    expect(calls(FETCH_PATH)).toEqual([]);
  });

  /** Go's explicit flag wins over the instance-ID prefix. */
  it('stops on an explicit "test": false even with a test_ prefix', async () => {
    routes[START_PATH] = () => json(200, { instanceId: 'test_abc', status: 'started', test: false });

    const error = await failure((await client()).startJourney('journey@v1', undefined, null));

    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(calls(FETCH_PATH)).toEqual([]);
  });

  it('still counts a start without the test flag on its test_ prefix', async () => {
    routes[START_PATH] = () => json(200, { instanceId: 'test_abc', status: 'started' });

    const started = await (await client()).startJourney('journey@v1', undefined, null);

    expect(started.instanceId).toBe('test_abc');
  });

  it.each([400, 404, 422])(
    'does not report a %i at start as an ended session or a form error',
    async (status) => {
      routes[START_PATH] = () => json(status, { errors: [{ code: String(status), problem: 'scenario not found' }] });
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = await failure((await client()).startJourney('journey@v1', undefined, null));

      expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(logged.mock.calls.flat().join(' ')).toContain('scenario not found');
    }
  );

  /** Go rejecting the prefill names the context path: that is still the customer's to fix. */
  it('keeps a prefill Go rejects at start as a field error', async () => {
    routes[START_PATH] = () =>
      json(422, { errors: [{ problem: 'context.subject.identity.phones.0.number: Invalid phone number' }] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const error = await failure((await client()).startJourney('journey@v1', undefined, null));

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  /** Its outcomes would otherwise be read as the requested scenario's. */
  it('goes no further when Go ran a different scenario from the one asked for', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await failure((await client()).startJourney('journey@v1', undefined, 'northbank-refer'));

    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(calls(FETCH_PATH)).toEqual([]);
  });

  /** There is no session yet, so "Your session has ended" would be wrong. */
  it('does not report a live-mode 404 at start as an ended session', async () => {
    vi.stubEnv('GO_MODE', 'live');
    routes[START_PATH] = () => json(404, {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await failure((await client()).startJourney('journey@v1', undefined, null));

    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  /** The identity platform is an implementation detail; the customer gets the generic message. */
  it('does not show the customer a token failure', async () => {
    routes['/as/token.oauth2'] = () => json(500, {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await failure((await client()).fetchInteraction('test_abc'));

    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.message).toBe('Something went wrong on our end. Try again shortly.');
  });

  it('suggests test scenarios are not enabled when a 403 survives a fresh token', async () => {
    routes[START_PATH] = () => json(403, { errors: [{ problem: 'Forbidden' }] });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await failure((await client()).startJourney('journey@v1', undefined, null));

    // The client mints a fresh token and retries once on a 403.
    expect(calls(START_PATH)).toHaveLength(2);
    expect(warned.mock.calls.flat().join(' ')).toContain('may not be enabled for this organisation');
  });

  it('does not blame the feature for other start failures', async () => {
    routes[START_PATH] = () => json(503, {});
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await failure((await client()).startJourney('journey@v1', undefined, null));

    expect(warned.mock.calls.flat().join(' ')).not.toContain('may not be enabled');
  });

  it("names the scenario on a test run's record", async () => {
    routes[STATE_PATH] = () =>
      json(200, { instanceId: 'test_abc', status: 'Completed', result: { status: 'complete', outcomeClassification: 'positive' } });
    const goClient = await client();

    await goClient.startJourney('journey@v1', undefined, null);
    const record = await goClient.fetchRecord('test_abc');

    expect(record.summary[0]).toEqual({ k: 'Test run', v: 'Yes, scenario northbank-pass' });
  });

  it("adds no test row to a live run's record", async () => {
    vi.stubEnv('GO_MODE', 'live');
    routes[STATE_PATH] = () =>
      json(200, { instanceId: 'i-1', status: 'Completed', result: { outcomeClassification: 'positive' } });

    const record = await (await client()).fetchRecord('i-1');

    expect(record.summary.some((row) => row.k === 'Test run')).toBe(false);
  });
});

describe('GO_MODE', () => {
  it('accepts the three modes in any case, defaults to mock, and refuses anything else', async () => {
    const { parseGoMode } = await import('@/lib/config');

    expect(parseGoMode(undefined)).toBe('mock');
    expect(parseGoMode('')).toBe('mock');
    expect(parseGoMode('Test-Scenarios')).toBe('test-scenarios');
    expect(parseGoMode('LIVE')).toBe('live');
    expect(() => parseGoMode('test-scenario')).toThrow(/Unknown GO_MODE/);
  });

  it('calls real Go in live and test-scenarios modes only', async () => {
    const { callsGo } = await import('@/lib/config');

    expect(callsGo('live')).toBe(true);
    expect(callsGo('test-scenarios')).toBe(true);
    expect(callsGo('mock')).toBe(false);
  });

  it('wires in the real Go client in test-scenarios mode', async () => {
    const { getGoClient } = await import('@/lib/go/goClient');

    expect(await getGoClient()).toBe(await client());
  });

  it('fails at load on an invalid default scenario', async () => {
    const markets = await import('@/lib/config/markets/northbank');
    const configured = markets.northbank.go.testScenario;
    markets.northbank.go.testScenario = 'not a valid name';
    try {
      await expect(import('@/lib/config')).rejects.toThrow(/go.testScenario/);
    } finally {
      markets.northbank.go.testScenario = configured;
    }
  });
});
