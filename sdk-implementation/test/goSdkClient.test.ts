import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingException } from '@/lib/errors/onboardingException';

/**
 * Drives goSdkClient through the real `@gbg/go-core` SDK against a fake Go
 * (a stubbed global fetch), so these tests pin what the SDK actually sends
 * and how what it throws is classified — not a mock of the SDK.
 */

interface Seen {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

type Handler = (seen: Seen) => Response | Promise<Response>;

let seen: Seen[] = [];
let routes: Record<string, Handler> = {};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TOKEN_PATH = '/as/token.oauth2';
const FETCH_PATH = '/v2/captain/journey/interaction/fetch';
const SUBMIT_PATH = '/v2/captain/journey/interaction/submit';
const START_PATH = '/v2/captain/journey/start';
const STATE_PATH = '/v2/captain/journey/state/fetch';

let tokenCount = 0;

const INTERACTION = {
  instanceId: 'inst-1',
  interactionId: 'grn:::gbg:design:interaction:segment1@latest',
  journey: { status: 'InProgress' },
  interaction: { collects: [{ ref: 'PrimaryDocument/side1Image', spec: 'required' }] },
  outstanding: ['PrimaryDocument/side1Image', 'Selfie/selfieImage'],
  instructions: ['LazySide2CollectionRequired'],
};

beforeEach(() => {
  vi.resetModules();
  for (const key of [
    '__sdkLastOutstandingByInstance',
    '__sdkLastInstructionsByInstance',
    '__sdkLastCollectableByInstance',
    '__sdkCompletedStagesByInstance',
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seen = [];
  tokenCount = 0;
  vi.stubEnv('GBG_CLIENT_ID', 'test-client');
  vi.stubEnv('GBG_CLIENT_SECRET', 'test-secret');
  routes = {
    [TOKEN_PATH]: () => json(200, { access_token: `token-${++tokenCount}`, token_type: 'Bearer', expires_in: 3600 }),
    [START_PATH]: () => json(201, { instanceId: 'inst-1', status: 'InProgress' }),
    [FETCH_PATH]: () => json(200, INTERACTION),
    [SUBMIT_PATH]: () => json(200, { status: 'success' }),
  };
  vi.stubGlobal('fetch', async (input: Request) => {
    const url = new URL(input.url);
    const text = await input.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* form-encoded token request */
    }
    const entry: Seen = { method: input.method, url: input.url, authorization: input.headers.get('authorization'), body };
    seen.push(entry);
    const handler = routes[url.pathname];
    return handler ? handler(entry) : json(404, { errors: [{ code: '404', name: 'NotFound', problem: 'no route', action: '' }] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function client() {
  return (await import('@/lib/go/sdk/goSdkClient')).goSdkClient;
}

const calls = (path: string) => seen.filter((s) => new URL(s.url).pathname === path);

describe('goSdkClient against the real SDK', () => {
  it('sends every Go call to the host once, with /v2/captain from the SDK path and not doubled', async () => {
    await (await client()).startJourney('journey@v1', undefined, null);

    const urls = seen.map((s) => s.url).filter((u) => !u.includes(TOKEN_PATH));
    expect(urls).toEqual([
      `https://eu.platform.go.gbgplc.com${START_PATH}`,
      `https://eu.platform.go.gbgplc.com${FETCH_PATH}`,
    ]);
  });

  it('puts the bearer token on fetch and submit, which ignore the client-level token', async () => {
    const goClient = await client();
    await goClient.fetchInteraction('inst-1');
    await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'aW1hZ2U=' });

    expect(calls(FETCH_PATH).every((c) => c.authorization === 'Bearer token-1')).toBe(true);
    expect(calls(SUBMIT_PATH)[0]?.authorization).toBe('Bearer token-1');
  });

  it('mints the token through tokens.generate against the auth host', async () => {
    await (await client()).fetchInteraction('inst-1');

    const mint = calls(TOKEN_PATH)[0];
    expect(mint?.url).toBe(`https://api.auth.gbgplc.com${TOKEN_PATH}`);
    expect(String(mint?.body)).toContain('grant_type=client_credentials');
    expect(String(mint?.body)).toContain('scope=gbg.token');
  });

  it('starts the journey with delivery=api and the prefill as the subject', async () => {
    await (await client()).startJourney('journey@v1', { identity: { firstName: 'Ada' } }, null);

    expect(calls(START_PATH)[0]?.body).toEqual({
      resourceId: 'journey@v1',
      context: { config: { delivery: 'api' }, subject: { identity: { firstName: 'Ada' } } },
    });
  });

  it('starts without a prefill the SDK rejects instead of refusing the journey', async () => {
    await (await client()).startJourney('journey@v1', { identity: { firstName: 42 } }, null);

    const starts = calls(START_PATH);
    expect(starts).toHaveLength(1);
    expect((starts[0]?.body as { context: Record<string, unknown> }).context.subject).toBeUndefined();
  });

  it('routes a capture to the document and submits it as the typed document', async () => {
    const goClient = await client();
    await goClient.fetchInteraction('inst-1');
    await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'aW1hZ2U=' });

    expect(calls(SUBMIT_PATH)[0]?.body).toEqual({
      instanceId: 'inst-1',
      interactionId: 'int-1',
      participants: [{ domainElementId: 'PrimaryDocument' }],
      context: { subject: { documents: [{ type: 'Primary', side1Image: 'aW1hZ2U=' }] } },
    });
  });

  it('routes a capture to the back of the document when Go asks for side 2', async () => {
    routes[FETCH_PATH] = () => json(200, { ...INTERACTION, instructions: ['Side2Required'] });
    const goClient = await client();
    await goClient.fetchInteraction('inst-1');
    await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'YmFjaw==' });

    const subject = (calls(SUBMIT_PATH)[0]?.body as { context: { subject: { documents: unknown[] } } }).context.subject;
    expect(subject.documents).toEqual([{ type: 'Primary', side2Image: 'YmFjaw==' }]);
  });

  it('retries once with a fresh token when Go rejects the token', async () => {
    let rejected = false;
    routes[FETCH_PATH] = (s) => {
      if (!rejected && s.authorization === 'Bearer token-1') {
        rejected = true;
        return json(401, { errors: [{ code: '2001', name: 'UNAUTHORIZED', problem: 'Authentication required', action: '' }] });
      }
      return json(200, INTERACTION);
    };

    await (await client()).fetchInteraction('inst-1');

    expect(calls(FETCH_PATH).map((c) => c.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('turns Go validation problems into per-field errors', async () => {
    routes[SUBMIT_PATH] = () =>
      json(400, {
        errors: [
          {
            code: 'E1',
            name: 'Invalid',
            problem: 'context.subject.identity.emails.0.email: Invalid email address',
            action: 'Fix it',
          },
        ],
      });

    const error = await (await client())
      .submitInteraction('inst-1', 'int-1', { 'PersonalEmail/email': 'nope' })
      .catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('VALIDATION_FAILED');
    expect((error as OnboardingException).fields).toEqual({ 'PersonalEmail/email': 'Invalid email address' });
  });

  it('still reports per-field errors when the error body fails the SDK schema', async () => {
    // No `name` or `action`: the SDK rejects this as an ErrorResponse and
    // throws ResponseValidationError instead, with the raw body intact.
    routes[SUBMIT_PATH] = () =>
      json(400, { errors: [{ code: 'E1', problem: 'context.subject.identity.emails.0.email: Invalid email address' }] });

    const error = await (await client())
      .submitInteraction('inst-1', 'int-1', { 'PersonalEmail/email': 'nope' })
      .catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('VALIDATION_FAILED');
    expect((error as OnboardingException).fields).toEqual({ 'PersonalEmail/email': 'Invalid email address' });
  });

  it('retries a rejected token on the journeys calls too, minting once per attempt', async () => {
    let rejected = false;
    routes[STATE_PATH] = (s) => {
      if (!rejected) {
        rejected = true;
        return json(401, { errors: [{ code: '2001', name: 'UNAUTHORIZED', problem: 'Authentication required', action: '' }] });
      }
      return json(200, { instanceId: 'inst-1', status: 'InProgress', context: { process: { steps: [] } } });
    };

    await (await client()).fetchState('inst-1');

    expect(calls(STATE_PATH).map((c) => c.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(calls(TOKEN_PATH)).toHaveLength(2);
  });

  it.each([
    [404, 'SESSION_EXPIRED'],
    [429, 'RATE_LIMITED'],
    [500, 'UPSTREAM_UNAVAILABLE'],
    [403, 'UPSTREAM_UNAVAILABLE'],
  ])('classifies a %i from Go as %s', async (status, code) => {
    routes[FETCH_PATH] = () => json(status, { errors: [{ code: String(status), name: 'E', problem: 'p', action: 'a' }] });

    const error = await (await client()).fetchInteraction('inst-1').catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe(code);
  });

  it('does not mark a stage complete when the submit is not a success', async () => {
    routes[SUBMIT_PATH] = () => json(200, { status: 'queued' });
    const goClient = await client();
    await goClient.fetchInteraction('inst-1');

    const error = await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'aW1hZ2U=' }).catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
    // The document stage is still the current screen.
    const next = await goClient.fetchInteraction('inst-1');
    expect(next.interaction.stage).toBe('Document');
  });

  it('reports an empty JSON body as upstream unavailable rather than crashing', async () => {
    routes[FETCH_PATH] = () => new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } });

    const error = await (await client()).fetchInteraction('inst-1').catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('reads the decision and module runs from the full state view', async () => {
    routes[STATE_PATH] = () =>
      json(200, {
        instanceId: 'inst-1',
        status: 'InProgress',
        result: { outcome: 'Decision: Manual review', outcomeClassification: 'neutral' },
        context: {
          process: {
            steps: [
              { name: 'Facematch Verification', result: { status: 'complete', outcome: 'Match' } },
              { outcomeClassification: 'neutral' },
            ],
          },
        },
      });

    const state = await (await client()).fetchState('inst-1');

    expect(state.status).toBe('Completed');
    expect(state.decision).toBe('refer');
    expect(state.moduleRuns?.map((run) => run.label)).toEqual(['Facematch Verification']);
  });

  it('treats a failed result.status as a terminal fail, whatever the classification says', async () => {
    routes[STATE_PATH] = () =>
      json(200, {
        instanceId: 'inst-1',
        status: 'InProgress',
        result: { status: 'error', outcomeClassification: 'positive' },
        context: { process: { steps: [{ name: 'Facematch Verification', result: { status: 'complete' } }] } },
      });

    const state = await (await client()).fetchState('inst-1');

    expect(state.status).toBe('Completed');
    expect(state.decision).toBe('fail');
  });

  it('does not count an explicit null classification as a decision', async () => {
    routes[STATE_PATH] = () =>
      json(200, {
        instanceId: 'inst-1',
        status: 'InProgress',
        result: { outcomeClassification: null },
        context: { process: { steps: [{ name: 'Document Classification', result: { status: 'complete', outcome: 'Document Classified' } }] } },
      });

    const state = await (await client()).fetchState('inst-1');

    expect(state.status).toBe('InProgress');
  });

  it('routes a capture by the collected refs, not raw outstanding (document not listed as outstanding)', async () => {
    // Meridian's document stage is not alwaysCollect, so the stage is found
    // only from the list it is matched against.
    vi.stubEnv('MARKET', 'meridian-health');
    routes[FETCH_PATH] = () =>
      json(200, {
        ...INTERACTION,
        interaction: { collects: [{ ref: 'PrimaryDocument/side1Image' }, { ref: 'Selfie/selfieImage' }] },
        outstanding: ['Selfie/selfieImage'],
        instructions: [],
      });
    const goClient = await client();
    const screen = await goClient.fetchInteraction('inst-1');
    await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'aW1hZ2U=' });

    expect(screen.interaction.stage).toBe('Document');
    const subject = (calls(SUBMIT_PATH)[0]?.body as { context: { subject: Record<string, unknown> } }).context.subject;
    expect(subject.documents).toEqual([{ type: 'Primary', side1Image: 'aW1hZ2U=' }]);
    expect(subject.biometrics).toBeUndefined();
  });

  it('refuses a slim state view, which has no step status or timing', async () => {
    routes[STATE_PATH] = () =>
      json(200, { instanceId: 'inst-1', status: 'InProgress', steps: [{ nodeId: 'n1', name: 'Facematch Verification' }] });

    const error = await (await client()).fetchState('inst-1').catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
