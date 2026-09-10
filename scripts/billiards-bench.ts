/**
 * Prediction-cost benchmark.
 *
 * The predicted-paths preview runs while the player aims, so its cost lands
 * directly in the interaction. This measures it the way the page does — a
 * full roll-out to rest from a rack — for both presets and for the shots
 * that cost the most.
 *
 *   bun run scripts/billiards-bench.ts
 */
import { GAME_PRESETS } from '../src/shared/billiards/game-state';
import { cloneBalls, DEFAULT_PARAMS, predictPaths, strike } from '../src/shared/billiards/physics';

const RUNS = 31;

function measure(variant: 'carom' | 'pool', label: string, directionDeg: number): void {
  const preset = GAME_PRESETS[variant];
  const rack = preset.createState().balls;
  const times: number[] = [];
  let points = 0;

  for (let i = 0; i < RUNS; i += 1) {
    const balls = cloneBalls(rack);
    const cue = balls.find((ball) => ball.id === preset.cueBallId)!;
    strike(cue, {
      speed: 4,
      // Jitter far too small to change which balls the shot wakes, but
      // enough that nothing can be cached across runs.
      directionRad: ((directionDeg + i * 0.0005) * Math.PI) / 180,
      lateralSpeed: 0,
      topspin: 0,
      sidespin: 0,
      rollspin: 0,
    });
    const started = performance.now();
    const paths = predictPaths(balls, preset.table, DEFAULT_PARAMS);
    times.push(performance.now() - started);
    points = paths.reduce((total, path) => total + path.points.length, 0);
  }

  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))]!;
  console.log(
    `${(variant + '/' + label).padEnd(20)} p50 ${at(0.5).toFixed(2).padStart(6)}ms   ` +
      `p90 ${at(0.9).toFixed(2).padStart(6)}ms   ` +
      `max ${times[times.length - 1]!.toFixed(2).padStart(6)}ms   ` +
      `${points} points`,
  );
}

measure('carom', 'open table', 13);
measure('pool', 'into the rack', 0);
measure('pool', 'clipping', 3);
measure('pool', 'clean miss', 10);
