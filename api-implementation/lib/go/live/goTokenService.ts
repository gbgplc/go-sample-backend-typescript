import { marketConfig } from '../../config';
import { OnboardingException } from '../../errors/onboardingException';
import { GoTokenResponse } from './dto';

/**
 * Exchanges the Go client credentials for a Bearer token and caches it until
 * shortly before it expires. This is the one place GBG_CLIENT_SECRET (and,
 * under the password grant, GBG_PASSWORD) is read.
 *
 * Two grants, selected by go.grantType: client_credentials (the documented
 * public platform, scope=gbg.token against PingFederate) or password (the
 * fabric nonprod tenants, which front Keycloak — id, secret, username and
 * password). Keycloak realms tend to issue short-lived tokens (300s on
 * gbggo4-demo vs. the documented platform's 3600s), so the refresh margin
 * below is deliberately small enough to stay useful at that TTL.
 */

const REFRESH_MARGIN_SECONDS = 30;

let cachedToken: string | undefined;
let cachedTokenExpiresAt = 0;
let mintingPromise: Promise<string> | undefined;

async function mintToken(): Promise<string> {
  const { go } = marketConfig;
  const form = new URLSearchParams();
  form.set('grant_type', go.grantType);
  form.set('client_id', process.env.GBG_CLIENT_ID ?? '');
  form.set('client_secret', process.env.GBG_CLIENT_SECRET ?? '');
  form.set('scope', go.scope);
  if (go.grantType === 'password') {
    form.set('username', process.env.GBG_USERNAME ?? '');
    form.set('password', process.env.GBG_PASSWORD ?? '');
  }

  let response: Response;
  try {
    response = await fetch(go.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch (e) {
    console.error('Failed to mint a Go access token', e);
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform. Try again shortly.');
  }

  if (!response.ok) {
    console.error(`Go token endpoint returned ${response.status}`);
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform. Try again shortly.');
  }

  const body = (await response.json()) as GoTokenResponse;
  if (!body.access_token) {
    throw OnboardingException.upstreamUnavailable('Could not authenticate with the identity platform.');
  }

  cachedToken = body.access_token;
  const expiresIn = body.expires_in ?? 0;
  cachedTokenExpiresAt = Date.now() + Math.max(0, expiresIn - REFRESH_MARGIN_SECONDS) * 1000;
  return cachedToken;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  // Coalesce concurrent callers onto one in-flight mint rather than firing a
  // token request per caller — the TS equivalent of Java's `synchronized`.
  if (!mintingPromise) {
    mintingPromise = mintToken().finally(() => {
      mintingPromise = undefined;
    });
  }
  return mintingPromise;
}
