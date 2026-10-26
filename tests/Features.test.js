import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { Network } from '../src/simulation/LaneManager.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { makeLevel } from '../src/data/levels.js';
import { MAPS } from '../src/data/maps/index.js';
import { SIM_DT, ARMS, DIRS, SIDEWALK_WIDTH } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

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
    expect(sim.stats.processed).toBeGreaterThan(40);
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
    expect(sim.stats.processed).toBeGreaterThan(40);
  });
});

describe('AUTO lights', () => {
  it('serve every road with traffic within about a minute and never show conflicting greens', () => {
    const sim = lm.createSim({ ...lm.get('career', 7), autoLights: true, fail: null }, 3);
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
    const sim = new TrafficSimulator(cfLevel(), { seed: 9 });
    let caught = 0;
    run(sim, 180, (s, i) => {
      if (i % (25 * 60) === 0) s.requestPhase('A', ['N', 'E', 'W'][(i / (25 * 60)) % 3]);
      if (i % 600 === 300) for (const v of s.counterflow.active) if (s.enforcement.catchVehicle(v)) caught++;
    });
    expect(sim.stats.counterflows || 0).toBeGreaterThan(0);
    expect(caught).toBeGreaterThan(0);
    // caught vehicles never try again
    for (const v of sim.vehicles) if (v.caught) expect(!v.cf || v.cf.forced).toBe(true);
  });

  it('a contraflow lane opens behind its cones, gets used, and nobody hits anything', () => {
    const sim = new TrafficSimulator(makeLevel({ prewarm: 0, demandScale: 1, demand: { N: 16, S: 5, E: 5, W: 5 }, mix: { car: 0.6, motorcycle: 0.4 }, initialGroups: { A: 'E' }, enforcer: { count: 2 } }), { seed: 2 });
    const lane = sim.network.byId.get('A').approachLanes.N[0];
    const users = new Set();
    run(sim, 120, (s, i) => {
      if (i === 10 * 60) expect(typeof s.counterflow.openZone(lane)).toBe('object');
      if (i === 60 * 60) s.requestPhase('A', 'N');
      for (const v of s.counterflow.active) if (v.cf.legal) users.add(v.id);
    });
    expect(users.size).toBeGreaterThan(0);
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
