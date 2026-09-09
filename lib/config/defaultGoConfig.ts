import { GoConfig } from './types';

/**
 * Shared `go.*` shape for a market with no published journey yet (see
 * HANDOFF.md) — same placeholder region/auth/scope every such market starts
 * from, spread into that market's config so there's one place to change it
 * rather than N copies drifting apart.
 */
export const DEFAULT_GO_CONFIG: GoConfig = {
  region: 'eu',
  authUrl: 'https://api.auth.gbgplc.com/as/token.oauth2',
  scope: 'gbg.token',
  grantType: 'client_credentials',
};
