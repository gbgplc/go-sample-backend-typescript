import { MarketFixtures, Scenario, ScenarioStep } from '../types';

/** Healthcare — patient record access. Ported verbatim from MeridianHealthFixtures.java. */

/**
 * Shared content for every scenario; only the "Someone I care for" branch
 * target changes, so a scenario reached directly via ?mock_scenario= (rather
 * than by picking through the choice) doesn't get bounced back to a sibling
 * scenario if the choice screen is re-answered — mockGoClient only switches
 * scenario when the option's branchTo differs from the session's current one.
 */
function prefix(carerBranch: string): ScenarioStep[] {
  return [
    {
      kind: 'intro',
      stage: 'Start',
      title: 'Verify your identity to see your health record',
      body: 'Meridian confirms who you are before showing your record. About three minutes.',
      note: 'You can also bring ID to reception and verify in person.',
      cta: 'Start',
    },
    {
      kind: 'choice',
      stage: 'Who',
      title: 'Who are you registering?',
      body: 'Both routes ask for the same identity checks. Acting for someone else adds one document.',
      options: [
        { value: 'self', label: 'Myself', detail: 'You are the patient', icon: 'ph-user', branchTo: 'self' },
        {
          value: 'carer',
          label: 'Someone I care for',
          detail: 'You hold parental responsibility or a lasting power of attorney',
          icon: 'ph-users-three',
          branchTo: carerBranch,
        },
      ],
    },
  ];
}

function self(): Scenario {
  const steps: ScenarioStep[] = [
    ...prefix('carer'),
    {
      kind: 'form',
      stage: 'Details',
      title: 'Your details',
      body: 'We match these against national records to find your patient file.',
      cta: 'Continue',
      modules: ['Data Verification'],
      fields: [
        { name: 'fullName', label: 'Full name', placeholder: 'Priya Raman' },
        { name: 'dateOfBirth', label: 'Date of birth', placeholder: 'DD / MM / YYYY', type: 'date' },
        { name: 'postcode', label: 'Postcode', placeholder: 'SE1 7TP', type: 'postcode' },
        {
          name: 'nhsNumber',
          label: 'NHS number',
          placeholder: '000 000 0000',
          helperText: 'Optional. Ten digits, on your medical card.',
        },
      ],
    },
    {
      kind: 'choice',
      stage: 'Route',
      title: 'How would you like to verify?',
      body: 'A digital ID you already hold is quickest. Scanning a document works if you have none.',
      modules: ['Digital Identity Insights'],
      options: [
        {
          value: 'digital',
          label: 'Use a digital ID',
          detail: 'Post Office EasyID, Yoti, or a bank ID you already hold',
          icon: 'ph-identification-badge',
        },
        {
          value: 'document',
          label: 'Scan a photo ID',
          detail: 'Passport, driving licence or biometric residence permit',
          icon: 'ph-scan',
        },
      ],
    },
    {
      kind: 'capture',
      captureType: 'document',
      stage: 'Document',
      title: 'Scan your photo ID',
      body: 'We check the document is genuine and read the details from it.',
      accepted: ['Passport', 'Driving licence', 'Biometric residence permit'],
      cta: 'Scan document',
      modules: ['Document Authentication', 'Document Extraction'],
    },
    {
      kind: 'capture',
      captureType: 'selfie',
      stage: 'Biometrics',
      title: 'Take a selfie',
      body: 'This proves you are the person in the document, so nobody else can open your record.',
      cta: 'Take selfie',
      modules: ['Liveness Verification', 'Facematch Verification'],
    },
    {
      kind: 'consent',
      stage: 'Consent',
      title: 'Share your record with Meridian Health',
      body: 'You decide what each group can see. You can change any of this later in settings.',
      cta: 'Agree and continue',
      checks: [
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
        },
        {
          name: 'useForResearch',
          label: 'Use my data for research',
          detail: 'Anonymised, optional, and unrelated to your care',
        },
      ],
    },
    {
      kind: 'result',
      stage: 'Decision',
      title: 'Record linked',
      decision: 'pass',
      timing: 'Verified in 9 seconds',
      body: 'You can now see appointments, test results and prescriptions in your Meridian account.',
      cta: 'Open my record',
      moduleRuns: [
        { label: 'Data Verification', state: 'Pass', ms: '1.1s' },
        { label: 'Document Authentication', state: 'Pass', ms: '2.4s' },
        { label: 'Facematch Verification', state: 'Pass', ms: '1.3s' },
        { label: 'Liveness Verification', state: 'Pass', ms: '2.9s' },
      ],
      recordNote:
        'Your identity evidence is held separately from your medical record. Ask the practice for a copy, or to delete it once registration is complete.',
      summary: [
        { k: 'Journey', v: 'Patient record access · v3' },
        { k: 'Reference', v: 'MH-VER-77341' },
        { k: 'Verified', v: '26 Aug 2026 08:17:44' },
        { k: 'Total time', v: '9.2 seconds' },
        { k: 'Modules run', v: '6 of 6' },
        { k: 'Identity route', v: 'Photo ID and selfie' },
        { k: 'Record matched', v: '1 patient file' },
        { k: 'Consent given', v: 'Clinicians and named pharmacy' },
        { k: 'Assurance level', v: 'Medium — meets practice policy' },
      ],
    },
  ];
  return { id: 'self', label: 'Patient — verified in app', steps };
}

/** Shared up to and including the authority-document upload — 'carer' and 'carer-denied' only differ in how the clinician's review resolves. */
function carerPrefix(carerBranch: string): ScenarioStep[] {
  return [
    ...prefix(carerBranch),
    {
      kind: 'form',
      stage: 'Patient',
      title: 'Who are you acting for?',
      body: 'We find their record first, then verify you.',
      cta: 'Continue',
      modules: ['Data Verification'],
      fields: [
        { name: 'patientFullName', label: "Patient's full name", placeholder: 'Margaret Ellis' },
        { name: 'patientDateOfBirth', label: "Patient's date of birth", placeholder: 'DD / MM / YYYY', type: 'date' },
        { name: 'patientPostcode', label: "Patient's postcode", placeholder: 'SE1 7TP', type: 'postcode' },
        { name: 'relationship', label: 'Your relationship to them', placeholder: 'Attorney, parent, guardian' },
      ],
    },
    {
      kind: 'form',
      stage: 'Details',
      title: 'Your details',
      body: 'Now the identity checks for you, the carer.',
      cta: 'Continue',
      modules: ['Data Verification'],
      fields: [
        { name: 'fullName', label: 'Full name', placeholder: 'Daniel Ellis' },
        { name: 'dateOfBirth', label: 'Date of birth', placeholder: 'DD / MM / YYYY', type: 'date' },
        { name: 'homeAddress', label: 'Home address', placeholder: 'Start typing your postcode' },
        { name: 'mobileNumber', label: 'Mobile number', placeholder: '+44', type: 'tel' },
      ],
    },
    {
      kind: 'capture',
      captureType: 'document',
      stage: 'Document',
      title: 'Scan your photo ID',
      body: 'We check the document is genuine and read the details from it.',
      accepted: ['Passport', 'Driving licence', 'Biometric residence permit'],
      cta: 'Scan document',
      modules: ['Document Authentication', 'Document Extraction'],
    },
    {
      kind: 'capture',
      captureType: 'selfie',
      stage: 'Biometrics',
      title: 'Take a selfie',
      body: 'This proves you are the person in the document.',
      cta: 'Take selfie',
      modules: ['Liveness Verification', 'Facematch Verification'],
    },
    {
      kind: 'upload',
      stage: 'Authority',
      title: 'Proof you can act for Margaret Ellis',
      body: 'A clinician reviews this before the record is shared. It is the one step we cannot automate.',
      accepted: ['Lasting power of attorney', 'Court order', 'Clinic authorisation letter'],
      cta: 'Submit',
      modules: ['Document Attachments'],
    },
  ];
}

function carer(): Scenario {
  const steps: ScenarioStep[] = [
    ...carerPrefix('carer'),
    {
      kind: 'result',
      stage: 'Decision',
      title: 'With the practice team',
      decision: 'refer',
      timing: 'Usually within one working day',
      body: 'Your identity is verified. A clinician is checking your authority to act for Margaret, and we will email you when it is approved.',
      cta: 'Done',
      moduleRuns: [
        { label: 'Data Verification', state: 'Pass', ms: '1.0s' },
        { label: 'Facematch Verification', state: 'Pass', ms: '1.3s' },
        { label: 'Document Attachments', state: 'Review' },
      ],
      recordNote: "Nothing from Margaret's record is shared until a clinician approves your authority.",
      summary: [
        { k: 'Journey', v: 'Patient record access · v3' },
        { k: 'Reference', v: 'MH-VER-77358' },
        { k: 'Acting for', v: 'Margaret Ellis · b. 1948' },
        { k: 'Your identity', v: 'Verified in 8.6 seconds' },
        { k: 'Modules run', v: '6 of 6' },
        { k: 'Authority document', v: 'Lasting power of attorney' },
        { k: 'Awaiting', v: 'Clinician review of authority' },
        { k: 'Outcome so far', v: 'Identity verified, access pending' },
      ],
    },
  ];
  return { id: 'carer', label: 'Carer acting for a patient', steps };
}

/**
 * Terminal state once a clinician denies the authority-to-act review (Manual
 * Review module, the Deny outcome) — distinct from 'carer' above, which just
 * means the review is still open.
 */
function carerDenied(): Scenario {
  const steps: ScenarioStep[] = [
    ...carerPrefix('carer-denied'),
    {
      kind: 'result',
      stage: 'Decision',
      title: 'We could not verify your authority',
      decision: 'fail',
      timing: 'Decision reached after review',
      body: "A clinician reviewed the document you provided and could not confirm you're authorised to act for Margaret Ellis. Nothing from her record has been shared. Contact the practice with updated documentation if you believe this is wrong.",
      cta: 'Contact the practice',
      moduleRuns: [
        { label: 'Data Verification', state: 'Pass', ms: '1.0s' },
        { label: 'Facematch Verification', state: 'Pass', ms: '1.3s' },
        { label: 'Document Attachments', state: 'Fail' },
      ],
      recordNote: 'Your own identity remains verified. You can submit a new authority document at any time.',
      summary: [
        { k: 'Journey', v: 'Patient record access · v3' },
        { k: 'Reference', v: 'MH-VER-77372' },
        { k: 'Acting for', v: 'Margaret Ellis · b. 1948' },
        { k: 'Your identity', v: 'Verified in 8.4 seconds' },
        { k: 'Modules run', v: '6 of 6' },
        { k: 'Authority document', v: 'Lasting power of attorney — not accepted' },
        { k: 'Reviewed by', v: 'Clinician' },
        { k: 'Outcome', v: 'Access denied — authority not confirmed' },
      ],
    },
  ];
  return { id: 'carer-denied', label: 'Carer — authority denied on review', steps };
}

export function buildMeridianHealthFixtures(): MarketFixtures {
  return {
    defaultScenarioId: 'self',
    scenarios: {
      self: self(),
      carer: carer(),
      'carer-denied': carerDenied(),
    },
  };
}
