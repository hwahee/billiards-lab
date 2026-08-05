/**
 * <FacingGroup> — an in-scene element that orients itself by the
 * clamped-billboard rule (./billboard).
 *
 * Beyond the rule itself it carries the two things such elements always
 * turn out to need:
 *
 *  - `responsiveness` eases into each new orientation instead of snapping,
 *    so crossing the tolerance reads as a turn rather than a teleport;
 *  - `constantSizeAt` holds a constant apparent size, without which
 *    anything sized in metres becomes unusable as the camera pulls back.
 *
 * The home pose may change between frames (to follow an aim direction, say)
 * — the group simply eases toward the new one.
 *
 * Assumes it is mounted directly under the scene root, as everything in
 * this scene is, so its local quaternion is also its world quaternion.
 */
import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import { Euler, Quaternion, Vector3, type Group } from 'three';

import { apparentSizeScale, clampedBillboardQuaternion, smoothingAlpha } from './billboard';

const _worldPos = new Vector3();
const _toCamera = new Vector3();
const _target = new Quaternion();
const _home = new Quaternion();
const _euler = new Euler();
const ZERO_ROTATION = [0, 0, 0] as const;

export interface FacingGroupProps {
  /** Scene position (three.js axes). */
  position: readonly [number, number, number];
  /**
   * The pose this element prefers, as Euler angles in radians. Defaults to
   * the identity pose, which faces +z — i.e. toward the default camera.
   */
  homeRotation?: readonly [number, number, number];
  /**
   * How far the home pose may sit from facing the camera before the element
   * starts turning, in radians. 0 gives a classic always-face-me billboard.
   */
  maxAngle: number;
  /** Exponential rate (1/s) of the ease toward the computed orientation. */
  responsiveness?: number;
  /** Camera distance at which `scale` is taken literally; keeps size on screen. */
  constantSizeAt?: number;
  scale?: number;
  children: ReactNode;
}

export function FacingGroup({
  position,
  homeRotation,
  maxAngle,
  responsiveness = 0,
  constantSizeAt,
  scale = 1,
  children,
}: FacingGroupProps) {
  const groupRef = useRef<Group>(null);
  const settledRef = useRef(false);
  // Closed over directly: R3F always invokes the latest callback, so a home
  // pose that changes between frames is picked up without any extra state.
  const home = homeRotation ?? ZERO_ROTATION;

  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const [hx, hy, hz] = home;
    _home.setFromEuler(_euler.set(hx, hy, hz));

    group.getWorldPosition(_worldPos);
    _toCamera.copy(camera.position).sub(_worldPos);
    clampedBillboardQuaternion(_home, _toCamera, maxAngle, _target);

    // The first frame lands on the target outright: easing in from the home
    // pose would read as the element flying into place on mount.
    const alpha = settledRef.current ? smoothingAlpha(responsiveness, delta) : 1;
    settledRef.current = true;
    if (alpha >= 1) group.quaternion.copy(_target);
    else group.quaternion.slerp(_target, alpha);

    group.scale.setScalar(
      constantSizeAt === undefined
        ? scale
        : scale * apparentSizeScale(_toCamera.length(), constantSizeAt),
    );
  });

  return (
    <group ref={groupRef} position={[...position]}>
      {children}
    </group>
  );
}
