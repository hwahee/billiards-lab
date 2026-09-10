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

| Piece                                                      | Path                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Physics engine (pure TS, no rendering deps), incl. pockets | `src/shared/billiards/physics.ts`                                          |
| Engine tests (determinism, draw/follow, cushions, pockets) | `src/shared/billiards/physics.test.ts`                                     |
| Bit-identity checks + the pre-optimisation reference       | `src/shared/billiards/physics.determinism.test.ts`, `physics.reference.ts` |
| Prediction benchmark / golden fixture regeneration         | `scripts/billiards-bench.ts`, `scripts/billiards-golden.ts`                |
| Serializable game state, presets, placement, tray          | `src/shared/billiards/game-state.ts`                                       |
| Game-state tests (JSON round-trip, collision log, rack)    | `src/shared/billiards/game-state.test.ts`                                  |
| Room wire protocol (snapshot type, command validators)     | `src/shared/billiards/room.ts`                                             |
| Server-authoritative room service (owns state, tick loop)  | `src/server/services/billiards/room-service.ts`                            |
| Room HTTP surface (`GET`/`POST /api/billiards`)            | `src/server/routes/billiards.ts`                                           |
| Room integration tests (over HTTP)                         | `src/server/http/billiards.integration.test.ts`                            |
| Presentation config (ball specs/colours, default shot)     | `src/client/billiards/config.ts`                                           |
| Client room state (commands, local shot replay)            | `src/client/billiards/use-billiards.ts`                                    |
| UI substrate (billboard rule, panels, HUD, drag)           | `src/client/billiards/ui/`                                                 |
| Billboard maths tests                                      | `src/client/billiards/ui/billboard.test.ts`                                |
| Aim schemes (registry, contract, shared model)             | `src/client/billiards/aim/`                                                |
| 3D scene (table, pockets, balls, prediction lines)         | `src/client/billiards/scene.tsx`                                           |
| Control panel (incl. preset selector)                      | `src/client/billiards/controls.tsx`                                        |
| Page                                                       | `src/client/pages/billiards-page.tsx`                                      |

## Server-authoritative architecture

The live game runs on the SERVER. `BilliardsRoomService` (a container
singleton) owns the serializable game state, the physics coefficients and
the sim phase; while a shot is in flight it advances the fixed-step engine
from a wall-clock timer (elapsed time → SIM_DT-step accumulator, so timer
jitter never changes the trajectory) and goes idle when every ball rests.

Clients never integrate the live game. Every input — strike, reset, preset
switch, coefficient change, pause/step, drag placement, tray settling — is a
`BilliardsCommand` (one discriminated union, validated at the boundary in
`@shared/billiards/room`) POSTed to `/api/billiards`, and every response is
the full authoritative `BilliardsRoomSnapshot`. Commands illegal in the
current phase (strike while running, …) are server-side no-ops that still
return the authoritative state.

Realtime fan-out: room updates go onto the pub/sub bus
(`CHANNELS.billiardsUpdated`), and the `/ws` bridge publishes them to the
`ws.billiards` topic; with `PUBSUB_DRIVER=redis` this crosses instances, so
sockets connected anywhere see shots struck anywhere. The billiards feed is
strictly opt-in per socket (`{type:'subscribe',channel:'billiards'}` over
`/ws`, validated) because pages that don't render the table — e.g. Todos,
which invalidates queries on every `/ws` message — must not receive it.

**The rolling balls are not streamed.** Because the engine is
deterministic, a whole shot needs exactly two broadcasts: the strike echo
(phase `running`, velocities just set — the initial conditions) and the
at-rest snapshot (authoritative final positions + the turn flip), emitted
by the room the moment every ball rests. Cross-engine floating point
(Bun/JSC vs. V8) agrees to ~1e-15 m over a full break shot, so a client
can replay the identical trajectory locally.

Rendering (input replication / local replay): each client adopts arriving
snapshots — command echoes, `/ws` pushes, and a watchdog poll while
`running` (~0.7 Hz with a healthy socket, 4 Hz without) — and, while the
phase is `running`, advances the same fixed-step engine locally from the
adopted state inside the frame loop (`renderBalls(now)`), giving full
600 Hz smoothness with zero streaming latency. Reconciliation rules: a
running snapshot behind the local replay clock (params change, tray
settling, poll response) is adopted and fast-forwarded to the local clock —
deterministic, hence seamless; one ahead of it is adopted as-is (a skip
bounded by one network latency, only when a mid-shot command occurred); the
at-rest snapshot is held until the local replay reaches rest (or it lags by
more than one second), so the tail of the shot plays out before the
invisible ~1e-15 m correction. Drags apply locally first (the same shared
placement rules), sync on a trailing throttle, and briefly ignore pushed
snapshots (own echoes), so the pointer never fights the authority. The
strike _preview_ (`predictPaths`) also runs client-side — like the replay,
it is a pure function of the last snapshot. Aiming changes its input on
every pointer move, and pointer events arrive at the mouse's polling rate
rather than the display's, so `usePredictedPaths` records the inputs during
render and does the work from a `requestAnimationFrame` callback: a burst of
moves computes once, for the newest values. `PredictionLines` likewise
derives its scene-space point arrays once per result, because a fat line
rebuilds its whole geometry whenever it is handed a new array.

## 2-player turns

Each browser tab generates a per-tab player identity (sessionStorage) and
joins the room on mount (`{type:'join',playerId}`, idempotent); the first
two callers take seats 1 and 2, later ones spectate. Turn enforcement is
active only while both seats are taken — with one player (or none) the room
stays a free practice lab. While a match is active:

- Only the active seat's player may strike; anyone else (including
  anonymous callers) gets **403 FORBIDDEN** and nothing moves.
- The turn passes to the other seat when the shot comes to rest; a re-rack
  (reset / variant switch) keeps the players but restarts the cycle at
  seat 1.
- The control panel shows a turn badge (`Your turn` / `Opponent's turn` /
  `Watching`) and disables Strike outside your turn.
- Leaving (`{type:'leave'}`, sent best-effort on `pagehide` with
  `keepalive`) frees the seat and ends enforcement. Reconnect handling is
  deliberately minimal: the identity survives per tab, so re-joining after
  a reload reclaims a free seat.

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

## In-view UI

Direction and power are set in the view rather than by panel sliders. Two
substrates carry that, and `src/client/billiards/ui/` is both of them.

### The clamped-billboard rule (in-world elements)

Elements that belong to the table are drawn in the 3D scene, oriented by a
rule sitting between "fixed in the world" and "always facing the camera",
so they read as objects rather than stickers on the viewport:

- every element has a **home pose** — the orientation it prefers, chosen to
  make sense in world space;
- there is a **tolerance angle** around facing the camera. While the home
  pose is within it the element does not move at all: the camera orbits and
  it stays put, taking on perspective like the rest of the scene;
- past that tolerance it turns toward the camera, but only far enough to
  sit back exactly **on the boundary** — never further.

`maxAngle = 0` degenerates to a classic billboard. The turn is always the
minimal rotation, so an element's roll is carried along rather than reset —
a panel lying flat tips up toward the viewer instead of spinning to face
it. `clampedBillboardQuaternion()` is the pure maths (`ui/billboard.ts`,
tested in isolation); `<FacingGroup>` applies it per frame and adds the two
things such elements always end up needing:

- **`responsiveness`** — eases into each new orientation instead of
  snapping, so crossing the tolerance reads as a turn rather than a
  teleport, frame-rate independently (`smoothingAlpha`);
- **`constantSizeAt`** — scales by camera distance to hold a constant
  apparent size, without which anything you must _aim at_ becomes unusable
  as the camera pulls back.

`<Panel>` draws panel content from a canvas texture, so these elements need
no font asset and no DOM. Panels forward pointer handlers and hand back
`event.uv`, which is what lets a panel be a control surface rather than
only a readout.

### The HUD layer (screen-space elements)

`ui/hud.tsx` is the overlay above the 3D view, and it expects to hold more
than one thing: it owns the geography (five anchors) and each widget merely
names one, so several can share the view — and a corner — without
hard-coding offsets or knowing about each other. The layer is transparent
to pointer events and only its panels take input, so orbiting and dragging
the table keep working everywhere the HUD isn't.

### One drag at a time

Ball placement and whatever the aim scheme puts on the cloth both want the
pointer, and while either holds it the camera controls must stand down.
`ui/drag.tsx` makes that explicit: a widget claims the drag by name, the
scene reads whether anything is claimed to enable/disable `OrbitControls`,
and releasing is handled centrally — including the case widgets always get
wrong, where the pointer comes up outside the canvas.

## Aim schemes

_How_ direction and power are set is pluggable. `src/client/billiards/aim/`
is a registry of schemes, all implementing one contract: they receive the
cue ball, the current shot and a change callback, and render into the 3D
scene (`Scene`), the HUD (`Overlay`), or both — so _where the control
lives_ is the scheme's own choice, and swapping an in-world widget for a
HUD is the same act as swapping two in-world widgets.

Switching the whole aiming experience is one setting — `useAimScheme`,
surfaced as the **Aim style** picker and persisted per browser — and adding
a scheme is one entry in `AIM_SCHEMES`. Both mount points gate on
`activeAimCue(sim)`, so no scheme has to know about turn order, a potted
cue ball or a shot in flight.

| Scheme           | Gesture                                                           | What it asks of the substrate                              |
| ---------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| **Orbit knob**   | Drag a knob around the ball: bearing aims, distance sets power    | An upright readout holding a fixed world pose (32°)        |
| **Pull the cue** | Drag the cue back; the ball goes the other way, distance is power | A home pose that changes at runtime — it yaws with the aim |
| **Dial panel**   | Drag on a floating panel: dial for direction, slider for power    | An interactive panel: near-billboard (12°), constant size  |
| **Screen HUD**   | A dial and slider pinned to the corner of the view                | The HUD layer instead — and, being DOM, keyboard operable  |

`aim/model.ts` holds what every scheme shares: the speed ↔ power mapping,
the power colour ramp, pointer → table-plane geometry, and the keyboard
increments, so schemes agree on feel and the conversions are tested once
rather than per scheme. Scheme-specific geometry stays with its scheme —
the dial panel declares its zone layout once, in uv, and both its painter
and its hit test read that same object, since the two drifting apart is the
bug that shape of widget invites.

## Taking the shot in the view

`<SceneButton>` is the third thing an in-world UI needs, after readouts and
drag surfaces, and the **Strike** button over the cue ball is the scene's own
— not any aim scheme's — so every way of aiming is finished the same way. It
appears under exactly the condition the aim widgets do (`activeAimCue`), so
it is never a button that does nothing.

Two things a 3D button gets wrong if written casually: it has to claim the
shared drag for the press, or pressing it also orbits the camera (the camera
controls listen to the canvas directly and never see a stopped propagation);
and it must not wait to see its own claim come back through React, because a
quick click puts the release in the same frame as the press. It tracks the
press in a ref and lets the claim be about the camera only.

## Engine cost (read before "tidying" the hot path)

A pool prediction rolls sixteen balls out to rest at 600 Hz, and it runs
while the player aims, so its cost lands directly in the interaction. Three
things in `stepPhysics` are shaped by that, and all three look like
over-cleverness until you know what they cost:

- **`Math.hypot` is avoided on rejection paths.** It costs ~33 ns a call
  against ~3 ns for `dx*dx + dy*dy`, and at one point it was ~77% of the
  engine. Where a call only answers a yes/no question about a threshold, the
  squared form decides it — but only outside a relative band
  (`COMPARE_BAND`) around the threshold, inside which the exact call still
  runs. So no decision is ever made by the cheaper form anywhere the two
  could disagree. Do not "simplify" these back, and do not widen them to
  replace a `Math.hypot` whose _value_ is used.
- **The pair pass rejects in the loop, not in the call.** It is 120 pairs
  per step for a full rack and almost none are near touching. The survivors
  still go through `collideBallPair` in ascending `(i, j)` order, which
  matters: the pass is Gauss–Seidel, de-penetrating positions that later
  pairs then measure against. Reordering it, or culling with a bound that is
  not provably conservative, changes results.
- **Balls that are standing perfectly still skip two steps.** For such a
  ball `integrateFriction` reduces to writing five zeros and
  `collideWithCushions` cannot write at all. The zeros are written rather
  than skipped, because they are also what normalises a `-0` left by an
  earlier step — and the engine does produce those. Pocket capture keeps
  running, since a ball at rest in a mouth must drop.

`scripts/billiards-bench.ts` measures it. As of the change that introduced
all this, p50 per prediction: carom 1.09 ms, pool 6.60 ms into the rack,
1.04 ms for a shot that misses it.

**Any change here has to be bit-identical**, or the preview stops matching
the live run and the client replay stops matching the server.
`physics.determinism.test.ts` is what enforces that. It replays a generated
corpus through both the engine and `physics.reference.ts` — a verbatim copy
of the engine before any of this — comparing every step component-wise with
`Object.is`, so `-0` is not quietly accepted as `0`, and comparing the event
sequences too. The corpus includes states the engine would not reach on its
own: balls parked in and beside pocket mouths, pairs exactly touching and
slightly overlapping, velocities just under the rest thresholds. A second
check replays `__fixtures__/golden-steps.json`, recorded before the
optimisation existed, so editing the engine and its reference together still
fails.

If the physics is ever meant to change, change it, watch both fail, and
regenerate the fixture deliberately (`bun run scripts/billiards-golden.ts`)
— saying so in the commit.

## UI variables

- **Shot**: direction and power come from the aim scheme in the view (see
  above); lateral speed (m/s, perpendicular to the aim), topspin/backspin
  (rad/s), sidespin (rad/s) and roll spin around the travel axis (rad/s,
  curves the sliding path) remain sliders.
- **Physics coefficients**: μs, μr, μsp, cushion restitution & friction,
  ball restitution & friction — all adjustable live; the prediction reruns
  on every change. Pool adds a pocket capture speed slider.
- **Simulation**: playback speed (0.1–3×), pause / resume, single-step
  (1/60 s), reset, prediction overlay toggle.
- **Live state**: per-ball `|v|` and `|ω|`, sim clock, and a collision log
  (cushion / ball events with timestamps).
