import { describe, it, expect } from 'vitest';
import { Environment } from '../src/simulation/Environment.js';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { makeLevel } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

const MIN_SEP = 0.44;

function soak(sim, seconds, onStep) {
  const rng = new Rng(8);
  let next = 5;
  const lastS = new Map();
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    if (sim.time > next) {
      for (const [id, m] of sim.lights.managers) sim.requestPhase(id, rng.pick(m.groups));
      next = sim.time + rng.range(6, 16);
    }
    sim.step(SIM_DT);
    for (const v of sim.vehicles) {
      const p = lastS.get(v);
      if (p !== undefined) {
        expect(v.s).toBeGreaterThanOrEqual(p - 1e-9);
        expect(v.s - p).toBeLessThanOrEqual(v.spec.maxSpeed * 1.2 * SIM_DT + 1e-6);
      }
      lastS.set(v, v.s);
    }
    onStep?.(sim);
    if (i % 2 === 0) {
      const issues = CollisionAvoidance.auditPairs(sim.vehicles, MIN_SEP);
      if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
    }
  }
}

describe('Environment', () => {
  it('rain lowers braking and speed and lengthens gaps; it builds up gradually', () => {
    const env = new Environment({ env: { weather: [{ t: 0, type: 'clear' }, { t: 10, type: 'heavyRain' }] } });
    expect(env.brakeFactor).toBe(1);
    env.update(SIM_DT, 10);
    expect(env.weather).toBe('heavyRain');
    expect(env.rain).toBeLessThan(0.05); // not instantly soaked
    for (let i = 0; i < 60 * 60; i++) env.update(SIM_DT, 10 + i * SIM_DT);
    expect(env.rain).toBeGreaterThan(0.95);
    expect(env.brakeFactor).toBeLessThan(0.7);
    expect(env.gapFactor).toBeGreaterThan(1.3);
    expect(env.speedFactor).toBeLessThan(0.9);
  });

  it('the clock runs, gets dark in the evening and drives rush-hour demand', () => {
    const env = new Environment({ env: { hour: 17, rate: 6, rushHour: true } });
    expect(env.darkness).toBe(0);
    const before = env.demandFactor;
    for (let i = 0; i < 60 * 21; i++) env.update(SIM_DT, i * SIM_DT); // 21 s real = 2.1 game hours
    expect(env.hour).toBeCloseTo(19.1, 2);
    expect(env.darkness).toBe(1);
    expect(env.clock()).toMatch(/^7:0[56] PM$/);
    expect(before).toBeGreaterThan(1.1); // building toward the 18:00 peak
  });

  it('levels without an environment behave as before (neutral factors)', () => {
    const env = new Environment({});
    expect([env.brakeFactor, env.headwayFactor, env.gapFactor, env.speedFactor, env.reactionExtra, env.demandFactor]).toEqual([1, 1, 1, 1, 0, 1]);
  });
});

describe('Lane changes', () => {
  it('drivers change lanes on multi-lane roads and stay collision-free', () => {
    const lvl = makeLevel({
      map: 'commonwealth',
      prewarm: 0,
      demand: { N: 6, S: 6, E: 16, W: 16 },
      mix: { car: 0.45, motorcycle: 0.25, jeepney: 0.2, bus: 0.1 },
      personalities: { patient: 0.3, impatient: 0.4, aggressive: 0.2, cautious: 0.1 },
      turns: { left: 0.15, right: 0.15 },
      loadingStops: 0.6,
    });
    const sim = new TrafficSimulator(lvl, { seed: 4 });
    let sideways = 0;
    soak(sim, 120, (s) => {
      for (const v of s.vehicles) if (v.lc && Math.abs(v.lateralOffset()) > 0.5) sideways++;
    });
    expect(sim.laneChanger.changes).toBeGreaterThan(10);
    expect(sideways).toBeGreaterThan(0);
    expect(sim.stats.processed).toBeGreaterThan(30);
  });

  it('drivers behind a jeepney stopped to load pull out round it', () => {
    const lvl = makeLevel({ map: 'commonwealth', prewarm: 0, demand: { N: 6, S: 6, E: 22, W: 22 }, mix: { car: 0.6, jeepney: 0.4 }, loadingStops: 1 });
    const sim = new TrafficSimulator(lvl, { seed: 3 });
    const prevLc = new Map();
    let pulledOut = 0;
    let stuck = 0;
    soak(sim, 200, (s) => {
      const byId = new Map(s.vehicles.map((o) => [o.id, o]));
      for (const v of s.vehicles) {
        // A change that leaves a jeepney stopping / stopped to load ahead in the old lane
        if (v.lc && prevLc.get(v) === false && v.lc.fromLane.vehicles.some((o) => o.localS > v.localS && o.loading && o.loading.state !== 'done')) pulledOut++;
        prevLc.set(v, !!v.lc);
        const lead = byId.get(v.leaderId);
        if (lead?.loading?.state === 'stopped' && lead.segment === v.segment && v.v < 0.3 && v.stoppedTime > 4) stuck++;
      }
    });
    expect(pulledOut).toBeGreaterThan(5);
    expect(stuck).toBe(0);
  });

  it('a lane change keeps the route coordinate continuous', () => {
    const lvl = makeLevel({ map: 'espana', prewarm: 0, demand: { N: 12, S: 12, E: 12, W: 12 }, mix: { car: 0.6, jeepney: 0.4 }, loadingStops: 1, personalities: { impatient: 1 } });
    const sim = new TrafficSimulator(lvl, { seed: 2 });
    let checked = 0;
    for (let i = 0; i < 90 / SIM_DT && checked < 5; i++) {
      const before = new Map(sim.vehicles.map((v) => [v, { s: v.s, x: v.x, y: v.y, lc: v.lc }]));
      sim.step(SIM_DT);
      for (const v of sim.vehicles) {
        const b = before.get(v);
        if (!b || b.lc || !v.lc) continue;
        checked++;
        // the body does not jump sideways when it switches lanes
        expect(Math.hypot(v.x - b.x, v.y - b.y)).toBeLessThan(v.spec.maxSpeed * 1.2 * SIM_DT + 0.05);
        expect(v.s).toBeGreaterThanOrEqual(b.s - 1e-9);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Weather stays collision-free', () => {
  it('heavy rain at night with mixed traffic', () => {
    const lvl = makeLevel({
      map: 'taft',
      prewarm: 0,
      demand: { N: 11, S: 11, E: 10, W: 10 },
      mix: { car: 0.4, motorcycle: 0.25, jeepney: 0.2, bus: 0.05, tricycle: 0.05, truck: 0.05 },
      personalities: { patient: 0.3, impatient: 0.4, aggressive: 0.2, cautious: 0.1 },
      turns: { left: 0.2, right: 0.2 },
      loadingStops: 0.4,
      env: { hour: 20, weather: [{ t: 0, type: 'heavyRain' }] },
    });
    const sim = new TrafficSimulator(lvl, { seed: 6 });
    soak(sim, 100);
    expect(sim.env.darkness).toBe(1);
    expect(sim.stats.processed).toBeGreaterThan(15);
  });
});
