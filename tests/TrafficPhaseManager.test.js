import { describe, it, expect } from 'vitest';
import { TrafficPhaseManager, PHASE, FLASH_GROUP } from '../src/simulation/TrafficPhaseManager.js';
import { SIGNAL_TIMING } from '../src/data/config.js';
import { Rng } from '../src/utils/math.js';

const DT = 1 / 60;
const run = (m, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.update(DT);
};

describe('TrafficPhaseManager', () => {
  it('gives every approach its own phase: exactly one road is green, its opposite stays red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N' });
    expect(m.groups).toEqual(['N', 'E', 'S', 'W']);
    expect(m.signalForArm('N')).toBe('green');
    expect(m.signalForArm('S')).toBe('red');
    expect(m.signalForArm('E')).toBe('red');
    expect(m.greenGroups()).toEqual(['N']);
  });

  it('accepts the old paired ids (NS / EW) as the first road of that axis', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'EW' });
    expect(m.activeGroup).toBe('E');
    expect(m.resolve('NS')).toBe('N');
    expect(m.resolve('XY')).toBe(null);
  });

  it('a change takes 2 seconds in all (yellow + all-red)', () => {
    expect(SIGNAL_TIMING.yellow + SIGNAL_TIMING.allRed).toBeCloseTo(2, 6);
  });

  it('green changes to yellow, then all-red, then the next green', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 3, allRed: 2 });
    expect(m.requestPhase('E').status).toBe('accepted');
    expect(m.state).toBe(PHASE.YELLOW);
    expect(m.signalForGroup('N')).toBe('yellow');
    expect(m.signalForGroup('E')).toBe('red');
    run(m, 2.9);
    expect(m.state).toBe(PHASE.YELLOW);
    run(m, 0.2);
    expect(m.state).toBe(PHASE.ALL_RED);
    expect(m.signalForGroup('N')).toBe('red');
    expect(m.signalForGroup('E')).toBe('red');
    run(m, 2.05);
    expect(m.state).toBe(PHASE.GREEN);
    expect(m.signalForGroup('E')).toBe('green');
    const seq = m.history.map((h) => `${h.state}:${h.group}`);
    expect(seq).toEqual(['GREEN:N', 'YELLOW:N', 'ALL_RED:null', 'GREEN:E']);
  });

  it('rejects unknown groups and ignores requests for the active group', () => {
    const m = new TrafficPhaseManager();
    expect(m.requestPhase('XY').status).toBe('rejected');
    expect(m.requestPhase('N').status).toBe('ignored');
    expect(m.state).toBe(PHASE.GREEN);
  });

  it('switches immediately with no minimum green, and spam cannot skip yellow or all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 3, allRed: 2 });
    m.requestPhase('E');
    run(m, 5.1); // now E green with timer ~0
    expect(m.greenGroups()).toEqual(['E']);
    expect(m.requestPhase('S').status).toBe('accepted'); // no minimum green
    expect(m.state).toBe(PHASE.YELLOW);
    let t = 0;
    let greenAt = null;
    while (t < 10) {
      for (let k = 0; k < 5; k++) m.requestPhase('S'); // spam
      m.update(DT);
      t += DT;
      if (greenAt === null && m.signalForGroup('S') === 'green') greenAt = t;
      expect(m.greenGroups().length).toBeLessThanOrEqual(1);
    }
    expect(greenAt).toBeGreaterThanOrEqual(5 - 0.05); // yellow (3) + all-red (2)
    expect(greenAt).toBeLessThanOrEqual(5 + 0.05);
    expect(m.earlyRequests).toBe(0);
  });

  it('shows one continuous countdown across yellow and all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 1.2, allRed: 0.8 });
    m.requestPhase('W');
    let last = Infinity;
    while (m.state !== PHASE.GREEN) {
      const c = m.describe().countdown;
      expect(c).toBeLessThanOrEqual(last + 1e-9);
      last = c;
      m.update(DT);
    }
    expect(m.activeGroup).toBe('W');
  });

  it('a change can be cancelled during yellow or redirected during all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 3, allRed: 2 });
    m.requestPhase('E');
    run(m, 1);
    expect(m.requestPhase('N').reason).toBe('Change cancelled');
    expect(m.greenGroups()).toEqual(['N']);
    m.requestPhase('E');
    run(m, 3.05);
    expect(m.state).toBe(PHASE.ALL_RED);
    m.requestPhase('S'); // redirect
    run(m, 2.05);
    expect(m.greenGroups()).toEqual(['S']);
  });

  it('all-red is a fixed interval and never waits on the box', () => {
    const m = new TrafficPhaseManager({ allRed: 2, yellow: 3 });
    m.requestPhase('E');
    run(m, 3.05);
    expect(m.state).toBe(PHASE.ALL_RED);
    run(m, 2.05);
    expect(m.state).toBe(PHASE.GREEN);
  });

  it('flashing yellow: entered through yellow and all-red, every arm reads flash, left through all-red', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 1.2, allRed: 0.8 });
    expect(m.requestFlash().status).toBe('accepted');
    expect(m.state).toBe(PHASE.YELLOW);
    expect(m.nextGroup).toBe(FLASH_GROUP);
    run(m, 2.05);
    expect(m.state).toBe(PHASE.FLASH);
    expect(m.flashing).toBe(true);
    for (const arm of ['N', 'E', 'S', 'W']) expect(m.signalForArm(arm)).toBe('flash');
    expect(m.greenGroups()).toEqual([]);
    expect(m.requestFlash().status).toBe('ignored');
    expect(m.requestPhase('E').status).toBe('accepted');
    expect(m.state).toBe(PHASE.ALL_RED);
    run(m, 0.85);
    expect(m.greenGroups()).toEqual(['E']);
  });

  it('pairs opposite roads: the left turn clears first, then both run straight and right only', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'N', yellow: 1.2, allRed: 0.8 });
    expect(m.requestPhase('S').reason).toBe('Pairing');
    expect(m.signalForArm('N', 'straight')).toBe('green');
    expect(m.signalForArm('N', 'left')).toBe('yellow');
    expect(m.signalForArm('S', 'straight')).toBe('red');
    run(m, 1.3);
    expect(m.signalForArm('N', 'left')).toBe('red');
    expect(m.signalForArm('S', 'straight')).toBe('red');
    run(m, 0.8);
    expect(m.greenGroups()).toEqual(['N', 'S']);
    for (const arm of ['N', 'S']) {
      expect(m.signalForArm(arm, 'straight')).toBe('green');
      expect(m.signalForArm(arm, 'right')).toBe('green');
      expect(m.signalForArm(arm, 'left')).toBe('red');
    }
    expect(m.conflicting()).toBe(false);
    // A cross road: both go yellow, then all-red, then West alone.
    m.requestPhase('W');
    expect(m.signalForArm('N')).toBe('yellow');
    expect(m.signalForArm('S')).toBe('yellow');
    run(m, 2.05);
    expect(m.greenGroups()).toEqual(['W']);
    expect(m.signalForArm('W', 'left')).toBe('green');
  });

  it('picking one road of a pair drops the other through yellow and gives the left turn back', () => {
    const m = new TrafficPhaseManager({ initialGroup: 'E', yellow: 1.2, allRed: 0.8 });
    m.requestPhase('W');
    run(m, 2.1);
    expect(m.greenGroups()).toEqual(['E', 'W']);
    m.requestPhase('W'); // keep West only
    expect(m.signalForArm('E')).toBe('yellow');
    expect(m.signalForArm('W')).toBe('green');
    expect(m.signalForArm('W', 'left')).toBe('red');
    run(m, 1.3);
    expect(m.signalForArm('E')).toBe('red');
    run(m, 0.8);
    expect(m.paired).toBe(false);
    expect(m.greenGroups()).toEqual(['W']);
    expect(m.signalForArm('W', 'left')).toBe('green');
  });

  it('never shows conflicting greens under random request sequences', () => {
    const rng = new Rng(9);
    const m = new TrafficPhaseManager();
    let lastGreen = 'N';
    let sawYellow = false;
    let sawAllRed = false;
    let sawPair = false;
    for (let i = 0; i < 60 * 60 * 10; i++) {
      if (rng.chance(0.02)) {
        const g = rng.pick(['N', 'E', 'S', 'W', 'XX', 'flash', 'opp', 'opp']);
        if (g === 'flash') m.requestFlash();
        else if (g === 'opp' && m.oppositeOf(m.activeGroup)) m.requestPhase(m.oppositeOf(m.activeGroup));
        else m.requestPhase(g);
      }
      m.update(DT);
      const greens = m.greenGroups();
      expect(m.conflicting()).toBe(false);
      expect(greens.length).toBeLessThanOrEqual(2);
      if (greens.length === 2) {
        // only ever the two opposite roads, with their left turns on red
        expect(m.oppositeOf(greens[0])).toBe(greens[1]);
        for (const g of greens) expect(m.signalForArm(g, 'left')).toBe('red');
      }
      if (m.state === PHASE.YELLOW) sawYellow = true;
      if (m.state === PHASE.ALL_RED) sawAllRed = true;
      if (m.paired) sawPair = true;
      if (greens.length === 1 && greens[0] !== lastGreen && !m.paired) {
        // Every change of green must have passed through all-red (and yellow, unless it came from
        // flash), or be the road kept when a pair was dropped (the other one went yellow and red).
        expect(sawAllRed || sawPair).toBe(true);
        sawPair = false;
        lastGreen = greens[0];
        sawYellow = false;
        sawAllRed = false;
      }
    }
    expect(sawYellow || m.switches > 0).toBe(true);
    expect(m.switches).toBeGreaterThan(10);
  });
});
