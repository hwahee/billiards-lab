import { describe, expect, test } from 'bun:test';

import {
  clamp01,
  distanceToPower,
  MAX_SPEED,
  MIN_SPEED,
  normaliseDeg,
  offsetFromCue,
  powerColor,
  powerToSpeed,
  speedToPower,
} from './model';

const cue = {
  id: 'cue',
  position: { x: 0.2, y: -0.4 },
  velocity: { x: 0, y: 0 },
  spin: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

describe('power ↔ speed', () => {
  test('round-trips across the usable range', () => {
    for (const speed of [MIN_SPEED, 1, 2.5, 4, MAX_SPEED]) {
      expect(powerToSpeed(speedToPower(speed))).toBeCloseTo(speed, 9);
    }
  });

  test('clamps out-of-range input to the endpoints', () => {
    expect(speedToPower(-5)).toBe(0);
    expect(speedToPower(999)).toBe(1);
    expect(powerToSpeed(-1)).toBeCloseTo(MIN_SPEED, 9);
    expect(powerToSpeed(2)).toBeCloseTo(MAX_SPEED, 9);
  });

  test('clamp01 keeps values inside the unit interval', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.35)).toBe(0.35);
    expect(clamp01(4)).toBe(1);
  });
});

describe('powerColor', () => {
  test('ramps through three bands and is stable within each', () => {
    expect(powerColor(0)).toBe(powerColor(0.39));
    expect(powerColor(0.4)).toBe(powerColor(0.74));
    expect(powerColor(0.75)).toBe(powerColor(1));
    expect(new Set([powerColor(0), powerColor(0.5), powerColor(1)]).size).toBe(3);
  });
});

describe('normaliseDeg', () => {
  test('wraps into (-180, 180]', () => {
    expect(normaliseDeg(0)).toBe(0);
    expect(normaliseDeg(190)).toBeCloseTo(-170, 9);
    expect(normaliseDeg(-190)).toBeCloseTo(170, 9);
    expect(normaliseDeg(540)).toBeCloseTo(180, 9);
    expect(normaliseDeg(405)).toBeCloseTo(45, 9);
  });
});

describe('offsetFromCue', () => {
  test('maps a scene hit onto the table plane relative to the cue ball', () => {
    // Scene z is the negated table y, so this hit is straight ahead (+x).
    const result = offsetFromCue(cue, { x: 0.5, z: 0.4 });
    expect(result.dx).toBeCloseTo(0.3, 9);
    expect(result.dy).toBeCloseTo(0, 9);
    expect(result.distance).toBeCloseTo(0.3, 9);
    expect(result.bearingDeg).toBeCloseTo(0, 9);
  });

  test('reports the bearing counter-clockwise from +x', () => {
    const result = offsetFromCue(cue, { x: 0.2, z: 0.15 });
    expect(result.bearingDeg).toBeCloseTo(90, 9);
    expect(result.distance).toBeCloseTo(0.25, 9);
  });
});

describe('distanceToPower', () => {
  test('is 0 at the inner radius, 1 at the outer, and linear between', () => {
    expect(distanceToPower(0.1, 0.1, 0.5)).toBeCloseTo(0, 9);
    expect(distanceToPower(0.3, 0.1, 0.5)).toBeCloseTo(0.5, 9);
    expect(distanceToPower(0.5, 0.1, 0.5)).toBeCloseTo(1, 9);
  });

  test('clamps inside the dead zone and beyond the ring', () => {
    expect(distanceToPower(0.02, 0.1, 0.5)).toBe(0);
    expect(distanceToPower(9, 0.1, 0.5)).toBe(1);
  });
});
