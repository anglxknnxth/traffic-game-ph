import { describe, it, expect } from 'vitest';
import { TrafficPhaseManager, PHASE } from '../src/simulation/TrafficPhaseManager.js';
import { Rng } from '../src/utils/math.js';

const DT = 1 / 60;
const run = (m, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.update(DT);
};

describe('TrafficPhaseManager', () => {
  it('starts with exactly one green group', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'NS' });
    expect(m.signalForArm('N')).toBe('green');
    expect(m.signalForArm('S')).toBe('green');
    expect(m.signalForArm('E')).toBe('red');
    expect(m.greenGroups()).toEqual(['NS']);
  });

  it('green changes to yellow, then all-red, then the next green', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'NS', yellow: 3, allRed: 2 });
    expect(m.requestPhase('EW').status).toBe('accepted');
    expect(m.state).toBe(PHASE.YELLOW);
    expect(m.signalForGroup('NS')).toBe('yellow');
    expect(m.signalForGroup('EW')).toBe('red');
    run(m, 2.9);
    expect(m.state).toBe(PHASE.YELLOW);
    run(m, 0.2);
    expect(m.state).toBe(PHASE.ALL_RED);
    expect(m.signalForGroup('NS')).toBe('red');
    expect(m.signalForGroup('EW')).toBe('red');
    run(m, 2.05);
    expect(m.state).toBe(PHASE.GREEN);
    expect(m.signalForGroup('EW')).toBe('green');
    const seq = m.history.map((h) => `${h.state}:${h.group}`);
    expect(seq).toEqual(['GREEN:NS', 'YELLOW:NS', 'ALL_RED:null', 'GREEN:EW']);
  });

  it('rejects unknown groups and ignores requests for the active group', () => {
    const m = new TrafficPhaseManager();
    expect(m.requestPhase('XY').status).toBe('rejected');
    expect(m.requestPhase('NS').status).toBe('ignored');
    expect(m.state).toBe(PHASE.GREEN);
  });

  it('switches immediately with no minimum green, and spam cannot skip yellow or all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'NS', yellow: 3, allRed: 2 });
    m.requestPhase('EW');
    run(m, 5.1); // now EW green with timer ~0
    expect(m.greenGroups()).toEqual(['EW']);
    expect(m.requestPhase('NS').status).toBe('accepted'); // no minimum green
    expect(m.state).toBe(PHASE.YELLOW);
    let t = 0;
    let nsGreenAt = null;
    while (t < 10) {
      for (let k = 0; k < 5; k++) m.requestPhase('NS'); // spam
      m.update(DT);
      t += DT;
      if (nsGreenAt === null && m.signalForGroup('NS') === 'green') nsGreenAt = t;
      expect(m.greenGroups().length).toBeLessThanOrEqual(1);
    }
    expect(nsGreenAt).toBeGreaterThanOrEqual(5 - 0.05); // yellow (3) + all-red (2)
    expect(nsGreenAt).toBeLessThanOrEqual(5 + 0.05);
    expect(m.earlyRequests).toBe(0);
  });

  it('shows one continuous countdown across yellow and all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'NS', yellow: 1.5, allRed: 1 });
    m.requestPhase('EW');
    let last = Infinity;
    while (m.state !== PHASE.GREEN) {
      const c = m.describe().countdown;
      expect(c).toBeLessThanOrEqual(last + 1e-9);
      last = c;
      m.update(DT);
    }
    expect(m.activeGroup).toBe('EW');
  });

  it('a change can be cancelled during yellow or redirected during all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'NS', yellow: 3, allRed: 2 });
    m.requestPhase('EW');
    run(m, 1);
    expect(m.requestPhase('NS').reason).toBe('Change cancelled');
    expect(m.greenGroups()).toEqual(['NS']);
    m.requestPhase('EW');
    run(m, 3.05);
    expect(m.state).toBe(PHASE.ALL_RED);
    m.requestPhase('NS'); // redirect back
    run(m, 2.05);
    expect(m.greenGroups()).toEqual(['NS']);
  });

  it('all-red is a fixed interval and never waits on the box', () => {
    const m = new TrafficPhaseManager({ allRed: 2, yellow: 3 });
    m.requestPhase('EW');
    run(m, 3.05);
    expect(m.state).toBe(PHASE.ALL_RED);
    run(m, 2.05);
    expect(m.state).toBe(PHASE.GREEN);
  });

  it('never shows conflicting greens under random request sequences', () => {
    const rng = new Rng(9);
    const m = new TrafficPhaseManager();
    let lastGreen = 'NS';
    let sawYellow = false;
    let sawAllRed = false;
    for (let i = 0; i < 60 * 60 * 10; i++) {
      if (rng.chance(0.02)) m.requestPhase(rng.pick(['NS', 'EW', 'XX']));
      m.update(DT);
      const greens = m.greenGroups();
      expect(greens.length).toBeLessThanOrEqual(1);
      if (m.state === PHASE.YELLOW) sawYellow = true;
      if (m.state === PHASE.ALL_RED) sawAllRed = true;
      if (greens.length === 1 && greens[0] !== lastGreen) {
        // Every change of green group must have passed through yellow and all-red.
        expect(sawYellow && sawAllRed).toBe(true);
        lastGreen = greens[0];
        sawYellow = false;
        sawAllRed = false;
      }
    }
    expect(m.switches).toBeGreaterThan(10);
  });
});
