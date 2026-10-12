import { NextRequest, NextResponse } from 'next/server';
import { sessionConfig } from '../config';

/**
 * Sets the session cookie with the options every route that carries a
 * session cookie needs to agree on.
 */
export function setSessionCookie(response: NextResponse, request: NextRequest, token: string): void {
  // `secure` tracks the incoming request's own scheme rather than being
  // hardcoded true: a browser's "localhost is a secure context" exception is
  // Chromium-specific, and a Secure cookie issued over plain HTTP is silently
  // dropped by curl and most other HTTP clients.
  const secure = request.nextUrl.protocol === 'https:';

  response.cookies.set(sessionConfig.cookieName, token, {
    httpOnly: true,
    secure,
    // `none` over HTTPS, `lax` over HTTP — and the scheme is what decides,
    // because browsers reject SameSite=None without Secure outright.
    //
    // `none` is the right answer in production: the front end and this API
    // are different origins by design (see each market's corsAllowedOrigins
    // and middleware.ts's credentialed CORS handling), and SameSite=Lax
    // withholds a cookie from a cross-site fetch entirely, sending it only on
    // a top-level navigation.
    //
    // But a plain-HTTP pairing cannot have `none` at all. Issuing it anyway
    // means the browser stores no cookie, the next submit arrives without
    // one, and every request after the first fails as an expired session —
    // which is what a local http://localhost:3001 front end against this API
    // on http://localhost:8082 did, while curl (which does not enforce the
    // rule) worked fine and hid it. `lax` carries that pairing, because
    // localhost-to-localhost is same-site by the browser's own definition;
    // the Java backend has always used it for the same reason.
    sameSite: secure ? 'none' : 'lax',
    path: '/v1/sessions',
    // Refreshed to the full TTL on every authenticated response, matching
    // sessionStore's own sliding idle timeout — otherwise an active user's
    // browser would drop the cookie at a fixed mark even though the server
    // still considers the session current.
    maxAge: sessionConfig.ttlMinutes * 60,
  });
}
