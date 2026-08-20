/**
 * Clamped billboarding — the orientation rule the in-scene UI is built on.
 *
 * A plain billboard always faces the camera, which reads as dead: the panel
 * is welded to the viewport and the scene turns behind it. What we want
 * instead is a panel that *lives in the world* and only yields when it has
 * to:
 *
 *   - Every UI element has a HOME pose — the orientation it prefers, chosen
 *     to make sense in world space (lying along the table, standing across
 *     the rail, aligned with the shot …).
 *   - There is a tolerance angle around facing the camera. While the home
 *     pose is inside that tolerance — i.e. the element is still legible —
 *     it is left exactly as it is, and the camera moves around it.
 *   - Once the camera moves far enough that the home pose falls outside the
 *     tolerance, the element turns toward the camera, but only just far
 *     enough to sit back ON the tolerance boundary. Never further.
 *
 * So an element holds still through small camera moves, then swings along
 * with big ones while staying pinned to the edge of readability. A
 * `maxAngle` of 0 degenerates to a classic always-face-me billboard.
 *
 * The rule fixes only WHERE THE ELEMENT POINTS — two degrees of freedom.
 * The third, roll about that axis, is pinned separately to the home pose's
 * own up vector. Leaving it implicit is a trap: the natural choice, the
 * minimal rotation from home to the clamped direction, drags the element's
 * up vector along with it, so a camera swinging round behind an element
 * (a turn approaching 180°) rolls it all the way over and renders it
 * upside down. Pointing and roll are separate questions, so they are
 * answered separately.
 *
 * Pinning roll to the HOME pose's up rather than to world up keeps the
 * rule general: an element that prefers to lie flat still tips up toward
 * the viewer, and an element whose home pose is deliberately tilted keeps
 * that tilt, because within the tolerance the result is exactly `home`.
 *
 * Everything here is pure and allocation-free so it can run per element per
 * frame, and so the rule can be tested without a renderer.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

/** Local axes, three.js convention: the element faces +z with +y up. */
const LOCAL_FORWARD = new Vector3(0, 0, 1);
const LOCAL_UP = new Vector3(0, 1, 0);
const LOCAL_RIGHT = new Vector3(1, 0, 0);

const _dir = new Vector3();
const _forward = new Vector3();
const _axis = new Vector3();
const _delta = new Quaternion();
const _upRef = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _basis = new Matrix4();

/**
 * The orientation an element should render with this frame.
 *
 * @param home      Its preferred pose (parent-space quaternion).
 * @param toCamera  Vector from the element to the camera; need not be unit.
 * @param maxAngle  Tolerance in radians around facing the camera. The result
 *                  is `home` whenever home's forward is already within this
 *                  angle of `toCamera`, and otherwise the smallest rotation
 *                  of `home` that brings it back to exactly this angle.
 * @param out       Optional target, to keep the frame loop allocation-free.
 */
export function clampedBillboardQuaternion(
  home: Quaternion,
  toCamera: Vector3,
  maxAngle: number,
  out: Quaternion = new Quaternion(),
): Quaternion {
  out.copy(home);
  if (toCamera.lengthSq() < 1e-12) return out;

  _dir.copy(toCamera).normalize();
  _forward.copy(LOCAL_FORWARD).applyQuaternion(home);

  const angle = Math.acos(Math.min(1, Math.max(-1, _forward.dot(_dir))));
  const excess = angle - Math.max(0, maxAngle);
  if (excess <= 0) return out; // still legible from here — hold the home pose

  _axis.crossVectors(_forward, _dir);
  if (_axis.lengthSq() < 1e-12) {
    // Facing exactly away from the camera: every axis is "minimal", so pick
    // the element's own up and turn about that deterministically.
    _axis.copy(LOCAL_UP).applyQuaternion(home);
  }
  _axis.normalize();

  // Where the element now points — the two degrees of freedom the rule owns.
  _delta.setFromAxisAngle(_axis, excess);
  _forward.applyQuaternion(_delta);

  return orientTowards(_forward, home, out);
}

/**
 * Builds the orientation that faces `forward` while keeping the element's
 * up as close as possible to the home pose's up — the third degree of
 * freedom, pinned rather than left to fall out of the turn.
 *
 * With `forward` equal to the home pose's own forward this reproduces
 * `home` exactly, which is what lets the caller treat "inside the
 * tolerance" as "don't touch it".
 */
function orientTowards(forward: Vector3, home: Quaternion, out: Quaternion): Quaternion {
  _upRef.copy(LOCAL_UP).applyQuaternion(home);
  _right.crossVectors(_upRef, forward);
  if (_right.lengthSq() < 1e-12) {
    // Looking straight along the element's up: its up cannot disambiguate
    // roll, so fall back to the home pose's right, which is perpendicular
    // to that up by construction.
    _right.copy(LOCAL_RIGHT).applyQuaternion(home);
  }
  _right.normalize();
  _up.crossVectors(forward, _right).normalize();
  // Re-derive right from the orthonormalised pair so the basis is exact.
  _right.crossVectors(_up, forward);

  _basis.makeBasis(_right, _up, forward);
  return out.setFromRotationMatrix(_basis);
}

/**
 * Blend factor for easing toward a target over `dt` seconds.
 *
 * Snapping straight to the clamped orientation is correct but reads as
 * mechanical — the element teleports the instant the tolerance is crossed.
 * Easing with `q.slerp(target, smoothingAlpha(...))` reaches the same
 * destination with a settle, which is what makes the UI feel alive.
 *
 * `responsiveness` is the exponential rate (1/s): higher snaps faster, 0
 * disables easing entirely. The exp() form makes the result frame-rate
 * independent — the same wall-clock time gets the same progress whether it
 * arrived in one long frame or several short ones.
 */
export function smoothingAlpha(responsiveness: number, dt: number): number {
  if (!(responsiveness > 0)) return 1;
  if (!(dt > 0)) return 0;
  return 1 - Math.exp(-responsiveness * dt);
}

/**
 * Scale that keeps an element's apparent size constant as the camera moves,
 * given the distance it was authored to look right at. Elements sized in
 * metres shrink to illegibility when the camera pulls back; scaling by the
 * distance ratio holds them at a fixed size on screen. Essential for
 * anything you have to *aim at*, optional for anything you only read.
 */
export function apparentSizeScale(distance: number, referenceDistance: number): number {
  if (!(referenceDistance > 0)) return 1;
  return distance / referenceDistance;
}
