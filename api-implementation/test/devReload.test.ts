import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `next dev` reloads the server's modules after a compile, while the Go
 * client, the session store and the session locks live on globalThis. Each
 * test loads a second copy of a module, as a reload does (vi.resetModules),
 * and checks the two copies still agree.
 */

beforeEach(() => {
  vi.resetModules();
});

describe('after a dev reload', () => {
  it('still answers an OnboardingException from the earlier module graph with its own status', async () => {
    const before = await import('@/lib/errors/onboardingException');
    const thrown = before.OnboardingException.upstreamUnavailable('Something went wrong on our end. Try again shortly.');

    vi.resetModules();
    const { handleRouteError } = await import('@/lib/http/errorHandling');
    const { OnboardingException } = await import('@/lib/errors/onboardingException');
    expect(OnboardingException).not.toBe(before.OnboardingException);
    expect(thrown instanceof OnboardingException).toBe(true);

    const response = handleRouteError(thrown);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: true });
  });

  it('does not take any other error for an OnboardingException', async () => {
    const { OnboardingException } = await import('@/lib/errors/onboardingException');

    expect(new Error('boom') instanceof OnboardingException).toBe(false);
    expect({ code: 'UPSTREAM_UNAVAILABLE' } instanceof OnboardingException).toBe(false);
  });

  it('keeps one lock per session across both copies of the mutex', async () => {
    const before = await import('@/lib/session/sessionMutex');
    vi.resetModules();
    const after = await import('@/lib/session/sessionMutex');
    expect(after.withSessionLock).not.toBe(before.withSessionLock);

    const order: string[] = [];
    let release!: () => void;
    const held = before.withSessionLock('session-1', async () => {
      order.push('first starts');
      await new Promise<void>((resolve) => (release = resolve));
      order.push('first ends');
    });
    const queued = after.withSessionLock('session-1', async () => {
      order.push('second runs');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['first starts']);
    release();
    await Promise.all([held, queued]);
    expect(order).toEqual(['first starts', 'first ends', 'second runs']);
  });
});
