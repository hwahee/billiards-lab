/**
 * The imperative door — the default way to open an overlay.
 *
 * The registry renders the shell itself and the caller passes only the body,
 * which is what makes the contract unskippable: `title` and `testId` are
 * required arguments of the call, not props of a component the caller might
 * have chosen not to use. There is no way to ask for an overlay without them.
 *
 * The request types are DERIVED from the declarative props (`ModalProps` &
 * co), so the two doors cannot drift: adding a prop to `Modal` adds it here.
 *
 * Opening returns a promise because the value it carries — the user's decision
 * — simply arrives later. It never rejects: dismissing is an ordinary outcome,
 * not an error, so callers get `undefined` instead of a `try`/`catch`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { BottomSheet, type BottomSheetProps } from './internal/bottom-sheet';
import { Modal, type ModalProps } from './internal/modal';
import type { OverlayLifecycle } from './internal/overlay-shell';
import { Sidebar, type SidebarProps } from './internal/sidebar';
import { OverlayStackProvider } from './internal/stack-context';

interface OverlayApi<R> {
  /** Dismiss with no answer — the promise resolves to `undefined`. */
  close: () => void;
  /** Answer and dismiss. */
  resolve: (value: R) => void;
}

/** Props the registry owns; a caller never passes these. */
type ShellOwned = keyof OverlayLifecycle | 'children';

type OverlayRequest<P, R> = Omit<P, ShellOwned | 'footer'> & {
  render: (api: OverlayApi<R>) => ReactNode;
  /**
   * Footer actions. A render function, not a node: the buttons down here are
   * exactly the ones that answer, so they need the same `resolve` the body has.
   */
  renderFooter?: (api: OverlayApi<R>) => ReactNode;
};

interface Overlay {
  modal: <R = void>(request: OverlayRequest<ModalProps, R>) => Promise<R | undefined>;
  sheet: <R = void>(request: OverlayRequest<BottomSheetProps, R>) => Promise<R | undefined>;
  /**
   * `modality` is not accepted: an inline sidebar is layout, and layout does
   * not get pushed through a registry. Use the declarative `Sidebar` for that.
   */
  sidebar: <R = void>(
    request: OverlayRequest<Omit<SidebarProps, 'modality'>, R>,
  ) => Promise<R | undefined>;
}

type OverlayKind = 'modal' | 'sheet' | 'sidebar';

interface OverlayEntry {
  id: string;
  /** The `useOverlay()` instance that opened it — see `closeOwnedBy`. */
  owner: string;
  kind: OverlayKind;
  /** Variant props, already stripped of everything the registry owns. */
  props: Record<string, unknown>;
  render: (api: OverlayApi<unknown>) => ReactNode;
  renderFooter?: (api: OverlayApi<unknown>) => ReactNode;
  open: boolean;
  /** Held until the exit transition finishes, then handed to `resolve`. */
  value: unknown;
  resolve: (value: unknown) => void;
}

interface RegistryValue {
  openOverlay: (
    kind: OverlayKind,
    owner: string,
    request: OverlayRequest<Record<string, unknown>, unknown>,
  ) => Promise<unknown>;
  closeOwnedBy: (owner: string) => void;
}

const RegistryContext = createContext<RegistryValue | null>(null);

/**
 * Opens overlays. Anything this component opened is closed when it unmounts,
 * so an `await` left hanging by a route change resolves to `undefined` instead
 * of running the rest of a handler against a component that is gone.
 *
 * Calls made outside React (an HTTP interceptor, say) have no such scope — see
 * §5.1 of docs/overlay-design.md.
 */
export function useOverlay(): Overlay {
  const registry = useContext(RegistryContext);
  if (!registry) {
    throw new Error(
      'useOverlay() needs <OverlayProvider> above it. Mount it inside the app providers — see docs/overlay-design.md.',
    );
  }
  const { openOverlay, closeOwnedBy } = registry;
  const owner = useId();

  useEffect(() => () => closeOwnedBy(owner), [owner, closeOwnedBy]);

  return useMemo<Overlay>(() => {
    const open =
      (kind: OverlayKind) => (request: OverlayRequest<Record<string, unknown>, unknown>) =>
        openOverlay(kind, owner, request);

    return {
      modal: open('modal'),
      sheet: open('sheet'),
      sidebar: open('sidebar'),
    } as Overlay;
  }, [openOverlay, owner]);
}

/**
 * Mount inside the app's providers — the overlays it renders see exactly the
 * contexts available at this point in the tree, and nothing below it.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly OverlayEntry[]>([]);
  const nextId = useRef(0);

  const closeOverlay = useCallback((id: string, value?: unknown) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, open: false, value } : entry)),
    );
  }, []);

  const closeOwnedBy = useCallback((owner: string) => {
    setEntries((current) =>
      current.map((entry) => (entry.owner === owner ? { ...entry, open: false } : entry)),
    );
  }, []);

  const openOverlay = useCallback<RegistryValue['openOverlay']>((kind, owner, request) => {
    const { render, renderFooter, ...props } = request;
    // Outside the updater: React may run an updater twice, and an id minted in
    // there would differ between the two runs.
    nextId.current += 1;
    const id = `overlay-${String(nextId.current)}`;
    return new Promise<unknown>((resolve) => {
      setEntries((current) => [
        ...current,
        { id, owner, kind, props, render, renderFooter, open: true, value: undefined, resolve },
      ]);
    });
  }, []);

  /* Resolution waits for the exit transition, so the caller's next line does
     not run while the overlay it acted on is still on screen. */
  const settleOverlay = useCallback((id: string) => {
    setEntries((current) => {
      const entry = current.find((candidate) => candidate.id === id);
      entry?.resolve(entry.value);
      return current.filter((candidate) => candidate.id !== id);
    });
  }, []);

  const registry = useMemo<RegistryValue>(
    () => ({ openOverlay, closeOwnedBy }),
    [openOverlay, closeOwnedBy],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <OverlayStackProvider>
        {children}
        {entries.map((entry) => (
          <OverlayOutlet
            key={entry.id}
            entry={entry}
            onClose={closeOverlay}
            onClosed={settleOverlay}
          />
        ))}
      </OverlayStackProvider>
    </RegistryContext.Provider>
  );
}

function OverlayOutlet({
  entry,
  onClose,
  onClosed,
}: {
  entry: OverlayEntry;
  onClose: (id: string, value?: unknown) => void;
  onClosed: (id: string) => void;
}) {
  const api: OverlayApi<unknown> = {
    close: () => onClose(entry.id),
    resolve: (value: unknown) => onClose(entry.id, value),
  };
  const common = {
    open: entry.open,
    onClose: () => onClose(entry.id),
    onClosed: () => onClosed(entry.id),
    footer: entry.renderFooter?.(api),
    children: entry.render(api),
  };

  switch (entry.kind) {
    case 'sheet':
      return <BottomSheet {...(entry.props as Omit<BottomSheetProps, ShellOwned>)} {...common} />;
    case 'sidebar':
      return (
        <Sidebar
          {...(entry.props as Omit<SidebarProps, ShellOwned>)}
          {...common}
          // Not the component default (`auto`): a sidebar opened through the
          // registry is a popup by definition. Inline is layout, and layout
          // goes through the declarative door.
          modality="modal"
        />
      );
    default:
      return <Modal {...(entry.props as Omit<ModalProps, ShellOwned>)} {...common} />;
  }
}
