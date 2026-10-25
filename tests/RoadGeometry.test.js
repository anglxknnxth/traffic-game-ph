import { describe, it, expect } from 'vitest';
import { Centerline, STRAIGHT_LEAD } from '../src/simulation/RoadGeometry.js';
import { Network } from '../src/simulation/LaneManager.js';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { MAPS } from '../src/data/maps/index.js';
import { makeLevel } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';

const pt = {};
const pa = {};
const pb = {};

describe('Centre lines', () => {
  it('a straight arm reproduces the old arm frame exactly', () => {
    const c = Centerline.fromShape({ x: 5, y: -3 }, { x: 0, y: -1 }, [], 100);
    expect(c.straight).toBe(true);
    c.point(40, 2, pt);
    // heading north, +y local = right of outward = east
    expect(pt.x).toBeCloseTo(7, 9);
    expect(pt.y).toBeCloseTo(-43, 9);
  });

  it('a 90° curve of radius R turns the heading and has the arc length R·π/2', () => {
    const c = Centerline.fromShape({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ straight: 20 }, { curve: 90, radius: 30 }], 20 + 30 * (Math.PI / 2) + 10);
    const end = c.pose(20 + 30 * (Math.PI / 2));
    expect(end.tx).toBeCloseTo(0, 6);
    expect(end.ty).toBeCloseTo(1, 6); // clockwise on screen: east -> south
    expect(end.x).toBeCloseTo(50, 3);
    expect(end.y).toBeCloseTo(30, 3);
    expect(c.minRadius).toBeCloseTo(30, 3);
    expect(c.isStraight(0, 19)).toBe(true);
    expect(c.isStraight(0, 30)).toBe(false);
  });

  it('refuses a bend closer to the junction than the straight lead', () => {
    expect(() => Centerline.fromShape({ x: 0, y: 0 }, { x: 1, y: 0 }, [{ straight: 10 }, { curve: 30, radius: 40 }], 100, 20)).toThrow(/keep at least/);
  });

  it('links between offset nodes become smooth S-curves', () => {
    const c = Centerline.link({ x: 0, y: 0 }, { x: 1, y: 0 }, 20, { x: 100, y: 15 }, { x: -1, y: 0 }, 20);
    expect(c.straight).toBe(false);
    expect(c.pose(0).ty).toBeCloseTo(0, 9);
    expect(c.pose(c.length).ty).toBeCloseTo(0, 9);
    expect(c.minRadius).toBeGreaterThan(30);
    const r = c.reversed();
    expect(r.length).toBeCloseTo(c.length, 9);
    expect(r.pose(0).x).toBeCloseTo(100, 9);
  });
});

describe('Curved lanes on every map', () => {
  for (const map of Object.values(MAPS)) {
    it(`${map.id}: lanes are continuous, parallel, and straight near junctions`, () => {
      const net = new Network(map);
      for (const lane of net.lanes) {
        const P = lane.path;
        // vertices close together, coordinates increasing, no kinks
        for (let i = 1; i < P.n; i++) {
          expect(P.cum[i]).toBeGreaterThan(P.cum[i - 1]);
          if (P.n > 2) expect(Math.hypot(P.xs[i] - P.xs[i - 1], P.ys[i] - P.ys[i - 1])).toBeLessThan(lane.length);
          if (i > 1) {
            const dot = P.ux[i - 1] * P.ux[i - 2] + P.uy[i - 1] * P.uy[i - 2];
            expect(dot).toBeGreaterThan(Math.cos((25 * Math.PI) / 180));
          }
        }
        // straight for STRAIGHT_LEAD - 1 m at the junction end(s) of the lane
        const checkStraight = (s0, s1) => {
          P.pointAt(s0, pa);
          P.pointAt(s1, pb);
          expect(pa.dx * pb.dx + pa.dy * pb.dy).toBeGreaterThan(1 - 1e-9);
        };
        if (lane.endInt) checkStraight(Math.max(0, lane.length - 11), lane.length - 0.01);
        if (lane.startInt) checkStraight(0.01, Math.min(lane.length, 11));
        // the physical length is close to the coordinate length (lanes hug the centre line)
        let phys = 0;
        for (let i = 1; i < P.n; i++) phys += Math.hypot(P.xs[i] - P.xs[i - 1], P.ys[i] - P.ys[i - 1]);
        expect(Math.abs(phys - lane.length) / lane.length).toBeLessThan(0.25);
      }
      // Parallel lanes of one direction share their coordinate: same s = same cross-section.
      for (const I of net.intersections) {
        for (const lanes of [...Object.values(I.approachLanes), ...Object.values(I.exitLanes)]) {
          if (lanes.length < 2) continue;
          for (let k = 1; k < lanes.length; k++) {
            expect(lanes[k].length).toBeCloseTo(lanes[0].length, 6);
            for (const s of [0, lanes[0].length * 0.37, lanes[0].length * 0.81]) {
              lanes[0].path.pointAt(s, pa);
              lanes[k].path.pointAt(s, pb);
              const sep = Math.hypot(pb.x - pa.x, pb.y - pa.y);
              expect(Math.abs(sep - Math.abs(lanes[k].offset - lanes[0].offset))).toBeLessThan(0.15);
            }
          }
        }
      }
    });
  }
  it('every map has some curved road (no more straight-only maps)', () => {
    for (const map of Object.values(MAPS)) {
      const net = new Network(map);
      expect(net.lanes.some((l) => l.path.n > 2)).toBe(true);
    }
    expect(STRAIGHT_LEAD).toBeGreaterThanOrEqual(12);
  });
});

describe('Driving through curves', () => {
  it('vehicles slow down for tight bends and stay on their lane', () => {
    const lvl = makeLevel({ map: 'likoliko', prewarm: 0, demand: { E: 12, W: 12, N: 0, S: 0 }, mix: { car: 1 }, personalities: { aggressive: 1 }, turns: { left: 0, right: 0 } });
    const sim = new TrafficSimulator(lvl, { seed: 5 });
    sim.requestPhase('A', 'EW');
    let inCurve = 0;
    let fastInCurve = 0;
    for (let i = 0; i < 90 / SIM_DT; i++) {
      sim.step(SIM_DT);
      for (const v of sim.vehicles) {
        const c = v.segment.curves?.find((q) => v.localS >= q.s0 + 6 && v.localS <= q.s1);
        if (!c) continue;
        inCurve++;
        if (v.v > c.vmax + 1.5) fastInCurve++;
      }
    }
    expect(inCurve).toBeGreaterThan(100);
    expect(fastInCurve / inCurve).toBeLessThan(0.05);
    expect(sim.stats.processed).toBeGreaterThan(20);
  });
});
