/**
 * State container for the billiards page — a CLIENT of the
 * server-authoritative room (src/server/services/billiards).
 *
 * Inputs still go to the server as BilliardsCommands, but the rolling balls
 * are no longer streamed back: the engine is deterministic, so this client
 * REPLAYS the shot locally. A shot needs exactly two broadcasts from the
 * server — the strike echo (initial conditions: velocities/spins just set)
 * and the at-rest snapshot (authoritative final positions + turn flip).
 * Between the two, `renderBalls(now)` advances the same fixed-step engine at
 * full 600 Hz on this machine, which is what makes the motion perfectly
 * smooth and latency-free after the start.
 *
 * Reconciliation rules for arriving snapshots (command echoes, /ws pushes,
 * the watchdog poll):
 *  - running snapshot at/behind our local replay clock → adopt it and
 *    fast-forward to the local clock (deterministic, so this is seamless);
 *    this is how mid-shot mutations (params change, tray settling) rebase
 *    the replay without a visual jump.
 *  - running snapshot ahead of our clock (its command was applied at server
 *    time) → adopt as-is; the forward skip is bounded by one network
 *    latency and only happens when a mid-shot command occurred.
 *  - at-rest snapshot while our replay is still rolling → held as "pending
 *    final" and adopted the moment the local replay rests, so the tail of
 *    the shot isn't cut off; engines differ by ~1e-15 m, so the correcting
 *    snap is invisible. If the replay has fallen far behind (hidden tab),
 *    it is adopted immediately instead.
 *
 * The strike *preview* (predictPaths) also stays client-side — like the
 * replay, it is a pure function of the last snapshot.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  advanceGameState,
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
  isAtRest,
  SIM_DT,
  type BallState,
  type PhysicsParams,
} from '@shared/billiards/physics';
import type {
  BilliardsCommand,
  BilliardsLiveMessage,
  BilliardsPlayer,
  BilliardsRoomSnapshot,
  PlayerSeat,
  RoomPhase,
  WsSubscription,
} from '@shared/billiards/room';

import { billiardsApi } from '../api/endpoints';
import { DEFAULT_SHOT, toStrikeInput, type ShotSettings } from './config';

/** Watchdog poll while a shot is in flight and the WebSocket is down. */
const POLL_RUNNING_MS = 250;
/** Watchdog poll while the socket is healthy — belt and braces only. */
const POLL_FALLBACK_MS = 1500;
/** Reconnect delay after the WebSocket drops. */
const WS_RETRY_MS = 2000;
/** After a local drag move, ignore pushed snapshots this long (own echoes). */
const PLACE_ECHO_SUPPRESS_MS = 400;
/** Cap on one render frame's worth of replay (background tab throttling). */
const MAX_FRAME_DELTA_S = 0.25;
/** If the local replay lags the final snapshot by more than this, snap to it. */
const REPLAY_MAX_LAG_S = 1;
/** Trailing throttle for drag → placeBall commands. */
const PLACE_SYNC_MS = 120;
/** Debounce for slider → params / simSpeed commands. */
const TUNING_DEBOUNCE_MS = 250;

/**
 * This tab's player identity. sessionStorage is per-tab, so two tabs of the
 * same browser are two distinct players — which is exactly how a 2-player
 * match is meant to be driven (and tested) locally.
 */
function getPlayerId(): string {
  const KEY = 'billiards.playerId';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
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
  // 2-player match state (turn enforcement is active only with both seats taken).
  players: BilliardsPlayer[];
  /** This tab's seat, or null while spectating / seats not yet assigned. */
  mySeat: PlayerSeat | null;
  activeSeat: PlayerSeat;
  /** Both seats taken — the server enforces turns. */
  matchActive: boolean;
  /** False only while a match is active and it is the other player's turn. */
  isMyTurn: boolean;
  // Render-loop interface (stable refs; no React re-renders involved).
  /** Latest local game state (drag checks, pot detection). */
  gameRef: RefObject<BilliardsGameState>;
  /**
   * The balls to draw this frame. While a shot is in flight this ADVANCES
   * the local deterministic replay by the elapsed wall clock, so it must be
   * called exactly once per rendered frame.
   */
  renderBalls: (nowMs: number) => readonly BallState[];
}

function isBilliardsLiveMessage(value: unknown): value is BilliardsLiveMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'channel' in value &&
    value.channel === 'billiards' &&
    'snapshot' in value &&
    typeof value.snapshot === 'object'
  );
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
  const [players, setPlayers] = useState<BilliardsPlayer[]>([]);
  const [activeSeat, setActiveSeat] = useState<PlayerSeat>(1);
  const [playerId] = useState(getPlayerId);

  // Placeholder until the first server snapshot arrives (same initial rack).
  const gameRef = useRef<BilliardsGameState>(GAME_PRESETS.carom.createState());
  const variantRef = useRef<BilliardsVariant>('carom');
  const phaseRef = useRef<RoomPhase>('idle');
  const physicsRef = useRef(physics);
  const generationRef = useRef(0);
  // Local replay bookkeeping. The replay must run with the coefficients the
  // SERVER used for this shot (replayParamsRef), not with unsent local
  // slider edits (physicsRef) — those only apply once the server echoes them.
  const replayParamsRef = useRef<PhysicsParams>(DEFAULT_PARAMS);
  const replaySimSpeedRef = useRef(1);
  const replayAccumulatorRef = useRef(0);
  const replayClockMsRef = useRef<number | null>(null);
  const pendingFinalRef = useRef<BilliardsRoomSnapshot | null>(null);
  // While a slider edit is waiting to be sent, snapshots must not undo it.
  const paramsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simSpeedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlaceRef = useRef<BilliardsCommand | null>(null);
  const wsConnectedRef = useRef(false);
  const lastLocalPlaceMsRef = useRef(-Infinity);
  const playersRef = useRef<BilliardsPlayer[]>([]);
  const activeSeatRef = useRef<PlayerSeat>(1);

  /** Unconditionally makes `snap` the local truth (with the rebase rule). */
  const adoptSnapshot = useCallback((snap: BilliardsRoomSnapshot) => {
    const generationChanged = snap.generation !== generationRef.current;
    const localSimTime = gameRef.current.simTime;

    pendingFinalRef.current = null;
    generationRef.current = snap.generation;
    gameRef.current = snap.game;
    variantRef.current = snap.variant;
    phaseRef.current = snap.phase;
    replayParamsRef.current = snap.params;
    replaySimSpeedRef.current = snap.simSpeed;
    replayAccumulatorRef.current = 0;

    // Rebase: a running snapshot behind our replay clock (params change,
    // tray settle, watchdog poll response) is fast-forwarded to the local
    // clock — deterministic, so the rendered balls don't move.
    if (!generationChanged && snap.phase === 'running' && localSimTime > snap.game.simTime) {
      advanceGameState(
        gameRef.current,
        GAME_PRESETS[snap.variant].table,
        snap.params,
        Math.round((localSimTime - snap.game.simTime) / SIM_DT),
      );
    }

    setVariantState(snap.variant);
    setPhaseState(snap.phase);
    setGameGeneration(snap.generation);
    if (!paramsTimerRef.current) {
      physicsRef.current = snap.params;
      setPhysicsState(snap.params);
    }
    if (!simSpeedTimerRef.current) setSimSpeedState(snap.simSpeed);
    setSnapshot(cloneBalls(gameRef.current.balls));
    setSimTime(gameRef.current.simTime);
    setEvents(gameRef.current.events);
    playersRef.current = snap.players;
    activeSeatRef.current = snap.activeSeat;
    setPlayers(snap.players);
    setActiveSeat(snap.activeSeat);
  }, []);

  const applySnapshot = useCallback(
    (snap: BilliardsRoomSnapshot, options: { fromWatchdog?: boolean } = {}) => {
      const generationChanged = snap.generation !== generationRef.current;
      const localSimTime = gameRef.current.simTime;

      // The shot-ended snapshot is what we are waiting for while locally
      // running — it must NEVER be dropped as stale (batch granularity can
      // leave the local clock slightly past the server's rest time). Hold it
      // only while the tail of the shot is still playing out ahead of us;
      // adopt it at once when the local replay already rests, has passed the
      // final's clock, or has fallen far behind (throttled background tab).
      if (!generationChanged && phaseRef.current === 'running' && snap.phase === 'idle') {
        const stillRolling = !isAtRest(gameRef.current.balls, replayParamsRef.current);
        const finalIsAhead = snap.game.simTime > localSimTime;
        if (stillRolling && finalIsAhead && snap.game.simTime - localSimTime <= REPLAY_MAX_LAG_S) {
          pendingFinalRef.current = snap;
          return;
        }
        adoptSnapshot(snap);
        return;
      }

      // Out-of-order idle/paused frames (poll racing WS) are stale — drop
      // them. Running frames behind our clock are fine: adopt + fast-forward.
      if (!generationChanged && snap.phase !== 'running' && snap.game.simTime < localSimTime) {
        return;
      }

      // Watchdog polls carry no command we don't already know about, so a
      // running frame slightly AHEAD of our replay (the server always leads
      // by one network latency) must not be adopted — that would skip the
      // replay forward every poll. Only catch up when we fell far behind
      // (throttled background tab).
      if (
        options.fromWatchdog &&
        !generationChanged &&
        snap.phase === 'running' &&
        phaseRef.current === 'running' &&
        snap.game.simTime > localSimTime &&
        snap.game.simTime - localSimTime < REPLAY_MAX_LAG_S
      ) {
        return;
      }

      adoptSnapshot(snap);
    },
    [adoptSnapshot],
  );

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

  // Initial snapshot on mount, plus a watchdog poll while a shot is in
  // flight: rendering never depends on it (the replay is local), it only
  // guarantees the final state / turn flip land even if the socket is down.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const snap = await billiardsApi.snapshot();
        if (!cancelled) applySnapshot(snap, { fromWatchdog: true });
      } catch (error) {
        console.error('billiards snapshot failed', error);
      }
      if (!cancelled && phaseRef.current === 'running') {
        timer = setTimeout(
          () => void poll(),
          wsConnectedRef.current ? POLL_FALLBACK_MS : POLL_RUNNING_MS,
        );
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `phase` re-arms the chain whenever a command flips the room's phase.
  }, [applySnapshot, phase]);

  // Live feed: the server pushes room updates over /ws (fan-out crosses
  // instances via pub/sub). For a shot that is exactly two frames — the
  // strike echo that starts our local replay and the authoritative at-rest
  // state. Reconnects with a fixed backoff while mounted.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unmounted = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socket.onopen = () => {
        wsConnectedRef.current = true;
        const subscribe: WsSubscription = { type: 'subscribe', channel: 'billiards' };
        socket?.send(JSON.stringify(subscribe));
      };
      socket.onmessage = (event) => {
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!isBilliardsLiveMessage(message)) return;
        // Our own drag echoes arrive slightly stale; local state is ahead.
        if (performance.now() - lastLocalPlaceMsRef.current < PLACE_ECHO_SUPPRESS_MS) return;
        applySnapshot(message.snapshot);
      };
      socket.onclose = () => {
        wsConnectedRef.current = false;
        if (!unmounted) retryTimer = setTimeout(connect, WS_RETRY_MS);
      };
    };

    connect();
    return () => {
      unmounted = true;
      wsConnectedRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [applySnapshot]);

  // Take a seat as soon as the page is up (idempotent server-side), and give
  // it up when the tab goes away. `keepalive` lets the leave outlive the
  // page; SPA navigation keeps the seat — the identity survives per tab.
  useEffect(() => {
    runCommand({ type: 'join', playerId });
    const onPageHide = () => {
      void fetch('/api/billiards', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'leave', playerId } satisfies BilliardsCommand),
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [playerId, runCommand]);

  // Refresh the readouts (speeds, sim clock) from the local replay at a low
  // frequency while a shot is in flight.
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      setSnapshot(cloneBalls(gameRef.current.balls));
      setSimTime(gameRef.current.simTime);
    }, 150);
    return () => clearInterval(timer);
  }, [phase]);

  const strikeCue = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    if (playersRef.current.length === 2) {
      const me = playersRef.current.find((p) => p.playerId === playerId);
      if (me?.seat !== activeSeatRef.current) return; // not our turn (server would 403 anyway)
    }
    const cue = gameRef.current.balls.find(
      (b) => b.id === GAME_PRESETS[variantRef.current].cueBallId,
    );
    if (!cue || cue.potted) return; // must be dragged back onto the table first
    runCommand({ type: 'strike', shot: toStrikeInput(shot), playerId });
  }, [shot, runCommand, playerId]);

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
  // (the prediction overlay reads `physics`), send debounced. The live
  // replay keeps the server's coefficients until the echo comes back.
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
    lastLocalPlaceMsRef.current = performance.now();
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

  const renderBalls = useCallback(
    (nowMs: number): readonly BallState[] => {
      const last = replayClockMsRef.current;
      replayClockMsRef.current = nowMs;

      if (phaseRef.current === 'running' && last !== null) {
        const game = gameRef.current;
        if (isAtRest(game.balls, replayParamsRef.current)) {
          // Local replay finished: freeze the clock and reconcile with the
          // server's final state (the correction is ~1e-15 m — invisible).
          // Until it arrives, hold; the /ws push or watchdog poll delivers it.
          const final = pendingFinalRef.current;
          if (final) adoptSnapshot(final);
        } else {
          const deltaS = Math.min((nowMs - last) / 1000, MAX_FRAME_DELTA_S);
          replayAccumulatorRef.current += deltaS * replaySimSpeedRef.current;
          const steps = Math.floor(replayAccumulatorRef.current / SIM_DT);
          if (steps > 0) {
            replayAccumulatorRef.current -= steps * SIM_DT;
            const table = GAME_PRESETS[variantRef.current].table;
            const logged = advanceGameState(game, table, replayParamsRef.current, steps);
            if (logged.length > 0) setEvents([...game.events]);
          }
        }
      }
      return gameRef.current.balls;
    },
    [adoptSnapshot],
  );

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
    players,
    mySeat: players.find((p) => p.playerId === playerId)?.seat ?? null,
    activeSeat,
    matchActive: players.length === 2,
    isMyTurn:
      players.length < 2 || players.find((p) => p.playerId === playerId)?.seat === activeSeat,
    gameRef,
    renderBalls,
  };
}
