import { describe, it, expect } from 'vitest';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { Segment } from '../src/simulation/LaneManager.js';
import { Route, Vehicle } from '../src/simulation/Vehicle.js';
import { Path, makeObb, setObb, obbOverlap, obbDistance } from '../src/utils/math.js';
import { VEHICLE_TYPES } from '../src/data/vehicles.js';
import { PERSONALITIES, MIN_BUFFER } from '../src/data/config.js';

function laneRoute(x0, y0, x1, y1) {
  return new Route([new Segment('lane', `l${x0}${y0}`, new Path([{ x: x0, y: y0 }, { x: x1, y: y1 }]))]);
}

function vehicle(route, s, type = 'car', personality = 'patient') {
  return new Vehicle({ spec: VEHICLE_TYPES[type], personality: PERSONALITIES[personality], route, color: '#ffffff', s, v: 10 });
}

describe('OBB geometry', () => {
  it('detects axis-aligned and rotated overlaps', () => {
    const a = setObb(makeObb(), 0, 0, 1, 0, 2, 1);
    const b = setObb(makeObb(), 3.9, 0, 1, 0, 2, 1);
    const c = setObb(makeObb(), 4.1, 0, 1, 0, 2, 1);
    expect(obbOverlap(a, b)).toBe(true);
    expect(obbOverlap(a, c)).toBe(false);
    const ang = Math.PI / 4;
    const d = setObb(makeObb(), 2.6, 1.6, Math.cos(ang), Math.sin(ang), 2, 1);
    expect(obbOverlap(a, d)).toBe(true);
    const e = setObb(makeObb(), 4.5, 3.5, Math.cos(ang), Math.sin(ang), 2, 1);
    expect(obbOverlap(a, e)).toBe(false);
  });

  it('computes separation distance', () => {
    const a = setObb(makeObb(), 0, 0, 1, 0, 2, 1);
    const b = setObb(makeObb(), 5, 0, 1, 0, 2, 1);
    expect(obbDistance(a, b)).toBeCloseTo(1, 6);
    const c = setObb(makeObb(), 0, 3, 1, 0, 2, 1);
    expect(obbDistance(a, c)).toBeCloseTo(1, 6);
    expect(obbDistance(a, setObb(makeObb(), 1, 0.5, 1, 0, 2, 1))).toBe(0);
  });
});

describe('CollisionAvoidance', () => {
  it('stops a follower at the safety buffer behind a stationary vehicle', () => {
    const route = laneRoute(0, 0, 200, 0);
    const leader = vehicle(route, 30);
    const follower = vehicle(route, 22);
    const ca = new CollisionAvoidance();
    ca.rebuild([leader, follower]);
    const allowed = ca.safeAdvance(follower, 5);
    follower.s += allowed;
    follower.updatePose();
    const gap = obbDistance(leader.obb, follower.obb);
    expect(gap).toBeGreaterThanOrEqual(MIN_BUFFER - 1e-3);
    expect(gap).toBeLessThan(MIN_BUFFER + 0.05);
  });

  it('rejects a large jump that would pass through another vehicle (swept check)', () => {
    const route = laneRoute(0, 0, 200, 0);
    const leader = vehicle(route, 30);
    const follower = vehicle(route, 20);
    const ca = new CollisionAvoidance();
    ca.rebuild([leader, follower]);
    const allowed = ca.safeAdvance(follower, 25); // would end up beyond the leader
    expect(follower.s + allowed).toBeLessThan(30 - 4.4);
  });

  it('blocks movement into a vehicle crossing the path', () => {
    const eastbound = laneRoute(0, 0, 100, 0);
    const southbound = laneRoute(50, -50, 50, 50);
    const a = vehicle(eastbound, 44);
    const b = vehicle(southbound, 50); // sitting at (50, 0)
    const ca = new CollisionAvoidance();
    ca.rebuild([a, b]);
    const allowed = ca.safeAdvance(a, 6);
    a.s += allowed;
    a.updatePose();
    expect(obbOverlap(a.obb, b.obb)).toBe(false);
    expect(obbDistance(a.obb, b.obb)).toBeGreaterThanOrEqual(MIN_BUFFER - 1e-3);
  });

  it('lets adjacent-lane traffic pass side by side (cars beside buses)', () => {
    const lane0 = laneRoute(0, 1.75, 200, 1.75);
    const lane1 = laneRoute(0, 5.25, 200, 5.25);
    const bus = vehicle(lane1, 50, 'bus');
    const car = vehicle(lane0, 40, 'car');
    const ca = new CollisionAvoidance();
    ca.rebuild([bus, car]);
    expect(ca.safeAdvance(car, 0.25)).toBeCloseTo(0.25, 9);
  });

  it('probe reports the free distance before crossing traffic', () => {
    const eastbound = laneRoute(0, 0, 100, 0);
    const southbound = laneRoute(50, -50, 50, 50);
    const a = vehicle(eastbound, 40);
    const b = vehicle(southbound, 50);
    const ca = new CollisionAvoidance();
    ca.rebuild([a, b]);
    const free = ca.probe(a, 12);
    expect(free).toBeLessThan(8);
    expect(free).toBeGreaterThanOrEqual(0);
  });

  it('an aggressive personality gains nothing against the gate', () => {
    const route = laneRoute(0, 0, 200, 0);
    const leader = vehicle(route, 30, 'car');
    const aggressive = vehicle(route, 24.9, 'car', 'aggressive');
    const ca = new CollisionAvoidance();
    ca.rebuild([leader, aggressive]);
    for (let i = 0; i < 200; i++) {
      aggressive.s += ca.safeAdvance(aggressive, 0.3);
      aggressive.updatePose();
    }
    expect(obbDistance(leader.obb, aggressive.obb)).toBeGreaterThanOrEqual(MIN_BUFFER - 1e-3);
  });
});
