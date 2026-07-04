/**
 * State container for the billiards page.
 *
 * The whole game state (balls with orientation quaternions, sim clock,
 * collision log) is one serializable BilliardsGameState from
 * @shared/billiards/game-state, held in a mutable ref so the render loop can
 * advance it at 600 Hz without going through React. React state holds only
 * what the UI renders: the control values, the phase, a low-frequency
 * snapshot of the balls, and a copy of the collision log.
 *
 * The active preset (carom or pool — different table, rack and cue ball id)
 * is itself a piece of state; switching it re-racks the table via that
 * preset's `createState()`.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  advanceGameState,
  strikeBall,
  type BilliardsGameState,
  type SimEvent,
} from '@shared/billiards/game-state';
import {
  cloneBalls,
  DEFAULT_PARAMS,
  isAtRest,
  SIM_DT,
  type BallState,
  type PhysicsParams,
} from '@shared/billiards/physics';

import {
  DEFAULT_SHOT,
  PRESETS,
  toStrikeInput,
  type BilliardsVariant,
  type ShotSettings,
} from './config';

type SimPhase = 'idle' | 'running' | 'paused';

export interface BilliardsSim {
  variant: BilliardsVariant;
  setVariant: (variant: BilliardsVariant) => void;
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
  const [variant, setVariantState] = useState<BilliardsVariant>('carom');
  const [phase, setPhaseState] = useState<SimPhase>('idle');
  const [shot, setShot] = useState<ShotSettings>(DEFAULT_SHOT);
  const [physics, setPhysicsState] = useState<PhysicsParams>(DEFAULT_PARAMS);
  const [simSpeed, setSimSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<BallState[]>(() => PRESETS.carom.createState().balls);
  const [simTime, setSimTime] = useState(0);
  const [events, setEvents] = useState<SimEvent[]>([]);

  const variantRef = useRef<BilliardsVariant>('carom');
  const gameRef = useRef<BilliardsGameState>(PRESETS.carom.createState());
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
      const table = PRESETS[variantRef.current].table;
      const logged = advanceGameState(game, table, params, steps);

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
    strikeBall(gameRef.current, PRESETS[variantRef.current].cueBallId, toStrikeInput(shot));
    setPhase('running');
    updateSnapshot();
  }, [shot, setPhase, updateSnapshot]);

  const reset = useCallback(() => {
    gameRef.current = PRESETS[variantRef.current].createState();
    setEvents([]);
    setPhase('idle');
    updateSnapshot();
  }, [setPhase, updateSnapshot]);

  const setVariant = useCallback(
    (next: BilliardsVariant) => {
      variantRef.current = next;
      gameRef.current = PRESETS[next].createState();
      setEvents([]);
      setPhase('idle');
      setVariantState(next);
      updateSnapshot();
    },
    [setPhase, updateSnapshot],
  );

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
    variant,
    setVariant,
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
