/**
 * Billiards page configuration: how the four carom balls are rendered and
 * the default strike variables. The game data itself (initial layout, state
 * shape) lives in @shared/billiards/game-state, the physics in
 * @shared/billiards/physics — this file only fixes the presentation.
 */
import type { MessageKey } from '@shared/i18n';
import type { BilliardsBallId } from '@shared/billiards/game-state';
import type { StrikeInput } from '@shared/billiards/physics';

export interface BallSpec {
  id: BilliardsBallId;
  /** Base surface colour. */
  color: string;
  /** Colour of the painted marks (make rotation visible). */
  markColor: string;
  labelKey: MessageKey;
}

export const CUE_BALL_ID: BilliardsBallId = 'white';

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
