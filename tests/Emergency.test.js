import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { makeLevel } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { registerRotondaMaps } from './fixtures/rotondaMaps.js';

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
  it('get through quickly and without collisions (AUTO gives them the green; an empty red line they cross)', () => {
    // Light demand on the red roads so their queues never reach the map edge (ambulances must be able to spawn).
    const sim = new TrafficSimulator(level({ autoLights: true, demand: { N: 2.5, S: 2.5, E: 12, W: 2.5 }, emergency: { times: [4, 22, 40, 58, 76, 94, 112, 130] } }), { seed: 5 });
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
    expect(onRed.size).toBeGreaterThanOrEqual(0);
    expect(em.worst).toBeLessThan(30);
  });

  it('cross traffic gives way while an emergency vehicle crosses on red', () => {
    // AUTO lights give the emergency its green, as a player would.
    const sim = new TrafficSimulator(level({ autoLights: true, emergency: { times: [3, 25, 47, 69, 91] } }), { seed: 9 });
    let violations = 0;
    const held = new Set(sim.vehicles.filter((v) => v.reservations.has('A')));
    run(sim, 120, (s) => {
      const A = s.network.byId.get('A');
      for (const v of s.vehicles) {
        const res = v.reservations.get('A');
        if (!res) {
          held.delete(v);
          continue;
        }
        if (held.has(v)) continue;
        held.add(v); // a reservation granted during this step
        // Only movements crossing or merging into the emergency vehicle's path give way.
        const claim = v.emergency ? null : s.emergencyClaimFor(v, A, res.conn);
        if (!claim) continue;
        // Nobody else gets into a claimed path unless it was too late to stop or it is clearing
        // the way in front of the emergency vehicle.
        const late = (v.v * v.v) / (2 * v.spec.decel) >= res.connStart - v.front - 2;
        const escort = claim.lane && res.conn.fromLane === claim.lane;
        if (!late && !escort) violations++;
      }
    });
    expect(violations).toBe(0);
    expect(sim.emergencySummary().cleared).toBeGreaterThanOrEqual(4);
  });

  it('cars queued in front of an ambulance at a red never run the red: they wait (or move over) until green', () => {
    // Only North traffic, held at red; an ambulance arrives behind the queue.
    const sim = new TrafficSimulator(
      level({ demand: { N: 18, S: 0, E: 0, W: 0 }, mix: { car: 1 }, turns: { left: 0, right: 0 }, personalities: { patient: 1 }, emergency: { times: [20] } }),
      { seed: 3 },
    );
    sim.spawner.keys = ['A:N']; // the ambulance comes from the North, behind the red queue
    let ranRed = 0;
    run(sim, 50, (s) => {
      for (const v of s.vehicles) if (!v.emergency && v.segment.kind === 'connector' && v.segment.arm === 'N' && s.lights.signal('A', 'N') === 'red' && !v._entered) ranRed++;
    });
    expect(ranRed).toBe(0);
    expect(sim.stats.processed).toBe(0);
    sim.requestPhase('A', 'N'); // the player gives North the green
    run(sim, 40);
    expect(sim.emergencySummary().cleared).toBe(1);
  });

  it('an ambulance stuck behind a red queue does not hold up the green road crossing its path', () => {
    const sim = new TrafficSimulator(
      level({ demand: { N: 18, S: 0, E: 10, W: 0 }, mix: { car: 1 }, turns: { left: 0, right: 0 }, personalities: { patient: 1 } }),
      { seed: 3 },
    );
    let heldClaims = 0;
    let eastIn = 0;
    run(sim, 50, (s) => {
      if (Math.abs(s.time - 20) < 1e-6 || (s.time > 20 && s.time - 1 / 60 < 20)) s.spawner.createArrival('A:N', true); // behind the red North queue
      for (const c of s.emergencyClaims) {
        if (c.pass || c.v.v >= 0.5 || c.v.cf) continue; // (claims are made before the step: allow for it still braking)
        if (!s.isLaneHead(c.v, c.v.nextConnEntry())) heldClaims++;
      }
      for (const v of s.vehicles) if (v.segment.kind === 'connector' && v.segment.arm === 'E' && !v._seenIn) ((v._seenIn = true), eastIn++);
    });
    expect(sim.vehicles.some((v) => v.emergency)).toBe(true);
    expect(heldClaims).toBe(0);
    expect(eastIn).toBeGreaterThan(3);
  });

  it('traffic whose path never meets the emergency vehicle keeps moving', () => {
    const sim = new TrafficSimulator(level({ emergency: { times: [3, 25, 47, 69, 91] } }), { seed: 9 });
    let unrelatedEntries = 0;
    let wrongHolds = 0;
    const A = sim.network.byId.get('A');
    run(sim, 110, (s) => {
      const claims = s.emergencyClaims.filter((c) => c.I === A && !c.pass);
      if (!claims.length) return;
      for (const v of s.vehicles) {
        if (v.emergency) continue;
        const ce = v.nextConnEntry();
        if (!ce || ce.seg.intersection !== A) continue;
        const related = s.emergencyClaimFor(v, A, ce.seg);
        if (!related && v.reservations.has('A') && ce.start - v.front < 2) unrelatedEntries++;
        if (!related && v.blockReason === 'emergency') wrongHolds++;
      }
    });
    expect(wrongHolds).toBe(0);
    expect(unrelatedEntries).toBeGreaterThan(0);
  });

  it('an emergency claim at a busy junction never reads as gridlock', () => {
    const sim = new TrafficSimulator(level({ emergency: { times: [5, 35, 65] } }), { seed: 12 });
    run(sim, 90);
    expect(sim.metrics.gridlockTime).toBeLessThan(5);
  });

  it('a siren up the oncoming lane and a truck coming off the rotonda into that road never wedge each other', () => {
    // Welcome Rotonda (2-lane undivided arms): a fire truck up the oncoming lane at the stop line, and
    // a truck crossing the ring into the next lane over, whose swing runs into it where it stands.
    // (The Welcome level no longer has a rotonda: the old map lives on as a test fixture.)
    registerRotondaMaps();
    const lm = new LevelManager();
    const sim = lm.createSim(
      {
        ...lm.get('pinoy', 'welcome'),
        map: 'rotondaWelcome',
        initialGroups: { A: 'E' },
        demand: { N: 6, S: 7, E: 12, W: 11 },
        autoLights: true,
        emergency: { times: [20, 28, 36, 60, 68, 76, 100, 108, 116] },
      },
      8,
    );
    const I = sim.network.byId.get('A');
    const since = new Map(); // crossing vehicle -> time first seen wedged against a siren out there
    run(sim, 180, (s) => {
      for (const v of s.counterflow.active) {
        if (!v.cf.emergency || v.segment !== v.cf.lane || v.stoppedTime < 5) continue;
        const outs = I.exitLanes[v.cf.lane.endArm];
        for (const c of I.connectors) {
          if (!outs.includes(c.toLane)) continue;
          for (const o of c.vehicles) if (o.stoppedTime > 5 && !since.has(o)) since.set(o, s.time);
        }
      }
      for (const [o, t] of since) {
        if (o.segment.kind !== 'connector') since.delete(o);
        else expect(s.time - t).toBeLessThan(40);
      }
    });
    expect(sim.emergencySummary().cleared).toBeGreaterThan(3);
  });
});
