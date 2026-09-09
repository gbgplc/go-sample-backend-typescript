import { MarketConfig } from '../types';
import { DEFAULT_GO_CONFIG } from '../defaultGoConfig';

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
    consentUrl: 'https://ridgelineplay.example/consent/age-verification-v1',
    consentTerms: 'I agree that Ridgeline Play may use my details to verify my age and identity.',
  },
  go: DEFAULT_GO_CONFIG,
  screenPlan: {
    stages: [],
    consentChecks: [],
  },
};
