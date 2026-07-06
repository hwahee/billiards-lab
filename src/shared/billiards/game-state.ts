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
  CAROM_TABLE,
  DEFAULT_PARAMS,
  identityQuat,
  POOL_TABLE,
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
type BilliardsBallId = 'white' | 'yellow' | 'redA' | 'redB';

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

/**
 * Standard 8-ball rack, apex to back row: the apex is the 1-ball, the 8-ball
 * sits at the centre of the middle (3-ball) row, and the back (5-ball) row's
 * two corners are one solid (7) and one stripe (15), as required by the
 * regulation rack rule. Every number 1–15 appears exactly once.
 */
const POOL_RACK: readonly (readonly number[])[] = [
  [1],
  [9, 2],
  [10, 8, 3],
  [11, 4, 5, 12],
  [7, 13, 6, 14, 15],
];

/** Opening pool layout: cue ball behind the head string, 15 balls racked at the foot spot. */
export function createPoolGameState(): BilliardsGameState {
  const R = DEFAULT_PARAMS.ballRadius;
  const rowSpacing = R * Math.sqrt(3) * 1.001; // tiny gap avoids exact-touching overlap
  const ballSpacing = 2 * R * 1.001;
  const footSpotX = POOL_TABLE.width * 0.22;
  const headSpotX = -POOL_TABLE.width * 0.28;

  const at = (id: string, x: number, y: number): BallState => ({
    id,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    orientation: identityQuat(),
  });

  const balls: BallState[] = [at('cue', headSpotX, 0)];
  POOL_RACK.forEach((row, r) => {
    const x = footSpotX + r * rowSpacing;
    row.forEach((number, k) => {
      const y = (k - r / 2) * ballSpacing;
      balls.push(at(String(number), x, y));
    });
  });

  return { balls, simTime: 0, events: [], lastEvent: null };
}

export type BilliardsVariant = 'carom' | 'pool';

/**
 * The game data of a preset — everything the SERVER needs to own a game of
 * that variant. Presentation (colours, labels) stays client-side.
 */
export interface GamePreset {
  variant: BilliardsVariant;
  table: TableConfig;
  cueBallId: string;
  createState: () => BilliardsGameState;
}

export const GAME_PRESETS: Record<BilliardsVariant, GamePreset> = {
  carom: {
    variant: 'carom',
    table: CAROM_TABLE,
    cueBallId: 'white',
    createState: createInitialGameState,
  },
  pool: {
    variant: 'pool',
    table: POOL_TABLE,
    cueBallId: 'cue',
    createState: createPoolGameState,
  },
};

/**
 * Pocketed-ball holding tray: one dedicated area just outside a short
 * (vertical) edge of the table, laid out as a grid so simultaneously
 * pocketed balls sit spaced apart instead of piling on top of each other.
 * Only meaningful for tables with pockets. The tray is part of the shared
 * game data (potted balls' positions live in the game state), while how it
 * is drawn stays client-side.
 */
const TRAY_MARGIN = 0.06;
const TRAY_ROWS = 2;
const TRAY_COLS = 8;
const TRAY_SLOT_GAP = DEFAULT_PARAMS.ballRadius * 2.4;
const TRAY_SLOT_COUNT = TRAY_ROWS * TRAY_COLS;

/** The (row, col) grid slot's centre, `index` counting row-major from 0. */
function traySlotPosition(table: TableConfig, index: number): { x: number; y: number } {
  const row = Math.floor(index / TRAY_COLS);
  const col = index % TRAY_COLS;
  return {
    x: table.width / 2 + TRAY_MARGIN + (row + 0.5) * TRAY_SLOT_GAP,
    y: (col - (TRAY_COLS - 1) / 2) * TRAY_SLOT_GAP,
  };
}

/**
 * The first tray slot not already sat in by one of `occupied`'s positions
 * (other potted balls already resting in the tray). Falls back to extending
 * the grid one more row if every slot is somehow taken.
 */
function nextFreeTraySlot(
  table: TableConfig,
  occupied: readonly { x: number; y: number }[],
): { x: number; y: number } {
  const R = DEFAULT_PARAMS.ballRadius;
  for (let i = 0; i < TRAY_SLOT_COUNT; i += 1) {
    const slot = traySlotPosition(table, i);
    if (!occupied.some((p) => Math.hypot(p.x - slot.x, p.y - slot.y) < R * 1.5)) return slot;
  }
  return traySlotPosition(table, occupied.length);
}

/** Rectangular footprint of the whole tray grid (table coordinates), for drawing its shelf. */
export function trayFootprint(table: TableConfig): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const R = DEFAULT_PARAMS.ballRadius;
  return {
    x: table.width / 2 + TRAY_MARGIN + (TRAY_ROWS * TRAY_SLOT_GAP) / 2,
    y: 0,
    width: TRAY_ROWS * TRAY_SLOT_GAP + R,
    height: TRAY_COLS * TRAY_SLOT_GAP + R,
  };
}

/** Whether (x, y) lies within the legal playing bounds of `table` (ball-radius inset). */
export function isOnFelt(table: TableConfig, x: number, y: number): boolean {
  const R = DEFAULT_PARAMS.ballRadius;
  return Math.abs(x) <= table.width / 2 - R && Math.abs(y) <= table.height / 2 - R;
}

/**
 * Freely repositions a resting ball (table setup / practice mode). A potted
 * ball dropped off the felt just moves within the holding tray; dropped onto
 * the felt it rejoins play. An active ball's target is clamped inside the
 * rails and rejected outright if it would overlap another ball. Returns
 * whether the state changed. The caller is responsible for only allowing
 * this while the game is idle.
 */
export function placeBall(
  state: BilliardsGameState,
  table: TableConfig,
  params: PhysicsParams,
  ballId: string,
  x: number,
  y: number,
): boolean {
  const ball = state.balls.find((b) => b.id === ballId);
  if (!ball) return false;

  const R = params.ballRadius;
  const xLim = table.width / 2 - R;
  const yLim = table.height / 2 - R;
  const onFelt = Math.abs(x) <= xLim && Math.abs(y) <= yLim;

  if (ball.potted && !onFelt) {
    // Still off the table: free rearranging within the holding tray.
    ball.position = { x, y };
    return true;
  }

  const cx = Math.min(xLim, Math.max(-xLim, x));
  const cy = Math.min(yLim, Math.max(-yLim, y));
  const overlaps = state.balls.some(
    (other) =>
      other.id !== ballId &&
      !other.potted &&
      Math.hypot(cx - other.position.x, cy - other.position.y) < 2 * R,
  );
  if (overlaps) return false;

  ball.position = { x: cx, y: cy };
  ball.velocity = { x: 0, y: 0 };
  ball.spin = { x: 0, y: 0, z: 0 };
  ball.potted = false; // dropped back onto the felt: rejoins play
  return true;
}

/**
 * Moves a captured (potted) ball to the pocketed-ball holding tray, at rest
 * in the first free slot. No-op for unknown or not-potted balls.
 */
export function settleBallIntoTray(
  state: BilliardsGameState,
  table: TableConfig,
  ballId: string,
): boolean {
  const ball = state.balls.find((b) => b.id === ballId);
  if (!ball?.potted) return false;
  // Only balls already resting in the tray occupy a slot — one still
  // mid-animation at its pocket hasn't been assigned one yet.
  const occupied = state.balls
    .filter((b) => b.id !== ballId && b.potted && b.position.x > table.width / 2)
    .map((b) => b.position);
  ball.position = nextFreeTraySlot(table, occupied);
  return true;
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
        event.type === 'ball'
          ? `ball:${event.ballId}:${event.otherId}`
          : event.type === 'cushion'
            ? `cushion:${event.ballId}`
            : `pocket:${event.ballId}`;
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
