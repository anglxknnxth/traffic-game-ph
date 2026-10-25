# Traffic Control Philippines

A top-down (strict bird's-eye) traffic signal management game set in Philippine streets, from a
fictional Metro Manila *kanto* to EDSA, Taft and a winding provincial road. You operate the traffic
lights while autonomous cars, jeepneys, tricycles, motorcycles, buses, trucks, vans, ambulances and
fire trucks try to get through, and people cross the road (not always at the crosswalk). Drivers
have personalities: patient, impatient, aggressive and cautious. They honk, change lanes, creep
forward and sometimes squeeze into the intersection with nowhere to go. Real gridlock builds up
from the simulation itself.

**Nothing ever collides.** Vehicles and pedestrians can block each other, but every movement passes
a predictive collision gate or a space reservation before it is applied.

## Requirements

- Node.js 20.19+ (tested with Node 22.14) and npm
- A modern desktop or mobile browser (Chrome, Edge, Firefox, Safari)

## Install and run

```bash
npm install
npm run dev        # start the dev server, then open the printed URL (default http://localhost:5173)
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # run the simulation test suite (Vitest)
```

Deep links for quick testing: `?play=career:7`, `?play=pinoy:taft`, `?play=challenge:c1`,
`?play=endless` or `?play=endless:edsa` (Endless on a given map). On the dev server, `&ff=60`
fast-forwards 60 s and `&zoom=2&x=0&y=-46` frames the camera.

## How to play

Every road into a junction has **its own green**: when the North road is green, the South road
(and everything else) is red. A green road releases all of its movements (straight, left and
right). Request a change and the light runs **GREEN → YELLOW (1.2 s) → ALL-RED (0.8 s) → next
GREEN** straight away, 2 seconds in all. A change in progress can be redirected to another road, or
cancelled during yellow. Clicks can never skip yellow or all-red, and only one road is ever green.

**Right turn on red is always allowed** ("right turn anytime with care"): a driver turning right
at a red light stops at the line, then turns when the traffic that has green leaves a gap. They
never squeeze into the box without exit space.

**Flashing yellow** (the `⚠ Flash` button or `Y`) turns every light at a junction to blinking
amber: each driver stops at the line, then goes in arrival order when the way is clear, like an
all-way stop. It suits light traffic and quiet nights; at rush hour it is slow. Pick any road's
button to go back to normal greens (after a short all-red).

Pedestrians cross the roads that are **not** moving: every crosswalk except the one across the
green road gets its walk light. Turning vehicles wait for people on the crosswalk. Switch too soon
after a walk light and the late walkers are still on the crosswalk when your new green starts. Keep
people waiting too long and some cross on red anyway. Under flashing yellow people cross in gaps,
taking turns with the drivers stopped at the lines.

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Green for one road | its button, or its signal head | `1` … `4` (N, E, S, W) or the arrow keys |
| Other intersections | their own buttons | `5` … `9`, in button order |
| Next road | tap the yellow box in the middle | |
| Flashing yellow on / off | `⚠ Flash` button | `Y` (junction under the cursor, or the first) |
| Pause / resume | pause button | `Space` / `P` / `Esc` |
| Restart | restart button | `R` |
| Speed 1x / 2x / 3x | speed buttons | `F` (cycles) |
| Mute | speaker button | `M` |
| Music on / off | `♫` button, Settings | |
| Zoom / pan | wheel, pinch, `+ / −` buttons, drag | `+` / `-` / `0` (reset) |
| Reservation debug overlay | Settings | `D` |

What you'll see on the map:

- A coloured bar on each stop line shows that approach's signal.
- A **red outline** pulsing around a vehicle means it is stuck inside the intersection (box blocked).
- A **red glow** under a vehicle means it has been waiting a long time.
- Yellow arcs and "BEEP!" bubbles are horns.
- Cones and a grey wreck mean an exit is blocked (stalled truck, road works).
- A white line with a small red/green light on an exit is the next (off-map) junction. When it is
  red, that road is backed up.
- A blue pulsing ring around a signal means an emergency vehicle is coming on that phase. Emergency
  vehicles go through on red (after slowing down) and everyone else at that junction gives way, but
  a green for them still gets them through faster.
- Small walk / don't-walk lights stand at each crosswalk; they blink orange during yellow and
  flashing yellow.
- A jeepney or tricycle with its hazards on and a "PARA PO!" bubble has stopped right at the
  corner, inside the junction, to let passengers off. Traffic crossing its path waits until it
  pulls away (3–7 s).
- Rivers run under bridges (parapets, a name plaque), with bangka boats passing underneath.
- "PASAWAY!" and a whistle mean someone is crossing where (or when) they shouldn't.
- Rain, dusk and night change how drivers behave: longer gaps, gentler braking, slower starts.

### Modes

- **Career:** ten levels that add mechanics one by one: light traffic, more cars, motorcycles,
  jeepneys and tricycles with curbside loading stops, turns and blocked exits, impatient drivers,
  rush-hour gridlock, emergency vehicles, two connected intersections, and a final high-density
  challenge. Clearing a level unlocks the next one.
- **Pinoy Roads:** nine maps inspired by real Philippine roads, unlocked one after another:
  Poblacion (a town plaza with STOP-sign barangay roads and a river), Taft under the LRT-1 (two
  signals, lots of students), España in the rain, Commonwealth (motorcycle lane and a U-turn slot),
  EDSA (Carousel busway, MRT-3, dusk into night), Liko-Liko (a mountain S-bend over a river),
  Tatlong Kanto (three signals: build a green wave), Dalawang Pampang (a signal on each bank of a
  city river, one short bridge between them) and Grid ng Maynila (four signals).
- **Endless:** demand grows every minute through the afternoon rush into the night, with passing
  rain. Pick any map. The run ends when congestion stays at 85% or more for 30 s.
- **Challenges:** five scenarios: clear an existing gridlock, keep waits low, handle ambulances,
  sustain flow under heavy demand, and recover from a blocked exit.
- **Tutorial:** a guided first run of Level 1.

### Scoring

Points come from vehicles moved, low waiting times, fast emergency response, recovering from
gridlock and pedestrians helped across. Penalties come from time spent gridlocked or partially
blocked, excessive waits, box-blocking entries, slow emergency response, people kept waiting at
the crosswalk for more than 45 s, and people who gave up and crossed on red. Safety carries the most weight:
the base score is multiplied by the safety rating, and the safety rating adds a bonus of up to 400.

Progress, best scores, stars, completed challenges and audio settings (sound-effect and music
volume, music on/off) are saved in `localStorage`.
Saves from before Pinoy Roads existed carry over: progress on the old career levels 11–16 moves to
the matching Pinoy Roads levels.
The game still works when storage is unavailable; progress then lasts only for the session.

## How the simulation works

All simulation code is DOM-free (`src/simulation`) and runs headless in the tests.

- **Fixed timestep.** The simulation advances in 1/60 s steps. 2x and 3x run more steps per frame
  and never use a larger step. Large frame gaps (for example a background tab) are clamped, and
  hiding the tab pauses the game.
- **Road network** (`LaneManager`, `RoadGeometry`, maps in `src/data/maps`). Right-hand traffic.
  Each road has its own lane count, median and lane types (busway, motorcycle lane). Junctions are
  square, but roads bend, slant and wind as they leave them: each arm has a centre line built from
  `straight` / `curve` shape ops, links between offset junctions become S-curves, and lanes are
  offset curves of the centre line. A lane's coordinate is the distance along its road's centre line,
  so parallel lanes stay in step. Roads stay straight for 14 m past each stop line. Turns follow
  Bézier curves. A vehicle's route is one continuous coordinate, so it can't teleport or reverse.
- **Car following** (`VehicleAI`). Intelligent Driver Model braking and acceleration with per-type
  limits, per-personality gaps and headways, reaction time (a start-up delay and a perception lag),
  and a comfortable cornering speed on bends.
- **Lane changes** (`LaneChange`). MOBIL-style: a driver changes lane when it gains enough speed
  without making the new follower brake hard, or when the lane ahead is blocked. The body slides
  across over a distance that grows with vehicle length, and stays a leader in the old lane until it
  has left it. Nobody swerves round a pedestrian crossing ahead.
- **Weather and time of day** (`Environment`). Rain lowers braking and speed and lengthens gaps;
  night slows reactions; a rush-hour curve can drive demand.
- **Emergency vehicles** go through on red after slowing down. They still need a free path through
  the box, and while one is within 60 m every other driver at that junction holds back, unless it is
  too late to stop or it is queued in front of the ambulance (it goes through to clear the way).
- **Zero-collision gate** (`CollisionAvoidance`). Every proposed move is swept in ≤ 0.2 m
  samples. The oriented-bounding-box distance to every nearby vehicle must stay at least 0.45 m.
  If it would not, the move is shortened by bisection, down to zero if needed. No personality can
  bypass this.
- **Intersection reservations** (`IntersectionManager`). The box, plus a margin past the stop lines,
  is a 0.5 m conflict grid. A vehicle may enter only when:
  - its signal permits the movement;
  - every grid cell its swept body needs is free;
  - a permissive left turn has a gap in oncoming traffic;
  - its exit has room for its length plus its following gap (the safe-entry rule).

  Impatient and aggressive drivers may break only the exit-space rule, which is what makes box
  blocking and gridlock happen. Pedestrians reserve their crosswalk line in the same grid, so a
  vehicle and a person can never hold the same space. Reserved cells are released as the vehicle's body leaves them. Box
  blocking is never allowed into the short link road between two intersections, so a circular,
  unrecoverable deadlock cannot form.
- **Signals** (`TrafficPhaseManager`). The state machine described in *How to play*: one phase
  per approach, plus a FLASH state. Only one phase is ever green. Under flashing yellow every
  approach is a STOP line, and a driver may enter only when no driver on a crossing path stopped at
  its line earlier. Arrival order is a strict order, so the waits never form a cycle.
- **Vehicles** (`src/data/vehicles.js`). Cars (with taxis and ride-hailing sedans), SUVs, pickups
  with a load in the back, motorcycles (some with a delivery box or a passenger), tricycles,
  multicabs, jeepneys, modern e-jeepneys, vans, buses (city, provincial, P2P), box, flatbed and
  garbage trucks, dump trucks, fuel and water tankers, ambulances and fire trucks. Looks vary per
  vehicle without touching the simulation's random stream. Every level's demand is scaled by
  `demandScale` (1.25).
- **Bike lanes.** A road profile can include a narrow (2.2 m) `bike` lane at the curb (España,
  Commonwealth, Avenida on Dalawang Pampang, the main street of Tatlong Kanto). Bicycles ride
  only there and never change lanes, and nobody else may enter it. Lanes may differ in width;
  offsets are cumulative.
- **Smooth movement.**
  - Drawing interpolates between simulation steps, along the route itself.
  - Long vehicles take their heading from their axles, so a bus swings its tail through a turn.
  - Lights fade in and out, and the camera zoom eases.
  - Acceleration is jerk-limited for comfort (braking that matters never is).
  - Turns have a cornering speed, so drivers slow before the turn.
  - Queues pull away together once the head moves.
  - Drivers signal before changing lanes and don't weave back.
  - Spawns follow each driver's headway.
  - Right-on-red, flashing-yellow and STOP-sign drivers roll through slowly when nothing at all is
    coming.
- **Box sharing.** A box cell still held by a moving vehicle that will have left it at least a
  second before another vehicle could get there doesn't block that vehicle's entry. The later
  vehicle then may not reach the shared cell until the first has released it. Waits only ever point
  to vehicles that entered earlier, so they can't form a cycle.
- **Pedestrian window.** People hold only the crosswalk around and just ahead of them (2.5 m), so a
  car may cross while they are still on the far half. If a vehicle holds the stretch ahead, they
  wait where they stand. After 1 s they claim the rest of the crossing so nobody new cuts in.
- **Off-screen spawning.** Every external road is extended until its lanes run past the largest
  area the camera may show, and the camera can't zoom out or pan beyond that area. Vehicles
  enter from beyond the screen edge and leave past it.
- **Rivers** (`River`, `RiverRenderer`). A smooth centre line with a width. Roads cross it on
  bridges that are ordinary road to the simulation; jaywalkers never cross on a bridge.
- **Pedestrians** (`PedestrianManager`). Crowds gather at the crosswalk corners and cross on their
  walk light (hurrying when it starts to blink), reserving their line in the conflict grid. Tired of
  waiting, some cross on red once no vehicle is about to enter. Pasaway jaywalkers cross mid-block
  only when every vehicle heading for that spot can stop comfortably; while they cross they block
  each lane until they have passed it. Strollers walk the sidewalks, round corners and across the
  map. Pedestrians use their own random stream, so traffic on levels without them is unchanged.
- **Gridlock detection** (`GridlockDetector`) classifies NORMAL, HEAVY, PARTIAL_BLOCK, GRIDLOCK and
  RECOVERY. An approach counts as blocked only when its light is **green** and nothing has crossed
  its stop line for 6 s. Queues at a red light, and drivers giving way to oncoming traffic, an
  emergency vehicle or people on the crosswalk, are never treated as gridlock.
- **Congestion sources:** curbside jeepney and bus loading stops, scripted blockages, and a
  per-exit downstream discharge rate (the next junction off-map) that can back a road up into the
  box.

## Project structure

```
src/
  main.js, styles.css
  game/        Game (shell), GameLoop, GameState, Camera, LevelManager
  simulation/  TrafficSimulator, TrafficPhaseManager, TrafficLightController, Vehicle, VehicleAI,
               VehicleSpawner, LaneManager, RoadGeometry, River, LaneChange, IntersectionManager,
               CollisionAvoidance, GridlockDetector, PedestrianManager, Environment, ScoringSystem
  rendering/   Renderer, RoadRenderer (+ roadShapes), RiverRenderer, VehicleRenderer,
               PedestrianRenderer, TrafficLightRenderer, EffectsRenderer, WeatherRenderer
  input/       InputManager
  audio/       AudioManager (procedural Web Audio horns, sirens, whistle, engine rumble and diesel
               chug; separate sound-effect and music buses), MusicPlayer (procedural lo-fi music)
  ui/          HUD, Menu, Settings, ResultsScreen
  data/        config, vehicles, levels, maps/ (generic training maps and Philippine roads)
  utils/       math (RNG, paths, Bézier, OBB), storage (validated save data)
tests/         phase manager, collision geometry/gate, gridlock detector, simulation integration,
               maps and road geometry, emergency vehicles, weather and lane changes, pedestrians,
               game loop + save validation, and a collision-free soak run of every level
```

## Testing

`npm test` runs over 130 tests, including:

- signal ordering, redirecting and cancelling changes, click spam, and a 10-minute random fuzz
  that never shows two greens;
- collision geometry, the swept gate, crossing traffic and side-by-side lanes;
- vehicles stopping at red, braking without emergency stops, smooth turns, and patient drivers never
  blocking the box;
- vehicles getting trapped in the box while cross traffic stays separated, and honking rising
  during delays;
- queues growing when downstream capacity is exhausted, and recovery after a blocked exit reopens;
- deterministic restarts, objectives and end conditions, save validation and migration;
- curved lanes that are continuous, parallel and straight near every junction, and drivers slowing
  for bends;
- emergency vehicles crossing on red while cross traffic gives way;
- lane changes and rain at night staying collision-free;
- pedestrians: never within reach of a vehicle (crowds, jaywalkers and aggressive drivers on every
  map), crossing only on walk unless pasaway, drivers stopping for jaywalkers without slamming the
  brakes, strollers staying off the lanes;
- a 100-second soak of every career, Pinoy Roads, Endless (per map) and challenge level with random
  signal switching.

On every simulated step the soak and integration tests assert:

- no two vehicles closer than the safety buffer;
- no vehicle moves backwards or jumps;
- vehicles are removed only at the end of their route;
- there are never conflicting greens.

## Known limitations

- One phase per approach; there is no way to pair compatible roads into one green.
- Zooming out is limited to the area where roads still carry traffic.
- Motorcycles don't lane-split.
- Junctions are always square (four-way or T); only the roads between them bend.
- People are drawn a little larger than life so they are visible at the default zoom.
- Audio, including the chill lo-fi background music (its mood follows the screen, rain, night and
  gridlock), is synthesized with the Web Audio API (no recorded samples). It starts after the first
  click or key press because of browser autoplay rules.
- Rivers are scenery: there is no flooding, and boats don't interact with traffic.
- Level targets were tuned against a simple queue-balancing controller in headless runs, not through
  human playtesting.
- The game is built for touch and mouse; there are no gamepad controls.

## Assets

All graphics are drawn procedurally on the canvas and all sounds are synthesized at runtime. No
third-party art or audio is included.
