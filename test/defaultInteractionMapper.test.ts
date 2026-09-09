import { describe, expect, it } from 'vitest';
import { createInteractionMapper } from '@/lib/go/live/defaultInteractionMapper';
import { GoInteractionFetchResponse, GoStateResponse, GoStateStep } from '@/lib/go/live/dto';
import { ScreenPlanConfig } from '@/lib/config/types';

const TWO_STAGE_PLAN: ScreenPlanConfig = {
  stages: [
    {
      name: 'document',
      kind: 'capture',
      prefix: 'PrimaryDocument/',
      stage: 'Document',
      title: 'Scan your photo ID',
      body: 'We check the document is genuine.',
      cta: 'Scan document',
      captureType: 'document',
    },
    {
      name: 'biometrics',
      kind: 'capture',
      prefix: 'Selfie/',
      stage: 'Biometrics',
      title: 'Take a selfie',
      body: 'This proves you are the person in the document.',
      cta: 'Take selfie',
      captureType: 'selfie',
    },
  ],
  consentChecks: [],
};

function fetchResponseWithOutstanding(outstanding: string[]): GoInteractionFetchResponse {
  return {
    instanceId: 'instance-1',
    journey: { status: 'InProgress' },
    interactionId: 'int-1',
    processing: false,
    outstanding,
  };
}

describe('toInteraction — the configured screen plan drives which screen renders', () => {
  const mapper = createInteractionMapper(TWO_STAGE_PLAN);

  it('the first stage in plan order wins when several are outstanding', () => {
    const interaction = mapper.toInteraction(
      fetchResponseWithOutstanding(['PrimaryDocument/side1Image', 'Selfie/selfieImage'])
    );

    expect(interaction.kind).toBe('capture');
    expect(interaction.stage).toBe('Document');
    expect(interaction.title).toBe('Scan your photo ID');
    expect(interaction.stagePlan).toEqual([
      { label: 'Document', state: 'active' },
      { label: 'Biometrics', state: 'upcoming' },
    ]);
  });

  it('a later stage renders once earlier ones are no longer outstanding', () => {
    const interaction = mapper.toInteraction(fetchResponseWithOutstanding(['Selfie/selfieImage']));

    expect(interaction.stage).toBe('Biometrics');
    expect(interaction.stagePlan).toEqual([
      { label: 'Document', state: 'done' },
      { label: 'Biometrics', state: 'active' },
    ]);
  });

  it('an element no configured stage claims falls back to a generic form instead of stalling', () => {
    const interaction = mapper.toInteraction(fetchResponseWithOutstanding(['FullName/firstName']));

    expect(interaction.kind).toBe('form');
    expect(interaction.collects).toHaveLength(1);
    expect(interaction.collects?.[0]).toEqual({ name: 'FullName/firstName', label: 'First name' });
  });

  it('an unrecognised element with no known label is de-camel-cased', () => {
    const interaction = mapper.toInteraction(fetchResponseWithOutstanding(['SomeNewModule/dateOfIssue']));

    expect(interaction.collects?.[0]?.label).toBe('Date of issue');
  });

  it('an empty plan falls back to a generic form rather than crashing', () => {
    const noPlanMapper = createInteractionMapper({ stages: [], consentChecks: [] });

    const interaction = noPlanMapper.toInteraction(fetchResponseWithOutstanding(['PrimaryDocument/side1Image']));

    expect(interaction.kind).toBe('form');
  });
});

function stateResponseWith(step: GoStateStep): GoStateResponse {
  return {
    instanceId: 'instance-1',
    status: 'Completed',
    steps: [step],
    result: { outcomeClassification: 'positive' },
  };
}

describe('toRecord — module-level verdicts (mapModuleState)', () => {
  const mapper = createInteractionMapper(TWO_STAGE_PLAN);

  it('a module that ran to completion but declined is reported as Fail, not Pass', () => {
    const declined: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Authentication',
      outcomeClassification: 'negative',
      result: { status: 'complete' },
    };

    const record = mapper.toRecord(stateResponseWith(declined));

    expect(record.moduleRuns).toHaveLength(1);
    expect(record.moduleRuns[0]?.state).toBe('Fail');
  });

  it('a module that ran to completion and passed is reported as Pass', () => {
    const passed: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Authentication',
      outcomeClassification: 'positive',
      result: { status: 'complete' },
    };

    expect(mapper.toRecord(stateResponseWith(passed)).moduleRuns[0]?.state).toBe('Pass');
  });

  it('a still-running module is reported as Running regardless of any classification', () => {
    const running: GoStateStep = {
      nodeId: 'node1',
      name: 'Facematch Verification',
      outcomeClassification: 'negative',
      result: { status: 'pending' },
    };

    expect(mapper.toRecord(stateResponseWith(running)).moduleRuns[0]?.state).toBe('Running');
  });

  it('a module that errored is reported as Fail', () => {
    const errored: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Classification',
      result: { status: 'error' },
    };

    expect(mapper.toRecord(stateResponseWith(errored)).moduleRuns[0]?.state).toBe('Fail');
  });

  it('a module with no result yet falls back to its own classification', () => {
    const notYetRun: GoStateStep = { nodeId: 'node1', name: 'Liveness Verification' };

    expect(mapper.toRecord(stateResponseWith(notYetRun)).moduleRuns[0]?.state).toBe('Running');
  });
});
