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

type Wrap = 'none' | 'phone' | 'documentSide1' | 'documentSide2' | 'selfie';

interface FieldMapping {
  domainElementId: string;
  path: string[];
  wrap: Wrap;
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
  country: { domainElementId: 'CurrentAddress', path: ['identity', 'currentAddress', 'country'], wrap: 'none' },

  mobileNumber: { domainElementId: 'MobilePhone', path: ['identity', 'phones'], wrap: 'phone' },

  // Document and biometric capture. The front end sends an attachment
  // reference or a data URL; either way it lands as base64 image data
  // inside subject.documents / subject.biometrics.
  documentImage: { domainElementId: 'PrimaryDocument', path: ['documents'], wrap: 'documentSide1' },
  documentBack: { domainElementId: 'PrimaryDocument', path: ['documents'], wrap: 'documentSide2' },
  selfieImage: { domainElementId: 'Selfie', path: ['biometrics'], wrap: 'selfie' },
};

function forKey(key: string): FieldMapping {
  return KNOWN[key] ?? { domainElementId: key, path: [key], wrap: 'none' };
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

function place(subject: Record<string, unknown>, mapping: FieldMapping, value: unknown): void {
  let cursor = subject;
  for (let i = 0; i < mapping.path.length - 1; i++) {
    const key = mapping.path[i]!;
    if (typeof cursor[key] !== 'object' || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leaf = mapping.path[mapping.path.length - 1]!;
  const text = String(value);
  switch (mapping.wrap) {
    case 'phone':
      cursor[leaf] = [{ type: 'mobile', number: text }];
      break;
    case 'documentSide1':
      mergeDocument(cursor, leaf, 'side1Image', text);
      break;
    case 'documentSide2':
      mergeDocument(cursor, leaf, 'side2Image', text);
      break;
    // `type` is required alongside the image: without it Go accepts the
    // submission but leaves Selfie/selfieImage outstanding — a silent no-op.
    case 'selfie':
      cursor[leaf] = [{ type: 'Selfie', selfieImage: text }];
      break;
    case 'none':
      cursor[leaf] = value;
      break;
  }
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
    if (CONSENT_KEYS.includes(key)) continue;
    const mapping = forKey(key);
    addParticipant(mapping.domainElementId);
    place(subject, mapping, value);
  }

  return { instanceId, interactionId, participants, context: { subject } };
}
