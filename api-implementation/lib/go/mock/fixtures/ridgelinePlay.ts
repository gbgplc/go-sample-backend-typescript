import { MarketFixtures, Scenario, ScenarioStep } from '../types';

/**
 * Online gaming — player sign-up. Ported verbatim from
 * RidgelinePlayFixtures.java. The sign-up form is identical across
 * scenarios — Go decides the branch silently from the data submitted, so
 * there's no user-facing choice here; mockGoClient picks the scenario once
 * per session the same way the front end's own mock does.
 */

function signUp(): ScenarioStep {
  return {
    kind: 'form',
    stage: 'Sign up',
    title: 'Create your account',
    body: 'You must be 18 or over to open an account.',
    cta: 'Create account',
    note: 'We check your age and identity from data in the background. Most players never scan a document.',
    modules: ['Age Verification', 'Data Verification', 'IP Geolocation', 'GBG Trust'],
    fields: [
      { name: 'email', label: 'Email', placeholder: 'you@example.com', type: 'email' },
      { name: 'mobileNumber', label: 'Mobile number', placeholder: '+44', type: 'tel' },
      { name: 'dateOfBirth', label: 'Date of birth', placeholder: 'DD / MM / YYYY', type: 'date' },
      { name: 'postcode', label: 'Postcode', placeholder: 'M1 4BT', type: 'postcode' },
    ],
  };
}

function instant(): Scenario {
  const steps: ScenarioStep[] = [
    signUp(),
    {
      kind: 'processing',
      stage: 'Checks',
      title: 'Checking your details',
      moduleRuns: [
        { label: 'Age Verification', state: 'Pass' },
        { label: 'Data Verification', state: 'Pass' },
        { label: 'IP Geolocation', state: 'Pass' },
        { label: 'GBG Trust', state: 'Running' },
      ],
    },
    {
      kind: 'choice',
      stage: 'Limits',
      title: 'Set your deposit limit',
      body: 'Pick a weekly cap before you play. Lowering it takes effect at once; raising it takes 24 hours.',
      options: [
        { value: '50', label: '£50 a week', detail: 'Our most common choice', icon: 'ph-shield-check' },
        { value: '250', label: '£250 a week', detail: 'Change it any time in Account', icon: 'ph-sliders-horizontal' },
        { value: 'none', label: 'No limit for now', detail: 'We still monitor play and will check in with you', icon: 'ph-warning' },
      ],
    },
    {
      kind: 'result',
      stage: 'Decision',
      title: 'You are in',
      decision: 'pass',
      timing: 'Verified in 1.8 seconds',
      body: 'No documents needed. Your deposit limit is set and you can play now.',
      cta: 'Start playing',
      moduleRuns: [
        { label: 'Age Verification', state: 'Pass', ms: '0.3s' },
        { label: 'Data Verification', state: 'Pass', ms: '0.7s' },
        { label: 'IP Geolocation', state: 'Pass', ms: '0.2s' },
        { label: 'GBG Trust', state: 'Pass', ms: '0.6s' },
        { label: 'Document Authentication', state: 'Skipped' },
      ],
      recordNote:
        'Your checks are logged for our licence conditions. Safer gambling tools and your limit history are in Account.',
      summary: [
        { k: 'Journey', v: 'GB player onboarding · v8' },
        { k: 'Player reference', v: 'RP-4471902' },
        { k: 'Verified', v: '26 Aug 2026 21:12:01' },
        { k: 'Total time', v: '1.8 seconds' },
        { k: 'Modules run', v: '4 of 4' },
        { k: 'Age check', v: '18+ confirmed from data' },
        { k: 'Documents needed', v: 'None' },
        { k: 'Jurisdiction', v: 'Great Britain — licensed' },
        { k: 'Deposit limit', v: '£250 a week' },
      ],
    },
  ];
  return { id: 'instant', label: 'Instant pass', steps };
}

function stepup(): Scenario {
  const steps: ScenarioStep[] = [
    signUp(),
    {
      kind: 'processing',
      stage: 'Checks',
      title: 'Checking your details',
      moduleRuns: [
        { label: 'Age Verification', state: 'Pass' },
        { label: 'Data Verification', state: 'Review' },
        { label: 'IP Geolocation', state: 'Pass' },
        { label: 'GBG Trust', state: 'Pass' },
      ],
    },
    {
      kind: 'intro',
      stage: 'Step-up',
      title: 'One quick check',
      body: 'We could not confirm your age from data alone, so we need to see a document. About forty seconds.',
      note: 'This happens to roughly one player in eight, usually because they have recently moved.',
      cta: 'Scan my ID',
    },
    {
      kind: 'capture',
      captureType: 'document',
      stage: 'Document',
      title: 'Scan your photo ID',
      body: 'Passport or driving licence. Fill the frame and hold steady.',
      accepted: ['Passport', 'Driving licence'],
      cta: 'Scan document',
      modules: ['Document Classification', 'Document Authentication', 'Document Extraction'],
    },
    {
      kind: 'capture',
      captureType: 'selfie',
      stage: 'Biometrics',
      title: 'Take a selfie',
      body: 'Last step. We check you match your document.',
      cta: 'Take selfie',
      modules: ['Liveness Verification', 'Facematch Verification'],
    },
    {
      kind: 'result',
      stage: 'Decision',
      title: 'You are in',
      decision: 'pass',
      timing: 'Verified in 54 seconds',
      body: 'Set a deposit limit before your first game. You can change it any time in Account.',
      cta: 'Set a deposit limit',
      moduleRuns: [
        { label: 'Age Verification', state: 'Pass', ms: '0.3s' },
        { label: 'Data Verification', state: 'Review', ms: '0.8s' },
        { label: 'Document Authentication', state: 'Pass', ms: '2.2s' },
        { label: 'Facematch Verification', state: 'Pass', ms: '1.4s' },
      ],
      recordNote: 'You will not be asked for a document again unless your details change.',
      summary: [
        { k: 'Journey', v: 'GB player onboarding · v8' },
        { k: 'Player reference', v: 'RP-4471938' },
        { k: 'Verified', v: '26 Aug 2026 21:44:30' },
        { k: 'Total time', v: '54 seconds' },
        { k: 'Modules run', v: '9 of 9' },
        { k: 'Why we stepped up', v: 'Address on file under 6 months old' },
        { k: 'Document', v: 'UK driving licence' },
        { k: 'Jurisdiction', v: 'Great Britain — licensed' },
        { k: 'Outcome', v: 'Verified — no further checks' },
      ],
    },
  ];
  return { id: 'stepup', label: 'Step-up to document', steps };
}

function blocked(): Scenario {
  const steps: ScenarioStep[] = [
    signUp(),
    {
      kind: 'processing',
      stage: 'Checks',
      title: 'Checking your details',
      moduleRuns: [
        { label: 'Age Verification', state: 'Pass' },
        { label: 'IP Geolocation', state: 'Fail' },
        { label: 'Data Verification', state: 'Skipped' },
        { label: 'GBG Trust', state: 'Skipped' },
      ],
    },
    {
      kind: 'result',
      stage: 'Decision',
      title: 'We cannot open an account',
      decision: 'fail',
      timing: 'Declined in 1.2 seconds',
      body: 'Ridgeline Play is licensed in Great Britain only, and your connection appears to be outside that area. If you are travelling, try again when you are back.',
      cta: 'Read our licence terms',
      moduleRuns: [
        { label: 'IP Geolocation', state: 'Fail', ms: '0.2s' },
        { label: 'Age Verification', state: 'Pass', ms: '0.3s' },
        { label: 'Data Verification', state: 'Skipped' },
      ],
      recordNote: 'No account was created and no identity documents were collected. Ask us to delete the attempt log at any time.',
      summary: [
        { k: 'Journey', v: 'GB player onboarding · v8' },
        { k: 'Attempt reference', v: 'RP-4471955' },
        { k: 'Declined', v: '26 Aug 2026 22:03:09' },
        { k: 'Total time', v: '1.2 seconds' },
        { k: 'Modules run', v: '2 of 4' },
        { k: 'Declined by', v: 'IP Geolocation — outside licensed area' },
        { k: 'Age check', v: '18+ confirmed' },
        { k: 'Data retained', v: 'Email and attempt log only' },
      ],
    },
  ];
  return { id: 'blocked', label: 'Blocked — jurisdiction', steps };
}

export function buildRidgelinePlayFixtures(): MarketFixtures {
  return {
    defaultScenarioId: 'instant',
    scenarios: {
      instant: instant(),
      stepup: stepup(),
      blocked: blocked(),
    },
  };
}
