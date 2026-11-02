import { sessionConfig } from '../config';
import { Session } from './session';

/**
 * Stashed on globalThis so `next dev`'s hot-reload doesn't wipe in-flight
 * sessions on every file save — the same singleton pattern commonly used for
 * a Prisma client. In production (`next start`) this is just a module-level
 * singleton, matching the Java backend's single Spring bean.
 */
const globalForSessions = globalThis as unknown as { __sessionStore?: Map<string, Session> };
const sessions: Map<string, Session> = globalForSessions.__sessionStore ?? new Map();
globalForSessions.__sessionStore = sessions;

const ttlMs = sessionConfig.ttlMinutes * 60 * 1000;

/**
 * Caps worst-case memory for abandoned sessions (each can hold a
 * multi-MB base64 capture image in lastSubmittedData) the same way
 * goApiClient bounds its own per-instance cache: LRU via delete+reinsert on
 * every touch, oldest evicted first on overflow. An idle session is still
 * expected to expire via its TTL well before this cap is ever reached; this
 * is a backstop, not the primary eviction path.
 */
const MAX_SESSIONS = 10_000;

export const sessionStore = {
  save(session: Session): void {
    sessions.set(session.id, session);
    if (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
  },

  /**
   * A sliding/rolling TTL (idle timeout), not an absolute expiry from
   * createdAt — every successful find() resets the clock, same as the Java
   * InMemorySessionStore.
   */
  find(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    if (Date.now() - session.lastAccessedAt > ttlMs) {
      sessions.delete(sessionId);
      return undefined;
    }
    session.touch();
    sessions.delete(sessionId);
    sessions.set(sessionId, session);
    return session;
  },

  remove(sessionId: string): void {
    sessions.delete(sessionId);
  },
};
