# Billiards Lab (`/billiards`)

A deterministic carom (pocketless) billiards simulation rendered with
three.js / @react-three/fiber / @react-three/drei.

The goal is **not** a realistic "feel of hitting a ball" but a variable
laboratory: you set the strike vector, the spin axis / rate and the physical
coefficients, and the entire evolution — position, cushion reflections,
ball–ball interactions, momentum loss — is computed deterministically and
played back in 3D. Because the engine is a fixed-timestep pure function, the
"predicted paths" overlay is exactly the trajectory the live run will follow.

## Where things live

| Piece                                             | Path                                    |
| ------------------------------------------------- | --------------------------------------- |
| Physics engine (pure TS, no rendering deps)       | `src/shared/billiards/physics.ts`       |
| Engine tests (determinism, draw/follow, cushions) | `src/shared/billiards/physics.test.ts`  |
| Scenario (balls, layout, default shot)            | `src/client/billiards/config.ts`        |
| Sim state container (refs + React state)          | `src/client/billiards/use-billiards.ts` |
| 3D scene (table, balls, prediction lines)         | `src/client/billiards/scene.tsx`        |
| Control panel                                     | `src/client/billiards/controls.tsx`     |
| Page                                              | `src/client/pages/billiards-page.tsx`   |

## Physics model

Coordinates: table plane x/y, z up, SI units. Equal-mass uniform spheres,
`I = 2/5·m·R²`. Fixed step `SIM_DT = 1/600 s` — determinism requires that the
step never varies, so the render loop feeds an accumulator, never `dt`.

- **Strike** (`strike()`): sets `v = speed·d̂ + lateralSpeed·(ẑ×d̂)` and
  `ω = topspin·(ẑ×d̂) − rollspin·d̂ + sidespin·ẑ`. Topspin > 0 matches
  natural forward roll; sidespin > 0 bends the rebound to the left of
  travel; lateralSpeed > 0 starts the ball moving left of the aim;
  rollspin > 0 (spin around the travel axis) curves the path to the left.
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

## UI variables

- **Shot**: initial speed (m/s), direction (°), lateral speed (m/s,
  perpendicular to the aim), topspin/backspin (rad/s), sidespin (rad/s),
  roll spin around the travel axis (rad/s, curves the sliding path).
- **Physics coefficients**: μs, μr, μsp, cushion restitution & friction,
  ball restitution & friction — all adjustable live; the prediction reruns
  on every change.
- **Simulation**: playback speed (0.1–3×), pause / resume, single-step
  (1/60 s), reset, prediction overlay toggle.
- **Live state**: per-ball `|v|` and `|ω|`, sim clock, and a collision log
  (cushion / ball events with timestamps).
