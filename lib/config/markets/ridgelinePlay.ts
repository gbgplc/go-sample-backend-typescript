import { MarketConfig } from '../types';
import { DEFAULT_GO_CONFIG } from '../defaultGoConfig';

/**
 * Matches application-ridgeline-play.yml, including the gbggo4-demo fabric
 * nonprod tenant's go.* overrides and its verified screen plan.
 */
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
    resourceId: '1d10f195ec2d11e2d7a2d5ca8f2b77ebe4e940da102f857b300102fa0b2e4cde@5juix16t',
    corsAllowedOrigins: ['http://localhost:3002'],
    consentUrl: 'https://ridgelineplay.example/consent/age-verification-v1',
    consentTerms: 'I agree that Ridgeline Play may use my details to verify my age and identity.',
  },
  // The gbggo4-demo nonprod tenant. Still inert unless GO_MODE=live — set
  // that, and GBG_CLIENT_ID/SECRET/USERNAME/PASSWORD, in an untracked
  // .env.local.
  go: {
    region: 'eu',
    authUrl: 'https://gbggo4-demo.nonprod.fabric.gbgplatforms.com/auth/realms/go/protocol/openid-connect/token',
    baseUrl: 'https://gbggo4-demo-eu.nonprod.fabric.gbgplatforms.com/v2/captain/',
    grantType: 'password',
    scope: 'openid',
  },
  // Live-mode screens for this journey (defaultInteractionMapper): which
  // domain elements map to which screen, in collection order.
  //
  // Stages match against the interaction's `collects` list. Re-read it after
  // every republish rather than assuming the shape holds: this journey has
  // changed more than once under the same resource, dropping Selfie in one
  // version and growing the required address from three components to six in
  // another. A stage written against the old shape submits an incomplete
  // address, and the journey stalls on a screen already filled in.
  screenPlan: {
    stages: [
      {
        name: 'personal',
        kind: 'form',
        prefix: 'Gender',
        alsoPrefixes: ['SSN', 'MothersMaidenName', 'NationalInsuranceNumber'],
        stage: 'Sign up',
        title: 'About you',
        body: 'We check these against trusted data sources to confirm you are 18 or over.',
        cta: 'Continue',
      },
      {
        name: 'contact',
        kind: 'form',
        prefix: 'PersonalEmail/',
        alsoPrefixes: ['MobilePhone/', 'LandlinePhone/'],
        stage: 'Contact',
        title: 'How can we reach you?',
        body: 'We use these to confirm it is you and to keep your account secure.',
        cta: 'Continue',
      },
      {
        name: 'address',
        kind: 'form',
        prefix: 'CurrentAddress/',
        stage: 'Address',
        title: 'Where do you live?',
        body: 'We check this against trusted data sources to confirm your age and identity.',
        cta: 'Continue',
        modules: ['Data Verification'],
      },
      {
        name: 'previous-addresses',
        kind: 'form',
        prefix: 'PreviousAddresses',
        stage: 'Address history',
        title: 'Where did you live before?',
        body: 'Add an earlier address if you have moved in the last three years.',
        cta: 'Continue',
      },
      {
        name: 'document',
        kind: 'capture',
        prefix: 'PrimaryDocument/',
        stage: 'Document',
        title: 'Scan your photo ID',
        body: 'Passport or driving licence. Fill the frame and hold steady.',
        cta: 'Scan document',
        captureType: 'document',
        accepted: ['Passport', 'Driving licence'],
        modules: ['Document Classification', 'Document Extraction', 'Document Authentication'],
      },
      {
        name: 'biometrics',
        kind: 'capture',
        prefix: 'Selfie/',
        stage: 'Biometrics',
        title: 'Take a selfie',
        body: 'This proves you are the person in the document.',
        cta: 'Take selfie',
        captureType: 'selfie',
        modules: ['Liveness Verification', 'Facematch Verification'],
      },
    ],
    consentChecks: [],
  },
};
