import { NextRequest } from 'next/server';
import { sessionConfig } from '@/lib/config';
import { StartSessionRequest } from '@/lib/dto/types';
import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';

/**
 * Starts a journey and returns the first interaction inline to save a round
 * trip. Sets the session cookie on the response — capture it (browsers do
 * this automatically with credentials: 'include'; other clients need a
 * cookie jar). No cookie required to call this endpoint — it's the one that
 * creates the session.
 */
export async function POST(request: NextRequest) {
  try {
    const scenarioHint = request.nextUrl.searchParams.get('mock_scenario');

    let body: StartSessionRequest | null = null;
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text) as StartSessionRequest;
      } catch {
        body = null;
      }
    }

    const started = await sessionService.startSession(body?.prefill, scenarioHint);

    const response = jsonResponse(started.body, 200);
    // `secure` tracks the incoming request's own scheme rather than being
    // hardcoded true: a browser's "localhost is a secure context" exception
    // is Chromium-specific, and a Secure cookie issued over plain HTTP is
    // silently dropped by curl and most other HTTP clients.
    const secure = request.nextUrl.protocol === 'https:';
    response.cookies.set(sessionConfig.cookieName, started.cookieToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/v1/sessions',
      maxAge: sessionConfig.ttlMinutes * 60,
    });
    return response;
  } catch (err) {
    return handleRouteError(err);
  }
}
