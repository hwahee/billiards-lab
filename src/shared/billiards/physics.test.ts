import { describe, expect, test } from 'bun:test';

import {
  CAROM_TABLE,
  cloneBalls,
  DEFAULT_PARAMS,
  identityQuat,
  isAtRest,
  POOL_TABLE,
  predictPaths,
  SIM_DT,
  stepPhysics,
  strike,
  type BallState,
  type CollisionEvent,
  type PhysicsParams,
} from './physics';

function ball(id: string, x: number, y: number): BallState {
  return {
    id,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    orientation: identityQuat(),
  };
}

function runSteps(
  balls: BallState[],
  steps: number,
  params: PhysicsParams = DEFAULT_PARAMS,
  events?: CollisionEvent[],
): void {
  for (let i = 0; i < steps; i += 1) stepPhysics(balls, CAROM_TABLE, params, SIM_DT, events);
}

function runToRest(balls: BallState[], params: PhysicsParams = DEFAULT_PARAMS): number {
  const maxSteps = Math.ceil(60 / SIM_DT);
  for (let i = 0; i < maxSteps; i += 1) {
    stepPhysics(balls, CAROM_TABLE, params, SIM_DT);
    if (isAtRest(balls, params)) return i * SIM_DT;
  }
  throw new Error('did not come to rest within 60 simulated seconds');
}

describe('determinism', () => {
  test('identical inputs produce bit-identical states', () => {
    const make = () => {
      const balls = [ball('cue', -0.7, -0.1), ball('red', 0.5, 0.1)];
      strike(balls[0]!, {
        speed: 3,
        directionRad: 0.2,
        lateralSpeed: 0.4,
        topspin: 40,
        sidespin: -25,
        rollspin: 30,
      });
      return balls;
    };
    const a = make();
    const b = make();
    runSteps(a, 3000);
    runSteps(b, 3000);
    expect(b).toEqual(a);
  });

  test('predictPaths matches the live stepped simulation end state', () => {
    const balls = [ball('cue', -0.7, 0), ball('red', 0.4, 0.05)];
    strike(balls[0]!, { speed: 2.5, directionRad: 0.05, topspin: 30, sidespin: 15 });
    const paths = predictPaths(balls, CAROM_TABLE, DEFAULT_PARAMS);

    runToRest(balls);
    for (const path of paths) {
      const live = balls.find((b) => b.id === path.ballId)!;
      const end = path.points[path.points.length - 1]!;
      expect(end.x).toBeCloseTo(live.position.x, 6);
      expect(end.y).toBeCloseTo(live.position.y, 6);
    }
  });
});

describe('friction and spin', () => {
  test('a plain shot decelerates, keeps its line, and stops', () => {
    const balls = [ball('cue', -1, -0.3)];
    strike(balls[0]!, { speed: 1.2, directionRad: 0, topspin: 0, sidespin: 0 });
    runToRest(balls);
    const cue = balls[0]!;
    expect(cue.position.x).toBeGreaterThan(-1);
    expect(cue.position.y).toBeCloseTo(-0.3, 6); // no sideways drift
    expect(Math.hypot(cue.velocity.x, cue.velocity.y)).toBeLessThan(DEFAULT_PARAMS.stopSpeed);
  });

  test('heavy backspin makes the ball return (draw on open cloth)', () => {
    // Slip u = v + R·ω; with R·|ω| > 2.5·|v| the ball reverses before rolling.
    const params = DEFAULT_PARAMS;
    const balls = [ball('cue', 0, 0)];
    const speed = 1;
    const backspin = -(3.5 * speed) / params.ballRadius;
    strike(balls[0]!, { speed, directionRad: 0, topspin: backspin, sidespin: 0 });
    runToRest(balls, params);
    expect(balls[0]!.position.x).toBeLessThan(0);
  });

  test('topspin carries the ball farther than backspin at equal speed', () => {
    const shoot = (topspin: number) => {
      const balls = [ball('cue', -1.2, 0)];
      strike(balls[0]!, { speed: 1, directionRad: 0, topspin, sidespin: 0 });
      runToRest(balls);
      return balls[0]!.position.x;
    };
    expect(shoot(60)).toBeGreaterThan(shoot(0));
    expect(shoot(0)).toBeGreaterThan(shoot(-60));
  });

  test('lateralSpeed starts the ball with a sideways velocity component', () => {
    const balls = [ball('cue', 0, 0)];
    // Aim along +y with lateral speed 1 → left of travel is −x.
    strike(balls[0]!, {
      speed: 2,
      directionRad: Math.PI / 2,
      lateralSpeed: 1,
      topspin: 0,
      sidespin: 0,
    });
    expect(balls[0]!.velocity.x).toBeCloseTo(-1, 6);
    expect(balls[0]!.velocity.y).toBeCloseTo(2, 6);
  });

  test('rollspin curves the sliding path sideways', () => {
    const shoot = (rollspin: number) => {
      const balls = [ball('cue', -1.2, 0)];
      strike(balls[0]!, { speed: 1.5, directionRad: 0, topspin: 0, sidespin: 0, rollspin });
      // Sample mid-flight, well before any cushion, while still sliding.
      runSteps(balls, Math.round(0.6 / SIM_DT));
      return balls[0]!.position.y;
    };
    expect(shoot(150)).toBeGreaterThan(0.02); // > 0 curves left of travel
    expect(shoot(-150)).toBeLessThan(-0.02); // < 0 curves right
    expect(shoot(0)).toBeCloseTo(0, 6); // no rollspin → straight line
  });

  test('the rollspin curve stops once pure rolling is reached', () => {
    const balls = [ball('cue', -1.2, 0)];
    strike(balls[0]!, { speed: 1, directionRad: 0, topspin: 0, sidespin: 0, rollspin: 80 });
    // Slip (≈ R·|ω| ⊕ v) decays at 3.5·μs·g ≈ 6.9 m/s² → rolling well
    // before 0.6 s; from then on the heading must stay fixed.
    runSteps(balls, Math.round(0.6 / SIM_DT));
    const headingAt = () => Math.atan2(balls[0]!.velocity.y, balls[0]!.velocity.x);
    const rolling = headingAt();
    expect(rolling).toBeGreaterThan(0); // it did curve left while sliding
    runSteps(balls, Math.round(0.3 / SIM_DT));
    expect(headingAt()).toBeCloseTo(rolling, 6);
  });

  test('sliding transitions to rolling (contact slip vanishes)', () => {
    const balls = [ball('cue', -1, 0)];
    strike(balls[0]!, { speed: 3, directionRad: 0, topspin: 0, sidespin: 0 });
    // Slip decays at 3.5·μs·g ≈ 6.9 m/s² → rolling after ~0.44 s; check at
    // 0.7 s, before the ball reaches the far cushion.
    runSteps(balls, Math.round(0.7 / SIM_DT));
    const cue = balls[0]!;
    const R = DEFAULT_PARAMS.ballRadius;
    const slipX = cue.velocity.x - R * cue.spin.y;
    const slipY = cue.velocity.y + R * cue.spin.x;
    expect(Math.hypot(slipX, slipY)).toBeLessThan(0.01);
    expect(cue.velocity.x).toBeGreaterThan(0); // still moving forward
  });
});

describe('orientation quaternion', () => {
  test('a resting ball keeps the identity orientation', () => {
    const balls = [ball('cue', 0, 0)];
    runSteps(balls, 600);
    expect(balls[0]!.orientation).toEqual(identityQuat());
  });

  test('pure rolling along +x accumulates exactly the axis-angle rotation', () => {
    // Frictionless params keep v (and thus ω = v/R about ŷ) constant, so
    // after time t the orientation must be a rotation of (v/R)·t about ŷ.
    const params: PhysicsParams = { ...DEFAULT_PARAMS, slidingFriction: 0, rollingFriction: 0 };
    const R = params.ballRadius;
    const v = 1.2;
    const balls = [ball('cue', -1.2, 0)];
    balls[0]!.velocity = { x: v, y: 0 };
    balls[0]!.spin = { x: 0, y: v / R, z: 0 };
    const steps = Math.round(0.5 / SIM_DT);
    runSteps(balls, steps, params);
    const angle = (v / R) * steps * SIM_DT;
    const q = balls[0]!.orientation;
    expect(q.x).toBeCloseTo(0, 9);
    expect(q.y).toBeCloseTo(Math.sin(angle / 2), 6);
    expect(q.z).toBeCloseTo(0, 9);
    expect(q.w).toBeCloseTo(Math.cos(angle / 2), 6);
  });

  test('the orientation stays a unit quaternion through a full shot', () => {
    const balls = [ball('cue', -0.7, -0.1), ball('red', 0.5, 0.1)];
    strike(balls[0]!, { speed: 3, directionRad: 0.4, topspin: 60, sidespin: -40, rollspin: 25 });
    runToRest(balls);
    for (const b of balls) {
      const q = b.orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
    // The struck ball must have actually rotated away from the identity.
    expect(Math.abs(balls[0]!.orientation.w)).toBeLessThan(1 - 1e-6);
  });
});

describe('cushion rebound', () => {
  test('perpendicular hit reflects with the restitution coefficient', () => {
    const balls = [ball('cue', 1.2, 0)];
    balls[0]!.velocity = { x: 2, y: 0 };
    const params: PhysicsParams = { ...DEFAULT_PARAMS, slidingFriction: 0, rollingFriction: 0 };
    const events: CollisionEvent[] = [];
    runSteps(balls, Math.round(0.2 / SIM_DT), params, events);
    expect(events).toContainEqual({ type: 'cushion', ballId: 'cue' });
    expect(balls[0]!.velocity.x).toBeCloseTo(-2 * params.cushionRestitution, 6);
    expect(balls[0]!.velocity.y).toBeCloseTo(0, 6);
  });

  test('sidespin bends the rebound off a cushion', () => {
    const shoot = (sidespin: number) => {
      const balls = [ball('cue', 0, 0)];
      strike(balls[0]!, { speed: 2, directionRad: 0, topspin: 0, sidespin });
      runToRest(balls);
      return balls[0]!.position.y;
    };
    const noSpin = shoot(0);
    const withSpin = shoot(120);
    expect(Math.abs(withSpin - noSpin)).toBeGreaterThan(0.05);
  });
});

describe('ball–ball collision', () => {
  test('linear momentum is conserved across the impact', () => {
    const balls = [ball('cue', -0.3, -0.02), ball('red', 0, 0)];
    strike(balls[0]!, { speed: 2, directionRad: 0, topspin: 0, sidespin: 50 });
    const params: PhysicsParams = {
      ...DEFAULT_PARAMS,
      slidingFriction: 0,
      rollingFriction: 0,
      spinFriction: 0,
    };
    const momentum = () => ({
      x: balls.reduce((s, b) => s + b.velocity.x, 0),
      y: balls.reduce((s, b) => s + b.velocity.y, 0),
    });
    const before = momentum();
    const events: CollisionEvent[] = [];
    runSteps(balls, Math.round(0.3 / SIM_DT), params, events);
    expect(events.some((e) => e.type === 'ball')).toBe(true);
    const after = momentum();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test('full head-on hit with e=1 and no spin stops the cue ball', () => {
    const params: PhysicsParams = {
      ...DEFAULT_PARAMS,
      ballRestitution: 1,
      slidingFriction: 0,
      rollingFriction: 0,
    };
    const balls = [ball('cue', -0.3, 0), ball('red', 0, 0)];
    balls[0]!.velocity = { x: 2, y: 0 };
    runSteps(balls, Math.round(0.3 / SIM_DT), params);
    expect(Math.hypot(balls[0]!.velocity.x, balls[0]!.velocity.y)).toBeLessThan(1e-6);
    expect(balls[1]!.velocity.x).toBeCloseTo(2, 6);
  });

  test('follow: a topspin cue ball keeps advancing after a head-on hit', () => {
    const shoot = (topspin: number) => {
      const balls = [ball('cue', -0.6, 0), ball('red', 0, 0)];
      strike(balls[0]!, { speed: 2, directionRad: 0, topspin, sidespin: 0 });
      runToRest(balls);
      return balls[0]!.position.x;
    };
    const follow = shoot(120);
    const draw = shoot(-120);
    expect(follow).toBeGreaterThan(0.05); // ended up beyond the impact point
    expect(draw).toBeLessThan(follow - 0.3); // backspin pulls the cue ball back
  });

  test('cloneBalls yields an independent deep copy', () => {
    const original = [ball('cue', 0.1, 0.2)];
    const copy = cloneBalls(original);
    copy[0]!.position.x = 9;
    copy[0]!.spin.z = 9;
    copy[0]!.orientation.w = 0;
    expect(original[0]!.position.x).toBe(0.1);
    expect(original[0]!.spin.z).toBe(0);
    expect(original[0]!.orientation.w).toBe(1);
  });
});

describe('pockets', () => {
  const R = DEFAULT_PARAMS.ballRadius;
  // The point the cushions clamp a ball into at a corner (√2·R from the
  // pocket's centre, well inside every pocket's capture radius).
  const corner = POOL_TABLE.pockets![0]!;
  const cornerClampSpot = {
    x: Math.sign(corner.x) * (POOL_TABLE.width / 2 - R),
    y: Math.sign(corner.y) * (POOL_TABLE.height / 2 - R),
  };

  test('a slow ball centred in a corner pocket mouth is captured', () => {
    const balls = [ball('9', cornerClampSpot.x, cornerClampSpot.y)];
    const events: CollisionEvent[] = [];
    stepPhysics(balls, POOL_TABLE, DEFAULT_PARAMS, SIM_DT, events);
    expect(events).toContainEqual({ type: 'pocket', ballId: '9' });
    expect(balls[0]!.potted).toBe(true);
    expect(balls[0]!.velocity).toEqual({ x: 0, y: 0 });
    // Teleported out past the rail, not left sitting on the table.
    expect(Math.abs(balls[0]!.position.x)).toBeGreaterThan(POOL_TABLE.width / 2);
  });

  test('a side pocket (middle of a long rail) also captures a slow ball', () => {
    const side = POOL_TABLE.pockets![4]!; // { x: 0, y: -height/2 }
    const balls = [ball('9', 0, Math.sign(side.y) * (POOL_TABLE.height / 2 - R))];
    stepPhysics(balls, POOL_TABLE, DEFAULT_PARAMS, SIM_DT);
    expect(balls[0]!.potted).toBe(true);
  });

  test('a ball moving faster than pocketCaptureSpeed rattles past instead of dropping', () => {
    const balls = [ball('9', cornerClampSpot.x, cornerClampSpot.y)];
    balls[0]!.velocity = { x: -2, y: -2 }; // well above the default capture speed
    stepPhysics(balls, POOL_TABLE, DEFAULT_PARAMS, SIM_DT);
    expect(balls[0]!.potted).toBeUndefined();
  });

  test('a carom (pocketless) table never captures balls, however slow', () => {
    const balls = [ball('cue', CAROM_TABLE.width / 2 - R, CAROM_TABLE.height / 2 - R)];
    stepPhysics(balls, CAROM_TABLE, DEFAULT_PARAMS, SIM_DT);
    expect(balls[0]!.potted).toBeUndefined();
  });

  test('a potted ball is frozen and excluded from ball–ball collisions', () => {
    const potted: BallState = { ...ball('9', 0, 0), potted: true };
    const mover = ball('cue', -0.5, 0);
    mover.velocity = { x: 2, y: 0 };
    const balls = [potted, mover];
    const events: CollisionEvent[] = [];
    runSteps(balls, Math.round(0.6 / SIM_DT), DEFAULT_PARAMS, events);
    expect(events.some((e) => e.type === 'ball')).toBe(false);
    expect(potted.position).toEqual({ x: 0, y: 0 });
    expect(potted.velocity).toEqual({ x: 0, y: 0 });
    expect(mover.position.x).toBeGreaterThan(0); // passed straight through, unaffected
  });
});
