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
 */
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Mesh } from 'three';

import {
  DEFAULT_PARAMS,
  SIM_DT,
  type PredictedPath,
  type TableConfig,
} from '@shared/billiards/physics';

import { ballSpec, PRESETS, type ShotSettings } from './config';
import { makeBallTexture, makeNumberedBallTexture } from './textures';
import type { BilliardsSim } from './use-billiards';

const BALL_RADIUS = DEFAULT_PARAMS.ballRadius;
const CUSHION_HEIGHT = 0.045;
const CUSHION_THICKNESS = 0.06;
const FRAME_THICKNESS = 0.11;
const FRAME_HEIGHT = 0.09;
/** Trajectory lines float just above the cloth. */
const PATH_LIFT = 0.004;
/** Pocket mouth markers float just above the cloth, below the ball centres. */
const POCKET_LIFT = 0.002;

const CLOTH_COLOR = '#22754b';
const CUSHION_COLOR = '#1a5c3a';
const FRAME_COLOR = '#5a3a24';
const POCKET_COLOR = '#0a0a0a';

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
    </group>
  );
}

function BallMeshes({ sim }: { sim: BilliardsSim }) {
  const meshRefs = useRef(new Map<string, Mesh>());
  const accumulatorRef = useRef(0);
  const preset = PRESETS[sim.variant];

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
    for (const ball of sim.gameRef.current.balls) {
      const mesh = meshRefs.current.get(ball.id);
      if (!mesh) continue;
      mesh.visible = !ball.potted;
      if (ball.potted) continue;
      mesh.position.set(ball.position.x, BALL_RADIUS, -ball.position.y);
      const q = ball.orientation;
      mesh.quaternion.set(q.x, q.z, -q.y, q.w);
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
        >
          <sphereGeometry args={[BALL_RADIUS, 48, 32]} />
          <meshStandardMaterial map={textures.get(spec.id)} roughness={0.2} metalness={0.05} />
        </mesh>
      ))}
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
      <BallMeshes sim={sim} />
      {prediction && <PredictionLines paths={prediction} />}
      {sim.phase === 'idle' && <AimLine sim={sim} shot={sim.shot} />}
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={1.45}
        minDistance={0.6}
        maxDistance={6}
      />
    </Canvas>
  );
}
