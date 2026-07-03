/**
 * Serializable billiards game state.
 *
 * Everything the simulation needs to resume — ball positions/velocities/
 * angular velocities, orientation quaternions, the sim clock and the deduped
 * collision log — lives in one plain-data structure. It contains only JSON
 * primitives (no class instances, no functions), so `JSON.parse(
 * JSON.stringify(state))` yields an equivalent state that continues the
 * deterministic simulation bit-identically. That is what lets a server own
 * the state and ship snapshots to clients, or a client persist and replay.
 *
 * The physics itself stays in ./physics; this module is the state container
 * layer on top of it: initial layout, strike application, and the fixed-step
 * advance loop with collision logging.
 */
import {
  identityQuat,
  SIM_DT,
  stepPhysics,
  strike,
  type BallState,
  type CollisionEvent,
  type PhysicsParams,
  type StrikeInput,
  type TableConfig,
} from './physics';

/** The four carom balls (Korean 4-ball layout). */
export type BilliardsBallId = 'white' | 'yellow' | 'redA' | 'redB';

/** A logged collision with the simulation clock at the moment of contact. */
export interface SimEvent {
  /** Simulation clock at the moment of the collision (s). */
  time: number;
  event: CollisionEvent;
}

/** The collision log keeps only the most recent entries. */
const MAX_LOGGED_EVENTS = 24;
/** Collisions with the same signature within this window are one contact. */
const EVENT_DEDUPE_WINDOW = 0.08;

export interface BilliardsGameState {
  balls: BallState[];
  /** Simulation clock (s). */
  simTime: number;
  /** Deduped collision log, most recent MAX_LOGGED_EVENTS entries. */
  events: SimEvent[];
  /** Dedupe bookkeeping: the last logged contact signature and time. */
  lastEvent: { signature: string; time: number } | null;
}

/** Opening layout (metres, table centre = origin), all balls at rest. */
export function createInitialGameState(): BilliardsGameState {
  const at = (id: BilliardsBallId, x: number, y: number): BallState => ({
    id,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    orientation: identityQuat(),
  });
  return {
    balls: [
      at('white', -0.75, -0.15),
      at('yellow', -0.75, 0.18),
      at('redA', 0.45, 0.12),
      at('redB', 0.85, -0.18),
    ],
    simTime: 0,
    events: [],
    lastEvent: null,
  };
}

/** Applies the strike variables to one ball of the state (replaces v and ω). */
export function strikeBall(state: BilliardsGameState, ballId: string, input: StrikeInput): void {
  const ball = state.balls.find((b) => b.id === ballId);
  if (!ball) throw new Error(`unknown ball id: ${ballId}`);
  strike(ball, input);
}

/**
 * Advances the state by `steps` fixed SIM_DT steps (mutates `state`),
 * logging deduped collisions into `state.events`. Returns only the events
 * newly logged by this call, so callers can react to fresh collisions
 * without diffing the whole log.
 */
export function advanceGameState(
  state: BilliardsGameState,
  table: TableConfig,
  params: PhysicsParams,
  steps: number,
): SimEvent[] {
  const collisions: CollisionEvent[] = [];
  const logged: SimEvent[] = [];

  for (let i = 0; i < steps; i += 1) {
    collisions.length = 0;
    stepPhysics(state.balls, table, params, SIM_DT, collisions);
    state.simTime += SIM_DT;

    for (const event of collisions) {
      const signature =
        event.type === 'ball' ? `ball:${event.ballId}:${event.otherId}` : `cushion:${event.ballId}`;
      const last = state.lastEvent;
      if (last?.signature === signature && state.simTime - last.time < EVENT_DEDUPE_WINDOW) {
        last.time = state.simTime;
        continue;
      }
      state.lastEvent = { signature, time: state.simTime };
      logged.push({ time: state.simTime, event });
    }
  }

  if (logged.length > 0) {
    state.events = [...state.events, ...logged].slice(-MAX_LOGGED_EVENTS);
  }
  return logged;
}
