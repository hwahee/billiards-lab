/**
 * Drag ownership for everything in the 3D view.
 *
 * Several things in the scene want the pointer: dragging a ball to a new
 * spot, and whatever the active aim scheme puts on the table. They must not
 * fight each other, and while any of them holds the pointer the camera
 * controls have to stand down — otherwise a drag also orbits the view.
 *
 * So ownership is explicit and singular: a widget claims the drag by name,
 * everyone can see whether anything is being dragged, and releasing is
 * handled centrally — including the case the widgets always get wrong,
 * where the pointer comes up outside the canvas and no local handler ever
 * fires.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThreeEvent } from '@react-three/fiber';

export interface DragScope {
  /** Name of whatever currently holds the pointer, or null. */
  owner: string | null;
  claim: (id: string) => void;
  release: (id: string) => void;
}

const DragScopeContext = createContext<DragScope | null>(null);

/**
 * Owns the drag state. Call outside the R3F canvas (so the camera controls
 * can read `owner` too) and pass the result to <DragScopeProvider/> inside
 * it — React context does not cross the canvas boundary by itself.
 */
export function useDragScope(): DragScope {
  const [owner, setOwner] = useState<string | null>(null);

  // The safety net every widget forgets: a pointer released off-canvas, or
  // cancelled by the browser, must still end the drag.
  useEffect(() => {
    if (owner === null) return;
    const end = () => setOwner(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [owner]);

  return useMemo(
    () => ({
      owner,
      claim: (id: string) => setOwner(id),
      release: (id: string) => setOwner((current) => (current === id ? null : current)),
    }),
    [owner],
  );
}

export function DragScopeProvider({ value, children }: { value: DragScope; children: ReactNode }) {
  return <DragScopeContext.Provider value={value}>{children}</DragScopeContext.Provider>;
}

export interface DragHandle {
  /** This widget is the one being dragged. */
  active: boolean;
  /** Nothing anywhere is being dragged. */
  idle: boolean;
  claim: () => void;
  release: () => void;
}

/** Claim/release the shared pointer under a stable name. */
export function useDragHandle(id: string): DragHandle {
  const scope = useContext(DragScopeContext);
  if (!scope) throw new Error('useDragHandle must be used inside <DragScopeProvider>');
  const { owner, claim, release } = scope;
  return {
    active: owner === id,
    idle: owner === null,
    claim: useCallback(() => claim(id), [claim, id]),
    release: useCallback(() => release(id), [release, id]),
  };
}

/**
 * Invisible ground-plane that swallows pointer moves for the duration of a
 * drag. Without it, moving the pointer off the widget and over a ball hands
 * the drag to whatever happens to be under the cursor. Render it only while
 * the drag is active.
 *
 * `y` places the capture plane at the height the dragged thing lives at, so
 * the hit point maps 1:1 onto what is drawn.
 */
export function DragSurface({
  y = 0,
  onMove,
  onRelease,
}: {
  y?: number;
  onMove: (event: ThreeEvent<PointerEvent>) => void;
  onRelease: () => void;
}) {
  return (
    <mesh
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onMove(event);
      }}
      onPointerUp={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onRelease();
      }}
    >
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * The same idea for a widget that is NOT on the cloth: an invisible plane
 * lying in its PARENT GROUP's plane, reporting the hit in that group's own
 * local metres. Mount it as a sibling of the widget — inside the
 * <FacingGroup> it belongs to — and a drag keeps tracking after the pointer
 * leaves the widget, in the same coordinates the widget is laid out in.
 *
 * `size` is the capture extent in local metres, centred on the group origin.
 */
export function PlaneDragSurface({
  size = 8,
  onMove,
  onRelease,
}: {
  size?: number;
  onMove: (local: { x: number; y: number }) => void;
  onRelease: () => void;
}) {
  return (
    <mesh
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (!event.uv) return;
        onMove({ x: (event.uv.x - 0.5) * size, y: (event.uv.y - 0.5) * size });
      }}
      onPointerUp={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onRelease();
      }}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
