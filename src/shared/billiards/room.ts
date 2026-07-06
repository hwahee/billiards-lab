/**
 * Billiards room wire protocol — the shared contract between the
 * server-authoritative game service and its clients.
 *
 * The server owns one room (game state + physics coefficients + sim phase)
 * and is the only place physics steps run. Clients send {@link
 * BilliardsCommand}s (validated here, at the boundary) and receive {@link
 * BilliardsRoomSnapshot}s back — over REST today, over WebSocket broadcast
 * for the multiplayer steps. Everything in a snapshot is plain JSON data.
 */
import { s, toValidator, type Infer } from '../validation';
import type { BilliardsGameState, BilliardsVariant } from './game-state';
import type { PhysicsParams } from './physics';

export type RoomPhase = 'idle' | 'running' | 'paused';

/** The full authoritative room state, as shipped to clients. */
export interface BilliardsRoomSnapshot {
  variant: BilliardsVariant;
  phase: RoomPhase;
  /** Bumped whenever the game is replaced (reset / variant switch), so clients drop per-game local state. */
  generation: number;
  /** Server-side playback speed multiplier. */
  simSpeed: number;
  params: PhysicsParams;
  game: BilliardsGameState;
}

const finite = (min: number, max: number) => s.number().check(s.gte(min), s.lte(max));

const BALL_ID = s.string().check(s.minLength(1), s.maxLength(16));

/** Strike variables as accepted from the network — every field bounded. */
const strikeShotSchema = s.strictObject({
  speed: finite(0, 10),
  directionRad: finite(-2 * Math.PI, 2 * Math.PI),
  lateralSpeed: s.optional(finite(-5, 5)),
  topspin: finite(-500, 500),
  sidespin: finite(-500, 500),
  rollspin: s.optional(finite(-500, 500)),
});

/** Full physics-coefficient set (matches PhysicsParams), bounded per field. */
const paramsSchema = s.strictObject({
  ballRadius: finite(0.01, 0.1),
  ballMass: finite(0.05, 1),
  gravity: finite(1, 30),
  slidingFriction: finite(0, 1),
  rollingFriction: finite(0, 0.2),
  spinFriction: finite(0, 0.5),
  cushionRestitution: finite(0.1, 1),
  cushionFriction: finite(0, 1),
  ballRestitution: finite(0.1, 1),
  ballFriction: finite(0, 1),
  stopSpeed: finite(0.001, 0.1),
  stopSpin: finite(0.01, 2),
  pocketCaptureSpeed: finite(0, 5),
});

/**
 * Every mutation a client may request, as one discriminated union — the same
 * shape works for the REST body today and WebSocket messages later.
 */
export const billiardsCommandValidator = toValidator(
  s.discriminatedUnion('type', [
    /** Strike the active preset's cue ball (idle only; refused while it is potted). */
    s.strictObject({ type: s.literal('strike'), shot: strikeShotSchema }),
    /** Re-rack the current variant; bumps `generation`. */
    s.strictObject({ type: s.literal('reset') }),
    /** Switch carom ↔ pool (re-racks); bumps `generation`. */
    s.strictObject({ type: s.literal('variant'), variant: s.enum(['carom', 'pool']) }),
    /** Replace the physics coefficients (applies live). */
    s.strictObject({ type: s.literal('params'), params: paramsSchema }),
    /** Server-side playback speed multiplier. */
    s.strictObject({ type: s.literal('simSpeed'), simSpeed: finite(0.1, 3) }),
    /** running → paused, paused → running. */
    s.strictObject({ type: s.literal('togglePause') }),
    /** Advance exactly 1/60 s while paused. */
    s.strictObject({ type: s.literal('stepOnce') }),
    /** Freely reposition a resting ball (idle only). */
    s.strictObject({
      type: s.literal('placeBall'),
      ballId: BALL_ID,
      x: finite(-5, 5),
      y: finite(-5, 5),
    }),
    /** Move a potted ball into the holding tray (client pot animation finished). */
    s.strictObject({ type: s.literal('settleIntoTray'), ballId: BALL_ID }),
  ]),
);

export type BilliardsCommand = Infer<typeof billiardsCommandValidator>;
