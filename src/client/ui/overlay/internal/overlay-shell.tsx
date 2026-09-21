/**
 * The shell every overlay shares. Modal / BottomSheet / Sidebar differ only in
 * presentation, so all of the hard parts live here exactly once.
 *
 * Built on `<dialog>.showModal()`, which hands us the parts of the contract
 * the platform already maintains as a LIFO stack: the top layer (no z-index,
 * no clipping by `overflow`/`transform` ancestors), `inert` on everything
 * behind, focus containment, ESC ordering, and focus restore to whatever
 * opened it. What the platform does NOT get right for a *stack* of overlays is
 * the scrim — `::backdrop` exists per top-layer element, so two open dialogs
 * paint two of them — and that is what ../overlay-stack.ts decides instead.
 *
 * Closing is a transaction, not an event: the element has to outlive `open`
 * going false so its exit transition can play. Two things keep the panel from
 * sliding away empty while that happens — CSS holds the element in the top
 * layer (`overlay`/`display` with `allow-discrete`), and `onClosed` gives the
 * caller a place to reset state that is *after* the animation rather than at
 * the start of it.
 *
 * This component holds no state of its own. Everything it does is a DOM
 * effect or a callback, which is what keeps a close from cascading renders
 * through the tree that opened it.
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, PointerEvent, ReactNode, RefObject, SyntheticEvent } from 'react';

import { APP_VERSION } from '@shared/api/version';

import { useI18n } from '../../../i18n/locale-context';
import { useOverlayStack } from './stack-context';

export interface OverlayLifecycle {
  /** Open state (controlled). */
  open: boolean;
  /**
   * Close REQUEST, not a command. The overlay never closes itself — the caller
   * lowers `open` — which is what makes "discard your changes?" possible
   * without a separate veto API.
   */
  onClose: () => void;
  /**
   * Fires once the exit transition has finished and nothing is on screen.
   * Reset the state the overlay was showing HERE, not in `onClose`: state
   * cleared at the start of the animation leaves an empty panel to slide away.
   */
  onClosed?: () => void;
}

/** Props shared by all three overlays. Variant props are added on top. */
export interface OverlayCommonProps extends OverlayLifecycle {
  /** Accessible name — required, the same contract as TextField/Select/Palette. */
  title: string;
  /** Visually hides the title (it stays available to assistive tech). */
  hideTitle?: boolean;
  /** ESC and backdrop click. Turn it off while there is unsaved input. Default true. */
  dismissable?: boolean;
  /**
   * Focused on open. Defaults to the panel itself rather than the first
   * focusable element, so a screen reader starts at the title instead of
   * announcing "close".
   */
  initialFocus?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  /**
   * Required: every interactive element must be automatable (docs/ui-automation.md).
   * Derives `{testId}.panel`, `{testId}.title` and `{testId}.close`.
   */
  testId: string;
  children: ReactNode;
}

interface OverlayShellProps extends OverlayCommonProps {
  variant: 'modal' | 'sheet' | 'sidebar';
  role?: 'dialog' | 'alertdialog';
  /** Variant-specific `data-*` hooks for CSS (size, tone, side, …). */
  data?: Record<string, string | undefined>;
}

/** Frames of slack after the transition should have finished. */
const SETTLE_SLACK_MS = 40;

/**
 * Longest transition declared on the element, in ms. Read from computed style
 * so the motion policy stays in CSS: the office skin (0s tokens) and
 * prefers-reduced-motion both come back as 0 and the overlay settles
 * instantly, with no empty frame in between.
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
 * Development-only sweep of the panel's contents. The shell contract is closed
 * by types; what a caller renders *inside* the panel is not, and these are the
 * two ways that goes wrong — an untestable control, or content painting a
 * layer of its own instead of letting the top layer do it.
 */
function warnOnContentContractBreaches(panel: HTMLElement, testId: string): void {
  const untestable = panel.querySelectorAll(
    'button:not([data-testid]), a[href]:not([data-testid]), input:not([data-testid]), select:not([data-testid])',
  );
  if (untestable.length > 0) {
    console.warn(
      `[overlay:${testId}] ${untestable.length} control(s) without a data-testid — see docs/ui-automation.md.`,
      untestable,
    );
  }

  for (const element of panel.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    if (style.position === 'fixed' || style.zIndex !== 'auto') {
      console.warn(
        `[overlay:${testId}] overlay content paints its own layer (position/z-index). ` +
          `Layering belongs to the top layer — see docs/overlay-design.md.`,
        element,
      );
      break;
    }
  }
}

export function OverlayShell({
  open,
  onClose,
  onClosed,
  title,
  hideTitle = false,
  dismissable = true,
  initialFocus,
  footer,
  testId,
  children,
  variant,
  role = 'dialog',
  data,
}: OverlayShellProps) {
  const { t } = useI18n();
  const { scrimOwner, enter, leave, settle } = useOverlayStack();
  const id = useId();
  const titleId = `${id}-title`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Read from the settle callback, which may run long after this render. */
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  /*
   * Deliberately idempotent rather than guarded by a "did `open` change?" ref:
   * StrictMode mounts, tears down and re-runs effects, and a ref guard would
   * make the second run a no-op while the teardown had already given the
   * stack entry back — leaving an open overlay that owns no scrim and no
   * scroll lock. The DOM (`dialog.open`) is the state to compare against.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (settleTimer.current !== null) {
      // Re-opening mid-close must cancel the pending `onClosed`, or the old
      // close would reset the state of the overlay that is now open again.
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        (initialFocus?.current ?? panelRef.current)?.focus();
        if (APP_VERSION === 'dev' && panelRef.current) {
          warnOnContentContractBreaches(panelRef.current, testId);
        }
      }
      enter(id);
      return;
    }

    if (!dialog.open) return;
    leave(id);
    // Safe to call immediately: `overlay` and `display` transition with
    // `allow-discrete`, so the element stays in the top layer until the exit
    // transition ends. Without those two the panel would vanish on this line.
    dialog.close();

    const finish = () => {
      settleTimer.current = null;
      settle(id);
      onClosedRef.current?.();
    };
    const settleMs = transitionSettleMs(dialog);
    if (settleMs === 0) finish();
    else settleTimer.current = setTimeout(finish, settleMs + SETTLE_SLACK_MS);
  }, [open, id, enter, leave, settle, initialFocus, testId]);

  /* Unmounting mid-close must not strand the scroll lock on the document. */
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      settle(id);
    },
    [id, settle],
  );

  /*
   * The platform would close the dialog itself on ESC. This component is
   * controlled, so it must not: the request goes to the caller, who lowers
   * `open`. That is also where `dismissable` is honoured.
   */
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dismissable) onClose();
  };

  /*
   * A click that STARTED inside the panel and ended on the backdrop is a drag
   * (selecting text, dragging a slider), not a dismissal.
   */
  const pressedBackdrop = useRef(false);
  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = event.target === event.currentTarget;
  };
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget || !pressedBackdrop.current) return;
    pressedBackdrop.current = false;
    if (dismissable) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      className="overlay"
      data-variant={variant}
      // Exactly one scrim, and it belongs to the top of the stack. Every other
      // open overlay renders a transparent backdrop, so depth never darkens.
      data-overlay-top={scrimOwner === id ? 'true' : undefined}
      data-testid={testId}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      {...data}
    >
      <div ref={panelRef} className="overlay__panel" tabIndex={-1} data-testid={`${testId}.panel`}>
        <div className="overlay__header">
          <h2
            className={hideTitle ? 'visually-hidden' : 'overlay__title'}
            id={titleId}
            data-testid={`${testId}.title`}
          >
            {title}
          </h2>
          <button
            type="button"
            className="overlay__close"
            aria-label={t('common.close')}
            data-testid={`${testId}.close`}
            onClick={onClose}
          >
            <X aria-hidden size="1.25em" />
          </button>
        </div>

        <div className="overlay__body">{children}</div>

        {footer && <div className="overlay__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
