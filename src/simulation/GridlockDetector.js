// Congestion classification from simulation snapshots (pure logic, no simulation access).
//
// Snapshot shape:
// {
//   approaches: [{ arm, signal, queue, headStoppedTime, headBlocked, headReason }],
//   boxStopped,      // vehicles stuck inside the box (smoothed speed ~0 for > 3 s)
//   exitsBlocked,    // lanes whose head has waited at green for exit space
//   capacity,        // queue capacity reference (vehicles)
//   pending,         // vehicles waiting off-map to spawn
// }
// An approach only counts as "blocked" when its signal is GREEN and its head vehicle still cannot
// move. Vehicles waiting at a red light are never treated as gridlock.

import { clamp } from '../utils/math.js';
import { NOTIFY_TEXT } from '../data/config.js';

export const CONGESTION = Object.freeze({
  NORMAL: 'NORMAL',
  HEAVY: 'HEAVY',
  PARTIAL: 'PARTIAL_BLOCK',
  GRIDLOCK: 'GRIDLOCK',
  RECOVERY: 'RECOVERY',
});

const RANK = { NORMAL: 0, HEAVY: 1, RECOVERY: 1.5, PARTIAL_BLOCK: 2, GRIDLOCK: 3 };
export const rankOf = (level) => RANK[level] ?? 0;

export class GridlockDetector {
  constructor({ partialDelay = 2, gridlockDelay = 5, restoreDelay = 6, heavyThreshold = 0.45 } = {}) {
    this.partialDelay = partialDelay;
    this.gridlockDelay = gridlockDelay;
    this.restoreDelay = restoreDelay;
    this.heavyThreshold = heavyThreshold;
    this.reset();
  }

  reset() {
    this.level = CONGESTION.NORMAL;
    this.partialTimer = 0;
    this.gridlockTimer = 0;
    this.restoreTimer = 0;
    this.peakSinceNormal = CONGESTION.NORMAL;
    this.gridlockTime = 0;
    this.partialTime = 0;
    this.congestion = 0;
    this.blockedApproaches = 0;
    this.score = 0;
    this.recoveries = 0;
  }

  static analyze(snap) {
    let blocked = 0;
    let queue = snap.pending || 0;
    for (const a of snap.approaches) {
      queue += a.queue;
      if (a.signal === 'green' && a.queue > 0 && a.headStoppedTime >= 4 && a.headBlocked) blocked++;
    }
    const boxStopped = snap.boxStopped || 0;
    const exitsBlocked = snap.exitsBlocked || 0; // lanes whose head waits at green for exit space
    const score = blocked + Math.min(boxStopped, 3) * 0.7 + Math.min(exitsBlocked, 4) * 0.4;
    const capacity = Math.max(1, snap.capacity || 1);
    const congestion = clamp(0.65 * (queue / capacity) + 0.35 * Math.min(1, score / 3), 0, 1);
    return { blocked, boxStopped, exitsBlocked, score, congestion, queue };
  }

  rawLevel(a) {
    if (a.blocked >= 2 || (a.blocked >= 1 && a.boxStopped >= 1) || (a.boxStopped >= 2 && a.exitsBlocked >= 1)) return CONGESTION.GRIDLOCK;
    if (a.blocked >= 1 || a.boxStopped >= 1 || a.exitsBlocked >= 1) return CONGESTION.PARTIAL;
    if (a.congestion >= this.heavyThreshold) return CONGESTION.HEAVY;
    return CONGESTION.NORMAL;
  }

  /** Returns { level, changed, events, analysis }. events are { key, text } notifications. */
  update(dt, snap) {
    const a = GridlockDetector.analyze(snap);
    const raw = this.rawLevel(a);
    this.congestion = a.congestion;
    this.blockedApproaches = a.blocked;
    this.score = a.score;

    this.gridlockTimer = raw === CONGESTION.GRIDLOCK ? this.gridlockTimer + dt : 0;
    this.partialTimer = rankOf(raw) >= 2 ? this.partialTimer + dt : 0;

    let sustained = raw === CONGESTION.HEAVY ? CONGESTION.HEAVY : CONGESTION.NORMAL;
    if (this.partialTimer >= this.partialDelay) sustained = CONGESTION.PARTIAL;
    if (this.gridlockTimer >= this.gridlockDelay) sustained = CONGESTION.GRIDLOCK;
    // Gridlock is sticky until the blockage has substantially eased.
    if (this.level === CONGESTION.GRIDLOCK && (a.blocked >= 1 || a.boxStopped >= 1) && rankOf(raw) >= 2) sustained = CONGESTION.GRIDLOCK;

    const events = [];
    let next = sustained;
    const wasBlocked = rankOf(this.level) >= 1.5;
    if (wasBlocked && rankOf(sustained) <= 1) {
      this.restoreTimer += dt;
      if (this.restoreTimer >= this.restoreDelay) {
        next = sustained;
        events.push({ key: 'RESTORED', text: NOTIFY_TEXT.RESTORED });
        if (this.peakSinceNormal === CONGESTION.GRIDLOCK || this.peakSinceNormal === CONGESTION.PARTIAL) {
          this.recoveries++;
          events.push({ key: 'RECOVERED', text: null, from: this.peakSinceNormal });
        }
        this.peakSinceNormal = CONGESTION.NORMAL;
        this.restoreTimer = 0;
      } else {
        next = CONGESTION.RECOVERY;
      }
    } else {
      this.restoreTimer = 0;
    }

    const changed = next !== this.level;
    if (changed) {
      if (next === CONGESTION.HEAVY && this.level === CONGESTION.NORMAL) events.push({ key: 'HEAVY_TRAFFIC', text: NOTIFY_TEXT.HEAVY_TRAFFIC });
      if (next === CONGESTION.PARTIAL && rankOf(this.level) < 2) events.push({ key: 'INTERSECTION_BLOCKED', text: NOTIFY_TEXT.INTERSECTION_BLOCKED });
      if (next === CONGESTION.GRIDLOCK) events.push({ key: 'GRIDLOCK', text: NOTIFY_TEXT.GRIDLOCK });
      if (next === CONGESTION.RECOVERY) events.push({ key: 'RECOVERY', text: NOTIFY_TEXT.RECOVERY });
      this.level = next;
    }
    if (rankOf(next) > rankOf(this.peakSinceNormal) && next !== CONGESTION.RECOVERY) this.peakSinceNormal = next;

    if (this.level === CONGESTION.GRIDLOCK) this.gridlockTime += dt;
    if (this.level === CONGESTION.PARTIAL) this.partialTime += dt;
    return { level: this.level, changed, events, analysis: a };
  }
}
