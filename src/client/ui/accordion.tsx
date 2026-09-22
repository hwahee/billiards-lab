import { ChevronDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface AccordionItem {
  /** Stable identity — also the segment used in the derived testids. */
  id: string;
  title: string;
  content: ReactNode;
}

interface AccordionProps {
  items: readonly AccordionItem[];
  /** `single` (classic accordion) closes the other items when one opens. */
  mode?: 'single' | 'multiple';
  /** Item ids that start open (the component is uncontrolled). */
  defaultOpenIds?: readonly string[];
  /**
   * Required: every interactive element must be automatable (docs/ui-automation.md).
   * Per item this derives `{testId}.trigger.{id}` and `{testId}.panel.{id}`.
   */
  testId: string;
}

interface PendingToggle {
  id: string;
  /** Viewport-relative top of the clicked trigger at click time — the anchor. */
  triggerTop: number;
  opened: boolean;
}

/** Frames of extra scroll compensation after the CSS transition should be done. */
const SETTLE_SLACK_MS = 80;
/** Gap kept between the viewport top and the trigger when revealing a panel. */
const REVEAL_TOP_MARGIN_PX = 12;

/**
 * Longest transition (duration + delay) declared on the element, in ms.
 * Reading it from computed style keeps the motion policy in CSS: the office
 * skin (0s tokens) and prefers-reduced-motion both come back as 0 here, and
 * the component degrades to instant-but-compensated toggling automatically.
 */
function transitionSettleMs(element: Element): number {
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(',').map(parseFloat);
  const delays = style.transitionDelay.split(',').map(parseFloat);
  const settle = Math.max(
    ...durations.map((duration, index) => duration + (delays[index % delays.length] ?? 0)),
  );
  return Number.isFinite(settle) ? settle * 1000 : 0;
}

/**
 * WAI-ARIA accordion — button-in-heading triggers, labelled `region` panels,
 * ArrowUp/ArrowDown/Home/End roving between headers.
 *
 * Expanding or collapsing inline content shifts everything below it; that
 * layout shift cannot be avoided, so the component ships three UX escape
 * hatches instead of pretending it away:
 *
 *   0. The shift is ANIMATED (grid-rows 0fr→1fr on `--duration-expand`) so the
 *      eye can track where content went instead of losing its place. Skins
 *      keep authority over this: office sets the token to 0s, and
 *      prefers-reduced-motion zeroes the transition — both degrade to an
 *      instant toggle without touching this file.
 *   1. The clicked trigger is ANCHORED: while layout settles, scroll is
 *      compensated frame-by-frame so the row never slides away from the
 *      user's pointer/eyes. This is what saves `single` mode, where opening an
 *      item also collapses a possibly-taller item above it.
 *   2. The opened panel is REVEALED: if it ends up cut off by the bottom of
 *      the viewport, the page scrolls just enough to show it — but never so
 *      far that the trigger itself leaves the viewport.
 */
export function Accordion({ items, mode = 'single', defaultOpenIds, testId }: AccordionProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(defaultOpenIds ?? []));
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingRef = useRef<PendingToggle | null>(null);
  /** Bumped per toggle so a newer toggle cancels the previous anchor loop. */
  const anchorGeneration = useRef(0);

  const toggle = (id: string) => {
    const trigger = triggerRefs.current.get(id);
    const opened = !openIds.has(id);
    if (trigger) {
      pendingRef.current = { id, triggerTop: trigger.getBoundingClientRect().top, opened };
    }
    if (mode === 'single') {
      setOpenIds(opened ? new Set([id]) : new Set());
    } else {
      const next = new Set(openIds);
      if (opened) {
        next.add(id);
      } else {
        next.delete(id);
      }
      setOpenIds(next);
    }
  };

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const trigger = triggerRefs.current.get(pending.id);
    const panel = panelRefs.current.get(pending.id);
    if (!trigger || !panel) return;

    const generation = ++anchorGeneration.current;
    const settleMs = transitionSettleMs(panel);

    // Escape hatch #1 — hold the clicked trigger at its pre-toggle viewport
    // position. Measuring the actual delta (rather than predicting it) makes
    // the correction self-converging even if the browser's own scroll
    // anchoring also adjusts.
    const holdAnchor = () => {
      const delta = trigger.getBoundingClientRect().top - pending.triggerTop;
      if (delta !== 0) window.scrollBy(0, delta);
    };

    // Escape hatch #2 — after expanding, nudge the cut-off part of the panel
    // into view. Capped by `headroom` so the trigger always stays visible.
    const reveal = () => {
      if (!pending.opened) return;
      const overflow = panel.getBoundingClientRect().bottom - document.documentElement.clientHeight;
      if (overflow <= 0) return;
      const headroom = Math.max(0, trigger.getBoundingClientRect().top - REVEAL_TOP_MARGIN_PX);
      const distance = Math.min(overflow, headroom);
      if (distance > 0) {
        window.scrollBy({ top: distance, behavior: settleMs === 0 ? 'auto' : 'smooth' });
      }
    };

    // Pre-paint compensation covers the no-motion case (office skin,
    // prefers-reduced-motion) in a single synchronous step.
    holdAnchor();
    if (settleMs === 0) {
      reveal();
      return;
    }

    let startedAt: number | null = null;
    const step = (now: DOMHighResTimeStamp) => {
      if (anchorGeneration.current !== generation) return; // superseded by a newer toggle
      startedAt ??= now;
      holdAnchor();
      if (now - startedAt < settleMs + SETTLE_SLACK_MS) {
        requestAnimationFrame(step);
      } else {
        reveal();
      }
    };
    requestAnimationFrame(step);
  }, [openIds]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number;
    if (event.key === 'ArrowDown') target = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') target = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else return;
    event.preventDefault();
    const item = items[target];
    if (item) triggerRefs.current.get(item.id)?.focus();
  };

  return (
    <div className="accordion" data-testid={testId}>
      {items.map((item, index) => {
        const open = openIds.has(item.id);
        const triggerId = `${testId}-trigger-${item.id}`;
        const panelId = `${testId}-panel-${item.id}`;
        return (
          <div key={item.id} className="accordion__item" data-open={open || undefined}>
            <h3 className="accordion__header">
              <button
                id={triggerId}
                type="button"
                className="accordion__trigger"
                aria-expanded={open}
                aria-controls={panelId}
                data-testid={`${testId}.trigger.${item.id}`}
                ref={(el) => {
                  if (el) triggerRefs.current.set(item.id, el);
                  else triggerRefs.current.delete(item.id);
                }}
                onClick={() => toggle(item.id)}
                onKeyDown={(event) => onTriggerKeyDown(event, index)}
              >
                <span className="accordion__title">{item.title}</span>
                <ChevronDown className="accordion__chevron" aria-hidden size="1.25em" />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              className="accordion__panel"
              data-testid={`${testId}.panel.${item.id}`}
              ref={(el) => {
                if (el) panelRefs.current.set(item.id, el);
                else panelRefs.current.delete(item.id);
              }}
            >
              {/* Collapsed content is also hidden from AT/focus via the
                  delayed `visibility` transition in main.css. */}
              <div className="accordion__panel-inner">
                <div className="accordion__content">{item.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
