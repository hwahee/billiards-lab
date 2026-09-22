import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ToggleEvent } from 'react';

import { contrastRatio, hexColor, parseHexColor, type HexColor } from '@shared/color';

import { useI18n } from '../i18n/locale-context';
import { placePopover, type Rect } from './popover-position';
import { TextField } from './text-field';

export interface PaletteSwatch {
  value: HexColor;
  /**
   * Accessible name — required, not optional. Reading `#5b5bd6` aloud is not
   * information, and a swatch grid conveys everything else through color
   * alone. The type system is what stops an unnamed swatch existing at all,
   * the same way `testId` stops an unautomatable control existing.
   */
  name: string;
}

/** @public part of the component contract — how callers type their own presets. */
export interface PaletteGroup {
  /** Shown above the grid, and used as the group's accessible name. */
  label?: string;
  swatches: readonly PaletteSwatch[];
}

interface PaletteProps {
  /** Always rendered as a real label — required (same contract as TextField/Select). */
  label: string;
  /** Current color (controlled). */
  value: HexColor;
  /** Committed changes only. Live values during a drag arrive via `onPreview`. */
  onChange: (value: HexColor) => void;
  /** Preset groups. Defaults to a general-purpose 32-color set. */
  presets?: readonly PaletteGroup[];
  /** Recently used colors, appended as their own group. Persisting them is the caller's job. */
  recent?: readonly PaletteSwatch[];
  /** Shows the hex field and the system picker. Default true. */
  allowCustom?: boolean;
  /** Live value while the system picker is being dragged. Subscribe only if you need it. */
  onPreview?: (value: HexColor) => void;
  /** Warn when the value fails WCAG AA against this background. */
  contrastAgainst?: HexColor;
  /** Required: every interactive element must be automatable (docs/ui-automation.md). */
  testId: string;
  disabled?: boolean;
  /** Visually hides the label (it stays available to assistive tech). */
  hideLabel?: boolean;
}

/** Kept in sync with the CSS grid through the `--palette-columns` custom property. */
const SWATCH_COLUMNS = 8;
const TOOLTIP_GAP = 6;
/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

const LIGHT_INK = hexColor('#ffffff');
const DARK_INK = hexColor('#000000');

/**
 * Default presets: neutrals, warm, cool, soft — four rows of `SWATCH_COLUMNS`.
 * Names are English on purpose: they are content, not chrome, so an app that
 * needs them localized passes its own `presets` rather than having the design
 * system guess. Values are fixed across skins — a color the user picked is
 * their data, and data must not change when the UI theme does.
 */
const DEFAULT_SWATCHES: readonly PaletteSwatch[] = (
  [
    ['#ffffff', 'White'],
    ['#e5e7eb', 'Light gray'],
    ['#9ca3af', 'Gray'],
    ['#64748b', 'Slate'],
    ['#475569', 'Dark slate'],
    ['#334155', 'Charcoal'],
    ['#1f2937', 'Ink'],
    ['#000000', 'Black'],
    ['#f43f5e', 'Rose'],
    ['#ef4444', 'Red'],
    ['#f97316', 'Orange'],
    ['#f59e0b', 'Amber'],
    ['#eab308', 'Yellow'],
    ['#84cc16', 'Lime'],
    ['#65a30d', 'Olive'],
    ['#92400e', 'Brown'],
    ['#22c55e', 'Green'],
    ['#10b981', 'Emerald'],
    ['#14b8a6', 'Teal'],
    ['#06b6d4', 'Cyan'],
    ['#0ea5e9', 'Sky'],
    ['#3b82f6', 'Blue'],
    ['#6366f1', 'Indigo'],
    ['#8b5cf6', 'Violet'],
    ['#a855f7', 'Purple'],
    ['#d946ef', 'Fuchsia'],
    ['#ec4899', 'Pink'],
    ['#fb7185', 'Salmon'],
    ['#fdba74', 'Peach'],
    ['#6ee7b7', 'Mint'],
    ['#c4b5fd', 'Lavender'],
    ['#e7d8b1', 'Sand'],
  ] as const
).map(([value, name]) => ({ value: hexColor(value), name }));

const DEFAULT_GROUPS: readonly PaletteGroup[] = [{ swatches: DEFAULT_SWATCHES }];

interface TooltipTarget {
  swatch: PaletteSwatch;
  anchor: Rect;
}

function rectOf(element: HTMLElement): Rect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Color input — a trigger that opens an anchored palette popup.
 *
 * Layering: the popup is a `popover="auto"` element, so the browser puts it in
 * the top layer and hands us light dismiss, Esc and focus restoration. That is
 * not just convenience — an inline absolutely-positioned popup would be
 * *clipped* by any `overflow: hidden` ancestor, and this design system has
 * several (`.accordion__panel` most obviously). Top layer also means opening
 * the palette shifts no layout at all, which is why this component needs none
 * of the CLS escape hatches the accordion carries.
 *
 * Positioning is ours (`popover-position.ts`) rather than CSS anchor
 * positioning: viewport flipping is required behavior for a dropdown, and
 * `@position-try` support still lags plain `anchor()`.
 *
 * Unlike the other components in `ui/`, this one calls `useI18n` directly.
 * The others are thin wrappers whose every string is a prop; this one owns
 * internal chrome (hex field, recent group, contrast warning), and pushing
 * six required string props onto every call site would be worse than reaching
 * for the facade that `locale-context` already declares as the way UI gets text.
 */
export function Palette({
  label,
  value,
  onChange,
  presets = DEFAULT_GROUPS,
  recent,
  allowCustom = true,
  onPreview,
  contrastAgainst,
  testId,
  disabled,
  hideLabel,
}: PaletteProps) {
  const { t } = useI18n();
  const reactId = useId();
  const popupId = `${reactId}-popup`;
  const labelId = `${reactId}-label`;
  const valueId = `${reactId}-value`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);
  /** `null` means "mirror `value`"; a string means the user is mid-edit. */
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [hexError, setHexError] = useState<string | undefined>(undefined);

  const groups: readonly PaletteGroup[] = recent?.length
    ? [...presets, { label: t('palette.recent'), swatches: recent }]
    : presets;

  // Each group needs its offset into the flattened order, which is what the
  // roving tabindex and the arrow-key math are expressed in.
  const sections = groups.map((group, groupIndex) => ({
    group,
    start: groups
      .slice(0, groupIndex)
      .reduce((total, previous) => total + previous.swatches.length, 0),
  }));
  const flatSwatches = groups.flatMap((group) => group.swatches);
  const selectedIndex = flatSwatches.findIndex((swatch) => swatch.value === value);
  const selectedSwatch = selectedIndex >= 0 ? flatSwatches[selectedIndex] : undefined;

  const contrast = contrastAgainst ? contrastRatio(value, contrastAgainst) : null;

  // Position before the browser paints, so the popup never flashes at the UA
  // default (viewport-centered) position on the way to its anchor.
  useLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;

    let frame = 0;
    const reposition = () => {
      frame = 0;
      popup.style.maxHeight = ''; // measure the natural height, not last open's cap
      const placement = placePopover(
        rectOf(trigger),
        { width: popup.offsetWidth, height: popup.offsetHeight },
        viewportSize(),
      );
      popup.style.top = `${placement.top}px`;
      popup.style.left = `${placement.left}px`;
      popup.style.maxHeight = `${placement.maxHeight}px`;
      popup.dataset.side = placement.side;
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(reposition);
    };

    reposition();
    // Capture phase: the trigger may live inside a scroll container, whose
    // scroll events never reach window in the bubble phase.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open]);

  // The tooltip is a single element positioned outside the popup's scroll box:
  // rendered per-swatch it would be clipped by `overflow: auto` at the grid edges.
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!element || !tooltip) return;
    const placement = placePopover(
      tooltip.anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      viewportSize(),
      { align: 'center', preferred: 'top', gap: TOOLTIP_GAP },
    );
    element.style.top = `${placement.top}px`;
    element.style.left = `${placement.left}px`;
  }, [tooltip]);

  // The system picker fires `input` continuously while dragging and `change`
  // once on commit. React's onChange is the former, so the commit needs a real
  // listener — see `onPreview` in the props above.
  useLayoutEffect(() => {
    const input = nativeRef.current;
    if (!input) return;
    // Set here rather than in JSX: `alpha` (the opacity slider) is not in
    // @types/react yet. It must land before the value below is assigned,
    // or the browser sanitizes the 8-digit color away.
    input.setAttribute('alpha', '');
    input.value = value;
    // A browser that has not shipped the `alpha` attribute sanitizes a
    // translucent value to `#000000`, which would show the wrong hue on the
    // picker's own swatch. The palette's value keeps its alpha either way —
    // only this control falls back to the opaque form.
    if (parseHexColor(input.value) !== value) input.value = value.slice(0, 7);

    const commitNative = () => {
      const parsed = parseHexColor(input.value);
      if (parsed) onChange(parsed);
    };
    input.addEventListener('change', commitNative);
    return () => input.removeEventListener('change', commitNative);
  }, [value, onChange, allowCustom]);

  const commit = (next: HexColor) => {
    if (next !== value) onChange(next);
    popupRef.current?.hidePopover();
  };

  const commitHex = () => {
    if (hexDraft === null) return;
    const parsed = parseHexColor(hexDraft);
    if (!parsed) {
      setHexError(t('palette.hexInvalid'));
      return;
    }
    setHexDraft(null);
    setHexError(undefined);
    if (parsed !== value) onChange(parsed);
  };

  const handleToggle = (event: ToggleEvent<HTMLDivElement>) => {
    const opened = event.newState === 'open';
    setOpen(opened);
    setTooltip(null);
    if (!opened) return;
    setHexDraft(null);
    setHexError(undefined);
    // Land on the current color so arrow keys start from something meaningful.
    const index = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(index);
    optionRefs.current.get(index)?.focus();
  };

  const focusOption = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), flatSwatches.length - 1);
    setActiveIndex(clamped);
    optionRefs.current.get(clamped)?.focus();
  };

  /**
   * Focus moves, selection does not follow — arrow keys would otherwise fire
   * `onChange` for every color they pass over. Enter/Space commits, which the
   * native button behavior gives us for free.
   *
   * Vertical movement steps by `SWATCH_COLUMNS` over the flattened order, so
   * it is exact within a group and approximate across a group boundary whose
   * size is not a multiple of the column count.
   */
  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number;
    if (event.key === 'ArrowRight') target = index + 1;
    else if (event.key === 'ArrowLeft') target = index - 1;
    else if (event.key === 'ArrowDown') target = index + SWATCH_COLUMNS;
    else if (event.key === 'ArrowUp') target = index - SWATCH_COLUMNS;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = flatSwatches.length - 1;
    else return;
    event.preventDefault();
    focusOption(target);
  };

  const showTooltip = (swatch: PaletteSwatch, element: HTMLElement) => {
    setTooltip({ swatch, anchor: rectOf(element) });
  };

  return (
    <div className="field palette">
      <span className={hideLabel ? 'visually-hidden' : 'field__label'} id={labelId}>
        {label}
      </span>

      <button
        type="button"
        ref={triggerRef}
        className="palette__trigger"
        popoverTarget={popupId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        disabled={disabled}
        data-testid={testId}
      >
        <span
          className="palette__chip"
          style={{ '--palette-chip-color': value } as CSSProperties}
          aria-hidden
        />
        <span className="palette__trigger-text" id={valueId}>
          {selectedSwatch?.name ?? value}
        </span>
        <ChevronDown className="palette__chevron" aria-hidden size="1.25em" />
      </button>

      <div
        ref={popupRef}
        id={popupId}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="palette__popup"
        data-testid={`${testId}.popup`}
        onToggle={handleToggle}
      >
        <div className="palette__groups" role="listbox" aria-label={label}>
          {sections.map(({ group, start }) => (
            <div
              key={group.label ?? start}
              role="group"
              aria-label={group.label}
              className="palette__grid"
              style={{ '--palette-columns': SWATCH_COLUMNS } as CSSProperties}
            >
              {/* Hidden from the a11y tree so the group owns options only —
                  the label is already the group's accessible name. */}
              {group.label && (
                <span className="palette__group-label" aria-hidden>
                  {group.label}
                </span>
              )}
              {group.swatches.map((swatch, offset) => {
                const index = start + offset;
                const selected = swatch.value === value;
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`${swatch.name} (${swatch.value})`}
                    className="palette__swatch"
                    style={{ '--palette-chip-color': swatch.value } as CSSProperties}
                    // Ink that survives on both a white and a black swatch.
                    data-ink={
                      contrastRatio(LIGHT_INK, swatch.value) >=
                      contrastRatio(DARK_INK, swatch.value)
                        ? 'light'
                        : 'dark'
                    }
                    data-testid={`${testId}.swatch.${swatch.value.slice(1)}`}
                    tabIndex={index === activeIndex ? 0 : -1}
                    ref={(element) => {
                      if (element) optionRefs.current.set(index, element);
                      else optionRefs.current.delete(index);
                    }}
                    onClick={() => commit(swatch.value)}
                    onKeyDown={(event) => onOptionKeyDown(event, index)}
                    onFocus={(event) => showTooltip(swatch, event.currentTarget)}
                    onBlur={() => setTooltip(null)}
                    onPointerEnter={(event) => showTooltip(swatch, event.currentTarget)}
                    onPointerLeave={() => setTooltip(null)}
                  >
                    {selected && <Check className="palette__check" aria-hidden size="1em" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {allowCustom && (
          <div className="palette__custom">
            <TextField
              label={t('palette.hexLabel')}
              value={hexDraft ?? value}
              error={hexError}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                setHexDraft(event.target.value);
                setHexError(undefined);
              }}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitHex();
              }}
              testId={`${testId}.hex`}
            />
            <input
              ref={nativeRef}
              type="color"
              className="palette__native"
              aria-label={t('palette.customColor')}
              data-testid={`${testId}.native`}
              onChange={(event) => {
                const parsed = parseHexColor(event.target.value);
                if (parsed) onPreview?.(parsed);
              }}
              onFocus={(event) =>
                showTooltip({ value, name: t('palette.customColor') }, event.currentTarget)
              }
              onBlur={() => setTooltip(null)}
              onPointerEnter={(event) =>
                showTooltip({ value, name: t('palette.customColor') }, event.currentTarget)
              }
              onPointerLeave={() => setTooltip(null)}
            />
          </div>
        )}

        {contrast !== null && contrast < MIN_CONTRAST && (
          <p className="palette__warning" role="status" data-testid={`${testId}.contrast`}>
            <TriangleAlert aria-hidden size="1em" />
            {t('palette.contrastWarning', {
              // Truncated, not rounded: 4.46 must not read as "4.5:1 — below 4.5".
              ratio: (Math.floor(contrast * 10) / 10).toFixed(1),
              minimum: MIN_CONTRAST.toFixed(1),
            })}
          </p>
        )}

        {/* Decorative: the swatch's own aria-label already carries name and
            value, so announcing the tooltip too would just repeat it. */}
        {tooltip && (
          <span ref={tooltipRef} className="palette__tooltip" aria-hidden>
            <span className="palette__tooltip-name">{tooltip.swatch.name}</span>
            <code className="palette__tooltip-value">{tooltip.swatch.value}</code>
          </span>
        )}
      </div>
    </div>
  );
}
