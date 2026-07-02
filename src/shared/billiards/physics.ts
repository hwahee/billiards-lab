/**
 * Deterministic billiards physics on a pocketless (carom) table.
 *
 * This is intentionally NOT a general physics engine. Given the initial
 * strike variables (velocity vector, spin axis / angular speed) and a set of
 * physical coefficients, the whole evolution — sliding→rolling transition,
 * momentum loss, cushion reflection, ball–ball impulse exchange — is computed
 * with pure fixed-timestep arithmetic. Same inputs always produce the same
 * trajectory, which is what lets the UI show an exact predicted path.
 *
 * Coordinates: the table plane is x/y, z points up. All units are SI
 * (metres, seconds, radians). Rendering maps this onto three.js space.
 *
 * Rotation is quaternion-based: each ball carries its orientation as a unit
 * quaternion, advanced every step by q ← Δq(ω·dt) ⊗ q from the angular
 * velocity ω. Rolling, cushion rebounds and ball–ball impacts change ω, and
 * the quaternion integration turns that into the visible rotation. ω itself
 * stays a vector because an instantaneous rotation *rate* is a vector — the
 * quaternion is the accumulated rotation *state*.
 *
 * Model summary (equal-mass uniform spheres, I = 2/5·m·R²):
 *  - Sliding regime: cloth friction −μs·m·g acts opposite the contact-point
 *    slip u = v + ω×(−R·ẑ); slip magnitude decays at 3.5·μs·g until the ball
 *    rolls without slipping. This is what turns topspin/backspin into
 *    follow/draw — and what turns spin around the travel axis (rollspin)
 *    into a sideways slip, i.e. a laterally curving path while sliding.
 *  - Rolling regime: rolling resistance μr·g decelerates v while the rolling
 *    constraint (ωx = −vy/R, ωy = vx/R) is enforced each step.
 *  - Vertical spin (english, ωz) decays independently at 2.5·μsp·g/R.
 *  - Cushion: normal component restituted by e; a tangential friction impulse
 *    (capped at μc·|Jn|) acts on the contact slip vt − R·ωz, so sidespin
 *    visibly bends the rebound.
 *  - Ball–ball: normal restitution impulse plus a tangential friction impulse
 *    (capped at μb·|Jn|) on the horizontal contact slip, which transfers spin
 *    ("throw"). Follow/draw after impact emerges from the retained ω of the
 *    cue ball being re-converted by cloth friction.
 */

interface Vec2 {
  x: number;
  y: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit quaternion (x, y, z, w) representing a rotation. */
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The identity rotation — the reference pose every ball starts from. */
export function identityQuat(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

/** Rotates a vector by a unit quaternion: v' = q·v·q⁻¹. */
function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  // t = 2·(q_vec × v); v' = v + w·t + q_vec × t.
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export interface BallState {
  id: string;
  /** Ball-centre position on the table plane (m). */
  position: Vec2;
  /** Linear velocity (m/s). */
  velocity: Vec2;
  /** Angular velocity (rad/s); z is the vertical axis. */
  spin: Vec3;
  /** Accumulated rotation from the initial pose, as a unit quaternion. */
  orientation: Quat;
}

export interface TableConfig {
  /** Playing surface along x, cushion nose to cushion nose (m). */
  width: number;
  /** Playing surface along y (m). */
  height: number;
}

export interface PhysicsParams {
  /** Ball radius (m). */
  ballRadius: number;
  /** Ball mass (kg). */
  ballMass: number;
  /** Gravitational acceleration (m/s²). */
  gravity: number;
  /** μs — cloth friction while the contact point slips. */
  slidingFriction: number;
  /** μr — rolling resistance once rolling without slipping. */
  rollingFriction: number;
  /** μsp — decay of vertical-axis spin (english). */
  spinFriction: number;
  /** e — fraction of normal speed kept on cushion rebound. */
  cushionRestitution: number;
  /** μc — cushion tangential grip (converts sidespin into deflection). */
  cushionFriction: number;
  /** e — ball–ball normal restitution. */
  ballRestitution: number;
  /** μb — ball–ball tangential grip (throw / spin transfer). */
  ballFriction: number;
  /** Speed below which a rolling ball is snapped to rest (m/s). */
  stopSpeed: number;
  /** Spin magnitude below which residual spin is snapped to zero (rad/s). */
  stopSpin: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  ballRadius: 0.0327,
  ballMass: 0.21,
  gravity: 9.81,
  slidingFriction: 0.2,
  rollingFriction: 0.015,
  spinFriction: 0.025,
  cushionRestitution: 0.85,
  cushionFriction: 0.25,
  ballRestitution: 0.95,
  ballFriction: 0.06,
  stopSpeed: 0.01,
  stopSpin: 0.35,
};

/** International carom table playing surface. */
export const CAROM_TABLE: TableConfig = { width: 2.844, height: 1.422 };

/** Fixed integration step (s). Deterministic results require a fixed step. */
export const SIM_DT = 1 / 600;

export interface StrikeInput {
  /** Initial cue-ball speed (m/s). */
  speed: number;
  /** Travel direction, radians, 0 = +x, counter-clockwise. */
  directionRad: number;
  /**
   * Initial velocity component perpendicular to travel (m/s): > 0 moves
   * toward the left of travel (ẑ×d̂). Lets a strike start with sideways
   * movement independent of the aim direction.
   */
  lateralSpeed?: number;
  /**
   * Spin around the horizontal axis perpendicular to travel (rad/s):
   * > 0 topspin (follow), < 0 backspin (draw).
   */
  topspin: number;
  /**
   * Spin around the vertical axis (rad/s): > 0 turns the rebound to the
   * left of travel (counter-clockwise seen from above).
   */
  sidespin: number;
  /**
   * Spin around the travel axis itself (rad/s): > 0 curves the path to the
   * left of travel (the spin acts like the ball rolling leftward). The
   * sideways contact slip it creates is eaten by cloth friction, so the
   * curve happens during the sliding phase and the path straightens once
   * pure rolling is reached.
   */
  rollspin?: number;
}

/**
 * Sets a ball's state from the strike variables (replaces v and ω).
 *
 * A single quaternion carries the aim frame onto the table: in the aim frame
 * forward is x̂, left is ŷ, up is ẑ, so the strike is simply
 * v = (speed, lateral, ·) and ω = (−rollspin, topspin, sidespin) — topspin
 * about the left axis matches natural forward roll, rollspin about −forward
 * matches natural leftward roll (curves left), sidespin about up. Rotating
 * both by the aim quaternion yields the world-frame state.
 */
export function strike(ball: BallState, input: StrikeInput): void {
  const aim = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, input.directionRad);
  const v = rotateByQuat(aim, { x: input.speed, y: input.lateralSpeed ?? 0, z: 0 });
  ball.velocity = { x: v.x, y: v.y };
  ball.spin = rotateByQuat(aim, {
    x: -(input.rollspin ?? 0),
    y: input.topspin,
    z: input.sidespin,
  });
}

export type CollisionEvent =
  { type: 'cushion'; ballId: string } | { type: 'ball'; ballId: string; otherId: string };

function ballAtRest(ball: BallState, params: PhysicsParams): boolean {
  return (
    Math.hypot(ball.velocity.x, ball.velocity.y) < params.stopSpeed &&
    Math.hypot(ball.spin.x, ball.spin.y, ball.spin.z) < params.stopSpin
  );
}

export function isAtRest(balls: readonly BallState[], params: PhysicsParams): boolean {
  return balls.every((ball) => ballAtRest(ball, params));
}

export function cloneBalls(balls: readonly BallState[]): BallState[] {
  return balls.map((ball) => ({
    id: ball.id,
    position: { ...ball.position },
    velocity: { ...ball.velocity },
    spin: { ...ball.spin },
    orientation: { ...ball.orientation },
  }));
}

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
export function stepPhysics(
  balls: BallState[],
  table: TableConfig,
  params: PhysicsParams,
  dt: number,
  events?: CollisionEvent[],
): void {
  for (const ball of balls) {
    integrateFriction(ball, params, dt);
    ball.position.x += ball.velocity.x * dt;
    ball.position.y += ball.velocity.y * dt;
    integrateOrientation(ball, dt);
    collideWithCushions(ball, table, params, events);
  }
  for (let i = 0; i < balls.length; i += 1) {
    for (let j = i + 1; j < balls.length; j += 1) {
      collideBallPair(balls[i]!, balls[j]!, params, events);
    }
  }
}

export interface PredictedPath {
  ballId: string;
  points: Vec2[];
}

/**
 * Runs the deterministic simulation to rest (or `maxTime`) on a CLONE of the
 * given state and returns each ball's sampled trajectory. Because the model
 * is fully deterministic, this is exactly the path the live simulation will
 * follow for the same inputs.
 */
export function predictPaths(
  balls: readonly BallState[],
  table: TableConfig,
  params: PhysicsParams,
  { maxTime = 30, sampleInterval = 1 / 90 }: { maxTime?: number; sampleInterval?: number } = {},
): PredictedPath[] {
  const sim = cloneBalls(balls);
  const paths = sim.map((ball) => ({ ballId: ball.id, points: [{ ...ball.position }] }));
  const sampleSteps = Math.max(1, Math.round(sampleInterval / SIM_DT));
  const maxSteps = Math.ceil(maxTime / SIM_DT);

  for (let step = 1; step <= maxSteps; step += 1) {
    stepPhysics(sim, table, params, SIM_DT);
    if (step % sampleSteps === 0) {
      for (let i = 0; i < sim.length; i += 1) {
        const point = { ...sim[i]!.position };
        const last = paths[i]!.points[paths[i]!.points.length - 1]!;
        if (point.x !== last.x || point.y !== last.y) paths[i]!.points.push(point);
      }
    }
    if (isAtRest(sim, params)) break;
  }
  for (let i = 0; i < sim.length; i += 1) {
    paths[i]!.points.push({ ...sim[i]!.position });
  }
  return paths;
}
