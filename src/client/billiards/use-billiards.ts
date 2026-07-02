/**
 * State container for the billiards page.
 *
 * The physics state (balls, orientations, sim clock) lives in mutable refs so
 * the render loop can advance it at 600 Hz without going through React.
 * React state holds only what the UI renders: the control values, the phase,
 * a low-frequency snapshot of the balls, and the collision log.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Quaternion, Vector3 } from 'three';

import {
  CAROM_TABLE,
  cloneBalls,
  DEFAULT_PARAMS,
  isAtRest,
  SIM_DT,
  stepPhysics,
  strike,
  type BallState,
  type CollisionEvent,
  type PhysicsParams,
} from '@shared/billiards/physics';

import {
  createInitialBalls,
  CUE_BALL_ID,
  DEFAULT_SHOT,
  toStrikeInput,
  type ShotSettings,
} from './config';

type SimPhase = 'idle' | 'running' | 'paused';

export interface SimEvent {
  /** Simulation clock at the moment of the collision (s). */
  time: number;
  event: CollisionEvent;
}

const MAX_LOGGED_EVENTS = 24;
/** Collisions with the same signature within this window are one contact. */
const EVENT_DEDUPE_WINDOW = 0.08;

const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();

export interface BilliardsSim {
  phase: SimPhase;
  shot: ShotSettings;
  setShot: (shot: ShotSettings) => void;
  physics: PhysicsParams;
  setPhysics: (physics: PhysicsParams) => void;
  simSpeed: number;
  setSimSpeed: (speed: number) => void;
  /** Low-frequency copy of the ball states, for readouts and prediction. */
  snapshot: BallState[];
  simTime: number;
  events: SimEvent[];
  strikeCue: () => void;
  reset: () => void;
  togglePause: () => void;
  stepOnce: () => void;
  // Render-loop interface (stable refs; mutated without React re-renders).
  phaseRef: RefObject<SimPhase>;
  simSpeedRef: RefObject<number>;
  physicsRef: RefObject<PhysicsParams>;
  ballsRef: RefObject<BallState[]>;
  orientationsRef: RefObject<Map<string, Quaternion>>;
  /** Advances the physics by `steps` fixed SIM_DT steps. */
  advance: (steps: number) => void;
}

export function useBilliardsSim(): BilliardsSim {
  const [phase, setPhaseState] = useState<SimPhase>('idle');
  const [shot, setShot] = useState<ShotSettings>(DEFAULT_SHOT);
  const [physics, setPhysicsState] = useState<PhysicsParams>(DEFAULT_PARAMS);
  const [simSpeed, setSimSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<BallState[]>(createInitialBalls);
  const [simTime, setSimTime] = useState(0);
  const [events, setEvents] = useState<SimEvent[]>([]);

  const ballsRef = useRef<BallState[]>(createInitialBalls());
  const orientationsRef = useRef<Map<string, Quaternion>>(
    new Map(createInitialBalls().map((b) => [b.id, new Quaternion()])),
  );
  const simTimeRef = useRef(0);
  const phaseRef = useRef<SimPhase>('idle');
  const physicsRef = useRef(physics);
  const simSpeedRef = useRef(simSpeed);
  const lastEventRef = useRef<{ signature: string; time: number } | null>(null);

  const setPhase = useCallback((next: SimPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setPhysics = useCallback((next: PhysicsParams) => {
    physicsRef.current = next;
    setPhysicsState(next);
  }, []);

  const setSimSpeed = useCallback((next: number) => {
    simSpeedRef.current = next;
    setSimSpeedState(next);
  }, []);

  const updateSnapshot = useCallback(() => {
    setSnapshot(cloneBalls(ballsRef.current));
    setSimTime(simTimeRef.current);
  }, []);

  const advance = useCallback(
    (steps: number) => {
      const balls = ballsRef.current;
      const params = physicsRef.current;
      const collisions: CollisionEvent[] = [];
      const logged: SimEvent[] = [];

      for (let i = 0; i < steps; i += 1) {
        collisions.length = 0;
        stepPhysics(balls, CAROM_TABLE, params, SIM_DT, collisions);
        simTimeRef.current += SIM_DT;

        for (const event of collisions) {
          const signature =
            event.type === 'ball'
              ? `ball:${event.ballId}:${event.otherId}`
              : `cushion:${event.ballId}`;
          const last = lastEventRef.current;
          if (
            last?.signature === signature &&
            simTimeRef.current - last.time < EVENT_DEDUPE_WINDOW
          ) {
            last.time = simTimeRef.current;
            continue;
          }
          lastEventRef.current = { signature, time: simTimeRef.current };
          logged.push({ time: simTimeRef.current, event });
        }

        // Spin the rendered meshes: world-frame ω → three.js axes (x, z, −y).
        for (const ball of balls) {
          const w = ball.spin;
          const mag = Math.hypot(w.x, w.y, w.z);
          if (mag < 1e-3) continue;
          const q = orientationsRef.current.get(ball.id);
          if (!q) continue;
          tmpAxis.set(w.x / mag, w.z / mag, -w.y / mag);
          tmpQuat.setFromAxisAngle(tmpAxis, mag * SIM_DT);
          q.premultiply(tmpQuat);
        }
      }

      if (logged.length > 0) {
        setEvents((prev) => [...prev, ...logged].slice(-MAX_LOGGED_EVENTS));
      }
      if (phaseRef.current !== 'idle' && isAtRest(balls, params)) {
        setPhase('idle');
        updateSnapshot();
      }
    },
    [setPhase, updateSnapshot],
  );

  const strikeCue = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    const cue = ballsRef.current.find((b) => b.id === CUE_BALL_ID);
    if (!cue) return;
    strike(cue, toStrikeInput(shot));
    setPhase('running');
    updateSnapshot();
  }, [shot, setPhase, updateSnapshot]);

  const reset = useCallback(() => {
    ballsRef.current = createInitialBalls();
    orientationsRef.current = new Map(ballsRef.current.map((b) => [b.id, new Quaternion()]));
    simTimeRef.current = 0;
    lastEventRef.current = null;
    setEvents([]);
    setPhase('idle');
    updateSnapshot();
  }, [setPhase, updateSnapshot]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === 'running') {
      setPhase('paused');
      updateSnapshot();
    } else if (phaseRef.current === 'paused') {
      setPhase('running');
    }
  }, [setPhase, updateSnapshot]);

  const stepOnce = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    advance(Math.round(1 / 60 / SIM_DT));
    updateSnapshot();
  }, [advance, updateSnapshot]);

  // Refresh the readout at a low frequency while the simulation runs.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(updateSnapshot, 150);
    return () => clearInterval(timer);
  }, [phase, updateSnapshot]);

  return {
    phase,
    shot,
    setShot,
    physics,
    setPhysics,
    simSpeed,
    setSimSpeed,
    snapshot,
    simTime,
    events,
    strikeCue,
    reset,
    togglePause,
    stepOnce,
    phaseRef,
    simSpeedRef,
    physicsRef,
    ballsRef,
    orientationsRef,
    advance,
  };
}
