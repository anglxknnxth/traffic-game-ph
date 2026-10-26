import { describe, it, expect } from 'vitest';
import { TrafficSimulator } from '../src/simulation/TrafficSimulator.js';
import { CollisionAvoidance } from '../src/simulation/CollisionAvoidance.js';
import { AI_STATE } from '../src/simulation/Vehicle.js';
import { LevelManager } from '../src/game/LevelManager.js';
import { makeLevel, CAREER_LEVELS, PINOY_LEVELS, CHALLENGES, ENDLESS_LEVEL } from '../src/data/levels.js';
import { SIM_DT } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

const MIN_SEP = 0.44; // MIN_BUFFER minus numerical tolerance

/** Runs the sim, asserting the core safety invariants on every step. */
function runChecked(sim, seconds, { onStep, auditEvery = 1 } = {}) {
  const lastS = new Map();
  sim.keepRemovedLog = true;
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    onStep?.(sim, i);
    sim.step(SIM_DT);
    expect(sim.lights.conflictingGreens()).toBe(0);
    for (const v of sim.vehicles) {
      const prev = lastS.get(v);
      if (prev !== undefined) {
        // no reversing (except backing up out of the oncoming lane, see Counterflow, or to unpin a
        // gate stalemate, see Unstick), no teleporting
        if (!v.cf?.reverse && !v.backing) expect(v.s).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(v.s - prev).toBeLessThanOrEqual(v.spec.maxSpeed * 1.2 * SIM_DT + 1e-6);
      }
      lastS.set(v, v.s);
    }
    if (i % auditEvery === 0) {
      const issues = CollisionAvoidance.auditPairs(sim.vehicles, MIN_SEP);
      if (issues.length) throw new Error(`Separation violated at t=${sim.time.toFixed(2)}: ${JSON.stringify(issues[0])}`);
    }
  }
  // Vehicles only ever leave at the end of their route.
  for (const r of sim.removedLog) expect(r.front).toBeGreaterThanOrEqual(r.routeLength - 0.6);
}

const base = (over) =>
  makeLevel({
    prewarm: 0,
    demandWave: 0,
    demandScale: 1,
    cornerStops: 0,
    mix: { car: 1 },
    personalities: { patient: 1 },
    turns: { left: 0, right: 0 },
    ...over,
  });

describe('Vehicle behaviour', () => {
  it('stops at a red light and proceeds on green', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 20, S: 0, E: 0, W: 0 }, initialGroups: { A: 'EW' } }), { seed: 3 });
    runChecked(sim, 40);
    const fromNorth = sim.vehicles.filter((v) => v.route.entries[0].seg.arm === 'N');
    expect(fromNorth.length).toBeGreaterThan(3);
    for (const v of fromNorth) expect(v.nextConn).toBe(0); // nobody crossed the stop line
    const head = fromNorth.reduce((a, b) => (a.s > b.s ? a : b));
    expect(head.v).toBeLessThan(0.05);
    expect(head.route.entries[0].end - head.front).toBeLessThan(1.5);
    expect(head.state).toBe(AI_STATE.STOPPED_AT_RED);
    expect(sim.stats.processed).toBe(0);

    sim.requestPhase('A', 'NS');
    runChecked(sim, 30);
    expect(sim.stats.processed).toBeGreaterThan(3);
  });

  it('brakes smoothly behind a queue (no collision-gate emergency stops in normal traffic)', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 18, S: 0, E: 0, W: 0 }, initialGroups: { A: 'EW' } }), { seed: 5 });
    let maxDecel = 0;
    const prevV = new Map();
    runChecked(sim, 50, {
      onStep: (s) => {
        for (const v of s.vehicles) {
          const p = prevV.get(v);
          if (p !== undefined) maxDecel = Math.max(maxDecel, (p - v.v) / SIM_DT);
          prevV.set(v, v.v);
        }
      },
    });
    expect(sim.stats.gateInterventions).toBe(0);
    expect(maxDecel).toBeLessThanOrEqual(8 + 1e-6); // never beyond the hard-braking limit
  });

  it('turning vehicles follow continuous paths with smooth heading changes', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 10, S: 10, E: 10, W: 10 }, turns: { left: 0.4, right: 0.4 } }), { seed: 8 });
    const prevAngle = new Map();
    let maxTurnRate = 0;
    let turned = 0;
    runChecked(sim, 90, {
      onStep: (s, i) => {
        if (i % 600 === 300) s.requestPhase('A', s.lights.manager('A').activeGroup === 'NS' ? 'EW' : 'NS');
        for (const v of s.vehicles) {
          const p = prevAngle.get(v);
          if (p !== undefined) {
            let d = Math.abs(v.angle - p);
            if (d > Math.PI) d = 2 * Math.PI - d;
            maxTurnRate = Math.max(maxTurnRate, d / SIM_DT);
          }
          prevAngle.set(v, v.angle);
          if (v.segment.kind === 'connector' && v.segment.movement !== 'straight') v._turned = true;
        }
      },
    });
    for (const v of prevAngle.keys()) if (v._turned) turned++;
    expect(turned).toBeGreaterThan(5);
    expect(maxTurnRate).toBeLessThan(2.5); // rad/s — smooth rotation, no snapping
    // connector geometry joins lanes exactly
    for (const c of sim.network.connectors) {
      const p0 = c.path.points()[0];
      const p1 = c.path.points().at(-1);
      expect(Math.hypot(p0.x - c.fromLane.end.x, p0.y - c.fromLane.end.y)).toBeLessThan(1e-9);
      expect(Math.hypot(p1.x - c.toLane.start.x, p1.y - c.toLane.start.y)).toBeLessThan(1e-9);
    }
  });

  it('with waitForExit, patient drivers never enter a box whose exit is blocked', () => {
    const lvl = base({
      waitForExit: true,
      demand: { N: 0, S: 22, E: 0, W: 0 },
      initialGroups: { A: 'S' },
      blockages: [{ exit: 'A:N', lanes: [0, 1], s: 12, start: 0, end: 999, label: 'TEST' }],
    });
    const sim = new TrafficSimulator(lvl, { seed: 2 });
    let blockedInBox = 0;
    runChecked(sim, 80, { onStep: (s) => (blockedInBox += s.vehicles.filter((v) => v.state === AI_STATE.BLOCKED_IN_INTERSECTION).length) });
    expect(sim.stats.boxBlockEntries).toBe(0);
    expect(blockedInBox).toBe(0);
    const waiting = sim.vehicles.filter((v) => v.blockReason === 'exit');
    expect(waiting.length).toBeGreaterThan(0); // green traffic stays stuck at the line instead
    for (const v of sim.vehicles) {
      if (v.segment.kind === 'connector') expect(v.v).toBeGreaterThan(-1); // sanity
    }
  });

  it('on a green, drivers cross into the box even when the road beyond is full', () => {
    const lvl = base({
      demand: { N: 0, S: 22, E: 0, W: 0 },
      initialGroups: { A: 'S' },
      blockages: [{ exit: 'A:N', lanes: [0, 1], s: 12, start: 0, end: 999, label: 'TEST' }],
    });
    const sim = new TrafficSimulator(lvl, { seed: 2 });
    let inBox = 0;
    runChecked(sim, 80, { onStep: (s) => (inBox += s.vehicles.filter((v) => v.state === AI_STATE.BLOCKED_IN_INTERSECTION).length) });
    expect(sim.stats.boxBlockEntries).toBeGreaterThan(0);
    expect(inBox).toBeGreaterThan(0);
  });
});

describe('Gridlock', () => {
  const jamLevel = () =>
    base({
      demand: { N: 0, S: 24, E: 12, W: 12 },
      personalities: { aggressive: 1 },
      boxBlockFactor: 2,
      initialGroups: { A: 'S' },
      blockages: [{ exit: 'A:N', lanes: [0, 1], s: 3, start: 0, end: 80, label: 'TEST' }],
    });

  it('vehicles can become trapped in the box while cross traffic stays separated', () => {
    const sim = new TrafficSimulator(jamLevel(), { seed: 4 });
    let sawBlocked = false;
    let crossWaitingForBox = false;
    runChecked(sim, 75, {
      onStep: (s, i) => {
        if (i === 45 * 60) s.requestPhase('A', 'E');
        if (s.vehicles.some((v) => v.state === AI_STATE.BLOCKED_IN_INTERSECTION)) sawBlocked = true;
        if (s.lights.signal('A', 'E') === 'green' && s.vehicles.some((v) => v.route.entries[0].seg.arm !== 'S' && v.blockReason === 'box')) crossWaitingForBox = true;
      },
    });
    expect(sim.stats.boxBlockEntries).toBeGreaterThan(0);
    expect(sawBlocked).toBe(true);
    expect(crossWaitingForBox).toBe(true);
  });

  it('honking increases during prolonged delays', () => {
    // North and South share one green (a pair), so that traffic flows freely.
    const free = new TrafficSimulator(base({ demand: { N: 10, S: 10, E: 0, W: 0 }, personalities: { impatient: 1 } }), { seed: 6 });
    free.requestPhase('A', 'S');
    runChecked(free, 60, { auditEvery: 4 });
    const jam = new TrafficSimulator(base({ demand: { N: 10, S: 10, E: 0, W: 0 }, personalities: { impatient: 1 }, initialGroups: { A: 'EW' } }), { seed: 6 });
    runChecked(jam, 60, { auditEvery: 4 });
    expect(jam.stats.horns).toBeGreaterThan(free.stats.horns * 2 + 5);
  });

  it('queues grow when downstream capacity is exhausted', () => {
    const lvl = base({
      demand: { N: 0, S: 20, E: 0, W: 0 },
      downstream: { rate: 0.9, exits: { 'A:N': { rate: 0.001, gateAt: 45 } } },
    });
    const sim = new TrafficSimulator(lvl, { seed: 1 });
    const qAt = [];
    runChecked(sim, 120, {
      auditEvery: 3,
      onStep: (s, i) => {
        if (i % (30 * 60) === 0) qAt.push(s.network.byId.get('A').approachLanes.S.reduce((n, l) => n + l.vehicles.length, 0) + s.spawner.pendingCount());
      },
    });
    expect(qAt.at(-1)).toBeGreaterThan(qAt[1] + 5);
  });

  it('recovers once the blocked exit reopens (no teleporting or deleting)', () => {
    const sim = new TrafficSimulator(jamLevel(), { seed: 4 });
    runChecked(sim, 75, { onStep: (s, i) => i === 45 * 60 && s.requestPhase('A', 'E') });
    const processedDuringJam = sim.stats.processed;
    // blockage ends at t=80; alternate phases so everyone gets a turn
    runChecked(sim, 120, {
      auditEvery: 2,
      onStep: (s, i) => {
        // every road in turn, paired with its opposite: N+S, then E+W
        const t = Math.floor(i / (15 * 60)) % 2;
        if (i % (15 * 60) === 0) s.requestPhase('A', t ? 'E' : 'S');
        if (i % (15 * 60) === 150) s.requestPhase('A', t ? 'W' : 'N');
      },
    });
    expect(sim.stats.processed).toBeGreaterThan(processedDuringJam + 20);
    const stuckInBox = sim.vehicles.filter((v) => v.segment.kind === 'connector' && v.stoppedTime > 30);
    expect(stuckInBox.length).toBe(0);
  });
});

describe('Game systems', () => {
  it('restart produces a fresh, deterministic simulation', () => {
    const lm = new LevelManager();
    const lvl = lm.get('career', 4);
    const a = lm.createSim(lvl, 77);
    const b = lm.createSim(lvl, 77);
    for (let i = 0; i < 1200; i++) {
      a.step(SIM_DT);
      b.step(SIM_DT);
    }
    expect(a.vehicles.length).toBe(b.vehicles.length);
    expect(a.vehicles.map((v) => v.s.toFixed(6))).toEqual(b.vehicles.map((v) => v.s.toFixed(6)));
    const c = lm.createSim(lvl, 77);
    expect(c.stats.processed).toBe(0);
    expect(c.scoring.total()).toBe(400); // only the full safety bonus
  });

  it('objectives and end conditions update from the simulation', () => {
    const lm = new LevelManager();
    const lvl = lm.get('career', 1);
    const sim = lm.createSim(lvl, 5);
    const tracker = lm.createTracker();
    let elapsed = 0;
    let end = null;
    const rng = new Rng(1);
    for (let i = 0; !end && i < 200 * 60; i++) {
      if (i % (12 * 60) === 0) sim.requestPhase('A', rng.chance(0.5) ? 'NS' : 'EW');
      sim.step(SIM_DT);
      elapsed += SIM_DT;
      if (i % 15 === 0) {
        lm.track(tracker, sim, elapsed, 0.25);
        end = lm.checkEnd(lvl, sim, tracker, elapsed);
      }
    }
    expect(end).not.toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(lvl.duration - 0.5);
    const st = lm.objectiveStatus(lvl, sim, tracker, true);
    expect(st[0].type).toBe('processed');
    expect(st[0].pass).toBe(sim.stats.processed >= 30);
    expect(end.success).toBe(st.every((o) => o.pass));
    expect(sim.scoring.total()).toBeGreaterThan(400);
  });

  it('signal requests act immediately with no penalty and never change the signal unsafely', () => {
    const sim = new TrafficSimulator(base({ demand: { N: 5, S: 5, E: 5, W: 5 } }), { seed: 1 });
    sim.requestPhase('A', 'EW'); // old paired id: the first road of that axis
    runChecked(sim, 3);
    expect(sim.lights.manager('A').activeGroup).toBe('E');
    const res = sim.requestPhase('A', 'S');
    expect(res.status).toBe('accepted');
    expect(res.early).toBe(false);
    runChecked(sim, 3);
    expect(sim.lights.manager('A').activeGroup).toBe('S');
    sim.requestPhase('A', 'N'); // the opposite road joins: N + S together, no left turns
    runChecked(sim, 3);
    expect(sim.lights.manager('A').greenGroups()).toEqual(['N', 'S']);
    expect(sim.stats.earlyRequests).toBe(0);
  });
});

describe('Soak: every level stays collision-free', () => {
  const lm = new LevelManager();
  const all = [...CAREER_LEVELS, ...PINOY_LEVELS, ENDLESS_LEVEL, ...lm.endlessMaps().slice(1).map((m) => lm.endlessOn(m)), ...CHALLENGES];
  for (const lvl of all) {
    it(`level ${lvl.id}${lvl.mode === 'endless' && lvl.map ? ` (${lvl.map})` : ''}`, () => {
      const sim = lm.createSim(lvl, 13);
      const rng = new Rng(21);
      let next = 6;
      runChecked(sim, 100, {
        auditEvery: 2,
        onStep: (s) => {
          if (s.time > next) {
            for (const [id, m] of s.lights.managers) s.requestPhase(id, rng.pick(m.groups));
            next = s.time + rng.range(4, 20);
          }
        },
      });
      // Endless maps are big (roads run to the screen edge), so fewer vehicles finish in 100 s.
      expect(sim.stats.processed).toBeGreaterThan(lvl.map === 'metro' ? 1 : lvl.mode === 'endless' ? 5 : 10);
      // nothing permanently wedged in a box
      for (const v of sim.vehicles) if (v.segment.kind === 'connector') expect(v.boxTime).toBeLessThan(90);
    });
  }
});
