import { GoInteractionSubmitRequest } from './dto';

/**
 * Maps the front end's flat, field-name-keyed submission onto Go's two-part
 * shape: `participants` is a manifest naming which domain elements this call
 * covers (id-only, no values); the values themselves travel in
 * `context.subject`, nested along the journey's schema paths. Sending values
 * inside `participants`, or omitting `context`, is rejected however the
 * field names are spelled.
 *
 * The table below is this sample's own front-end field names, invented
 * before any journey existed — deliberately narrow, ported verbatim from
 * Java's GoInteractionSubmitRequest. A real deployment must replace it with
 * the published journey's schema (Dashboard → journey → Actions → View
 * schema). An unmapped key falls back to the key itself as the domain
 * element id and a flat subject.<key> placement — wrong for a real journey,
 * but visible and debuggable rather than silently dropped.
 */

const CONSENT_KEYS = ['shareWithClinicians', 'sharePrescriptions', 'useForResearch'];

type Wrap =
  | 'none'
  | 'phone'
  | 'phoneMobile'
  | 'phoneLandline'
  | 'emailPersonal'
  | 'emailWork'
  | 'idNumber'
  | 'ssn'
  | 'previousAddress'
  | 'previousAddressPart'
  | 'documentSide1'
  | 'documentSide2'
  | 'selfie';

interface FieldMapping {
  domainElementId: string;
  path: string[];
  wrap: Wrap;
  /** For previousAddressPart: the address component, e.g. postalCode. */
  part?: string;
}

const KNOWN: Record<string, FieldMapping> = {
  // Identity. Absent from the current Meridian journey — Data Verification
  // was removed after failing to source FullName on this tenant — but kept
  // so restoring that module needs no change here.
  fullName: { domainElementId: 'FullName', path: ['identity', 'firstName'], wrap: 'none' },
  firstName: { domainElementId: 'FullName', path: ['identity', 'firstName'], wrap: 'none' },
  lastNames: { domainElementId: 'FullName', path: ['identity', 'lastNames'], wrap: 'none' },
  dateOfBirth: { domainElementId: 'DateOfBirth', path: ['identity', 'dateOfBirth'], wrap: 'none' },

  // Address. Go wants the components, not one free-text line.
  building: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'building'], wrap: 'none' },
  thoroughfare: {
    domainElementId: 'CurrentAddress',
    path: ['identity', 'currentAddress', 'thoroughfare'],
    wrap: 'none',
  },
  locality: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'locality'], wrap: 'none' },
  postcode: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'postalCode'], wrap: 'none' },
  // Go's element leaf is postalCode; "postcode" above is the short name a
  // hand-built screen sends. Both are here so a form stage named after the
  // ref resolves by leaf like every other field.
  postalCode: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'postalCode'], wrap: 'none' },
  // Every address component a market may mark required. An unmapped one
  // falls through to the flat fallback and Go rejects the submit.
  premise: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'premise'], wrap: 'none' },
  subBuilding: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'subBuilding'], wrap: 'none' },
  dependentThoroughfare: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'dependentThoroughfare'], wrap: 'none' },
  dependentLocality: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'dependentLocality'], wrap: 'none' },
  addressString: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'addressString'], wrap: 'none' },
  country: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'country'], wrap: 'none' },

  mobileNumber: { domainElementId: 'MobilePhone', path: ['identity', 'phones'], wrap: 'phone' },

  // Contact and personal details, by the domain element refs a form stage
  // submits. Phones, emails and id numbers are typed arrays, so each value
  // is appended as its own entry rather than replacing the last. Ported from
  // go-sample-backend-java's api-implementation, which proved them live.
  'MobilePhone/number': { domainElementId: 'MobilePhone', path: ['identity', 'phones'], wrap: 'phoneMobile' },
  'LandlinePhone/number': { domainElementId: 'LandlinePhone', path: ['identity', 'phones'], wrap: 'phoneLandline' },
  'PersonalEmail/email': { domainElementId: 'PersonalEmail', path: ['identity', 'emails'], wrap: 'emailPersonal' },
  'WorkEmail/email': { domainElementId: 'WorkEmail', path: ['identity', 'emails'], wrap: 'emailWork' },
  MothersMaidenName: { domainElementId: 'MothersMaidenName', path: ['identity', 'mothersMaidenName'], wrap: 'none' },
  Gender: { domainElementId: 'Gender', path: ['identity', 'gender'], wrap: 'none' },
  NationalInsuranceNumber: { domainElementId: 'NationalInsuranceNumber', path: ['identity', 'idNumbers'], wrap: 'idNumber' },
  SSN: { domainElementId: 'SSN', path: ['identity', 'idNumbers'], wrap: 'ssn' },
  PreviousAddresses: { domainElementId: 'PreviousAddresses', path: ['identity', 'previousAddresses'], wrap: 'previousAddress' },

  // Document and biometric capture. The front end sends an attachment
  // reference or a data URL; either way it lands as base64 image data
  // inside subject.documents / subject.biometrics.
  documentImage: { domainElementId: 'PrimaryDocument', path: ['documents'], wrap: 'documentSide1' },
  documentBack: { domainElementId: 'PrimaryDocument', path: ['documents'], wrap: 'documentSide2' },
  selfieImage: { domainElementId: 'Selfie', path: ['biometrics'], wrap: 'selfie' },
};

/**
 * The mapping for one submitted field, by either name it can arrive under.
 *
 * A form stage's fields are named after the domain element refs Go reports,
 * so the front end submits `CurrentAddress/postalCode`, not `postcode`. The
 * keys below are the short names, which is all the capture and consent
 * screens ever send — so a prefixed ref missed every entry, fell through to
 * the flat fallback, and Go rejected the submit with "Required domain
 * element 'CurrentAddress/building' data is missing from context" on a
 * screen the customer had already filled in.
 *
 * So: try the key as sent, then its leaf — but only when the leaf's entry
 * belongs to the same domain element as the ref. Leaf names repeat across
 * elements (`PreviousAddresses/postalCode` and `CurrentAddress/postalCode`
 * share a leaf), and matching on the leaf alone would write a previous
 * address's postcode over the current one.
 *
 * A previous-address component goes into the first previousAddresses[]
 * entry instead, with every other component of the same address.
 */
function forKey(key: string): FieldMapping {
  const known = KNOWN[key];
  if (known) return known;
  if (key.includes('/')) {
    const element = key.slice(0, key.indexOf('/'));
    const leaf = key.slice(key.lastIndexOf('/') + 1);
    if (element === 'PreviousAddresses') {
      return { domainElementId: element, path: ['identity', 'previousAddresses'], wrap: 'previousAddressPart', part: leaf };
    }
    const byLeaf = KNOWN[leaf];
    if (byLeaf && byLeaf.domainElementId === element) return byLeaf;
  }
  return { domainElementId: key, path: [key], wrap: 'none' };
}

/**
 * Both sides of one document belong to a single documents[] entry, so a
 * second side merges into the existing object rather than appending a
 * second document. An absent side is omitted, never sent as an empty
 * string — Go validates a supplied image as a non-empty string and rejects
 * the whole submission otherwise.
 */
function mergeDocument(cursor: Record<string, unknown>, leaf: string, side: string, image: string): void {
  const documents = cursor[leaf] as Record<string, unknown>[] | undefined;
  let document: Record<string, unknown>;
  if (!documents || documents.length === 0) {
    document = { type: 'Primary' };
    cursor[leaf] = [document];
  } else {
    document = documents[0]!;
  }
  document[side] = image;
}

/** Adds one entry to a typed array under `leaf`, creating it if absent; returns its index. */
function append(cursor: Record<string, unknown>, leaf: string, entry: Record<string, string>): number {
  const existing = cursor[leaf];
  const entries = Array.isArray(existing) ? existing : [];
  if (!Array.isArray(existing)) cursor[leaf] = entries;
  entries.push(entry);
  return entries.length - 1;
}

/**
 * Places `value` under `subject` and returns the path Go names it by in a
 * validation error, e.g. `context.subject.identity.emails.0.email`.
 */
function place(subject: Record<string, unknown>, mapping: FieldMapping, value: unknown): string {
  let cursor = subject;
  for (let i = 0; i < mapping.path.length - 1; i++) {
    const key = mapping.path[i]!;
    if (typeof cursor[key] !== 'object' || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leaf = mapping.path[mapping.path.length - 1]!;
  const at = `context.subject.${mapping.path.join('.')}`;
  const text = String(value);
  switch (mapping.wrap) {
    // Appended, not replaced: a screen collecting a mobile and a landline (or
    // a personal and a work email) sends them as separate fields, and the
    // second would otherwise overwrite the first.
    case 'phone':
    case 'phoneMobile':
      return `${at}.${append(cursor, leaf, { type: 'mobile', number: text })}.number`;
    case 'phoneLandline':
      return `${at}.${append(cursor, leaf, { type: 'landline', number: text })}.number`;
    case 'emailPersonal':
      return `${at}.${append(cursor, leaf, { type: 'personal', email: text })}.email`;
    case 'emailWork':
      return `${at}.${append(cursor, leaf, { type: 'work', email: text })}.email`;
    // An NI number is not a bare identity field: idNumbers[] carries a type
    // naming the identifier alongside the number itself.
    case 'idNumber':
      return `${at}.${append(cursor, leaf, { type: 'NationalInsuranceNumber', idNumber: text })}.idNumber`;
    case 'ssn':
      return `${at}.${append(cursor, leaf, { type: 'SSN', idNumber: text })}.idNumber`;
    case 'previousAddress':
      return `${at}.${append(cursor, leaf, { addressString: text })}.addressString`;
    case 'previousAddressPart': {
      const existing = cursor[leaf];
      const addresses = Array.isArray(existing) ? (existing as Record<string, unknown>[]) : [];
      if (!Array.isArray(existing)) cursor[leaf] = addresses;
      if (addresses.length === 0) addresses.push({});
      const part = mapping.part!;
      addresses[0]![part] = part === 'country' ? countryCode(text) : value;
      return `${at}.0.${part}`;
    }
    case 'documentSide1':
      mergeDocument(cursor, leaf, 'side1Image', text);
      return `${at}.0.side1Image`;
    case 'documentSide2':
      mergeDocument(cursor, leaf, 'side2Image', text);
      return `${at}.0.side2Image`;
    // `type` is required alongside the image: without it Go accepts the
    // submission but leaves Selfie/selfieImage outstanding — a silent no-op.
    case 'selfie':
      cursor[leaf] = [{ type: 'Selfie', selfieImage: text }];
      return `${at}.0.selfieImage`;
    case 'none':
      cursor[leaf] = leaf === 'country' ? countryCode(text) : value;
      return at;
  }
}

/**
 * A country as Go will accept it: /^[A-Z]{2,3}$/.
 *
 * The front end renders this as a plain text box — its field type vocabulary
 * has no select — so a customer types "United Kingdom" and Go answers 400
 * "Invalid string: must match pattern", which surfaces as a Continue button
 * that does nothing. An already-valid code passes through upper-cased, and a
 * name this table does not know is sent as typed so Go's own error stands
 * rather than a guess.
 *
 * Deliberately short: the UK plus the countries these demo journeys name. It
 * is a nudge for hand-typed input, not an i18n country table.
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

function countryCode(typed: string): string {
  const trimmed = typed?.trim() ?? '';
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2,3}$/.test(upper)) return upper;
  return COUNTRY_CODES[upper] ?? trimmed;
}

/**
 * The consent screen posts one boolean per checkbox; the destination
 * Consent Collection module takes a single consent record whose only
 * required member is a URL. `consentUrl` must be a real, stable URL — Go
 * stores it so the exact terms consented to can be retrieved later.
 */
function consentRecord(data: Record<string, unknown>, consentUrl: string, consentTerms: string): Record<string, unknown> {
  const purpose = CONSENT_KEYS.filter((k) => data[k] === true).join(',');
  return {
    type: 'explicit',
    url: consentUrl,
    terms: consentTerms,
    effectiveDate: new Date().toISOString(),
    purpose,
  };
}

/**
 * Go path → submitted field name, for the same `data` `buildSubmitRequest`
 * would send, so a 400/422 whose problems name paths
 * (`context.subject.identity.emails.0.email: ...`) can be reported against
 * the field the customer typed into. Array indices depend on the order
 * fields were placed, so this runs the same placement on a scratch subject.
 */
export function fieldsByGoPath(data: Record<string, unknown> | undefined): Record<string, string> {
  const byPath: Record<string, string> = {};
  const scratch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (CONSENT_KEYS.includes(key) || value === null || value === undefined) continue;
    byPath[place(scratch, forKey(key), value)] = key;
  }
  return byPath;
}

export function buildSubmitRequest(
  instanceId: string,
  interactionId: string,
  data: Record<string, unknown> | undefined,
  consentUrl: string,
  consentTerms: string
): GoInteractionSubmitRequest {
  if (!data || Object.keys(data).length === 0) {
    return { instanceId, interactionId, participants: [], context: { subject: {} } };
  }

  const participants: { domainElementId: string }[] = [];
  // A domain element is named once in the manifest no matter how many fields
  // feed it (both sides of a document, first/last name, every address
  // component) — Go's manifest is a set of elements this call covers, not one
  // entry per source field.
  const seenElements = new Set<string>();
  const addParticipant = (domainElementId: string): void => {
    if (seenElements.has(domainElementId)) return;
    seenElements.add(domainElementId);
    participants.push({ domainElementId });
  };
  const subject: Record<string, unknown> = {};

  if (Object.keys(data).some((k) => CONSENT_KEYS.includes(k))) {
    addParticipant('Consent');
    subject['consent'] = [consentRecord(data, consentUrl, consentTerms)];
  }

  for (const [key, value] of Object.entries(data)) {
    // A null would otherwise go out as the string "null" (e.g. email "null",
    // which Go rejects).
    if (CONSENT_KEYS.includes(key) || value === null || value === undefined) continue;
    const mapping = forKey(key);
    addParticipant(mapping.domainElementId);
    place(subject, mapping, value);
  }

  return { instanceId, interactionId, participants, context: { subject } };
}
