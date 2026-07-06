import { describe, expect, test } from 'bun:test';

import {
  advanceGameState,
  createInitialGameState,
  createPoolGameState,
  placeBall,
  settleBallIntoTray,
  strikeBall,
  type BilliardsGameState,
} from './game-state';
import { CAROM_TABLE, DEFAULT_PARAMS, isAtRest, POOL_TABLE, SIM_DT, stepPhysics } from './physics';

function roundTrip(state: BilliardsGameState): BilliardsGameState {
  return JSON.parse(JSON.stringify(state)) as BilliardsGameState;
}

describe('initial state', () => {
  test('starts with four resting balls, zero clock, empty log', () => {
    const state = createInitialGameState();
    expect(state.balls.map((b) => b.id)).toEqual(['white', 'yellow', 'redA', 'redB']);
    expect(state.simTime).toBe(0);
    expect(state.events).toEqual([]);
    expect(state.lastEvent).toBeNull();
    for (const ball of state.balls) {
      expect(ball.velocity).toEqual({ x: 0, y: 0 });
      expect(ball.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });
});

describe('pool rack', () => {
  test('racks the cue ball plus all 15 numbered balls exactly once, all at rest', () => {
    const state = createPoolGameState();
    expect(state.balls.map((b) => b.id).sort()).toEqual(
      ['cue', ...Array.from({ length: 15 }, (_, i) => String(i + 1))].sort(),
    );
    for (const ball of state.balls) {
      expect(ball.velocity).toEqual({ x: 0, y: 0 });
      expect(ball.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });

  test('the 8-ball sits at the centre of the rack and no two balls overlap', () => {
    const state = createPoolGameState();
    const eight = state.balls.find((b) => b.id === '8')!;
    const cue = state.balls.find((b) => b.id === 'cue')!;
    expect(eight.position.y).toBeCloseTo(0, 9);
    expect(eight.position.x).toBeGreaterThan(cue.position.x);

    const R = DEFAULT_PARAMS.ballRadius;
    const objectBalls = state.balls.filter((b) => b.id !== 'cue');
    for (let i = 0; i < objectBalls.length; i += 1) {
      for (let j = i + 1; j < objectBalls.length; j += 1) {
        const a = objectBalls[i]!.position;
        const b = objectBalls[j]!.position;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * R - 1e-9);
      }
    }
  });

  test('the racked layout is a stable rest state (a lone strike-free step changes nothing)', () => {
    const state = createPoolGameState();
    const before = JSON.parse(JSON.stringify(state.balls)) as typeof state.balls;
    stepPhysics(state.balls, POOL_TABLE, DEFAULT_PARAMS, SIM_DT);
    expect(isAtRest(state.balls, DEFAULT_PARAMS)).toBe(true);
    expect(state.balls).toEqual(before);
  });
});

describe('serialization', () => {
  test('JSON round-trip preserves the state exactly', () => {
    const state = createInitialGameState();
    strikeBall(state, 'white', { speed: 3, directionRad: 0.2, topspin: 40, sidespin: -25 });
    advanceGameState(state, CAROM_TABLE, DEFAULT_PARAMS, 1200);
    expect(roundTrip(state)).toEqual(state);
  });

  test('a deserialized state continues the simulation bit-identically', () => {
    const original = createInitialGameState();
    strikeBall(original, 'white', {
      speed: 3,
      directionRad: 0.2,
      lateralSpeed: 0.3,
      topspin: 40,
      sidespin: -25,
      rollspin: 30,
    });
    advanceGameState(original, CAROM_TABLE, DEFAULT_PARAMS, 900);

    const restored = roundTrip(original);
    advanceGameState(original, CAROM_TABLE, DEFAULT_PARAMS, 2400);
    advanceGameState(restored, CAROM_TABLE, DEFAULT_PARAMS, 2400);
    expect(restored).toEqual(original);
  });
});

describe('strikeBall', () => {
  test('rejects unknown ball ids', () => {
    const state = createInitialGameState();
    expect(() =>
      strikeBall(state, 'black', { speed: 1, directionRad: 0, topspin: 0, sidespin: 0 }),
    ).toThrow('unknown ball id');
  });
});

describe('collision log', () => {
  test('advance returns newly logged events and appends them to the log', () => {
    const state = createInitialGameState();
    strikeBall(state, 'white', { speed: 3, directionRad: 0, topspin: 0, sidespin: 0 });
    const logged: ReturnType<typeof advanceGameState> = [];
    for (let i = 0; i < 10; i += 1) {
      logged.push(...advanceGameState(state, CAROM_TABLE, DEFAULT_PARAMS, 600));
    }
    expect(logged.length).toBeGreaterThan(0);
    expect(state.events).toEqual(logged.slice(-24));
    expect(logged.some((e) => e.event.type === 'ball')).toBe(true);
    expect(logged.some((e) => e.event.type === 'cushion')).toBe(true);
  });

  test('repeated contacts within the dedupe window collapse into one entry', () => {
    const state = createInitialGameState();
    strikeBall(state, 'white', { speed: 2, directionRad: 0, topspin: 0, sidespin: 0 });
    advanceGameState(state, CAROM_TABLE, DEFAULT_PARAMS, Math.round(20 / SIM_DT));
    // No two adjacent log entries share a signature within the window.
    for (let i = 1; i < state.events.length; i += 1) {
      const a = state.events[i - 1]!;
      const b = state.events[i]!;
      const sig = (e: typeof a) =>
        e.event.type === 'ball'
          ? `ball:${e.event.ballId}:${e.event.otherId}`
          : `cushion:${e.event.ballId}`;
      if (sig(a) === sig(b)) {
        expect(b.time - a.time).toBeGreaterThanOrEqual(0.08);
      }
    }
  });
});

describe('placeBall', () => {
  test('moves a resting ball, clamped inside the rails', () => {
    const state = createInitialGameState();
    expect(placeBall(state, CAROM_TABLE, DEFAULT_PARAMS, 'white', 99, -99)).toBe(true);
    const white = state.balls.find((b) => b.id === 'white')!;
    const R = DEFAULT_PARAMS.ballRadius;
    expect(white.position.x).toBeCloseTo(CAROM_TABLE.width / 2 - R, 9);
    expect(white.position.y).toBeCloseTo(-(CAROM_TABLE.height / 2 - R), 9);
  });

  test('rejects a drop that would overlap another ball', () => {
    const state = createInitialGameState();
    const yellow = state.balls.find((b) => b.id === 'yellow')!;
    const before = { ...state.balls.find((b) => b.id === 'white')!.position };
    const applied = placeBall(
      state,
      CAROM_TABLE,
      DEFAULT_PARAMS,
      'white',
      yellow.position.x,
      yellow.position.y,
    );
    expect(applied).toBe(false);
    expect(state.balls.find((b) => b.id === 'white')!.position).toEqual(before);
  });

  test('a potted ball dropped back onto the felt rejoins play', () => {
    const state = createPoolGameState();
    const cue = state.balls.find((b) => b.id === 'cue')!;
    cue.potted = true;
    cue.position = { x: POOL_TABLE.width / 2 + 0.2, y: 0 }; // resting in the tray
    expect(placeBall(state, POOL_TABLE, DEFAULT_PARAMS, 'cue', -0.9, 0.4)).toBe(true);
    expect(cue.potted).toBe(false);
    expect(cue.position).toEqual({ x: -0.9, y: 0.4 });
  });
});

describe('settleBallIntoTray', () => {
  test('parks potted balls in distinct tray slots past the rail', () => {
    const state = createPoolGameState();
    for (const id of ['1', '2']) {
      const ball = state.balls.find((b) => b.id === id)!;
      ball.potted = true;
      expect(settleBallIntoTray(state, POOL_TABLE, id)).toBe(true);
    }
    const one = state.balls.find((b) => b.id === '1')!;
    const two = state.balls.find((b) => b.id === '2')!;
    expect(one.position.x).toBeGreaterThan(POOL_TABLE.width / 2);
    expect(two.position.x).toBeGreaterThan(POOL_TABLE.width / 2);
    expect(
      Math.hypot(one.position.x - two.position.x, one.position.y - two.position.y),
    ).toBeGreaterThan(DEFAULT_PARAMS.ballRadius);
  });

  test('is a no-op for a ball still in play', () => {
    const state = createPoolGameState();
    const before = JSON.parse(JSON.stringify(state.balls)) as typeof state.balls;
    expect(settleBallIntoTray(state, POOL_TABLE, '5')).toBe(false);
    expect(state.balls).toEqual(before);
  });
});
