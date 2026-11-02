import { describe, expect, it } from 'vitest';
import { Session } from '@/lib/session/session';
import { SubmitInteractionResponse } from '@/lib/dto/types';

const SOME_RESPONSE: SubmitInteractionResponse = {
  status: 'PendingInput',
  interaction: { interactionId: 'x', kind: 'form', stage: 'Test', title: 'Test' },
};

describe('Session.isRetryOf', () => {
  it('is not a retry before anything has been submitted', () => {
    const session = new Session('s1', 'cookie', 'instance-1', 'int-1');
    expect(session.isRetryOf('int-1', {})).toBe(false);
  });

  it('same interactionId and same payload is a retry', () => {
    const session = new Session('s1', 'cookie', 'instance-1', 'int-1');
    session.recordAdvance('int-1', { field: 'value' }, SOME_RESPONSE);

    expect(session.isRetryOf('int-1', { field: 'value' })).toBe(true);
    expect(session.cachedResponse()).toBe(SOME_RESPONSE);
  });

  it('same interactionId with different payload is the next step, not a retry', () => {
    // Go reuses one interactionId across an entire collection phase, so the id
    // alone can't tell a retry from a genuine advance — the payload must differ.
    const session = new Session('s1', 'cookie', 'instance-1', 'int-1');
    session.recordAdvance('int-1', { field: 'value' }, SOME_RESPONSE);

    expect(session.isRetryOf('int-1', { field: 'a different value' })).toBe(false);
  });

  it('different interactionId is never a retry', () => {
    const session = new Session('s1', 'cookie', 'instance-1', 'int-1');
    session.recordAdvance('int-1', { field: 'value' }, SOME_RESPONSE);

    expect(session.isRetryOf('int-2', { field: 'value' })).toBe(false);
  });

  it('treats key order as irrelevant when comparing payloads', () => {
    const session = new Session('s1', 'cookie', 'instance-1', 'int-1');
    session.recordAdvance('int-1', { a: 1, b: 2 }, SOME_RESPONSE);

    expect(session.isRetryOf('int-1', { b: 2, a: 1 })).toBe(true);
  });
});
