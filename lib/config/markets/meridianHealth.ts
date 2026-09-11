import { MarketConfig } from '../types';

/**
 * Matches application-meridian-health.yml, including its verified screen plan.
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
    // Pinned to an exact version rather than @latest: @latest costs a
    // Journey-builder lookup on every start and doesn't pick up a publish
    // predictably.
    resourceId: 'b3d149562ec927dedcd76f3a6b7b0f82bbf7de818aebad3b3f7baa4c14940b6b@5ph3fkm5',
    corsAllowedOrigins: ['http://localhost:3001'],
    consentUrl: 'https://meridianhealth.example/consent/record-access-v1',
    consentTerms: 'I agree that Meridian Health may access and share my patient record with clinicians treating me.',
  },
  // The public GBG Go platform. Set GO_MODE=live and the two credentials in an
  // untracked .env.local to use it; otherwise this is inert.
  //
  // baseUrl is regional: swap `eu` for `us` or `au` to match the region your
  // tenant was provisioned in, and set `region` to the same value.
  //
  // Running against a nonprod fabric tenant instead? It uses a Keycloak realm
  // and the password grant, so override authUrl, baseUrl, grantType and scope,
  // and supply username and password alongside the client credentials. Put
  // that in a local override rather than here — this file ships to customers.
  go: {
    region: 'eu',
    authUrl: 'https://api.auth.gbgplc.com/as/token.oauth2',
    baseUrl: 'https://eu.platform.go.gbgplc.com/v2/captain/',
    grantType: 'client_credentials',
    scope: 'gbg.token',
  },
  // Live-mode screens for this journey (defaultInteractionMapper): which
  // domain elements map to which screen, in collection order.
  //
  // Stages match against the interaction's `collects` list, which names 47
  // refs across seven pages; `outstanding` is the narrower field and omits
  // any element whose parent is optional, so matching on that alone drops
  // pages the journey really has — consent, personal details, contact
  // details and address among them.
  //
  // Order follows the journey's own pages: consent first, since a patient
  // agrees to their record being opened before anything is collected, then
  // identity and contact details, the address, and document before selfie
  // because Facematch compares the selfie against the anchor image Document
  // Classification produces. Copy matches
  // apps/meridian-health/onboarding.config.ts so the live journey reads like
  // the mock.
  screenPlan: {
    stages: [
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
      // alsoPrefixes: one screen, several domain elements. Each is a separate
      // top-level element in `collects`, so a single prefix would claim only
      // the first and the screen would render one field out of three.
      {
        name: 'personal',
        kind: 'form',
        prefix: 'MothersMaidenName',
        alsoPrefixes: ['Gender', 'NationalInsuranceNumber'],
        stage: 'Details',
        title: 'Your details',
        body: 'We match these against national records to find your patient file.',
        cta: 'Continue',
      },
      {
        name: 'contact',
        kind: 'form',
        prefix: 'MobilePhone/',
        alsoPrefixes: ['LandlinePhone/'],
        stage: 'Contact',
        title: 'How can we reach you?',
        body: 'We use this to confirm it is you, and to tell you when your record is ready.',
        cta: 'Continue',
      },
      {
        name: 'address',
        kind: 'form',
        prefix: 'CurrentAddress/',
        stage: 'Address',
        title: 'Your address',
        body: 'We match this against national records to find your patient file.',
        cta: 'Continue',
      },
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
