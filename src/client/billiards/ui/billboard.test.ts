import { describe, expect, test } from 'bun:test';
import { Euler, Quaternion, Vector3 } from 'three';

import { apparentSizeScale, clampedBillboardQuaternion, smoothingAlpha } from './billboard';

const DEG = Math.PI / 180;

/** The world-space direction the element ends up facing. */
function facing(q: Quaternion): Vector3 {
  return new Vector3(0, 0, 1).applyQuaternion(q);
}

/** The element's up vector in world space. */
function upOf(q: Quaternion): Vector3 {
  return new Vector3(0, 1, 0).applyQuaternion(q);
}

function angleBetween(a: Vector3, b: Vector3): number {
  return a.angleTo(b);
}

/** A level camera looking at the element from the given direction. */
const WORLD_UP = new Vector3(0, 1, 0);
function levelCameraUp(toCamera: Vector3): Vector3 {
  const t = toCamera.clone().normalize();
  return WORLD_UP.clone().addScaledVector(t, -WORLD_UP.dot(t)).normalize();
}

/** Camera direction and matching screen up for an orbit at these angles. */
function orbit(azimuthDeg: number, elevationDeg: number) {
  const a = azimuthDeg * DEG;
  const e = elevationDeg * DEG;
  const toCamera = new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  return { toCamera, cameraUp: levelCameraUp(toCamera) };
}

/** Home pose facing +z (the identity pose), as upright panels use. */
const upright = new Quaternion();
/** Home pose lying flat, facing +y — a panel printed on the table. */
const flat = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
/** Screen up for a camera on the +z axis, the pose `upright` is authored for. */
const SCREEN_UP = new Vector3(0, 1, 0);

describe('clampedBillboardQuaternion', () => {
  test('holds the home pose while the camera is inside the tolerance', () => {
    const toCamera = new Vector3(Math.sin(20 * DEG), 0, Math.cos(20 * DEG));
    const result = clampedBillboardQuaternion(upright, toCamera, SCREEN_UP, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright))).toBeCloseTo(0, 9);
  });

  test('holds the home pose exactly at the tolerance boundary', () => {
    const toCamera = new Vector3(Math.sin(30 * DEG), 0, Math.cos(30 * DEG));
    const result = clampedBillboardQuaternion(upright, toCamera, SCREEN_UP, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright))).toBeCloseTo(0, 9);
  });

  test('past the tolerance it turns just enough to sit on the boundary', () => {
    // Camera 90° away, tolerance 30° → face 60° from home, 30° from camera.
    const toCamera = new Vector3(1, 0, 0);
    const result = clampedBillboardQuaternion(upright, toCamera, SCREEN_UP, 30 * DEG);
    expect(angleBetween(facing(result), facing(upright)) / DEG).toBeCloseTo(60, 6);
    expect(angleBetween(facing(result), toCamera) / DEG).toBeCloseTo(30, 6);
  });

  test('never turns further from home than it has to', () => {
    for (const deg of [0, 15, 45, 90, 135, 179]) {
      const { toCamera, cameraUp } = orbit(deg, 0);
      const result = clampedBillboardQuaternion(upright, toCamera, cameraUp, 40 * DEG);
      const moved = angleBetween(facing(result), facing(upright)) / DEG;
      expect(moved).toBeCloseTo(Math.max(0, deg - 40), 6);
    }
  });

  test('the turn is continuous across the boundary', () => {
    const at = (deg: number) => {
      const { toCamera, cameraUp } = orbit(deg, 0);
      return facing(clampedBillboardQuaternion(upright, toCamera, cameraUp, 30 * DEG));
    };
    expect(angleBetween(at(29.9), at(30.1)) / DEG).toBeLessThan(0.5);
  });

  test('tolerance 0 degenerates to a plain always-face-the-camera billboard', () => {
    const toCamera = new Vector3(1, 2, 3);
    const cameraUp = levelCameraUp(toCamera);
    const result = clampedBillboardQuaternion(upright, toCamera, cameraUp, 0);
    expect(angleBetween(facing(result), toCamera)).toBeCloseTo(0, 6);
    expect(angleBetween(upOf(result), cameraUp)).toBeCloseTo(0, 6);
  });

  test('a flat panel tips up toward the camera, keeping its roll', () => {
    const toCamera = new Vector3(0, 1, 1).normalize();
    const cameraUp = levelCameraUp(toCamera);
    const result = clampedBillboardQuaternion(flat, toCamera, cameraUp, 10 * DEG);
    const f = facing(result);
    expect(angleBetween(f, toCamera) / DEG).toBeCloseTo(10, 6);
    // Rotated about x only — no yaw or roll introduced.
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.z).toBeGreaterThan(0);
  });

  test('a camera exactly behind the element is handled without NaN', () => {
    const toCamera = new Vector3(0, 0, -1);
    const result = clampedBillboardQuaternion(upright, toCamera, SCREEN_UP, 30 * DEG);
    for (const v of [result.x, result.y, result.z, result.w]) expect(Number.isNaN(v)).toBe(false);
    expect(angleBetween(facing(result), toCamera) / DEG).toBeCloseTo(30, 6);
  });

  test('a degenerate (zero-length) camera vector leaves the home pose alone', () => {
    const result = clampedBillboardQuaternion(flat, new Vector3(0, 0, 0), SCREEN_UP, 30 * DEG);
    expect(result.equals(flat)).toBe(true);
  });

  test('a camera up parallel to the view direction still yields a usable pose', () => {
    // Not reachable with a real camera, but the rule must not produce NaN.
    for (const toCamera of [new Vector3(0, 0, 1), new Vector3(1, 1, 1), new Vector3(0, 1, 0)]) {
      const result = clampedBillboardQuaternion(upright, toCamera, toCamera, 0);
      for (const v of [result.x, result.y, result.z, result.w]) expect(Number.isNaN(v)).toBe(false);
      expect(angleBetween(facing(result), toCamera)).toBeCloseTo(0, 6);
    }
  });

  test('writes into the provided target instead of allocating', () => {
    const out = new Quaternion();
    const result = clampedBillboardQuaternion(upright, new Vector3(1, 0, 0), SCREEN_UP, 0, out);
    expect(result).toBe(out);
  });
});

describe('the tolerance bounds all three degrees of freedom', () => {
  const MAX = 32 * DEG;

  /** Every orbit angle a user can actually reach, near-vertical included. */
  function* everyAngle() {
    for (let azimuth = 0; azimuth < 360; azimuth += 5) {
      for (const elevation of [-89, -85, -60, -30, 0, 30, 60, 85, 89]) {
        yield { azimuth, elevation, ...orbit(azimuth, elevation) };
      }
    }
  }

  function poseAt(azimuth: number, elevation: number): [Vector3, Vector3, number] {
    const { toCamera, cameraUp } = orbit(azimuth, elevation);
    return [toCamera, cameraUp, MAX];
  }

  test('an upright element is never rendered upside down, from any angle', () => {
    // Regression: with roll left implicit the element flipped as the camera
    // swung behind it, and pinning roll to world up flipped it again from
    // overhead, where world up is the very axis the camera looks along.
    const leaning: string[] = [];
    for (const { azimuth, elevation, toCamera, cameraUp } of everyAngle()) {
      const q = clampedBillboardQuaternion(upright, toCamera, cameraUp, MAX);
      const dot = upOf(q).dot(cameraUp);
      if (dot <= 0.5) leaning.push(`azim ${azimuth}° elev ${elevation}° → ${dot.toFixed(3)}`);
    }
    expect(leaning).toEqual([]);
  });

  test('the element never leans further from screen up than the tolerance', () => {
    for (const { toCamera, cameraUp } of everyAngle()) {
      const q = clampedBillboardQuaternion(upright, toCamera, cameraUp, MAX);
      expect(angleBetween(upOf(q), cameraUp)).toBeLessThanOrEqual(MAX + 1e-9);
    }
  });

  test('the element never points further from the camera than the tolerance', () => {
    for (const { toCamera, cameraUp } of everyAngle()) {
      const q = clampedBillboardQuaternion(upright, toCamera, cameraUp, MAX);
      expect(angleBetween(facing(q), toCamera)).toBeLessThanOrEqual(MAX + 1e-9);
    }
  });

  test('both bounds hold for a flat home pose too', () => {
    for (const { toCamera, cameraUp } of everyAngle()) {
      const q = clampedBillboardQuaternion(flat, toCamera, cameraUp, MAX);
      expect(angleBetween(upOf(q), cameraUp)).toBeLessThanOrEqual(MAX + 1e-9);
      expect(angleBetween(facing(q), toCamera)).toBeLessThanOrEqual(MAX + 1e-9);
    }
  });

  test('stays upright under a near-overhead camera — the reported case', () => {
    // A camera almost directly above the table: world up is useless as a
    // reference here, because it points straight at the lens.
    const { toCamera, cameraUp } = orbit(172, 80);
    const q = clampedBillboardQuaternion(upright, toCamera, cameraUp, MAX);
    expect(upOf(q).dot(cameraUp)).toBeGreaterThan(0.8);
  });

  test('the orientation tracks the camera smoothly as it orbits', () => {
    // Away from the one ambiguous configuration (below), a 1° camera move
    // must never move the element more than a degree or so.
    for (const elevation of [0, 45, 80]) {
      let previous = clampedBillboardQuaternion(upright, ...poseAt(0, elevation));
      for (let azimuth = 1; azimuth <= 360; azimuth += 1) {
        const current = clampedBillboardQuaternion(upright, ...poseAt(azimuth, elevation));
        // Azimuth 180 is the ambiguous meridian, covered by the next test.
        if (Math.abs(180 - azimuth) >= 3) {
          expect(current.angleTo(previous) / DEG).toBeLessThan(3);
        }
        previous = current;
      }
    }
  });

  test('the one ambiguous meridian swings by at most twice the tolerance', () => {
    // With the camera exactly opposite the home pose, turning left and
    // turning right are mirror images and the rule has to pick one; crossing
    // that point swaps the choice. Both choices sit within the tolerance of
    // facing the camera upright, so the swap is a lean one way becoming a
    // lean the other — bounded by the tolerance itself, never a flip.
    const step = 0.25;
    let worst = 0;
    for (const elevation of [-89, -45, 0, 45, 89]) {
      let previous = clampedBillboardQuaternion(upright, ...poseAt(170, elevation));
      for (let azimuth = 170 + step; azimuth <= 190; azimuth += step) {
        const current = clampedBillboardQuaternion(upright, ...poseAt(azimuth, elevation));
        worst = Math.max(worst, current.angleTo(previous));
        previous = current;
      }
    }
    // Twice the tolerance, plus the tracking the camera does over one step.
    expect(worst / DEG).toBeLessThanOrEqual(2 * (MAX / DEG) + step);
  });

  test('a home pose with deliberate roll keeps it while inside the tolerance', () => {
    const tilted = new Quaternion().setFromEuler(new Euler(0, 0, 25 * DEG));
    const q = clampedBillboardQuaternion(tilted, new Vector3(0, 0, 1), SCREEN_UP, 30 * DEG);
    expect(q.angleTo(tilted)).toBeCloseTo(0, 9);
  });

  test('always returns a unit quaternion', () => {
    for (const { toCamera, cameraUp } of everyAngle()) {
      const q = clampedBillboardQuaternion(flat, toCamera, cameraUp, 20 * DEG);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
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
