/**
 * Cross-instance pub/sub contract.
 *
 * When the server scales horizontally, instances need a shared bus (e.g. to
 * fan WebSocket notifications out to sockets connected to *other* instances,
 * or to distribute background jobs). Services depend on this interface only;
 * the driver is chosen by configuration:
 *
 *   - `memory` — single-process bus, for one instance / local dev / tests.
 *   - `redis`  — Redis pub/sub via Bun's built-in client, for multi-instance.
 */
export type PubSubHandler = (message: unknown) => void;

export interface PubSub {
  /** Messages must be JSON-serializable (they cross process boundaries). */
  publish(channel: string, message: unknown): Promise<void>;
  /** Returns an unsubscribe function for this specific handler. */
  subscribe(channel: string, handler: PubSubHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** Well-known channels. Add new ones here, never as ad-hoc strings. */
export const CHANNELS = {
  /** Emitted after any todo mutation; payload: { action, todoId }. */
  todosChanged: 'todos.changed',
  /** Emitted on every billiards room update; payload: BilliardsRoomSnapshot. */
  billiardsUpdated: 'billiards.updated',
  /** Background job queue consumed by worker-role processes. */
  jobs: 'jobs',
} as const;
