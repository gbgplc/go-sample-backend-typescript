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

export const sessionStore = {
  save(session: Session): void {
    sessions.set(session.id, session);
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
    return session;
  },

  remove(sessionId: string): void {
    sessions.delete(sessionId);
  },
};
