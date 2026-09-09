import { NextRequest, NextResponse } from 'next/server';
import { sessionConfig } from '../config';

/**
 * Sets the session cookie with the options every route that carries a
 * session cookie needs to agree on.
 */
export function setSessionCookie(response: NextResponse, request: NextRequest, token: string): void {
  response.cookies.set(sessionConfig.cookieName, token, {
    httpOnly: true,
    // `secure` tracks the incoming request's own scheme rather than being
    // hardcoded true: a browser's "localhost is a secure context" exception
    // is Chromium-specific, and a Secure cookie issued over plain HTTP is
    // silently dropped by curl and most other HTTP clients.
    secure: request.nextUrl.protocol === 'https:',
    // `none`, not `lax`: the front end and this API are different origins by
    // design (see each market's corsAllowedOrigins and middleware.ts's
    // credentialed CORS handling) — SameSite=Lax withholds a cookie from a
    // cross-site fetch/XHR entirely, only sending it on a top-level
    // navigation, so a Lax cookie would never reach this API from a real
    // cross-origin front end. Browsers additionally require Secure whenever
    // SameSite=None, so cross-origin cookie delivery only works once this
    // API is served over HTTPS — a local http://-to-http:// pairing needs an
    // HTTPS dev proxy in front of it, not a workaround here.
    sameSite: 'none',
    path: '/v1/sessions',
    // Refreshed to the full TTL on every authenticated response, matching
    // sessionStore's own sliding idle timeout — otherwise an active user's
    // browser would drop the cookie at a fixed mark even though the server
    // still considers the session current.
    maxAge: sessionConfig.ttlMinutes * 60,
  });
}
