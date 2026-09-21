/**
 * Overlays — Modal / BottomSheet / Sidebar.
 *
 * The public surface is `useOverlay()`; the components themselves live behind
 * ./declarative (opt-in, guarded by ESLint) and their internals behind
 * ./internal (closed). See docs/overlay-design.md for why the stack owns the
 * scrim, the scroll lock and the close transaction rather than each component
 * doing so for itself.
 */
export { OverlayProvider, useOverlay } from './registry';
