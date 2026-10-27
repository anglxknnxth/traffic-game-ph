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
`?play=endless` or `?play=endless:edsa` (Endless on a given map), `?play=chill:metro` (Chill on
the Metro Manila map) or `?play=growing` (Lumalaking Lungsod). On the dev server, `&ff=60`
fast-forwards 60 s, `&zoom=2&x=0&y=-46` frames the camera, `&enf=A` stations an enforcer at A and
`&cone=A:S` cones off a contraflow lane beside A's South road.

## How to play

Every road into a junction has **its own green**: when the North road is green, the South road
(and everything else) is red. A green road releases all of its movements (straight, left and
right). Request a change and the light runs **GREEN → YELLOW (1.2 s) → ALL-RED (0.8 s) → next
GREEN** straight away, 2 seconds in all. A change in progress can be redirected to another road, or
cancelled during yellow. Clicks can never skip yellow or all-red.

**Paired greens.** While one road is green, tap the road **opposite** it and both go together:
the green road's left turn goes yellow, then red, and 2 s later the opposite road turns green for
straight and right only. While paired, nobody turns left (left turners wait at the head of their
lane). Tap one of the pair again to keep only that road (the other goes yellow, and the left turn
comes back). Tap a cross road and both turn yellow, then red, then the cross road gets its green.

**Right turn on red is always allowed** ("right turn anytime with care"): a driver turning right
at a red light stops at the line, then turns when the traffic that has green leaves a gap (about
3 s). They never squeeze into the box without exit space. Drivers going straight keep out of the
curb lane where they can, so the right turners behind them are not stuck.

**Flashing yellow** (the `⚠ Flash` button or `Y`) turns every light at a junction to blinking
amber: each driver stops at the line, then goes in arrival order when the way is clear, like an
all-way stop. It suits light traffic and quiet nights; at rush hour it is slow. Pick any road's
button to go back to normal greens (after a short all-red).

Pedestrians get the walk light only on the crosswalk to the **right** of a green road (North
green: the West crosswalk; North and South green: West and East). The green road's straight and
left traffic never drives over a crosswalk that shows WALK; its right turners wait for the people. Switch too soon
after a walk light and the late walkers are still on the crosswalk when your new green starts. Keep
people waiting too long and some cross on red anyway. Under flashing yellow people cross in gaps,
taking turns with the drivers stopped at the lines.

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Green for one road | its button, or its signal head | `1` … `4` (N, E, S, W) or the arrow keys |
| Pair with the opposite road | tap the opposite road's button or light | its number key |
| Other intersections | their own buttons (a tab per junction when there are many) | `5` … `9`, or the junction shown |
| Wave a stuck vehicle through | tap a vehicle with an orange **!** | |
| AUTO lights (Chill, Metro, growing city) | `AUTO` per junction, `AUTO` all | |
| Watch mode / follow a vehicle | 👁 button, then tap a vehicle | `H`, `Esc` to stop |
| Monitor panel / speed heatmap | 📡 / 🌡️ buttons | `T` / `O` |
| HULI! a violator | tap a vehicle with a red **!** | |
| Station / move an enforcer | 👮 button, then tap a junction | `Esc` cancels the tool |
| Cone off a contraflow lane | 🚧 button, then tap an undivided road | |
| Patawid (all traffic stops for people) | `🚸 Patawid` on that junction's panel (enforcer needed) | |
| Padaanin (wave a red lane's front vehicle through) | tap it, at a junction with an enforcer | |
| Saway a jaywalker / call a tow truck | tap the person waiting at the curb / the stalled vehicle | |
| Next road | tap the yellow box in the middle | |
| Flashing yellow on / off | `⚠ Flash` button | `Y` (junction under the cursor, or the first) |
| Pause / resume | pause button | `Space` / `P` / `Esc` |
| Restart | restart button | `R` |
| Speed 1x – 4x | speed buttons | `F` (cycles) |
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
- A blue pulsing ring around a signal means an emergency vehicle is coming on that phase. A callout
  points at the vehicle ("Give EDSA ↓ the green"), or an arrow on the screen edge when it is off
  screen. Emergency vehicles go through on red from an empty stop line (after slowing down), and
  only traffic whose path crosses theirs gives way. Drivers in front of them never run the red: they
  move over if they can, and a queue at a red needs your green.
- An orange **!** over a vehicle means it is stuck in or at the box. Tap it and it goes ahead (the
  path is cleared for it for 10 s); you can also leave it, it clears on its own.
- Signal heads have a Manila-style LED countdown: seconds of green so far, or the count to the
  change.
- Small walk / don't-walk lights stand at each crosswalk; they blink orange during yellow and
  flashing yellow.
- A jeepney or tricycle with its hazards on and a "PARA PO!" bubble has stopped right at the
  corner, inside the junction, to let passengers off. Traffic crossing its path waits until it
  pulls away (3–7 s).
- Rivers run under bridges (parapets, a name plaque), with bangka boats passing underneath.
- "PASAWAY!" and a whistle mean someone is crossing where (or when) they shouldn't.
- Rain, dusk and night change how drivers behave: longer gaps, gentler braking, slower starts. At
  night headlights throw beams and windows light up; on wet roads the signals reflect.
- Blue MMDA street-name signs, "BAWAL MAGBABA DITO" signs, tangled overhead wires, jeepney route
  boards and diesel smoke.
- A "LANE ENDS" lane drop: the curb lane is hatched off, and drivers zipper into the next lane.
- **Counterflow** ("singit sa kontra") on roads with no median: an aggressive rider (now and then a
  private car or a jeepney) swings into the oncoming lane to overtake a few vehicles, then cuts back
  in. Oncoming traffic stops for it. It gets a red **!**: tap it (HULI!) and it goes straight back
  into its own lane. An ambulance or fire truck stuck behind a queue also uses the oncoming lane
  (legally), and oncoming drivers pull over.
- **Traffic enforcers** (👮, two per level): stationed at a junction, drivers within 40 m behave (no
  counterflow, no jeepney stops inside the box, hardly any box blocking or late yellow runs) and an
  emergency vehicle is given way twice as far out. With an enforcer there you can call **Patawid**
  (every crosswalk walks for 12 s, then the green comes back) or wave the front vehicle of a red
  lane through when nothing crossing is coming. Anywhere you can HULI! violators (counterflow,
  beating the red, blocking the box, unloading inside the junction), send a waiting jaywalker to
  the crosswalk, and call a tow truck for a stalled vehicle (cleared in 8 s).
- **Contraflow lane** (🚧): the enforcers cone off the oncoming inner lane beside a queue, on any
  road with two oncoming lanes, right up to the junction, for as long as you like. The cones go up
  one by one; oncoming traffic that would have used that lane takes the next one, and once the lane
  is clear queued drivers use it to drive up to the stop line and go on their own green. Tap the
  cones (or the road again with 🚧) to take them away: nobody new goes in, the last ones finish,
  and the cones come down.
- Pasaway riders (and now and then a car) who have waited long enough swing out and overtake: into
  a gap in the queue, or all the way up to the stop line. Ambulances and fire trucks ignore the
  centre line: held up for a moment, they go up the oncoming lane (never over a concrete median).
- Notices come over the radio, a news ticker runs along the bottom, and commuters post about the
  roads you are running.
- The screen is an MMDA command center: a live CCTV frame over the map (LIVE, the camera named
  after the junction in view, a running timestamp, scanlines and grain), steel signal controllers
  with LED lamps and a countdown readout, and every panel in one column on the left. Roads carry
  DPWH-style worn thermoplastic paint (broken white lane lines, double yellow, solid lines before
  the stop line) that follows every bend; buildings cast shadows by their height and trees are
  layered canopies or coconut palms.

### Modes

- **Career:** ten levels that add mechanics one by one: light traffic, more cars, motorcycles,
  jeepneys and tricycles with curbside loading stops, turns and blocked exits, impatient drivers,
  rush-hour gridlock, emergency vehicles, two connected intersections, and a final high-density
  challenge. Clearing a level unlocks the next one.
- **Pinoy Roads:** maps inspired by real Philippine roads, unlocked one after another:
  Poblacion (a town plaza with STOP-sign barangay roads and a river), Taft under the LRT-1 (two
  signals, lots of students), España in the rain, Commonwealth (motorcycle lane and a U-turn slot),
  EDSA (Carousel busway, MRT-3, dusk into night), Liko-Liko (a mountain S-bend over a river),
  Tatlong Kanto (three signals: build a green wave), Dalawang Pampang (a signal on each bank of a
  city river: one skewed bridge, then a riverside street on the far bank), Sa Highway (side streets
  that join MacArthur Highway with no light, and a lane that ends) and Grid ng Maynila (four signals).
  Sixteen more follow (`src/data/maps/buhayKalsada.js`), each with its own road layout: Ayala–EDSA
  (footbridge, underpass, a U-turn slot, an offset T at Paseo de Roxas), Ortigas on payday (an L
  around the malls), Quiapo with its procession (a triangle round the church), Baclaran (a T on the
  bay, a U-turn slot and a yield), Cubao when the game lets out (an upside-down T), C5–Kalayaan
  (staggered T-junctions), Masinag (a yield up the side road), Alabang on Undas (a fork), Quezon
  Ave–España (a dogleg), Session Road (a hairpin), Cebu at Sinulog (a staircase), Intramuros with
  kalesas (a square of one-lane streets), disciplined Davao (a three-light crescent), Diversion Road
  in Iloilo (an underpass), the Tagaytay ridge (a crossroads with no lights) and Bacolod at MassKara
  (yields on both sides of one signal).
- Every mode has the same street life: people crossing at the lights and the odd jaywalker, a
  clock and changing weather (lighter in the first career levels).
- **Endless:** demand grows every minute through the afternoon rush into the night, with passing
  rain, and anything can happen: breakdowns and road works, emergencies, school letting out, waves
  of jeepneys stopping at the corners. Pick any map. The run ends when congestion stays at 85% or
  more for 30 s.
- **Chill Endless:** the same, but there is no game over, even in gridlock. Any signal can be handed
  to AUTO (a queue-balancing controller that also pairs opposite roads and answers emergencies);
  tap a light to take it back (MANUAL). Watch mode hides the controls and lets the camera find the
  action.
- **Metro Manila map** (pick it in Chill Endless, or play Lumalaking Lungsod): the big map, about
  1.2 × 0.8 km, every light on AUTO to start in Chill. Junctions are scattered like a real city (no
  grid): EDSA (busway, MRT-3, U-turn slot) and Taft (LRT-1) sway under their rail lines, the Quezon
  Ave underpass dives under EDSA, the elevated Skyway sweeps over the city with its toll plaza and
  ramps down to Aurora and Shaw, the Pasig river meanders under angled bridges, and there is a
  plaza, a simbahan, a barangay court, a palengke, a mall and a riverside promenade, plus barangay
  streets with no lights and a lane drop on Shaw.
- **Lumalaking Lungsod:** the Metro Manila map opens district by district. You start with one
  junction; at 60, 160 and 300 vehicles through the next district opens (EDSA corridor, Taft, the
  Skyway) and more traffic arrives. Junctions not yet open run on AUTO under a construction haze.
  No game over.
- **Challenges:** five scenarios: clear an existing gridlock, keep waits low, handle ambulances,
  sustain flow under heavy demand, and recover from a blocked exit.
- **Tutorial:** a guided first run of Level 1.

### Scoring

Points come from vehicles moved, low waiting times, fast emergency response, recovering from
gridlock and pedestrians helped across. Penalties come from time spent gridlocked or partially
blocked, excessive waits, box-blocking entries, slow emergency response, people kept waiting at
the crosswalk for more than 45 s, and people who gave up and crossed on red. Safety carries the most weight:
the base score is multiplied by the safety rating, and the safety rating adds a bonus of up to 400.

Progress, best scores, stars, completed challenges and settings (sound-effect and music volume,
music on/off, rain and pedestrians on/off) are saved in `localStorage`. **Settings → Ulan / Mga
tao** turn off the rain showers and the pedestrians in every mode (from the next game started);
pedestrian objectives are then dropped.
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
  the box. While one is within 60 m (and moving, or close), drivers whose paths cross or merge into
  its path hold back; everyone else keeps going. Drivers queued ahead of it never run the red; they
  move into another lane if they can, and the emergency vehicle looks for a clearer lane too.
- **Paired greens** (`TrafficPhaseManager`). The green is one road, or two opposite roads with
  their left turns (and U-turns) on red. Adding the opposite road clears the left turn first
  (yellow, then red); dropping one road of a pair takes it through yellow and red before the other
  gets its left turn back. Conflicting greens are checked on every test step.
- **AUTO lights** (`Autopilot`). Per signal: it compares the queues every second, switches when
  another road (or pair) needs it clearly more or the green has run long, gives any road waiting
  45 s its turn, pairs opposite roads only when no left turner is waiting at the front, and gives an
  emergency vehicle its green. It asks for changes through the normal requests, so yellow and
  all-red always run.
- **Grade separation.** A node can sit on another level (the Skyway is level 1); a link between
  levels is a ramp (0.5); lanes of type `tunnel` pass under a node marked `underpass` (a walled
  trench at -0.5, under the junction at -1). The collision gate only compares vehicles whose levels
  differ by less than 1. Under the junction the tunnel lanes need no light and no box reservation.
- **Merges, toll plaza, lane drops.** Ramp junctions are rolling yields (give way, no full stop). At
  a `toll` node every driver stops at a booth (shorter in the ETC lane by the median). A map
  `laneDrops` entry ends a lane before a junction: drivers merge well before the end, and the
  driver right behind a waiting merger lets them in (zipper).
- **Stuck vehicles.** Clicking a vehicle stuck in or at the box gives it a 10 s pass: it may enter
  without the usual exit-space courtesy, crossing traffic gives way to its path, and the queue ahead
  of it drains past the downstream gate. The collision gate still applies.
- **Random events** (`EventScheduler`, endless modes): breakdowns and road works on random exit
  lanes, school out (a rush at the crosswalks), jeepney waves.
- **Counterflow** (`Counterflow`). The vehicle never leaves its own lane in the simulation: it
  keeps its route coordinate and slides sideways into the oncoming inner lane, and every sideways
  step must pass the collision gate. Before it swings out it reserves the stretch of the oncoming
  lane it will use (a blockage oncoming traffic stops at), only when nothing is in that stretch or
  too close to stop. It only goes for a real gap in the queue ahead, at least 18 m before the stop
  line; the driver it ends up in front of sees it as their leader and holds back, and it slides
  back once the space beside it is clear. Caught (HULI!) or out there for 15 s, it stops advancing
  and slides back as soon as it fits. One at a time on a stretch of road. Emergency vehicles run
  up to the stop line and ease back across the box once their whole body is past the line.
- **Enforcement** (`Enforcement`): violations are recorded as they happen (counterflow, red-light
  runs at the stop line, box-blocking squeezes, corner stops inside the box) and stay catchable
  for a few seconds. Patawid holds the signal in all-red for 12 s (crosswalks show walk), then
  returns the green to the road that had it.
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
- **Congestion sources:** curbside jeepney and bus loading stops, scripted and random blockages,
  and a downstream discharge rate on exits that show a "NEXT JUNCTION" gate (the next junction
  off-map), which can back a road up into the box. Every other exit drains freely off the map.

## Project structure

```
src/
  main.js, styles.css
  game/        Game (shell), GameLoop, GameState, Camera, LevelManager, Director (watch mode)
  simulation/  TrafficSimulator, TrafficPhaseManager, TrafficLightController, Autopilot, Vehicle,
               VehicleAI, VehicleSpawner, LaneManager, RoadGeometry, River, LaneChange,
               IntersectionManager, CollisionAvoidance, GridlockDetector, PedestrianManager,
               Environment, EventScheduler, CityGrowth, Counterflow, Enforcement, ScoringSystem
  rendering/   Renderer, RoadRenderer (+ roadShapes), TextureBank, RiverRenderer, VehicleRenderer,
               PedestrianRenderer, TrafficLightRenderer, EffectsRenderer, WeatherRenderer
  input/       InputManager
  audio/       AudioManager (procedural Web Audio horns, sirens, whistle, engine rumble and diesel
               chug; separate sound-effect and music buses), MusicPlayer (procedural lo-fi music)
  ui/          HUD, Monitor, Menu, Settings, ResultsScreen
  data/        config, vehicles, levels, maps/ (generic training maps and Philippine roads)
  utils/       math (RNG, paths, Bézier, OBB), storage (validated save data)
tests/         phase manager, collision geometry/gate, gridlock detector, simulation integration,
               maps and road geometry, emergency vehicles, weather and lane changes, pedestrians,
               game loop + save validation, new features (walk lights, right on red, paired
               greens, waving a stuck vehicle through, lane drops, the Metro levels, AUTO lights,
               modes, map layout), and a collision-free soak run of every level
```

## Testing

`npm test` runs 164 tests, including:

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
- counterflow staying collision-free with HULI! sending riders back, a contraflow lane opening
  behind its cones and getting used, patawid and padaanin needing an enforcer, and the rain /
  people options;
- walk lights never on a green road's straight or left path; right turns on red happening;
  nobody turning left on a paired green; a waved-through vehicle getting moving;
- the lane drop (nobody past the end of the lane), Metro Manila with traffic on every level (the
  Skyway, the toll plaza, the ramps and the underpass), AUTO lights serving every road, Chill never
  ending, the growing city opening districts, and no two roads on the same level running into each
  other;
- a 100-second soak of every career, Pinoy Roads, Endless (per map) and challenge level with random
  signal switching.

On every simulated step the soak and integration tests assert:

- no two vehicles closer than the safety buffer;
- no vehicle moves backwards or jumps;
- vehicles are removed only at the end of their route;
- there are never conflicting greens.

## Known limitations

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

Graphics are drawn procedurally on the canvas (textures included) and all sounds are synthesized
at runtime. Every map also uses eight photo textures (asphalt, paving, grass, soil,
corrugated roofing, clay tiles, concrete) from [ambientCG](https://ambientcg.com), released under
CC0 1.0 (public domain); see `public/textures/metro/CREDITS.txt`. If they can't be loaded, the
procedural textures are used. The HUD uses the Overpass and Share Tech Mono fonts from Google Fonts (with system font
fallbacks).
