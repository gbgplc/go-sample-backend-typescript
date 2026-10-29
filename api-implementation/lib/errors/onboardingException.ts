import { ErrorCode } from '../dto/types';

/** Each code owns one HTTP status and one client treatment — mirrors Java's ErrorCode enum. */
const ERROR_CODE_TABLE: Record<ErrorCode, { httpStatus: number; defaultRetryable: boolean }> = {
  VALIDATION_FAILED: { httpStatus: 422, defaultRetryable: true },
  SESSION_EXPIRED: { httpStatus: 410, defaultRetryable: false },
  INTERACTION_STALE: { httpStatus: 409, defaultRetryable: true },
  UPSTREAM_UNAVAILABLE: { httpStatus: 503, defaultRetryable: true },
  RATE_LIMITED: { httpStatus: 429, defaultRetryable: true },
  BAD_REQUEST: { httpStatus: 400, defaultRetryable: false },
};

/** Carries an ErrorCode straight through to the HTTP response as the contract's error envelope. */
export class OnboardingException extends Error {
  readonly retryable: boolean;

  private constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    retryable: boolean = ERROR_CODE_TABLE[code].defaultRetryable
  ) {
    super(message);
    this.name = 'OnboardingException';
    this.retryable = retryable;
  }

  get httpStatus(): number {
    return ERROR_CODE_TABLE[this.code].httpStatus;
  }

  static validationFailed(message: string, fields?: Record<string, string>): OnboardingException {
    return new OnboardingException('VALIDATION_FAILED', message, fields);
  }

  static sessionExpired(message: string): OnboardingException {
    return new OnboardingException('SESSION_EXPIRED', message);
  }

  static interactionStale(message: string): OnboardingException {
    return new OnboardingException('INTERACTION_STALE', message);
  }

  static upstreamUnavailable(message: string): OnboardingException {
    return new OnboardingException('UPSTREAM_UNAVAILABLE', message);
  }

  /**
   * Go can't do this, and asking again won't change that — a configuration
   * fault such as a journey or test scenario that doesn't exist. Same code as
   * `upstreamUnavailable`, but not retryable, so the client doesn't offer
   * "Try again" (which, at journey start, would create another Go instance
   * each time). Mirrors Java's OnboardingException.upstreamMisconfigured.
   */
  static upstreamMisconfigured(message: string): OnboardingException {
    return new OnboardingException('UPSTREAM_UNAVAILABLE', message, undefined, false);
  }

  static rateLimited(message: string): OnboardingException {
    return new OnboardingException('RATE_LIMITED', message);
  }

  static badRequest(message: string): OnboardingException {
    return new OnboardingException('BAD_REQUEST', message);
  }
}
