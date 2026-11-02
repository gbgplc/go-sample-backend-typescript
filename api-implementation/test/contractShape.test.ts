import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as startSession } from '@/app/v1/sessions/route';
import { GET as getConfig } from '@/app/v1/config/route';
import { GET as getState } from '@/app/v1/sessions/[id]/state/route';

/**
 * Pins the exact field names a front end reads by name — the equivalent
 * protective value the Java backend gets from OpenApiContractTest pinning
 * its generated OpenAPI spec, without an OpenAPI generation pipeline here.
 * A rename or dropped field fails here instead of surfacing later as a
 * silent frontend-breaking mismatch.
 */

function keysOf(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

describe('contract shape', () => {
  it('StartSessionResponse keeps every field the front end reads by name', async () => {
    const response = await startSession(
      new NextRequest('http://localhost/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    const body = await response.json();

    expect(keysOf(body)).toEqual(['interaction', 'sessionId', 'status'].sort());
    expect(Object.keys(body.interaction)).toEqual(expect.arrayContaining(['interactionId', 'kind', 'stage', 'title']));
  });

  it('AppConfigResponse keeps every field the front end reads by name', async () => {
    const response = await getConfig();
    const body = await response.json();

    expect(keysOf(body)).toEqual(
      ['brand', 'mark', 'tagline', 'accent', 'accentSoft', 'helpLine', 'journeyName', 'resourceId'].sort()
    );
  });

  it('ErrorEnvelope keeps every field the front end reads by name', async () => {
    const response = await getState(new NextRequest('http://localhost/v1/sessions/does-not-exist/state'), {
      params: { id: 'does-not-exist' },
    });
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(keysOf(body)).toEqual(['code', 'http', 'message', 'retryable'].sort());
  });
});
