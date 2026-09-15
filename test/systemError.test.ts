import { describe, expect, it } from 'vitest';
import { createInteractionMapper } from '../lib/go/live/defaultInteractionMapper';
import { GoStateResponse } from '../lib/go/live/dto';

/**
 * The shape Go returns when a module could not run: journey status Error, no
 * outcomeClassification, and the failed step carrying `result.error` rather
 * than a status of "error".
 *
 * Both a platform failure and a genuine decline arrive as decision "fail", so
 * without `systemError` the screen shows a red "Declined" badge — telling the
 * customer they were rejected when nothing was decided about them.
 */
describe('a module that could not run is not a decline', () => {
  const mapper = createInteractionMapper({ stages: [], consentChecks: [] });

  const errored: GoStateResponse = {
    instanceId: 'i-1',
    status: 'Error',
    context: {
      process: {
        steps: [
          { name: 'Address Verification', result: { status: 'complete' } },
          {
            name: 'Document Classification',
            result: { error: { errors: [{ code: 'DC9999', error: 'INTERNAL_ERROR' }] } },
          },
        ],
      },
    },
    result: { status: 'pending' },
  };

  it('reports systemError, not a decline', () => {
    const record = mapper.toRecord(errored);
    expect(record.decision).toBe('fail');
    expect(record.systemError).toBe(true);
    expect(record.title).toBe('We could not run your checks');
    expect(record.cta).toBe('Try again');
  });

  it('a real decline is still a decline', () => {
    const declined: GoStateResponse = {
      instanceId: 'i-2',
      status: 'Completed',
      context: { process: { steps: [{ name: 'Data Verification', result: { status: 'complete' } }] } },
      result: { status: 'complete', outcomeClassification: 'negative' },
    };
    const record = mapper.toRecord(declined);
    expect(record.decision).toBe('fail');
    expect(record.systemError).toBe(false);
    expect(record.title).toBe('We could not complete your verification');
  });
});
