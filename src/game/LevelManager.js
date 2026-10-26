// Level catalogue, simulation construction and objective / end-condition evaluation.

import { CAREER_LEVELS, PINOY_LEVELS, ENDLESS_LEVEL, CHALLENGES, DEMO_LEVEL, CHILL, GROWING_LEVEL, SPECIAL_TRAFFIC, makeLevel } from '../data/levels.js';
import { MAPS } from '../data/maps/index.js';
import { TrafficSimulator } from '../simulation/TrafficSimulator.js';
import { CONGESTION } from '../simulation/GridlockDetector.js';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's local date as YYYY-MM-DD. */
export function todayString() {
  return ymd(new Date());
}

/** The Saturday on or after `date` (YYYY-MM-DD). */
function nextSaturday(date) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return ymd(d);
}

export class LevelManager {
  constructor() {
    this.career = CAREER_LEVELS;
    this.pinoy = PINOY_LEVELS;
    this.challenges = CHALLENGES;
    this.endless = ENDLESS_LEVEL;
    this.demo = DEMO_LEVEL;
    this._endlessByMap = new Map();
    this._chillByMap = new Map();
  }

  get(mode, id) {
    if (mode === 'career' || mode === 'tutorial') return this.career.find((l) => l.id === Number(id)) || this.career[0];
    if (mode === 'pinoy') return this.pinoy.find((l) => l.id === id) || this.pinoy[0];
    if (mode === 'challenge') return this.challenges.find((l) => l.id === id) || this.challenges[0];
    if (mode === 'endless') return this.endlessOn(id);
    if (mode === 'chill') return this.chillOn(id);
    if (mode === 'growing') return GROWING_LEVEL;
    if (mode === 'daily') return this.daily(id);
    return this.demo;
  }

  /**
   * Daily Challenge: the same run for everyone on a given date (YYYY-MM-DD). The date picks the map,
   * the time of day, a themed calendar day and two boss events; the seed is the date itself.
   * Six minutes, scored like Endless.
   */
  daily(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) date = todayString();
    let h = 2166136261;
    for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    // (>>> 0: with salt 0 the xor can come out negative, and a negative index picks nothing)
    const pick = (arr, salt) => arr[(((h >>> salt) ^ (h >>> 3)) >>> 0) % arr.length];
    const maps = this.endlessMaps();
    const map = pick(maps, 0);
    const y = date.slice(0, 4);
    const themes = [
      { label: 'Ordinaryong araw', day: date },
      { label: 'Sweldo Friday', day: `${y}-${date.slice(5, 7)}-15` },
      { label: 'Undas exodus', day: `${y}-10-31` },
      { label: 'Simbang Gabi', day: `${y}-12-18` },
      { label: 'Weekend sa mall', day: nextSaturday(date) },
      { label: 'Christmas rush', day: `${y}-12-08` },
    ];
    const theme = pick(themes, 7);
    const hour = pick([6.6, 7.2, 11.5, 16.4, 17.1, 18.6], 13);
    const bosses = pick([['chase', 'vip'], ['vip', 'chase'], ['chase', 'chase'], ['vip', 'vip']], 17);
    const base = this.endlessOn(map);
    return {
      ...base,
      id: 'daily',
      mode: 'daily',
      date,
      name: `Daily · ${date} · ${MAPS[map]?.name || map}`,
      subtitle: `${theme.label} · ${bosses.map((b) => (b === 'chase' ? 'Habulan' : 'VIP')).join(' + ')}`,
      description: 'Same map, same traffic and same events for everyone today. Six minutes: get the best score you can.',
      seed: Number(date.replace(/-/g, '')),
      duration: 360,
      calendar: { start: theme.day },
      env: { ...base.env, hour, rate: 0.9 },
      bossScript: [
        { t: 70, kind: bosses[0] },
        { t: 220, kind: bosses[1] },
      ],
      objectives: [],
    };
  }

  /** Maps Endless can be played on: the default kanto, every Pinoy Roads map and the special maps. */
  endlessMaps() {
    return ['single', ...this.pinoy.map((l) => l.map), 'serbisyo', 'metro'].filter((m, i, a) => MAPS[m] && a.indexOf(m) === i);
  }

  /** Chill endless (no game over, AUTO lights) on a map. Metro Manila starts with every light on AUTO. */
  chillOn(mapId) {
    const id = MAPS[mapId] ? mapId : 'single';
    let lvl = this._chillByMap.get(id);
    if (!lvl) {
      const base = this.endlessOn(id);
      lvl = { ...base, ...CHILL, id: 'chill', map: id === 'single' ? base.map : id, name: `Chill · ${MAPS[id].name}`, autoLights: id === 'metro' };
      this._chillByMap.set(id, lvl);
    }
    return lvl;
  }

  /** Endless on a given map (the default map when id is missing or unknown). */
  endlessOn(mapId) {
    if (!mapId || !MAPS[mapId] || mapId === 'single' || mapId === 'endless') return this.endless;
    let lvl = this._endlessByMap.get(mapId);
    if (!lvl) {
      const { layout, ...rest } = this.endless;
      // Traffic pattern from that map's Pinoy Roads level, starting lighter and then ramping up.
      const src = this.pinoy.find((l) => l.map === mapId) || SPECIAL_TRAFFIC[mapId];
      const demand = Object.fromEntries(Object.entries(src?.demand || rest.demand).map(([a, d]) => [a, Math.round(d * 0.7 * 10) / 10]));
      lvl = makeLevel({
        ...rest,
        map: mapId,
        demand,
        mix: src?.mix || rest.mix,
        turns: src?.turns || rest.turns,
        rush: src?.rush || rest.rush,
        school: src?.school || false,
        discipline: src?.discipline,
        initialGroups: src?.initialGroups || rest.initialGroups,
        name: `Endless Rush · ${MAPS[mapId].name}`,
        downstream: { ...rest.downstream, exits: {} },
      });
      this._endlessByMap.set(mapId, lvl);
    }
    return lvl;
  }

  /**
   * The level with the player's world options applied: no rain (clear skies only), and/or no
   * people (no pedestrians, and no pedestrian objectives).
   */
  withOptions(level, { rain = true, people = true } = {}) {
    if (rain && people) return level;
    const out = { ...level };
    if (!rain && level.env) out.env = { ...level.env, weather: [], random: false, start: 'clear' };
    if (!people) {
      out.pedestrians = null;
      out.objectives = (level.objectives || []).filter((o) => o.type !== 'pedCrossed' && o.type !== 'pedWait');
    }
    return out;
  }

  /** Build a simulation for a level, including scenario warm-up (real simulated traffic). */
  createSim(level, seed = (Math.random() * 1e9) >>> 0) {
    // The endless modes run on today's date, so a Friday is a Friday and December is Christmas.
    if (level.surges && !level.calendar) level = { ...level, calendar: { start: todayString() } };
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
        case 'pedCrossed': {
          const n = sim.peds.stats.crossed;
          out.push({ type: o.type, label: `Pedestrians across ≥ ${o.target}`, value: `${n}`, pass: n >= o.target, progress: Math.min(1, n / o.target) });
          break;
        }
        case 'pedWait': {
          const st = sim.peds.stats;
          const w = st.crossed ? st.totalWait / st.crossed : 0;
          out.push({ type: o.type, label: `Pedestrian wait ≤ ${o.target}s`, value: `${w.toFixed(1)}s`, pass: w <= o.target, progress: w <= o.target ? 1 : o.target / w });
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
    const endless = level.mode === 'endless' || level.mode === 'daily';
    if (fail && tracker.congestionRun >= fail.time) {
      return { success: endless, reason: endless ? 'Traffic collapsed — run over' : `Congestion stayed above ${Math.round(fail.congestion * 100)}% for ${fail.time}s` };
    }
    if (sim.approval?.failed) return { success: endless, reason: 'Galit na ang buong lungsod — sinibak ka sa puwesto 🔥' };
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
