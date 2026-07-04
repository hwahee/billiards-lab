/**
 * Billiards page configuration: the presets (carom / pool) available on the
 * page, how each preset's balls are rendered, and the default strike
 * variables. The game data itself (initial layout, state shape) lives in
 * @shared/billiards/game-state, the physics in @shared/billiards/physics —
 * this file only fixes the presentation and picks which preset is active.
 */
import type { MessageKey, MessageParams } from '@shared/i18n';
import {
  createInitialGameState,
  createPoolGameState,
  type BilliardsGameState,
} from '@shared/billiards/game-state';
import {
  CAROM_TABLE,
  DEFAULT_PARAMS,
  POOL_TABLE,
  type StrikeInput,
  type TableConfig,
} from '@shared/billiards/physics';

export interface BallSpec {
  id: string;
  /** Base surface colour (solid balls) or stripe colour (striped balls). */
  color: string;
  /** Colour of the painted marks on plain balls (make rotation visible). */
  markColor?: string;
  labelKey: MessageKey;
  labelParams?: MessageParams;
  /** Ball number for pool's numbered balls (1–15); absent for carom / cue balls. */
  number?: number;
  /** Pool ball rendering style; absent for carom balls. */
  style?: 'solid' | 'stripe' | 'cue';
}

const CAROM_BALL_SPECS: readonly BallSpec[] = [
  { id: 'white', color: '#f4efe2', markColor: '#c8372c', labelKey: 'billiards.ball.white' },
  { id: 'yellow', color: '#e5b93a', markColor: '#f4efe2', labelKey: 'billiards.ball.yellow' },
  { id: 'redA', color: '#c8372c', markColor: '#f4efe2', labelKey: 'billiards.ball.redA' },
  { id: 'redB', color: '#8f2a21', markColor: '#f4efe2', labelKey: 'billiards.ball.redB' },
];

/** Standard solid-ball colours 1–8; a striped ball 9–15 reuses its solid counterpart's colour. */
const SOLID_COLORS: readonly string[] = [
  '#d9a520', // 1 yellow
  '#1f5fbf', // 2 blue
  '#c8372c', // 3 red
  '#5b2a86', // 4 purple
  '#d9701f', // 5 orange
  '#1f7a3d', // 6 green
  '#7a2530', // 7 maroon
  '#1a1a1a', // 8 black
];

const POOL_BALL_SPECS: readonly BallSpec[] = [
  {
    id: 'cue',
    color: '#f4efe2',
    markColor: '#c8372c',
    labelKey: 'billiards.ball.cue',
    style: 'cue',
  },
  ...Array.from({ length: 15 }, (_, i): BallSpec => {
    const number = i + 1;
    const color = SOLID_COLORS[(number - 1) % 8]!;
    return {
      id: String(number),
      color,
      labelKey: 'billiards.ball.numbered',
      labelParams: { number },
      number,
      style: number <= 8 ? 'solid' : 'stripe',
    };
  }),
];

const ALL_BALL_SPECS: readonly BallSpec[] = [...CAROM_BALL_SPECS, ...POOL_BALL_SPECS];

export function ballSpec(id: string): BallSpec {
  const spec = ALL_BALL_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`unknown ball id: ${id}`);
  return spec;
}

/** Resolves a ball's display name, interpolating its number for pool balls. */
export function ballLabel(
  t: (key: MessageKey, params?: MessageParams) => string,
  id: string,
): string {
  const spec = ballSpec(id);
  return t(spec.labelKey, spec.labelParams);
}

export type BilliardsVariant = 'carom' | 'pool';

export interface BilliardsPreset {
  variant: BilliardsVariant;
  table: TableConfig;
  cueBallId: string;
  ballSpecs: readonly BallSpec[];
  labelKey: MessageKey;
  createState: () => BilliardsGameState;
}

/**
 * How far outside the short (vertical) rail the pocketed-ball holding tray
 * sits (m) — lands on the wooden rail itself, between the cushion and the
 * frame's outer edge (see CUSHION_THICKNESS/FRAME_THICKNESS in scene.tsx).
 */
const TRAY_MARGIN = 0.115;

/**
 * Where a captured ball reappears, at rest, once its pocket animation
 * finishes — one fixed spot just outside a short edge of the table, ready
 * to be dragged back onto the felt. Only meaningful for tables with pockets.
 */
export function trayAnchor(table: TableConfig): { x: number; y: number } {
  return { x: table.width / 2 + TRAY_MARGIN, y: 0 };
}

/** Whether (x, y) lies within the legal playing bounds of `table` (ball-radius inset). */
export function isOnFelt(table: TableConfig, x: number, y: number): boolean {
  const R = DEFAULT_PARAMS.ballRadius;
  return Math.abs(x) <= table.width / 2 - R && Math.abs(y) <= table.height / 2 - R;
}

export const PRESETS: Record<BilliardsVariant, BilliardsPreset> = {
  carom: {
    variant: 'carom',
    table: CAROM_TABLE,
    cueBallId: 'white',
    ballSpecs: CAROM_BALL_SPECS,
    labelKey: 'billiards.preset.carom',
    createState: createInitialGameState,
  },
  pool: {
    variant: 'pool',
    table: POOL_TABLE,
    cueBallId: 'cue',
    ballSpecs: POOL_BALL_SPECS,
    labelKey: 'billiards.preset.pool',
    createState: createPoolGameState,
  },
};

export interface ShotSettings {
  /** m/s */
  speed: number;
  /** degrees; 0 = +x, counter-clockwise seen from above. */
  directionDeg: number;
  /** m/s perpendicular to aim; > 0 starts moving left of travel. */
  lateralSpeed: number;
  /** rad/s; > 0 topspin (follow), < 0 backspin (draw). */
  topspin: number;
  /** rad/s; > 0 bends left of travel. */
  sidespin: number;
  /** rad/s around the travel axis; > 0 curves left while sliding. */
  rollspin: number;
}

export const DEFAULT_SHOT: ShotSettings = {
  speed: 2.5,
  directionDeg: 13,
  lateralSpeed: 0,
  topspin: 0,
  sidespin: 0,
  rollspin: 0,
};

/** Maps the UI shot settings onto the engine's strike variables. */
export function toStrikeInput(shot: ShotSettings): StrikeInput {
  return {
    speed: shot.speed,
    directionRad: (shot.directionDeg * Math.PI) / 180,
    lateralSpeed: shot.lateralSpeed,
    topspin: shot.topspin,
    sidespin: shot.sidespin,
    rollspin: shot.rollspin,
  };
}
