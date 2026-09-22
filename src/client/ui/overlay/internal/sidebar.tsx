import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import { useI18n } from '../../../i18n/locale-context';
import { OverlayShell, type OverlayCommonProps } from './overlay-shell';
import { useMediaQuery } from './use-media-query';

export interface SidebarProps extends OverlayCommonProps {
  /** Which edge it is anchored to. `start`/`end` follow the writing direction. */
  side?: 'start' | 'end';
  /**
   * `modal` dims and traps; `inline` is docked layout that claims nothing.
   * `auto` (default) picks `inline` on desktop and `modal` on narrow screens,
   * so the caller never branches on a breakpoint — if modality leaked to the
   * call site, so would the scrim, the focus trap and the scroll lock.
   */
  modality?: 'auto' | 'modal' | 'inline';
}

/** Below this the sidebar has to cover the page; above it, it can sit beside it. */
const INLINE_FROM = '(min-width: 768px)';

/**
 * Edge-anchored panel — the only overlay whose modality changes with the
 * viewport.
 *
 * An inline sidebar is not a popup, it is layout: no dialog, no top layer, no
 * scrim, no focus trap, and it never joins the stack. That is also why it is
 * the clearest legitimate use of the declarative door — pushing layout through
 * an imperative `open()` call would be strange.
 */
export function Sidebar({ side = 'start', modality = 'auto', ...rest }: SidebarProps) {
  const wide = useMediaQuery(INLINE_FROM);
  const inline = modality === 'inline' || (modality === 'auto' && wide);

  if (!inline) {
    return <OverlayShell {...rest} variant="sidebar" data={{ 'data-side': side }} />;
  }
  return <InlineSidebar {...rest} side={side} />;
}

/**
 * Docked presentation. Shown and hidden without a transition on purpose: this
 * is a region of the page appearing, not something flying in over it, so there
 * is no exit animation to outlive and `onClosed` can follow `onClose` directly.
 */
function InlineSidebar({
  open,
  onClose,
  onClosed,
  title,
  hideTitle = false,
  footer,
  testId,
  children,
  side,
}: Omit<SidebarProps, 'side' | 'modality'> & { side: 'start' | 'end' }) {
  const { t } = useI18n();
  const id = useId();
  const titleId = `${id}-title`;

  const wasOpen = useRef(open);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open) onClosedRef.current?.();
  }, [open]);

  if (!open) return null;

  return (
    <aside
      className="overlay overlay--inline"
      data-variant="sidebar"
      data-side={side}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="overlay__panel" data-testid={`${testId}.panel`}>
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

        <div className="overlay__body scroll-box">{children}</div>

        {footer && <div className="overlay__footer">{footer}</div>}
      </div>
    </aside>
  );
}
