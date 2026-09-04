/**
 * The engine skips work for balls that are standing perfectly still. That
 * skip is argued in `stepPhysics` to be an identity operation — these tests
 * are what makes the argument trustworthy.
 *
 * Two independent checks, because they fail in different ways:
 *
 *  - against `physics.reference.ts`, a verbatim copy of the engine before the
 *    optimisation. Catches any divergence on any generated scenario, and
 *    points at the exact step it first appears.
 *  - against a fixture frozen before the optimisation existed
 *    (`scripts/billiards-golden.ts`). Catches the case the first check
 *    cannot: someone later editing the engine and the reference together.
 */
import { describe, expect, test } from 'bun:test';

import golden from './__fixtures__/golden-steps.json';
import { GAME_PRESETS } from './game-state';
import {
  cloneBalls,
  DEFAULT_PARAMS,
  SIM_DT,
  stepPhysics,
  type BallState,
  type CollisionEvent,
} from './physics';
import { referenceStepPhysics } from './physics.reference';
import { canonicalBalls, canonicalEvents, generateScenarios } from './test-scenarios';

/**
 * Exact component-wise comparison. `toEqual` would do, but running it after
 * every step of every scenario is far too slow — this narrows the search to
 * the first differing step, and the caller then reports it with `toEqual`.
 *
 * `Object.is` rather than `===`, so `-0` is not quietly accepted as `0`.
 */
function sameBalls(a: readonly BallState[], b: readonly BallState[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.potted !== y.potted) return false;
    if (!Object.is(x.position.x, y.position.x) || !Object.is(x.position.y, y.position.y))
      return false;
    if (!Object.is(x.velocity.x, y.velocity.x) || !Object.is(x.velocity.y, y.velocity.y))
      return false;
    if (
      !Object.is(x.spin.x, y.spin.x) ||
      !Object.is(x.spin.y, y.spin.y) ||
      !Object.is(x.spin.z, y.spin.z)
    )
      return false;
    const p = x.orientation;
    const q = y.orientation;
    if (
      !Object.is(p.x, q.x) ||
      !Object.is(p.y, q.y) ||
      !Object.is(p.z, q.z) ||
      !Object.is(p.w, q.w)
    )
      return false;
  }
  return true;
}

function sameEvents(a: readonly CollisionEvent[], b: readonly CollisionEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

const scenarios = generateScenarios();

describe('the engine matches its pre-optimisation self exactly', () => {
  test(`every step of all ${scenarios.length} scenarios is bit-identical`, () => {
    for (const scenario of scenarios) {
      const { table } = GAME_PRESETS[scenario.variant];
      const live = cloneBalls(scenario.balls);
      const reference = cloneBalls(scenario.balls);
      const liveEvents: CollisionEvent[] = [];
      const referenceEvents: CollisionEvent[] = [];

      for (let step = 1; step <= scenario.steps; step += 1) {
        liveEvents.length = 0;
        referenceEvents.length = 0;
        stepPhysics(live, table, DEFAULT_PARAMS, SIM_DT, liveEvents);
        referenceStepPhysics(reference, table, DEFAULT_PARAMS, SIM_DT, referenceEvents);

        if (!sameBalls(live, reference) || !sameEvents(liveEvents, referenceEvents)) {
          // Re-assert with the real matcher so the diff is readable.
          expect({ scenario: scenario.name, step, balls: live, events: liveEvents }).toEqual({
            scenario: scenario.name,
            step,
            balls: reference,
            events: referenceEvents,
          });
          throw new Error('unreachable: the states differ but toEqual passed');
        }
      }
    }
  });

  test('negative zero is reproduced, not merely tolerated', () => {
    // The engine really does write -0 into spin components, and -0 is a
    // different value to JSON, to `toEqual` and to the wire snapshot. So the
    // requirement is not "never produce -0" but "produce exactly the -0s the
    // old engine produced" — which is why the comparison above uses
    // `Object.is`. This test just pins that such states are in the corpus at
    // all, so that guarantee is not vacuous.
    let seen = 0;
    for (const scenario of scenarios) {
      const { table } = GAME_PRESETS[scenario.variant];
      const balls = cloneBalls(scenario.balls);
      for (let step = 1; step <= Math.min(scenario.steps, 400); step += 1) {
        stepPhysics(balls, table, DEFAULT_PARAMS, SIM_DT);
      }
      for (const ball of balls) {
        for (const value of [
          ball.position.x,
          ball.position.y,
          ball.velocity.x,
          ball.velocity.y,
          ball.spin.x,
          ball.spin.y,
          ball.spin.z,
        ]) {
          if (Object.is(value, -0)) seen += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('the engine matches the frozen pre-optimisation fixture', () => {
  test('every recorded checkpoint replays exactly', () => {
    expect(golden.scenarios.length).toBeGreaterThan(0);
    for (const recorded of golden.scenarios) {
      const scenario = scenarios.find((entry) => entry.name === recorded.name);
      if (!scenario) throw new Error(`the corpus no longer has scenario ${recorded.name}`);

      const { table } = GAME_PRESETS[scenario.variant];
      const balls = cloneBalls(scenario.balls);
      const events: CollisionEvent[] = [];
      let step = 0;
      for (const checkpoint of recorded.checkpoints) {
        while (step < checkpoint.step) {
          stepPhysics(balls, table, DEFAULT_PARAMS, SIM_DT, events);
          step += 1;
        }
        expect(`${recorded.name} @${step}\n${canonicalBalls(balls)}`).toBe(
          `${recorded.name} @${step}\n${checkpoint.balls}`,
        );
      }
      expect(`${recorded.name}\n${canonicalEvents(events)}`).toBe(
        `${recorded.name}\n${recorded.events}`,
      );
    }
  });
});
