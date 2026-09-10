/**
 * <SceneButton> — a press-me control that lives in the 3D scene.
 *
 * Panels so far have been readouts and drag surfaces; a button is the third
 * thing an in-world UI needs, and it has two requirements the others don't:
 *
 *  - it must take the shared pointer for the duration of the press, or the
 *    press also orbits the camera (the camera controls listen to the canvas
 *    directly and never see a stopped propagation);
 *  - the press must only fire if the pointer comes up ON the button, so a
 *    press begun by mistake can be dragged off and abandoned.
 *
 * Whether a press is in progress is tracked in a REF rather than read back
 * off the drag scope, because a quick click can put the release in the same
 * frame as the press: waiting for the claim to come back through React
 * would drop it. The scope claim still happens — it is what stands the
 * camera down — but the button does not depend on seeing it again.
 *
 * The picture is a plain texture; hover and press are expressed by scale and
 * opacity, so a button needs no repainting to feel alive.
 */
import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useRef, useState } from 'react';
import type { Texture } from 'three';

import { useDragHandle } from './drag';
import { Panel } from './panel';

export interface SceneButtonProps {
  texture: Texture;
  /** Width in metres; height follows the texture's aspect unless given. */
  width: number;
  height?: number;
  /** Drag-scope name — must be unique among everything that takes the pointer. */
  dragId: string;
  disabled?: boolean;
  onPress: () => void;
}

export function SceneButton({
  texture,
  width,
  height,
  dragId,
  disabled = false,
  onPress,
}: SceneButtonProps) {
  const drag = useDragHandle(dragId);
  const [hovered, setHovered] = useState(false);
  // Set on press, cleared on release or on leaving the button — so a press
  // dragged off the button is abandoned, and a release that never began here
  // does nothing.
  const pressingRef = useRef(false);
  useCursor(hovered && !disabled, 'pointer');

  const pressed = drag.active && !disabled;
  const scale = disabled ? 1 : pressed ? 0.93 : hovered ? 1.06 : 1;

  return (
    <group scale={scale}>
      <Panel
        texture={texture}
        width={width}
        height={height}
        opacity={disabled ? 0.4 : 1}
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          if (disabled) return;
          event.stopPropagation();
          pressingRef.current = true;
          drag.claim();
        }}
        onPointerUp={(event: ThreeEvent<PointerEvent>) => {
          if (disabled || !pressingRef.current) return;
          event.stopPropagation();
          pressingRef.current = false;
          drag.release();
          onPress();
        }}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => {
          pressingRef.current = false;
          setHovered(false);
        }}
      />
    </group>
  );
}
