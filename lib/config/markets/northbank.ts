import { MarketConfig } from '../types';
import { DEFAULT_GO_CONFIG } from '../defaultGoConfig';

/**
 * Matches application-northbank.yml, including the gbggo4-demo fabric nonprod
 * tenant's go.* overrides and its verified screen plan.
 */
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
    resourceId: 'f3d875bc2ebff66f557fb177646f4c80e453d8d064b92a53fd1079edded1ea91@5q2gadns',
    // 3000 is the app's pinned port; 3010 is a fallback for when something
    // else already holds 3000.
    corsAllowedOrigins: ['http://localhost:3000', 'http://localhost:3010'],
    consentUrl: 'https://northbank.example/consent/account-opening-v1',
    consentTerms: 'I agree that Northbank may use my details to verify my identity and open my account.',
  },
  // The gbggo4-demo nonprod tenant. Still inert unless GO_MODE=live — set
  // that, and GBG_CLIENT_ID/SECRET/USERNAME/PASSWORD, in an untracked
  // .env.local.
  //
  // Note the two hosts differ: the Keycloak realm has no region segment, the
  // API host does (-eu). That is not a typo.
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
  // Stages match against the interaction's `collects` list, not `outstanding`
  // — the latter carries only what Go is blocking on and omits every element
  // whose parent is optional, which drops most of this journey's pages.
  screenPlan: {
    stages: [
      // alsoPrefixes: one screen, several domain elements. Each is a separate
      // top-level element in `collects`, so a single prefix would claim only
      // the first and the screen would render one field out of three.
      {
        name: 'personal',
        kind: 'form',
        prefix: 'MothersMaidenName',
        alsoPrefixes: ['Gender', 'NationalInsuranceNumber'],
        stage: 'About you',
        title: 'About you',
        body: 'We check these against trusted consumer and government data sources. No credit footprint.',
        cta: 'Continue',
        modules: ['Data Verification'],
      },
      {
        name: 'contact',
        kind: 'form',
        prefix: 'PersonalEmail/',
        alsoPrefixes: ['WorkEmail/', 'MobilePhone/', 'LandlinePhone/'],
        stage: 'Contact details',
        title: 'How can we reach you?',
        body: 'We use these to confirm it is you and to tell you about your application.',
        cta: 'Continue',
      },
      {
        name: 'details',
        kind: 'form',
        prefix: 'CurrentAddress/',
        stage: 'Your details',
        title: 'Your address',
        body: 'We check this against trusted consumer and government data sources. No credit footprint.',
        cta: 'Continue',
        modules: ['Data Verification'],
      },
      {
        name: 'document',
        kind: 'capture',
        prefix: 'PrimaryDocument/',
        stage: 'Document',
        title: 'Scan your photo ID',
        body: 'Hold the document flat and fill the frame. Where your document has a chip, we read it for a stronger result.',
        cta: 'Scan document',
        captureType: 'document',
        accepted: ['Passport', 'Driving licence', 'Biometric residence permit'],
        modules: ['Document Classification', 'Document Extraction', 'Document Authentication'],
      },
      {
        name: 'biometrics',
        kind: 'capture',
        prefix: 'Selfie/',
        stage: 'Biometrics',
        title: 'Take a selfie',
        body: 'We confirm a real person is present, then compare your face with the photo on your document.',
        cta: 'Take selfie',
        captureType: 'selfie',
        modules: ['Liveness Verification', 'Facematch Verification'],
      },
    ],
    consentChecks: [],
  },
};
