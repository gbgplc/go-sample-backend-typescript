import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingException } from '@/lib/errors/onboardingException';
import { buildSubmitRequest, fieldsByGoPath } from '@/lib/go/live/buildSubmitRequest';

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
  for (const key of [
    '__goClient',
    '__lastOutstandingByInstance',
    '__lastInstructionsByInstance',
    '__lastCollectableByInstance',
    '__completedStagesByInstance',
  ]) {
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
  vi.unstubAllEnvs();
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
      .submitInteraction('inst-1', 'int-1', { 'MobilePhone/number': '123' })
      .catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('VALIDATION_FAILED');
    expect((error as OnboardingException).fields).toEqual({ 'MobilePhone/number': 'Invalid phone number' });
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
      });
    let submitted: unknown;
    routes[SUBMIT_PATH] = () => json(200, { status: 'success' });
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === SUBMIT_PATH) submitted = JSON.parse(String(init?.body));
      return routes[path]!({ url: input, authorization: null, hasSignal: true });
    });
    const goClient = await client();
    const screen = await goClient.fetchInteraction('inst-1');
    await goClient.submitInteraction('inst-1', 'int-1', { attachmentRef: 'aW1hZ2U=' });

    expect(screen.interaction.stage).toBe('Document');
    const subject = (submitted as { context: { subject: Record<string, unknown> } }).context.subject;
    expect(subject.documents).toEqual([{ type: 'Primary', side1Image: 'aW1hZ2U=' }]);
    expect(subject.biometrics).toBeUndefined();
  });

  it('treats a failed result.status as terminal, and a null classification as no decision', async () => {
    const STATE_PATH = '/v2/captain/journey/state/fetch';
    const steps = { process: { steps: [{ name: 'Facematch Verification', result: { status: 'complete' } }] } };
    routes[STATE_PATH] = () =>
      json(200, { instanceId: 'inst-1', status: 'InProgress', result: { status: 'error', outcomeClassification: 'positive' }, context: steps });
    const goClient = await client();
    expect(await goClient.fetchState('inst-1')).toMatchObject({ status: 'Completed', decision: 'fail' });

    routes[STATE_PATH] = () =>
      json(200, { instanceId: 'inst-1', status: 'InProgress', result: { outcomeClassification: null }, context: steps });
    expect((await goClient.fetchState('inst-1')).status).toBe('InProgress');
  });

  /** A deadlocked journey, from gbggo4-demo (2026-10-29, sandbox_QPgHrNztUswy5tZySLOUfe). */
  it('treats an abandoned result as a system error, whatever the journey status', async () => {
    const STATE_PATH = '/v2/captain/journey/state/fetch';
    const abandoned = {
      status: 'abandoned',
      errors: [{ code: 'MODULE_DECLARED_OUTPUT_MISSING' }, { code: 'JOURNEY_ABANDONED' }],
    };
    const steps = { process: { steps: [{ name: 'Document Classification', result: { status: 'complete' } }] } };
    routes[STATE_PATH] = () => json(200, { instanceId: 'inst-1', status: 'InProgress', result: abandoned, context: steps });
    const goClient = await client();

    expect(await goClient.fetchState('inst-1')).toMatchObject({ status: 'Completed', decision: 'fail' });
    expect(await goClient.fetchRecord('inst-1')).toMatchObject({ systemError: true, title: 'We could not run your checks' });
  });

  /** The interaction screen agrees with the record. */
  it('does not show a Completed journey with a failed result as verified', async () => {
    routes[FETCH_PATH] = () =>
      json(200, {
        instanceId: 'inst-1',
        journey: { status: 'Completed' },
        result: { status: 'error', outcomeClassification: 'positive', outcome: 'Decision: Accept' },
      });

    const { interaction } = await (await client()).fetchInteraction('inst-1');

    expect(interaction).toMatchObject({ kind: 'result', decision: 'fail' });
    expect(interaction.title).not.toBe('Verification complete');
  });

  it('reports a malformed success body as upstream unavailable', async () => {
    routes[FETCH_PATH] = () => new Response('not json', { status: 200 });

    const error = await (await client()).fetchInteraction('inst-1').catch((e: unknown) => e);

    expect((error as OnboardingException).code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('buildSubmitRequest — contact and personal details', () => {
  it('places each domain element ref at its schema path, appending to typed arrays', () => {
    const request = buildSubmitRequest(
      'inst-1',
      'int-1',
      {
        'MobilePhone/number': '07700900000',
        'LandlinePhone/number': '02079460000',
        'PersonalEmail/email': 'ada@example.com',
        'WorkEmail/email': 'ada@work.example.com',
        NationalInsuranceNumber: 'QQ123456C',
        Gender: 'F',
        MothersMaidenName: 'Byron',
        PreviousAddresses: '1 Old Road',
        firstName: null,
      },
      'https://example.com/terms',
      'I agree.'
    );

    expect(request.context.subject).toEqual({
      identity: {
        phones: [
          { type: 'mobile', number: '07700900000' },
          { type: 'landline', number: '02079460000' },
        ],
        emails: [
          { type: 'personal', email: 'ada@example.com' },
          { type: 'work', email: 'ada@work.example.com' },
        ],
        idNumbers: [{ type: 'NationalInsuranceNumber', idNumber: 'QQ123456C' }],
        gender: 'F',
        mothersMaidenName: 'Byron',
        previousAddresses: [{ addressString: '1 Old Road' }],
      },
    });
    expect(request.participants.map((p) => p.domainElementId)).toEqual([
      'MobilePhone',
      'LandlinePhone',
      'PersonalEmail',
      'WorkEmail',
      'NationalInsuranceNumber',
      'Gender',
      'MothersMaidenName',
      'PreviousAddresses',
    ]);
  });

  it('does not resolve a ref by a leaf that belongs to another domain element', () => {
    const request = buildSubmitRequest(
      'inst-1',
      'int-1',
      { 'PreviousAddresses/postalCode': 'OX1 1AA', 'CurrentAddress/postalCode': 'SW1A 2AA' },
      'https://example.com/terms',
      'I agree.'
    );

    const identity = request.context.subject.identity as Record<string, unknown>;
    expect(identity.currentAddress).toEqual({ postalCode: 'SW1A 2AA' });
    expect(identity.previousAddresses).toEqual([{ postalCode: 'OX1 1AA' }]);
  });

  it("places a previous address's components together in its own entry", () => {
    const data = { 'PreviousAddresses/building': '1', 'PreviousAddresses/postalCode': 'OX1 1AA', 'PreviousAddresses/country': 'United Kingdom' };

    const request = buildSubmitRequest('inst-1', 'int-1', data, 'https://example.com/terms', 'I agree.');

    expect(request.context.subject).toEqual({
      identity: { previousAddresses: [{ building: '1', postalCode: 'OX1 1AA', country: 'GBR' }] },
    });
    expect(request.participants).toEqual([{ domainElementId: 'PreviousAddresses' }]);
    expect(fieldsByGoPath(data)['context.subject.identity.previousAddresses.0.postalCode']).toBe('PreviousAddresses/postalCode');
  });

  it('keeps a landline when a mobile number follows it', () => {
    const request = buildSubmitRequest(
      'inst-1',
      'int-1',
      { 'LandlinePhone/number': '02079460000', mobileNumber: '07700900000' },
      'https://example.com/terms',
      'I agree.'
    );

    expect((request.context.subject.identity as Record<string, unknown>).phones).toEqual([
      { type: 'landline', number: '02079460000' },
      { type: 'mobile', number: '07700900000' },
    ]);
  });

  it('reports each appended entry at its own index', () => {
    expect(fieldsByGoPath({ 'PersonalEmail/email': 'a@example.com', 'WorkEmail/email': 'b@example.com' })).toEqual({
      'context.subject.identity.emails.0.email': 'PersonalEmail/email',
      'context.subject.identity.emails.1.email': 'WorkEmail/email',
    });
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
