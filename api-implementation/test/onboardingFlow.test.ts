import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as startSession } from '@/app/v1/sessions/route';
import { GET as getInteraction, POST as submitInteraction } from '@/app/v1/sessions/[id]/interaction/route';
import { GET as getRecord } from '@/app/v1/sessions/[id]/record/route';
import { GET as getState } from '@/app/v1/sessions/[id]/state/route';
import { GET as getConfig } from '@/app/v1/config/route';

/**
 * Drives the whole Northbank flow through the real Route Handlers (no
 * running server — constructs a NextRequest and calls the exported
 * GET/POST directly), against mockGoClient — the same contract RestTransport
 * calls from the front end. Mirrors OnboardingFlowIntegrationTest.java.
 */

function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0] ?? '';
}

function jsonRequest(url: string, method: string, body?: unknown, cookie?: string): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('the whole Northbank flow through the real route handlers', () => {
  it('starts, submits, resists idempotent resubmission and staleness, and completes', async () => {
    const startResponse = await startSession(jsonRequest('http://localhost/v1/sessions', 'POST', {}));
    expect(startResponse.status).toBe(200);
    const startBody = await startResponse.json();
    expect(startBody.sessionId).toBeTruthy();
    expect(startBody.interaction.kind).toBe('intro');
    expect(startBody.interaction.stagePlan[0]).toEqual({ label: 'Start', state: 'active' });

    const cookie = cookieHeaderFrom(startResponse);
    expect(cookie).toContain('onboarding_session=');
    const sessionId: string = startBody.sessionId;
    const interactionId: string = startBody.interaction.interactionId;

    // intro -> details
    const formResponse = await submitInteraction(
      jsonRequest(`http://localhost/v1/sessions/${sessionId}/interaction`, 'POST', { interactionId, data: {} }, cookie),
      { params: { id: sessionId } }
    );
    expect(formResponse.status).toBe(200);
    const formBody = await formResponse.json();
    expect(formBody.interaction.kind).toBe('form');
    expect(formBody.interaction.collects[0].name).toBe('fullName');

    // Resubmitting the SAME interactionId must be idempotent, not advance twice.
    const retryResponse = await submitInteraction(
      jsonRequest(`http://localhost/v1/sessions/${sessionId}/interaction`, 'POST', { interactionId, data: {} }, cookie),
      { params: { id: sessionId } }
    );
    expect(retryResponse.status).toBe(200);
    expect((await retryResponse.json()).interaction.kind).toBe('form');

    const detailsInteractionId: string = formBody.interaction.interactionId;

    // Submitting a stale (already-passed) interactionId is rejected.
    const staleResponse = await submitInteraction(
      jsonRequest(
        `http://localhost/v1/sessions/${sessionId}/interaction`,
        'POST',
        { interactionId: 'not-the-current-one', data: {} },
        cookie
      ),
      { params: { id: sessionId } }
    );
    expect(staleResponse.status).toBe(409);
    expect((await staleResponse.json()).code).toBe('INTERACTION_STALE');

    // A GET returns the same current interaction without advancing.
    const refetched = await getInteraction(
      new NextRequest(`http://localhost/v1/sessions/${sessionId}/interaction`, { headers: { Cookie: cookie } }),
      { params: { id: sessionId } }
    );
    expect((await refetched.json()).interactionId).toBe(detailsInteractionId);

    // details -> document -> selfie -> processing
    let nextId = detailsInteractionId;
    for (let i = 0; i < 3; i++) {
      const r = await submitInteraction(
        jsonRequest(`http://localhost/v1/sessions/${sessionId}/interaction`, 'POST', { interactionId: nextId, data: {} }, cookie),
        { params: { id: sessionId } }
      );
      expect(r.status).toBe(200);
      nextId = (await r.json()).interaction.interactionId;
    }

    // Now on the processing screen; submitting it completes the journey.
    const finalResponse = await submitInteraction(
      jsonRequest(`http://localhost/v1/sessions/${sessionId}/interaction`, 'POST', { interactionId: nextId, data: {} }, cookie),
      { params: { id: sessionId } }
    );
    expect(finalResponse.status).toBe(200);
    const finalBody = await finalResponse.json();
    expect(finalBody.status).toBe('Completed');
    const decisionEntry = finalBody.interaction.stagePlan.find((e: { label: string }) => e.label === 'Decision');
    expect(decisionEntry.state).toBe('active');

    const recordResponse = await getRecord(
      new NextRequest(`http://localhost/v1/sessions/${sessionId}/record`, { headers: { Cookie: cookie } }),
      { params: { id: sessionId } }
    );
    expect(recordResponse.status).toBe(200);
    const recordBody = await recordResponse.json();
    expect(recordBody.decision).toBe('pass');
    expect(recordBody.summary.length).toBeGreaterThan(0);
  });

  it('rejects requests without the session cookie', async () => {
    const startResponse = await startSession(jsonRequest('http://localhost/v1/sessions', 'POST', {}));
    const sessionId: string = (await startResponse.json()).sessionId;

    const stateResponse = await getState(new NextRequest(`http://localhost/v1/sessions/${sessionId}/state`), {
      params: { id: sessionId },
    });
    expect(stateResponse.status).toBe(410);
    expect((await stateResponse.json()).code).toBe('SESSION_EXPIRED');
  });

  it('getConfig returns the Northbank brand', async () => {
    const response = await getConfig();
    const body = await response.json();
    expect(body.brand).toBe('Northbank');
    expect(body.accent).toBe('#4D4DFF');
  });
});
