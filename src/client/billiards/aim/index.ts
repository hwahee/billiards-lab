/**
 * The aim-scheme registry.
 *
 * Every way of setting direction and power is one entry here, all sharing
 * the AimScheme contract, so switching the entire aiming experience is a
 * single setting (./use-aim-scheme) and adding a new one is a single entry.
 */
import { CuePullAim } from './schemes/cue-pull';
import { DialPanelAim } from './schemes/dial-panel';
import { OrbitKnobAim } from './schemes/orbit-knob';
import { ScreenHudAimOverlay, ScreenHudAimScene } from './schemes/screen-hud';
import { SplitControlsAim } from './schemes/split-controls';
import type { AimScheme } from './scheme';

export { activeAimCue, type AimScheme } from './scheme';

export type AimSchemeId =
  'split-controls' | 'orbit-knob' | 'cue-pull' | 'dial-panel' | 'screen-hud';

export const AIM_SCHEMES: Record<AimSchemeId, AimScheme> = {
  'split-controls': {
    labelKey: 'billiards.aimScheme.splitControls',
    hintKey: 'billiards.aimScheme.splitControls.hint',
    Scene: SplitControlsAim,
  },
  'orbit-knob': {
    labelKey: 'billiards.aimScheme.orbitKnob',
    hintKey: 'billiards.aimScheme.orbitKnob.hint',
    Scene: OrbitKnobAim,
  },
  'cue-pull': {
    labelKey: 'billiards.aimScheme.cuePull',
    hintKey: 'billiards.aimScheme.cuePull.hint',
    Scene: CuePullAim,
  },
  'dial-panel': {
    labelKey: 'billiards.aimScheme.dialPanel',
    hintKey: 'billiards.aimScheme.dialPanel.hint',
    Scene: DialPanelAim,
  },
  'screen-hud': {
    labelKey: 'billiards.aimScheme.screenHud',
    hintKey: 'billiards.aimScheme.screenHud.hint',
    Scene: ScreenHudAimScene,
    Overlay: ScreenHudAimOverlay,
  },
};

export const AIM_SCHEME_IDS = Object.keys(AIM_SCHEMES) as AimSchemeId[];

/**
 * The scheme a first-time visitor gets. Separate controls, because a shot
 * you can correct one variable at a time is the easiest to land.
 */
export const DEFAULT_AIM_SCHEME: AimSchemeId = 'split-controls';

export function isAimSchemeId(value: unknown): value is AimSchemeId {
  return typeof value === 'string' && value in AIM_SCHEMES;
}
