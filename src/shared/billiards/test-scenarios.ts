/**
 * Scenario corpus for the engine's bit-identity checks.
 *
 * Shared by `physics.determinism.test.ts` (which replays every scenario
 * through both the live engine and `physics.reference.ts`) and by
 * `scripts/billiards-golden.ts` (which freezes a subset into a fixture). Both
 * must see exactly the same scenarios, and those scenarios must be identical
 * from run to run — hence the seeded generator rather than anything random.
 *
 * The corpus deliberately includes states the engine would never reach on its
 * own but which the optimisation must still handle: balls parked in pocket
 * mouths, pairs exactly touching or slightly overlapping, velocities just
 * under the rest thresholds, and negative zero.
 */
import { GAME_PRESETS, type BilliardsVariant } from './game-state';
import {
  cloneBalls,
  strike,
  type BallState,
  type CollisionEvent,
  type StrikeInput,
} from './physics';

export interface Scenario {
  name: string;
  variant: BilliardsVariant;
  /** Starting state, already struck where the scenario calls for it. */
  balls: BallState[];
  /** Steps to run. Kept modest so the suite stays quick. */
  steps: number;
}

/** mulberry32 — small, fast, and identical everywhere. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rack(variant: BilliardsVariant): BallState[] {
  return cloneBalls(GAME_PRESETS[variant].createState().balls);
}

function cueOf(variant: BilliardsVariant, balls: BallState[]): BallState {
  const cue = balls.find((ball) => ball.id === GAME_PRESETS[variant].cueBallId);
  if (!cue) throw new Error(`no cue ball in the ${variant} rack`);
  return cue;
}

function randomStrike(rng: () => number): StrikeInput {
  return {
    speed: 0.2 + rng() * 5.8,
    directionRad: (rng() * 2 - 1) * Math.PI,
    lateralSpeed: (rng() * 2 - 1) * 0.6,
    topspin: (rng() * 2 - 1) * 40,
    sidespin: (rng() * 2 - 1) * 40,
    rollspin: (rng() * 2 - 1) * 20,
  };
}

/** Random shots into randomly nudged racks — the bulk of the corpus. */
function randomScenarios(variant: BilliardsVariant, count: number, seed: number): Scenario[] {
  const rng = makeRng(seed);
  const { table } = GAME_PRESETS[variant];
  const xLim = table.width / 2 - 0.05;
  const yLim = table.height / 2 - 0.05;
  return Array.from({ length: count }, (_, i) => {
    const balls = rack(variant);
    const cue = cueOf(variant, balls);
    for (const ball of balls) {
      if (ball === cue) continue;
      // Nudge, sometimes hard enough to leave pairs touching or overlapping.
      const spread = rng() < 0.3 ? 0.02 : 0.35;
      ball.position.x = Math.max(-xLim, Math.min(xLim, ball.position.x + (rng() * 2 - 1) * spread));
      ball.position.y = Math.max(-yLim, Math.min(yLim, ball.position.y + (rng() * 2 - 1) * spread));
      // Occasionally leave a ball creeping just below the rest thresholds.
      if (rng() < 0.15) {
        ball.velocity = { x: (rng() * 2 - 1) * 0.009, y: (rng() * 2 - 1) * 0.009 };
        ball.spin = { x: 0, y: 0, z: (rng() * 2 - 1) * 0.34 };
      }
    }
    strike(cue, randomStrike(rng));
    return { name: `${variant}/random-${i}`, variant, balls, steps: 1500 };
  });
}

/** States chosen to break a careless optimisation rather than to look realistic. */
function adversarialScenarios(): Scenario[] {
  const out: Scenario[] = [];

  // A rack nobody touches: every ball asleep for every step.
  for (const variant of ['carom', 'pool'] as const) {
    out.push({ name: `${variant}/untouched`, variant, balls: rack(variant), steps: 600 });
  }

  const pocket = GAME_PRESETS.pool.table.pockets![0]!;
  const R = 0.0327;

  // Stationary balls in, on and just outside a pocket mouth. A resting ball
  // centred in a mouth must still be captured.
  for (const [name, dx] of [
    ['in-mouth', 0],
    ['at-rim', pocket.radius * 0.999],
    ['just-outside', pocket.radius * 1.001],
  ] as const) {
    const balls = rack('pool');
    balls[1]!.position = { x: pocket.x - dx, y: pocket.y };
    out.push({ name: `pool/parked-${name}`, variant: 'pool', balls, steps: 300 });
  }

  // Pairs exactly touching, and pairs already interpenetrating, with a cue
  // ball driven into them.
  for (const [name, gap] of [
    ['touching', 2 * R],
    ['overlapping', 2 * R * 0.999],
  ] as const) {
    const balls = rack('carom');
    balls[1]!.position = { x: 0.4, y: 0 };
    balls[2]!.position = { x: 0.4 + gap, y: 0 };
    const cue = cueOf('carom', balls);
    cue.position = { x: -0.4, y: 0 };
    strike(cue, {
      speed: 3,
      directionRad: 0,
      lateralSpeed: 0,
      topspin: 0,
      sidespin: 0,
      rollspin: 0,
    });
    out.push({ name: `carom/${name}`, variant: 'carom', balls, steps: 1500 });
  }

  // Negative zero, which reads as "at rest" but is not the same value the
  // engine writes when it stops a ball.
  {
    const balls = rack('carom');
    balls[1]!.position = { x: -0, y: -0 };
    balls[1]!.velocity = { x: -0, y: -0 };
    balls[1]!.spin = { x: -0, y: -0, z: -0 };
    const cue = cueOf('carom', balls);
    strike(cue, {
      speed: 2,
      directionRad: 0.3,
      lateralSpeed: 0,
      topspin: 0,
      sidespin: 0,
      rollspin: 0,
    });
    out.push({ name: 'carom/negative-zero', variant: 'carom', balls, steps: 1200 });
  }

  // Right on the rest thresholds, where a threshold-based skip would diverge.
  {
    const balls = rack('carom');
    balls[1]!.velocity = { x: 0.0099, y: 0 };
    balls[1]!.spin = { x: 0, y: 0, z: 0.349 };
    balls[2]!.velocity = { x: 0, y: 0.0101 };
    out.push({ name: 'carom/at-threshold', variant: 'carom', balls, steps: 900 });
  }

  return out;
}

export function generateScenarios(): Scenario[] {
  return [
    ...adversarialScenarios(),
    ...randomScenarios('carom', 24, 0x5eed),
    ...randomScenarios('pool', 16, 0xb11d),
  ];
}

/**
 * A ball set as text, exactly enough to compare two runs for bit-identity.
 *
 * JSON cannot carry this state faithfully: `JSON.stringify(-0)` is `"0"` and
 * `potted: undefined` disappears entirely — and the engine really does
 * produce `-0` components. `String(n)` round-trips a double exactly, so the
 * text form is both lossless and diffable.
 */
export function canonicalBalls(balls: readonly BallState[]): string {
  const n = (value: number) => (Object.is(value, -0) ? '-0' : String(value));
  return balls
    .map((ball) =>
      [
        ball.id,
        ball.potted === true ? 'potted' : 'live',
        n(ball.position.x),
        n(ball.position.y),
        n(ball.velocity.x),
        n(ball.velocity.y),
        n(ball.spin.x),
        n(ball.spin.y),
        n(ball.spin.z),
        n(ball.orientation.x),
        n(ball.orientation.y),
        n(ball.orientation.z),
        n(ball.orientation.w),
      ].join(' '),
    )
    .join('\n');
}

export function canonicalEvents(events: readonly CollisionEvent[]): string {
  return events
    .map((event) =>
      event.type === 'ball'
        ? `ball ${event.ballId} ${event.otherId}`
        : `${event.type} ${event.ballId}`,
    )
    .join('\n');
}
