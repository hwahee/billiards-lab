/**
 * Aim scheme: a screen-space HUD, detached from the ball entirely.
 *
 * The control is a panel pinned to the corner of the view — a direction
 * dial and a power slider — rather than a widget on the cue ball. That buys
 * three things the in-world schemes cannot have: it never sits on top of
 * the balls, it stays exactly where the hand expects regardless of camera
 * moves, and being ordinary DOM it is keyboard operable (both controls are
 * focusable ARIA sliders; arrows nudge, shift+arrows jump, Home/End go to
 * the extremes).
 *
 * Use of the UI substrate: the HUD layer rather than the billboard rule —
 * the screen-space answer to the same question. The only thing it puts in
 * the world is a sightline, which is feedback, not a control.
 */
import { Line } from '@react-three/drei';
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { useI18n } from '../../../i18n/locale-context';
import { TESTID } from '../../../testing/testids';
import { HudPanel } from '../../ui';
import { clamp01, normaliseDeg, powerColor, powerToSpeed, speedToPower, STEP } from '../model';
import type { AimSchemeProps } from '../scheme';

function DirectionDial({
  directionDeg,
  onChange,
  label,
}: {
  directionDeg: number;
  onChange: (deg: number) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const applyFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    // Screen y grows downward; table bearings grow counter-clockwise.
    onChange(normaliseDeg((Math.atan2(-dy, dx) * 180) / Math.PI));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP.coarseDirectionDeg : STEP.directionDeg;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      onChange(normaliseDeg(directionDeg + step));
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      onChange(normaliseDeg(directionDeg - step));
    else if (event.key === 'Home') onChange(0);
    else if (event.key === 'End') onChange(180);
    else return;
    event.preventDefault();
  };

  const rad = (directionDeg * Math.PI) / 180;
  const nx = 50 + Math.cos(rad) * 33;
  const ny = 50 - Math.sin(rad) * 33;

  return (
    <div
      ref={ref}
      className="aim-hud__dial"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={Math.round(directionDeg)}
      aria-valuetext={`${Math.round(directionDeg)}°`}
      data-testid={TESTID.billiards.aimHudDial}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        applyFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) applyFromPointer(event);
      }}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="0 0 100 100" aria-hidden focusable="false">
        <circle className="aim-hud__dial-face" cx="50" cy="50" r="44" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const inner = i % 3 === 0 ? 32 : 37;
          return (
            <line
              key={i}
              className="aim-hud__dial-tick"
              x1={50 + Math.cos(a) * inner}
              y1={50 - Math.sin(a) * inner}
              x2={50 + Math.cos(a) * 42}
              y2={50 - Math.sin(a) * 42}
            />
          );
        })}
        <line className="aim-hud__dial-needle" x1="50" y1="50" x2={nx} y2={ny} />
        <circle className="aim-hud__dial-knob" cx={nx} cy={ny} r="6.5" />
        <circle className="aim-hud__dial-hub" cx="50" cy="50" r="3.5" />
      </svg>
    </div>
  );
}

function PowerSlider({
  power,
  speed,
  accent,
  onChange,
  label,
}: {
  power: number;
  speed: number;
  accent: string;
  onChange: (power: number) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const applyFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange(clamp01((event.clientX - rect.left) / rect.width));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP.coarsePower : STEP.power;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(clamp01(power + step));
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
      onChange(clamp01(power - step));
    else if (event.key === 'Home') onChange(0);
    else if (event.key === 'End') onChange(1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="aim-hud__power"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
      aria-valuetext={`${speed.toFixed(1)} m/s`}
      data-testid={TESTID.billiards.aimHudPower}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        applyFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) applyFromPointer(event);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        className="aim-hud__power-fill"
        style={{ width: `${power * 100}%`, background: accent }}
      />
      <div
        className="aim-hud__power-thumb"
        style={{ left: `${power * 100}%`, borderColor: accent }}
      />
    </div>
  );
}

/** The HUD panel — this scheme's real control surface. */
export function ScreenHudAimOverlay({ shot, onShotChange }: AimSchemeProps) {
  const { t } = useI18n();
  const power = speedToPower(shot.speed);
  const accent = powerColor(power);

  return (
    <HudPanel anchor="bottom-left" testId={TESTID.billiards.aimHud} className="aim-hud">
      <DirectionDial
        directionDeg={shot.directionDeg}
        label={t('billiards.aimHud.direction')}
        onChange={(directionDeg) => onShotChange({ ...shot, directionDeg })}
      />
      <div className="aim-hud__stack">
        <PowerSlider
          power={power}
          speed={shot.speed}
          accent={accent}
          label={t('billiards.aimHud.power')}
          onChange={(next) => onShotChange({ ...shot, speed: powerToSpeed(next) })}
        />
        <p className="aim-hud__readout">
          <strong>{shot.speed.toFixed(1)}</strong> m/s · {shot.directionDeg.toFixed(0)}°
        </p>
      </div>
    </HudPanel>
  );
}

/** Sightline on the cloth — feedback only, nothing to grab. */
export function ScreenHudAimScene({ cue, shot, ballRadius }: AimSchemeProps) {
  const power = speedToPower(shot.speed);
  const rad = (shot.directionDeg * Math.PI) / 180;
  const reach = 0.16 + power * 0.5;
  return (
    <group position={[cue.position.x, 0.003, -cue.position.y]}>
      <Line
        points={[
          [Math.cos(rad) * ballRadius, 0, -Math.sin(rad) * ballRadius],
          [Math.cos(rad) * reach, 0, -Math.sin(rad) * reach],
        ]}
        color={powerColor(power)}
        lineWidth={3}
        transparent
        opacity={0.9}
      />
    </group>
  );
}
