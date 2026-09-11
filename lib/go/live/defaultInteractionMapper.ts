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
import {
  allSteps,
  collectsOf,
  firstStepErrorAction,
  GoInteractionFetchResponse,
  GoStateResponse,
  GoStateStep,
} from './dto';

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
  'LandlinePhone/number': 'Landline number',
  'PersonalEmail/email': 'Personal email',
  'WorkEmail/email': 'Work email',
  MothersMaidenName: "Mother's maiden name",
  NationalInsuranceNumber: 'National Insurance number',
  SSN: 'Social Security number',
  PreviousAddresses: 'Previous address',
  Gender: 'Gender',
};

/**
 * Input types for elements the front end can render more helpfully than a
 * plain text box. Its FieldSchema type vocabulary is text | date | tel |
 * email | postcode — there is no select, so a coded field is a text box plus
 * the guidance below.
 */
const TYPES: Record<string, FieldSchema['type']> = {
  'CurrentAddress/postalCode': 'postcode',
  DateOfBirth: 'date',
  'MobilePhone/number': 'tel',
  'LandlinePhone/number': 'tel',
  'PersonalEmail/email': 'email',
  'WorkEmail/email': 'email',
};

/**
 * Guidance for fields Go validates against a format the label alone does not
 * convey. Country is the one that bites: Go requires /^[A-Z]{2,3}$/, so
 * "United Kingdom" is rejected with a 400 that reaches the customer as a
 * Continue button that does nothing.
 */
const HELPER_TEXT: Record<string, string> = {
  'CurrentAddress/country': 'Three-letter country code, e.g. GBR',
};

const PLACEHOLDERS: Record<string, string> = {
  'CurrentAddress/country': 'GBR',
  'CurrentAddress/postalCode': 'SW1A 2AA',
};

/**
 * Whether Go is waiting for the back of the document.
 *
 * Go names PrimaryDocument/side2Image in `outstanding` once Classification
 * has read side 1 and found a two-sided type, and separately instructs
 * Side2Required. Both are read, because the two do not always arrive together.
 *
 * LazySide2CollectionRequired deliberately does not count: it is the
 * pre-decision state, present from the very first fetch, and treating it as a
 * request would show the back-of-document screen before the front was taken.
 */
function side2Required(outstanding: string[] | undefined, instructions: string[] | undefined): boolean {
  if (outstanding?.includes('PrimaryDocument/side2Image')) return true;
  return instructions?.some((i) => i.toLowerCase() === 'side2required') ?? false;
}

/**
 * Whether Go has yet to say whether it wants the back of the document.
 *
 * LazySide2CollectionRequired is the pre-decision state: present from the
 * first fetch of a journey that might want a second side, and replaced by
 * Side2Required or Side2Done once Classification has read side 1 — measured
 * at about three seconds. Only meaningful once side 1 has been submitted.
 */
function side2Undecided(instructions: string[] | undefined): boolean {
  return instructions?.some((i) => i.toLowerCase() === 'lazyside2collectionrequired') ?? false;
}

/**
 * This stage rendered as the second document side.
 *
 * Reusing the stage keeps the progress rail honest — it is still the Document
 * step — while the copy and captureType change so the customer is told to
 * turn the document over, and the front end submits it as documentBack.
 */
function asSecondSide(stage: ScreenPlanStage): ScreenPlanStage {
  return {
    ...stage,
    name: `${stage.name}-side2`,
    title: 'Now the other side',
    body: 'Turn your document over and scan the back.',
    cta: stage.cta ?? 'Scan the back',
    captureType: 'document-back',
    alwaysCollect: true,
  };
}

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

/**
 * Fields for a form stage: the refs it claims, preferring the required ones.
 *
 * `collects` carries every optional field alongside the required ones —
 * CurrentAddress lists 18, of which five are required — and rendering all of
 * them puts a dozen boxes (postBox, doubleDependentLocality,
 * superAdministrativeArea …) on a screen nobody is asked to fill in. But a
 * stage can legitimately claim only optional refs, and filtering those out
 * would leave a form with a heading, a Continue button and nothing to type
 * into. So required-only when the stage has any, everything it claims
 * otherwise, with each field carrying its own requirement for the client.
 */
function claimsRef(stage: ScreenPlanStage, ref: string): boolean {
  return [stage.prefix, ...(stage.alsoPrefixes ?? [])].some((p) => ref.startsWith(p));
}

function fieldsFor(stage: ScreenPlanStage, outstanding: string[], requiredRefs: Set<string>): FieldSchema[] {
  const claimed = outstanding.filter((o) => claimsRef(stage, o));
  const required = claimed.filter((o) => requiredRefs.has(o));
  const shown = required.length > 0 ? required : claimed;
  return shown.map((o) => ({
    name: o,
    label: label(o),
    type: TYPES[o],
    placeholder: PLACEHOLDERS[o],
    helperText: HELPER_TEXT[o],
    required: requiredRefs.size === 0 || requiredRefs.has(o),
  }));
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
  /**
   * The next screen, given the stages already submitted on this journey.
   *
   * `completed` is required for a live journey: without it a multi-stage plan
   * re-picks its first stage on every fetch, because Go's `outstanding` never
   * shrinks.
   */
  toInteraction(response: GoInteractionFetchResponse, completed?: Set<string>): Interaction;
  toRecord(response: GoStateResponse): RecordResponse;
  /**
   * The plan stage a submit answers, or undefined if none matches.
   *
   * Matched on the submitted field names: a form stage's fields are named
   * after the domain element refs it claims, so the stage prefix identifies
   * them. Capture and consent screens send short names instead, which carry
   * no prefix, so those fall back to the first not-yet-completed stage of a
   * fitting kind — the stage the customer was being shown.
   */
  stageFor(submittedKeys: string[], completed: Set<string>): string | undefined;
  /** Whether the capture being submitted is the document one; undefined when no stage is current. */
  currentCaptureIsDocument(outstanding: string[], completed: Set<string>): boolean | undefined;
}

export function createInteractionMapper(screenPlan: ScreenPlanConfig): InteractionMapper {
  /** One screen from the plan, with a rail showing where the customer has got to. */
  function toStagedInteraction(
    interactionId: string,
    stage: ScreenPlanStage,
    outstanding: string[],
    requiredRefs: Set<string>
  ): Interaction {
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
      collects: stage.kind === 'form' ? fieldsFor(stage, outstanding, requiredRefs) : undefined,
      checks: stage.kind === 'consent' ? screenPlan.consentChecks : undefined,
      modules: stage.modules,
      stagePlan: rail,
    };
  }

  function toInteraction(response: GoInteractionFetchResponse, completed: Set<string> = new Set()): Interaction {
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

    // What this interaction can collect, preferring `collects` over
    // `outstanding`.
    //
    // `outstanding` names only what Go is currently blocking on, so an element
    // whose parent is optional never appears in it. On the Meridian journey
    // that is 8 refs against the 47 in `collects` — its consent,
    // personal-details, contact-details and address pages are all in that
    // difference, and selecting on `outstanding` drops them however the plan
    // is written.
    //
    // Falls back to `outstanding` when an interaction carries no collects:
    // the mock, and any journey predating the field.
    const collectable = collectsOf(response).map((c) => c.ref);
    const outstanding = collectable.length > 0 ? collectable : (response.outstanding ?? []);

    // The refs the journey marks required, so a form stage can render those and
    // leave the optional ones out. Empty when the interaction carries no
    // collects, which fieldsFor reads as "show everything named".
    const requiredRefs = new Set(
      collectsOf(response)
        .filter((c) => c.spec?.toLowerCase() === 'required')
        .map((c) => c.ref)
    );

    // Nothing to collect but not yet Completed: modules are running.
    if (outstanding.length === 0) {
      return processingInteraction(interactionId);
    }

    // Go returns a single interaction listing everything still outstanding at
    // once; splitting that into screens is the client's job under
    // delivery: "api". The configured screen plan holds that decision — first
    // stage in order whose elements are still outstanding wins.
    // Every configured stage submitted, while Go still lists what they
    // collect: the end of the collection phase on a journey whose
    // `outstanding` never shrinks. The modules are running.
    if (screenPlan.stages.length > 0 && screenPlan.stages.every((s) => completed.has(s.name))) {
      return processingInteraction(interactionId);
    }

    // The document stage holds until Go has finished with the document.
    //
    // Classification reads side 1 and, for a two-sided type, asks for the
    // back — but that answer does not come back with the submit: for a few
    // seconds the fetch still says LazySide2CollectionRequired and only then
    // settles on Side2Required or Side2Done. Advancing during that window
    // sends the customer to the selfie first, and the side-2 submit that
    // follows replaces subject.biometrics with the document's own anchor
    // image, leaving Facematch with no selfie to compare.
    const documentStage = screenPlan.stages.find((s) => claimsRef(s, 'PrimaryDocument/side1Image'));
    if (documentStage && completed.has(documentStage.name)) {
      if (side2Required(response.outstanding, response.instructions)) {
        return toStagedInteraction(interactionId, asSecondSide(documentStage), outstanding, requiredRefs);
      }
      // Classification has not answered yet. Waiting is the only correct move
      // — guessing wrong costs the customer their selfie.
      if (side2Undecided(response.instructions)) {
        return processingInteraction(interactionId);
      }
    }

    // First stage that still claims something and has not been submitted, or
    // is configured to run regardless. `completed` is what actually advances
    // the journey, since `outstanding` is a static declaration rather than a
    // shrinking list.
    const stage = screenPlan.stages.find(
      (s) => !completed.has(s.name) && (s.alwaysCollect || outstanding.some((o) => claimsRef(s, o)))
    );
    if (stage) {
      return toStagedInteraction(interactionId, stage, outstanding, requiredRefs);
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
    // Telling someone they were "Declined" when the platform errored is both
    // wrong and consequential — a decline invites an appeal, an error invites
    // another attempt.
    //
    // Detected on the errored step itself, not just on Go having supplied an
    // action for it: a module can fail with MODULE_EXECUTION_FAILED and no
    // advice at all, and reading only the advice reports that as a decline.
    // Three signals, any of which means the checks did not run to a verdict:
    //
    //  - the journey itself reports Error or Failed. This is the one that
    //    matters in practice: a module that could not execute may not appear
    //    in `steps` at all — a live Northbank run returns status=Error with
    //    only Address Verification listed and Document Classification absent
    //    entirely — so the failed step is invisible, and the journey status
    //    is the only thing saying anything went wrong;
    //  - a step carrying `result.error`, which is where an errored step
    //    reports itself rather than through a status of "error";
    //  - a step whose status is literally "error".
    //
    // Not gated on decision === 'fail': a journey whose module errored can
    // still report InProgress, where mapDecision defaults to refer. Gating on
    // the decision then shows a platform failure as a review under way, or as
    // a decline, when nothing was decided about the customer at all.
    const moduleAdvice = firstModuleErrorAction(response);
    const systemError =
      isFailed(response.status) ||
      allSteps(response).some((s) => s.result?.error !== undefined || s.result?.status?.toLowerCase() === 'error');

    const title = systemError
      ? 'We could not run your checks'
      : decision === 'pass'
        ? 'Verification complete'
        : decision === 'fail'
          ? 'We could not complete your verification'
          : 'With our team';

    const body = systemError
      ? (moduleAdvice ?? 'We could not run your checks. Nothing has been decided about you — please try again.')
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
      systemError,
    };
  }

  function stageFor(submittedKeys: string[], completed: Set<string>): string | undefined {
    const remaining = screenPlan.stages.filter((s) => !completed.has(s.name));

    if (submittedKeys.length === 0) {
      // A screen whose fields were all optional and all left blank. There are
      // no names to identify it by, but the customer pressed Continue on the
      // screen they were shown — the first form stage still outstanding.
      // Captures and consent always submit something, so an empty submit
      // cannot have come from one.
      return remaining.find((s) => s.kind === 'form')?.name;
    }

    // A prefixed field name identifies its stage outright.
    for (const stage of remaining) {
      if (submittedKeys.some((key) => claimsRef(stage, key))) return stage.name;
    }

    // Short names from a capture screen: match the element the stage
    // collects against the key.
    for (const stage of remaining) {
      const element = stage.prefix.endsWith('/') ? stage.prefix.slice(0, -1) : stage.prefix;
      const hit = submittedKeys.some((key) => {
        const k = key.toLowerCase();
        if (element === 'Selfie' && k.includes('selfie')) return true;
        if (element === 'PrimaryDocument' && k.includes('document')) return true;
        return false;
      });
      if (hit) return stage.name;
    }

    // A consent screen submits its checkbox names, which match nothing above.
    // It is the only kind whose payload need not name its element.
    return remaining.find((s) => s.kind === 'consent')?.name;
  }

  /**
   * Whether the capture now being submitted is the document one.
   *
   * Selected by the same rule that rendered the screen, so the classification
   * and the screen cannot disagree. Reading `outstanding` for a
   * PrimaryDocument/ entry instead is wrong on a journey that collects the
   * document lazily and never lists it: every capture then looks like a
   * selfie, and the document lands in subject.biometrics where Document
   * Classification never sees it.
   *
   * undefined when no configured stage is current, and the caller falls back
   * to reading `outstanding` directly.
   */
  function currentCaptureIsDocument(outstanding: string[], completed: Set<string>): boolean | undefined {
    const stage = screenPlan.stages.find(
      (s) =>
        !completed.has(s.name) &&
        (s.alwaysCollect || outstanding.some((o) => claimsRef(s, o))) &&
        (s.kind === 'capture' || s.kind === 'upload')
    );
    if (!stage) return undefined;
    return stage.captureType === 'document' || stage.prefix.startsWith('PrimaryDocument');
  }

  return { toInteraction, toRecord, stageFor, currentCaptureIsDocument };
}

export const defaultInteractionMapper: InteractionMapper = createInteractionMapper(marketConfig.screenPlan);
