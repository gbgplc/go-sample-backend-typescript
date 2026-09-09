import {
  Decision,
  FieldSchema,
  Interaction,
  JourneyStatus,
  ModuleRun,
  ModuleState,
  RecordResponse,
  StagePlanEntry,
} from '../../dto/types';
import { marketConfig } from '../../config';
import { ScreenPlanConfig, ScreenPlanStage } from '../../config/types';
import { allSteps, firstStepErrorAction, GoInteractionFetchResponse, GoStateResponse, GoStateStep } from './dto';

/**
 * Turns Go's raw, domain-element-shaped interaction into the front end's
 * opinionated Interaction DTO (screen kind, copy, field labels).
 *
 * `createInteractionMapper` takes the screen plan as a parameter (mirroring
 * the Java class's constructor-injected ScreenPlanProperties) rather than
 * reading a global, so this module itself carries no market-specific
 * knowledge and a test can point it at hand-built plan data. The runtime
 * singleton below is just `createInteractionMapper(marketConfig.screenPlan)`.
 */

/**
 * Human labels for domain elements common enough to be worth naming
 * outright; anything else falls back to a de-camel-cased leaf. These are
 * Go's own generic Data Verification element names, not any one market's
 * copy, so they stay here rather than in per-market config.
 */
const LABELS: Record<string, string> = {
  'FullName/firstName': 'First name',
  'FullName/lastNames': 'Last name',
  DateOfBirth: 'Date of birth',
  'CurrentAddress/building': 'Building name or number',
  'CurrentAddress/thoroughfare': 'Street',
  'CurrentAddress/locality': 'Town or city',
  'CurrentAddress/postalCode': 'Postcode',
  'CurrentAddress/country': 'Country',
  'MobilePhone/number': 'Mobile number',
};

/** A human label for a domain element ref, falling back to a de-camel-cased leaf. */
function label(ref: string): string {
  const known = LABELS[ref];
  if (known) return known;
  const leaf = ref.includes('/') ? ref.slice(ref.lastIndexOf('/') + 1) : ref;
  const spaced = leaf.replace(/(?<!^)(?=[A-Z])/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Go's journey lifecycle is InProgress | Completed | Failed, plus Paused per
 * the glossary; the notification payload spells the failure case Error.
 * Both failure spellings are treated the same.
 */
export function isFailed(goStatus: string | undefined): boolean {
  return goStatus?.toLowerCase() === 'failed' || goStatus?.toLowerCase() === 'error';
}

function mapStatus(goStatus: string | undefined, processing: boolean | undefined): JourneyStatus {
  if (goStatus?.toLowerCase() === 'completed') return 'Completed';
  // Paused (awaiting an out-of-band event, e.g. a manual review) is not
  // waiting on the customer — reporting PendingInput would render an empty
  // form. It reads as still-running, which is what a processing screen
  // already shows.
  if (processing || goStatus?.toLowerCase() === 'paused') return 'InProgress';
  return 'PendingInput';
}

function mapDecision(result: { outcomeClassification?: string } | undefined): Decision {
  const classification = result?.outcomeClassification;
  if (!classification) return 'refer';
  switch (classification.toLowerCase()) {
    case 'positive':
      return 'pass';
    case 'negative':
      return 'fail';
    default:
      return 'refer';
  }
}

/** Positive/negative/other, falling back to `whenUnclassified` when Go hasn't reported one yet. */
function classify(outcomeClassification: string | undefined, whenUnclassified: ModuleState): ModuleState {
  if (!outcomeClassification) return whenUnclassified;
  switch (outcomeClassification.toLowerCase()) {
    case 'positive':
      return 'Pass';
    case 'negative':
      return 'Fail';
    default:
      return 'Review';
  }
}

/**
 * A step's state. result.status says whether the module ran to completion,
 * not what it decided — that verdict is outcomeClassification, on the step
 * itself. A module can complete and still decline (e.g. Document
 * Authentication finishing and finding the document fraudulent), so
 * status "complete" alone is not enough to call it a Pass.
 */
export function mapModuleState(step: GoStateStep): ModuleState {
  const status = step.result?.status?.toLowerCase();
  if (status) {
    switch (status) {
      case 'error':
      case 'timeout':
        return 'Fail';
      case 'pending':
        return 'Running';
      case 'complete':
        return classify(step.outcomeClassification, 'Review');
      default:
        return 'Review';
    }
  }
  return classify(step.outcomeClassification, 'Running');
}

function processingInteraction(interactionId: string): Interaction {
  return {
    interactionId,
    kind: 'processing',
    stage: 'Processing',
    title: 'Running your checks',
    body: 'This usually takes a few seconds.',
  };
}

function unmappedElementsInteraction(interactionId: string, outstanding: string[]): Interaction {
  console.warn(`No screen mapped for outstanding elements ${JSON.stringify(outstanding)} — falling back to a generic form`);
  const fields: FieldSchema[] = outstanding.map((ref) => ({ name: ref, label: label(ref) }));
  return {
    interactionId,
    kind: 'form',
    stage: 'More details',
    title: 'A few more details',
    body: 'We need a bit more information to continue.',
    cta: 'Continue',
    collects: fields,
  };
}

/** Fields for a form stage, derived from what Go says is outstanding. */
function fieldsFor(stage: ScreenPlanStage, outstanding: string[]): FieldSchema[] {
  return outstanding.filter((o) => o.startsWith(stage.prefix)).map((o) => ({ name: o, label: label(o) }));
}

/**
 * The action Go suggests for the first module that errored, or undefined
 * when none did. Distinguishes "the platform broke" from "the customer did
 * not pass", which read identically in the response's own decision fields.
 */
function firstModuleErrorAction(response: GoStateResponse): string | undefined {
  for (const step of allSteps(response)) {
    const action = firstStepErrorAction(step);
    if (action && action.trim() !== '') return action;
  }
  return undefined;
}

export interface InteractionMapper {
  toInteraction(response: GoInteractionFetchResponse): Interaction;
  toRecord(response: GoStateResponse): RecordResponse;
}

export function createInteractionMapper(screenPlan: ScreenPlanConfig): InteractionMapper {
  /** One screen from the plan, with a rail showing where the customer has got to. */
  function toStagedInteraction(interactionId: string, stage: ScreenPlanStage, outstanding: string[]): Interaction {
    let reachedCurrent = false;
    const rail: StagePlanEntry[] = screenPlan.stages.map((planStage) => {
      if (planStage.stage === stage.stage) {
        reachedCurrent = true;
        return { label: planStage.stage, state: 'active' as const };
      }
      return { label: planStage.stage, state: reachedCurrent ? ('upcoming' as const) : ('done' as const) };
    });

    return {
      interactionId,
      kind: stage.kind,
      stage: stage.stage,
      title: stage.title,
      body: stage.body,
      cta: stage.cta,
      captureType: stage.captureType as Interaction['captureType'],
      accepted: stage.accepted,
      collects: stage.kind === 'form' ? fieldsFor(stage, outstanding) : undefined,
      checks: stage.kind === 'consent' ? screenPlan.consentChecks : undefined,
      modules: stage.modules,
      stagePlan: rail,
    };
  }

  function toInteraction(response: GoInteractionFetchResponse): Interaction {
    const goStatus = response.journey?.status;
    const status = mapStatus(goStatus, response.processing);
    const interactionId = response.interactionId ?? response.instanceId ?? '';

    // A Failed journey is unrecoverable: no further interaction will ever
    // arrive. JourneyStatus has no Failed member, so this surfaces as what
    // that contract can represent: a terminal result screen carrying a fail
    // decision.
    if (isFailed(goStatus)) {
      return {
        interactionId,
        kind: 'result',
        stage: 'Decision',
        title: 'We could not complete your verification',
        body: 'Something went wrong while we were checking your details. No decision was reached.',
        cta: 'Done',
        decision: 'fail',
        summary: [],
      };
    }

    if (status === 'Completed') {
      const decision = mapDecision(response.result);
      return {
        interactionId,
        kind: 'result',
        stage: 'Decision',
        title: decision === 'fail' ? 'We could not complete your verification' : 'Verification complete',
        body: response.result?.outcome,
        cta: 'Done',
        decision,
        summary: [],
      };
    }

    if (status === 'InProgress') {
      return processingInteraction(interactionId);
    }

    const outstanding = response.outstanding ?? [];

    // Nothing outstanding but not yet Completed: modules are running.
    if (outstanding.length === 0) {
      return processingInteraction(interactionId);
    }

    // Go returns a single interaction listing everything still outstanding at
    // once; splitting that into screens is the client's job under
    // delivery: "api". The configured screen plan holds that decision — first
    // stage in order whose elements are still outstanding wins.
    const stage = screenPlan.stages.find((s) => outstanding.some((o) => o.startsWith(s.prefix)));
    if (stage) {
      return toStagedInteraction(interactionId, stage, outstanding);
    }
    // The plan doesn't recognise everything that's outstanding (e.g. a module
    // restored after the plan was written, or no plan configured for this
    // market at all yet). A plain form is at least usable, rather than
    // stalling on Processing forever.
    return unmappedElementsInteraction(interactionId, outstanding);
  }

  function toRecord(response: GoStateResponse): RecordResponse {
    // On a Failed journey the result object is often absent or incomplete;
    // mapDecision would default that to REFER, telling the customer a review
    // is under way when nothing is running at all.
    const decision: Decision = isFailed(response.status) ? 'fail' : mapDecision(response.result);
    const moduleRuns: ModuleRun[] = allSteps(response).map((step) => ({
      label: step.name ?? step.nodeId ?? '',
      state: mapModuleState(step),
    }));

    // A module that could not run is not a customer who failed a check.
    const moduleAdvice = firstModuleErrorAction(response);
    const systemError = decision === 'fail' && moduleAdvice !== undefined;

    const title = systemError
      ? 'We could not run your checks'
      : decision === 'pass'
        ? 'Verification complete'
        : decision === 'fail'
          ? 'We could not complete your verification'
          : 'With our team';

    const body = systemError
      ? moduleAdvice!
      : decision === 'pass'
        ? 'Your identity has been verified.'
        : decision === 'fail'
          ? 'We were not able to verify your identity from what you provided.'
          : 'Someone is reviewing your details. We will be in touch.';

    return {
      decision,
      title,
      timing: '',
      body,
      cta: systemError ? 'Try again' : 'Done',
      moduleRuns,
      summary: [],
    };
  }

  return { toInteraction, toRecord };
}

export const defaultInteractionMapper: InteractionMapper = createInteractionMapper(marketConfig.screenPlan);
