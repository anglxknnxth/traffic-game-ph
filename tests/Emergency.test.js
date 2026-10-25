import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { makeLevel } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';

const MIN_SEP = 0.44;

function run(sim, seconds, onStep) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(SIM_DT);
    onStep?.(sim);
    const issues = CollisionAvoidance.auditPairs(sim.vehicles, MIN_SEP);
    if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
  }
}

const level = (over = {}) =>
  makeLevel({
    prewarm: 0,
    demandWave: 0,
    demandScale: 1,
    cornerStops: 0,
    // Every road has its own green: East stays green, the other three stay red.
    demand: { N: 4, S: 4, E: 12, W: 4 },
    mix: { car: 0.7, motorcycle: 0.2, jeepney: 0.1 },
    personalities: { patient: 0.5, impatient: 0.3, aggressive: 0.2 },
    turns: { left: 0.15, right: 0.15 },
    initialGroups: { A: 'E' },
    ...over,
  });

describe('Emergency vehicles ignore red lights', () => {
  it('cross against a red without collisions and with little delay', () => {
    // The player never touches the lights: East stays green the whole time.
    // Light demand on the red roads so their queues never reach the map edge (ambulances must be able to spawn).
    const sim = new TrafficSimulator(level({ demand: { N: 2.5, S: 2.5, E: 12, W: 2.5 }, emergency: { times: [4, 22, 40, 58, 76, 94, 112, 130] } }), { seed: 5 });
    const onRed = new Set();
    run(sim, 160, (s) => {
      for (const v of s.vehicles) {
        if (!v.emergency) continue;
        const ce = v.nextConnEntry();
        if (ce && v.reservations.has('A') && s.lights.signal('A', ce.seg.arm, ce.seg.movement) === 'red') onRed.add(v.id);
      }
    });
    const em = sim.emergencySummary();
    expect(em.arrivals).toBe(8);
    expect(em.cleared).toBe(8);
    expect(onRed.size).toBeGreaterThan(0); // some came from North/South and went through on red
    expect(em.worst).toBeLessThan(30);
  });

  it('cross traffic gives way while an emergency vehicle crosses on red', () => {
    const sim = new TrafficSimulator(level({ emergency: { times: [3, 25, 47, 69, 91] } }), { seed: 9 });
    let violations = 0;
    const held = new Set(sim.vehicles.filter((v) => v.reservations.has('A')));
    run(sim, 120, (s) => {
      const claim = s.emergencyClaims.find((c) => c.I.id === 'A');
      for (const v of s.vehicles) {
        const res = v.reservations.get('A');
        if (!res) {
          held.delete(v);
          continue;
        }
        if (held.has(v)) continue;
        held.add(v); // a reservation granted during this step
        if (!claim || v.emergency) continue;
        // Nobody else gets into a claimed junction unless it was too late to stop or it is clearing
        // the way in front of the emergency vehicle.
        const late = (v.v * v.v) / (2 * v.spec.decel) >= res.connStart - v.front - 2;
        const escort = claim.lane && res.conn.fromLane === claim.lane;
        if (!late && !escort) violations++;
      }
    });
    expect(violations).toBe(0);
    expect(sim.emergencySummary().cleared).toBeGreaterThanOrEqual(4);
  });

  it('cars queued in front of an ambulance at a red move through to clear the way', () => {
    // Only North traffic, held at red; an ambulance arrives behind the queue.
    const sim = new TrafficSimulator(
      level({ demand: { N: 18, S: 0, E: 0, W: 0 }, mix: { car: 1 }, turns: { left: 0, right: 0 }, personalities: { patient: 1 }, emergency: { times: [20] } }),
      { seed: 3 },
    );
    sim.spawner.keys = ['A:N']; // the ambulance comes from the North, behind the red queue
    run(sim, 70);
    const em = sim.emergencySummary();
    expect(em.cleared).toBe(1);
    expect(sim.lights.signal('A', 'N')).toBe('red');
    expect(sim.stats.processed).toBeGreaterThan(1); // the ambulance plus the cars that cleared the way
  });

  it('an emergency claim at a busy junction never reads as gridlock', () => {
    const sim = new TrafficSimulator(level({ emergency: { times: [5, 35, 65] } }), { seed: 12 });
    run(sim, 90);
    expect(sim.metrics.gridlockTime).toBeLessThan(5);
  });
});
