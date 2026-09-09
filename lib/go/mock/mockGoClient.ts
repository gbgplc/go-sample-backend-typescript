import { Interaction, JourneyStatus, RecordResponse, StagePlanEntry, StageState } from '../../dto/types';
import { OnboardingException } from '../../errors/onboardingException';
import { GoClient } from '../goClient';
import { fixtures } from './fixtureCatalog';
import { MarketFixtures, Scenario, ScenarioStep } from './types';

/**
 * Standalone canned-fixture Go client (front-end handoff, section 5 — "mock
 * mode"). This is the TS twin of the front end's own MockTransport and the
 * Java backend's MockGoClient: same scenario-script shape, same branching and
 * stage-plan rules, so a session driven through this client behaves
 * identically whichever implementation is running mocked.
 *
 * `createMockGoClient` takes its fixtures as a parameter (mirroring the Java
 * class's constructor-injected FixtureCatalog) rather than reading a global,
 * so it can be pointed at hand-built fixtures in a test. The runtime
 * singleton below is just `createMockGoClient(fixtures)` from the catalog,
 * stashed on globalThis so next dev's hot-reload doesn't reset in-flight
 * journeys on every file save.
 */

interface MockInstance {
  scenarioId: string;
  stepIndex: number;
}

function statusOf(step: ScenarioStep): JourneyStatus {
  if (step.kind === 'processing') return 'InProgress';
  if (step.kind === 'result' && step.summary && step.summary.length > 0) return 'Completed';
  return 'PendingInput';
}

/**
 * One row per distinct stage label, in order of first appearance across the
 * whole current scenario's step list. A stage is `done` once its first
 * occurrence is behind the current step and it isn't the current stage;
 * matching by label (not position) is what lets a repeated stage — banking's
 * "Decision" shows twice around the referral upload — flip back to `active`
 * on the second visit instead of getting stuck.
 */
export function buildStagePlan(steps: ScenarioStep[], currentIndex: number): StagePlanEntry[] {
  const currentStage = steps[currentIndex]!.stage;
  const seen: { label: string; first: number }[] = [];
  steps.forEach((s, i) => {
    if (!seen.some((e) => e.label === s.stage)) seen.push({ label: s.stage, first: i });
  });
  return seen.map(({ label, first }) => {
    if (label === currentStage) return { label, state: 'active' as StageState };
    return { label, state: (first < currentIndex ? 'done' : 'upcoming') as StageState };
  });
}

function toInteraction(step: ScenarioStep, id: string, stagePlan: StagePlanEntry[]): Interaction {
  const options = step.options?.map((o) => ({ value: o.value, label: o.label, detail: o.detail, icon: o.icon }));
  return {
    interactionId: id,
    kind: step.kind,
    stage: step.stage,
    eyebrow: step.eyebrow,
    title: step.title,
    body: step.body,
    note: step.note,
    cta: step.cta,
    secondaryCta: step.secondaryCta,
    captureType: step.captureType as Interaction['captureType'],
    accepted: step.accepted,
    collects: step.fields,
    options,
    checks: step.checks,
    modules: step.modules,
    moduleRuns: step.moduleRuns,
    decision: step.decision,
    timing: step.timing,
    summary: step.summary,
    recordNote: step.recordNote,
    stagePlan,
  };
}

function toRecord(step: ScenarioStep): RecordResponse {
  return {
    decision: step.decision ?? 'pass',
    title: step.title,
    timing: step.timing ?? '',
    body: step.body ?? '',
    cta: step.cta ?? 'Done',
    moduleRuns: step.moduleRuns ?? [],
    summary: step.summary ?? [],
    recordNote: step.recordNote,
  };
}

export function createMockGoClient(marketFixtures: MarketFixtures): GoClient {
  const instances = new Map<string, MockInstance>();
  let counter = 0;

  function requireInstance(instanceId: string): MockInstance {
    const instance = instances.get(instanceId);
    if (!instance) {
      throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
    }
    return instance;
  }

  function scenarioOf(instance: MockInstance): Scenario {
    const scenario = marketFixtures.scenarios[instance.scenarioId];
    if (!scenario) {
      throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
    }
    return scenario;
  }

  function currentStep(instance: MockInstance): ScenarioStep {
    const steps = scenarioOf(instance).steps;
    const index = Math.min(instance.stepIndex, steps.length - 1);
    return steps[index]!;
  }

  return {
    async startJourney(_resourceId, _prefill, scenarioHint) {
      const instanceId = `mock_${++counter}`;
      const scenarioId =
        scenarioHint && marketFixtures.scenarios[scenarioHint] ? scenarioHint : marketFixtures.defaultScenarioId;
      const instance: MockInstance = { scenarioId, stepIndex: 0 };
      instances.set(instanceId, instance);

      const step = currentStep(instance);
      const interaction = toInteraction(step, `${instanceId}_0`, buildStagePlan(scenarioOf(instance).steps, 0));
      return { instanceId, status: statusOf(step), interaction };
    },

    async fetchInteraction(instanceId) {
      const instance = requireInstance(instanceId);
      const step = currentStep(instance);
      const steps = scenarioOf(instance).steps;
      const index = Math.min(instance.stepIndex, steps.length - 1);
      const interaction = toInteraction(step, `${instanceId}_${instance.stepIndex}`, buildStagePlan(steps, index));
      return { status: statusOf(step), interaction };
    },

    async submitInteraction(instanceId, interactionId, data) {
      const instance = requireInstance(instanceId);
      const step = currentStep(instance);
      const expectedId = `${instanceId}_${instance.stepIndex}`;
      if (expectedId !== interactionId) {
        throw OnboardingException.interactionStale('This step has moved on. Refetching the current one.');
      }

      // Branching choice: switch scenario, continuing at the same position in
      // the target scenario's own step list (both share the prefix up to here).
      if (step.kind === 'choice' && step.options) {
        const chosenValue = data ? data['value'] : undefined;
        const chosen = step.options.find((o) => o.value === chosenValue);
        if (chosen?.branchTo && chosen.branchTo !== instance.scenarioId) {
          instance.scenarioId = chosen.branchTo;
        }
      }

      // Re-read from the (possibly just-switched) scenario — the index
      // advances within the NEW scenario's step array, at oldIndex + 1.
      // Sibling scenarios share an identical step-index-aligned prefix up to
      // the branch point, which is what makes this safe.
      const targetSteps = scenarioOf(instance).steps;
      instance.stepIndex = Math.min(instance.stepIndex + 1, targetSteps.length - 1);

      const nextStep = currentStep(instance);
      const nextId = `${instanceId}_${instance.stepIndex}`;
      const plan = buildStagePlan(targetSteps, instance.stepIndex);
      return { status: statusOf(nextStep), interaction: toInteraction(nextStep, nextId, plan) };
    },

    async fetchState(instanceId) {
      const instance = requireInstance(instanceId);
      const step = currentStep(instance);
      return { status: statusOf(step), decision: step.decision, moduleRuns: step.moduleRuns };
    },

    async fetchRecord(instanceId) {
      const instance = requireInstance(instanceId);
      return toRecord(currentStep(instance));
    },
  };
}

const globalForMock = globalThis as unknown as { __mockGoClient?: GoClient };
export const mockGoClient: GoClient = globalForMock.__mockGoClient ?? createMockGoClient(fixtures);
globalForMock.__mockGoClient = mockGoClient;
