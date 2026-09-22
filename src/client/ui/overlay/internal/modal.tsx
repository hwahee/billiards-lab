import { OverlayShell, type OverlayCommonProps } from './overlay-shell';

export interface ModalProps extends OverlayCommonProps {
  /** Width bucket. Default `md`. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * `danger` styles the panel for a destructive decision AND promotes the role
   * to `alertdialog`, which makes assistive tech announce the body immediately
   * instead of waiting to be explored.
   */
  tone?: 'default' | 'danger';
}

/**
 * Centred modal dialog.
 *
 * This is the overlay that legitimately nests — a confirm over a form modal is
 * a real flow, not a mistake — so nesting is allowed and the stack keeps it
 * coherent (one scrim, LIFO dismissal). Depth past NESTING_WARN_DEPTH warns in
 * development.
 */
export function Modal({ size = 'md', tone = 'default', ...rest }: ModalProps) {
  return (
    <OverlayShell
      {...rest}
      variant="modal"
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      data={{ 'data-size': size, 'data-tone': tone }}
    />
  );
}
