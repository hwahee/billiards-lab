/**
 * The declarative door — opt-in, guarded by ESLint.
 *
 * Overlays default to `useOverlay()`. These components exist for the three
 * cases the registry structurally cannot serve:
 *
 *   1. the body needs a context from the SUBTREE it is called in (a
 *      FormProvider, a local error boundary) — the registry renders at a fixed
 *      point in the tree and sees only the contexts above it;
 *   2. the body must keep re-rendering from live state, where the registry's
 *      captured closure would go stale;
 *   3. the overlay is always-visible layout (an inline Sidebar), which is not
 *      a popup at all.
 *
 * Importing this module fails lint until you disable the rule on the import
 * line and say which of the three applies. See docs/overlay-design.md §5.1.
 */
export { Modal } from './internal/modal';
export { BottomSheet } from './internal/bottom-sheet';
export { Sidebar } from './internal/sidebar';
