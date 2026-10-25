import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { Network } from '../src/simulation/LaneManager.js';
import { IntersectionManager } from '../src/simulation/IntersectionManager.js';
import { MAPS } from '../src/data/maps/index.js';
import { makeLevel } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

const MIN_SEP = 0.44;

const mixed = (map, over = {}) =>
  makeLevel({
    map,
    prewarm: 0,
    demand: { N: 9, S: 9, E: 9, W: 9 },
    mix: { car: 0.4, motorcycle: 0.25, jeepney: 0.15, bus: 0.1, tricycle: 0.05, truck: 0.05 },
    personalities: { patient: 0.4, impatient: 0.4, aggressive: 0.2 },
    turns: { left: 0.2, right: 0.2 },
    loadingStops: 0.4,
    ...over,
  });

function runMap(sim, seconds, onStep) {
  const rng = new Rng(5);
  let next = 4;
  const lastS = new Map();
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    if (sim.time > next) {
      for (const [id, m] of sim.lights.managers) sim.requestPhase(id, rng.pick(m.groups));
      next = sim.time + rng.range(6, 18);
    }
    sim.step(SIM_DT);
    expect(sim.lights.conflictingGreens()).toBe(0);
    for (const v of sim.vehicles) {
      const p = lastS.get(v);
      if (p !== undefined) expect(v.s).toBeGreaterThanOrEqual(p - 1e-9);
      lastS.set(v, v.s);
    }
    onStep?.(sim);
    if (i % 3 === 0) {
      const issues = CollisionAvoidance.auditPairs(sim.vehicles, MIN_SEP);
      if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
    }
  }
}

describe('Road network from maps', () => {
  for (const map of Object.values(MAPS)) {
    it(`${map.id}: every lane connects and every spawn lane reaches an exit`, () => {
      const net = new Network(map);
      for (const c of net.connectors) {
        const a = c.path.points()[0];
        const b = c.path.points().at(-1);
        expect(Math.hypot(a.x - c.fromLane.end.x, a.y - c.fromLane.end.y)).toBeLessThan(1e-9);
        expect(Math.hypot(b.x - c.toLane.start.x, b.y - c.toLane.start.y)).toBeLessThan(1e-9);
        // dedicated lanes only feed lanes of their own kind (or general traffic lanes)
        if (c.fromLane.type === 'general') expect(c.toLane.type).toBe('general');
      }
      for (const lane of net.lanes) {
        if (lane.endInt) expect(Object.keys(lane.connectors).length).toBeGreaterThan(0);
      }
      for (const I of net.intersections) {
        if (I.kind === 'signal') expect(I.phases.length).toBeGreaterThan(1);
        // the conflict grid covers every connector
        const mgr = new IntersectionManager(I);
        for (const c of I.connectors) {
          const fp = mgr.footprint(c, { key: 'car', length: 4.4, width: 1.8 });
          expect(fp.cells.length).toBeGreaterThan(10);
        }
      }
    });
  }

  it('EDSA: no left turns from EDSA, U-turn slots instead, busway reserved for buses', () => {
    const net = new Network(MAPS.edsa);
    const A = net.byId.get('A');
    for (const arm of ['N', 'S']) for (const lane of A.approachLanes[arm]) expect(lane.connectors.left).toBeUndefined();
    const U1 = net.byId.get('U1');
    const uturns = U1.connectors.filter((c) => c.movement === 'uturn');
    expect(uturns.length).toBe(1);
    expect(uturns[0].fromLane.type).toBe('general');
    expect(uturns[0].toLane.type).toBe('general');
    const bus = A.approachLanes.N[0];
    expect(bus.type).toBe('bus');
    expect(bus.allows('bus')).toBe(true);
    expect(bus.allows('car')).toBe(false);
    expect(bus.connectors.straight.toLane.type).toBe('bus');
  });

  it('Poblacion: the T-junction has two phases and the barangay roads are yield-controlled', () => {
    const net = new Network(MAPS.poblacion);
    const A = net.byId.get('A');
    expect(A.phases.map((p) => p.id)).toEqual(['N', 'EW']);
    expect(net.byId.get('Y1').kind).toBe('yield');
    expect(A.approachLanes.N[0].moves).toEqual(['left', 'right']);
  });
});

describe('Philippine maps stay collision-free with mixed traffic', () => {
  for (const id of ['edsa', 'commonwealth', 'taft', 'espana', 'poblacion', 'corridor', 'grid']) {
    it(`${id}`, () => {
      const sim = new TrafficSimulator(mixed(id), { seed: 11 });
      let wrongLane = 0;
      const uturned = new Set();
      runMap(sim, 120, (s) => {
        for (const v of s.vehicles) {
          if (!v.segment.allows?.(v.type) && v.segment.kind === 'lane') wrongLane++;
          if (v.segment.kind === 'connector' && v.segment.movement === 'uturn') uturned.add(v.id);
        }
      });
      expect(wrongLane).toBe(0);
      expect(sim.stats.processed).toBeGreaterThan(15);
      if (id === 'edsa' || id === 'commonwealth') expect(uturned.size).toBeGreaterThan(0);
      for (const v of sim.vehicles) if (v.segment.kind === 'connector') expect(v.boxTime).toBeLessThan(90);
    });
  }

  it('yield junction: minor-road vehicles stop and only enter with a gap', () => {
    const sim = new TrafficSimulator(mixed('poblacion', { demand: { E: 14, W: 14, N: 6, S: 6 }, mix: { car: 1 }, personalities: { patient: 1 } }), { seed: 3 });
    const Y1 = sim.network.byId.get('Y1');
    let minorEntries = 0;
    let unsafe = 0;
    runMap(sim, 90, (s) => {
      for (const v of s.vehicles) {
        const res = v.reservations.get('Y1');
        if (!res || res.checked || Y1.major.has(res.conn.arm)) continue;
        res.checked = true;
        minorEntries++;
        expect(v.signStop).toBe('Y1');
        // nobody with right of way holds, or is within 2 s of, a crossing path
        for (const pc of s.imgr.get('Y1').priorityConflicts(res.conn)) {
          for (const o of pc.fromLane.vehicles) {
            const oce = o.nextConnEntry();
            if (!oce || oce.seg !== pc) continue;
            const d = oce.start - o.front;
            if (o.reservations.has('Y1') || (d > 0 && o.v > 0.8 && d / o.v < 2)) unsafe++;
          }
        }
      }
    });
    expect(minorEntries).toBeGreaterThan(2);
    expect(unsafe).toBe(0);
  });
});
