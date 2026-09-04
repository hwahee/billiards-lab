/**
 * three.js scene for the billiards page (react-three-fiber + drei).
 *
 * Physics coordinates are the table plane (x, y) with z up; three.js space is
 * y-up, so a point maps as (x, y) → [x, height, −y] — a proper rotation, so
 * the orientation quaternion maps the same way: (x, y, z, w) → (x, z, −y, w).
 *
 * The live game is owned by the SERVER, but the rolling balls are REPLAYED
 * locally: the frame loop (inside <BallMeshes/>) renders `sim.renderBalls
 * (now)`, which advances the deterministic engine on this machine between
 * the server's strike echo and its at-rest snapshot. The table itself (dimensions, pocket mouths) and the ball set
 * both follow the active preset (carom vs. pool), so both re-render whenever
 * it changes.
 *
 * Free ball placement (idle only): picking up a ball starts a drag tracked
 * by an invisible plane raised above every ball, so pointer moves keep
 * hitting the plane (not whatever ball is currently under the cursor) for
 * the whole gesture. `sim.placeBall` does the bounds/overlap clamping.
 *
 * A captured ball doesn't just vanish: it shrinks in place at the pocket
 * mouth, disappears for a beat, then regrows at the holding tray — a
 * client-only animation (see POT_ANIM_* below) layered on top of the
 * physics state, which already teleported the ball there instantly.
 */
import { Line, OrbitControls, useCursor } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mesh } from 'three';

import { isOnFelt, trayFootprint } from '@shared/billiards/game-state';
import { DEFAULT_PARAMS, type PredictedPath, type TableConfig } from '@shared/billiards/physics';

import { AIM_SCHEMES, activeAimCue, type AimSchemeId } from './aim';
import { powerColor, speedToPower } from './aim/model';
import { ballSpec, PRESETS } from './config';
import {
  DragScopeProvider,
  DragSurface,
  FacingGroup,
  makeActionButtonTexture,
  SceneButton,
  useDragScope,
  useOwnedTexture,
  type DragScope,
} from './ui';
import { makeBallTexture, makeNumberedBallTexture } from './textures';
import type { BilliardsSim } from './use-billiards';

const BALL_RADIUS = DEFAULT_PARAMS.ballRadius;
/** Drag-scope name prefix for ball placement, e.g. `ball:white`. */
const BALL_DRAG_PREFIX = 'ball:';
const CUSHION_HEIGHT = 0.045;
const CUSHION_THICKNESS = 0.06;
const FRAME_THICKNESS = 0.11;
const FRAME_HEIGHT = 0.09;
/** Top surface of the wooden frame — where tray-held balls rest (higher than the cloth). */
const TRAY_SURFACE_Y = FRAME_HEIGHT - 0.03;
/** Trajectory lines float just above the cloth. */
const PATH_LIFT = 0.004;
/** Pocket mouth markers float just above the cloth, below the ball centres. */
const POCKET_LIFT = 0.002;

const CLOTH_COLOR = '#22754b';
const CUSHION_COLOR = '#1a5c3a';
const FRAME_COLOR = '#5a3a24';
const POCKET_COLOR = '#0a0a0a';

/** Seconds spent shrinking into the pocket mouth before vanishing. */
const POT_ANIM_SHRINK = 0.35;
/** Seconds spent gone, out of sight, before reappearing at the tray. */
const POT_ANIM_HIDDEN = 0.35;
/** Seconds spent growing back to full size once at the tray. */
const POT_ANIM_GROW = 0.35;

type PotAnimPhase = 'shrinking' | 'hidden' | 'growing';

interface PotAnim {
  phase: PotAnimPhase;
  elapsed: number;
  /** Where the ball was captured — held fixed for the whole shrink phase. */
  shrinkPos: { x: number; y: number };
}

function Table({ table }: { table: TableConfig }) {
  const { width, height, pockets } = table;
  const innerW = width + 2 * CUSHION_THICKNESS;
  const innerH = height + 2 * CUSHION_THICKNESS;
  const tray = pockets ? trayFootprint(table) : null;
  return (
    <group>
      {/* Cloth bed; playing surface is y = 0. */}
      <mesh receiveShadow position={[0, -0.015, 0]}>
        <boxGeometry args={[innerW, 0.03, innerH]} />
        <meshStandardMaterial color={CLOTH_COLOR} roughness={0.95} />
      </mesh>
      {/* Cushions: inner faces sit exactly on the physics walls (±w/2, ±h/2). */}
      {([1, -1] as const).map((side) => (
        <mesh
          key={`cushion-x-${side}`}
          castShadow
          receiveShadow
          position={[0, CUSHION_HEIGHT / 2, side * (height / 2 + CUSHION_THICKNESS / 2)]}
        >
          <boxGeometry args={[innerW, CUSHION_HEIGHT, CUSHION_THICKNESS]} />
          <meshStandardMaterial color={CUSHION_COLOR} roughness={0.9} />
        </mesh>
      ))}
      {([1, -1] as const).map((side) => (
        <mesh
          key={`cushion-y-${side}`}
          castShadow
          receiveShadow
          position={[side * (width / 2 + CUSHION_THICKNESS / 2), CUSHION_HEIGHT / 2, 0]}
        >
          <boxGeometry args={[CUSHION_THICKNESS, CUSHION_HEIGHT, height]} />
          <meshStandardMaterial color={CUSHION_COLOR} roughness={0.9} />
        </mesh>
      ))}
      {/* Wooden frame. */}
      {([1, -1] as const).map((side) => (
        <mesh
          key={`frame-x-${side}`}
          castShadow
          receiveShadow
          position={[
            0,
            FRAME_HEIGHT / 2 - 0.03,
            side * (height / 2 + CUSHION_THICKNESS + FRAME_THICKNESS / 2),
          ]}
        >
          <boxGeometry args={[innerW + 2 * FRAME_THICKNESS, FRAME_HEIGHT, FRAME_THICKNESS]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
        </mesh>
      ))}
      {([1, -1] as const).map((side) => (
        <mesh
          key={`frame-y-${side}`}
          castShadow
          receiveShadow
          position={[
            side * (width / 2 + CUSHION_THICKNESS + FRAME_THICKNESS / 2),
            FRAME_HEIGHT / 2 - 0.03,
            0,
          ]}
        >
          <boxGeometry args={[FRAME_THICKNESS, FRAME_HEIGHT, innerH]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
        </mesh>
      ))}
      {/* Pocket mouths — the capture zones where a slow-enough ball is potted. */}
      {pockets?.map((pocket, i) => (
        <mesh
          key={`pocket-${i}`}
          position={[pocket.x, POCKET_LIFT, -pocket.y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[pocket.radius * 0.85, 32]} />
          <meshStandardMaterial color={POCKET_COLOR} roughness={1} />
        </mesh>
      ))}
      {/* Pocketed-ball holding tray — a small shelf extending from the rail,
          its top flush with the frame (see TRAY_SURFACE_Y), sized to fit the
          whole slot grid so simultaneously potted balls don't overlap. */}
      {tray && (
        <group>
          <mesh castShadow receiveShadow position={[tray.x, FRAME_HEIGHT / 2 - 0.03, -tray.y]}>
            <boxGeometry args={[tray.width, FRAME_HEIGHT, tray.height]} />
            <meshStandardMaterial color={FRAME_COLOR} roughness={0.6} />
          </mesh>
          <mesh
            position={[tray.x, TRAY_SURFACE_Y + 0.001, -tray.y]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[tray.width, tray.height]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.12} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function BallMeshes({ sim, scope }: { sim: BilliardsSim; scope: DragScope }) {
  const meshRefs = useRef(new Map<string, Mesh>());
  const preset = PRESETS[sim.variant];
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Ball drags take the shared pointer under a per-ball name, so the camera
  // controls and the aim scheme all see one consistent "something is being
  // dragged" state.
  const draggedBallId = scope.owner?.startsWith(BALL_DRAG_PREFIX)
    ? scope.owner.slice(BALL_DRAG_PREFIX.length)
    : null;
  useCursor(draggedBallId !== null, 'grabbing');
  useCursor(draggedBallId === null && hoveredId !== null, 'grab');

  // Per-ball pocket-capture animation state (shrink → hidden → grow); a ball
  // absent from both maps and not `potted` is just in normal play, and one
  // absent from potAnimRef but present in settledRef sits at rest in the
  // tray, fully grown. Cleared whenever the game itself is replaced.
  const potAnimRef = useRef(new Map<string, PotAnim>());
  const settledRef = useRef(new Set<string>());
  useEffect(() => {
    potAnimRef.current.clear();
    settledRef.current.clear();
  }, [sim.gameGeneration]);

  const textures = useMemo(
    () =>
      new Map(
        preset.ballSpecs.map((spec) => [
          spec.id,
          spec.style === 'solid' || spec.style === 'stripe'
            ? makeNumberedBallTexture({
                color: spec.color,
                number: spec.number!,
                style: spec.style,
              })
            : makeBallTexture(spec.color, spec.markColor ?? '#ffffff'),
        ]),
      ),
    [preset],
  );
  useEffect(() => {
    return () => {
      for (const texture of textures.values()) texture.dispose();
    };
  }, [textures]);

  useFrame((_, delta) => {
    const table = preset.table;
    for (const ball of sim.renderBalls(performance.now())) {
      const mesh = meshRefs.current.get(ball.id);
      if (!mesh) continue;

      if (!ball.potted) {
        settledRef.current.delete(ball.id);
        potAnimRef.current.delete(ball.id);
        mesh.visible = true;
        mesh.scale.setScalar(1);
        mesh.position.set(ball.position.x, BALL_RADIUS, -ball.position.y);
        const q = ball.orientation;
        mesh.quaternion.set(q.x, q.z, -q.y, q.w);
        continue;
      }

      let anim = potAnimRef.current.get(ball.id);
      if (!anim && !settledRef.current.has(ball.id)) {
        // Newly captured this frame — start the shrink right where it fell.
        anim = { phase: 'shrinking', elapsed: 0, shrinkPos: { ...ball.position } };
        potAnimRef.current.set(ball.id, anim);
      }

      if (!anim) {
        // Already settled: at rest in the tray (or wherever it was dragged).
        const onFelt = isOnFelt(table, ball.position.x, ball.position.y);
        mesh.visible = true;
        mesh.scale.setScalar(1);
        const y = onFelt ? BALL_RADIUS : TRAY_SURFACE_Y + BALL_RADIUS;
        mesh.position.set(ball.position.x, y, -ball.position.y);
        continue;
      }

      anim.elapsed += delta;
      if (anim.phase === 'shrinking') {
        const t = Math.min(1, anim.elapsed / POT_ANIM_SHRINK);
        const scale = 1 - t;
        mesh.visible = scale > 0;
        mesh.scale.setScalar(scale);
        mesh.position.set(anim.shrinkPos.x, BALL_RADIUS * scale, -anim.shrinkPos.y);
        if (t >= 1) {
          anim.phase = 'hidden';
          anim.elapsed = 0;
        }
      } else if (anim.phase === 'hidden') {
        mesh.visible = false;
        if (anim.elapsed >= POT_ANIM_HIDDEN) {
          sim.settleIntoTray(ball.id);
          anim.phase = 'growing';
          anim.elapsed = 0;
        }
      } else {
        const t = Math.min(1, anim.elapsed / POT_ANIM_GROW);
        mesh.visible = true;
        mesh.scale.setScalar(t);
        mesh.position.set(ball.position.x, TRAY_SURFACE_Y + BALL_RADIUS * t, -ball.position.y);
        if (t >= 1) {
          potAnimRef.current.delete(ball.id);
          settledRef.current.add(ball.id);
        }
      }
    }
  });

  return (
    <>
      {preset.ballSpecs.map((spec) => (
        <mesh
          key={spec.id}
          castShadow
          ref={(mesh) => {
            if (mesh) meshRefs.current.set(spec.id, mesh);
            else meshRefs.current.delete(spec.id);
          }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            if (sim.phase !== 'idle') return;
            const ball = sim.gameRef.current.balls.find((b) => b.id === spec.id);
            if (!ball) return;
            if (potAnimRef.current.has(spec.id)) return; // mid pocket animation, not grabbable yet
            e.stopPropagation();
            scope.claim(`${BALL_DRAG_PREFIX}${spec.id}`);
          }}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            if (sim.phase !== 'idle') return;
            e.stopPropagation();
            setHoveredId(spec.id);
          }}
          onPointerOut={() => setHoveredId((current) => (current === spec.id ? null : current))}
        >
          <sphereGeometry args={[BALL_RADIUS, 48, 32]} />
          <meshStandardMaterial map={textures.get(spec.id)} roughness={0.2} metalness={0.05} />
        </mesh>
      ))}
      {draggedBallId !== null && (
        <DragSurface
          y={BALL_RADIUS * 4}
          onMove={(event) => sim.placeBall(draggedBallId, event.point.x, -event.point.z)}
          onRelease={() => scope.release(`${BALL_DRAG_PREFIX}${draggedBallId}`)}
        />
      )}
    </>
  );
}

/**
 * The predicted paths.
 *
 * This subtree re-renders whenever anything on the page changes — every
 * pointer move of an aim drag, for one — but a path is hundreds of points
 * and a fat line rebuilds its whole geometry when it is handed a new array.
 * So the scene-space arrays are derived once per set of paths: an unchanged
 * prediction then gives <Line> the identical array and costs nothing.
 */
function PredictionLines({ paths }: { paths: PredictedPath[] }) {
  const lines = useMemo(
    () =>
      paths
        .filter((path) => path.points.length >= 2)
        .map((path) => ({
          ballId: path.ballId,
          color: ballSpec(path.ballId).color,
          points: path.points.map((p) => [p.x, PATH_LIFT, -p.y] as [number, number, number]),
          end: path.points[path.points.length - 1]!,
        })),
    [paths],
  );
  return (
    <>
      {lines.map((line) => (
        <group key={line.ballId}>
          <Line points={line.points} color={line.color} lineWidth={1.5} transparent opacity={0.6} />
          {/* Ghost of the predicted resting position. */}
          <mesh position={[line.end.x, BALL_RADIUS, -line.end.y]}>
            <sphereGeometry args={[BALL_RADIUS, 16, 12]} />
            <meshStandardMaterial color={line.color} transparent opacity={0.25} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * The active aim scheme's in-scene half. Which widget appears — or whether
 * there is one at all, for a HUD-only scheme — is entirely the scheme's
 * business; see ./aim for the registry and the contract.
 */
function Aim({ sim, schemeId }: { sim: BilliardsSim; schemeId: AimSchemeId }) {
  const cue = activeAimCue(sim);
  const { Scene } = AIM_SCHEMES[schemeId];
  if (!cue || !Scene) return null;
  return <Scene cue={cue} shot={sim.shot} onShotChange={sim.setShot} ballRadius={BALL_RADIUS} />;
}

/**
 * Take the shot without leaving the view. It belongs to the scene rather
 * than to any one aim scheme, so every way of aiming is finished the same
 * way — and it appears under exactly the condition the aim widgets do
 * (`activeAimCue`), so it is never a button that does nothing.
 *
 * Pinned to the cue ball and pinned square-on (`maxAngle = 0`): a target you
 * have to hit is the one thing that should not lean away from you. Its label
 * is passed in, since the locale lives outside the canvas.
 */
function StrikeButton({ sim, label }: { sim: BilliardsSim; label: string }) {
  const cue = activeAimCue(sim);
  const accent = powerColor(speedToPower(sim.shot.speed));
  const texture = useOwnedTexture(
    useMemo(() => makeActionButtonTexture({ label, accent }), [label, accent]),
  );
  if (!cue) return null;
  return (
    <FacingGroup
      position={[cue.position.x, BALL_RADIUS, -cue.position.y]}
      maxAngle={0}
      responsiveness={16}
      constantSizeAt={2.4}
    >
      <group position={[0, -0.24, 0]}>
        <SceneButton texture={texture} width={0.17} dragId="strike" onPress={sim.strikeCue} />
      </group>
    </FacingGroup>
  );
}

export function BilliardsScene({
  sim,
  prediction,
  aimScheme,
  strikeLabel,
}: {
  sim: BilliardsSim;
  prediction: PredictedPath[] | null;
  aimScheme: AimSchemeId;
  /** Text on the in-scene strike button; translated outside the canvas. */
  strikeLabel: string;
}) {
  const table = PRESETS[sim.variant].table;
  // One notion of "something is being dragged", shared by ball placement and
  // whatever the aim scheme puts on the table — and read here to stand the
  // camera controls down. Created outside the canvas so OrbitControls can
  // see it; provided inside, since context does not cross that boundary.
  const dragScope = useDragScope();

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 2.1, 1.9], fov: 42 }}>
      <color attach="background" args={['#101820']} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[1.4, 3, 1.2]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
      />
      <Table table={table} />
      <DragScopeProvider value={dragScope}>
        <BallMeshes sim={sim} scope={dragScope} />
        <Aim sim={sim} schemeId={aimScheme} />
        <StrikeButton sim={sim} label={strikeLabel} />
      </DragScopeProvider>
      {prediction && <PredictionLines paths={prediction} />}
      <OrbitControls
        makeDefault
        enabled={dragScope.owner === null}
        target={[0, 0, 0]}
        maxPolarAngle={1.45}
        minDistance={0.6}
        maxDistance={6}
      />
    </Canvas>
  );
}
