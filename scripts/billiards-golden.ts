/**
 * Regenerates `src/shared/billiards/__fixtures__/golden-steps.json`.
 *
 * The fixture is a frozen recording of what the engine did BEFORE the
 * resting-ball optimisation, and `physics.determinism.test.ts` replays it.
 * Its whole value is that it does not live in the code: editing the engine
 * and its reference copy together cannot move it.
 *
 * So do NOT run this to make a failing test pass. Run it only when the
 * physics is deliberately being changed, and say so in the commit.
 *
 *   bun run scripts/billiards-golden.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { GAME_PRESETS } from '../src/shared/billiards/game-state';
import {
  cloneBalls,
  DEFAULT_PARAMS,
  SIM_DT,
  stepPhysics,
  type CollisionEvent,
} from '../src/shared/billiards/physics';
import {
  canonicalBalls,
  canonicalEvents,
  generateScenarios,
} from '../src/shared/billiards/test-scenarios';

const OUT = 'src/shared/billiards/__fixtures__/golden-steps.json';
/** Recording every step would be enormous; these catch drift early and late. */
const CHECKPOINT_FRACTIONS = [0.01, 0.1, 0.5, 1];

const scenarios = generateScenarios().filter((_, index) => index % 3 === 0);

const recorded = scenarios.map((scenario) => {
  const { table } = GAME_PRESETS[scenario.variant];
  const balls = cloneBalls(scenario.balls);
  const events: CollisionEvent[] = [];
  const checkpoints: { step: number; balls: string }[] = [];
  const steps = new Set(
    CHECKPOINT_FRACTIONS.map((f) => Math.max(1, Math.round(scenario.steps * f))),
  );

  for (let step = 1; step <= scenario.steps; step += 1) {
    stepPhysics(balls, table, DEFAULT_PARAMS, SIM_DT, events);
    if (steps.has(step)) checkpoints.push({ step, balls: canonicalBalls(balls) });
  }
  return {
    name: scenario.name,
    variant: scenario.variant,
    checkpoints,
    events: canonicalEvents(events),
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ scenarios: recorded }, null, 2)}\n`);
console.log(`wrote ${OUT}: ${recorded.length} scenarios`);
