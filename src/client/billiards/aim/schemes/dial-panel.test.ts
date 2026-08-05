import { describe, expect, test } from 'bun:test';

import { LAYOUT, readDialPanel } from './dial-panel';

/** uv of a point at `deg` on the dial, at `r` of the dial radius. */
function onDial(deg: number, r = 0.7): { u: number; v: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    u: LAYOUT.dial.u + (Math.cos(rad) * LAYOUT.dial.radiusV * r) / LAYOUT.aspect,
    v: LAYOUT.dial.v + Math.sin(rad) * LAYOUT.dial.radiusV * r,
  };
}

describe('readDialPanel', () => {
  test('reads the bearing off the dial, correcting for the panel aspect', () => {
    for (const deg of [0, 45, 90, 135, 180, -90, -135]) {
      const { u, v } = onDial(deg);
      const hit = readDialPanel(u, v);
      expect(hit.kind).toBe('direction');
      if (hit.kind === 'direction') expect(hit.directionDeg).toBeCloseTo(deg, 6);
    }
  });

  test('the dial centre reports nothing rather than a wild angle', () => {
    expect(readDialPanel(LAYOUT.dial.u, LAYOUT.dial.v).kind).toBe('none');
  });

  test('maps the slider across its full travel', () => {
    const at = (u: number) => readDialPanel(u, LAYOUT.slider.v);
    const lo = at(LAYOUT.slider.u0);
    const mid = at((LAYOUT.slider.u0 + LAYOUT.slider.u1) / 2);
    const hi = at(LAYOUT.slider.u1);
    expect(lo.kind).toBe('power');
    if (lo.kind === 'power') expect(lo.power).toBeCloseTo(0, 9);
    if (mid.kind === 'power') expect(mid.power).toBeCloseTo(0.5, 9);
    if (hi.kind === 'power') expect(hi.power).toBeCloseTo(1, 9);
  });

  test('clamps past either end of the slider instead of overshooting', () => {
    const past = readDialPanel(0.99, LAYOUT.slider.v);
    expect(past.kind).toBe('power');
    if (past.kind === 'power') expect(past.power).toBe(1);
  });

  test('the two zones never overlap', () => {
    const dialEdge = readDialPanel(
      LAYOUT.dial.u + (LAYOUT.dial.radiusV * 1.1) / LAYOUT.aspect,
      LAYOUT.dial.v,
    );
    expect(dialEdge.kind).toBe('direction');
    expect(readDialPanel(LAYOUT.slider.u0, LAYOUT.slider.v).kind).toBe('power');
  });

  test('dead space (corners) reports nothing', () => {
    expect(readDialPanel(0.02, 0.97).kind).toBe('none');
    expect(readDialPanel(0.7, 0.97).kind).toBe('none');
  });
});
