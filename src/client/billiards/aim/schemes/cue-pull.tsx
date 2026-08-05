/**
 * Aim scheme: pull the cue back, like a real shot.
 *
 * Grab the stick and drag away from the ball — the direction you pull is
 * the direction the ball will NOT go, and how far you pull is the power.
 * Familiar to anyone who has held a cue, and the stick doubles as the power
 * gauge without needing a separate one.
 *
 * Use of the UI substrate: a readout whose HOME POSE IS DYNAMIC — it lies
 * along the shot line (yawed with the aim), so it re-poses every time the
 * aim changes and the tolerance is measured against a moving target. A wide
 * tolerance (44°) keeps it feeling planted in the world.
 */
import { Line, useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';

import {
  DragSurface,
  FacingGroup,
  makeReadoutPanelTexture,
  Panel,
  useDragHandle,
  useOwnedTexture,
} from '../../ui';
import {
  distanceToPower,
  normaliseDeg,
  offsetFromCue,
  powerColor,
  powerToSpeed,
  speedToPower,
} from '../model';
import type { AimSchemeProps } from '../scheme';

/** How far behind the ball the cue tip sits at min / max power (m). */
const MIN_PULL = 0.055;
const MAX_PULL = 0.42;
const STICK_LENGTH = 0.55;
const STICK_RADIUS = 0.009;
const LIFT = 0.003;

const PANEL_MAX_ANGLE = (44 * Math.PI) / 180;
const PANEL_RESPONSIVENESS = 7;

export function CuePullAim({ cue, shot, onShotChange, ballRadius }: AimSchemeProps) {
  const drag = useDragHandle('aim');
  const [hovered, setHovered] = useState(false);
  useCursor(drag.active, 'grabbing');
  useCursor(!drag.active && hovered, 'grab');

  const power = speedToPower(shot.speed);
  const accent = powerColor(power);
  const aimRad = (shot.directionDeg * Math.PI) / 180;
  const pull = MIN_PULL + power * (MAX_PULL - MIN_PULL);

  const texture = useOwnedTexture(
    useMemo(
      () =>
        makeReadoutPanelTexture({
          speed: shot.speed,
          directionDeg: shot.directionDeg,
          power,
          accent,
        }),
      [shot.speed, shot.directionDeg, power, accent],
    ),
  );

  const applyPointer = (event: ThreeEvent<PointerEvent>) => {
    const { distance, bearingDeg } = offsetFromCue(cue, event.point);
    if (distance < 1e-4) return;
    onShotChange({
      ...shot,
      // Pulling back: the ball travels opposite the pull.
      directionDeg: normaliseDeg(bearingDeg + 180),
      speed: powerToSpeed(distanceToPower(distance, MIN_PULL, MAX_PULL)),
    });
  };

  return (
    <>
      {/* Yawing by the aim angle makes local +x the shot direction, so the
          cue lays out along a single axis. */}
      <group position={[cue.position.x, LIFT, -cue.position.y]} rotation={[0, aimRad, 0]}>
        <Line
          points={[
            [ballRadius, 0, 0],
            [ballRadius + 0.16 + power * 0.5, 0, 0],
          ]}
          color="#ffffff"
          lineWidth={1.5}
          transparent
          opacity={0.5}
        />
        {/* Travel of the cue, drawn behind the ball as a power scale. */}
        <Line
          points={[
            [-MIN_PULL, 0, 0],
            [-MAX_PULL, 0, 0],
          ]}
          color="#ffffff"
          lineWidth={1}
          transparent
          opacity={0.18}
        />
        <group position={[-(pull + STICK_LENGTH / 2), ballRadius * 0.9, 0]}>
          <mesh castShadow rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[STICK_RADIUS * 1.7, STICK_RADIUS, STICK_LENGTH, 20]} />
            <meshStandardMaterial color="#c8a06a" roughness={0.55} />
          </mesh>
          <mesh position={[STICK_LENGTH / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry args={[STICK_RADIUS, STICK_RADIUS, 0.03, 16]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} />
          </mesh>
          {/* Invisible grab volume along the whole stick. */}
          <mesh
            rotation={[0, 0, -Math.PI / 2]}
            onPointerDown={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              drag.claim();
            }}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              setHovered(true);
            }}
            onPointerOut={() => setHovered(false)}
          >
            <cylinderGeometry args={[ballRadius * 1.2, ballRadius * 1.2, STICK_LENGTH, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>

      <FacingGroup
        position={[cue.position.x, ballRadius + 0.2, -cue.position.y]}
        homeRotation={[0, aimRad, 0]}
        maxAngle={PANEL_MAX_ANGLE}
        responsiveness={PANEL_RESPONSIVENESS}
      >
        <Panel texture={texture} width={0.28} />
      </FacingGroup>

      {drag.active && <DragSurface y={LIFT} onMove={applyPointer} onRelease={drag.release} />}
    </>
  );
}
