/**
 * <Panel> — a flat in-scene surface showing a canvas-painted texture.
 *
 * Panels are readouts *and* controls: pointer handlers are forwarded, and
 * `event.uv` gives the hit in panel coordinates (0–1, origin bottom-left),
 * which is all an in-panel widget needs to turn a click into a value. See
 * aim/schemes/dial-panel for a panel that is a full control surface.
 *
 * Textures come from module-scope factories (./panels, or a scheme's own),
 * so a panel's picture is a pure function of its inputs; `useOwnedTexture`
 * ties the texture's lifetime to the component that built it.
 */
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect } from 'react';
import type { Texture } from 'three';

/** Disposes `texture` when it is replaced or the component unmounts. */
export function useOwnedTexture<T extends Texture>(texture: T): T {
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

export interface PanelProps {
  texture: Texture;
  /** Width in metres; height follows the texture's aspect unless given. */
  width: number;
  height?: number;
  opacity?: number;
  /** Draw over everything, ignoring depth — right for floating readouts. */
  alwaysOnTop?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}

export function Panel({
  texture,
  width,
  height,
  opacity = 1,
  alwaysOnTop = true,
  ...handlers
}: PanelProps) {
  const image = texture.image as { width?: number; height?: number } | null;
  const aspect = image?.width && image.height ? image.height / image.width : 0.5;
  return (
    <mesh renderOrder={alwaysOnTop ? 10 : 0} {...handlers}>
      <planeGeometry args={[width, height ?? width * aspect]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthTest={!alwaysOnTop}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
