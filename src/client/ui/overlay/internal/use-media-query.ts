import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to a media query. Exists for `Sidebar`'s `modality="auto"`, the
 * one overlay decision that cannot be made in CSS: modality selects the scrim,
 * the focus trap and the scroll lock, so it has to be known in JS.
 *
 * `useSyncExternalStore` rather than state-in-an-effect — the match is external
 * state we read, not state we own, so there is no render to cascade.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
