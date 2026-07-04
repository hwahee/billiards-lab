/**
 * State container for the billiards page.
 *
 * The whole game state (balls with orientation quaternions, sim clock,
 * collision log) is one serializable BilliardsGameState from
 * @shared/billiards/game-state, held in a mutable ref so the render loop can
 * advance it at 600 Hz without going through React. React state holds only
 * what the UI renders: the control values, the phase, a low-frequency
 * snapshot of the balls, and a copy of the collision log.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  advanceGameState,
  createInitialGameState,
  strikeBall,
  type BilliardsGameState,
  type SimEvent,
} from '@shared/billiards/game-state';
import {
  CAROM_TABLE,
  cloneBalls,
  DEFAULT_PARAMS,
  isAtRest,
  SIM_DT,
  type BallState,
  type PhysicsParams,
} from '@shared/billiards/physics';

import { CUE_BALL_ID, DEFAULT_SHOT, toStrikeInput, type ShotSettings } from './config';

type SimPhase = 'idle' | 'running' | 'paused';

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
  gameRef: RefObject<BilliardsGameState>;
  /** Advances the physics by `steps` fixed SIM_DT steps. */
  advance: (steps: number) => void;
}

export function useBilliardsSim(): BilliardsSim {
  const [phase, setPhaseState] = useState<SimPhase>('idle');
  const [shot, setShot] = useState<ShotSettings>(DEFAULT_SHOT);
  const [physics, setPhysicsState] = useState<PhysicsParams>(DEFAULT_PARAMS);
  const [simSpeed, setSimSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<BallState[]>(() => createInitialGameState().balls);
  const [simTime, setSimTime] = useState(0);
  const [events, setEvents] = useState<SimEvent[]>([]);

  const gameRef = useRef<BilliardsGameState>(createInitialGameState());
  const phaseRef = useRef<SimPhase>('idle');
  const physicsRef = useRef(physics);
  const simSpeedRef = useRef(simSpeed);

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
    setSnapshot(cloneBalls(gameRef.current.balls));
    setSimTime(gameRef.current.simTime);
  }, []);

  const advance = useCallback(
    (steps: number) => {
      const game = gameRef.current;
      const params = physicsRef.current;
      const logged = advanceGameState(game, CAROM_TABLE, params, steps);

      if (logged.length > 0) setEvents([...game.events]);
      if (phaseRef.current !== 'idle' && isAtRest(game.balls, params)) {
        setPhase('idle');
        updateSnapshot();
      }
    },
    [setPhase, updateSnapshot],
  );

  const strikeCue = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    strikeBall(gameRef.current, CUE_BALL_ID, toStrikeInput(shot));
    setPhase('running');
    updateSnapshot();
  }, [shot, setPhase, updateSnapshot]);

  const reset = useCallback(() => {
    gameRef.current = createInitialGameState();
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
    gameRef,
    advance,
  };
}
