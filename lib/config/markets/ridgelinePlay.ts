import { MarketConfig } from '../types';

/** No published Go journey yet — placeholder resourceId, no live go.* overrides, no screen plan. Matches application-ridgeline-play.yml. */
export const ridgelinePlay: MarketConfig = {
  app: {
    market: 'ridgeline-play',
    brand: 'Ridgeline Play',
    mark: 'R',
    tagline: 'Account sign-up and age gate',
    accent: '#CC6133',
    accentSoft: '#FFEDE5',
    helpLine: 'Live chat is open 24 hours. Safer gambling tools are in Account.',
    journeyName: 'GB player onboarding',
    resourceId: 'jny_gb_player_kyc@latest',
    corsAllowedOrigins: ['http://localhost:3002'],
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
