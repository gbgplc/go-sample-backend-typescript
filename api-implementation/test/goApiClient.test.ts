import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingException } from '@/lib/errors/onboardingException';
import { fieldsByGoPath } from '@/lib/go/live/buildSubmitRequest';

/**
 * The live client's error handling against a fake Go (stubbed global fetch):
 * token retry on 401/403, a per-call timeout, and Go's validation problems
 * reported against the fields the customer typed into. Parity with
 * go-sample-backend-java's api-implementation.
 */

interface Seen {
  url: string;
  authorization: string | null;
  hasSignal: boolean;
}

type Handler = (seen: Seen) => Response;

let seen: Seen[] = [];
let routes: Record<string, Handler> = {};
let tokenCount = 0;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FETCH_PATH = '/v2/captain/journey/interaction/fetch';
const SUBMIT_PATH = '/v2/captain/journey/interaction/submit';

const INTERACTION = {
  instanceId: 'inst-1',
  interactionId: 'int-1',
  journey: { status: 'InProgress' },
  interaction: { collects: [] },
  outstanding: ['MobilePhone/number'],
};

beforeEach(() => {
  vi.resetModules();
  for (const key of ['__goClient', '__lastOutstandingByInstance', '__lastInstructionsByInstance', '__completedStagesByInstance']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seen = [];
  tokenCount = 0;
  routes = {
    '/as/token.oauth2': () => json(200, { access_token: `token-${++tokenCount}`, expires_in: 3600 }),
    [FETCH_PATH]: () => json(200, INTERACTION),
    [SUBMIT_PATH]: () => json(200, { status: 'success' }),
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const entry: Seen = { url: input, authorization: headers.get('authorization'), hasSignal: init?.signal !== undefined };
    seen.push(entry);
    const handler = routes[new URL(input).pathname];
    return handler ? handler(entry) : json(404, { errors: [{ problem: 'no route' }] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function client() {
  return (await import('@/lib/go/live/goApiClient')).goApiClient;
}

const calls = (path: string) => seen.filter((s) => new URL(s.url).pathname === path);

describe('goApiClient', () => {
  it('retries once with a fresh token when Go rejects the token', async () => {
    let rejected = false;
    routes[FETCH_PATH] = (s) => {
      if (!rejected && s.authorization === 'Bearer token-1') {
        rejected = true;
        return json(401, { errors: [{ problem: 'Authentication required' }] });
      }
      return json(200, INTERACTION);
    };

    await (await client()).fetchInteraction('inst-1');

    expect(calls(FETCH_PATH).map((c) => c.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('does not retry a second time', async () => {
    routes[FETCH_PATH] = () => json(403, { errors: [{ problem: 'Forbidden' }] });

    const error = await (await client()).fetchInteraction('inst-1').catch((e: unknown) => e);

    expect(calls(FETCH_PATH)).toHaveLength(2);
    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('gives every Go call and the token mint a timeout', async () => {
    await (await client()).fetchInteraction('inst-1');

    expect(seen.every((s) => s.hasSignal)).toBe(true);
  });

  it('reports Go validation problems against the fields the customer typed into', async () => {
    routes[SUBMIT_PATH] = () =>
      json(400, { errors: [{ problem: 'context.subject.identity.phones.0.number: Invalid phone number' }] });
    const goClient = await client();
    await goClient.fetchInteraction('inst-1');

    const error = await goClient
      .submitInteraction('inst-1', 'int-1', { mobileNumber: '123' })
      .catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('VALIDATION_FAILED');
    expect((error as OnboardingException).fields).toEqual({ mobileNumber: 'Invalid phone number' });
  });

  it('reports a malformed success body as upstream unavailable', async () => {
    routes[FETCH_PATH] = () => new Response('not json', { status: 200 });

    const error = await (await client()).fetchInteraction('inst-1').catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('fieldsByGoPath', () => {
  it('matches the paths buildSubmitRequest places each field at', () => {
    expect(
      fieldsByGoPath({
        'CurrentAddress/postalCode': 'SW1A 2AA',
        mobileNumber: '07700900000',
        documentImage: 'x',
        selfieImage: 'y',
        shareWithClinicians: true,
      })
    ).toEqual({
      'context.subject.identity.currentAddress.postalCode': 'CurrentAddress/postalCode',
      'context.subject.identity.phones.0.number': 'mobileNumber',
      'context.subject.documents.0.side1Image': 'documentImage',
      'context.subject.biometrics.0.selfieImage': 'selfieImage',
    });
  });
});
