import { ModuleRun, ModuleState } from '../../../dto/types';
import { MarketFixtures, Scenario, ScenarioStep } from '../types';

/** Banking — current account opening. Ported verbatim from NorthbankFixtures.java. */

function prefix(): ScenarioStep[] {
  return [
    {
      kind: 'intro',
      stage: 'Start',
      title: 'Open your Northbank current account',
      body: 'Four steps, about four minutes. You will need photo ID and three years of address history.',
      note: 'Northbank checks your identity with GBG. Your document images are not kept on this device.',
      cta: 'Get started',
    },
    {
      kind: 'form',
      stage: 'Details',
      eyebrow: 'Step 1 of 4',
      title: 'Your details',
      body: 'We check these against trusted consumer and government data sources. No credit footprint.',
      cta: 'Continue',
      modules: ['Data Verification'],
      fields: [
        { name: 'fullName', label: 'Full name', placeholder: 'Amara Osei' },
        { name: 'dateOfBirth', label: 'Date of birth', placeholder: 'DD / MM / YYYY', type: 'date' },
        {
          name: 'homeAddress',
          label: 'Home address',
          placeholder: 'Start typing your postcode',
          helperText: 'We will ask for earlier addresses next',
        },
        { name: 'mobileNumber', label: 'Mobile number', placeholder: '+44', type: 'tel' },
      ],
    },
    {
      kind: 'capture',
      captureType: 'document',
      stage: 'Document',
      eyebrow: 'Step 2 of 4',
      title: 'Scan your photo ID',
      body: 'Hold the document flat and fill the frame. Where your document has a chip, we read it for a stronger result.',
      accepted: ['Passport', 'UK driving licence', 'National ID card'],
      cta: 'Scan document',
      secondaryCta: 'Use a digital ID instead',
      modules: ['Document Classification', 'Document Authentication', 'Document Extraction', 'NFC Chip Authentication'],
    },
    {
      kind: 'capture',
      captureType: 'selfie',
      stage: 'Biometrics',
      eyebrow: 'Step 3 of 4',
      title: 'Take a selfie',
      body: 'We confirm a real person is present, then compare your face with the photo on your document.',
      cta: 'Take selfie',
      modules: ['Liveness Verification', 'Facematch Verification'],
    },
  ];
}

function bankRuns(dataVerificationState: ModuleState): ModuleRun[] {
  return [
    { label: 'Data Verification', state: dataVerificationState, ms: '0.9s' },
    { label: 'Document Authentication', state: 'Pass', ms: '2.1s' },
    { label: 'Facematch Verification', state: 'Pass', ms: '1.4s' },
    { label: 'PEPs and Sanctions', state: 'Pass', ms: '1.2s' },
    { label: 'Financial Screening', state: 'Pass', ms: '0.8s' },
  ];
}

function straightThrough(): Scenario {
  const steps = [
    ...prefix(),
    {
      kind: 'processing' as const,
      stage: 'Screening',
      eyebrow: 'Step 4 of 4',
      title: 'Running your checks',
      body: 'This usually takes a few seconds.',
      modules: ['PEPs and Sanctions', 'Financial Screening', 'GBG Trust'],
      moduleRuns: [
        { label: 'Data Verification', state: 'Pass' as ModuleState },
        { label: 'Document Authentication', state: 'Pass' as ModuleState },
        { label: 'PEPs and Sanctions', state: 'Running' as ModuleState },
        { label: 'Financial Screening', state: 'Running' as ModuleState },
      ],
    },
    {
      kind: 'result' as const,
      stage: 'Decision',
      title: 'Account opened',
      decision: 'pass' as const,
      timing: 'Decision reached in 6 seconds',
      body: 'Your account number and sort code are in the Northbank app. Your card arrives within five working days.',
      moduleRuns: bankRuns('Pass'),
      cta: 'Go to my account',
      recordNote:
        'Download your verification record as a PDF, or ask us for it later. We keep it for six years under our AML duties.',
      summary: [
        { k: 'Journey', v: 'UK retail account opening · v12' },
        { k: 'Reference', v: 'NB-2026-004182' },
        { k: 'Started', v: '26 Aug 2026 09:41:02' },
        { k: 'Decision reached', v: '26 Aug 2026 09:41:08' },
        { k: 'Total time', v: '6.4 seconds' },
        { k: 'Modules run', v: '10 of 10' },
        { k: 'Document', v: 'UK passport · chip read' },
        { k: 'Data sources matched', v: '3 of 3' },
        { k: 'Outcome', v: 'Approved — no manual review' },
      ],
    },
  ];
  return { id: 'straight', label: 'Straight-through', steps };
}

/** Shared up to and including the proof-of-address upload — 'refer' and 'denied' only differ in how the manual review resolves. */
function referPrefix(): ScenarioStep[] {
  return [
    ...prefix(),
    {
      kind: 'processing',
      stage: 'Screening',
      eyebrow: 'Step 4 of 4',
      title: 'Running your checks',
      body: 'This usually takes a few seconds.',
      modules: ['PEPs and Sanctions', 'Financial Screening', 'GBG Trust'],
      moduleRuns: [
        { label: 'Data Verification', state: 'Review' },
        { label: 'Document Authentication', state: 'Pass' },
        { label: 'PEPs and Sanctions', state: 'Pass' },
        { label: 'Financial Screening', state: 'Running' },
      ],
    },
    {
      kind: 'result',
      stage: 'Decision',
      title: 'We need one more document',
      decision: 'refer',
      timing: 'Referred after 6 seconds',
      body: 'Your address did not match our data sources. Add a bank statement or utility bill dated in the last three months.',
      moduleRuns: bankRuns('Review'),
      cta: 'Add a document',
    },
    {
      kind: 'upload',
      stage: 'Proof of address',
      title: 'Proof of address',
      body: 'We read the name and address from your document and compare them with what you told us.',
      accepted: ['Bank statement — last 3 months', 'Utility bill', 'Council tax letter'],
      cta: 'Submit',
      modules: ['Proof of Address Extraction', 'Document Attachments'],
    },
  ];
}

function referral(): Scenario {
  const steps = [
    ...referPrefix(),
    {
      kind: 'result' as const,
      stage: 'Decision',
      title: 'With our team',
      decision: 'refer' as const,
      timing: 'Most reviews close within two hours',
      body: 'An analyst is checking your document. We will email a.osei@example.com as soon as it is done.',
      moduleRuns: [
        { label: 'Proof of Address Extraction', state: 'Pass' as ModuleState, ms: '1.6s' },
        { label: 'Manual review', state: 'Running' as ModuleState },
      ],
      cta: 'Done',
      recordNote: 'You can add another document while the review is open. We will email you either way.',
      summary: [
        { k: 'Journey', v: 'UK retail account opening · v12' },
        { k: 'Reference', v: 'NB-2026-004219' },
        { k: 'Started', v: '26 Aug 2026 14:02:11' },
        { k: 'Referred', v: '26 Aug 2026 14:02:17' },
        { k: 'Time to referral', v: '6.1 seconds' },
        { k: 'Modules run', v: '11 of 12' },
        { k: 'Referred by', v: 'Data Verification — address not matched' },
        { k: 'Evidence added', v: '1 document · proof of address' },
        { k: 'With', v: 'Northbank onboarding team' },
      ],
    },
  ];
  return { id: 'refer', label: 'Referred — address mismatch', steps };
}

/**
 * Terminal state once a reviewer denies the referral (Manual Review module,
 * the Deny outcome) — distinct from 'refer' above, which just means the
 * review is still open.
 */
function denied(): Scenario {
  const steps = [
    ...referPrefix(),
    {
      kind: 'result' as const,
      stage: 'Decision',
      title: 'We could not open your account',
      decision: 'fail' as const,
      timing: 'Decision reached after review',
      body: 'After reviewing your documents, we are unable to open a Northbank account for you at this time. This does not affect your credit score. If you think this is a mistake, call us on 0800 000 000.',
      moduleRuns: [
        { label: 'Proof of Address Extraction', state: 'Pass' as ModuleState, ms: '1.6s' },
        { label: 'Manual review', state: 'Fail' as ModuleState },
      ],
      cta: 'Contact us',
      recordNote:
        'You can ask for a copy of this decision, or find out how to appeal it. We keep a record of this application for our regulatory duties.',
      summary: [
        { k: 'Journey', v: 'UK retail account opening · v12' },
        { k: 'Reference', v: 'NB-2026-004233' },
        { k: 'Started', v: '27 Aug 2026 10:15:40' },
        { k: 'Referred', v: '27 Aug 2026 10:15:46' },
        { k: 'Reviewed', v: '27 Aug 2026 15:02:11' },
        { k: 'Modules run', v: '12 of 12' },
        { k: 'Declined by', v: 'Manual review — proof of address not accepted' },
        { k: 'Evidence added', v: '1 document · proof of address' },
        { k: 'With', v: 'Northbank onboarding team' },
        { k: 'Outcome', v: 'Declined after manual review' },
      ],
    },
  ];
  return { id: 'denied', label: 'Referred — denied on review', steps };
}

export function buildNorthbankFixtures(): MarketFixtures {
  return {
    defaultScenarioId: 'straight',
    scenarios: {
      straight: straightThrough(),
      refer: referral(),
      denied: denied(),
    },
  };
}
