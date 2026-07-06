/**
 * Server-authoritative billiards room.
 *
 * This service OWNS the game: the serializable state, the physics
 * coefficients and the sim phase all live here, and physics steps run only
 * here. Clients never integrate — they send commands (validated at the
 * route) and render the snapshots this service hands back.
 *
 * While a shot is in flight the room drives itself with a wall-clock timer:
 * each tick feeds elapsed time into a fixed-step accumulator, so the
 * trajectory is the same deterministic SIM_DT sequence regardless of timer
 * jitter (the same scheme the client's render loop used before the
 * migration). When every ball is at rest the timer stops and the room goes
 * idle.
 *
 * `onUpdate` is the broadcast hook: it fires after every applied command and
 * on self-driven ticks (throttled to BROADCAST_MS, but always on the final
 * tick that puts the room to rest). The container wires it onto the pub/sub
 * bus, which the /ws bridge fans out to every subscribed client — across
 * instances with the redis driver.
 */
import {
  advanceGameState,
  GAME_PRESETS,
  placeBall,
  settleBallIntoTray,
  strikeBall,
  type BilliardsGameState,
  type BilliardsVariant,
} from '@shared/billiards/game-state';
import { DEFAULT_PARAMS, isAtRest, SIM_DT, type PhysicsParams } from '@shared/billiards/physics';
import type { BilliardsCommand, BilliardsRoomSnapshot, RoomPhase } from '@shared/billiards/room';

/** Self-drive timer period (ms) while a shot is in flight. */
const TICK_MS = 20;
/** Cap on how much wall clock one tick may consume (timer stalls, debugger). */
const MAX_TICK_ELAPSED_MS = 250;
/** Minimum spacing of self-driven broadcasts (the final at-rest one always goes out). */
const BROADCAST_MS = 40;
/** One UI "step" while paused: 1/60 s of simulation. */
const PAUSE_STEP_STEPS = Math.round(1 / 60 / SIM_DT);

export interface BilliardsRoomDeps {
  /** Called after every applied command and (throttled) after self-driven ticks. */
  onUpdate?: (snapshot: BilliardsRoomSnapshot) => void;
}

export class BilliardsRoomService {
  private variant: BilliardsVariant = 'carom';
  private game: BilliardsGameState = GAME_PRESETS.carom.createState();
  private phase: RoomPhase = 'idle';
  private params: PhysicsParams = DEFAULT_PARAMS;
  private simSpeed = 1;
  private generation = 0;
  private accumulatorS = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;

  constructor(private readonly deps: BilliardsRoomDeps = {}) {}

  /** A detached copy — callers can hold or serialize it freely. */
  snapshot(): BilliardsRoomSnapshot {
    return structuredClone({
      variant: this.variant,
      phase: this.phase,
      generation: this.generation,
      simSpeed: this.simSpeed,
      params: this.params,
      game: this.game,
    });
  }

  /**
   * Applies one client command and returns the resulting snapshot. Commands
   * that are illegal in the current phase (strike while running, placeBall
   * while running, …) are no-ops — the caller still gets the authoritative
   * state back.
   */
  command(command: BilliardsCommand): BilliardsRoomSnapshot {
    switch (command.type) {
      case 'strike':
        this.strike(command.shot);
        break;
      case 'reset':
        this.replaceGame(this.variant);
        break;
      case 'variant':
        this.replaceGame(command.variant);
        break;
      case 'params':
        this.params = command.params;
        break;
      case 'simSpeed':
        this.simSpeed = command.simSpeed;
        break;
      case 'togglePause':
        this.togglePause();
        break;
      case 'stepOnce':
        if (this.phase === 'paused') this.advance(PAUSE_STEP_STEPS);
        break;
      case 'placeBall':
        if (this.phase === 'idle') {
          placeBall(this.game, this.table, this.params, command.ballId, command.x, command.y);
        }
        break;
      case 'settleIntoTray':
        settleBallIntoTray(this.game, this.table, command.ballId);
        break;
    }
    const snapshot = this.snapshot();
    // Broadcast command results too: other clients must see strikes, resets
    // and drags, not only the self-driven ticks in between.
    this.deps.onUpdate?.(snapshot);
    return snapshot;
  }

  /**
   * Advances the room by `elapsedMs` of wall clock (clamped) through the
   * fixed-step accumulator. Public so tests can drive time explicitly; the
   * internal timer calls this with real elapsed time.
   */
  tick(elapsedMs: number): void {
    if (this.phase !== 'running') return;
    this.accumulatorS += (Math.min(elapsedMs, MAX_TICK_ELAPSED_MS) / 1000) * this.simSpeed;
    const steps = Math.floor(this.accumulatorS / SIM_DT);
    if (steps > 0) {
      this.accumulatorS -= steps * SIM_DT;
      this.advance(steps);
    }
  }

  /** Stops the self-drive timer; the room can be resumed by a new command. */
  dispose(): void {
    this.stopLoop();
  }

  private get table() {
    return GAME_PRESETS[this.variant].table;
  }

  private strike(shot: Parameters<typeof strikeBall>[2]): void {
    if (this.phase !== 'idle') return;
    const cue = this.game.balls.find((b) => b.id === GAME_PRESETS[this.variant].cueBallId);
    if (!cue || cue.potted) return; // must be placed back onto the table first
    strikeBall(this.game, cue.id, shot);
    this.phase = 'running';
    this.startLoop();
  }

  private replaceGame(variant: BilliardsVariant): void {
    this.stopLoop();
    this.variant = variant;
    this.game = GAME_PRESETS[variant].createState();
    this.phase = 'idle';
    this.generation += 1;
    this.accumulatorS = 0;
  }

  private togglePause(): void {
    if (this.phase === 'running') {
      this.stopLoop();
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = 'running';
      this.startLoop();
    }
  }

  private advance(steps: number): void {
    advanceGameState(this.game, this.table, this.params, steps);
    if (this.phase !== 'idle' && isAtRest(this.game.balls, this.params)) {
      this.stopLoop();
      this.phase = 'idle';
      this.accumulatorS = 0;
    }
  }

  private startLoop(): void {
    if (this.timer) return;
    this.lastTickMs = Date.now();
    let lastBroadcastMs = 0;
    this.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastTickMs;
      this.lastTickMs = now;
      this.tick(elapsed);
      // Throttle the stream, but never swallow the final at-rest snapshot.
      if (this.phase !== 'running' || now - lastBroadcastMs >= BROADCAST_MS) {
        lastBroadcastMs = now;
        this.deps.onUpdate?.(this.snapshot());
      }
    }, TICK_MS);
    // Never keep the process alive just for a rolling ball.
    this.timer.unref?.();
  }

  private stopLoop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
