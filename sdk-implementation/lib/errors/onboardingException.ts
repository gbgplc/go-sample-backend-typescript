import { ErrorCode } from '../dto/types';

/** Each code owns one HTTP status and one client treatment — mirrors Java's ErrorCode enum. */
const ERROR_CODE_TABLE: Record<ErrorCode, { httpStatus: number; defaultRetryable: boolean }> = {
  VALIDATION_FAILED: { httpStatus: 422, defaultRetryable: true },
  SESSION_EXPIRED: { httpStatus: 410, defaultRetryable: false },
  INTERACTION_STALE: { httpStatus: 409, defaultRetryable: true },
  UPSTREAM_UNAVAILABLE: { httpStatus: 503, defaultRetryable: true },
  RATE_LIMITED: { httpStatus: 429, defaultRetryable: true },
};

/** Carries an ErrorCode straight through to the HTTP response as the contract's error envelope. */
export class OnboardingException extends Error {
  private constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'OnboardingException';
  }

  get httpStatus(): number {
    return ERROR_CODE_TABLE[this.code].httpStatus;
  }

  get retryable(): boolean {
    return ERROR_CODE_TABLE[this.code].defaultRetryable;
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

  static rateLimited(message: string): OnboardingException {
    return new OnboardingException('RATE_LIMITED', message);
  }
}
