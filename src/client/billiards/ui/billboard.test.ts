import { describe, expect, test } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';

import { apparentSizeScale, clampedBillboardQuaternion, smoothingAlpha } from './billboard';

const DEG = Math.PI / 180;

/** The world-space direction the element ends up facing. */
function facing(q: Quaternion): Vector3 {
  return new Vector3(0, 0, 1).applyQuaternion(q);
}

function angleBetween(a: Vector3, b: Vector3): number {
  return a.angleTo(b);
}

/** Home pose facing +z (the identity pose), as upright panels use. */
const upright = new Quaternion();
/** Home pose lying flat, facing +y — a panel printed on the table. */
const flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));

describe('clampedBillboardQuaternion', () => {
  test('holds the home pose while the camera is inside the tolerance', () => {
    const toCamera = new Vector3(Math.sin(20 * DEG), 0, Math.cos(20 * DEG));
    const result = clampedBillboardQuaternion(upright, toCamera, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright))).toBeCloseTo(0, 9);
  });

  test('holds the home pose exactly at the tolerance boundary', () => {
    const toCamera = new Vector3(Math.sin(30 * DEG), 0, Math.cos(30 * DEG));
    const result = clampedBillboardQuaternion(upright, toCamera, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright))).toBeCloseTo(0, 9);
  });

  test('past the tolerance it turns just enough to sit on the boundary', () => {
    // Camera 90° away, tolerance 30° → face 60° from home, 30° from camera.
    const toCamera = new Vector3(1, 0, 0);
    const result = clampedBillboardQuaternion(upright, toCamera, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright)) / DEG).toBeCloseTo(60, 6);
    expect(angleBetween(facing(result), toCamera) / DEG).toBeCloseTo(30, 6);
  });

  test('never turns further from home than it has to', () => {
    for (const deg of [0, 15, 45, 90, 135, 179]) {
      const toCamera = new Vector3(Math.sin(deg * DEG), 0, Math.cos(deg * DEG));
      const result = clampedBillboardQuaternion(upright, toCamera, 40 * DEG);
      const moved = angleBetween(facing(result), facing(upright)) / DEG;
      expect(moved).toBeCloseTo(Math.max(0, deg - 40), 6);
    }
  });

  test('the turn is continuous across the boundary', () => {
    const at = (deg: number) => {
      const toCamera = new Vector3(Math.sin(deg * DEG), 0, Math.cos(deg * DEG));
      return facing(clampedBillboardQuaternion(upright, toCamera, 30 * DEG));
    };
    expect(angleBetween(at(29.9), at(30.1)) / DEG).toBeLessThan(0.5);
  });

  test('tolerance 0 degenerates to a plain always-face-the-camera billboard', () => {
    const toCamera = new Vector3(1, 2, 3);
    const result = clampedBillboardQuaternion(upright, toCamera, 0);
    expect(angleBetween(facing(result), toCamera)).toBeCloseTo(0, 6);
  });

  test('a flat panel tips up toward the camera, keeping its roll', () => {
    const toCamera = new Vector3(0, 1, 1).normalize();
    const result = clampedBillboardQuaternion(flat, toCamera, 10 * DEG);
    const f = facing(result);
    expect(angleBetween(f, toCamera) / DEG).toBeCloseTo(10, 6);
    // Rotated about x only — no yaw or roll introduced.
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.z).toBeGreaterThan(0);
  });

  test('a camera exactly behind the element is handled without NaN', () => {
    const toCamera = new Vector3(0, 0, -1);
    const result = clampedBillboardQuaternion(upright, toCamera, 30 * DEG);
    for (const v of [result.x, result.y, result.z, result.w]) expect(Number.isNaN(v)).toBe(false);
    expect(angleBetween(facing(result), toCamera) / DEG).toBeCloseTo(30, 6);
  });

  test('a degenerate (zero-length) camera vector leaves the home pose alone', () => {
    const result = clampedBillboardQuaternion(flat, new Vector3(0, 0, 0), 30 * DEG);
    expect(result.equals(flat)).toBe(true);
  });

  test('writes into the provided target instead of allocating', () => {
    const out = new Quaternion();
    const result = clampedBillboardQuaternion(upright, new Vector3(1, 0, 0), 0, out);
    expect(result).toBe(out);
  });
});

describe('smoothingAlpha', () => {
  test('0 responsiveness disables easing (snaps to the target)', () => {
    expect(smoothingAlpha(0, 0.016)).toBe(1);
  });

  test('a zero-length frame makes no progress', () => {
    expect(smoothingAlpha(12, 0)).toBe(0);
  });

  test('progress grows with both responsiveness and elapsed time', () => {
    expect(smoothingAlpha(12, 0.032)).toBeGreaterThan(smoothingAlpha(12, 0.016));
    expect(smoothingAlpha(24, 0.016)).toBeGreaterThan(smoothingAlpha(12, 0.016));
  });

  test('stays a valid blend factor and approaches 1 for long frames', () => {
    for (const dt of [0.001, 0.016, 0.1, 1, 10]) {
      const a = smoothingAlpha(12, dt);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(smoothingAlpha(12, 10)).toBeCloseTo(1, 6);
  });

  test('is frame-rate independent: two half steps ≈ one whole step', () => {
    const lambda = 9;
    const whole = smoothingAlpha(lambda, 0.05);
    const half = smoothingAlpha(lambda, 0.025);
    // Remaining error compounds multiplicatively, so (1-a)² must match.
    expect((1 - half) * (1 - half)).toBeCloseTo(1 - whole, 12);
  });
});

describe('apparentSizeScale', () => {
  test('is 1 at the reference distance and grows linearly with distance', () => {
    expect(apparentSizeScale(2, 2)).toBeCloseTo(1, 12);
    expect(apparentSizeScale(4, 2)).toBeCloseTo(2, 12);
    expect(apparentSizeScale(1, 2)).toBeCloseTo(0.5, 12);
  });

  test('a non-positive reference leaves the scale untouched', () => {
    expect(apparentSizeScale(3, 0)).toBe(1);
  });
});

describe('roll: the third degree of freedom stays pinned', () => {
  /** The element's up vector in world space. */
  const upOf = (q: Quaternion) => new Vector3(0, 1, 0).applyQuaternion(q);

  const cameraAt = (azimuthDeg: number, elevationDeg: number) => {
    const a = azimuthDeg * DEG;
    const e = elevationDeg * DEG;
    return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  };

  test('an upright element is never rendered upside down, from any angle', () => {
    // Regression: the minimal rotation used to drag the up vector over with
    // it, flipping the element as the camera swung round behind it.
    for (let azimuth = 0; azimuth < 360; azimuth += 5) {
      for (let elevation = -80; elevation <= 80; elevation += 5) {
        const q = clampedBillboardQuaternion(upright, cameraAt(azimuth, elevation), 32 * DEG);
        expect(upOf(q).y).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  test('stays clearly upright with the camera directly behind it', () => {
    const q = clampedBillboardQuaternion(upright, cameraAt(180, 5), 32 * DEG);
    expect(upOf(q).y).toBeGreaterThan(0.5);
  });

  test('the up vector never flips between neighbouring camera angles', () => {
    // A flip shows up as the up vector reversing over a tiny camera move.
    let previous = upOf(clampedBillboardQuaternion(upright, cameraAt(0, 10), 32 * DEG));
    for (let azimuth = 1; azimuth <= 360; azimuth += 1) {
      const current = upOf(clampedBillboardQuaternion(upright, cameraAt(azimuth, 10), 32 * DEG));
      expect(current.dot(previous)).toBeGreaterThan(0.9);
      previous = current;
    }
  });

  test('a home pose with deliberate roll keeps it while inside the tolerance', () => {
    // Roll is pinned to the home pose's own up, not to world up, so a
    // tilted element stays tilted rather than being levelled.
    const tilted = new Quaternion().setFromEuler(new Euler(0, 0, 25 * DEG));
    const q = clampedBillboardQuaternion(tilted, new Vector3(0, 0, 1), 30 * DEG);
    expect(q.angleTo(tilted)).toBeCloseTo(0, 9);
  });

  test("a camera along the element's own up axis is handled without NaN", () => {
    // The up vector cannot disambiguate roll here; the fallback must still
    // produce a usable orientation.
    const q = clampedBillboardQuaternion(upright, new Vector3(0, 1, 0), 0);
    for (const v of [q.x, q.y, q.z, q.w]) expect(Number.isNaN(v)).toBe(false);
    expect(angleBetween(facing(q), new Vector3(0, 1, 0))).toBeCloseTo(0, 6);
  });

  test('always returns a unit quaternion', () => {
    for (let azimuth = 0; azimuth < 360; azimuth += 17) {
      for (const elevation of [-70, -20, 0, 20, 70]) {
        const q = clampedBillboardQuaternion(flat, cameraAt(azimuth, elevation), 20 * DEG);
        expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
      }
    }
  });
});
