/**
 * What an aim scheme is.
 *
 * Setting a shot's direction and power is a UI question with several
 * reasonable answers, so it is pluggable: each answer is a scheme
 * implementing this one contract, and the live one is a single setting
 * (see ./use-aim-scheme).
 *
 * A scheme may render into the 3D scene, into the screen-space HUD, or
 * both — so *where the control lives* is the scheme's own choice, and
 * swapping an in-world widget for a HUD is the same act as swapping two
 * in-world widgets.
 */
import type { ComponentType } from 'react';

import type { MessageKey } from '@shared/i18n';
import type { BallState } from '@shared/billiards/physics';

import { PRESETS, type ShotSettings } from '../config';
import type { BilliardsSim } from '../use-billiards';

export interface AimSchemeProps {
  /** The cue ball, at rest, in table coordinates. */
  cue: BallState;
  shot: ShotSettings;
  onShotChange: (shot: ShotSettings) => void;
  ballRadius: number;
}

export interface AimScheme {
  labelKey: MessageKey;
  /** One line telling the player what the gesture is. */
  hintKey: MessageKey;
  /** Rendered inside the R3F canvas (three.js elements only). */
  Scene?: ComponentType<AimSchemeProps>;
  /** Rendered as DOM, over the canvas, inside the HUD layer. */
  Overlay?: ComponentType<AimSchemeProps>;
}

/**
 * The ball a scheme should be aiming, or null when no shot can be taken —
 * mid-shot, cue ball in the tray, or someone else's turn. Both mount points
 * gate on this, so no scheme has to know the rules.
 */
export function activeAimCue(sim: BilliardsSim): BallState | null {
  if (sim.phase !== 'idle') return null;
  if (sim.matchActive && !sim.isMyTurn) return null;
  const cue = sim.snapshot.find((ball) => ball.id === PRESETS[sim.variant].cueBallId);
  return cue && !cue.potted ? cue : null;
}
