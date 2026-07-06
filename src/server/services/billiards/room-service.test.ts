import { describe, expect, test } from 'bun:test';

import { DEFAULT_PARAMS, SIM_DT } from '@shared/billiards/physics';
import type { BilliardsCommand } from '@shared/billiards/room';

import { BilliardsRoomService } from './room-service';

const STRIKE: BilliardsCommand = {
  type: 'strike',
  shot: { speed: 1.5, directionRad: 0.3, topspin: 30, sidespin: -20 },
};

/**
 * Creates a room and immediately detaches its self-drive timer so tests can
 * feed wall-clock time deterministically through `tick()`.
 */
function room(): BilliardsRoomService {
  return new BilliardsRoomService();
}

function strikeManually(service: BilliardsRoomService): void {
  service.command(STRIKE);
  service.dispose(); // stop the real timer; tests drive tick() themselves
}

describe('phases', () => {
  test('starts idle with the carom rack', () => {
    const service = room();
    const snap = service.snapshot();
    expect(snap.phase).toBe('idle');
    expect(snap.variant).toBe('carom');
    expect(snap.generation).toBe(0);
    expect(snap.game.balls).toHaveLength(4);
    expect(snap.game.simTime).toBe(0);
  });

  test('strike sets the room running and ticking advances the sim clock', () => {
    const service = room();
    strikeManually(service);
    expect(service.snapshot().phase).toBe('running');
    service.tick(100);
    const snap = service.snapshot();
    expect(snap.game.simTime).toBeGreaterThan(0.09);
    expect(snap.game.simTime).toBeLessThan(0.11);
  });

  test('a second strike while running is a no-op', () => {
    const service = room();
    strikeManually(service);
    service.tick(50);
    const before = service.snapshot();
    const after = service.command({
      type: 'strike',
      shot: { speed: 8, directionRad: 2, topspin: 400, sidespin: 400 },
    });
    expect(after).toEqual(before);
  });

  test('the room settles back to idle once every ball rests', () => {
    const service = room();
    strikeManually(service);
    for (let i = 0; i < 60_000 / 250 && service.snapshot().phase === 'running'; i += 1) {
      service.tick(250);
    }
    const snap = service.snapshot();
    expect(snap.phase).toBe('idle');
    expect(snap.game.simTime).toBeGreaterThan(1);
  });

  test('togglePause freezes the clock; stepOnce advances exactly 1/60 s', () => {
    const service = room();
    strikeManually(service);
    service.tick(100);
    service.command({ type: 'togglePause' });
    const paused = service.snapshot();
    expect(paused.phase).toBe('paused');
    service.tick(1000); // wall clock passes, nothing may move
    expect(service.snapshot()).toEqual(paused);

    service.command({ type: 'stepOnce' });
    const stepped = service.snapshot();
    expect(stepped.game.simTime).toBeCloseTo(
      paused.game.simTime + Math.round(1 / 60 / SIM_DT) * SIM_DT,
      9,
    );

    service.command({ type: 'togglePause' });
    expect(service.snapshot().phase).toBe('running');
    service.dispose();
  });
});

describe('game management', () => {
  test('reset re-racks the same variant and bumps the generation', () => {
    const service = room();
    const initial = service.snapshot();
    strikeManually(service);
    service.tick(250);
    const snap = service.command({ type: 'reset' });
    expect(snap.phase).toBe('idle');
    expect(snap.generation).toBe(initial.generation + 1);
    expect(snap.game.simTime).toBe(0);
    expect(snap.game.balls).toEqual(initial.game.balls);
  });

  test('variant switch racks the pool preset', () => {
    const service = room();
    const snap = service.command({ type: 'variant', variant: 'pool' });
    expect(snap.variant).toBe('pool');
    expect(snap.game.balls).toHaveLength(16);
    expect(snap.generation).toBe(1);
    expect(snap.game.balls.some((b) => b.id === 'cue')).toBe(true);
  });

  test('params and simSpeed apply live', () => {
    const service = room();
    const params = { ...DEFAULT_PARAMS, slidingFriction: 0.42 };
    expect(service.command({ type: 'params', params }).params.slidingFriction).toBe(0.42);
    expect(service.command({ type: 'simSpeed', simSpeed: 2.5 }).simSpeed).toBe(2.5);
    // Higher simSpeed consumes more sim time per wall-clock tick.
    strikeManually(service);
    service.tick(100);
    expect(service.snapshot().game.simTime).toBeGreaterThan(0.2);
  });
});

describe('ball placement', () => {
  test('placeBall moves a resting ball while idle and is ignored while running', () => {
    const service = room();
    const moved = service.command({ type: 'placeBall', ballId: 'white', x: 0.3, y: 0.2 });
    const white = moved.game.balls.find((b) => b.id === 'white')!;
    expect(white.position).toEqual({ x: 0.3, y: 0.2 });

    strikeManually(service);
    const during = service.command({ type: 'placeBall', ballId: 'yellow', x: 0, y: 0 });
    const yellow = during.game.balls.find((b) => b.id === 'yellow')!;
    expect(yellow.position).not.toEqual({ x: 0, y: 0 });
  });

  test('settleIntoTray is a no-op for a ball that is not potted', () => {
    const service = room();
    const before = service.snapshot();
    const after = service.command({ type: 'settleIntoTray', ballId: 'white' });
    expect(after.game.balls).toEqual(before.game.balls);
  });
});

describe('update broadcasts', () => {
  test('every applied command emits one snapshot through onUpdate', () => {
    const updates: number[] = [];
    const service = new BilliardsRoomService({
      onUpdate: (snapshot) => updates.push(snapshot.generation),
    });
    service.command({ type: 'reset' });
    service.command({ type: 'variant', variant: 'pool' });
    expect(updates).toEqual([1, 2]);
    service.dispose();
  });

  test('a running shot streams snapshots and ends with the at-rest state', async () => {
    const phases: string[] = [];
    const service = new BilliardsRoomService({
      onUpdate: (snapshot) => phases.push(snapshot.phase),
    });
    service.command(STRIKE);
    await Bun.sleep(150);
    service.dispose();
    // The command echo plus several self-driven ticks, all still running.
    expect(phases.length).toBeGreaterThan(2);
    expect(phases[0]).toBe('running');
  });
});
