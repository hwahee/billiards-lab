/**
 * Aim scheme: one gesture per quantity.
 *
 * Every other scheme sets direction AND power from a single drag, which
 * looks efficient and plays badly: you cannot nudge the aim without also
 * disturbing the power, so a shot takes several corrective passes, and each
 * pointer move changes both halves of the shot at once. Here the two are
 * separate controls that cannot interfere:
 *
 *  - a RING on the cloth at a FIXED radius — sweep it round to aim. The
 *    radius is fixed, so no amount of dragging can touch the power;
 *  - a COLUMN standing over the ball — drag it up and down for power. It is
 *    vertical, so no amount of dragging can touch the aim.
 *
 * The gestures are orthogonal in meaning and in motion — a sweep versus a
 * lift — which is what makes them impossible to confuse mid-shot.
 *
 * Use of the UI substrate: the first scheme to drag something that is NOT on
 * the cloth. The column is laid out in its own upright plane, and
 * <PlaneDragSurface> keeps the drag in exactly those coordinates once the
 * pointer leaves the column, so the picture and the hit test share one axis.
 */
import { Line, useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import type { CanvasTexture } from 'three';

import {
  createPanelCanvas,
  DragSurface,
  FacingGroup,
  finishPanelTexture,
  makeChipTexture,
  Panel,
  panelBar,
  PANEL_INK_DIM,
  panelFrame,
  panelText,
  PlaneDragSurface,
  useDragHandle,
  useOwnedTexture,
} from '../../ui';
import {
  circlePoints,
  clamp01,
  offsetFromCue,
  powerColor,
  powerToSpeed,
  speedToPower,
} from '../model';
import type { AimSchemeProps } from '../scheme';

/** Aim ring radius on the cloth (m). Fixed — this control sets direction only. */
const RING_RADIUS = 0.185;
/** Ring and sightline float just above the cloth. */
const LIFT = 0.003;

/** Power column size in metres; the canvas below is authored to this shape. */
const COLUMN_WIDTH = 0.102;
const COLUMN_HEIGHT = 0.34;
/**
 * The grabbable stretch of the column, in the column group's own local
 * metres (its origin is the foot of the column). Painter and hit test both
 * read this, so what you see and what you can grab cannot drift apart.
 */
export const POWER_TRACK = { bottom: 0.04, top: 0.255 } as const;

/** Power for a pointer at local height `y` on the column. Pure, so it is testable. */
export function powerFromLocalY(y: number): number {
  return clamp01((y - POWER_TRACK.bottom) / (POWER_TRACK.top - POWER_TRACK.bottom));
}

const CHIP_MAX_ANGLE = (30 * Math.PI) / 180;
const CHIP_RESPONSIVENESS = 9;
/** The column is a control surface, so it stays close to square-on. */
const COLUMN_MAX_ANGLE = (16 * Math.PI) / 180;
const COLUMN_RESPONSIVENESS = 13;
const COLUMN_REFERENCE_DISTANCE = 2.4;

const COLUMN_CANVAS = { width: 192, height: 640 } as const;

/** Local metres → canvas pixels down the column. */
function columnY(localY: number): number {
  return (1 - localY / COLUMN_HEIGHT) * COLUMN_CANVAS.height;
}

function makePowerColumnTexture({
  speed,
  power,
  accent,
}: {
  speed: number;
  power: number;
  accent: string;
}): CanvasTexture {
  const { canvas, ctx } = createPanelCanvas(COLUMN_CANVAS);
  const { width, height } = COLUMN_CANVAS;

  panelFrame(ctx, { width, height, accent, inset: 6, radius: 34 });

  const cx = width / 2;
  const foot = columnY(POWER_TRACK.bottom);
  const head = columnY(POWER_TRACK.top);
  const trackLength = foot - head;
  const trackWidth = 58;

  // panelBar draws left-to-right; rotate the frame so the same rounded track
  // (and the same fill semantics) runs bottom-to-top instead.
  ctx.save();
  ctx.translate(cx, foot);
  ctx.rotate(-Math.PI / 2);
  panelBar(ctx, {
    x: 0,
    y: -trackWidth / 2,
    width: trackLength,
    height: trackWidth,
    value: power,
    color: accent,
  });
  ctx.restore();

  // Thumb, so the grabbable point is obvious.
  ctx.beginPath();
  ctx.arc(cx, foot - trackLength * power, 30, 0, Math.PI * 2);
  ctx.fillStyle = '#f4efe2';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = accent;
  ctx.stroke();

  panelText(ctx, {
    text: speed.toFixed(1),
    x: cx,
    y: 84,
    size: 56,
    weight: 'bold',
    align: 'center',
  });
  panelText(ctx, {
    text: 'm/s',
    x: cx,
    y: 130,
    size: 28,
    align: 'center',
    color: PANEL_INK_DIM,
  });

  return finishPanelTexture(canvas);
}

export function SplitControlsAim({ cue, shot, onShotChange, ballRadius }: AimSchemeProps) {
  const ringDrag = useDragHandle('aim:direction');
  const powerDrag = useDragHandle('aim:power');
  const [hovered, setHovered] = useState<'ring' | 'column' | null>(null);
  useCursor(ringDrag.active || powerDrag.active, 'grabbing');
  useCursor(!ringDrag.active && !powerDrag.active && hovered !== null, 'grab');

  const power = speedToPower(shot.speed);
  const accent = powerColor(power);
  const aimRad = (shot.directionDeg * Math.PI) / 180;

  const ringPoints = useMemo(() => circlePoints(RING_RADIUS), []);
  const knob: [number, number, number] = [
    Math.cos(aimRad) * RING_RADIUS,
    0,
    -Math.sin(aimRad) * RING_RADIUS,
  ];

  const chipTexture = useOwnedTexture(
    useMemo(
      () => makeChipTexture({ text: `${shot.directionDeg.toFixed(0)}°`, accent }),
      [shot.directionDeg, accent],
    ),
  );
  const columnTexture = useOwnedTexture(
    useMemo(
      () => makePowerColumnTexture({ speed: shot.speed, power, accent }),
      [shot.speed, power, accent],
    ),
  );

  /** Only the bearing is read — the ring's radius is not a variable. */
  const applyBearing = (event: ThreeEvent<PointerEvent>) => {
    const { distance, bearingDeg } = offsetFromCue(cue, event.point);
    if (distance < 1e-4) return;
    onShotChange({ ...shot, directionDeg: bearingDeg });
  };

  /** Only the height is read — the column stands still. */
  const applyHeight = (localY: number) => {
    onShotChange({ ...shot, speed: powerToSpeed(powerFromLocalY(localY)) });
  };

  return (
    <>
      <group position={[cue.position.x, LIFT, -cue.position.y]}>
        {/* Sightline: where the shot goes, how hard. Feedback, not a control. */}
        <Line
          points={[
            [Math.cos(aimRad) * ballRadius, 0, -Math.sin(aimRad) * ballRadius],
            [
              Math.cos(aimRad) * (ballRadius + 0.12 + power * 0.5),
              0,
              -Math.sin(aimRad) * (ballRadius + 0.12 + power * 0.5),
            ],
          ]}
          color={accent}
          lineWidth={3}
          transparent
          opacity={0.9}
        />
        <Line points={ringPoints} color="#ffffff" lineWidth={1.5} transparent opacity={0.3} />
        <mesh position={[knob[0], ballRadius * 0.5, knob[2]]}>
          <sphereGeometry args={[ballRadius * 0.5, 24, 16]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
        </mesh>
        {/* Grab anywhere on the ring, not just the knob. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ballRadius * 0.5, 0]}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            ringDrag.claim();
            applyBearing(event);
          }}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            setHovered('ring');
          }}
          onPointerOut={() => setHovered((current) => (current === 'ring' ? null : current))}
        >
          <torusGeometry args={[RING_RADIUS, ballRadius * 1.7, 8, 48]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* Bearing readout, riding along with the knob. */}
      <FacingGroup
        position={[
          cue.position.x + Math.cos(aimRad) * RING_RADIUS,
          ballRadius * 1.9,
          -(cue.position.y + Math.sin(aimRad) * RING_RADIUS),
        ]}
        maxAngle={CHIP_MAX_ANGLE}
        responsiveness={CHIP_RESPONSIVENESS}
      >
        <Panel texture={chipTexture} width={0.1} />
      </FacingGroup>

      {/* Power column: origin at its foot, just above the ball. */}
      <FacingGroup
        position={[cue.position.x, ballRadius * 2, -cue.position.y]}
        maxAngle={COLUMN_MAX_ANGLE}
        responsiveness={COLUMN_RESPONSIVENESS}
        constantSizeAt={COLUMN_REFERENCE_DISTANCE}
      >
        <group position={[0, COLUMN_HEIGHT / 2, 0]}>
          <Panel
            texture={columnTexture}
            width={COLUMN_WIDTH}
            height={COLUMN_HEIGHT}
            onPointerDown={(event: ThreeEvent<PointerEvent>) => {
              if (!event.uv) return;
              event.stopPropagation();
              powerDrag.claim();
              applyHeight(event.uv.y * COLUMN_HEIGHT);
            }}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              setHovered('column');
            }}
            onPointerOut={() => setHovered((current) => (current === 'column' ? null : current))}
          />
        </group>
        {powerDrag.active && (
          <PlaneDragSurface
            size={4}
            onMove={(local) => applyHeight(local.y)}
            onRelease={powerDrag.release}
          />
        )}
      </FacingGroup>

      {ringDrag.active && (
        <DragSurface y={LIFT} onMove={applyBearing} onRelease={ringDrag.release} />
      )}
    </>
  );
}
