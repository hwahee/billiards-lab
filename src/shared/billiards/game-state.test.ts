import { describe, expect, test } from 'bun:test';

import {
  advanceGameState,
  createInitialGameState,
  strikeBall,
  type BilliardsGameState,
} from './game-state';
import { CAROM_TABLE, DEFAULT_PARAMS, SIM_DT } from './physics';

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
