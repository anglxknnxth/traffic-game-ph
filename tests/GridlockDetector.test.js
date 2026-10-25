import { describe, it, expect } from 'vitest';
import { GridlockDetector, CONGESTION } from '../src/simulation/GridlockDetector.js';

const approach = (arm, signal, queue, stuckFor = 0, blocked = false, exitLanes = 0) => ({
  arm,
  signal,
  queue,
  headStoppedTime: stuckFor,
  headBlocked: blocked,
  exitLanes,
});

function feed(det, seconds, snap) {
  let r;
  const events = [];
  for (let t = 0; t < seconds; t += 0.25) {
    r = det.update(0.25, snap);
    events.push(...r.events);
  }
  return { ...r, events };
}

describe('GridlockDetector', () => {
  it('never treats long queues at a red light as gridlock', () => {
    const det = new GridlockDetector();
    const snap = {
      approaches: [approach('N', 'red', 18), approach('S', 'red', 16), approach('E', 'green', 2), approach('W', 'green', 1)],
      boxStopped: 0,
      exitsBlocked: 0,
      capacity: 80,
    };
    const r = feed(det, 120, snap);
    expect([CONGESTION.NORMAL, CONGESTION.HEAVY]).toContain(r.level);
    expect(det.gridlockTime).toBe(0);
    expect(det.partialTime).toBe(0);
  });

  it('flags a partial blockage when a lane waits at green for exit space', () => {
    const det = new GridlockDetector();
    const snap = {
      approaches: [approach('N', 'green', 4, 2, false, 1), approach('S', 'green', 3), approach('E', 'red', 3), approach('W', 'red', 2)],
      boxStopped: 0,
      exitsBlocked: 1,
      capacity: 80,
    };
    const r = feed(det, 4, snap);
    expect(r.level).toBe(CONGESTION.PARTIAL);
    expect(r.events.some((e) => e.key === 'INTERSECTION_BLOCKED')).toBe(true);
  });

  it('detects gridlock: green approaches stuck behind vehicles blocking the box', () => {
    const det = new GridlockDetector();
    const snap = {
      approaches: [approach('N', 'red', 10), approach('S', 'red', 9), approach('E', 'green', 8, 12, true), approach('W', 'green', 7, 12, true)],
      boxStopped: 2,
      exitsBlocked: 0,
      capacity: 80,
    };
    let r = feed(det, 3, snap);
    expect(r.level).not.toBe(CONGESTION.GRIDLOCK); // must be sustained first
    r = feed(det, 4, snap);
    expect(r.level).toBe(CONGESTION.GRIDLOCK);
    expect(det.gridlockTime).toBeGreaterThan(0);
    expect(det.congestion).toBeGreaterThan(0.3);
  });

  it('reports recovery and then restored flow once the blockage clears', () => {
    const det = new GridlockDetector({ restoreDelay: 6 });
    const jam = {
      approaches: [approach('N', 'red', 10), approach('S', 'red', 9), approach('E', 'green', 8, 12, true), approach('W', 'green', 7, 12, true)],
      boxStopped: 2,
      exitsBlocked: 0,
      capacity: 80,
    };
    feed(det, 10, jam);
    expect(det.level).toBe(CONGESTION.GRIDLOCK);
    const clear = {
      approaches: [approach('N', 'red', 3), approach('S', 'red', 2), approach('E', 'green', 1), approach('W', 'green', 1)],
      boxStopped: 0,
      exitsBlocked: 0,
      capacity: 80,
    };
    let r = feed(det, 2, clear);
    expect(r.level).toBe(CONGESTION.RECOVERY);
    expect(r.events.some((e) => e.key === 'RECOVERY')).toBe(true);
    r = feed(det, 6, clear);
    expect(r.level).toBe(CONGESTION.NORMAL);
    expect(r.events.some((e) => e.key === 'RESTORED')).toBe(true);
    expect(r.events.some((e) => e.key === 'RECOVERED' && e.from === CONGESTION.GRIDLOCK)).toBe(true);
    expect(det.recoveries).toBe(1);
  });

  it('congestion grows with queue length', () => {
    const det = new GridlockDetector();
    const mk = (q) => ({ approaches: [approach('N', 'red', q), approach('S', 'red', q), approach('E', 'green', 0), approach('W', 'green', 0)], boxStopped: 0, exitsBlocked: 0, capacity: 80 });
    det.update(0.25, mk(2));
    const low = det.congestion;
    det.update(0.25, mk(20));
    expect(det.congestion).toBeGreaterThan(low);
  });
});
