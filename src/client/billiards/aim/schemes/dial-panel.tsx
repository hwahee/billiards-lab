/**
 * Aim scheme: a floating control panel you operate directly.
 *
 * A direction dial on the left, a power slider on the right, and you drag
 * ON the panel — the same gesture as a 2D UI, except the widget is an
 * object in the scene. Good when the cloth is crowded, since it needs no
 * room around the ball.
 *
 * Use of the UI substrate: the demanding end of it. The panel is
 * INTERACTIVE (pointer hits read back as `event.uv`), so it has to stay
 * square-on and a usable size — a tight 12° tolerance keeps it near
 * camera-facing and `constantSizeAt` holds its apparent size however far
 * the camera pulls back.
 *
 * The zone geometry is declared ONCE, in uv, and used by both the painter
 * and the hit test — the two going quietly out of step is exactly the bug
 * this shape of widget invites.
 */
import { Line, useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useState } from 'react';

import {
  createPanelCanvas,
  FacingGroup,
  finishPanelTexture,
  Panel,
  panelBar,
  panelDial,
  panelFrame,
  PANEL_INK_DIM,
  PANEL_SIZE,
  panelText,
  useDragHandle,
  useOwnedTexture,
} from '../../ui';
import { clamp01, normaliseDeg, powerColor, powerToSpeed, speedToPower } from '../model';
import type { CanvasTexture } from 'three';

import type { AimSchemeProps } from '../scheme';

const PANEL_WIDTH = 0.34;
/** Near-billboard: a control surface has to stay square-on to be usable. */
const PANEL_MAX_ANGLE = (12 * Math.PI) / 180;
const PANEL_RESPONSIVENESS = 14;
/** Camera distance at which PANEL_WIDTH is taken literally. */
const PANEL_REFERENCE_DISTANCE = 2.4;

/**
 * Panel layout in uv (0–1, origin bottom-left). The panel is twice as wide
 * as it is tall, so horizontal distances must be scaled by ASPECT to stay
 * circular.
 */
export const LAYOUT = {
  aspect: 2,
  dial: { u: 0.23, v: 0.5, radiusV: 0.34, hitSlack: 1.15 },
  slider: { u0: 0.5, u1: 0.92, v: 0.5, halfHeight: 0.2, grabSlack: 0.04 },
} as const;

export type DialHit =
  { kind: 'direction'; directionDeg: number } | { kind: 'power'; power: number } | { kind: 'none' };

/** Interprets a hit on the panel. Pure, so the zones can be tested directly. */
export function readDialPanel(u: number, v: number): DialHit {
  const { dial, slider, aspect } = LAYOUT;
  const du = (u - dial.u) * aspect;
  const dv = v - dial.v;
  const radial = Math.hypot(du, dv);
  if (radial <= dial.radiusV * dial.hitSlack) {
    // Dead centre carries no meaningful angle.
    if (radial < 0.02) return { kind: 'none' };
    return { kind: 'direction', directionDeg: normaliseDeg((Math.atan2(dv, du) * 180) / Math.PI) };
  }
  if (u >= slider.u0 - slider.grabSlack && Math.abs(v - slider.v) <= slider.halfHeight) {
    return { kind: 'power', power: clamp01((u - slider.u0) / (slider.u1 - slider.u0)) };
  }
  return { kind: 'none' };
}

/**
 * The panel picture. Reads the same LAYOUT the hit test does, so what is
 * drawn and what is clickable cannot drift apart.
 */
function makeDialPanelTexture({
  directionDeg,
  power,
  accent,
}: {
  directionDeg: number;
  power: number;
  accent: string;
}): CanvasTexture {
  const { canvas, ctx } = createPanelCanvas();
  const { width, height } = PANEL_SIZE;
  const { dial, slider } = LAYOUT;

  panelFrame(ctx, { width, height, accent, inset: 6 });

  const cx = dial.u * width;
  const cy = (1 - dial.v) * height;
  const radius = dial.radiusV * height;
  panelDial(ctx, { cx, cy, radius, angleDeg: directionDeg, color: accent });
  panelText(ctx, {
    text: `${directionDeg.toFixed(0)}°`,
    x: cx,
    y: cy + radius + 24,
    size: 30,
    weight: 'bold',
    align: 'center',
    color: PANEL_INK_DIM,
  });

  const x0 = slider.u0 * width;
  const x1 = slider.u1 * width;
  const trackY = (1 - slider.v) * height;
  panelBar(ctx, { x: x0, y: trackY - 15, width: x1 - x0, height: 30, value: power, color: accent });
  // Thumb, so the grabbable point is obvious.
  ctx.beginPath();
  ctx.arc(x0 + (x1 - x0) * power, trackY, 17, 0, Math.PI * 2);
  ctx.fillStyle = '#f4efe2';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();
  panelText(ctx, {
    text: 'POWER',
    x: (x0 + x1) / 2,
    y: trackY - 44,
    size: 24,
    align: 'center',
    color: PANEL_INK_DIM,
  });
  panelText(ctx, {
    text: `${powerToSpeed(power).toFixed(1)} m/s`,
    x: (x0 + x1) / 2,
    y: trackY + 46,
    size: 30,
    weight: 'bold',
    align: 'center',
    color: PANEL_INK_DIM,
  });

  return finishPanelTexture(canvas);
}

export function DialPanelAim({ cue, shot, onShotChange, ballRadius }: AimSchemeProps) {
  const drag = useDragHandle('aim');
  const [hovered, setHovered] = useState(false);
  useCursor(drag.active, 'grabbing');
  useCursor(!drag.active && hovered, 'pointer');

  const power = speedToPower(shot.speed);
  const accent = powerColor(power);
  const aimRad = (shot.directionDeg * Math.PI) / 180;

  const texture = useOwnedTexture(
    useMemo(
      () => makeDialPanelTexture({ directionDeg: shot.directionDeg, power, accent }),
      [shot.directionDeg, power, accent],
    ),
  );

  const apply = (event: ThreeEvent<PointerEvent>) => {
    if (!event.uv) return;
    const hit = readDialPanel(event.uv.x, event.uv.y);
    if (hit.kind === 'direction') onShotChange({ ...shot, directionDeg: hit.directionDeg });
    else if (hit.kind === 'power') onShotChange({ ...shot, speed: powerToSpeed(hit.power) });
  };

  const reach = 0.16 + power * 0.5;

  return (
    <>
      {/* Feedback on the cloth: where the shot actually points. */}
      <group position={[cue.position.x, 0.003, -cue.position.y]}>
        <Line
          points={[
            [Math.cos(aimRad) * ballRadius, 0, -Math.sin(aimRad) * ballRadius],
            [Math.cos(aimRad) * reach, 0, -Math.sin(aimRad) * reach],
          ]}
          color={accent}
          lineWidth={3}
          transparent
          opacity={0.9}
        />
      </group>

      <FacingGroup
        position={[cue.position.x, ballRadius + 0.24, -cue.position.y]}
        maxAngle={PANEL_MAX_ANGLE}
        responsiveness={PANEL_RESPONSIVENESS}
        constantSizeAt={PANEL_REFERENCE_DISTANCE}
      >
        <Panel
          texture={texture}
          width={PANEL_WIDTH}
          onPointerDown={(event) => {
            event.stopPropagation();
            drag.claim();
            apply(event);
          }}
          onPointerMove={(event) => {
            if (!drag.active) return;
            event.stopPropagation();
            apply(event);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            drag.release();
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => setHovered(false)}
        />
      </FacingGroup>
    </>
  );
}
