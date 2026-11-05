/**
 * Who is connected where, as seen by every instance.
 *
 * A live connection (a chat socket, …) announces itself in a scope (a chat
 * room id, …) with JSON-serializable info about who it is; anyone can then
 * list the scope. Like the pub/sub bus, the driver follows PUBSUB_DRIVER —
 * whenever instances need a shared bus they need shared presence too:
 *
 *   - `memory` — this process only (one instance, local dev, tests).
 *   - `redis`  — one hash per scope, so every instance sees every connection.
 *
 * An instance that dies cannot say its connections left. Redis entries
 * therefore expire after `PRESENCE_TTL_MS` unless the owning instance
 * refreshes them, which it does every `PRESENCE_REFRESH_MS`.
 */
export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_REFRESH_MS = 20_000;

export interface PresenceEntry {
  scope: string;
  connectionId: string;
  /** Must be JSON-serializable (it crosses process boundaries). */
  info: unknown;
}

export interface PresenceStore {
  join(entry: PresenceEntry): Promise<void>;
  leave(scope: string, connectionId: string): Promise<void>;
  /** Every connection present in `scope` (expired ones left out). */
  list(scope: string): Promise<Omit<PresenceEntry, 'scope'>[]>;
  /** Keeps these still-open connections from expiring. */
  refresh(entries: readonly PresenceEntry[]): Promise<void>;
  /**
   * Deletes the expired connections of `scope` and returns the ones THIS call
   * deleted — so when several instances sweep at once, each departure is
   * announced by exactly one of them.
   */
  sweep(scope: string): Promise<string[]>;
  close(): Promise<void>;
}
