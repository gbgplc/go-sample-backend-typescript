import { NextResponse } from 'next/server';
import { ErrorEnvelope } from '../dto/types';
import { OnboardingException } from '../errors/onboardingException';
import { jsonResponse } from './jsonResponse';

/**
 * Maps every failure onto the one error envelope shape the front end expects
 * — mirrors GlobalExceptionHandler's three-tier dispatch order, including its
 * one deliberate inconsistency: the catch-all case returns HTTP 500 but with
 * code UPSTREAM_UNAVAILABLE (not 503). That's not a bug to fix here — it's
 * the Java backend's actual behaviour, and this port is measured against it.
 */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof OnboardingException) {
    const body: ErrorEnvelope = {
      code: err.code,
      http: err.httpStatus,
      message: err.message,
      fields: err.fields,
      retryable: err.retryable,
    };
    return jsonResponse(body, err.httpStatus);
  }

  if (err instanceof ValidationError) {
    const body: ErrorEnvelope = {
      code: 'VALIDATION_FAILED',
      http: 422,
      message: 'One or more fields could not be validated.',
      fields: err.fields,
      retryable: true,
    };
    return jsonResponse(body, 422);
  }

  console.error('Unhandled exception', err);
  const body: ErrorEnvelope = {
    code: 'UPSTREAM_UNAVAILABLE',
    http: 500,
    message: 'Something went wrong on our end. Try again shortly.',
    retryable: true,
  };
  return jsonResponse(body, 500);
}

/** The TS equivalent of Spring's MethodArgumentNotValidException — bean-validation-style field errors. */
export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}
