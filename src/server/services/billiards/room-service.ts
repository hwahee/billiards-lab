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
 * `onUpdate` is the broadcast hook, and it deliberately does NOT stream the
 * rolling balls. Because the engine is deterministic, a client that receives
 * the post-strike snapshot can replay the identical trajectory locally, so a
 * shot needs exactly two broadcasts: the command echo that starts it
 * (phase `running`, velocities set) and the at-rest snapshot when the room
 * settles (authoritative final positions + the turn flip). Every other
 * applied command still echoes a snapshot — mid-shot mutations (params,
 * pause/step, tray settling) rebase the clients' local replays. The
 * container wires the hook onto the pub/sub bus, which the /ws bridge fans
 * out to every subscribed client — across instances with the redis driver.
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
import type {
  BilliardsCommand,
  BilliardsPlayer,
  BilliardsRoomSnapshot,
  PlayerSeat,
  RoomPhase,
} from '@shared/billiards/room';

import { ForbiddenError } from '../../lib/errors';

/** Self-drive timer period (ms) while a shot is in flight. */
const TICK_MS = 20;
/** Cap on how much wall clock one tick may consume (timer stalls, debugger). */
const MAX_TICK_ELAPSED_MS = 250;
/** One UI "step" while paused: 1/60 s of simulation. */
const PAUSE_STEP_STEPS = Math.round(1 / 60 / SIM_DT);

export interface BilliardsRoomDeps {
  /** Called after every applied command and once when a shot comes to rest. */
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
  private players: BilliardsPlayer[] = [];
  private activeSeat: PlayerSeat = 1;

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
      players: this.players,
      activeSeat: this.activeSeat,
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
        this.strike(command.shot, command.playerId);
        break;
      case 'join':
        this.join(command.playerId);
        break;
      case 'leave':
        this.players = this.players.filter((p) => p.playerId !== command.playerId);
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

  /** Turn enforcement is active only while both seats are taken. */
  private get matchActive(): boolean {
    return this.players.length === 2;
  }

  private join(playerId: string): void {
    if (this.players.some((p) => p.playerId === playerId)) return; // already seated
    const taken = new Set(this.players.map((p) => p.seat));
    const seat: PlayerSeat | null = !taken.has(1) ? 1 : !taken.has(2) ? 2 : null;
    if (seat !== null) this.players.push({ playerId, seat });
    // Both seats full: the caller simply stays a spectator.
  }

  private strike(
    shot: Extract<BilliardsCommand, { type: 'strike' }>['shot'],
    playerId?: string,
  ): void {
    if (this.matchActive) {
      const player = this.players.find((p) => p.playerId === playerId);
      if (player?.seat !== this.activeSeat) {
        throw new ForbiddenError('not this player’s turn');
      }
    }
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
    // Fresh rack, fresh turn cycle (seated players stay seated).
    this.activeSeat = 1;
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
      // Turn ends when every ball has come to rest.
      if (this.matchActive) this.activeSeat = this.activeSeat === 1 ? 2 : 1;
      // The shot-ended broadcast: authoritative final state + the turn flip.
      this.deps.onUpdate?.(this.snapshot());
    }
  }

  private startLoop(): void {
    if (this.timer) return;
    this.lastTickMs = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastTickMs;
      this.lastTickMs = now;
      // No per-tick broadcasts: clients replay the deterministic trajectory
      // locally; advance() emits the single at-rest snapshot when it ends.
      this.tick(elapsed);
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
