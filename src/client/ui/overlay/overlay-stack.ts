/**
 * Overlay stack — pure rules, no DOM and no React.
 *
 * An overlay is a component that wants to claim resources the viewport only
 * has one of: the scrim, the body scroll lock, the focus trap, the ESC key.
 * If every overlay claims them for itself, two open overlays claim them twice
 * — which is why stacked backdrops darken. So no overlay owns them: the stack
 * holds the open entries and this module *derives* the decisions from it.
 *
 * Those resources are not all the same shape, and mixing them up is exactly
 * how the bugs happen:
 *
 *   - exclusive  (at most one)  — the scrim: the TOP-MOST overlay paints it.
 *     Treating it as cumulative is the stacked-backdrop bug. Note that opacity
 *     does not add linearly either (two 50% layers read as 75%, not 100%), so
 *     the fix is to never overlap, not to lighten each layer.
 *   - counted    (1 or more)    — the body scroll lock: held while ANY entry
 *     is present. Treating it as a boolean is the mirror-image bug, where
 *     closing the inner overlay unlocks scrolling under the outer one.
 *   - hierarchical              — inert / focus containment / ESC order. Those
 *     come free from `<dialog>.showModal()`: the platform maintains the top
 *     layer as a LIFO stack, so this module does not model them.
 *
 * Only MODAL overlays are entries here. An inline sidebar (the docked desktop
 * presentation) is layout, not a popup: it claims nothing, so it never joins.
 */

export interface OverlayStackEntry {
  id: string;
  /**
   * Cleared the moment the overlay starts closing, while its exit transition
   * still plays. A closing entry keeps the scroll lock — releasing it
   * mid-animation would jump the page under the overlay the user is watching
   * — but stops owning the scrim, which has to move down to the overlay
   * underneath as this one fades.
   */
  active: boolean;
}

export interface OverlayStackDerivation {
  /** The single overlay that paints a scrim, or null when none is active. */
  scrimOwner: string | null;
  /** True while any entry is present, closing ones included. */
  scrollLocked: boolean;
  /** Active (not closing) entries — what the depth warning counts. */
  depth: number;
}

/**
 * Nesting is legitimate — a confirm over a form modal is the classic case —
 * so it is not blocked. Past this depth it is usually a design mistake, and
 * the registry warns in development.
 */
export const NESTING_WARN_DEPTH = 3;

/**
 * Adds an overlay on top. Re-opening one that is still closing moves it back
 * to the top rather than leaving a stale entry behind it, which is what makes
 * the close-then-immediately-reopen race resolve to "open" instead of
 * stranding the entry in a closing state forever.
 */
export function open(
  stack: readonly OverlayStackEntry[],
  id: string,
): readonly OverlayStackEntry[] {
  return [...stack.filter((entry) => entry.id !== id), { id, active: true }];
}

/** Marks an overlay as closing. It keeps its slot until `remove`. */
export function beginClose(
  stack: readonly OverlayStackEntry[],
  id: string,
): readonly OverlayStackEntry[] {
  return stack.map((entry) => (entry.id === id ? { ...entry, active: false } : entry));
}

/** Drops an overlay once its exit transition has finished. */
export function remove(
  stack: readonly OverlayStackEntry[],
  id: string,
): readonly OverlayStackEntry[] {
  return stack.filter((entry) => entry.id !== id);
}

export function derive(stack: readonly OverlayStackEntry[]): OverlayStackDerivation {
  let scrimOwner: string | null = null;
  let depth = 0;
  for (const entry of stack) {
    if (!entry.active) continue;
    scrimOwner = entry.id;
    depth += 1;
  }
  return { scrimOwner, scrollLocked: stack.length > 0, depth };
}
