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
  nextFreeTraySlot,
  PRESETS,
  toStrikeInput,
  type BilliardsVariant,
  type ShotSettings,
} from './config';

type SimPhase = 'idle' | 'running' | 'paused';

export interface BilliardsSim {
  variant: BilliardsVariant;
  setVariant: (variant: BilliardsVariant) => void;
  /** Bumped on every reset()/setVariant() so per-ball client animation state can be dropped. */
  gameGeneration: number;
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
  /**
   * Freely repositions a resting ball (table setup / practice mode). Only
   * takes effect while idle. A potted ball dragged back onto the felt
   * rejoins play (subject to the usual bounds/overlap rules below); dragged
   * while still off the felt, it just moves within the holding tray. An
   * active ball's target is clamped inside the rails and rejected outright
   * if it would overlap another ball.
   */
  placeBall: (ballId: string, x: number, y: number) => void;
  /** Moves a just-captured ball to the pocketed-ball holding tray, at rest. */
  settleIntoTray: (ballId: string) => void;
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
  const [gameGeneration, setGameGeneration] = useState(0);
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
    const cueBall = gameRef.current.balls.find(
      (b) => b.id === PRESETS[variantRef.current].cueBallId,
    );
    if (!cueBall || cueBall.potted) return; // must be dragged back onto the table first
    strikeBall(gameRef.current, cueBall.id, toStrikeInput(shot));
    setPhase('running');
    updateSnapshot();
  }, [shot, setPhase, updateSnapshot]);

  const reset = useCallback(() => {
    gameRef.current = PRESETS[variantRef.current].createState();
    setEvents([]);
    setPhase('idle');
    setGameGeneration((g) => g + 1);
    updateSnapshot();
  }, [setPhase, updateSnapshot]);

  const setVariant = useCallback(
    (next: BilliardsVariant) => {
      variantRef.current = next;
      gameRef.current = PRESETS[next].createState();
      setEvents([]);
      setPhase('idle');
      setGameGeneration((g) => g + 1);
      setVariantState(next);
      updateSnapshot();
    },
    [setPhase, updateSnapshot],
  );

  const placeBall = useCallback(
    (ballId: string, x: number, y: number) => {
      if (phaseRef.current !== 'idle') return;
      const game = gameRef.current;
      const ball = game.balls.find((b) => b.id === ballId);
      if (!ball) return;

      const { table } = PRESETS[variantRef.current];
      const R = physicsRef.current.ballRadius;
      const xLim = table.width / 2 - R;
      const yLim = table.height / 2 - R;
      const onFelt = Math.abs(x) <= xLim && Math.abs(y) <= yLim;

      if (ball.potted && !onFelt) {
        // Still off the table: free rearranging within the holding tray.
        ball.position = { x, y };
        updateSnapshot();
        return;
      }

      const cx = Math.min(xLim, Math.max(-xLim, x));
      const cy = Math.min(yLim, Math.max(-yLim, y));
      const overlaps = game.balls.some(
        (other) =>
          other.id !== ballId &&
          !other.potted &&
          Math.hypot(cx - other.position.x, cy - other.position.y) < 2 * R,
      );
      if (overlaps) return;

      ball.position = { x: cx, y: cy };
      ball.velocity = { x: 0, y: 0 };
      ball.spin = { x: 0, y: 0, z: 0 };
      ball.potted = false; // dragged back onto the felt: rejoins play
      updateSnapshot();
    },
    [updateSnapshot],
  );

  const settleIntoTray = useCallback(
    (ballId: string) => {
      const game = gameRef.current;
      const ball = game.balls.find((b) => b.id === ballId);
      if (!ball) return;
      const table = PRESETS[variantRef.current].table;
      // Only balls already resting in the tray occupy a slot — one still
      // mid-shrink at its pocket hasn't been assigned one yet.
      const occupied = game.balls
        .filter((b) => b.id !== ballId && b.potted && b.position.x > table.width / 2)
        .map((b) => b.position);
      ball.position = nextFreeTraySlot(table, occupied);
      updateSnapshot();
    },
    [updateSnapshot],
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
    gameGeneration,
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
    placeBall,
    settleIntoTray,
    phaseRef,
    simSpeedRef,
    physicsRef,
    gameRef,
    advance,
  };
}
