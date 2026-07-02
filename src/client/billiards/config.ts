/**
 * Billiards page configuration: the four carom balls (Korean 4-ball layout)
 * and the default strike variables. Physics itself lives in
 * @shared/billiards/physics — this file only fixes the concrete scenario.
 */
import type { MessageKey } from '@shared/i18n';
import type { BallState, StrikeInput } from '@shared/billiards/physics';

export type BallId = 'white' | 'yellow' | 'redA' | 'redB';

export interface BallSpec {
  id: BallId;
  /** Base surface colour. */
  color: string;
  /** Colour of the painted marks (make rotation visible). */
  markColor: string;
  labelKey: MessageKey;
}

export const CUE_BALL_ID: BallId = 'white';

export const BALL_SPECS: readonly BallSpec[] = [
  { id: 'white', color: '#f4efe2', markColor: '#c8372c', labelKey: 'billiards.ball.white' },
  { id: 'yellow', color: '#e5b93a', markColor: '#f4efe2', labelKey: 'billiards.ball.yellow' },
  { id: 'redA', color: '#c8372c', markColor: '#f4efe2', labelKey: 'billiards.ball.redA' },
  { id: 'redB', color: '#8f2a21', markColor: '#f4efe2', labelKey: 'billiards.ball.redB' },
];

export function ballSpec(id: string): BallSpec {
  const spec = BALL_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`unknown ball id: ${id}`);
  return spec;
}

/** Opening layout (metres, table centre = origin). */
export function createInitialBalls(): BallState[] {
  const at = (id: BallId, x: number, y: number): BallState => ({
    id,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
  });
  return [
    at('white', -0.75, -0.15),
    at('yellow', -0.75, 0.18),
    at('redA', 0.45, 0.12),
    at('redB', 0.85, -0.18),
  ];
}

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
