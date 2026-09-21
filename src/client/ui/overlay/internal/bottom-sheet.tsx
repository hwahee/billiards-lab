import { OverlayShell, type OverlayCommonProps } from './overlay-shell';

export interface BottomSheetProps extends OverlayCommonProps {
  /**
   * `content` hugs its content, `full` takes the tall snap. A single value
   * rather than a list: dragging *between* snap points is out of scope
   * (docs/overlay-design.md §13), and an array would promise it.
   */
  snapPoint?: 'content' | 'full';
}

/**
 * Sheet anchored to the bottom edge — the phone-shaped presentation of a modal.
 *
 * Height uses `dvh`, not `vh`: mobile browser chrome collapses and expands as
 * the page scrolls, and `vh` is frozen at the tallest state, so a `vh` sheet
 * is cut off exactly when the keyboard or the URL bar is in the way.
 *
 * There is deliberately no drag-to-dismiss yet. When it lands it has to arrive
 * WITH its keyboard equivalent — a gesture must never be the only way out.
 */
export function BottomSheet({ snapPoint = 'content', ...rest }: BottomSheetProps) {
  return <OverlayShell {...rest} variant="sheet" data={{ 'data-snap': snapPoint }} />;
}
