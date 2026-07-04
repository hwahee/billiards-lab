/**
 * three.js scene for the billiards page (react-three-fiber + drei).
 *
 * Physics coordinates are the table plane (x, y) with z up; three.js space is
 * y-up, so a point maps as (x, y) → [x, height, −y] — a proper rotation, so
 * the orientation quaternion maps the same way: (x, y, z, w) → (x, z, −y, w).
 *
 * The frame loop (inside <BallMeshes/>) advances the deterministic engine
 * with a fixed-step accumulator; rendering only mirrors the mutable state.
 * The table itself (dimensions, pocket mouths) and the ball set both follow
 * the active preset (carom vs. pool), so both re-render whenever it changes.
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

import {
  DEFAULT_PARAMS,
  SIM_DT,
  type PredictedPath,
  type TableConfig,
} from '@shared/billiards/physics';

import { ballSpec, isOnFelt, PRESETS, trayAnchor, type ShotSettings } from './config';
import { makeBallTexture, makeNumberedBallTexture } from './textures';
import type { BilliardsSim } from './use-billiards';

const BALL_RADIUS = DEFAULT_PARAMS.ballRadius;
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
      {/* Holding tray marker — where potted balls reappear, ready to drag back in. */}
      {pockets && (
        <mesh
          position={[trayAnchor(table).x, POCKET_LIFT, -trayAnchor(table).y]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[BALL_RADIUS * 1.3, BALL_RADIUS * 1.9, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}

function BallMeshes({
  sim,
  draggingId,
  onDragStart,
  onDragEnd,
}: {
  sim: BilliardsSim;
  draggingId: string | null;
  onDragStart: (ballId: string) => void;
  onDragEnd: () => void;
}) {
  const meshRefs = useRef(new Map<string, Mesh>());
  const accumulatorRef = useRef(0);
  const preset = PRESETS[sim.variant];
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useCursor(draggingId !== null, 'grabbing');
  useCursor(draggingId === null && hoveredId !== null, 'grab');

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
    if (sim.phaseRef.current === 'running') {
      // Fixed-step accumulator: rendering rate never affects the trajectory.
      accumulatorRef.current += Math.min(delta, 0.25) * sim.simSpeedRef.current;
      const steps = Math.floor(accumulatorRef.current / SIM_DT);
      if (steps > 0) {
        accumulatorRef.current -= steps * SIM_DT;
        sim.advance(steps);
      }
    }
    const table = preset.table;
    for (const ball of sim.gameRef.current.balls) {
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
            onDragStart(spec.id);
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
      {draggingId && (
        <mesh
          position={[0, BALL_RADIUS * 4, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            sim.placeBall(draggingId, e.point.x, -e.point.z);
          }}
          onPointerUp={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onDragEnd();
          }}
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

function PredictionLines({ paths }: { paths: PredictedPath[] }) {
  return (
    <>
      {paths.map((path) => {
        if (path.points.length < 2) return null;
        const spec = ballSpec(path.ballId);
        const end = path.points[path.points.length - 1]!;
        return (
          <group key={path.ballId}>
            <Line
              points={path.points.map((p) => [p.x, PATH_LIFT, -p.y] as const)}
              color={spec.color}
              lineWidth={1.5}
              transparent
              opacity={0.6}
            />
            {/* Ghost of the predicted resting position. */}
            <mesh position={[end.x, BALL_RADIUS, -end.y]}>
              <sphereGeometry args={[BALL_RADIUS, 16, 12]} />
              <meshStandardMaterial color={spec.color} transparent opacity={0.25} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function AimLine({ sim, shot }: { sim: BilliardsSim; shot: ShotSettings }) {
  const cueBallId = PRESETS[sim.variant].cueBallId;
  const cue = sim.snapshot.find((ball) => ball.id === cueBallId);
  if (!cue || cue.potted) return null;
  const rad = (shot.directionDeg * Math.PI) / 180;
  const length = 0.18 + shot.speed * 0.08;
  const from = [cue.position.x, BALL_RADIUS, -cue.position.y] as const;
  const to = [
    cue.position.x + Math.cos(rad) * length,
    BALL_RADIUS,
    -(cue.position.y + Math.sin(rad) * length),
  ] as const;
  return <Line points={[from, to]} color="#ffffff" lineWidth={2} transparent opacity={0.9} />;
}

export function BilliardsScene({
  sim,
  prediction,
}: {
  sim: BilliardsSim;
  prediction: PredictedPath[] | null;
}) {
  const table = PRESETS[sim.variant].table;
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Safety net: end the drag even if the pointer is released off-canvas,
  // where the plane's own onPointerUp never fires.
  useEffect(() => {
    if (draggingId === null) return;
    const endDrag = () => setDraggingId(null);
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, [draggingId]);

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
      <BallMeshes
        sim={sim}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDragEnd={() => setDraggingId(null)}
      />
      {prediction && <PredictionLines paths={prediction} />}
      {sim.phase === 'idle' && <AimLine sim={sim} shot={sim.shot} />}
      <OrbitControls
        makeDefault
        enabled={draggingId === null}
        target={[0, 0, 0]}
        maxPolarAngle={1.45}
        minDistance={0.6}
        maxDistance={6}
      />
    </Canvas>
  );
}
