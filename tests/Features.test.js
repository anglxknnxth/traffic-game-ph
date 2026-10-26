import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { Network } from '../src/simulation/LaneManager.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { makeLevel } from '../src/data/levels.js';
import { MAPS } from '../src/data/maps/index.js';
import { SIM_DT, ARMS, DIRS, SIDEWALK_WIDTH } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';
import { playerPhaseRequest } from '../src/simulation/TrafficPhaseManager.js';

const MIN_SEP = 0.44;
const lm = new LevelManager();

/** Steps the sim, failing on any separation violation or conflicting greens. */
function run(sim, seconds, onStep, auditEvery = 3) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(SIM_DT);
    onStep?.(sim, i);
    expect(sim.lights.conflictingGreens()).toBe(0);
    if (i % auditEvery === 0) {
      const issues = CollisionAvoidance.auditPairs(sim.vehicles, MIN_SEP);
      if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
    }
  }
}

const mixed = (over = {}) =>
  makeLevel({
    prewarm: 0,
    demandScale: 1,
    cornerStops: 0,
    demand: { N: 9, S: 9, E: 9, W: 9 },
    mix: { car: 0.5, motorcycle: 0.25, jeepney: 0.15, bus: 0.05, truck: 0.05 },
    personalities: { patient: 0.4, impatient: 0.4, aggressive: 0.2 },
    turns: { left: 0.2, right: 0.25 },
    ...over,
  });

/** Exit arm of a movement from approach arm X (right-hand traffic). */
function exitArm(X, move) {
  const d = { x: -DIRS[X].x, y: -DIRS[X].y };
  const v = move === 'straight' ? d : move === 'left' ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
  return ARMS.find((a) => Math.abs(DIRS[a].x - v.x) < 1e-6 && Math.abs(DIRS[a].y - v.y) < 1e-6);
}

describe('Crosswalk walk lights', () => {
  it('a WALK crosswalk is never on the straight or left path of a green road', () => {
    const sim = new TrafficSimulator(mixed({ pedestrians: { cross: 4, jaywalk: 0, strollers: 0 } }), { seed: 3 });
    const rng = new Rng(2);
    let walks = 0;
    run(sim, 120, (s, i) => {
      if (i % 600 === 0) {
        const m = s.lights.manager('A');
        const g = rng.pick(m.groups);
        s.requestPhase('A', g);
        if (rng.chance(0.5)) s.requestPhase('A', m.oppositeOf(g));
      }
      if (i % 10) return;
      for (const c of s.peds.crossings) {
        if (s.peds.walkState(c) !== 'walk') continue;
        walks++;
        for (const arm of ARMS) {
          if (!c.I.approachLanes[arm]) continue;
          if (s.lights.signal('A', arm, 'straight') !== 'red') {
            expect(arm).not.toBe(c.arm);
            expect(exitArm(arm, 'straight')).not.toBe(c.arm);
          }
          if (s.lights.signal('A', arm, 'left') !== 'red') expect(exitArm(arm, 'left')).not.toBe(c.arm);
        }
      }
    });
    expect(walks).toBeGreaterThan(50);
  });
});

describe('Right turn on red', () => {
  it('happens at a busy red, collision-free', () => {
    const sim = new TrafficSimulator(mixed({ demand: { N: 4, S: 4, E: 12, W: 12 }, turns: { left: 0.05, right: 0.45 }, initialGroups: { A: 'N' } }), { seed: 5 });
    run(sim, 90, (s, i) => {
      if (i === 30 * 60) s.requestPhase('A', 'S');
    });
    expect(sim.stats.rightOnRed || 0).toBeGreaterThan(0);
  });
});

describe('Paired greens in traffic', () => {
  it('while opposite roads share the green, nobody turns left on it', () => {
    const sim = new TrafficSimulator(mixed({ demand: { N: 12, S: 12, E: 2, W: 2 } }), { seed: 7 });
    sim.requestPhase('A', 'S'); // N is green: add S
    let leftOnPair = 0;
    run(sim, 90, (s) => {
      const m = s.lights.manager('A');
      for (const v of s.vehicles) {
        const res = v.reservations.get('A');
        if (!res || res.checked) continue;
        res.checked = true;
        if (res.conn.movement === 'left' && m.pair?.stage === 'on' && !v.emergency) leftOnPair++;
      }
    });
    expect(leftOnPair).toBe(0);
    // Left turners wait at the head of their lane while the pair runs (that is the trade-off).
    expect(sim.stats.processed).toBeGreaterThan(5);
  });
});

describe('Waving a stuck vehicle through', () => {
  it('a clicked box-blocker gets moving again, collision-free', () => {
    const sim = new TrafficSimulator(
      mixed({
        demand: { N: 0, S: 24, E: 12, W: 12 },
        personalities: { aggressive: 1 },
        boxBlockFactor: 2,
        initialGroups: { A: 'S' },
        blockages: [{ exit: 'A:N', lanes: [0, 1], s: 3, start: 0, end: 40, label: 'TEST' }],
      }),
      { seed: 4 },
    );
    let stuck = null;
    run(sim, 60, (s) => {
      if (!stuck) stuck = s.vehicles.find((v) => s.isStuck(v) && v.segment.kind === 'connector' && v.stoppedTime > 3) || null;
    });
    expect(stuck).not.toBeNull();
    // The exit reopened at t=40; now the player waves it through.
    const before = stuck.s;
    expect(sim.grantPass(stuck) || sim.vehicles.includes(stuck) === false || stuck.v > 0.5).toBe(true);
    run(sim, 10);
    expect(!sim.vehicles.includes(stuck) || stuck.s > before + 2).toBe(true);
  });
});

describe('Lane drop (3 lanes become 2)', () => {
  it('everyone merges before the lane ends, collision-free', () => {
    const lvl = lm.get('pinoy', 'serbisyo');
    const sim = lm.createSim({ ...lvl, autoLights: true, fail: null }, 6);
    const drop = sim.network.laneDrops[0];
    let past = 0;
    run(sim, 150, (s) => {
      for (const v of drop.lane.vehicles) if (v.localS + v.hl > drop.s + 0.3) past++;
    });
    expect(past).toBe(0);
    expect(sim.laneChanger.changes).toBeGreaterThan(10);
    expect(sim.stats.processed).toBeGreaterThan(20);
  });
});

describe('Metro Manila: skyway, toll plaza, underpass', () => {
  it('runs collision-free with traffic on every level, and levels never interact', () => {
    const sim = lm.createSim({ ...lm.get('chill', 'metro'), prewarm: 0 }, 11);
    const seen = { under: 0, sky: 0, toll: 0, ramp: 0 };
    let overpass = 0;
    run(sim, 150, (s, i) => {
      if (i % 30) return;
      for (const v of s.vehicles) {
        if (v.segment.under) seen.under++;
        if (v.layer === 1) seen.sky++;
        if (v.layer === 0.5) seen.ramp++;
        if (v.segment.kind === 'connector' && v.segment.intersection.kind === 'toll') seen.toll++;
      }
      // Vehicles on different levels pass right over each other (the gate ignores them)
      for (const v of s.vehicles) {
        if ((v.layer || 0) < 1) continue;
        for (const o of s.vehicles) {
          if (Math.abs((o.layer || 0) - v.layer) >= 1 && Math.hypot(o.x - v.x, o.y - v.y) < 3) overpass++;
        }
      }
    }, 4);
    expect(seen.sky).toBeGreaterThan(0);
    expect(seen.toll).toBeGreaterThan(0);
    expect(seen.ramp).toBeGreaterThan(0);
    expect(seen.under).toBeGreaterThan(0);
    expect(overpass).toBeGreaterThan(0);
    expect(sim.stats.processed).toBeGreaterThan(20);
  });
});

describe('AUTO lights', () => {
  it('serve every road with traffic within about a minute and never show conflicting greens', () => {
    const sim = lm.createSim({ ...lm.get('career', 7), autoLights: true, fail: null, counterflow: { moto: 0, car: 0, emergency: false } }, 3);
    const lastGreen = new Map();
    let worst = 0;
    run(sim, 240, (s, i) => {
      if (i % 30) return;
      const m = s.lights.manager('A');
      for (const g of m.groups) if (m.signalForGroup(g) === 'green') lastGreen.set(g, s.time);
      const p = s.metrics.perIntersection[0];
      for (const a of p?.approaches || []) {
        const g = m.phaseFor(a.arm);
        if (a.queue > 2 && s.time > 30) worst = Math.max(worst, s.time - (lastGreen.get(g) ?? 0));
      }
    }, 6);
    expect(worst).toBeLessThan(75);
    expect(sim.stats.processed).toBeGreaterThan(60);
  });

  it('a player request takes that signal over (MANUAL)', () => {
    const sim = lm.createSim({ ...lm.get('chill', 'grid'), autoLights: true }, 3);
    expect(sim.autopilot.allAuto).toBe(true);
    sim.autopilot.onPlayerInput('A');
    expect(sim.autopilot.isAuto('A')).toBe(false);
    expect(sim.autopilot.isAuto('B')).toBe(true);
  });
});

describe('Modes', () => {
  it('Chill endless never ends, even in gridlock', () => {
    const lvl = lm.get('chill', 'single');
    expect(lvl.fail).toBeNull();
    const sim = lm.createSim(lvl, 2);
    const tracker = lm.createTracker();
    tracker.congestionRun = 9999;
    expect(lm.checkEnd(lvl, sim, tracker, 5000)).toBeNull();
  });

  it('Lumalaking Lungsod opens districts at milestones; closed junctions run on AUTO', () => {
    const sim = lm.createSim(lm.get('growing'), 3);
    expect(sim.growth.opened).toBe(1);
    expect(sim.autopilot.isAuto('E2')).toBe(false);
    expect(sim.autopilot.isAuto('T2')).toBe(true);
    const f0 = sim.growth.focusRect();
    // Hand the player's junctions to AUTO so traffic moves without a player.
    for (let i = 0; i < 400 * 60 && sim.growth.opened < 2; i++) {
      for (const id of sim.openNodes) sim.autopilot.setAuto(id, true);
      sim.step(SIM_DT);
    }
    expect(sim.growth.opened).toBeGreaterThanOrEqual(2);
    const f1 = sim.growth.focusRect();
    expect(f1.maxY - f1.minY + (f1.maxX - f1.minX)).toBeGreaterThan(f0.maxY - f0.minY + (f0.maxX - f0.minX));
  });

  it('every endless map has random events available', () => {
    for (const m of lm.endlessMaps()) expect(lm.endlessOn(m).randomEvents).toBeTruthy();
  });
});

describe('Map layout', () => {
  it('Metro Manila: no grid (no two junctions in line), every junction clear of the river', () => {
    const net = new Network(MAPS.metro);
    const nodes = MAPS.metro.nodes;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if ((a.id === 'T2' && b.id === 'E2') || (a.id === 'E2' && b.id === 'T2')) continue; // the Quezon Ave tunnel runs straight
        expect(Math.abs(a.x - b.x) >= 5 && Math.abs(a.y - b.y) >= 5, `${a.id} and ${b.id} line up`).toBe(true);
      }
    }
    for (const I of net.intersections) {
      if (I.layer) continue;
      const c = I.core;
      for (const [x, y] of [[c.minX, c.minY], [c.maxX, c.minY], [c.minX, c.maxY], [c.maxX, c.maxY]]) expect(net.river.distance(x, y) - net.river.width / 2).toBeGreaterThan(20);
    }
  });

  it('no two roads on the same level run into each other away from their junctions', () => {
    for (const map of Object.values(MAPS)) {
      const net = new Network(map);
      const bands = [];
      for (const I of net.intersections) {
        for (const a of ARMS) {
          const A = I.arms[a];
          if (A.type === 'none') continue;
          if (A.type === 'link' && A.link.a !== I.id) continue; // each link once
          const pts = [];
          const p = {};
          const u0 = A.stop + 20;
          const u1 = A.type === 'link' ? A.center.length - net.byId.get(A.other).arms[A.type === 'link' ? A.link.bArm : a].stop - 20 : A.length;
          for (let u = u0; u <= u1; u += 2) {
            A.center.point(u, 0, p);
            pts.push({ x: p.x, y: p.y });
          }
          const layer = A.type === 'link' && net.byId.get(A.other).layer !== I.layer ? 0.5 : I.layer;
          bands.push({ name: `${I.id}${a}`, half: A.half, pts, layer, nodes: new Set([I.id, A.other].filter(Boolean)) });
        }
      }
      for (let i = 0; i < bands.length; i++) {
        for (let j = i + 1; j < bands.length; j++) {
          const A = bands[i];
          const B = bands[j];
          if (Math.abs(A.layer - B.layer) >= 1) continue;
          if ([...A.nodes].some((n) => B.nodes.has(n))) continue; // roads meeting at a junction
          const need = A.half + B.half + 2 * SIDEWALK_WIDTH * (A.layer === 0 && B.layer === 0 ? 1 : 0) + 1;
          let best = Infinity;
          for (const p of A.pts) for (const q of B.pts) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
          if (best < need) throw new Error(`${map.id}: ${A.name} and ${B.name} come within ${best.toFixed(1)} m (need ${need.toFixed(1)})`);
        }
      }
    }
  });
});

describe('Counterflow and enforcers', () => {
  const cfLevel = (over = {}) =>
    makeLevel({
      map: 'poblacion',
      prewarm: 0,
      demandScale: 1,
      demand: { N: 14, S: 6, E: 6, W: 6 },
      mix: { car: 0.35, motorcycle: 0.35, tricycle: 0.1, jeepney: 0.1, suv: 0.1 },
      personalities: { patient: 0.2, impatient: 0.4, aggressive: 0.4 },
      turns: { left: 0.15, right: 0.15 },
      counterflow: { moto: 0.6, car: 0.3, minWait: 6, minQueue: 3, emergency: true },
      enforcer: { count: 2 },
      emergency: { times: [30, 70] },
      initialGroups: { A: 'E' },
      ...over,
    });

  it('pasaway counterflow stays collision-free, and HULI! sends them back', () => {
    const sim = new TrafficSimulator(cfLevel(), { seed: 5 });
    let caught = 0;
    run(sim, 180, (s, i) => {
      if (i % (25 * 60) === 0) s.requestPhase('A', ['N', 'E', 'W'][(i / (25 * 60)) % 3]);
      if (i % 600 === 300) for (const v of s.counterflow.active) if (s.enforcement.catchVehicle(v)) caught++;
    });
    expect(sim.stats.counterflows || 0).toBeGreaterThan(0);
    expect(caught).toBeGreaterThan(0);
    // caught vehicles never try again
    for (const v of sim.vehicles) if (v.caught) expect(!v.cf || v.cf.forced || v.cf.noStuck).toBe(true);
  });

  it('a contraflow lane opens behind its cones, gets used, and nobody hits anything', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 16, S: 5, E: 5, W: 5 }, mix: { car: 0.6, motorcycle: 0.4 }, turns: { left: 0.4, right: 0.15 }, initialGroups: { A: 'E' }, enforcer: { count: 2 } }), { seed: 2 });
    const lane = sim.network.byId.get('A').approachLanes.N[0];
    const users = new Set();
    run(sim, 120, (s, i) => {
      if (i === 10 * 60) expect(typeof s.counterflow.openZone(lane)).toBe('object');
      if (i === 60 * 60) s.requestPhase('A', 'N');
      for (const v of s.counterflow.active) {
        if (!v.cf.legal || users.has(v.id)) continue;
        users.add(v.id);
        // only drivers turning left (or U-turning) take the contraflow lane
        expect(['left', 'uturn']).toContain(v.route.entries[v.route.connectorIdx[v.nextConn] ?? v.segIdx + 1]?.seg.movement);
      }
    });
    expect(users.size).toBeGreaterThan(0);
  });

  it('cones start where the road was tapped, a tap on them finds the zone, and they come up at once', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 16, S: 6, E: 5, W: 5 }, turns: { left: 0.45, right: 0.1 }, initialGroups: { A: 'E' } }), { seed: 3 });
    const A = sim.network.byId.get('A');
    const lane = A.approachLanes.N[0];
    const z = sim.counterflow.openZone(lane, { from: 40 });
    expect(Math.abs(z.s0 - 40)).toBeLessThan(0.01);
    const q = { x: 0, y: 0 };
    lane.path.pointAt(lane.length, q);
    expect(Math.hypot(z.cones[0].x - q.x, z.cones[0].y - q.y)).toBeLessThan(6);
    run(sim, 3);
    // the hit test: on a cone, in the middle of the coned lane, and nowhere near
    expect(sim.counterflow.zoneAtPoint(z.cones[1].x, z.cones[1].y)).toBe(z);
    z.opp.path.pointAt(20, q);
    expect(sim.counterflow.zoneAtPoint(q.x, q.y)).toBe(z);
    expect(sim.counterflow.zoneAtPoint(q.x + 300, q.y + 300)).toBeNull();
    run(sim, 60, (s, i) => {
      if (i === 30 * 60) s.requestPhase('A', 'N');
    });
    const before = z.placed;
    sim.counterflow.closeZone(z);
    run(sim, 1);
    expect(z.placed).toBeLessThan(before);
    expect(z.opp.closed).toBe(z.users.size > 0 || z.placed > 0);
    sim.requestPhase('A', 'N');
    run(sim, 60);
    expect(z.state).toBe('gone');
    expect(z.opp.closed).toBe(false);
  });

  it('contraflow cones line the oncoming lanes, oncoming drivers merge out, one-lane roads are refused', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 12, S: 14, E: 8, W: 8 }, mix: { car: 0.7, motorcycle: 0.3 }, turns: { left: 0.2, right: 0.2 }, initialGroups: { A: 'S' }, enforcer: { count: 2 } }), { seed: 4 });
    const A = sim.network.byId.get('A');
    const lane = A.approachLanes.N[0];
    const [o0, o1] = A.exitLanes.N;
    const z = sim.counterflow.openZone(lane);
    expect(typeof z).toBe('object');
    // The main row sits on the line between the borrowed lane and the oncoming lane that stays open.
    const q = { x: 0, y: 0 };
    const dist = (l, c) => Math.min(...Array.from({ length: Math.ceil(l.length) }, (_, s) => (l.path.pointAt(s, q), Math.hypot(q.x - c.x, q.y - c.y))));
    const row = z.cones.slice(0, -4);
    expect(row.length).toBeGreaterThan(3);
    for (const c of row) {
      const d0 = dist(o0, c);
      const d1 = dist(o1, c);
      expect(Math.abs(d0 - d1)).toBeLessThan(0.3);
      expect(dist(lane, c)).toBeGreaterThan(4);
    }
    // Nobody is left parked in the borrowed lane at the cones while the lane is open.
    let worst = 0;
    run(sim, 100, (s, i) => {
      if (i % (20 * 60) === 0) s.requestPhase('A', ['S', 'E', 'W', 'S', 'N'][(i / (20 * 60)) % 5]);
      for (const v of o0.vehicles) if (v.localS < z.block.s + 1) worst = Math.max(worst, v.stoppedTime);
    });
    expect(worst).toBeLessThan(10);
    expect(sim.stats.processed).toBeGreaterThan(20);
    // A road with a single oncoming lane cannot be coned off.
    const pob = new TrafficSimulator(makeLevel({ map: 'poblacion', prewarm: 0 }), { seed: 1 });
    expect(typeof pob.counterflow.openZone(pob.network.byId.get('A').approachLanes.N[0])).toBe('string');
  });

  it('cones run up to the junction; oncoming traffic takes the next lane; tap again to remove', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 14, S: 12, E: 8, W: 8 }, mix: { car: 0.7, motorcycle: 0.3 }, turns: { left: 0.25, right: 0.2 }, initialGroups: { A: 'S' }, enforcer: { count: 2 } }), { seed: 6 });
    const A = sim.network.byId.get('A');
    const lane = A.approachLanes.N[0];
    const opp = A.exitLanes.N[0];
    run(sim, 15);
    const z = sim.counterflow.openZone(lane);
    expect(typeof z).toBe('object');
    // the first cone stands right by the stop line
    const q = { x: 0, y: 0 };
    lane.path.pointAt(lane.length, q);
    expect(Math.hypot(z.cones[0].x - q.x, z.cones[0].y - q.y)).toBeLessThan(6);
    expect(opp.closed).toBe(true);
    const users = new Set();
    let crossed = 0;
    let entered = 0;
    const before = new Set(opp.vehicles.map((v) => v.id));
    const seen = new Set();
    run(sim, 150, (s, i) => {
      if (i % (18 * 60) === 0) s.requestPhase('A', ['N', 'S', 'E', 'W'][(i / (18 * 60)) % 4]);
      for (const v of s.counterflow.active) {
        if (v.cf.legal) users.add(v.id);
        if (v.cf.legal && v.segment !== lane && v.cf.decay) crossed++;
      }
      if (z.state === 'open') for (const v of opp.vehicles) if (!before.has(v.id) && !seen.has(v.id)) (seen.add(v.id), entered++);
    });
    expect(users.size).toBeGreaterThan(0);
    expect(crossed).toBeGreaterThan(0); // they went through the junction from the borrowed lane
    expect(entered).toBe(0); // nobody exits into the coned lane while it is open
    for (const arm of ['S', 'E', 'W']) for (const l of A.approachLanes[arm]) for (const v of l.vehicles) expect(v.greenWait || 0).toBeLessThan(30);
    // Remove: the cones come up, the lane reopens.
    expect(sim.counterflow.closeZone(z)).toBe(true);
    sim.requestPhase('A', 'N'); // the ones still in it go on their green
    run(sim, 75);
    expect(z.state).toBe('gone');
    expect(opp.closed).toBe(false);
    expect(typeof sim.counterflow.openZone(lane)).toBe('object');
  });

  it('every road with two oncoming lanes can be coned off, however short', () => {
    for (const map of Object.keys(MAPS)) {
      const sim = new TrafficSimulator(makeLevel({ map, prewarm: 0 }), { seed: 1 });
      for (const l of sim.network.lanes) {
        const opp = sim.counterflow.oppOf(l);
        if (!opp) continue;
        const outs = l.endInt.exitLanes[l.endArm].filter((o) => o.type === 'general');
        const z = sim.counterflow.openZone(l);
        if (outs.length < 2) expect(typeof z).toBe('string');
        else {
          expect(typeof z, `${map} ${l.id}`).toBe('object');
          sim.counterflow.closeZone(z);
          z.state = 'gone';
          z.opp.closed = false;
          sim.counterflow.zones = [];
        }
      }
    }
  });

  it('a pasaway runs up a jammed queue to the stop line (and turns its nose while swinging out)', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 22, S: 3, E: 3, W: 3 }, mix: { car: 0.4, motorcycle: 0.6 }, personalities: { patient: 0, impatient: 0.5, aggressive: 0.5 }, counterflow: { moto: 0.6, car: 0.2, minWait: 6, minQueue: 3, emergency: true }, initialGroups: { A: 'E' } }), { seed: 5 });
    let front = 0;
    let yaw = 0;
    run(sim, 120, (s, i) => {
      if (i === 70 * 60) s.requestPhase('A', 'N');
      for (const v of s.counterflow.active) {
        if (v.cf.front && !v.cf.legal) front++;
        if (v.cf.phase === 'out' && v.v > 1) yaw = Math.max(yaw, Math.abs(v.cfYaw || 0));
      }
    });
    expect(sim.stats.counterflows || 0).toBeGreaterThan(0);
    expect(front).toBeGreaterThan(0);
    expect(yaw).toBeGreaterThan(0.05);
  });

  it('swinging out and back in is a lane change: indicator first, then sideways only while rolling forward', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 22, S: 3, E: 3, W: 3 }, mix: { car: 0.4, motorcycle: 0.6 }, personalities: { patient: 0, impatient: 0.5, aggressive: 0.5 }, counterflow: { moto: 0.6, car: 0.2, minWait: 6, minQueue: 3, emergency: true }, initialGroups: { A: 'E' } }), { seed: 5 });
    const prev = new Map();
    let signalled = 0;
    let swung = 0;
    let yaw = 0;
    run(sim, 120, (s, i) => {
      if (i === 70 * 60) s.requestPhase('A', 'N');
      for (const v of s.counterflow.active) {
        const cf = v.cf;
        if (!cf) continue;
        if (cf.phase === 'signal') {
          signalled++;
          expect(v.turnSignal()).toBe(-1);
          expect(v.cfOff).toBe(0);
        }
        if (cf.phase === 'out' && cf.sweep) {
          swung++;
          expect(v.turnSignal()).toBe(-1);
          yaw = Math.max(yaw, Math.abs(v.cfYaw));
        }
        // On the curve the offset moves only with the distance travelled: no crabbing on the spot.
        const off = v._cfOff(v.s);
        const p = prev.get(v);
        if (p && cf.sweep && p.sweep === cf.sweep && Math.abs(v.s - p.s) < 1e-9) expect(Math.abs(off - p.off)).toBeLessThan(1e-6);
        prev.set(v, { s: v.s, off, sweep: cf.sweep });
      }
    });
    expect(signalled).toBeGreaterThan(0);
    expect(swung).toBeGreaterThan(0);
    expect(yaw).toBeGreaterThan(0.05);
    expect(yaw).toBeLessThan(0.86); // a lane change (under ~48° even when squeezed), not a turn on the spot
  });

  it('lifting the cones: those short of the stop line zip back into their lane, one at a time', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 18, S: 6, E: 6, W: 6 }, mix: { car: 0.5, motorcycle: 0.5 }, turns: { left: 0.6, right: 0.1 }, initialGroups: { A: 'E' } }), { seed: 2 });
    const lane = sim.network.byId.get('A').approachLanes.N[0];
    const z = sim.counterflow.openZone(lane, { from: 30 });
    let closed = false;
    const merged = [];
    run(sim, 220, (s, i) => {
      if (!closed && i % (20 * 60) === 0) s.requestPhase('A', ['E', 'W', 'S'][(i / (20 * 60)) % 3]);
      if (closed && i % (25 * 60) === 0) s.requestPhase('A', ['N', 'E'][(i / (25 * 60)) % 2]);
      if (!closed && i > 20 * 60 && [...z.users].filter((v) => v.cf?.phase === 'run' && v.localS + v.hl < lane.length - 20).length >= 3) {
        closed = true;
        s.counterflow.closeZone(z);
        for (const v of z.users) if (v.cf?.merge) merged.push(v);
      }
      for (const v of merged) {
        if (v.cf || v.zipChecked) continue;
        v.zipChecked = true;
        // Back in its own lane, short of the stop line, and not right behind another one from the cones.
        expect(v.segment).toBe(lane);
        const ahead = lane.vehicles[lane.vehicles.indexOf(v) + 1];
        if (ahead && ahead.zipAt !== undefined && ahead !== v) expect(v.zipAt - ahead.zipAt).toBeGreaterThanOrEqual(8);
      }
    });
    expect(closed).toBe(true);
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged.every((v) => v.zipChecked)).toBe(true);
    expect(z.state).toBe('gone');
  });

  it('an ambulance held up in a queue ignores the centre line and goes up the oncoming lane', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 26, S: 3, E: 3, W: 3 }, mix: { car: 0.8, motorcycle: 0.2 }, counterflow: { emergency: true }, initialGroups: { A: 'E' } }), { seed: 1 });
    let cf = 0;
    run(sim, 100, (s, i) => {
      if (i === 40 * 60 || i === 60 * 60) s.spawner.createArrival('A:N', true);
      for (const v of s.counterflow.active) if (v.cf.emergency) cf++;
    });
    expect(cf).toBeGreaterThan(0);
  });

  it('a pasaway never waits at the line in the oncoming lane on a red, and traffic keeps right round one', () => {
    // (two lanes each way: the oncoming side has a lane to keep right into)
    const sim = new TrafficSimulator(cfLevel({ map: undefined, emergency: null, demand: { N: 18, S: 8, E: 8, W: 8 } }), { seed: 2 });
    let waitingOnRed = 0;
    let closedWhileOut = 0;
    run(sim, 180, (s, i) => {
      if (i % (25 * 60) === 0) s.requestPhase('A', ['N', 'E', 'W'][(i / (25 * 60)) % 3]);
      for (const v of s.counterflow.active) {
        const cf = v.cf;
        if (cf.legal || cf.emergency || v.segment !== cf.lane) continue;
        if (s.counterflow.atLine(v) && !v.reservations.size && s.counterflow._ownSignal(v) !== 'green') waitingOnRed++;
        if (cf.front && !cf.forced && cf.phase === 'run' && cf.opp.closed) closedWhileOut++;
      }
    });
    expect(sim.stats.counterflows || 0).toBeGreaterThan(0);
    expect(waitingOnRed).toBe(0);
    expect(closedWhileOut).toBeGreaterThan(0);
    // once nobody is out there, the oncoming lanes are open again
    if (!sim.counterflow.active.some((v) => v.cf.front)) for (const l of sim.network.lanes) expect(!!l.closed).toBe(sim.counterflow.zones.some((z) => z.opp === l));
  });

  it('an ambulance stuck in a queue takes the player\'s contraflow cones (no counterflow otherwise)', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 22, S: 4, E: 4, W: 4 }, mix: { car: 0.8, motorcycle: 0.2 }, turns: { left: 0, right: 0.15 }, initialGroups: { A: 'E' }, enforcer: { count: 2 } }), { seed: 2 });
    const lane = sim.network.byId.get('A').approachLanes.N[0];
    let inCones = 0;
    run(sim, 90, (s, i) => {
      if (i === 10 * 60) expect(typeof s.counterflow.openZone(lane)).toBe('object');
      if (i === 40 * 60) s.spawner.createArrival('A:N', true);
      for (const v of s.counterflow.active) if (v.cf.emergency && v.cf.zone) inCones++;
    });
    expect(inCones).toBeGreaterThan(0);
    // through on its red (North never gets a green here), past the queue it was stuck in
    expect(sim.emergencySummary().cleared).toBeGreaterThan(0);
  });

  it('a counterflower stuck head-on backs up only once caught (HULI!), without touching anyone', () => {
    // One lane each way: nowhere for the oncoming side to keep right.
    MAPS.oneLaneTest = { ...MAPS.single, id: 'oneLaneTest', roads: { street: { lanes: 1, median: 0 } } };
    const sim = new TrafficSimulator(makeLevel({ map: 'oneLaneTest', prewarm: 0, demandScale: 1, demand: { N: 3, S: 3, E: 16, W: 16 }, mix: { car: 0.6, motorcycle: 0.4 }, turns: { left: 0.1, right: 0.15 }, personalities: { patient: 0.5, impatient: 0.5 }, initialGroups: { A: 'N' } }), { seed: 5 });
    const cfm = sim.counterflow;
    const lane = sim.network.byId.get('A').approachLanes.E[0];
    const opp = cfm.oppOf(lane);
    let moto = null;
    let caught = false;
    let reversedEarly = false;
    let reversed = false;
    let caughtAt = 0;
    run(sim, 95, (s, i) => {
      if (i === 40 * 60) {
        // force the old behaviour: a pasaway runs up the only lane out
        for (const v of lane.vehicles.filter((o) => o.type === 'motorcycle' && o.localS < lane.length - 12).reverse()) {
          const t = cfm._reach(v, lane, opp, 1.5);
          if (t === null) continue;
          cfm._startFront(v, lane, opp, { target: t });
          moto = v;
          break;
        }
      }
      if (i === 50 * 60) s.requestPhase('A', 'E');
      if (i === 53 * 60) s.requestPhase('A', 'W'); // East and West green together
      if (i === 80 * 60 && moto?.cf) {
        caughtAt = moto.localS;
        caught = s.enforcement.catchVehicle(moto);
      }
      if (moto?.cf?.reverse) {
        if (!caught) reversedEarly = true;
        reversed = true;
      }
    });
    expect(moto).not.toBeNull();
    expect(caught).toBe(true);
    expect(reversedEarly).toBe(false);
    // back in its own lane, or backing up along the queue toward a gap
    expect(!moto.cf || moto.cf.phase === 'in' || (reversed && moto.localS < caughtAt - 10)).toBe(true);
  });

  it('two lanes each way: legal traffic keeps right round a counterflower instead of waiting behind it', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 4, S: 4, E: 16, W: 16 }, mix: { car: 0.6, motorcycle: 0.4 }, turns: { left: 0.1, right: 0.15 }, initialGroups: { A: 'N' } }), { seed: 3 });
    const cfm = sim.counterflow;
    const lane = sim.network.byId.get('A').approachLanes.E[0];
    const opp = cfm.oppOf(lane);
    let moto = null;
    let closed = 0;
    let stuckBehind = 0;
    run(sim, 70, (s, i) => {
      if (i === 30 * 60) s.requestPhase('A', 'W'); // the other side drives into that road
      if (!moto && i >= 20 * 60 && i % 30 === 0) {
        for (const v of lane.vehicles.filter((o) => o.type === 'motorcycle' && o.localS < lane.length - 12).reverse()) {
          const t = cfm._reach(v, lane, opp, 1.5);
          if (t === null) continue;
          cfm._startFront(v, lane, opp, { target: t });
          moto = v;
          break;
        }
      }
      if (!moto?.cf?.block) return;
      if (opp.closed) closed++;
      for (const o of opp.vehicles) if (o.stoppedTime > 10 && o.localS < moto.cf.block.s) stuckBehind++;
    });
    expect(moto).not.toBeNull();
    expect(closed).toBeGreaterThan(0);
    expect(stuckBehind).toBe(0);
  });

  it('an enforcer stands in the middle of the junction', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, enforcer: { count: 1 } }), { seed: 1 });
    const A = sim.network.byId.get('A');
    sim.enforcement.toggle('A');
    const p = sim.enforcement.posts.get('A');
    expect(Math.hypot(p.x - A.x, p.y - A.y)).toBeLessThan(0.01);
    expect(sim.enforcement.near(A)).toBe(true);
  });

  it('tapping one of two paired greens turns just that road red; tapping a lone green does nothing', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, initialGroups: { A: 'N' } }), { seed: 1 });
    const m = sim.lights.manager('A');
    expect(playerPhaseRequest(m, 'N')).toBeNull();
    sim.requestPhase('A', 'S'); // pair N + S
    run(sim, 4);
    expect(m.greenGroups().sort()).toEqual(['N', 'S']);
    sim.requestPhase('A', playerPhaseRequest(m, 'N'));
    run(sim, 4);
    expect(m.greenGroups()).toEqual(['S']);
    expect(m.signalForArm('S', 'left')).toBe('green');
  });

  it('an enforcer: patawid walks every crosswalk then gives the green back; padaanin needs one', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 8, S: 8, E: 8, W: 8 }, enforcer: { count: 1 }, pedestrians: { cross: 3, jaywalk: 0, strollers: 0 }, initialGroups: { A: 'E' } }), { seed: 3 });
    expect(sim.enforcement.patawid('A').ok).toBe(false); // nobody stationed yet
    expect(sim.enforcement.toggle('A').ok).toBe(true);
    expect(sim.enforcement.toggle('A').ok).toBe(true); // off duty again
    sim.enforcement.toggle('A');
    expect(sim.enforcement.patawid('A').ok).toBe(true);
    let allWalk = 0;
    run(sim, 20, (s, i) => {
      if (i % 30) return;
      if (s.peds.crossings.every((c) => s.peds.walkState(c) === 'walk')) allWalk++;
    });
    expect(allWalk).toBeGreaterThan(5);
    expect(sim.lights.manager('A').greenGroups()).toEqual(['E']);
  });

  it('world options: no rain, no people', () => {
    const lvl = lm.withOptions(lm.get('pinoy', 'taft'), { rain: false, people: false });
    expect(lvl.pedestrians).toBeNull();
    expect(lvl.objectives.some((o) => o.type === 'pedCrossed')).toBe(false);
    const sim = lm.createSim(lvl, 1);
    expect(sim.peds.enabled).toBe(false);
    expect(sim.env.weather).toBe('clear');
    expect(sim.env.random).toBe(false);
  });
});
