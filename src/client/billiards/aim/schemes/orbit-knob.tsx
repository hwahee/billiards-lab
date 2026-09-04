/**
 * Aim scheme: a knob orbiting the cue ball.
 *
 *   - the knob's bearing around the ball is the aim direction,
 *   - its distance from the ball is the shot power.
 *
 * Direct and precise — the whole shot is one drag, and both quantities are
 * legible from the widget itself without reading any numbers.
 *
 * Use of the UI substrate: an UPRIGHT readout panel that keeps a fixed
 * world pose (32° tolerance, eased). The ground ring is deliberately not
 * billboarded — it belongs to the cloth and reads correctly flat.
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
  circlePoints,
  distanceToPower,
  offsetFromCue,
  powerColor,
  powerToSpeed,
  speedToPower,
} from '../model';
import type { AimSchemeProps } from '../scheme';

/** Knob distance from the cue ball at min / max power (m). */
const MIN_RADIUS = 0.085;
const MAX_RADIUS = 0.34;
/** Height the flat ring floats above the cloth, to avoid z-fighting (m). */
const RING_LIFT = 0.003;

const PANEL_MAX_ANGLE = (32 * Math.PI) / 180;
const PANEL_RESPONSIVENESS = 9;

export function OrbitKnobAim({ cue, shot, onShotChange, ballRadius }: AimSchemeProps) {
  const drag = useDragHandle('aim');
  const [hovered, setHovered] = useState(false);
  useCursor(drag.active, 'grabbing');
  useCursor(!drag.active && hovered, 'grab');

  const power = speedToPower(shot.speed);
  const accent = powerColor(power);
  const aimRad = (shot.directionDeg * Math.PI) / 180;
  const knobRadius = MIN_RADIUS + power * (MAX_RADIUS - MIN_RADIUS);

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

  const trackPoints = useMemo(() => circlePoints(MAX_RADIUS), []);
  const deadZonePoints = useMemo(() => circlePoints(MIN_RADIUS), []);

  const knob: [number, number, number] = [
    Math.cos(aimRad) * knobRadius,
    0,
    -Math.sin(aimRad) * knobRadius,
  ];

  const applyPointer = (event: ThreeEvent<PointerEvent>) => {
    const { distance, bearingDeg } = offsetFromCue(cue, event.point);
    if (distance < 1e-4) return;
    onShotChange({
      ...shot,
      directionDeg: bearingDeg,
      speed: powerToSpeed(distanceToPower(distance, MIN_RADIUS, MAX_RADIUS)),
    });
  };

  return (
    <>
      <group position={[cue.position.x, RING_LIFT, -cue.position.y]}>
        {/* Power track and its inner dead zone, printed on the cloth. */}
        <Line points={trackPoints} color="#ffffff" lineWidth={1} transparent opacity={0.22} />
        <Line points={deadZonePoints} color="#ffffff" lineWidth={1} transparent opacity={0.14} />
        {/* Shaft from the ball out to the knob: direction + power at a glance. */}
        <Line points={[[0, 0, 0], knob]} color={accent} lineWidth={3} transparent opacity={0.95} />
        <mesh position={[knob[0], ballRadius * 0.55, knob[2]]}>
          <sphereGeometry args={[ballRadius * 0.5, 24, 16]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
        </mesh>
        {/* Generous invisible hit sphere — the visible knob is small. */}
        <mesh
          position={[knob[0], ballRadius * 0.55, knob[2]]}
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
          <sphereGeometry args={[ballRadius * 1.6, 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      <FacingGroup
        position={[cue.position.x, ballRadius + 0.19, -cue.position.y]}
        maxAngle={PANEL_MAX_ANGLE}
        responsiveness={PANEL_RESPONSIVENESS}
      >
        <Panel texture={texture} width={0.3} />
      </FacingGroup>

      {drag.active && <DragSurface y={RING_LIFT} onMove={applyPointer} onRelease={drag.release} />}
    </>
  );
}
