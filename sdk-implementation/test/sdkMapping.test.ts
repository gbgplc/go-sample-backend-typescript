import { describe, expect, it } from 'vitest';
import { sdkServerUrl } from '@/lib/config';
import { buildSdkSubmitRequest } from '@/lib/go/sdk/buildSdkSubmitRequest';
import { toInteractionView, toStateView } from '@/lib/go/sdk/sdkResponses';
import type { FetchInteractionResponse, GetJourneyStateResponse } from '@gbg/go-core/models/operations';

const CONSENT_URL = 'https://example.com/terms';
const TERMS = 'I agree.';

describe('sdkServerUrl — @gbg/go-core adds /v2/captain to every path itself', () => {
  it('strips the API path from the configured base URL, whatever its case', () => {
    expect(sdkServerUrl('https://eu.platform.go.gbgplc.com/v2/captain/')).toBe('https://eu.platform.go.gbgplc.com');
    expect(sdkServerUrl('https://eu.platform.go.gbgplc.com/V2/Captain')).toBe('https://eu.platform.go.gbgplc.com');
  });

  it('keeps any other path prefix for the SDK to append to', () => {
    expect(sdkServerUrl('https://gw.example.com/go/v2/captain/')).toBe('https://gw.example.com/go');
  });

  it('reduces the configured market base URL to the bare host', () => {
    expect(sdkServerUrl()).toBe('https://eu.platform.go.gbgplc.com');
  });
});

describe('buildSdkSubmitRequest', () => {
  it('names each domain element once and nests the values in the typed subject', () => {
    const { request, fieldsByGoPath } = buildSdkSubmitRequest(
      'inst-1',
      'int-1',
      {
        'CurrentAddress/building': '10',
        'CurrentAddress/thoroughfare': 'Downing Street',
        'CurrentAddress/postalCode': 'SW1A 2AA',
        'CurrentAddress/country': 'United Kingdom',
        'MobilePhone/number': '07700900000',
        'PersonalEmail/email': 'ada@example.com',
        NationalInsuranceNumber: 'QQ123456C',
        Gender: 'F',
        MothersMaidenName: 'Byron',
      },
      CONSENT_URL,
      TERMS
    );

    expect(request.participants).toEqual([
      { domainElementId: 'CurrentAddress' },
      { domainElementId: 'MobilePhone' },
      { domainElementId: 'PersonalEmail' },
      { domainElementId: 'NationalInsuranceNumber' },
      { domainElementId: 'Gender' },
      { domainElementId: 'MothersMaidenName' },
    ]);
    expect(request.context?.subject.identity).toEqual({
      currentAddress: { building: '10', thoroughfare: 'Downing Street', postalCode: 'SW1A 2AA', country: 'GBR' },
      phones: [{ type: 'mobile', number: '07700900000' }],
      emails: [{ type: 'personal', email: 'ada@example.com' }],
      idNumbers: [{ type: 'NationalInsuranceNumber', idNumber: 'QQ123456C' }],
      gender: 'F',
      mothersMaidenName: 'Byron',
    });
    expect(fieldsByGoPath['context.subject.identity.emails.0.email']).toBe('PersonalEmail/email');
    expect(fieldsByGoPath['context.subject.identity.currentAddress.postalCode']).toBe('CurrentAddress/postalCode');
  });

  it('records consent as one explicit record carrying the consent URL and terms', () => {
    const { request } = buildSdkSubmitRequest(
      'inst-1',
      'int-1',
      { shareWithClinicians: true, sharePrescriptions: false, useForResearch: true },
      CONSENT_URL,
      TERMS
    );

    expect(request.participants).toEqual([{ domainElementId: 'Consent' }]);
    expect(request.context?.subject.consent).toEqual([
      expect.objectContaining({ type: 'explicit', url: CONSENT_URL, terms: TERMS, purpose: 'shareWithClinicians,useForResearch' }),
    ]);
  });

  it('merges both document sides into one typed document and sends the selfie with its type', () => {
    const { request } = buildSdkSubmitRequest(
      'inst-1',
      'int-1',
      { documentImage: 'ZnJvbnQ=', documentBack: 'YmFjaw==', selfieImage: 'ZmFjZQ==' },
      CONSENT_URL,
      TERMS
    );

    expect(request.context?.subject.documents).toEqual([{ type: 'Primary', side1Image: 'ZnJvbnQ=', side2Image: 'YmFjaw==' }]);
    expect(request.context?.subject.biometrics).toEqual([{ type: 'Selfie', selfieImage: 'ZmFjZQ==' }]);
    expect(request.participants).toEqual([{ domainElementId: 'PrimaryDocument' }, { domainElementId: 'Selfie' }]);
  });

  it('drops a field the SDK subject has no place for, and does not name it as a participant', () => {
    const { request } = buildSdkSubmitRequest('inst-1', 'int-1', { loyaltyTier: 'gold', firstName: 'Ada' }, CONSENT_URL, TERMS);

    expect(request.participants).toEqual([{ domainElementId: 'FullName' }]);
    expect(request.context?.subject).toEqual({ identity: { firstName: 'Ada' } });
  });

  it('skips null and undefined values rather than sending the string "null"', () => {
    const { request } = buildSdkSubmitRequest('inst-1', 'int-1', { 'PersonalEmail/email': null, firstName: 'Ada' }, CONSENT_URL, TERMS);

    expect(request.participants).toEqual([{ domainElementId: 'FullName' }]);
  });

  it('sends an empty submit for a screen with nothing to collect', () => {
    expect(buildSdkSubmitRequest('inst-1', 'int-1', {}, CONSENT_URL, TERMS).request).toEqual({
      instanceId: 'inst-1',
      interactionId: 'int-1',
      participants: [],
      context: { subject: {} },
    });
  });
});

describe('sdkResponses — narrowing the SDK unions into the read model', () => {
  it('reads the fields both fetch variants share, skipping non-string list entries', () => {
    const full = {
      instanceId: 'inst-1',
      interactionId: 'int-1',
      journey: { status: 'InProgress' },
      interaction: { collects: [{ ref: 'Selfie/selfieImage' }] },
      outstanding: ['Selfie/selfieImage', { ref: 'junk' }, 7],
      instructions: ['Side2Required'],
    } as unknown as FetchInteractionResponse;

    expect(toInteractionView(full)).toEqual({
      instanceId: 'inst-1',
      interactionId: 'int-1',
      journey: { status: 'InProgress' },
      interaction: { collects: [{ ref: 'Selfie/selfieImage' }] },
      processing: undefined,
      outstanding: ['Selfie/selfieImage'],
      instructions: ['Side2Required'],
      result: undefined,
    });
  });

  it('takes the full state view, context and result intact', () => {
    const full = {
      instanceId: 'inst-1',
      status: 'Completed',
      result: { outcomeClassification: 'positive' },
      context: { process: { steps: [{ name: 'Liveness Verification' }] } },
    } as GetJourneyStateResponse;

    expect(toStateView(full)?.context?.process?.steps).toEqual([{ name: 'Liveness Verification' }]);
    expect(toStateView(full)?.result?.outcomeClassification).toBe('positive');
  });

  it('refuses the slim state view', () => {
    const slim = {
      instanceId: 'inst-1',
      status: 'InProgress',
      steps: [{ nodeId: 'n1', name: 'Liveness Verification' }],
    } as GetJourneyStateResponse;

    expect(toStateView(slim)).toBeUndefined();
  });
});
