import { NextRequest, NextResponse } from 'next/server';
import { sessionConfig } from '../config';
import { setSessionCookie } from '../session/sessionCookie';
import { handleRouteError } from './errorHandling';
import { jsonResponse } from './jsonResponse';

/**
 * Shared scaffolding for every cookie-authenticated route: reads the session
 * cookie, runs the handler, and reissues the cookie with a refreshed maxAge
 * on success so the cookie's fixed expiry stays in sync with sessionStore's
 * sliding idle timeout. A handler that throws (including a failed
 * authorization) never gets a fresh cookie — handleRouteError decides what
 * the client sees.
 */
export async function withSession<T>(
  request: NextRequest,
  handler: (cookieToken: string | undefined) => Promise<T>
): Promise<NextResponse> {
  const cookieToken = request.cookies.get(sessionConfig.cookieName)?.value;
  try {
    const body = await handler(cookieToken);
    const response = jsonResponse(body);
    if (cookieToken) {
      setSessionCookie(response, request, cookieToken);
    }
    return response;
  } catch (err) {
    return handleRouteError(err);
  }
}
