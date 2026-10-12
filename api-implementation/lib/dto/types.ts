/**
 * The wire contract from "Market onboarding applications — front-end
 * handoff", section 2 — must match the frontend's own
 * `onboarding-core/src/types.ts` field-for-field, and the Java backend's
 * `api/dto/*.java` records. One file here, unlike Java's one-record-per-file
 * convention, matching the frontend's own consolidation.
 */

export type ScreenKind =
  | 'intro'
  | 'form'
  | 'choice'
  | 'capture'
  | 'upload'
  | 'consent'
  | 'processing'
  | 'result';

/** No `Failed` member — a Go Failed/Error journey maps to Completed + decision 'fail'. */
export type JourneyStatus = 'InProgress' | 'PendingInput' | 'Completed';

export type Decision = 'pass' | 'refer' | 'fail';

export type ModuleState = 'Pass' | 'Running' | 'Review' | 'Fail' | 'Skipped';

export type StageState = 'done' | 'active' | 'upcoming';

/**
 * The one enum whose wire value is the SCREAMING_SNAKE_CASE identifier
 * itself, not a translated string — matches Java's `ErrorCode` exactly (no
 * `@JsonValue` there).
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'SESSION_EXPIRED'
  | 'INTERACTION_STALE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'RATE_LIMITED';

export interface ModuleRun {
  label: string;
  state: ModuleState;
  ms?: string;
  /**
   * Go's own descriptive result for this module — e.g. "Document
   * Classified", "Extraction Successful", "No Match" — the same text shown
   * in the Go platform's own investigation UI. Worth showing because `state`
   * alone often cannot: a module with no positive/negative verdict of its
   * own (Document Classification, Extraction) always maps to `Review`
   * regardless of how it actually went, so the coloured badge carries the
   * state and this carries the detail.
   */
  outcome?: string;
}

export interface SummaryRow {
  k: string;
  v: string;
}

export interface FieldSchema {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'tel' | 'email' | 'postcode';
  placeholder?: string;
  helperText?: string;
  required?: boolean;
}

export interface ChoiceOption {
  value: string;
  label: string;
  detail?: string;
  icon?: string;
}

export interface ConsentCheck {
  name: string;
  label: string;
  detail?: string;
  defaultChecked?: boolean;
}

export interface StagePlanEntry {
  label: string;
  state: StageState;
}

/** Field order matches Interaction.java's constructor order — kept for readability parity, not a wire requirement (JSON objects are unordered). */
export interface Interaction {
  interactionId: string;
  kind: ScreenKind;
  stage: string;
  eyebrow?: string;
  title: string;
  body?: string;
  note?: string;
  cta?: string;
  secondaryCta?: string;
  /**
   * 'document-back' is the second side of a two-sided document: the same
   * rear-facing capture as 'document', distinct so the screen can say which
   * side is wanted and the backend can route it to side2Image.
   */
  captureType?: 'document' | 'document-back' | 'selfie';
  accepted?: string[];
  collects?: FieldSchema[];
  options?: ChoiceOption[];
  checks?: ConsentCheck[];
  modules?: string[];
  moduleRuns?: ModuleRun[];
  decision?: Decision;
  timing?: string;
  summary?: SummaryRow[];
  recordNote?: string;
  stagePlan?: StagePlanEntry[];
}

export interface ErrorEnvelope {
  code: ErrorCode;
  http: number;
  message: string;
  fields?: Record<string, string>;
  retryable: boolean;
}

export interface StartSessionRequest {
  prefill?: Record<string, unknown>;
}

export interface StartSessionResponse {
  sessionId: string;
  status: JourneyStatus;
  interaction: Interaction;
}

export interface SubmitInteractionRequest {
  interactionId: string;
  data?: Record<string, unknown>;
}

export interface SubmitInteractionResponse {
  status: JourneyStatus;
  interaction: Interaction;
}

export interface StateResponse {
  status: JourneyStatus;
  decision?: Decision;
  moduleRuns?: ModuleRun[];
}

export interface RecordResponse {
  decision: Decision;
  title: string;
  timing: string;
  body: string;
  cta: string;
  moduleRuns: ModuleRun[];
  summary: SummaryRow[];
  recordNote?: string;
  /**
   * The checks could not run, as opposed to running and declining.
   *
   * Carried explicitly because the two are indistinguishable from `decision`
   * alone — both arrive as `fail` — and they mean opposite things to the
   * customer: a decline is a verdict to appeal, an error is a reason to try
   * again. The service knows which it is, so it says so rather than leaving
   * each client to infer it and get it wrong.
   */
  systemError?: boolean;
}

export interface AttachmentResponse {
  attachmentRef: string;
}

export interface AppConfigResponse {
  brand: string;
  mark: string;
  tagline: string;
  accent: string;
  accentSoft: string;
  helpLine: string;
  journeyName: string;
  resourceId: string;
}
