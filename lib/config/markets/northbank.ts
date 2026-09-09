import { MarketConfig } from '../types';

/** No published Go journey yet — placeholder resourceId, no live go.* overrides, no screen plan. Matches application-northbank.yml. */
export const northbank: MarketConfig = {
  app: {
    market: 'northbank',
    brand: 'Northbank',
    mark: 'N',
    tagline: 'Current account opening, UK',
    accent: '#4D4DFF',
    accentSoft: '#F5F5FC',
    helpLine: 'Call 0800 000 000, or carry on in a branch with the same reference.',
    journeyName: 'UK retail account opening',
    resourceId: 'jny_uk_retail_cdd@latest',
    corsAllowedOrigins: ['http://localhost:3000'],
    consentUrl: 'https://meridianhealth.example/consent/record-access-v1',
  },
  go: {
    region: 'eu',
    authUrl: 'https://api.auth.gbgplc.com/as/token.oauth2',
    scope: 'gbg.token',
    grantType: 'client_credentials',
  },
  screenPlan: {
    stages: [],
    consentChecks: [],
  },
};
