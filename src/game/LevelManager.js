// Level catalogue, simulation construction and objective / end-condition evaluation.

import { CAREER_LEVELS, ENDLESS_LEVEL, CHALLENGES, DEMO_LEVEL } from '../data/levels.js';
import { TrafficSimulator } from '../simulation/TrafficSimulator.js';
import { CONGESTION } from '../simulation/GridlockDetector.js';

export class LevelManager {
  constructor() {
    this.career = CAREER_LEVELS;
    this.challenges = CHALLENGES;
    this.endless = ENDLESS_LEVEL;
    this.demo = DEMO_LEVEL;
  }

  get(mode, id) {
    if (mode === 'career' || mode === 'tutorial') return this.career.find((l) => l.id === Number(id)) || this.career[0];
    if (mode === 'challenge') return this.challenges.find((l) => l.id === id) || this.challenges[0];
    if (mode === 'endless') return this.endless;
    return this.demo;
  }

  /** Build a simulation for a level, including scenario warm-up (real simulated traffic). */
  createSim(level, seed = (Math.random() * 1e9) >>> 0) {
    const sim = new TrafficSimulator(level, { seed });
    if (level.warmup) sim.runWarmup(level.warmup);
    else if (level.prewarm) sim.runWarmup({ seconds: level.prewarm, requests: [] }, { shiftSchedule: true });
    return sim;
  }

  /** Per-session tracker for objectives that depend on history. */
  createTracker() {
    return { congestionRun: 0, clearRun: 0, cleared: false, maxRollingWait: 0, startedBlocked: null };
  }

  /** Update trackers; call every metric interval with the elapsed session time. */
  track(tracker, sim, elapsed, dt) {
    const m = sim.metrics;
    const fail = sim.level.fail;
    if (fail && m.congestion >= fail.congestion) tracker.congestionRun += dt;
    else tracker.congestionRun = 0;
    if (tracker.startedBlocked === null) tracker.startedBlocked = m.level !== CONGESTION.NORMAL && m.level !== CONGESTION.HEAVY;
    const clear = (m.level === CONGESTION.NORMAL || m.level === CONGESTION.HEAVY) && m.boxStopped === 0;
    tracker.clearRun = clear ? tracker.clearRun + dt : 0;
    if (elapsed > 30) tracker.maxRollingWait = Math.max(tracker.maxRollingWait, m.avgWait);
  }

  objectiveStatus(level, sim, tracker, final = false) {
    const m = sim.metrics;
    const em = sim.emergencySummary();
    const out = [];
    for (const o of level.objectives || []) {
      switch (o.type) {
        case 'processed':
          out.push({ type: o.type, label: `Vehicles through ≥ ${o.target}`, value: `${sim.stats.processed}`, pass: sim.stats.processed >= o.target, progress: Math.min(1, sim.stats.processed / o.target) });
          break;
        case 'avgWait': {
          const w = m.overallWait;
          out.push({ type: o.type, label: `Average wait ≤ ${o.target}s`, value: `${w.toFixed(1)}s`, pass: w <= o.target, progress: w <= o.target ? 1 : o.target / w });
          break;
        }
        case 'rollingWait': {
          const w = tracker.maxRollingWait;
          out.push({ type: o.type, label: `Rolling wait stays ≤ ${o.target}s`, value: `peak ${tracker.maxRollingWait.toFixed(1)}s`, pass: w <= o.target, progress: w <= o.target ? 1 : o.target / w });
          break;
        }
        case 'maxGridlockTime': {
          const g = m.gridlockTime;
          out.push({ type: o.type, label: `Gridlock time ≤ ${o.target}s`, value: `${g.toFixed(0)}s`, pass: g <= o.target, progress: g <= o.target ? 1 : 0 });
          break;
        }
        case 'emergency': {
          // Emergencies that arrived in the final 45 s are not held against the player.
          const due = sim.stats.emergencyArrivalTimes.filter((t) => sim.scheduleTime - t > 45).length;
          const ok = em.worst <= o.target && (!final || em.cleared >= due);
          out.push({ type: o.type, label: `Emergency delay ≤ ${o.target}s`, value: `${em.cleared}/${em.arrivals} · worst ${em.worst.toFixed(0)}s`, pass: ok, progress: em.arrivals ? em.cleared / em.arrivals : 1 });
          break;
        }
        case 'clearGridlock': {
          if (tracker.clearRun >= o.target) tracker.cleared = true;
          out.push({ type: o.type, label: `Clear the box for ${o.target}s`, value: tracker.cleared ? 'cleared' : `${tracker.clearRun.toFixed(0)}s`, pass: tracker.cleared, progress: tracker.cleared ? 1 : tracker.clearRun / o.target });
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  /** Returns null while running, otherwise { success, reason }. */
  checkEnd(level, sim, tracker, elapsed) {
    const fail = level.fail;
    if (fail && tracker.congestionRun >= fail.time) {
      return { success: level.mode === 'endless', reason: level.mode === 'endless' ? 'Traffic collapsed — run over' : `Congestion stayed above ${Math.round(fail.congestion * 100)}% for ${fail.time}s` };
    }
    if (level.endOnSuccess) {
      const st = this.objectiveStatus(level, sim, tracker);
      if (st.length && st.every((o) => o.pass)) return { success: true, reason: 'Objectives complete' };
    }
    if (level.duration && elapsed >= level.duration) {
      const st = this.objectiveStatus(level, sim, tracker, true);
      const ok = st.every((o) => o.pass);
      return { success: ok, reason: ok ? 'Time up — objectives met' : 'Time up — objectives not met' };
    }
    return null;
  }

  stars(level, score, success) {
    if (!success) return 0;
    const [two, three] = level.stars || [Infinity, Infinity];
    if (score >= three) return 3;
    if (score >= two) return 2;
    return 1;
  }
}
