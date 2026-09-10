/**
 * The predicted-paths preview, computed at most once per frame.
 *
 * The preview is an exact roll-out of the whole table, and aiming changes
 * its input on every pointer move. Pointer moves arrive at the mouse's
 * polling rate rather than the display's, so computing it where it is read —
 * in the render body — runs it several times per frame and puts all of that
 * on the pointer handler, which is what makes a drag feel heavy. Worse, each
 * fresh result is a fresh set of point arrays, and a fat line rebuilds its
 * whole geometry when it is handed one.
 *
 * So the inputs are only recorded during render, and the work is done from a
 * frame callback: a burst of moves collapses into one computation, the
 * pointer handler does nothing but store, and the paths land at most a frame
 * behind the widget under the hand.
 */
import { useEffect, useState } from 'react';

import {
  cloneBalls,
  predictPaths,
  strike,
  type BallState,
  type PhysicsParams,
  type PredictedPath,
  type TableConfig,
} from '@shared/billiards/physics';

import { toStrikeInput, type ShotSettings } from './config';

export interface PredictedPathsInput {
  /** False while the overlay is off or a shot is in flight — no work at all. */
  enabled: boolean;
  balls: readonly BallState[];
  cueBallId: string;
  table: TableConfig;
  physics: PhysicsParams;
  shot: ShotSettings;
}

function compute(input: PredictedPathsInput): PredictedPath[] | null {
  if (!input.enabled) return null;
  const balls = cloneBalls(input.balls);
  const cue = balls.find((ball) => ball.id === input.cueBallId);
  if (!cue || cue.potted) return null;
  strike(cue, toStrikeInput(input.shot));
  return predictPaths(balls, input.table, input.physics);
}

export function usePredictedPaths({
  enabled,
  balls,
  cueBallId,
  table,
  physics,
  shot,
}: PredictedPathsInput): PredictedPath[] | null {
  const [paths, setPaths] = useState<PredictedPath[] | null>(null);

  // Each input change cancels the frame the last one asked for, so a burst of
  // pointer moves within one frame computes once, for the newest values.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setPaths(compute({ enabled, balls, cueBallId, table, physics, shot })),
    );
    return () => cancelAnimationFrame(frame);
  }, [enabled, balls, cueBallId, table, physics, shot]);

  return paths;
}
