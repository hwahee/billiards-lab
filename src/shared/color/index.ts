/**
 * Color facade — the canonical color format for the whole application.
 *
 * Every color that crosses a boundary (component prop, API payload, database
 * column) is a `HexColor`: lowercase `#rrggbb`, or `#rrggbbaa` when it is
 * translucent. Two properties make that worth enforcing:
 *
 *   1. Colors compare with `===`. Allowing arbitrary CSS colors would mean
 *      `#5b5bd6`, `rgb(91 91 214)` and `oklch(…)` are the same color in three
 *      spellings — and preset highlighting, which is a value comparison,
 *      would silently stop working.
 *   2. Parsing is liberal, storage is strict. `parseHexColor` accepts
 *      shorthand, uppercase, a missing `#` and surrounding whitespace, and
 *      always returns the one canonical spelling (fully opaque colors lose
 *      their `ff` suffix, so `#5b5bd6ff` and `#5b5bd6` never coexist).
 *
 * Everything here is pure: no DOM, no `getComputedStyle`. That is deliberate —
 * it is what lets the rules be unit-tested (`color.test.ts`) and reused by
 * server-side validation instead of being reimplemented there.
 */

/** Branded canonical color: `#rrggbb`, or `#rrggbbaa` when translucent. */
export type HexColor = string & { readonly __brand: 'HexColor' };

const SHORTHAND = /^[0-9a-f]{3,4}$/;
const FULL = /^[0-9a-f]{6}$/;
const FULL_WITH_ALPHA = /^[0-9a-f]{8}$/;

/** Reference background for contrast math when the given background is itself translucent. */
const OPAQUE_REFERENCE = '#ffffff' as HexColor;

/**
 * Normalizes any reasonable hex spelling to the canonical form, or returns
 * `null` when the input is not a hex color at all.
 */
export function parseHexColor(input: string): HexColor | null {
  const raw = input.trim().replace(/^#/, '').toLowerCase();

  let digits: string;
  if (SHORTHAND.test(raw)) {
    digits = [...raw].map((digit) => digit + digit).join('');
  } else if (FULL.test(raw) || FULL_WITH_ALPHA.test(raw)) {
    digits = raw;
  } else {
    return null;
  }

  // Fully opaque is spelled without an alpha pair, so the same color always
  // produces the same string regardless of which notation it arrived in.
  if (digits.length === 8 && digits.endsWith('ff')) digits = digits.slice(0, 6);

  return `#${digits}` as HexColor;
}

/** True when `value` is already in canonical form (and therefore a `HexColor`). */
export function isHexColor(value: string): value is HexColor {
  return parseHexColor(value) === value;
}

/**
 * Asserting constructor for colors known at authoring time (module-level
 * constants, tests, fixtures). Throws rather than returning `null` because a
 * malformed literal is a programming error, not user input.
 */
export function hexColor(literal: string): HexColor {
  const parsed = parseHexColor(literal);
  if (!parsed) throw new Error(`Not a hex color: ${JSON.stringify(literal)}`);
  return parsed;
}

/** `[r, g, b]` as 0–255 plus alpha as 0–1. */
function channels(color: HexColor): [number, number, number, number] {
  const digits = color.slice(1);
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
  ];
}

function toHex(red: number, green: number, blue: number): HexColor {
  const pair = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${pair(red)}${pair(green)}${pair(blue)}` as HexColor;
}

/** Flattens `foreground` onto an assumed-opaque `background` (source-over). */
function compositeOver(foreground: HexColor, background: HexColor): HexColor {
  const [red, green, blue, alpha] = channels(foreground);
  if (alpha === 1) return foreground;
  const [backRed, backGreen, backBlue] = channels(background);
  const mix = (front: number, back: number) => front * alpha + back * (1 - alpha);
  return toHex(mix(red, backRed), mix(green, backGreen), mix(blue, backBlue));
}

/** WCAG 2.x relative luminance. Alpha is ignored — composite before calling. */
function relativeLuminance(color: HexColor): number {
  const [red, green, blue] = channels(color);
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/**
 * WCAG contrast ratio between two colors, from 1 (identical) to 21
 * (black on white). Translucent colors are composited first — a color at 10%
 * alpha genuinely does have almost no contrast against its background, and
 * reporting it as if it were opaque would be a lie.
 */
export function contrastRatio(foreground: HexColor, background: HexColor): number {
  const opaqueBackground = compositeOver(background, OPAQUE_REFERENCE);
  const opaqueForeground = compositeOver(foreground, opaqueBackground);

  const first = relativeLuminance(opaqueForeground);
  const second = relativeLuminance(opaqueBackground);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}
