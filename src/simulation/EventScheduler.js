// Random scenarios for the endless modes: stalled vehicles and roadworks on random exits, a school
// letting out (a rush of people at the crosswalks) and waves of jeepneys stopping at the corners.
// Emergencies and weather have their own random schedules (level.emergency.interval, env.random).
// Uses its own random stream, so levels without random events are unchanged.

import { Rng } from '../utils/math.js';

const LABELS = ['STALLED TRUCK', 'STALLED JEEP', 'ROAD WORKS', 'FLAT TYRE', 'STALLED BUS', 'MINOR ACCIDENT'];

export class EventScheduler {
  constructor(sim, cfg = {}) {
    this.sim = sim;
    this.rng = new Rng(((sim.seed ?? 1) ^ 0x2c1b3c6d) >>> 0);
    this.every = cfg.every || [35, 70];
    this.next = this.rng.range(25, 45);
    this.active = [];
    this.log = [];
  }

  update(dt) {
    const sim = this.sim;
    const t = sim.scheduleTime;
    for (const e of this.active) if (t >= e.end && !e.ended) this._end(e);
    this.active = this.active.filter((e) => !e.ended);
    if (t < this.next) return;
    this.next = t + this.rng.range(...this.every);
    const kinds = ['blockage', 'blockage', 'school', 'jeepwave'];
    const kind = this.rng.pick(kinds);
    if (kind === 'blockage') this._blockage(t);
    else if (kind === 'school') this._school(t);
    else this._jeepWave(t);
  }

  _blockage(t) {
    const sim = this.sim;
    // A stretch of an exit road that is free right now, away from the box.
    const keys = [...new Set(sim.network.exitLanes.map((l) => l.exitKey))];
    if (!keys.length) return;
    const key = this.rng.pick(keys);
    const lanes = sim.network.exitLanesByKey(key).filter((l) => l.type === 'general');
    if (lanes.length < 2) return; // never close a whole road
    if (sim.blockages.some((b) => b.active && b.exit === key)) return;
    const k = this.rng.int(0, lanes.length - 1);
    const lane = lanes[k];
    const s = Math.min(lane.length - 30, this.rng.range(20, 34));
    const dur = this.rng.range(25, 45);
    const label = this.rng.pick(LABELS);
    const b = { exit: key, lanes: [lane.laneIndex], s, start: t, end: t + dur, label, id: `ev${this.log.length}`, laneObjs: [lane], active: false, done: false, random: true };
    sim.blockages.push(b);
    this.log.push({ kind: 'blockage', t, key, label });
  }

  _school(t) {
    const peds = this.sim.peds;
    if (!peds.cfg || !peds.crossings.length) return;
    const base = peds.cfg.cross;
    peds.cfg.cross = base * 3;
    for (const c of peds.crossings) c.timer = Math.min(c.timer, this.rng.range(0.5, 3));
    const e = { kind: 'school', end: t + 40, base };
    this.active.push(e);
    this.sim.notify('SCHOOL_OUT', 'UWIAN NA! · SCHOOL IS OUT, CROWDS AT THE CROSSWALKS', 'info');
    this.log.push({ kind: 'school', t });
  }

  _jeepWave(t) {
    const sim = this.sim;
    const e = { kind: 'jeepwave', end: t + 45, base: sim.cornerStopRate };
    sim.cornerStopRate = Math.min(0.6, (sim.cornerStopRate || 0.15) * 3);
    this.active.push(e);
    sim.notify('JEEP_WAVE', 'MARAMING PASAHERO · JEEPS STOPPING AT EVERY CORNER', 'info');
    this.log.push({ kind: 'jeepwave', t });
  }

  _end(e) {
    e.ended = true;
    if (e.kind === 'school') this.sim.peds.cfg.cross = e.base;
    else if (e.kind === 'jeepwave') this.sim.cornerStopRate = e.base;
  }
}
