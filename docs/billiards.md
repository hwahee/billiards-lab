# Billiards Lab (`/billiards`)

A deterministic billiards simulation rendered with three.js /
@react-three/fiber / @react-three/drei, with two selectable presets: carom
(pocketless, 4 balls) and pool (6 pockets, 15 numbered balls + cue ball).

The goal is **not** a realistic "feel of hitting a ball" but a variable
laboratory: you set the strike vector, the spin axis / rate and the physical
coefficients, and the entire evolution — position, cushion reflections,
ball–ball interactions, momentum loss — is computed deterministically and
played back in 3D. Because the engine is a fixed-timestep pure function, the
"predicted paths" overlay is exactly the trajectory the live run will follow.

## Where things live

| Piece                                                      | Path                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| Physics engine (pure TS, no rendering deps), incl. pockets | `src/shared/billiards/physics.ts`         |
| Engine tests (determinism, draw/follow, cushions, pockets) | `src/shared/billiards/physics.test.ts`    |
| Serializable game state (layouts, strike, advance)         | `src/shared/billiards/game-state.ts`      |
| Game-state tests (JSON round-trip, collision log, rack)    | `src/shared/billiards/game-state.test.ts` |
| Presets (carom/pool tables, ball specs, default shot)      | `src/client/billiards/config.ts`          |
| Sim state container (refs + React state, preset switch)    | `src/client/billiards/use-billiards.ts`   |
| 3D scene (table, pockets, balls, prediction lines)         | `src/client/billiards/scene.tsx`          |
| Control panel (incl. preset selector)                      | `src/client/billiards/controls.tsx`       |
| Page                                                       | `src/client/pages/billiards-page.tsx`     |

## Physics model

Coordinates: table plane x/y, z up, SI units. Equal-mass uniform spheres,
`I = 2/5·m·R²`. Fixed step `SIM_DT = 1/600 s` — determinism requires that the
step never varies, so the render loop feeds an accumulator, never `dt`.

Rotation is quaternion-based: every ball starts at the identity quaternion
and carries its orientation as part of the physics state. Each step advances
it by `q ← Δq(ω·dt) ⊗ q` from the angular velocity ω, so rolling, cushion
rebounds and ball–ball impacts (which change ω) all flow into the visible
rotation through the same quaternion integration. ω itself stays a vector —
an instantaneous rotation _rate_ is a vector, the quaternion is the
accumulated rotation _state_. Rendering only converts the quaternion into
three.js axes (`(x, y, z, w) → (x, z, −y, w)`).

- **Strike** (`strike()`): one aim quaternion (rotation about ẑ by the
  direction) carries the aim frame onto the table. In the aim frame
  forward = x̂, left = ŷ, up = ẑ, so `v = (speed, lateralSpeed, ·)` and
  `ω = (−rollspin, topspin, sidespin)`; both are rotated by the quaternion
  into world space. Topspin > 0 matches natural forward roll; sidespin > 0
  bends the rebound to the left of travel; lateralSpeed > 0 starts the ball
  moving left of the aim; rollspin > 0 (spin around the travel axis) curves
  the path to the left.
- **Sliding regime**: cloth friction `−μs·m·g·û` acts opposite the
  contact-point slip `u = v + ω×(−R·ẑ)`; `|u|` decays at `3.5·μs·g`.
  This converts topspin/backspin into follow/draw, and converts rollspin
  into a sideways slip → a laterally curving path. The curve lasts only
  while the ball slides; once pure rolling is reached the path is straight
  again (massé-like behaviour).
- **Rolling regime**: once slip vanishes, rolling resistance `μr·g`
  decelerates `v` under the no-slip constraint (`ωx = −vy/R, ωy = vx/R`).
- **Vertical spin** (english) decays independently at `2.5·μsp·g/R`.
- **Cushion**: normal component restituted by `e`; a tangential friction
  impulse (capped at `μc·|Jn|`) acts on the contact slip `vt − R·ωz`, so
  sidespin visibly changes the rebound angle and the cushion eats spin.
- **Ball–ball**: equal-mass normal restitution impulse plus a tangential
  friction impulse (capped at `μb·|Jn|`) on the horizontal contact slip,
  which produces deterministic "throw" and spin transfer. Follow/draw after
  impact emerges naturally: the cue ball keeps its ω through the impact and
  cloth friction re-converts it into motion.
- **Pockets** (pool only): the table carries six circular pocket mouths —
  the 4 corners plus the middle of each long rail. Each step, a ball not yet
  potted is checked against every pocket; if its centre lies inside the
  mouth's radius and its speed is at or below `pocketCaptureSpeed`, it is
  flagged `potted`, its velocity/spin are zeroed, and it rests at the
  pocket's own coordinates. Potted balls are frozen: skipped entirely by
  friction, cushion and ball–ball collision from then on. A ball moving
  faster than `pocketCaptureSpeed` passes straight over the mouth instead of
  dropping — the deliberate stand-in for modelling real pocket-jaw geometry.
  Where the ball ends up visually from there (shrinking away, reappearing in
  a tray) is a client-only concern — see "Pocketed-ball tray" below.

## Presets

- **Carom** (`CAROM_TABLE`, `createInitialGameState`): 4 balls (white cue +
  yellow + two reds), no pockets.
- **Pool** (`POOL_TABLE`, `createPoolGameState`): cue ball behind the head
  string plus 15 numbered balls racked in the standard triangle at the foot
  spot — apex is the 1-ball, the 8-ball sits at the centre of the middle
  row, and the back row's two corners are one solid (7) and one stripe (15).
  Six pockets as described above.

Switching the **Game** selector in the Table group re-racks the layout via
the preset's `createState()` and resets the sim clock/collision log.

## Pocketed-ball tray

A captured ball doesn't just vanish: `scene.tsx`'s `BallMeshes` runs a
client-only, wall-clock-driven animation on top of the physics state (which
already parked the ball at the pocket, inert) — it shrinks in place at the
pocket mouth (`POT_ANIM_SHRINK`), disappears for a beat (`POT_ANIM_HIDDEN`),
then calls `sim.settleIntoTray(ballId)` to move it into the tray (see below)
and grows back in (`POT_ANIM_GROW`). None of this is simulated physics; it's
purely presentational, tracked per ball in a small phase state machine
(`shrinking → hidden → growing`) so a mid-flight ball is neither draggable
nor rendered from stale physics state.

The tray itself (`config.ts`) is one dedicated area just outside a short
(vertical) edge of the table — a small wooden shelf, flush with the frame's
top surface — laid out as an 8×2 slot grid (`traySlotPosition`) rather than
a single point, so several balls potted in succession land spaced apart
instead of piling on top of each other. `settleIntoTray` hands each newly
captured ball the first slot not already sat in by another potted ball
(`nextFreeTraySlot`, comparing against every other ball still resting past
the felt); dragging a ball back onto the table frees its slot for reuse.

Once settled, a tray ball can be dragged like any other (`sim.placeBall`):
moved within the tray freely, or dropped back onto the felt — which clears
`potted` and lets it rejoin play, subject to the same bounds/overlap rules
as any other placement. `strikeCue()` refuses to fire while the cue ball is
potted, and the controls panel disables the Strike button and shows a hint
for the same reason: a potted cue ball must be dragged back onto the table
before it can be struck again.

## Free ball placement

While idle, any ball can be picked up and dropped anywhere on the table —
useful for setting up a specific practice shot. `sim.placeBall(ballId, x, y)`
(`use-billiards.ts`) clamps the target inside the rails and rejects it
outright if it would overlap another ball (the ball simply stops following
the cursor at the point of contact). The drag itself (`scene.tsx`) is
tracked by an invisible plane raised above every ball, so pointer moves keep
hitting the plane — not whatever ball is currently under the cursor — for
the whole gesture; `OrbitControls` is disabled for the duration so orbiting
the camera and dragging a ball never fight over the same pointer.

## UI variables

- **Shot**: initial speed (m/s), direction (°), lateral speed (m/s,
  perpendicular to the aim), topspin/backspin (rad/s), sidespin (rad/s),
  roll spin around the travel axis (rad/s, curves the sliding path).
- **Physics coefficients**: μs, μr, μsp, cushion restitution & friction,
  ball restitution & friction — all adjustable live; the prediction reruns
  on every change. Pool adds a pocket capture speed slider.
- **Simulation**: playback speed (0.1–3×), pause / resume, single-step
  (1/60 s), reset, prediction overlay toggle.
- **Live state**: per-ball `|v|` and `|ω|`, sim clock, and a collision log
  (cushion / ball events with timestamps).
