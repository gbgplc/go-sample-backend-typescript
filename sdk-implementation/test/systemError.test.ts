import { describe, expect, it } from 'vitest';
import { createInteractionMapper } from '../lib/go/sdk/sdkInteractionMapper';
import { GoStateView } from '../lib/go/sdk/goViews';

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

  const errored: GoStateView = {
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
    const declined: GoStateView = {
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

  it('a failed result.status beats a positive classification', () => {
    // Go documents result.status as authoritative: a journey can pass its
    // evaluation and then fail or be abandoned before finishing.
    const abandoned: GoStateView = {
      instanceId: 'i-3',
      status: 'InProgress',
      context: { process: { steps: [{ name: 'Facematch Verification', result: { status: 'complete' } }] } },
      result: { status: 'error', outcomeClassification: 'positive' },
    };
    const record = mapper.toRecord(abandoned);
    expect(record.decision).toBe('fail');
    expect(record.systemError).toBe(true);
    expect(record.title).toBe('We could not run your checks');
  });

  /** A deadlocked journey, from gbggo4-demo (2026-10-29, sandbox_QPgHrNztUswy5tZySLOUfe). */
  it('an abandoned result is a system error', () => {
    const abandoned: GoStateView = {
      instanceId: 'sandbox_QPgHrNztUswy5tZySLOUfe',
      status: 'InProgress',
      context: { process: { steps: [{ name: 'Document Classification', result: { status: 'complete' } }] } },
      result: { status: 'abandoned' },
    };
    const record = mapper.toRecord(abandoned);
    expect(record.decision).toBe('fail');
    expect(record.systemError).toBe(true);
    expect(record.title).toBe('We could not run your checks');
  });

  /** The interaction screen agrees with the record. */
  it('a Completed journey with a failed result is not shown as verified', () => {
    const interaction = mapper.toInteraction({
      instanceId: 'i-4',
      journey: { status: 'Completed' },
      result: { status: 'error', outcomeClassification: 'positive', outcome: 'Decision: Accept' },
    });
    expect(interaction).toMatchObject({ kind: 'result', decision: 'fail' });
    expect(interaction.title).not.toBe('Verification complete');
  });
});
