/**
 * Anchored-popup placement — pure geometry, no DOM.
 *
 * CSS anchor positioning is where this ends up eventually, but `@position-try`
 * (the viewport flip) lags the base `anchor()` support, and flipping is
 * required behavior for a dropdown rather than a nicety. So v1 keeps one JS
 * code path instead of two, and confines it to this file: the day the CSS
 * lands, this module is what gets deleted.
 *
 * Coordinates are viewport-relative, which is exactly what a `position: fixed`
 * element in the top layer wants — no scroll offsets enter the math.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlacementOptions {
  /** Which side of the anchor to try first. Defaults to `bottom`. */
  preferred?: 'top' | 'bottom';
  /** `start` lines the popup up with the anchor's left edge; `center` centers it. */
  align?: 'start' | 'center';
  /** Space between the anchor and the popup. */
  gap?: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The side actually used — may differ from `preferred` after a flip. */
  side: 'top' | 'bottom';
  /** Room available on `side`; apply as `max-height` so tall content can scroll. */
  maxHeight: number;
}

/** Keeps the popup off the very edge of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Never squeeze a flipped popup below this, even in a very short viewport. */
const MIN_HEIGHT = 96;
const DEFAULT_GAP = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function placePopover(
  anchor: Rect,
  popup: Size,
  viewport: Size,
  options: PlacementOptions = {},
): Placement {
  const { preferred = 'bottom', align = 'start', gap = DEFAULT_GAP } = options;

  const roomBelow = viewport.height - (anchor.top + anchor.height) - gap - VIEWPORT_MARGIN;
  const roomAbove = anchor.top - gap - VIEWPORT_MARGIN;
  const room = { top: roomAbove, bottom: roomBelow };

  // Stay on the preferred side while it fits; otherwise flip, but only if the
  // other side is genuinely roomier — flipping into an even tighter space just
  // moves the problem.
  const other = preferred === 'bottom' ? 'top' : 'bottom';
  const side =
    popup.height <= room[preferred] || room[preferred] >= room[other] ? preferred : other;

  const maxHeight = Math.max(MIN_HEIGHT, room[side]);
  const height = Math.min(popup.height, maxHeight);
  const top = side === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - height;

  const desiredLeft =
    align === 'center' ? anchor.left + anchor.width / 2 - popup.width / 2 : anchor.left;
  // A popup wider than the viewport can only be pinned to the left margin;
  // clamping with an inverted range would otherwise push it off-screen right.
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - popup.width - VIEWPORT_MARGIN);
  const left = clamp(desiredLeft, VIEWPORT_MARGIN, maxLeft);

  return {
    top: Math.round(clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height))),
    left: Math.round(left),
    side,
    maxHeight: Math.round(maxHeight),
  };
}
