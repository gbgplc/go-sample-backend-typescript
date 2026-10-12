/**
 * Per-session-id async mutex — the TS equivalent of Java's
 * `synchronized (session)`. Node's single-threaded event loop still allows
 * two requests for the *same* session to interleave across `await` points
 * (e.g. a status poll racing an in-flight capture submit's own upstream
 * call), so this serializes access per session id without blocking unrelated
 * sessions. Implemented as a promise chain: each caller's turn resolves only
 * after the previous one's has, and the chain entry is dropped once nothing
 * is queued behind it so this map doesn't grow unbounded.
 */
const queues = new Map<string, Promise<unknown>>();

export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const cleanup = run.then(
    () => {
      if (queues.get(sessionId) === cleanup) queues.delete(sessionId);
    },
    () => {
      if (queues.get(sessionId) === cleanup) queues.delete(sessionId);
    }
  );
  queues.set(sessionId, cleanup);
  return run;
}
