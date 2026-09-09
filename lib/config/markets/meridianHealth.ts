import { MarketConfig } from '../types';

/**
 * The only market with a published Go journey. Matches
 * application-meridian-health.yml, including the gbggo4-demo fabric nonprod
 * tenant's go.* overrides and its verified screen plan.
 */
export const meridianHealth: MarketConfig = {
  app: {
    market: 'meridian-health',
    brand: 'Meridian Health',
    mark: 'M',
    tagline: 'Patient record registration',
    accent: '#219C4C',
    accentSoft: '#C7EBD5',
    helpLine: 'Reception can verify you in person with the same documents.',
    journeyName: 'Patient record access',
    // Published to Preview on the gbggo4-demo tenant, 2026-09-07. Pinned to an
    // exact version rather than @latest: @latest costs a Journey-builder lookup
    // on every start and doesn't pick up a publish predictably.
    resourceId: 'b3d149562ec927dedcd76f3a6b7b0f82bbf7de818aebad3b3f7baa4c14940b6b@2g6no1nz',
    corsAllowedOrigins: ['http://localhost:3001'],
    consentUrl: 'https://meridianhealth.example/consent/record-access-v1',
  },
  // The gbggo4-demo nonprod tenant. Still inert unless GO_MODE=live — set that,
  // and GBG_CLIENT_ID/SECRET/USERNAME/PASSWORD, in an untracked .env.local.
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
  // outstanding domain elements map to which screen, in collection order.
  // Document before selfie (Facematch compares the selfie against the anchor
  // image Document Classification produces), consent last. Copy matches
  // apps/meridian-health/onboarding.config.ts so the live journey reads
  // identically to the mock. No identity form: the journey has no FullName or
  // DateOfBirth element — Data Verification was removed after it proved
  // unable to source them on this tenant (HANDOFF.md).
  screenPlan: {
    stages: [
      {
        name: 'document',
        kind: 'capture',
        prefix: 'PrimaryDocument/',
        stage: 'Document',
        title: 'Scan your photo ID',
        body: 'We check the document is genuine and read the details from it.',
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
        body: 'This proves you are the person in the document, so nobody else can open your record.',
        cta: 'Take selfie',
        captureType: 'selfie',
        modules: ['Liveness Verification', 'Facematch Verification'],
      },
      {
        name: 'consent',
        kind: 'consent',
        prefix: 'Consent/',
        stage: 'Consent',
        title: 'Share your record with Meridian Health',
        body: 'You decide what each group can see. You can change any of this later in settings.',
        cta: 'Agree and continue',
        modules: ['Consent Collection'],
      },
    ],
    // The design has three independent toggles; the Consent Collection module
    // records acceptance of one agreement (its only required element is
    // Consent/url). Only the first gates access, so that one drives the
    // module, and the other two are recorded as preferences alongside it.
    consentChecks: [
      {
        name: 'shareWithClinicians',
        label: 'Show my record to clinicians treating me',
        detail: 'GP notes, test results, prescriptions and referrals',
        defaultChecked: true,
      },
      {
        name: 'sharePrescriptions',
        label: 'Share prescriptions with my chosen pharmacy',
        detail: 'Only the pharmacy you name',
        defaultChecked: false,
      },
      {
        name: 'useForResearch',
        label: 'Use my data for research',
        detail: 'Anonymised, optional, and unrelated to your care',
        defaultChecked: false,
      },
    ],
  },
};
