/**
 * Deterministic billiards physics for both pocketless (carom) and pocket
 * (pool) tables.
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
 *  - Pockets (pool tables only): a ball centred inside a pocket's mouth,
 *    moving at or below `pocketCaptureSpeed`, is captured — flagged
 *    `potted` and teleported to a resting spot just outside the rail. Potted
 *    balls are frozen and excluded from every further integration and
 *    collision. Faster balls passing over the mouth are not captured
 *    (they "rattle" past it), which is the deliberate simplification asked
 *    for in place of modelling real pocket-jaw geometry.
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
  /** True once captured by a pocket; frozen off-table, excluded from physics. */
  potted?: boolean;
}

/** A circular pocket mouth: a ball centred within `radius` of (x, y) can be captured. */
interface Pocket {
  x: number;
  y: number;
  radius: number;
}

export interface TableConfig {
  /** Playing surface along x, cushion nose to cushion nose (m). */
  width: number;
  /** Playing surface along y (m). */
  height: number;
  /** Pocket mouths (corners + rail middles); absent on pocketless tables. */
  pockets?: readonly Pocket[];
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
  /** Speed at/below which a ball centred in a pocket mouth is captured (m/s). */
  pocketCaptureSpeed: number;
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
  pocketCaptureSpeed: 1.3,
};

/** International carom table playing surface (no pockets). */
export const CAROM_TABLE: TableConfig = { width: 2.844, height: 1.422 };

const POOL_TABLE_WIDTH = 2.54;
const POOL_TABLE_HEIGHT = 1.27;
/** Capture radius of a pocket mouth — generous enough to catch a ball the
 * cushion clamps into a corner, but not so wide it reaches far up the rail. */
const POOL_POCKET_RADIUS = DEFAULT_PARAMS.ballRadius * 2.3;

function poolPockets(width: number, height: number, radius: number): Pocket[] {
  const hw = width / 2;
  const hh = height / 2;
  return [
    { x: -hw, y: -hh, radius },
    { x: hw, y: -hh, radius },
    { x: -hw, y: hh, radius },
    { x: hw, y: hh, radius },
    // Side pockets: middle of each long rail (the "가로변" / horizontal sides).
    { x: 0, y: -hh, radius },
    { x: 0, y: hh, radius },
  ];
}

/** Standard 9-foot pool table playing surface, six pockets (4 corners + 2 side). */
export const POOL_TABLE: TableConfig = {
  width: POOL_TABLE_WIDTH,
  height: POOL_TABLE_HEIGHT,
  pockets: poolPockets(POOL_TABLE_WIDTH, POOL_TABLE_HEIGHT, POOL_POCKET_RADIUS),
};

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
  | { type: 'cushion'; ballId: string }
  | { type: 'ball'; ballId: string; otherId: string }
  | { type: 'pocket'; ballId: string };

/**
 * Relative width of the band around a threshold in which a squared compare
 * is not trusted.
 *
 * `Math.hypot` is the engine's single biggest cost — about 33 ns a call
 * against 3 ns for `dx*dx + dy*dy`, and a full pool rack runs 120 of them per
 * step in the pair loop alone. Most of those calls only ever answer a
 * yes/no question about a threshold, and for that the squared form does just
 * as well *away from the threshold*.
 *
 * It is not bit-identical AT the threshold, so it is never used to decide
 * there: outside this band the exact call still runs. The band is ~1e9 times
 * the worst rounding error of either form at billiards-table magnitudes, so
 * a decision made outside it cannot differ from the one `Math.hypot` would
 * have made — and inside it, nothing changed at all.
 */
const COMPARE_BAND = 1e-9;

function ballAtRest(ball: BallState, params: PhysicsParams): boolean {
  const v = ball.velocity;
  const w = ball.spin;

  const speedSq = v.x * v.x + v.y * v.y;
  const stopSpeedSq = params.stopSpeed * params.stopSpeed;
  if (speedSq > stopSpeedSq * (1 + COMPARE_BAND)) return false;
  if (speedSq > stopSpeedSq * (1 - COMPARE_BAND) && !(Math.hypot(v.x, v.y) < params.stopSpeed)) {
    return false;
  }

  const spinSq = w.x * w.x + w.y * w.y + w.z * w.z;
  const stopSpinSq = params.stopSpin * params.stopSpin;
  if (spinSq > stopSpinSq * (1 + COMPARE_BAND)) return false;
  if (spinSq > stopSpinSq * (1 - COMPARE_BAND)) {
    return Math.hypot(w.x, w.y, w.z) < params.stopSpin;
  }
  return true;
}

export function isAtRest(balls: readonly BallState[], params: PhysicsParams): boolean {
  // A plain loop rather than `.every()`: predictPaths asks this once per
  // step, and the callback would be an allocation on every one of them.
  for (const ball of balls) {
    if (!ballAtRest(ball, params)) return false;
  }
  return true;
}

export function cloneBalls(balls: readonly BallState[]): BallState[] {
  return balls.map((ball) => ({
    id: ball.id,
    position: { ...ball.position },
    velocity: { ...ball.velocity },
    spin: { ...ball.spin },
    orientation: { ...ball.orientation },
    potted: ball.potted,
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
 * How far from the table's centre line a ball must be before any pocket can
 * possibly contain it: the nearest pocket centre's |y|, less its radius.
 *
 * Every pocket sits on a rail, so this one comparison clears the whole
 * middle of the table — which is where most balls are — without looking at a
 * single pocket. Purely a function of the table, so it is computed once per
 * step rather than once per ball.
 */
function pocketFreeBand(table: TableConfig): number {
  if (!table.pockets) return Infinity;
  let band = Infinity;
  for (const pocket of table.pockets) {
    const reach = Math.abs(pocket.y) - pocket.radius;
    if (reach < band) band = reach;
  }
  return band;
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
  /**
   * Distance from the axis inside which no pocket can reach — see
   * `pocketFreeBand`. Anything nearer the middle of the table than this is
   * cleared without touching a single pocket.
   */
  freeBandY: number,
  events?: CollisionEvent[],
): void {
  if (!table.pockets || ball.potted) return;
  if (ball.position.y < freeBandY && ball.position.y > -freeBandY) return;
  const v = ball.velocity;
  const speedSq = v.x * v.x + v.y * v.y;
  const captureSq = params.pocketCaptureSpeed * params.pocketCaptureSpeed;
  if (speedSq > captureSq * (1 + COMPARE_BAND)) return;
  if (
    speedSq > captureSq * (1 - COMPARE_BAND) &&
    Math.hypot(v.x, v.y) > params.pocketCaptureSpeed
  ) {
    return;
  }

  for (const pocket of table.pockets) {
    // The pockets on the far rail are ruled out on one axis alone.
    const dy = ball.position.y - pocket.y;
    if (dy > pocket.radius || dy < -pocket.radius) continue;
    const dx = ball.position.x - pocket.x;
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
  // The overwhelming majority of pairs are nowhere near touching, and this
  // rejects them without the exact distance.
  const contactSq = 4 * R * R;
  const distSq = dx * dx + dy * dy;
  if (distSq > contactSq * (1 + COMPARE_BAND)) return;
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
  const freeBandY = pocketFreeBand(table);
  for (const ball of balls) {
    if (ball.potted) continue;
    const v = ball.velocity;
    const w = ball.spin;
    // Most balls are standing perfectly still: in a typical pool shot one of
    // sixteen is moving, and the other fifteen are integrated for nothing.
    // Two of the five things below are provably identity operations on such
    // a ball, and skipping them is where nearly all of this engine's cost in
    // a crowded rack goes.
    const asleep = v.x === 0 && v.y === 0 && w.x === 0 && w.y === 0 && w.z === 0;
    if (asleep) {
      // integrateFriction on a still ball reduces to exactly these five
      // stores: the contact slip is 0, so `slip > slipDecayPerStep` is false
      // for any non-negative sliding friction and the rolling branch is
      // taken; there `speed = 0 <= max(dv, stopSpeed)` always holds, and
      // `|w.z| = 0 <= dwz` always holds. Written rather than skipped because
      // these stores are also what normalises a -0 left by an earlier step.
      v.x = 0;
      v.y = 0;
      w.x = 0;
      w.y = 0;
      w.z = 0;
    } else {
      integrateFriction(ball, params, dt);
    }
    ball.position.x += v.x * dt;
    ball.position.y += v.y * dt;
    integrateOrientation(ball, dt);
    // Every branch in collideWithCushions is guarded by a non-zero velocity
    // component, so a still ball cannot rebound; the call writes nothing.
    if (!asleep) collideWithCushions(ball, table, params, events);
    // checkPockets, by contrast, MUST run: a ball at rest in a pocket mouth
    // is captured, and that is what makes a slow roll-in drop.
    checkPockets(ball, table, params, freeBandY, events);
  }

  // The pair pass is the single most expensive thing the engine does — 120
  // pairs per step for a full pool rack — and almost every pair is nowhere
  // near touching. Rejecting those here, rather than inside the call, is
  // worth it purely for the calls it does not make; the survivors still go
  // through collideBallPair, in the same ascending (i, j) order, and it
  // re-checks the same condition on the way in.
  const pairRejectSq = 4 * params.ballRadius * params.ballRadius * (1 + COMPARE_BAND);
  for (let i = 0; i < balls.length; i += 1) {
    const a = balls[i]!;
    if (a.potted) continue;
    const ap = a.position;
    // Held in locals across the inner loop; nothing else in this pass can
    // move `a`, so they are only refreshed after a contact that might have.
    let ax = ap.x;
    let ay = ap.y;
    for (let j = i + 1; j < balls.length; j += 1) {
      const b = balls[j]!;
      if (b.potted) continue;
      const bp = b.position;
      const dx = bp.x - ax;
      const dy = bp.y - ay;
      if (dx * dx + dy * dy > pairRejectSq) continue;
      collideBallPair(a, b, params, events);
      ax = ap.x;
      ay = ap.y;
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
        // Compare before allocating: most samples of a still ball are
        // discarded, and there are tens of thousands of them in a pool shot.
        const position = sim[i]!.position;
        const points = paths[i]!.points;
        const last = points[points.length - 1]!;
        if (position.x !== last.x || position.y !== last.y) {
          points.push({ x: position.x, y: position.y });
        }
      }
    }
    if (isAtRest(sim, params)) break;
  }
  for (let i = 0; i < sim.length; i += 1) {
    paths[i]!.points.push({ ...sim[i]!.position });
  }
  return paths;
}
