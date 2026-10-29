import { Interaction, JourneyStatus, RecordResponse, StateResponse, SubmitInteractionResponse } from '../../dto/types';
import { defaultTestScenario, goMode, marketConfig, resolveGoBaseUrl, SCENARIO_NAME } from '../../config';
import { OnboardingException } from '../../errors/onboardingException';
import { GoClient, GoStartResult } from '../goClient';
import { buildSubmitRequest, fieldsByGoPath } from './buildSubmitRequest';
import { defaultInteractionMapper, isFailed, resultFailed } from './defaultInteractionMapper';
import {
  collectsOf,
  GoErrorEnvelope,
  GoInstanceRequest,
  GoInteractionFetchResponse,
  GoStartRequest,
  GoStartResponse,
  GoStateResponse,
  isTestRun,
} from './dto';
import { getAccessToken, invalidate } from './goTokenService';

/**
 * Real GBG Go v2 integration. Every path here corresponds to a documented
 * endpoint: token mint, POST journey/start, POST journey/interaction/fetch,
 * POST journey/interaction/submit, POST journey/state/fetch.
 *
 * Structurally complete against the documented shapes, but not run against a
 * live tenant in building this port — there is no published journey or
 * credential set available here to test against. Treat first use against a
 * real environment as an integration test, not an assumption.
 */

/**
 * Last outstanding-elements list seen per Go instance, so a capture submit
 * can tell document from selfie without an extra fetch. Bounded (LRU-ish via
 * delete+reinsert) rather than unbounded — nothing here ever removes an
 * instance on session expiry or journey completion. Stashed on globalThis,
 * same as sessionStore and mockGoClient, so `next dev`'s hot-reload doesn't
 * wipe it out from under an in-flight live-mode session on every file save.
 */
const MAX_CACHED_INSTANCES = 10_000;

/** Sets `instanceId` as the most recently used entry, evicting the least recently used past the bound. */
function rememberBounded<V>(cache: Map<string, V>, instanceId: string, value: V): void {
  cache.delete(instanceId);
  cache.set(instanceId, value);
  if (cache.size > MAX_CACHED_INSTANCES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

const globalForGoApiClient = globalThis as unknown as { __lastOutstandingByInstance?: Map<string, string[]> };
const lastOutstandingByInstance: Map<string, string[]> =
  globalForGoApiClient.__lastOutstandingByInstance ?? new Map();
globalForGoApiClient.__lastOutstandingByInstance = lastOutstandingByInstance;

/**
 * Stage names already submitted, per Go instance — the journey's progress.
 *
 * Go's `outstanding` is a static declaration of everything the journey
 * collects, not a shrinking to-do list: it comes back byte-identical after a
 * successful submit. That breaks the rule the screen plan was written
 * against — "first stage whose elements are still outstanding wins" — because
 * the first stage always still claims something. The customer submits the
 * consent screen, the next fetch picks the same stage again, and the journey
 * loops on screen one forever.
 *
 * Same lifetime and bound as the outstanding cache above: in-memory and
 * single-node, which is what the session store already is.
 */
const globalForStages = globalThis as unknown as { __completedStagesByInstance?: Map<string, Set<string>> };
const completedStagesByInstance: Map<string, Set<string>> =
  globalForStages.__completedStagesByInstance ?? new Map();
globalForStages.__completedStagesByInstance = completedStagesByInstance;

function completedStages(instanceId: string): Set<string> {
  return new Set(completedStagesByInstance.get(instanceId) ?? []);
}

function recordStage(instanceId: string, stageName: string): void {
  const done = completedStagesByInstance.get(instanceId) ?? new Set<string>();
  done.add(stageName);
  rememberBounded(completedStagesByInstance, instanceId, done);
}

/**
 * Last instructions seen per instance, so a capture submit can tell the back
 * of a document from the front without an extra fetch — the same reason the
 * outstanding cache exists. Side2Required is the signal that matters.
 */
const globalForInstructions = globalThis as unknown as { __lastInstructionsByInstance?: Map<string, string[]> };
const lastInstructionsByInstance: Map<string, string[]> =
  globalForInstructions.__lastInstructionsByInstance ?? new Map();
globalForInstructions.__lastInstructionsByInstance = lastInstructionsByInstance;

function rememberInstructions(instanceId: string, instructions: string[] | undefined): void {
  if (!instructions) return;
  rememberBounded(lastInstructionsByInstance, instanceId, instructions);
}

/**
 * Last `collects` refs seen per instance (falling back to `outstanding` when
 * the interaction carries none) — the list the screen was chosen from. A
 * capture is routed by the same list, or a document the journey collects but
 * does not list as outstanding renders the document screen and then goes out
 * as a selfie. Mirrors go-sample-backend-java's lastCollectableByInstance.
 */
const globalForCollectable = globalThis as unknown as { __lastCollectableByInstance?: Map<string, string[]> };
const lastCollectableByInstance: Map<string, string[]> =
  globalForCollectable.__lastCollectableByInstance ?? new Map();
globalForCollectable.__lastCollectableByInstance = lastCollectableByInstance;

function rememberCollectable(instanceId: string, collectable: string[]): void {
  rememberBounded(lastCollectableByInstance, instanceId, collectable);
}

function rememberOutstanding(instanceId: string, outstanding: string[] | undefined): void {
  if (!outstanding) return;
  rememberBounded(lastOutstandingByInstance, instanceId, outstanding);
}

/** The journey/start header that names the test scenario a run uses. */
export const SCENARIO_HEADER = 'x-gbg-scenario';

/**
 * The test scenario this journey starts on: the front end's ?mock_scenario=
 * when it names one, otherwise the market's go.testScenario. Undefined
 * outside test-scenarios mode.
 *
 * A name that isn't a valid scenario name is refused rather than swapped for
 * the default: the default is usually a pass scenario, and a tester who asked
 * for the refer path and quietly got an approval would conclude the refer
 * path works.
 */
export function scenarioFor(scenarioHint: string | null): string | undefined {
  if (goMode !== 'test-scenarios') return undefined;
  if (scenarioHint === null || scenarioHint.trim() === '') {
    if (defaultTestScenario === undefined) {
      console.error(
        'Test scenarios mode, but no scenario to start on: set go.testScenario for this market ' +
          'or open the app with ?mock_scenario=<scenario-name>'
      );
      throw OnboardingException.upstreamMisconfigured('This test journey has no test scenario configured.');
    }
    return defaultTestScenario;
  }
  const named = scenarioHint.trim();
  if (!SCENARIO_NAME.test(named)) {
    // The value itself is not logged: it comes straight from the browser.
    console.warn('Refusing ?mock_scenario=: not a valid test scenario name (letters, numbers, _ and -, up to 64)');
    throw OnboardingException.badRequest(
      '?mock_scenario= is not a valid test scenario name: use letters, numbers, _ and -, up to 64 characters.'
    );
  }
  return named;
}

/** Connect plus read, per call. Without it a stalled Go call holds the session lock indefinitely. */
const TIMEOUT_MS = 15_000;

function post(path: string, body: unknown, token: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${resolveGoBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * POSTs with the current access token, retrying once with a freshly minted
 * one if Go answers 401/403 — a token Go stopped accepting before its expiry
 * would otherwise stay cached and fail every call until it lapsed. A second
 * rejection is returned for `call` to classify.
 */
async function authedFetch(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const token = await getAccessToken();
  const response = await post(path, body, token, extraHeaders);
  if (response.status !== 401 && response.status !== 403) return response;
  console.warn(`GBG Go rejected the access token (${response.status}); minting a new one and retrying once`);
  invalidate(token);
  return post(path, body, await getAccessToken(), extraHeaders);
}

/** Every `errors[].problem` in a Go error body, joined with "; " — empty if it isn't that shape. */
export function goProblems(body: string): string {
  try {
    const envelope = JSON.parse(body) as GoErrorEnvelope;
    return envelope.errors?.map((e) => e.problem).filter(Boolean).join('; ') ?? '';
  } catch {
    return '';
  }
}

/**
 * Submitted field → Go's message, for every `path: message` segment in
 * `problems` whose path this submit sent (live format:
 * `context.subject.identity.phones.0.number: Invalid phone number`).
 */
export function rejectedFields(problems: string, fieldsByGoPath: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const segment of problems.split(/;\s*/)) {
    const colon = segment.indexOf(': ');
    if (colon <= 0) continue;
    const field = fieldsByGoPath[segment.slice(0, colon).trim()];
    if (field && !(field in fields)) fields[field] = segment.slice(colon + 2).trim();
  }
  return fields;
}

/** A caller's own reading of a status Go refused with; undefined leaves it to `call`'s defaults. */
type Refusal = (status: number, problems: string) => OnboardingException | undefined;

/**
 * @param fieldsByGoPath for a submit, where each submitted field landed in
 *   the request (see `fieldsByGoPath` in buildSubmitRequest), so a 400/422
 *   can name the fields Go rejected.
 * @param refusal consulted first once Go has refused the call, after the token retry.
 */
async function call<T>(
  request: () => Promise<Response>,
  fieldsByGoPath: Record<string, string> = {},
  refusal: Refusal = () => undefined
): Promise<T | undefined> {
  let response: Response;
  let text: string;
  try {
    response = await request();
    text = await response.text();
  } catch (e) {
    console.error('Could not reach GBG Go', e);
    throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
  }

  if (response.ok) {
    try {
      return text ? (JSON.parse(text) as T) : undefined;
    } catch {
      console.error(`GBG Go returned a body that is not JSON (${response.status})`);
      throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
    }
  }

  const problems = goProblems(text);
  console.warn(`GBG Go call failed: ${response.status} ${problems || text}`);

  const classified = refusal(response.status, problems || text);
  if (classified) throw classified;
  if (response.status === 404 || response.status === 410) {
    throw OnboardingException.sessionExpired('Your session has ended. Start again to continue.');
  }
  if (response.status === 400 || response.status === 422) {
    const fields = rejectedFields(problems, fieldsByGoPath);
    throw OnboardingException.validationFailed(
      'Some of the details you entered could not be verified.',
      Object.keys(fields).length > 0 ? fields : undefined
    );
  }
  if (response.status === 429) {
    throw OnboardingException.rateLimited('Too many attempts. Wait a moment and try again.');
  }
  throw OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');
}

/** A `path: message` segment naming something the start request's context carried, i.e. the prefill. */
const CONTEXT_PROBLEM = /(^|;\s*)context\.[^:;]*: /;

/**
 * How a refused journey/start reaches the customer. There is no session yet,
 * so `call`'s defaults mislead here: a 404 or 410 would say "Your session has
 * ended", and on a test scenario a 400 or 422 would show as a field error on
 * a screen the customer hasn't filled in. We don't know which of the three Go
 * uses for a scenario it can't run, so all three are covered — except a
 * 400/422 naming a `context.` path, which is Go rejecting the prefill and
 * stays a field error.
 *
 * Each of these is a configuration fault that retrying can't fix, so none is
 * retryable.
 */
function startRefusal(scenario: string | undefined): Refusal {
  return (status, problems) => {
    if (scenario && status === 403) {
      // By now authedFetch has retried with a fresh token, so it isn't the token.
      console.warn(
        `GBG Go answered journey/start on test scenario '${scenario}' with 403, even with a fresh token. ` +
          'Test scenarios may not be enabled for this organisation.'
      );
      return OnboardingException.upstreamMisconfigured('This test journey could not start on its test scenario.');
    }
    const notFound = status === 404 || status === 410;
    if (notFound && !scenario) {
      console.error(`GBG Go answered journey/start with ${status}. Check this market's resourceId names a published journey.`);
      return OnboardingException.upstreamMisconfigured('Could not start your verification.');
    }
    const scenarioRefused =
      scenario !== undefined && (status === 400 || status === 422) && !CONTEXT_PROBLEM.test(problems);
    if (notFound || scenarioRefused) {
      console.error(
        `GBG Go refused journey/start on test scenario '${scenario}' (${status}): ${problems}. Check the scenario ` +
          "is saved on this journey (Journey builder → Test Scenarios) and its outcome names match the journey's " +
          "exactly. A 404 can also mean the journey itself doesn't exist: check this market's resourceId."
      );
      return OnboardingException.upstreamMisconfigured('This test journey could not start on its test scenario.');
    }
    return undefined;
  };
}

function statusFrom(interaction: Interaction): JourneyStatus {
  if (interaction.kind === 'processing') return 'InProgress';
  if (interaction.kind === 'result') return interaction.decision !== undefined ? 'Completed' : 'PendingInput';
  return 'PendingInput';
}

async function fetchInteraction(instanceId: string): Promise<SubmitInteractionResponse> {
  const response = await call<GoInteractionFetchResponse>(() =>
    authedFetch('journey/interaction/fetch', { instanceId } satisfies GoInstanceRequest)
  );
  if (!response) {
    throw OnboardingException.upstreamUnavailable('Could not read your verification status. Try again shortly.');
  }
  // Always overwritten, empty when Go omits the field: keeping the last
  // non-empty value let a stale Side2Required outlive the document screen
  // and route the selfie into side2Image (found and fixed in
  // go-sample-backend-java).
  rememberOutstanding(instanceId, response.outstanding ?? []);
  rememberInstructions(instanceId, response.instructions ?? []);
  const collectable = collectsOf(response).map((collect) => collect.ref);
  rememberCollectable(instanceId, collectable.length > 0 ? collectable : (response.outstanding ?? []));
  const interaction = defaultInteractionMapper.toInteraction(response, completedStages(instanceId));
  return { status: statusFrom(interaction), interaction };
}

/**
 * Rewrites the front end's capture submission into a field the submit
 * mapping recognises. The capture screen posts {attachmentRef: <base64>}
 * for both a document and a selfie, so the distinction has to come from the
 * journey's own state: whichever image element is still outstanding is the
 * one being answered. The front end always fetches the current interaction
 * to render the screen it's now submitting, so fetchInteraction has already
 * populated the cache for this instance — a live fetch is only the
 * fallback, for the unlikely case nothing has been cached yet.
 */
async function resolveAttachment(
  instanceId: string,
  data: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  const ref = data?.['attachmentRef'];
  if (ref === undefined) return data;

  // Cache miss: one full fetch populates every cache read below.
  if (!lastOutstandingByInstance.has(instanceId)) {
    await fetchInteraction(instanceId);
  }
  const outstanding = lastOutstandingByInstance.get(instanceId) ?? [];
  // The back of the document, when Go has asked for it. Checked first: by
  // this point side 1 is submitted and the document stage counts as
  // completed, so the stage-based check below would read the capture as the
  // selfie and overwrite the wrong element.
  const instructions = lastInstructionsByInstance.get(instanceId) ?? [];
  if (instructions.some((i) => i.toLowerCase() === 'side2required') || outstanding.includes('PrimaryDocument/side2Image')) {
    const back = { ...data };
    delete back['attachmentRef'];
    back['documentBack'] = ref;
    return back;
  }

  // Which capture this is, from the stage the customer is actually on.
  // Reading `outstanding` alone is wrong wherever the journey does not
  // advertise the element: a lazily collected document is never listed, so
  // every capture reads as a selfie and the document lands in
  // subject.biometrics where Document Classification never sees it.
  //
  // Routed by the collectable list the screen was chosen from, not raw
  // `outstanding`: a document whose parent element is optional is in
  // `collects` but never in `outstanding`.
  const collectable = lastCollectableByInstance.get(instanceId) ?? outstanding;
  const fromStage = defaultInteractionMapper.currentCaptureIsDocument(collectable, completedStages(instanceId));
  const document = fromStage ?? collectable.some((o) => o.startsWith('PrimaryDocument/'));

  const rewritten = { ...data };
  delete rewritten['attachmentRef'];
  rewritten[document ? 'documentImage' : 'selfieImage'] = ref;
  return rewritten;
}

async function fetchGoState(instanceId: string): Promise<GoStateResponse> {
  const response = await call<GoStateResponse>(() =>
    authedFetch('journey/state/fetch', { instanceId } satisfies GoInstanceRequest)
  );
  if (!response) {
    throw OnboardingException.upstreamUnavailable('Could not read your verification status. Try again shortly.');
  }
  return response;
}

export const goApiClient: GoClient = {
  /**
   * In test-scenarios mode the start request carries the x-gbg-scenario
   * header, and only the start request: Go ties the scenario to the
   * instance, so the fetches and submits after it are unchanged.
   */
  async startJourney(resourceId, prefill, scenarioHint): Promise<GoStartResult> {
    const scenario = scenarioFor(scenarioHint);
    const request: GoStartRequest = {
      resourceId,
      context: { config: { delivery: 'api' }, subject: prefill ?? {} },
    };
    const headers: Record<string, string> = scenario ? { [SCENARIO_HEADER]: scenario } : {};
    const started = await call<GoStartResponse>(
      () => authedFetch('journey/start', request, headers),
      {},
      startRefusal(scenario)
    );
    if (!started?.instanceId) {
      throw OnboardingException.upstreamUnavailable('Could not start your verification. Try again shortly.');
    }
    if (scenario) {
      // Asked for a test run but Go did not confirm one. Only Go's reply to
      // journey/start can say whether the scenario took, so by now the
      // instance exists, with whatever prefill the start carried. What
      // stopping here prevents is everything after: no fetch, no submit, so
      // the customer's details and captures never reach a journey that would
      // check them for real. The instance ID is logged so it can be found in
      // GBG Go.
      if (!isTestRun(started)) {
        console.error(
          `Asked GBG Go for test scenario '${scenario}' but instance ${started.instanceId} did not start as a ` +
            `test run (test: ${started.test}). Abandoning it before any interaction, so no details reach it.`
        );
        throw OnboardingException.upstreamMisconfigured('This test journey could not start on its test scenario.');
      }
      // A run on some other scenario is the silent swap scenarioFor refuses
      // to make: its outcomes would be read as this scenario's.
      if (started.scenario !== undefined && started.scenario !== scenario) {
        console.error(
          `Asked GBG Go for test scenario '${scenario}' but instance ${started.instanceId} started on scenario ` +
            `'${started.scenario}'. Abandoning it before any interaction.`
        );
        throw OnboardingException.upstreamMisconfigured('This test journey could not start on its test scenario.');
      }
      console.info(
        `Started test run ${started.instanceId} on scenario '${scenario}': modules return the scenario's outcomes, no live checks`
      );
    }
    const first = await fetchInteraction(started.instanceId);
    return { instanceId: started.instanceId, status: first.status, interaction: first.interaction, testScenario: scenario };
  },

  fetchInteraction,

  async submitInteraction(instanceId, interactionId, data): Promise<SubmitInteractionResponse> {
    const payload = await resolveAttachment(instanceId, data);
    // Which stage this submit answers, read before the call so a Go rejection
    // leaves progress untouched — a failed submit must not mark its stage
    // done, or a validation error would skip the screen the customer still
    // has to correct.
    const submittedStage = defaultInteractionMapper.stageFor(Object.keys(payload ?? {}), completedStages(instanceId));
    await call(
      () =>
        authedFetch(
          'journey/interaction/submit',
          buildSubmitRequest(instanceId, interactionId, payload, marketConfig.app.consentUrl, marketConfig.app.consentTerms)
        ),
      fieldsByGoPath(payload)
    );
    if (submittedStage) recordStage(instanceId, submittedStage);
    // The submit response only acknowledges receipt; the next screen comes
    // from re-fetching the interaction, same as the mock's own response shape.
    return fetchInteraction(instanceId);
  },

  async fetchState(instanceId): Promise<StateResponse> {
    const response = await fetchGoState(instanceId);
    // A Failed journey is terminal. Reporting IN_PROGRESS would leave the
    // front end's processing screen polling an instance that will never
    // advance, so it reports Completed — the decision it carries is fail.
    //
    const asRecord = defaultInteractionMapper.toRecord(response);

    // A journey that has decided without its status reaching Completed is
    // terminal too. Northbank settles on `refer` and Go leaves the instance
    // open for the out-of-band manual review — `outstanding` names
    // ManualReviewDecision, and the status stays InProgress indefinitely
    // (verified 2026-09-17, instance IP1C5YOS5F0w72elvqa4WM). Polling on
    // status alone spins until the client's cap and then reports a failure,
    // with the decision sitting in the very response being ignored.
    //
    // `asRecord.decision` cannot answer this alone: mapDecision defaults a
    // missing result to 'refer', so it is set from the first poll onwards. The
    // decision is real only once Go sent a result carrying a classification
    // and every module that ran has stopped running. Mirrors the Java
    // backend's fetchState.
    //
    // `!= null`, not `!== undefined`: Go may send the field as an explicit
    // null while the journey is between modules, which is not a decision.
    const carriesRealResult = response.result?.outcomeClassification != null;
    const everyModuleSettled =
      asRecord.moduleRuns !== undefined &&
      asRecord.moduleRuns.length > 0 &&
      !asRecord.moduleRuns.some((run) => run.state === 'Running');
    const decided = carriesRealResult && everyModuleSettled;

    // A result.status of error is terminal too, whatever the journey status
    // says: the journey ended in failure or was abandoned and will not move.
    const status: JourneyStatus =
      response.status?.toLowerCase() === 'completed' ||
      isFailed(response.status) ||
      resultFailed(response.result) ||
      decided
        ? 'Completed'
        : 'InProgress';
    return { status, decision: asRecord.decision, moduleRuns: asRecord.moduleRuns };
  },

  /** A test run's "Test run" row is added by sessionService, which holds the scenario with the session. */
  async fetchRecord(instanceId): Promise<RecordResponse> {
    return defaultInteractionMapper.toRecord(await fetchGoState(instanceId));
  },
};
