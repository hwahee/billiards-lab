/**
 * The screen-space HUD layer over the 3D view.
 *
 * Anything that belongs ON the screen rather than in the world goes here —
 * an aim HUD, status hints, and whatever gets added later. It is a layer,
 * not a panel: it owns the geography (five anchors) and each widget merely
 * names one, so several widgets can share the view, and a corner, without
 * hard-coding offsets or knowing about each other.
 *
 * Pointer discipline: the layer is transparent to pointer events, so
 * orbiting and dragging in the canvas underneath keep working everywhere
 * the HUD isn't. Only the panels themselves take input.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type HudAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center';

const ANCHORS: readonly HudAnchor[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'bottom-center',
];

type Slots = Partial<Record<HudAnchor, HTMLDivElement>>;

const HudSlotContext = createContext<Slots | null>(null);

/** Wraps the 3D view; must be inside a positioned container. */
export function HudLayer({ children }: { children: ReactNode }) {
  const refs = useRef<Slots>({});
  const [slots, setSlots] = useState<Slots | null>(null);

  // Children portal into the anchor elements, so those must exist first.
  useLayoutEffect(() => {
    setSlots({ ...refs.current });
  }, []);

  return (
    <div className="hud-layer">
      {ANCHORS.map((anchor) => (
        <div
          key={anchor}
          className={`hud-layer__slot hud-layer__slot--${anchor}`}
          ref={(element) => {
            if (element) refs.current[anchor] = element;
            else delete refs.current[anchor];
          }}
        />
      ))}
      <HudSlotContext.Provider value={slots}>{slots ? children : null}</HudSlotContext.Provider>
    </div>
  );
}

/**
 * One widget in the HUD. Several may name the same anchor; they stack in
 * mount order with a consistent gap.
 */
export function HudPanel({
  anchor,
  testId,
  className,
  children,
}: {
  anchor: HudAnchor;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const slots = useContext(HudSlotContext);
  const target = slots?.[anchor];
  if (!target) return null;
  return createPortal(
    <div className={className ? `hud-panel ${className}` : 'hud-panel'} data-testid={testId}>
      {children}
    </div>,
    target,
  );
}
