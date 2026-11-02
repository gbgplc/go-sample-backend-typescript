import { NextRequest } from 'next/server';
import { StartSessionRequest } from '@/lib/dto/types';
import { handleRouteError } from '@/lib/http/errorHandling';
import { jsonResponse } from '@/lib/http/jsonResponse';
import { sessionService } from '@/lib/session/sessionService';
import { setSessionCookie } from '@/lib/session/sessionCookie';

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
    setSessionCookie(response, request, started.cookieToken);
    return response;
  } catch (err) {
    return handleRouteError(err);
  }
}
