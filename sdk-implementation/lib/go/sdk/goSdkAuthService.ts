import { Go } from '@gbg/go-core';
import type { PostAsTokenOauth2Request } from '@gbg/go-core/models/operations';
import { marketConfig } from '../../config';
import { OnboardingException } from '../../errors/onboardingException';

/**
 * Exchanges the Go client credentials for a Bearer token via the SDK's
 * `tokens.generate()` and caches it until shortly before it expires. This is
 * the one place GBG_CLIENT_SECRET (and, under the password grant,
 * GBG_PASSWORD) is read.
 *
 * Known SDK limitation (README, "Known gaps"): `tokens.generate()` hard-codes
 * the path `/as/token.oauth2` and only the host can be overridden. That is
 * the public platform's PingFederate endpoint exactly, so client_credentials
 * works; a fabric tenant's Keycloak realm (`/realms/{realm}/protocol/
 * openid-connect/token`) cannot be reached this way, so the password grant
 * is sent but will fail against such a tenant. No market here uses it.
 */

const REFRESH_MARGIN_SECONDS = 30;

let cachedToken: string | undefined;
let cachedTokenExpiresAt = 0;
let mintingPromise: Promise<string> | undefined;

/** A bare client used only for `tokens` — token generation needs no bearer token of its own. */
const tokenClient = new Go({ timeoutMs: 15_000 });

/** scheme://host[:port] of go.authUrl — the only part of it the SDK lets us override. */
function authServerUrl(): string {
  return new URL(marketConfig.go.authUrl).origin;
}

function tokenRequest(): PostAsTokenOauth2Request {
  const { go } = marketConfig;
  const clientId = process.env.GBG_CLIENT_ID ?? '';
  const clientSecret = process.env.GBG_CLIENT_SECRET ?? '';
  if (go.grantType === 'password') {
    return {
      grantType: 'password',
      clientId,
      clientSecret,
      username: process.env.GBG_USERNAME ?? '',
      password: process.env.GBG_PASSWORD ?? '',
    };
  }
  // The SDK's scope is a one-value enum ('gbg.token'); go.scope is not sent.
  return { grantType: 'client_credentials', clientId, clientSecret, scope: 'gbg.token' };
}

async function mintToken(): Promise<string> {
  if (!process.env.GBG_CLIENT_ID || !process.env.GBG_CLIENT_SECRET) {
    console.error('GBG_CLIENT_ID / GBG_CLIENT_SECRET are not set; cannot mint a Go access token');
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform.');
  }
  let body;
  try {
    body = await tokenClient.tokens.generate(tokenRequest(), { serverURL: authServerUrl() });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    console.error(`Failed to mint a Go access token${status ? ` (${status})` : ''}`, e instanceof Error ? e.message : e);
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform. Try again shortly.');
  }
  if (!body.accessToken) {
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform.');
  }
  cachedToken = body.accessToken;
  cachedTokenExpiresAt = Date.now() + Math.max(0, (body.expiresIn ?? 0) - REFRESH_MARGIN_SECONDS) * 1000;
  return cachedToken;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  // Coalesce concurrent callers onto one in-flight mint.
  if (!mintingPromise) {
    mintingPromise = mintToken().finally(() => {
      mintingPromise = undefined;
    });
  }
  return mintingPromise;
}

/**
 * Drops `token` if it is still the cached one, so the next call mints afresh.
 * Called when Go rejects a token (401/403) before its expiry — revoked,
 * rotated early, or clock skew. A token already replaced by another caller's
 * mint is left alone.
 */
export function invalidate(token: string): void {
  if (cachedToken === token) {
    cachedToken = undefined;
    cachedTokenExpiresAt = 0;
  }
}
