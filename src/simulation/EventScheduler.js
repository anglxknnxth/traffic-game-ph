// Random scenarios for the endless modes: stalled vehicles and roadworks on random exits, a school
// letting out (a rush of people at the crosswalks), waves of jeepneys stopping at the corners,
// concerts letting out, boss events, a fire (fire trucks and a closed lane), a fuel price hike
// (fewer cars, more motorcycles and riders) and, in the endless modes, DPWH reblocking that moves to
// another road every game day.
// Emergencies and weather have their own random schedules (level.emergency.interval, env.random).
// Uses its own random stream, so levels without random events are unchanged.

import { Rng } from '../utils/math.js';
import { rightOf } from './LaneManager.js';

const FIRE_S = 70; // s a fire keeps its lane closed
const GAS_S = 300; // s a fuel price hike lasts (about a game day at endless speed)

const LABELS = ['STALLED TRUCK', 'STALLED JEEP', 'ROAD WORKS', 'FLAT TYRE', 'STALLED BUS', 'MINOR ACCIDENT'];
const EXODUS = [
  { icon: '🎤', text: 'TAPOS NA ANG CONCERT' },
  { icon: '🏀', text: 'TAPOS NA ANG PBA GAME' },
  { icon: '🛍️', text: 'MALL SALE · UWIAN NA' },
  { icon: '⛪', text: 'TAPOS NA ANG MISA' },
];

export class EventScheduler {
  constructor(sim, cfg = {}) {
    this.sim = sim;
    this.rng = new Rng(((sim.seed ?? 1) ^ 0x2c1b3c6d) >>> 0);
    this.every = cfg.every || [35, 70];
    this.next = this.rng.range(25, 45);
    this.active = [];
    this.log = [];
    this.gas = null; // { end } while fuel prices are up
    this.works = null; // today's DPWH reblocking blockage
  }

  update(dt) {
    const sim = this.sim;
    const t = sim.scheduleTime;
    for (const e of this.active) if (t >= e.end && !e.ended) this._end(e);
    this.active = this.active.filter((e) => !e.ended);
    for (const e of this.active) if (e.kind === 'fire') this._fireTrucks(e, t);
    // DPWH reblocking: a lane of one road for the whole game day, then somewhere else.
    if (sim.level.surges && (sim.env.newDay || (!this.works && t > 30))) this._reblock(t);
    if (this.gas && t >= this.gas.end) {
      this.gas = null;
      sim.notify('GAS_DOWN', '⛽ ROLLBACK! · bumaba na ang presyo ng gasolina', 'good');
    }
    if (t < this.next) return;
    this.next = t + this.rng.range(...this.every);
    const kinds = ['blockage', 'blockage', 'school', 'jeepwave', 'exodus', 'boss', 'fire', 'gas'];
    const kind = this.rng.pick(kinds);
    if (kind === 'blockage') this._blockage(t);
    else if (kind === 'school') this._school(t);
    else if (kind === 'exodus') this._exodus(t);
    else if (kind === 'boss') this._boss(t);
    else if (kind === 'fire') this._fire(t);
    else if (kind === 'gas' && !this.gas) this._gasHike(t);
    else this._jeepWave(t);
  }

  /** A free general curb-side exit lane on a road that keeps another lane open: { key, lane } or null. */
  _pickExitLane() {
    const sim = this.sim;
    const keys = [...new Set(sim.network.exitLanes.map((l) => l.exitKey))].filter((k) => !sim.blockages.some((b) => b.active && b.exit === k && !b.done));
    for (let n = 0; n < 6 && keys.length; n++) {
      const key = keys.splice(this.rng.int(0, keys.length - 1), 1)[0];
      const lanes = sim.network.exitLanesByKey(key).filter((l) => l.type === 'general');
      if (lanes.length >= 2) return { key, lanes, lane: lanes[lanes.length - 1] };
    }
    return null;
  }

  /**
   * SUNOG: a building by an exit road is on fire. Its curb lane is closed by the fire hoses and two or
   * three fire trucks come in one after another (emergency vehicles: clear them fast for the bonus).
   */
  _fire(t) {
    const sim = this.sim;
    if (this.active.some((e) => e.kind === 'fire')) return this._jeepWave(t);
    const pick = this._pickExitLane();
    if (!pick) return this._jeepWave(t);
    const { key, lane } = pick;
    const s = Math.min(lane.length - 30, this.rng.range(24, 36));
    const p = {};
    lane.path.pointAt(s, p);
    const r = rightOf({ x: p.dx, y: p.dy });
    const off = lane.width / 2 + 9; // the building beyond the sidewalk
    const b = { exit: key, lanes: [lane.laneIndex], s, start: t, end: t + FIRE_S, label: 'SUNOG · FIRE HOSES', id: `fire${this.log.length}`, laneObjs: [lane], active: false, done: false, random: true, noTow: true, kind: 'fire' };
    sim.blockages.push(b);
    const e = { kind: 'fire', end: t + FIRE_S, x: p.x + r.x * off, y: p.y + r.y * off, trucks: this.rng.int(2, 3), nextTruck: t + 3 };
    this.active.push(e);
    sim.notify('FIRE', `🔥 SUNOG sa ${sim.exitName(key)}! · paparating ang mga bumbero, bigyan ng daan`, 'danger');
    this.log.push({ kind: 'fire', t, key });
  }

  /** Fire trucks for a burning building, a few seconds apart. */
  _fireTrucks(e, t) {
    if (!e.trucks || t < e.nextTruck) return;
    e.trucks--;
    e.nextTruck = t + this.rng.range(6, 12);
    this.sim.spawner.createArrival(this.rng.pick(this.sim.spawner.keys), true, { type: 'firetruck' });
  }

  /** Fuel prices go up: private cars stay home, motorcycles, bicycles and the jeepneys fill up. */
  _gasHike(t) {
    this.gas = { start: t, end: t + GAS_S };
    this.sim.notify('GAS_UP', '⛽ TAAS-PRESYO NG GASOLINA! · mas kaunting kotse, mas maraming motor at pasahero', 'warn');
    this.log.push({ kind: 'gas', t });
  }

  /** Vehicle-mix weight while fuel prices are up (VehicleSpawner.hourlyMix). */
  gasFactor(type) {
    if (!this.gas) return 1;
    if (type === 'car' || type === 'suv' || type === 'pickup' || type === 'van') return 0.7;
    if (type === 'motorcycle') return 1.4;
    if (type === 'bicycle') return 1.5;
    return 1;
  }

  /** Move the DPWH reblocking to a lane of another road, for the rest of the game day. */
  _reblock(t) {
    const sim = this.sim;
    if (this.works) this.works.end = Math.min(this.works.end, t);
    const pick = this._pickExitLane();
    if (!pick) return;
    const { key, lane } = pick;
    const day = ((24 - sim.env.hour) * 60) / Math.max(0.1, sim.env.rate || 1); // s to midnight
    const s = Math.min(lane.length - 40, this.rng.range(22, 30));
    const b = { exit: key, lanes: [lane.laneIndex], s, start: t, end: t + Math.max(60, day), label: 'DPWH REBLOCKING · MAHAL NA PO, PASENSYA', id: `dpwh${this.log.length}`, laneObjs: [lane], active: false, done: false, random: true, noTow: true, kind: 'works' };
    sim.blockages.push(b);
    this.works = b;
    sim.notify('DPWH', `🚧 DPWH REBLOCKING ngayong araw sa ${sim.exitName(key)} · isang lane lang ang bukas`, 'warn');
    this.log.push({ kind: 'reblock', t, key });
  }

  /** Habulan or a VIP motorcade: one at a time, and not in the first minute of a run. */
  _boss(t) {
    const boss = this.sim.boss;
    if (!boss || boss.busy || t < 60) return this._jeepWave(t);
    const ok = this.rng.chance(0.5) ? boss.startChase() : boss.startMotorcade();
    if (ok) this.log.push({ kind: 'boss', t });
  }

  /**
   * A concert, a PBA game or a mall sale lets out: one approach suddenly carries a flood of cars
   * (and people on the sidewalks) for a minute. Announced a little ahead so the player can get ready.
   */
  _exodus(t) {
    const sim = this.sim;
    if (this.active.some((e) => e.kind === 'exodus')) return;
    const key = this.rng.pick(sim.spawner.keys);
    const what = this.rng.pick(EXODUS);
    const e = { kind: 'exodus', key, start: t + 12, end: t + 12 + this.rng.range(45, 70), on: false, what };
    this.active.push(e);
    const road = sim.network.armLabel?.(sim.network.byId.get(key.split(':')[0]), key.split(':')[1]) || key;
    sim.notify('EXODUS', `${what.icon} ${what.text} · dagsa ng sasakyan mula ${road} in 10 s!`, 'warn');
    this.log.push({ kind: 'exodus', t, key });
  }

  /** Per-approach demand boost from a running exodus (VehicleSpawner.rate). */
  boost(key) {
    let k = 1;
    for (const e of this.active) if (e.kind === 'exodus' && e.key === key && this.sim.scheduleTime >= e.start) k *= 3;
    return k;
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
