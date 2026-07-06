/**
 * State container for the billiards page — a CLIENT of the
 * server-authoritative room (src/server/services/billiards).
 *
 * The client no longer integrates physics for the live game. Every input
 * (strike, reset, preset switch, coefficient change, pause/step, ball
 * placement) is sent to the server as a BilliardsCommand, and what the page
 * renders is the server's snapshots: applied from each command response, and
 * polled at a fixed cadence while a shot is in flight. The only physics the
 * client still runs is the strike *preview* (predictPaths on a clone), which
 * is a pure function of the last snapshot.
 *
 * Rendering between snapshots: the newest two snapshots form an
 * interpolation buffer, and `interpolatedBalls(now)` renders the game a
 * fixed delay behind the newest one (position lerp + orientation nlerp), so
 * ~12 Hz polling still looks like continuous 60 fps motion. While the room
 * is idle/paused the authoritative state is rendered directly — drags and
 * tray moves must feel immediate.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  GAME_PRESETS,
  placeBall as placeBallInState,
  settleBallIntoTray,
  type BilliardsGameState,
  type BilliardsVariant,
  type SimEvent,
} from '@shared/billiards/game-state';
import {
  cloneBalls,
  DEFAULT_PARAMS,
  type BallState,
  type PhysicsParams,
} from '@shared/billiards/physics';
import type { BilliardsCommand, BilliardsRoomSnapshot, RoomPhase } from '@shared/billiards/room';

import { billiardsApi } from '../api/endpoints';
import { DEFAULT_SHOT, toStrikeInput, type ShotSettings } from './config';

/** Poll cadence while a shot is in flight (the WebSocket push replaces this in a later step). */
const POLL_RUNNING_MS = 80;
/** Rendered time sits this far behind the newest snapshot so there is always something to interpolate toward. */
const INTERP_DELAY_MS = 170;
/** Trailing throttle for drag → placeBall commands. */
const PLACE_SYNC_MS = 120;
/** Debounce for slider → params / simSpeed commands. */
const TUNING_DEBOUNCE_MS = 250;

interface SnapshotFrame {
  balls: BallState[];
  atMs: number;
}

export interface BilliardsSim {
  variant: BilliardsVariant;
  setVariant: (variant: BilliardsVariant) => void;
  /** Server game generation — bumped on reset/variant so per-ball client animation state can be dropped. */
  gameGeneration: number;
  phase: RoomPhase;
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
  /** Freely repositions a resting ball (idle only) — applied locally at once, synced to the server throttled. */
  placeBall: (ballId: string, x: number, y: number) => void;
  /** Moves a just-captured ball to the pocketed-ball holding tray, at rest. */
  settleIntoTray: (ballId: string) => void;
  // Render-loop interface (stable refs; no React re-renders involved).
  /** Latest authoritative game state (drag checks, pot detection). */
  gameRef: RefObject<BilliardsGameState>;
  /** Smoothed ball states for this frame; falls back to the authoritative state while not running. */
  interpolatedBalls: (nowMs: number) => readonly BallState[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalized lerp between unit quaternions — shortest arc, good enough for one snapshot interval. */
function nlerpQuat(a: BallState['orientation'], b: BallState['orientation'], t: number) {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = lerp(a.x * sign, b.x, t);
  const y = lerp(a.y * sign, b.y, t);
  const z = lerp(a.z * sign, b.z, t);
  const w = lerp(a.w * sign, b.w, t);
  const n = Math.hypot(x, y, z, w) || 1;
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}

export function useBilliardsSim(): BilliardsSim {
  const [variant, setVariantState] = useState<BilliardsVariant>('carom');
  const [gameGeneration, setGameGeneration] = useState(0);
  const [phase, setPhaseState] = useState<RoomPhase>('idle');
  const [shot, setShot] = useState<ShotSettings>(DEFAULT_SHOT);
  const [physics, setPhysicsState] = useState<PhysicsParams>(DEFAULT_PARAMS);
  const [simSpeed, setSimSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState<BallState[]>(
    () => GAME_PRESETS.carom.createState().balls,
  );
  const [simTime, setSimTime] = useState(0);
  const [events, setEvents] = useState<SimEvent[]>([]);

  // Placeholder until the first server snapshot arrives (same initial rack).
  const gameRef = useRef<BilliardsGameState>(GAME_PRESETS.carom.createState());
  const variantRef = useRef<BilliardsVariant>('carom');
  const phaseRef = useRef<RoomPhase>('idle');
  const physicsRef = useRef(physics);
  const generationRef = useRef(0);
  const prevFrameRef = useRef<SnapshotFrame | null>(null);
  const currFrameRef = useRef<SnapshotFrame | null>(null);
  // While a slider edit is waiting to be sent, poll responses must not undo it.
  const paramsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simSpeedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlaceRef = useRef<BilliardsCommand | null>(null);

  const applySnapshot = useCallback((snap: BilliardsRoomSnapshot) => {
    const generationChanged = snap.generation !== generationRef.current;
    generationRef.current = snap.generation;
    gameRef.current = snap.game;
    variantRef.current = snap.variant;
    phaseRef.current = snap.phase;

    // Interpolation buffer: never tween across a re-rack.
    const now = performance.now();
    prevFrameRef.current = generationChanged ? null : currFrameRef.current;
    currFrameRef.current = { balls: snap.game.balls, atMs: now };

    setVariantState(snap.variant);
    setPhaseState(snap.phase);
    setGameGeneration(snap.generation);
    if (!paramsTimerRef.current) {
      physicsRef.current = snap.params;
      setPhysicsState(snap.params);
    }
    if (!simSpeedTimerRef.current) setSimSpeedState(snap.simSpeed);
    setSnapshot(cloneBalls(snap.game.balls));
    setSimTime(snap.game.simTime);
    setEvents(snap.game.events);
  }, []);

  const runCommand = useCallback(
    (command: BilliardsCommand) => {
      void billiardsApi
        .command(command)
        .then(applySnapshot)
        .catch((error: unknown) => {
          // Keep the lab usable: a lost command just leaves the last snapshot.
          console.error('billiards command failed', error);
        });
    },
    [applySnapshot],
  );

  // Initial snapshot on mount, then keep polling while a shot is in flight.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const snap = await billiardsApi.snapshot();
        if (!cancelled) applySnapshot(snap);
      } catch (error) {
        console.error('billiards snapshot failed', error);
      }
      if (!cancelled && phaseRef.current === 'running') {
        timer = setTimeout(() => void poll(), POLL_RUNNING_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `phase` re-arms the chain whenever a command flips the room's phase.
  }, [applySnapshot, phase]);

  const strikeCue = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    const cue = gameRef.current.balls.find(
      (b) => b.id === GAME_PRESETS[variantRef.current].cueBallId,
    );
    if (!cue || cue.potted) return; // must be dragged back onto the table first
    runCommand({ type: 'strike', shot: toStrikeInput(shot) });
  }, [shot, runCommand]);

  const reset = useCallback(() => runCommand({ type: 'reset' }), [runCommand]);

  const setVariant = useCallback(
    (next: BilliardsVariant) => runCommand({ type: 'variant', variant: next }),
    [runCommand],
  );

  const togglePause = useCallback(() => runCommand({ type: 'togglePause' }), [runCommand]);

  const stepOnce = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    runCommand({ type: 'stepOnce' });
  }, [runCommand]);

  // Coefficient sliders fire on every drag tick: reflect locally at once
  // (the prediction overlay reads `physics`), send debounced.
  const setPhysics = useCallback(
    (next: PhysicsParams) => {
      physicsRef.current = next;
      setPhysicsState(next);
      if (paramsTimerRef.current) clearTimeout(paramsTimerRef.current);
      paramsTimerRef.current = setTimeout(() => {
        paramsTimerRef.current = null;
        runCommand({ type: 'params', params: physicsRef.current });
      }, TUNING_DEBOUNCE_MS);
    },
    [runCommand],
  );

  const setSimSpeed = useCallback(
    (next: number) => {
      setSimSpeedState(next);
      if (simSpeedTimerRef.current) clearTimeout(simSpeedTimerRef.current);
      simSpeedTimerRef.current = setTimeout(() => {
        simSpeedTimerRef.current = null;
        runCommand({ type: 'simSpeed', simSpeed: next });
      }, TUNING_DEBOUNCE_MS);
    },
    [runCommand],
  );

  // Dragging fires many moves per second: apply each locally so the ball
  // tracks the pointer, and sync the newest position to the server on a
  // trailing throttle. The server runs the same placement rules, so both
  // sides converge on the final drop position. Command responses are not
  // applied here — they would rubber-band the ball mid-drag.
  const placeBall = useCallback((ballId: string, x: number, y: number) => {
    if (phaseRef.current !== 'idle') return;
    const table = GAME_PRESETS[variantRef.current].table;
    const changed = placeBallInState(gameRef.current, table, physicsRef.current, ballId, x, y);
    if (!changed) return;
    setSnapshot(cloneBalls(gameRef.current.balls));

    pendingPlaceRef.current = { type: 'placeBall', ballId, x, y };
    if (placeTimerRef.current) return;
    placeTimerRef.current = setTimeout(() => {
      placeTimerRef.current = null;
      const pending = pendingPlaceRef.current;
      pendingPlaceRef.current = null;
      if (pending) {
        billiardsApi.command(pending).catch((error: unknown) => {
          console.error('billiards placeBall sync failed', error);
        });
      }
    }, PLACE_SYNC_MS);
  }, []);

  const settleIntoTray = useCallback(
    (ballId: string) => {
      const table = GAME_PRESETS[variantRef.current].table;
      const changed = settleBallIntoTray(gameRef.current, table, ballId);
      if (!changed) return;
      setSnapshot(cloneBalls(gameRef.current.balls));
      runCommand({ type: 'settleIntoTray', ballId });
    },
    [runCommand],
  );

  const interpolatedBalls = useCallback((nowMs: number): readonly BallState[] => {
    if (phaseRef.current !== 'running') return gameRef.current.balls;
    const curr = currFrameRef.current;
    if (!curr) return gameRef.current.balls;
    const prev = prevFrameRef.current;
    if (!prev || curr.atMs <= prev.atMs) return curr.balls;

    const t = Math.min(
      1,
      Math.max(0, (nowMs - INTERP_DELAY_MS - prev.atMs) / (curr.atMs - prev.atMs)),
    );
    return curr.balls.map((ball) => {
      const before = prev.balls.find((b) => b.id === ball.id);
      if (!before || ball.potted || before.potted) return ball;
      return {
        ...ball,
        position: {
          x: lerp(before.position.x, ball.position.x, t),
          y: lerp(before.position.y, ball.position.y, t),
        },
        orientation: nlerpQuat(before.orientation, ball.orientation, t),
      };
    });
  }, []);

  // Flush/cancel timers on unmount.
  useEffect(() => {
    return () => {
      if (paramsTimerRef.current) clearTimeout(paramsTimerRef.current);
      if (simSpeedTimerRef.current) clearTimeout(simSpeedTimerRef.current);
      if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
    };
  }, []);

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
    gameRef,
    interpolatedBalls,
  };
}
