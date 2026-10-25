import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { PED_RADIUS } from '../src/simulation/PedestrianManager.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { makeLevel, PINOY_LEVELS } from '../src/data/levels.js';
import { MAPS } from '../src/data/maps/index.js';
import { SIM_DT, LANE_WIDTH } from '../src/data/config.js';
import { Rng, pointSegDist2 } from '../src/utils/math.js';

/** Distance from a point to a vehicle's body (0 when inside). */
function distToVehicle(px, py, o) {
  const dx = px - o.x;
  const dy = py - o.y;
  const u = Math.abs(dx * o.c + dy * o.s) - o.hl;
  const v = Math.abs(-dx * o.s + dy * o.c) - o.hw;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

/** Throws if any pedestrian is closer than `margin` to any vehicle. */
function auditPeds(sim, margin = 0.1) {
  for (const p of sim.peds.peds) {
    for (const v of sim.vehicles) {
      if (Math.abs(v.x - p.x) > 8 || Math.abs(v.y - p.y) > 8) continue;
      const d = distToVehicle(p.x, p.y, v.obb) - PED_RADIUS;
      if (d < margin) throw new Error(`Pedestrian ${p.id} (${p.state}) ${d.toFixed(2)} m from vehicle ${v.id} at t=${sim.time.toFixed(2)}`);
    }
  }
}

function run(sim, seconds, { switchEvery = [5, 16], onStep, auditEvery = 1 } = {}) {
  const rng = new Rng(17);
  let next = 4;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    if (switchEvery && sim.time > next) {
      for (const [id, m] of sim.lights.managers) sim.requestPhase(id, rng.pick(m.groups));
      next = sim.time + rng.range(...switchEvery);
    }
    sim.step(SIM_DT);
    onStep?.(sim, i);
    if (i % auditEvery === 0) {
      auditPeds(sim);
      const issues = CollisionAvoidance.auditPairs(sim.vehicles, 0.44);
      if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
    }
  }
}

const busy = (over = {}) =>
  makeLevel({
    map: 'taft',
    prewarm: 0,
    demandScale: 1,
    cornerStops: 0,
    demand: { N: 12, S: 12, E: 9, W: 9 },
    mix: { car: 0.4, motorcycle: 0.25, jeepney: 0.2, bus: 0.05, tricycle: 0.05, truck: 0.05 },
    personalities: { patient: 0.2, impatient: 0.4, aggressive: 0.4 },
    turns: { left: 0.25, right: 0.25 },
    loadingStops: 0.4,
    pedestrians: { cross: 6, jaywalk: 4, strollers: 3, patience: [10, 20] },
    ...over,
  });

describe('Pedestrians never get hit', () => {
  it('stress: crowds, jaywalkers and aggressive drivers with random signals', () => {
    const sim = new TrafficSimulator(busy(), { seed: 8 });
    run(sim, 150);
    const st = sim.peds.stats;
    expect(st.crossed).toBeGreaterThan(30);
    expect(st.jaywalkers).toBeGreaterThan(0); // few find a safe gap in traffic this heavy
    expect(st.redCrossers).toBeGreaterThan(0);
    expect(sim.stats.processed).toBeGreaterThan(40);
  });

  for (const id of ['espana', 'likoliko', 'corridor']) {
    it(`stress on ${id} (curves and S-bends)`, () => {
      const sim = new TrafficSimulator(busy({ map: id }), { seed: 3 });
      run(sim, 100, { auditEvery: 2 });
      expect(sim.peds.stats.crossed).toBeGreaterThan(10);
    });
  }

  it('every Pinoy Roads level', () => {
    const lm = new LevelManager();
    for (const lvl of PINOY_LEVELS) {
      const sim = lm.createSim(lvl, 21);
      run(sim, 60, { auditEvery: 3 });
    }
  });
});

describe('Crosswalk rules', () => {
  it('people step out only on WALK (unless pasaway), and only onto a crosswalk no vehicle holds', () => {
    const sim = new TrafficSimulator(busy({ pedestrians: { cross: 5, jaywalk: 0, strollers: 0, patience: [25, 40] } }), { seed: 4 });
    const before = new Map();
    let starts = 0;
    run(sim, 120, {
      onStep: (s) => {
        for (const p of s.peds.peds) {
          const was = before.get(p);
          if (p.state === 'cross' && was === 'wait') {
            starts++;
            const c = p.cross.c;
            if (!p.red) expect(s.peds.walkState(c)).not.toBe('stop');
            // People hold a moving window of the crosswalk: the stretch they step onto is theirs alone.
            const res = p.reservations.get(c.I.id);
            expect(res && res.remaining).toBeGreaterThan(0);
            for (let k = 0; k < res.held.length; k++) {
              if (res.held[k]) expect(c.grid.owners[res.fp.cells[k]].some((o) => !o.isPed)).toBe(false);
            }
          }
          before.set(p, p.state);
        }
      },
    });
    expect(starts).toBeGreaterThan(20);
  });

  it('waiting at a red is not gridlock, and walkers get across in time', () => {
    const sim = new TrafficSimulator(
      busy({ map: 'espana', personalities: { patient: 1 }, demand: { N: 8, S: 8, E: 8, W: 8 }, pedestrians: { cross: 5, jaywalk: 0, strollers: 1 } }),
      { seed: 6 },
    );
    run(sim, 150, { switchEvery: [14, 18] });
    expect(sim.metrics.gridlockTime).toBeLessThan(5);
    expect(sim.peds.stats.crossed).toBeGreaterThan(30);
    expect(sim.peds.stats.totalWait / sim.peds.stats.crossed).toBeLessThan(25);
  });

  it('no crosswalks where the map says people use the footbridge', () => {
    const lm = new LevelManager();
    const sim = lm.createSim(lm.get('pinoy', 'edsa'), 1);
    expect(sim.peds.crossings.map((c) => c.arm).sort()).toEqual(['E', 'W']);
  });
});

describe('Pasaway jaywalkers', () => {
  it('drivers stop for them without slamming the brakes', () => {
    const sim = new TrafficSimulator(busy({ map: 'single', pedestrians: { cross: 0, jaywalk: 8, strollers: 0 } }), { seed: 12 });
    let blocked = 0;
    let slams = 0;
    run(sim, 120, {
      onStep: (s) => {
        for (const v of s.vehicles) {
          if (v.constraint !== 'blocked') continue;
          blocked++;
          if (v.a <= -v.spec.hardDecel * 0.95) slams++;
        }
      },
    });
    expect(sim.peds.stats.jaywalkers).toBeGreaterThan(5);
    expect(blocked).toBeGreaterThan(50);
    expect(slams).toBe(0);
    // every jaywalk blockage is cleared again
    expect(sim.blockages.filter((b) => b.kind === 'ped' && b.active).length).toBeLessThanOrEqual(sim.peds.peds.filter((p) => p.state === 'jaywalk').length);
  });
});

describe('Sidewalks', () => {
  it('strollers and waiting people stay off the lanes', () => {
    const sim = new TrafficSimulator(busy({ map: 'grid', pedestrians: { cross: 3, jaywalk: 0, strollers: 4 } }), { seed: 2 });
    const lanes = sim.network.lanes;
    let checked = 0;
    run(sim, 90, {
      auditEvery: 4,
      onStep: (s, i) => {
        if (i % 30) return;
        for (const p of s.peds.peds) {
          if (p.state === 'cross' || p.state === 'jaywalk') continue;
          checked++;
          for (const lane of lanes) {
            const P = lane.path;
            for (let k = 1; k < P.n; k++) {
              const d = Math.sqrt(pointSegDist2(p.x, p.y, P.xs[k - 1], P.ys[k - 1], P.xs[k], P.ys[k]));
              if (d < LANE_WIDTH / 2 + PED_RADIUS) throw new Error(`${p.id} (${p.state}) is on lane ${lane.id}: ${d.toFixed(2)} m`);
            }
          }
        }
      },
    });
    expect(checked).toBeGreaterThan(200);
  });

  it('strollers alone never change the traffic', () => {
    const base = { map: 'single', prewarm: 0, demand: { N: 10, S: 10, E: 10, W: 10 }, mix: { car: 0.6, jeepney: 0.4 }, loadingStops: 0.5 };
    const a = new TrafficSimulator(makeLevel({ ...base, pedestrians: null }), { seed: 9 });
    const b = new TrafficSimulator(makeLevel({ ...base, pedestrians: { strollers: 5 } }), { seed: 9 });
    for (let i = 0; i < 60 / SIM_DT; i++) {
      a.step(SIM_DT);
      b.step(SIM_DT);
    }
    expect(b.peds.peds.length).toBeGreaterThan(10);
    expect(a.vehicles.map((v) => v.s.toFixed(6))).toEqual(b.vehicles.map((v) => v.s.toFixed(6)));
  });
});

describe('Wide audit', () => {
  it('every map: heavy traffic, buses and trucks, crowds and jaywalkers', () => {
    for (const id of Object.keys(MAPS)) {
      const sim = new TrafficSimulator(
        busy({ map: id, mix: { car: 0.3, motorcycle: 0.2, jeepney: 0.2, bus: 0.12, truck: 0.12, tricycle: 0.06 }, pedestrians: { cross: 5, jaywalk: 3, strollers: 3, patience: [10, 25] } }),
        { seed: 2 },
      );
      run(sim, 60, { switchEvery: [4, 15], auditEvery: 2 });
    }
  });
});
