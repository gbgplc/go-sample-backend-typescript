import type {
  SubmitInteractionBiometric4,
  SubmitInteractionConsent,
  SubmitInteractionDocument,
  SubmitInteractionIdentity,
  SubmitInteractionIdentityCurrentAddress,
  SubmitInteractionRequest,
  SubmitInteractionSubject,
} from '@gbg/go-core/models/operations';

/**
 * Maps the front end's flat, field-name-keyed submission onto the SDK's typed
 * `SubmitInteractionRequest`: `participants` names which domain elements this
 * call covers (id only); the values travel in `context.subject`.
 *
 * The field table is the one go-sample-backend-java's sdk-implementation
 * proved live against all three journeys. It is wider than
 * api-implementation's `buildSubmitRequest.ts` (gender, mother's maiden name,
 * NI number, emails, landline, previous address) because that version can
 * fall back to a flat `subject.<key>` placement for anything unmapped and the
 * SDK cannot: `SubmitInteractionSubject` and everything under it are typed
 * zod objects that silently strip unknown keys. So an unmapped key is logged
 * and dropped — and left out of `participants` too, since naming an element
 * Go then receives no data for makes it reject the submit.
 *
 * Same caveat as the original: a sample mapping invented before any journey
 * existed. A real deployment replaces it with the published journey's schema.
 */

const CONSENT_KEYS = ['shareWithClinicians', 'sharePrescriptions', 'useForResearch'];

type AddressComponent = keyof Pick<
  SubmitInteractionIdentityCurrentAddress,
  | 'premise'
  | 'subBuilding'
  | 'building'
  | 'thoroughfare'
  | 'dependentThoroughfare'
  | 'locality'
  | 'dependentLocality'
  | 'postalCode'
  | 'country'
  | 'addressString'
>;

type Target =
  | { kind: 'firstName' }
  | { kind: 'lastNames' }
  | { kind: 'dateOfBirth' }
  | { kind: 'gender' }
  | { kind: 'mothersMaidenName' }
  | { kind: 'address'; component: AddressComponent }
  | { kind: 'phone'; type: 'mobile' | 'landline' }
  | { kind: 'email'; type: 'personal' | 'work' }
  | { kind: 'idNumber'; type: 'NationalInsuranceNumber' | 'SSN' }
  | { kind: 'previousAddress' }
  | { kind: 'documentSide1' }
  | { kind: 'documentSide2' }
  | { kind: 'selfie' };

interface FieldMapping {
  domainElementId: string;
  target: Target;
}

const address = (component: AddressComponent): FieldMapping => ({
  domainElementId: 'CurrentAddress',
  target: { kind: 'address', component },
});

const KNOWN: Record<string, FieldMapping> = {
  fullName: { domainElementId: 'FullName', target: { kind: 'firstName' } },
  firstName: { domainElementId: 'FullName', target: { kind: 'firstName' } },
  lastNames: { domainElementId: 'FullName', target: { kind: 'lastNames' } },
  dateOfBirth: { domainElementId: 'DateOfBirth', target: { kind: 'dateOfBirth' } },

  premise: address('premise'),
  subBuilding: address('subBuilding'),
  building: address('building'),
  thoroughfare: address('thoroughfare'),
  dependentThoroughfare: address('dependentThoroughfare'),
  locality: address('locality'),
  dependentLocality: address('dependentLocality'),
  postcode: address('postalCode'),
  postalCode: address('postalCode'),
  country: address('country'),
  addressString: address('addressString'),

  mobileNumber: { domainElementId: 'MobilePhone', target: { kind: 'phone', type: 'mobile' } },
  'MobilePhone/number': { domainElementId: 'MobilePhone', target: { kind: 'phone', type: 'mobile' } },
  'LandlinePhone/number': { domainElementId: 'LandlinePhone', target: { kind: 'phone', type: 'landline' } },
  'PersonalEmail/email': { domainElementId: 'PersonalEmail', target: { kind: 'email', type: 'personal' } },
  'WorkEmail/email': { domainElementId: 'WorkEmail', target: { kind: 'email', type: 'work' } },
  MothersMaidenName: { domainElementId: 'MothersMaidenName', target: { kind: 'mothersMaidenName' } },
  Gender: { domainElementId: 'Gender', target: { kind: 'gender' } },
  NationalInsuranceNumber: {
    domainElementId: 'NationalInsuranceNumber',
    target: { kind: 'idNumber', type: 'NationalInsuranceNumber' },
  },
  SSN: { domainElementId: 'SSN', target: { kind: 'idNumber', type: 'SSN' } },
  PreviousAddresses: { domainElementId: 'PreviousAddresses', target: { kind: 'previousAddress' } },

  documentImage: { domainElementId: 'PrimaryDocument', target: { kind: 'documentSide1' } },
  documentBack: { domainElementId: 'PrimaryDocument', target: { kind: 'documentSide2' } },
  selfieImage: { domainElementId: 'Selfie', target: { kind: 'selfie' } },
};

/** The mapping for one submitted field: the key as sent, then its leaf after the last `/`. */
function forKey(key: string): FieldMapping | undefined {
  const known = KNOWN[key];
  if (known) return known;
  if (key.includes('/')) return KNOWN[key.slice(key.lastIndexOf('/') + 1)];
  return undefined;
}

/**
 * A country as Go will accept it: /^[A-Z]{2,3}$/. An already-valid code
 * passes through upper-cased; a name this short table does not know is sent
 * as typed so Go's own error stands rather than a guess.
 */
const COUNTRY_CODES: Record<string, string> = {
  'UNITED KINGDOM': 'GBR',
  'GREAT BRITAIN': 'GBR',
  ENGLAND: 'GBR',
  SCOTLAND: 'GBR',
  WALES: 'GBR',
  'NORTHERN IRELAND': 'GBR',
  UK: 'GBR',
  IRELAND: 'IRL',
  'UNITED STATES': 'USA',
  'UNITED STATES OF AMERICA': 'USA',
  USA: 'USA',
};

export function countryCode(typed: string): string {
  const trimmed = typed.trim();
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2,3}$/.test(upper)) return upper;
  return COUNTRY_CODES[upper] ?? trimmed;
}

/**
 * The consent screen posts one boolean per checkbox; Consent Collection takes
 * a single consent record whose only required member is a URL Go stores so
 * the exact terms consented to can be retrieved later.
 */
function consentRecord(data: Record<string, unknown>, consentUrl: string, consentTerms: string): SubmitInteractionConsent {
  return {
    type: 'explicit',
    url: consentUrl,
    terms: consentTerms,
    effectiveDate: new Date().toISOString(),
    purpose: CONSENT_KEYS.filter((k) => data[k] === true).join(','),
  };
}

interface Accumulator {
  identity: SubmitInteractionIdentity;
  currentAddress: SubmitInteractionIdentityCurrentAddress;
  documents: SubmitInteractionDocument[];
  biometrics: SubmitInteractionBiometric4[];
}

const ID = 'context.subject.identity.';

/**
 * Places `text` and returns the path Go names it by in a validation error
 * (e.g. `context.subject.identity.emails.0.email`), so a 400/422 can be
 * reported against the field the customer typed into.
 */
function place(acc: Accumulator, target: Target, text: string): string {
  const { identity } = acc;
  switch (target.kind) {
    case 'firstName':
      identity.firstName = text;
      return `${ID}firstName`;
    case 'lastNames':
      identity.lastNames = [text];
      return `${ID}lastNames.0`;
    case 'dateOfBirth':
      identity.dateOfBirth = text;
      return `${ID}dateOfBirth`;
    case 'gender':
      identity.gender = text;
      return `${ID}gender`;
    case 'mothersMaidenName':
      identity.mothersMaidenName = text;
      return `${ID}mothersMaidenName`;
    case 'address':
      acc.currentAddress[target.component] = target.component === 'country' ? countryCode(text) : text;
      return `${ID}currentAddress.${target.component}`;
    case 'phone':
      (identity.phones ??= []).push({ type: target.type, number: text });
      return `${ID}phones.${identity.phones.length - 1}.number`;
    case 'email':
      (identity.emails ??= []).push({ type: target.type, email: text });
      return `${ID}emails.${identity.emails.length - 1}.email`;
    case 'idNumber':
      (identity.idNumbers ??= []).push({ type: target.type, idNumber: text });
      return `${ID}idNumbers.${identity.idNumbers.length - 1}.idNumber`;
    case 'previousAddress':
      (identity.previousAddresses ??= []).push({ addressString: text });
      return `${ID}previousAddresses.${identity.previousAddresses.length - 1}.addressString`;
    // Both sides of one document belong to a single documents[] entry, and
    // `type` is required by the SDK. An absent side is omitted, never sent
    // empty — Go rejects a supplied empty image.
    case 'documentSide1':
    case 'documentSide2': {
      const document = acc.documents[0] ?? (acc.documents[0] = { type: 'Primary' });
      const side = target.kind === 'documentSide1' ? 'side1Image' : 'side2Image';
      document[side] = text;
      return `context.subject.documents.0.${side}`;
    }
    // `type: 'Selfie'` alongside the image: without it Go accepts the submit
    // but leaves Selfie/selfieImage outstanding.
    case 'selfie':
      acc.biometrics.push({ type: 'Selfie', selfieImage: text });
      return `context.subject.biometrics.${acc.biometrics.length - 1}.selfieImage`;
  }
}

export interface BuiltSubmit {
  request: SubmitInteractionRequest;
  /** Go path → submitted field name, for turning Go's validation problems into per-field errors. */
  fieldsByGoPath: Record<string, string>;
}

export function buildSdkSubmitRequest(
  instanceId: string,
  interactionId: string,
  data: Record<string, unknown> | undefined,
  consentUrl: string,
  consentTerms: string
): BuiltSubmit {
  const fieldsByGoPath: Record<string, string> = {};
  if (!data || Object.keys(data).length === 0) {
    return { request: { instanceId, interactionId, participants: [], context: { subject: {} } }, fieldsByGoPath };
  }

  // A domain element is named once no matter how many fields feed it.
  const participants: { domainElementId: string }[] = [];
  const seen = new Set<string>();
  const addParticipant = (domainElementId: string): void => {
    if (seen.has(domainElementId)) return;
    seen.add(domainElementId);
    participants.push({ domainElementId });
  };

  const acc: Accumulator = { identity: {}, currentAddress: {}, documents: [], biometrics: [] };
  const subject: SubmitInteractionSubject = {};

  if (Object.keys(data).some((k) => CONSENT_KEYS.includes(k))) {
    addParticipant('Consent');
    subject.consent = [consentRecord(data, consentUrl, consentTerms)];
  }

  for (const [key, value] of Object.entries(data)) {
    // A null would otherwise go out as the string "null" (Go 400), and a
    // dropped key still named as a participant makes Go expect data it
    // never receives.
    if (CONSENT_KEYS.includes(key) || value === null || value === undefined) continue;
    const mapping = forKey(key);
    if (!mapping) {
      console.warn(`No SDK submit mapping for field '${key}'; dropped (the SDK's subject has no untyped escape hatch)`);
      continue;
    }
    addParticipant(mapping.domainElementId);
    fieldsByGoPath[place(acc, mapping.target, String(value))] = key;
  }

  if (Object.keys(acc.currentAddress).length > 0) acc.identity.currentAddress = acc.currentAddress;
  if (Object.keys(acc.identity).length > 0) subject.identity = acc.identity;
  if (acc.documents.length > 0) subject.documents = acc.documents;
  if (acc.biometrics.length > 0) subject.biometrics = acc.biometrics;

  return { request: { instanceId, interactionId, participants, context: { subject } }, fieldsByGoPath };
}

/** Top-level keys of the SDK's `StartJourneySubject`; any other prefill key is stripped by the SDK. */
export const START_SUBJECT_KEYS = [
  'identity',
  'entities',
  'documents',
  'biometrics',
  'sessions',
  'consent',
  'accounts',
  'kba',
  'uid',
];
