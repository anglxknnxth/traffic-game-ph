# Traffic Control Philippines

A top-down (strict bird's-eye) traffic signal management game set in a fictional Metro Manila
*kanto*. You operate the traffic lights while autonomous cars, jeepneys, tricycles, motorcycles,
buses, trucks, vans, ambulances and fire trucks try to get through. Drivers have personalities:
patient, impatient and aggressive. They honk, creep forward and sometimes squeeze into the
intersection with nowhere to go. Real gridlock builds up from the simulation itself.

**Vehicles never collide.** They can block each other, but every movement passes a predictive
collision gate before it is applied.

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

Deep links for quick testing: `?play=career:7`, `?play=challenge:c1`, `?play=endless`.

## How to play

North–South and East–West take turns. Request a change and the light runs
**GREEN → YELLOW (1.5 s) → ALL-RED (2 s, longer while vehicles are still clearing) → next GREEN**.
Every green lasts at least 5 s. Extra clicks cannot skip any of these steps, and a request made
during the minimum green is queued and counted as an early request (a small safety penalty).

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Request North–South green | `N–S` button, a north/south signal head | `1` or ↑ / ↓ |
| Request East–West green | `E–W` button, an east/west signal head | `2` or ← / → |
| Intersection B (level 9) | its own button pair | `3` / `4` |
| Toggle the phase | tap the yellow box in the middle | |
| Pause / resume | pause button | `Space` / `P` / `Esc` |
| Restart | restart button | `R` |
| Speed 1x / 2x / 3x | speed buttons | `F` (cycles) |
| Mute | speaker button | `M` |
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
- A blue pulsing ring around a signal means an emergency vehicle needs that phase.

### Modes

- **Career:** ten levels that add mechanics one by one: light traffic, more cars, motorcycles,
  jeepneys and tricycles with curbside loading stops, turns and blocked exits, impatient drivers,
  rush-hour gridlock, emergency vehicles, two connected intersections, and a final high-density
  challenge. Clearing a level unlocks the next one.
- **Endless:** demand grows every minute. The run ends when congestion stays at 85% or more for
  30 s.
- **Challenges:** five scenarios: clear an existing gridlock, keep waits low, handle ambulances,
  sustain flow under heavy demand, and recover from a blocked exit.
- **Tutorial:** a guided first run of Level 1.

### Scoring

Points come from vehicles moved, low waiting times, fast emergency response and recovering from
gridlock. Penalties come from time spent gridlocked or partially blocked, excessive waits, early
signal requests, box-blocking entries and slow emergency response. Safety carries the most weight:
the base score is multiplied by the safety rating, and the safety rating adds a bonus of up to 400.

Progress, best scores, stars, completed challenges and audio settings are saved in `localStorage`.
The game still works when storage is unavailable; progress then lasts only for the session.

## How the simulation works

All simulation code is DOM-free (`src/simulation`) and runs headless in the tests.

- **Fixed timestep.** The simulation advances in 1/60 s steps. 2x and 3x run more steps per frame
  and never use a larger step. Large frame gaps (for example a background tab) are clamped, and
  hiding the tab pauses the game.
- **Road network** (`LaneManager`). Right-hand traffic with two lanes per approach: the inner lane
  goes straight or left, the outer lane straight or right. Turns follow Bézier curves. A vehicle's
  route is one continuous arc-length coordinate, so it can't teleport or reverse.
- **Car following** (`VehicleAI`). Intelligent Driver Model braking and acceleration with per-type
  limits and per-personality gaps and headways.
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
  blocking and gridlock happen. Reserved cells are released as the vehicle's body leaves them. Box
  blocking is never allowed into the short link road between two intersections, so a circular,
  unrecoverable deadlock cannot form.
- **Signals** (`TrafficPhaseManager`). The state machine described in *How to play*. Only one
  protected group is ever green.
- **Gridlock detection** (`GridlockDetector`) classifies NORMAL, HEAVY, PARTIAL_BLOCK, GRIDLOCK and
  RECOVERY. An approach counts as blocked only when its light is **green** and nothing has crossed
  its stop line for 6 s. Queues at a red light are never treated as gridlock.
- **Congestion sources:** curbside jeepney and bus loading stops, scripted blockages, and a
  per-exit downstream discharge rate (the next junction off-map) that can back a road up into the
  box.

## Project structure

```
src/
  main.js, styles.css
  game/        Game (shell), GameLoop, GameState, Camera, LevelManager
  simulation/  TrafficSimulator, TrafficPhaseManager, TrafficLightController, Vehicle, VehicleAI,
               VehicleSpawner, LaneManager, IntersectionManager, CollisionAvoidance,
               GridlockDetector, ScoringSystem
  rendering/   Renderer, RoadRenderer, VehicleRenderer, TrafficLightRenderer, EffectsRenderer
  input/       InputManager
  audio/       AudioManager (procedural Web Audio horns, sirens, engine rumble)
  ui/          HUD, Menu, Settings, ResultsScreen
  data/        config, vehicles, levels
  utils/       math (RNG, paths, Bézier, OBB), storage (validated save data)
tests/         phase manager, collision geometry/gate, gridlock detector, simulation integration,
               game loop + save validation, and a collision-free soak run of every level
```

## Testing

`npm test` runs 51 tests, including:

- signal ordering, minimum green, the all-red extension, click spam, and a 10-minute random fuzz
  that never shows two greens;
- collision geometry, the swept gate, crossing traffic and side-by-side lanes;
- vehicles stopping at red, braking without emergency stops, smooth turns, and patient drivers never
  blocking the box;
- vehicles getting trapped in the box while cross traffic stays separated, and honking rising
  during delays;
- queues growing when downstream capacity is exhausted, and recovery after a blocked exit reopens;
- deterministic restarts, objectives and end conditions;
- a 100-second soak of all 16 levels and challenges with random signal switching.

On every simulated step the soak and integration tests assert:

- no two vehicles closer than the safety buffer;
- no vehicle moves backwards or jumps;
- vehicles are removed only at the end of their route;
- there are never conflicting greens.

## Known limitations

- Two signal phases (N–S and E–W) with permissive left turns; there are no protected left-turn
  arrows and no right turn on red.
- Vehicles don't change lanes and motorcycles don't lane-split; each vehicle picks its lane when it
  spawns.
- No pedestrians. Crosswalks are visual only.
- Audio is synthesized with the Web Audio API (no recorded samples). It starts after the first
  click or key press because of browser autoplay rules.
- Level targets were tuned against a simple heuristic controller in headless runs, not through human
  playtesting.
- The game is built for touch and mouse; there are no gamepad controls.

## Assets

All graphics are drawn procedurally on the canvas and all sounds are synthesized at runtime. No
third-party art or audio is included.
