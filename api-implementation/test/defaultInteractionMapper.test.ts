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

  it("carries Go's own descriptive outcome alongside state", () => {
    // Go's own result.outcome ("Document Classified", "Extraction
    // Successful") is worth showing alongside state: a module with no
    // positive/negative verdict of its own always maps to Review regardless
    // of how it actually went, so state carries the colour and outcome
    // carries the detail. Verified against a real completed run, 2026-09-16.
    const step: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Classification',
      result: { status: 'complete', outcome: 'Document Classified' },
    };

    expect(mapper.toRecord(stateResponseWith(step)).moduleRuns[0]?.outcome).toBe('Document Classified');
  });

  it('reports a confirmed-positive outcome phrase as Pass even with no outcomeClassification', () => {
    // Live modules never carry outcomeClassification themselves — only the
    // journey's own decision node does — so this is the only signal that
    // exists in practice for a module like Document Classification, which has
    // no positive/negative verdict of its own. Verified against a real
    // completed run, 2026-09-16.
    const step: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Extraction',
      result: { status: 'complete', outcome: 'Extraction Successful' },
    };

    expect(mapper.toRecord(stateResponseWith(step)).moduleRuns[0]?.state).toBe('Pass');
  });

  it('leaves an ambiguous outcome phrase as Review rather than guessing it is positive', () => {
    // "No Match" contains "Match" as a substring — an exact-phrase allowlist,
    // not a keyword search, is what keeps this from wrongly turning green.
    // "Medium Risk" is a similarly real, ambiguous outcome that should not be
    // presented as a clean pass.
    const noMatch: GoStateStep = {
      nodeId: 'node1',
      name: 'Data Verification',
      result: { status: 'complete', outcome: 'No Match' },
    };
    const mediumRisk: GoStateStep = {
      nodeId: 'node2',
      name: 'Document Authentication',
      result: { status: 'complete', outcome: 'Medium Risk' },
    };

    const record = mapper.toRecord({
      instanceId: 'instance-1',
      status: 'Completed',
      steps: [noMatch, mediumRisk],
      result: { outcomeClassification: 'positive' },
    });

    expect(record.moduleRuns.map((run) => run.state)).toEqual(['Review', 'Review']);
  });

  it("the journey graph's own terminal decision node is not listed as a module", () => {
    // Go's own decision node has no name and no result — every real module
    // has both. Verified against a real completed run, 2026-09-16:
    // {"nodeId":"mtrehx2922ie24j37zu","outcome":"Decision: Accept",
    // "outcomeClassification":"positive","result":null}. Falling back to its
    // raw nodeId showed a fake module in the list, duplicating the decision
    // the screen already states up top.
    const realModule: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Authentication',
      outcomeClassification: 'positive',
      result: { status: 'complete' },
    };
    const decisionNode: GoStateStep = {
      nodeId: 'mtrehx2922ie24j37zu',
      outcome: 'Decision: Accept',
      outcomeClassification: 'positive',
    };

    const record = mapper.toRecord({
      instanceId: 'instance-1',
      status: 'Completed',
      steps: [realModule, decisionNode],
      result: { outcomeClassification: 'positive' },
    });

    expect(record.moduleRuns.map((run) => run.label)).toEqual(['Document Authentication']);
  });

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

// Field shapes below (process.step.durationMilliSec/endedAt,
// result.subject.documents[0].classification.name) are verified against a
// real completed run, 2026-09-16 — not guessed. journey.endedAt was
// undefined throughout that run even after the decision, which is why
// latestStepEndedAt() exists as its substitute.
function stepWithTiming(
  nodeId: string,
  name: string,
  outcome: string,
  result: GoStateStep['result'],
  startedAt: string,
  endedAt: string,
  durationMilliSec: number
): GoStateStep {
  return { nodeId, name, outcome, result, process: { step: { startedAt, endedAt, durationMilliSec, moduleName: name } } };
}

describe('toRecord — journey name, reference, timestamps, total time, per-module timing and document type', () => {
  const mapper = createInteractionMapper(TWO_STAGE_PLAN);

  it('summarises the journey when Go supplies timing info', () => {
    const step = stepWithTiming(
      'node1',
      'Document Authentication',
      'complete',
      { status: 'complete', outcome: 'Approved' },
      '2026-08-26T09:41:02Z',
      '2026-08-26T09:41:08Z',
      1600
    );
    const response: GoStateResponse = {
      instanceId: 'instance-1',
      status: 'Completed',
      journey: { name: 'UK retail account opening', version: '12', startedAt: '2026-08-26T09:41:02Z' },
      steps: [step],
      result: { outcomeClassification: 'positive' },
    };

    const record = mapper.toRecord(response);

    expect(record.moduleRuns[0]?.ms).toBe('1.6s');
    expect(record.timing).toBe('6.0 seconds');
    expect(record.summary).toEqual([
      { k: 'Journey', v: 'UK retail account opening · v12' },
      { k: 'Reference', v: 'instance-1' },
      { k: 'Started', v: '26 Aug 2026 09:41:02' },
      { k: 'Decision reached', v: '26 Aug 2026 09:41:08' },
      { k: 'Total time', v: '6.0 seconds' },
    ]);
  });

  it('reads journey info from context.process.journey when not at the root', () => {
    // The live platform nests journey timing there, not at the root — same
    // split as allSteps().
    const response: GoStateResponse = {
      instanceId: 'instance-2',
      status: 'Completed',
      steps: [],
      result: { outcomeClassification: 'positive' },
      context: {
        process: {
          journey: { name: 'Patient record access', startedAt: '2026-08-26T09:41:02Z', endedAt: '2026-08-26T09:41:04Z' },
        },
      },
    };

    expect(mapper.toRecord(response).summary).toContainEqual({ k: 'Journey', v: 'Patient record access' });
  });

  it("falls back to the latest step's endedAt when the journey never supplies one", () => {
    // journey.endedAt came back undefined throughout a real completed run,
    // even after the decision — the last module to finish is the honest
    // substitute for "when the journey ended".
    const earlier = stepWithTiming(
      'node1',
      'Document Classification',
      'complete',
      { status: 'complete', outcome: 'Document Classified' },
      '2026-08-26T09:41:00Z',
      '2026-08-26T09:41:38Z',
      38000
    );
    const later = stepWithTiming(
      'node2',
      'Facematch Verification',
      'complete',
      { status: 'complete', outcome: 'Success' },
      '2026-08-26T09:41:38Z',
      '2026-08-26T09:41:44Z',
      6000
    );
    const response: GoStateResponse = {
      instanceId: 'instance-1',
      status: 'Completed',
      journey: { name: 'Patient record access', startedAt: '2026-08-26T09:41:00Z' },
      steps: [earlier, later],
      result: { outcomeClassification: 'positive' },
    };

    const record = mapper.toRecord(response);

    expect(record.summary).toContainEqual({ k: 'Decision reached', v: '26 Aug 2026 09:41:44' });
    expect(record.summary).toContainEqual({ k: 'Total time', v: '44.0 seconds' });
  });

  it('has no timing rows when Go supplies no journey timing', () => {
    // The instance reference has nothing to do with journey timing, so it's
    // still there — only the timestamp/duration rows are conditional on it.
    const notYetRun: GoStateStep = {
      nodeId: 'node1',
      name: 'Liveness Verification',
      outcomeClassification: 'positive',
      result: { status: 'complete' },
    };

    const record = mapper.toRecord(stateResponseWith(notYetRun));

    expect(record.summary).toEqual([{ k: 'Reference', v: 'instance-1' }]);
    expect(record.timing).toBe('');
    expect(record.moduleRuns[0]?.ms).toBeUndefined();
  });

  it("reads the document type from Document Classification's own step result", () => {
    const step: GoStateStep = {
      nodeId: 'node1',
      name: 'Document Classification',
      result: {
        status: 'complete',
        outcome: 'Document Classified',
        subject: {
          documents: [
            { type: 'primary', classification: { name: 'Utopia (UTO) GBG Sample Identification Card (2024)' } },
          ],
        },
      },
    };
    const response: GoStateResponse = {
      instanceId: 'instance-3',
      status: 'Completed',
      steps: [step],
      result: { outcomeClassification: 'positive' },
    };

    expect(mapper.toRecord(response).summary).toContainEqual({
      k: 'Document',
      v: 'Utopia (UTO) GBG Sample Identification Card (2024)',
    });
  });

  it('has no document row when Go never reports a type', () => {
    const notYetRun: GoStateStep = {
      nodeId: 'node1',
      name: 'Liveness Verification',
      outcomeClassification: 'positive',
      result: { status: 'complete' },
    };

    expect(mapper.toRecord(stateResponseWith(notYetRun)).summary.some((row) => row.k === 'Document')).toBe(false);
  });
});
