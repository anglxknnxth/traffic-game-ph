// Regressions from the 2026-10-27 self-playtest (headless sweep of every level, vehicle type and event).
import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { PED_RADIUS } from '../src/simulation/PedestrianManager.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { makeLevel } from '../src/data/levels.js';
import { MAPS } from '../src/data/maps/index.js';
import { SIM_DT, OPPOSITE } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

const lm = new LevelManager();

/** Random signal play, as a careless player: every road in turn at random, every 4–20 s. */
function playRandom(sim, seconds, seed, onStep) {
  const rng = new Rng(seed);
  let next = 4;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    if (sim.time > next) {
      for (const [id, m] of sim.lights.managers) sim.requestPhase(id, rng.pick(m.groups));
      next = sim.time + rng.range(4, 20);
    }
    sim.step(SIM_DT);
    onStep?.(sim);
  }
}

/**
 * No more arrivals and a fair fixed-time controller (14 s a road, never two opposite roads back to
 * back: that would pair them and hold their left turns). Returns once everyone is gone or after
 * `limit` seconds.
 */
function drain(sim, limit = 420) {
  sim.spawner.createArrival = () => null;
  const cycle = (gs) => {
    const out = [];
    for (const g of gs) {
      const prev = out.at(-1);
      if (prev && OPPOSITE[prev] === g) out.push(gs.find((x) => x !== g && x !== prev && OPPOSITE[x] !== g && OPPOSITE[x] !== prev) ?? gs.find((x) => x !== g && x !== prev));
      out.push(g);
    }
    if (out.length > 1 && OPPOSITE[out.at(-1)] === out[0]) out.push(gs.find((x) => x !== out[0] && x !== out.at(-1)));
    return out.filter(Boolean);
  };
  const groups = [...sim.lights.managers].map(([id, m]) => [id, cycle(m.groups)]);
  const every = Math.round(14 / SIM_DT);
  for (let n = 0, k = 0; n < limit / SIM_DT && (sim.vehicles.length || sim.spawner.pendingCount()); n++) {
    if (n % every === 0) {
      for (const [id, g] of groups) sim.requestPhase(id, g[k % g.length]);
      k++;
    }
    sim.step(SIM_DT);
  }
}

/** Distance from a point to a vehicle's body (0 when inside). */
function distToVehicle(px, py, o) {
  const dx = px - o.x;
  const dy = py - o.y;
  const u = Math.abs(dx * o.c + dy * o.s) - o.hl;
  const v = Math.abs(-dx * o.s + dy * o.c) - o.hw;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

describe('Counterflow never strands a vehicle in the oncoming lane', () => {
  it('career 8 (seed 99): after a careless player, fair lights clear every vehicle', () => {
    const sim = lm.createSim(lm.get('career', 8), 99);
    let longestOut = 0;
    playRandom(sim, 200, 99, (s) => {
      for (const v of s.vehicles) if (v.cf && v.v < 0.05) longestOut = Math.max(longestOut, v.cf.stall || 0);
    });
    drain(sim);
    expect(sim.vehicles.filter((v) => v.stoppedTime > 60)).toEqual([]);
    expect(sim.vehicles.filter((v) => v.cf)).toEqual([]);
    expect(longestOut).toBeLessThan(25);
  });

  it('a siren that gives up lets go of the junction it was granted', () => {
    const sim = lm.createSim(lm.get('career', 8), 99);
    playRandom(sim, 200, 99, (s) => {
      for (const v of s.vehicles) {
        if (!v.cf?.gaveUp) continue;
        // backing off or back in the queue, it holds no box ahead
        const ahead = v.cf.lane.endInt;
        if (v.segment === v.cf.lane && ahead) expect(v.reservations.has(ahead.id)).toBe(false);
      }
    });
  });
});

describe('Counterflow looks out for people crossing', () => {
  for (const seed of [13, 2]) {
    it(`Davao (seed ${seed}): no siren up the oncoming lane runs into anyone on the crosswalk`, () => {
      const sim = lm.createSim(lm.get('pinoy', 'davao'), seed);
      let closest = Infinity;
      playRandom(sim, 240, seed, (s) => {
        for (const p of s.peds.peds) {
          if (p.state !== 'cross' && p.state !== 'jaywalk') continue;
          for (const v of s.vehicles) {
            if (Math.abs(v.x - p.x) > 8 || Math.abs(v.y - p.y) > 8 || Math.abs(v.layer || 0) >= 1) continue;
            closest = Math.min(closest, distToVehicle(p.x, p.y, v.obb) - PED_RADIUS);
          }
        }
      });
      expect(closest).toBeGreaterThan(0.1);
    }, 180000);
  }
});

describe('Daily Challenge', () => {
  it('every day of the year is on a real map', () => {
    const d = new Date('2026-01-01T12:00:00');
    for (let k = 0; k < 365; k++, d.setDate(d.getDate() + 1)) {
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const lvl = lm.daily(date);
      // (the default kanto is Endless itself, whose level names no map: `single`)
      expect(MAPS[lvl.map || 'single'], date).toBeTruthy();
      expect(lvl.name, date).not.toContain('undefined');
    }
  });
});

const base = (over) =>
  makeLevel({ prewarm: 0, demandWave: 0, demandScale: 1, cornerStops: 0, mix: { car: 1 }, personalities: { patient: 1 }, turns: { left: 0, right: 0 }, pedestrians: null, ...over });

describe('Priority pass', () => {
  it('a waved-through car sitting at its red makes nobody hold back; on its green it does', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 12, S: 0, E: 0, W: 0 }, initialGroups: { A: 'E' } }), { seed: 3 });
    for (let i = 0; i < 30 / SIM_DT; i++) sim.step(SIM_DT);
    const head = sim.vehicles.filter((v) => v.route.entries[0].seg.arm === 'N').reduce((a, b) => (a.s > b.s ? a : b));
    expect(head.signal).toBe('red');
    head.pass = sim.time + 100;
    sim.step(SIM_DT);
    expect(sim.emergencyClaims.some((c) => c.pass && c.v === head)).toBe(false);
    sim.requestPhase('A', 'N');
    let claimed = false;
    for (let i = 0; i < 8 / SIM_DT && !claimed; i++) {
      sim.step(SIM_DT);
      claimed = sim.emergencyClaims.some((c) => c.pass && c.v === head);
    }
    expect(claimed).toBe(true);
  });
});

describe('Spawner edge cases', () => {
  it('bicycles only, on roads without a bike lane: nobody comes, nothing breaks', () => {
    const sim = new TrafficSimulator(base({ mix: { bicycle: 1 } }), { seed: 1 });
    for (let i = 0; i < 30 / SIM_DT; i++) sim.step(SIM_DT);
    expect(sim.stats.spawned).toBe(0);
  });

  it('demand dropping to zero mid-run sends nobody', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 10, S: 10, E: 10, W: 10 } }), { seed: 1 });
    for (let i = 0; i < 20 / SIM_DT; i++) sim.step(SIM_DT);
    let arrivals = 0;
    const create = sim.spawner.createArrival.bind(sim.spawner);
    sim.spawner.createArrival = (...a) => (arrivals++, create(...a));
    sim.demandMul = 0;
    for (let i = 0; i < 60 / SIM_DT; i++) sim.step(SIM_DT);
    expect(arrivals).toBe(0);
  });
});
