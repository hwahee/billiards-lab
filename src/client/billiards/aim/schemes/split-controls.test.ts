import { describe, expect, test } from 'bun:test';

import { POWER_TRACK, powerFromLocalY } from './split-controls';

describe('powerFromLocalY', () => {
  test('the foot of the track is no power and the head is full power', () => {
    expect(powerFromLocalY(POWER_TRACK.bottom)).toBeCloseTo(0, 12);
    expect(powerFromLocalY(POWER_TRACK.top)).toBeCloseTo(1, 12);
  });

  test('the midpoint is half power, and the scale is linear', () => {
    const { bottom, top } = POWER_TRACK;
    expect(powerFromLocalY((bottom + top) / 2)).toBeCloseTo(0.5, 12);
    expect(powerFromLocalY(bottom + (top - bottom) * 0.25)).toBeCloseTo(0.25, 12);
  });

  test('dragging past either end holds at the extreme', () => {
    // The capture plane is far larger than the track, so out-of-range hits
    // are the normal case rather than an edge case.
    expect(powerFromLocalY(POWER_TRACK.bottom - 2)).toBe(0);
    expect(powerFromLocalY(POWER_TRACK.top + 2)).toBe(1);
  });

  test('the track is the right way up — higher means harder', () => {
    expect(powerFromLocalY(0.2)).toBeGreaterThan(powerFromLocalY(0.1));
  });
});
