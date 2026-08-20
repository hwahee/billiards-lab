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
 * WHAT THE TOLERANCE MEASURES. The obvious reading of "how far from facing
 * the camera" is the angle of the element's forward axis, which constrains
 * two degrees of freedom and leaves the third — roll about that axis —
 * to whatever the turn happens to produce. That is a trap, and it renders
 * elements upside down:
 *
 *   - the minimal turn from home drags the element's up vector along with
 *     it, so a camera swinging round behind an element rolls it right over;
 *   - and pinning the roll to a world-space reference instead only moves
 *     the problem, because the reference vanishes exactly when the camera
 *     looks along it — an overhead camera over a table, say.
 *
 * "Upside down" is a screen-space property, so it can only be ruled out
 * against a screen-space reference. This module therefore measures the
 * tolerance as the angle of the WHOLE ROTATION between the home pose and
 * the fully-specified camera-facing pose (pointing at the camera, upright
 * on screen), and clamps along the geodesic between them. All three
 * degrees of freedom are then accounted for by the one number, which buys
 * a guarantee the axis-only reading cannot make:
 *
 *   the element's facing is within `maxAngle` of the camera, AND its up
 *   vector is within `maxAngle` of screen up — always, from every angle.
 *
 * Inside the tolerance the result is still exactly `home`, so an element
 * that prefers to lie flat, or that is deliberately tilted, keeps its pose
 * for as long as it is legible; past the boundary the tilt is corrected
 * along with everything else, which is the point.
 *
 * One configuration stays ambiguous and always will: a camera exactly
 * opposite the home pose, where turning left and turning right are mirror
 * images of each other and equally minimal. Crossing it swaps the choice.
 * Nothing stateless can avoid that, but the swap is bounded by twice the
 * tolerance — both choices are within `maxAngle` of facing the camera
 * upright — so it reads as a lean one way becoming a lean the other, and
 * `smoothingAlpha` turns it into a settle rather than a jump.
 *
 * Everything here is pure and allocation-free so it can run per element per
 * frame, and so the rule can be tested without a renderer.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _basis = new Matrix4();
const _facing = new Quaternion();

/**
 * The orientation an element should render with this frame.
 *
 * @param home      Its preferred pose (parent-space quaternion).
 * @param toCamera  Vector from the element to the camera; need not be unit.
 * @param cameraUp  The camera's own up axis in world space — which way is up
 *                  on screen. Column 1 of the camera's world matrix.
 * @param maxAngle  Tolerance in radians. The result is `home` whenever home
 *                  is already within this angle of facing the camera
 *                  upright, and otherwise the smallest rotation of `home`
 *                  that brings it back to exactly this angle.
 * @param out       Optional target, to keep the frame loop allocation-free.
 */
export function clampedBillboardQuaternion(
  home: Quaternion,
  toCamera: Vector3,
  cameraUp: Vector3,
  maxAngle: number,
  out: Quaternion = new Quaternion(),
): Quaternion {
  out.copy(home);
  if (toCamera.lengthSq() < 1e-12) return out;

  facingQuaternion(toCamera, cameraUp, _facing);

  const angle = out.angleTo(_facing);
  const excess = angle - Math.max(0, maxAngle);
  if (excess <= 0) return out; // still legible from here — hold the home pose

  // Travel the geodesic just far enough to land on the tolerance boundary.
  return out.slerp(_facing, excess / angle);
}

/**
 * The pose that faces the camera squarely and sits upright on screen — the
 * plain billboard, and the anchor the tolerance is measured against.
 */
function facingQuaternion(toCamera: Vector3, cameraUp: Vector3, out: Quaternion): Quaternion {
  _forward.copy(toCamera).normalize();
  _right.crossVectors(cameraUp, _forward);
  if (_right.lengthSq() < 1e-12) {
    // A camera whose up axis is its view direction is not a camera any real
    // one can be in, but the rule must still answer: any perpendicular does.
    _right.set(_forward.y, -_forward.x, 0);
    if (_right.lengthSq() < 1e-12) _right.set(1, 0, 0);
  }
  _right.normalize();
  _up.crossVectors(_forward, _right);

  _basis.makeBasis(_right, _up, _forward);
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
