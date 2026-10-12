import { SubmitInteractionResponse } from '../dto/types';
import { deepEqual } from './deepEqual';

/**
 * The session-to-instance mapping — the one thing this service is the
 * source of truth for. Everything about the journey itself lives in Go,
 * addressed by goInstanceId. In-memory and single-node, same as the Java
 * backend's documented simplification.
 */
export class Session {
  currentInteractionId: string | null;
  lastAccessedAt: number;

  private lastSubmittedInteractionId: string | null = null;
  private lastSubmittedData: Record<string, unknown> | undefined = undefined;
  private lastSubmittedResponse: SubmitInteractionResponse | null = null;

  constructor(
    readonly id: string,
    readonly cookieToken: string,
    readonly goInstanceId: string,
    initialInteractionId: string | null,
    readonly createdAt: number = Date.now()
  ) {
    this.currentInteractionId = initialInteractionId;
    this.lastAccessedAt = createdAt;
  }

  touch(): void {
    this.lastAccessedAt = Date.now();
  }

  /** Records a successful advance so a retried submit of the same step can be answered from cache. */
  recordAdvance(
    submittedInteractionId: string,
    submittedData: Record<string, unknown> | undefined,
    response: SubmitInteractionResponse
  ): void {
    this.lastSubmittedInteractionId = submittedInteractionId;
    this.lastSubmittedData = submittedData;
    this.lastSubmittedResponse = response;
    this.currentInteractionId = response.interaction?.interactionId ?? null;
  }

  /**
   * Whether this submit repeats the one just made.
   *
   * Against a live Go journey the interactionId alone can't answer that: Go
   * returns a single interaction (segment1@latest) for the whole
   * data-collection phase, so the id stays identical from the first screen to
   * the last. A true retry is the same interactionId AND the same payload —
   * same id with different data is the next step, not a repeat.
   */
  isRetryOf(interactionId: string, data: Record<string, unknown> | undefined): boolean {
    if (this.lastSubmittedInteractionId === null || this.lastSubmittedInteractionId !== interactionId) {
      return false;
    }
    return deepEqual(this.lastSubmittedData, data);
  }

  cachedResponse(): SubmitInteractionResponse | null {
    return this.lastSubmittedResponse;
  }
}
