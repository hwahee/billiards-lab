/**
 * The shared value model every aim scheme works in.
 *
 * Schemes differ in gesture, not in meaning: they all produce a bearing and
 * a power, and they should all read the same at a glance and respond to the
 * keyboard by the same amounts. Keeping the conversions here means they are
 * tested once instead of per scheme, and a new scheme inherits the feel.
 */
import type { BallState } from '@shared/billiards/physics';

/** Shot speeds the widgets map onto, matching the engine's usable range (m/s). */
export const MIN_SPEED = 0.2;
export const MAX_SPEED = 6;

/** Keyboard increments, shared so every scheme nudges by the same amount. */
export const STEP = {
  directionDeg: 1,
  coarseDirectionDeg: 15,
  power: 0.02,
  coarsePower: 0.1,
} as const;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function speedToPower(speed: number): number {
  return clamp01((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
}

export function powerToSpeed(power: number): number {
  return MIN_SPEED + clamp01(power) * (MAX_SPEED - MIN_SPEED);
}

const LOW_COLOR = '#63d2a4';
const MID_COLOR = '#f2c14e';
const HIGH_COLOR = '#e8623c';

/** Shared power ramp, so every scheme reads the same at a glance. */
export function powerColor(power: number): string {
  if (power < 0.4) return LOW_COLOR;
  if (power < 0.75) return MID_COLOR;
  return HIGH_COLOR;
}

/** Degrees, normalised to (-180, 180]. */
export function normaliseDeg(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * A scene-space pointer hit, expressed relative to the cue ball on the
 * table plane. Scene z is the negated table y, and every scheme that reads
 * the cloth needs exactly this conversion.
 */
export function offsetFromCue(
  cue: BallState,
  point: { x: number; z: number },
): { dx: number; dy: number; distance: number; bearingDeg: number } {
  const dx = point.x - cue.position.x;
  const dy = -point.z - cue.position.y;
  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy),
    bearingDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** Maps a distance from the ball onto power, between two radii. */
export function distanceToPower(distance: number, minRadius: number, maxRadius: number): number {
  return clamp01((distance - minRadius) / (maxRadius - minRadius));
}
