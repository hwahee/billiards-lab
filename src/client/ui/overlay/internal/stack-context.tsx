/**
 * The overlay stack as React state, plus the two global effects derived from
 * it. Every open overlay — whichever door opened it — registers here, which is
 * what makes a declarative modal and an imperative confirm on top of it
 * behave as one stack.
 *
 * The rules themselves live in ../overlay-stack.ts (pure, unit-tested). This
 * file only holds the state and applies the results.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { APP_VERSION } from '@shared/api/version';

import {
  beginClose,
  derive,
  NESTING_WARN_DEPTH,
  open as pushOverlay,
  remove,
  type OverlayStackEntry,
} from '../overlay-stack';

interface OverlayStackValue {
  /** Id of the one overlay allowed to paint a scrim. */
  scrimOwner: string | null;
  /** Enter the stack (or return to its top after a cancelled close). */
  enter: (id: string) => void;
  /** Start closing: gives up the scrim, keeps the scroll lock. */
  leave: (id: string) => void;
  /** Exit transition finished — release everything. */
  settle: (id: string) => void;
}

const OverlayStackContext = createContext<OverlayStackValue | null>(null);

export function useOverlayStack(): OverlayStackValue {
  const value = useContext(OverlayStackContext);
  if (!value) {
    throw new Error(
      'Overlays need <OverlayProvider> above them. Mount it inside the app providers — see docs/overlay-design.md.',
    );
  }
  return value;
}

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly OverlayStackEntry[]>([]);
  const { scrimOwner, scrollLocked, depth } = derive(stack);

  const enter = useCallback((id: string) => setStack((current) => pushOverlay(current, id)), []);
  const leave = useCallback((id: string) => setStack((current) => beginClose(current, id)), []);
  const settle = useCallback((id: string) => setStack((current) => remove(current, id)), []);

  /*
   * Counted, not boolean: the lock is a function of the whole stack, so the
   * inner overlay closing cannot release it while the outer one is still up.
   * Restoring the previous value rather than clearing the property keeps this
   * honest if anything else ever sets it.
   */
  useEffect(() => {
    if (!scrollLocked) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [scrollLocked]);

  useEffect(() => {
    if (APP_VERSION !== 'dev' || depth <= NESTING_WARN_DEPTH) return;
    console.warn(
      `[overlay] ${depth} overlays are stacked. Nesting is allowed (a confirm over a form ` +
        `modal is legitimate) but this deep usually means a flow that should be one overlay.`,
    );
  }, [depth]);

  const value = useMemo<OverlayStackValue>(
    () => ({ scrimOwner, enter, leave, settle }),
    [scrimOwner, enter, leave, settle],
  );

  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>;
}
