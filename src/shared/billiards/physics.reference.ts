/**
 * The stepping engine EXACTLY as it stood before the resting-ball
 * optimisation, kept so the optimised engine can be checked against it.
 *
 * `stepPhysics` in ./physics now skips work for balls that are standing
 * perfectly still. That skip is argued to be an identity operation, but an
 * argument is not a proof: `physics.determinism.test.ts` runs both engines
 * over a large generated corpus and demands bit-identical states and
 * identical event sequences.
 *
 * For that to mean anything the reference has to be the ORIGINAL CODE, not a
 * paraphrase of it — so everything below is a verbatim copy of the bodies as
 * of commit 37aa90f, with only the entry point renamed. Types and constants
 * are imported rather than duplicated, so a change to those is shared by both
 * engines and cannot make the two silently disagree about the model.
 *
 * Do not "tidy" this file, and do not fix bugs in it. If the physics is ever
 * meant to change, change ./physics, watch this test fail, and update the
 * copy deliberately — that failure is the whole point.
 */
import type { BallState, CollisionEvent, PhysicsParams, TableConfig } from './physics';

/**
 * Advances the orientation quaternion by the world-frame angular velocity
 * over one step: q ← Δq ⊗ q with Δq = (ω̂·sin(|ω|·dt/2), cos(|ω|·dt/2)).
 * Renormalising each step keeps floating-point drift from denormalising q.
 */
function integrateOrientation(ball: BallState, dt: number): void {
  const w = ball.spin;
  const mag = Math.hypot(w.x, w.y, w.z);
  if (mag < 1e-12) return;
  const half = (mag * dt) / 2;
  const s = Math.sin(half) / mag;
  const dx = w.x * s;
  const dy = w.y * s;
  const dz = w.z * s;
  const dw = Math.cos(half);
  const q = ball.orientation;
  const { x, y, z, w: qw } = q;
  q.x = dw * x + dx * qw + dy * z - dz * y;
  q.y = dw * y - dx * z + dy * qw + dz * x;
  q.z = dw * z + dx * y - dy * x + dz * qw;
  q.w = dw * qw - dx * x - dy * y - dz * z;
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  q.x /= n;
  q.y /= n;
  q.z /= n;
  q.w /= n;
}

/** Cloth friction + spin decay for one ball over one step. */
function integrateFriction(ball: BallState, params: PhysicsParams, dt: number): void {
  const { ballRadius: R, gravity: g } = params;
  const v = ball.velocity;
  const w = ball.spin;

  // Contact-point slip: u = v + ω × (−R·ẑ) = (vx − R·ωy, vy + R·ωx).
  const ux = v.x - R * w.y;
  const uy = v.y + R * w.x;
  const slip = Math.hypot(ux, uy);
  // While sliding, |u| decays at 3.5·μs·g; below one step of that, the ball
  // has reached the rolling regime.
  const slipDecayPerStep = 3.5 * params.slidingFriction * g * dt;

  if (slip > slipDecayPerStep) {
    // Sliding: friction −μs·m·g·û decelerates v and torques ω toward rolling.
    const nux = ux / slip;
    const nuy = uy / slip;
    const dv = params.slidingFriction * g * dt;
    v.x -= dv * nux;
    v.y -= dv * nuy;
    const dw = (2.5 * params.slidingFriction * g * dt) / R;
    w.x -= dw * nuy;
    w.y += dw * nux;
  } else {
    // Rolling: enforce the no-slip constraint, apply rolling resistance.
    const speed = Math.hypot(v.x, v.y);
    const dv = params.rollingFriction * g * dt;
    if (speed <= Math.max(dv, params.stopSpeed)) {
      v.x = 0;
      v.y = 0;
      w.x = 0;
      w.y = 0;
    } else {
      const scale = (speed - dv) / speed;
      v.x *= scale;
      v.y *= scale;
      w.x = -v.y / R;
      w.y = v.x / R;
    }
  }

  // Vertical spin decays independently (ball spinning on the cloth).
  const dwz = (2.5 * params.spinFriction * g * dt) / R;
  if (Math.abs(w.z) <= dwz) w.z = 0;
  else w.z -= Math.sign(w.z) * dwz;
}

/**
 * Rebound off a straight cushion with inward normal (nx, ny).
 * Normal restitution + a capped tangential friction impulse acting on the
 * contact slip (vt − R·ωz), which is how sidespin bends the rebound and how
 * cushions eat spin.
 */
function reboundOffCushion(ball: BallState, params: PhysicsParams, nx: number, ny: number): void {
  const m = params.ballMass;
  const R = params.ballRadius;
  const v = ball.velocity;
  const tx = -ny;
  const ty = nx;

  const vn = v.x * nx + v.y * ny; // < 0 → moving into the cushion
  const vt = v.x * tx + v.y * ty;
  const vnAfter = -params.cushionRestitution * vn;
  const jn = m * (vnAfter - vn); // normal impulse magnitude (> 0)

  // Contact slip along the cushion (contact point at −R·n̂): vt − R·ωz.
  const slip = vt - R * ball.spin.z;
  // Impulse that would cancel the slip: Δslip = 3.5·Jt/m (velocity + spin).
  let jt = (-m * slip) / 3.5;
  const jtMax = params.cushionFriction * jn;
  if (jt > jtMax) jt = jtMax;
  if (jt < -jtMax) jt = -jtMax;

  const vtAfter = vt + jt / m;
  v.x = vnAfter * nx + vtAfter * tx;
  v.y = vnAfter * ny + vtAfter * ty;
  ball.spin.z -= (2.5 * jt) / (m * R);
}

function collideWithCushions(
  ball: BallState,
  table: TableConfig,
  params: PhysicsParams,
  events?: CollisionEvent[],
): void {
  const xLim = table.width / 2 - params.ballRadius;
  const yLim = table.height / 2 - params.ballRadius;
  const p = ball.position;
  const v = ball.velocity;

  if (p.x > xLim && v.x > 0) {
    p.x = xLim;
    reboundOffCushion(ball, params, -1, 0);
    events?.push({ type: 'cushion', ballId: ball.id });
  } else if (p.x < -xLim && v.x < 0) {
    p.x = -xLim;
    reboundOffCushion(ball, params, 1, 0);
    events?.push({ type: 'cushion', ballId: ball.id });
  }
  if (p.y > yLim && v.y > 0) {
    p.y = yLim;
    reboundOffCushion(ball, params, 0, -1);
    events?.push({ type: 'cushion', ballId: ball.id });
  } else if (p.y < -yLim && v.y < 0) {
    p.y = -yLim;
    reboundOffCushion(ball, params, 0, 1);
    events?.push({ type: 'cushion', ballId: ball.id });
  }
}

/**
 * Checks `ball` against every pocket mouth on `table` and captures it (sets
 * `potted`, freezes it, teleports it to a resting spot just outside the
 * rail) if it is centred within a pocket's radius and moving at or below
 * `pocketCaptureSpeed`. No-op on tables without pockets or on already-potted
 * balls.
 */
function checkPockets(
  ball: BallState,
  table: TableConfig,
  params: PhysicsParams,
  events?: CollisionEvent[],
): void {
  if (!table.pockets || ball.potted) return;
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  if (speed > params.pocketCaptureSpeed) return;

  for (const pocket of table.pockets) {
    const dx = ball.position.x - pocket.x;
    const dy = ball.position.y - pocket.y;
    if (dx * dx + dy * dy > pocket.radius * pocket.radius) continue;

    ball.potted = true;
    ball.velocity = { x: 0, y: 0 };
    ball.spin = { x: 0, y: 0, z: 0 };
    // Rests right at the pocket mouth; a client renderer is free to animate
    // it disappearing from here and reappearing elsewhere (it plays no
    // further part in the physics either way).
    ball.position = { x: pocket.x, y: pocket.y };
    events?.push({ type: 'pocket', ballId: ball.id });
    return;
  }
}

/**
 * Ball–ball impact: equal-mass normal restitution impulse plus a capped
 * tangential friction impulse on the horizontal contact slip (includes the
 * R·ωz english terms → deterministic "throw" and spin transfer).
 */
function collideBallPair(
  a: BallState,
  b: BallState,
  params: PhysicsParams,
  events?: CollisionEvent[],
): void {
  if (a.potted || b.potted) return;
  const R = params.ballRadius;
  const m = params.ballMass;
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= 2 * R || dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;

  // Positional de-penetration (split evenly; keeps resting contacts stable).
  const push = (2 * R - dist) / 2;
  a.position.x -= push * nx;
  a.position.y -= push * ny;
  b.position.x += push * nx;
  b.position.y += push * ny;

  const rvx = b.velocity.x - a.velocity.x;
  const rvy = b.velocity.y - a.velocity.y;
  const rvn = rvx * nx + rvy * ny;
  if (rvn >= 0) return; // already separating

  // Normal impulse for equal masses with restitution e.
  const jn = (-(1 + params.ballRestitution) * rvn * m) / 2;
  a.velocity.x -= (jn / m) * nx;
  a.velocity.y -= (jn / m) * ny;
  b.velocity.x += (jn / m) * nx;
  b.velocity.y += (jn / m) * ny;

  // Horizontal contact slip: t·(vb − va) − R·(ωaz + ωbz).
  const tx = -ny;
  const ty = nx;
  const slip = rvx * tx + rvy * ty - R * (a.spin.z + b.spin.z);
  // Δslip = 7·Jt/m across both bodies (velocity + spin contributions).
  let jt = (-m * slip) / 7;
  const jtMax = params.ballFriction * jn;
  if (jt > jtMax) jt = jtMax;
  if (jt < -jtMax) jt = -jtMax;

  a.velocity.x -= (jt / m) * tx;
  a.velocity.y -= (jt / m) * ty;
  b.velocity.x += (jt / m) * tx;
  b.velocity.y += (jt / m) * ty;
  const dwz = (-2.5 * jt) / (m * R);
  a.spin.z += dwz;
  b.spin.z += dwz;

  events?.push({ type: 'ball', ballId: a.id, otherId: b.id });
}

/**
 * Advances the whole state by one fixed step of SIM_DT-scale `dt` (mutates
 * `balls`). Pass an `events` array to collect the collisions of this step.
 */
export function referenceStepPhysics(
  balls: BallState[],
  table: TableConfig,
  params: PhysicsParams,
  dt: number,
  events?: CollisionEvent[],
): void {
  for (const ball of balls) {
    if (ball.potted) continue;
    integrateFriction(ball, params, dt);
    ball.position.x += ball.velocity.x * dt;
    ball.position.y += ball.velocity.y * dt;
    integrateOrientation(ball, dt);
    collideWithCushions(ball, table, params, events);
    checkPockets(ball, table, params, events);
  }
  for (let i = 0; i < balls.length; i += 1) {
    for (let j = i + 1; j < balls.length; j += 1) {
      collideBallPair(balls[i]!, balls[j]!, params, events);
    }
  }
}
