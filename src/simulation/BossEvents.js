// Boss events for the endless modes (started by EventScheduler, or by a level's script). DOM-free.
//
// HABULAN — a getaway car with a patrol car on its tail. The getaway runs every red it can get
//   through (only when nothing crossing is coming: the same rule as an enforcer's Padaanin, so it
//   never crashes). Pin it behind a red with traffic flowing across, or behind a queue, for
//   CORNER_S seconds and it is cornered: tap it, HULI! If it reaches the edge of the map it escapes.
//
// VIP MOTORCADE — patrol car, two black SUVs, patrol car, on one route through the city (drawn on
//   the map). They obey the lights: give them a green wave. Score by how often the convoy stopped.

import { Rng } from '../utils/math.js';

const CORNER_S = 3;
const VIP_COLOR = '#0b1220';

export class BossEvents {
  constructor(sim) {
    this.sim = sim;
    this.rng = new Rng(((sim.seed ?? 1) ^ 0x6a09e667) >>> 0);
    this.chases = [];
    this.convoys = [];
    this.seq = 0;
  }

  get busy() {
    return this.chases.length + this.convoys.length > 0;
  }

  // ------------------------------------------------------------------ Habulan
  startChase() {
    const sim = this.sim;
    const sp = sim.spawner;
    const key = this.rng.pick(sp.keys);
    const id = ++this.seq;
    const lead = sp.createArrival(key, false, { type: 'getaway', personality: 'aggressive', move: 'straight', flags: { getaway: id, waved: Infinity } });
    if (!lead) return false;
    sp.queueBehind(lead, 'police', { flags: { chaser: id, waved: Infinity }, personality: 'aggressive' });
    this.chases.push({ id, item: lead, stuck: 0, done: false });
    const [node, arm] = key.split(':');
    const road = sim.network.armLabel(sim.network.byId.get(node), arm);
    sim.notify(`CHASE_${id}`, `🚓 HABULAN! · tumatakas na carnapper mula ${road} · ipitin sa red, tapos HULI!`, 'danger');
    sim.events.push({ type: 'boss', kind: 'chase', state: 'start' });
    return true;
  }

  _updateChase(c, dt) {
    const g = c.item.vehicle;
    if (!g || c.done) return;
    // Cornered: pinned and going nowhere for a few seconds (not while still entering the map).
    if (!g.caught && g.v < 0.6 && g.s > 15) c.stuck += dt;
    else if (!g.caught) c.stuck = Math.max(0, c.stuck - dt * 2);
    const was = g.cornered;
    g.cornered = c.stuck >= CORNER_S;
    if (g.cornered && !was) {
      g.say = 'NAIPIT!';
      g.sayTimer = 2;
      this.sim.notify(`CORNER_${c.id}`, '🚨 NAIPIT ANG CARNAPPER! · tap it now: HULI!', 'good');
    }
  }

  /** HULI! on a cornered getaway car (Enforcement.catchVehicle). */
  caught(v) {
    const c = this.chases.find((x) => x.id === v.getaway);
    if (!c || c.done) return;
    c.done = true;
    v.waved = 0; // it gives up: back to obeying the lights
    v.cornered = false;
    this.sim.scoring.onChase?.(true);
    this.sim.events.push({ type: 'boss', kind: 'chase', state: 'caught', x: v.x, y: v.y });
  }

  // ------------------------------------------------------------------ VIP motorcade
  startMotorcade() {
    const sim = this.sim;
    const sp = sim.spawner;
    const want = sim.network.intersections.filter((I) => I.kind === 'signal').length > 1 ? 2 : 1;
    let lead = null;
    let from = '';
    const keys = [...sp.keys];
    for (let n = 0; n < 8 && keys.length && !lead; n++) {
      const key = keys.splice(this.rng.int(0, keys.length - 1), 1)[0];
      const item = sp.createArrival(key, false, { type: 'police', personality: 'patient', move: 'straight', flags: { vip: 0 } });
      if (!item) continue;
      if (item.route.connectorIdx.length >= want) {
        lead = item;
        const [node, arm] = key.split(':');
        from = sim.network.armLabel(sim.network.byId.get(node), arm);
      } else sp.pending.get(item.lane).splice(sp.pending.get(item.lane).indexOf(item), 1);
    }
    if (!lead) return false;
    const id = ++this.seq;
    lead.flags.vip = id;
    const items = [lead];
    for (const type of ['suv', 'suv', 'police']) {
      const it = sp.queueBehind(lead, type, { flags: { vip: id }, color: type === 'suv' ? VIP_COLOR : null });
      if (it) items.push(it);
    }
    this.convoys.push({ id, items, route: lead.route, stops: 0, stopped: false, seen: false, done: false });
    sim.notify(`VIP_${id}`, `🚔 VIP MOTORCADE${from ? ` mula ${from}` : ''} · bigyan ng tuloy-tuloy na green (green wave)!`, 'warn');
    sim.events.push({ type: 'boss', kind: 'vip', state: 'start' });
    return true;
  }

  _updateConvoy(c) {
    const cars = c.items.map((i) => i.vehicle).filter(Boolean);
    if (!cars.length) return;
    c.seen = true;
    const alive = cars.filter((v) => !v._remove && this.sim.vehicles.includes(v));
    if (!alive.length && cars.length === c.items.length) return this._endConvoy(c);
    // A stop: any car of the convoy at a standstill once it is on its way.
    const stoppedNow = alive.some((v) => v.v < 0.4 && v.s > 20);
    if (stoppedNow && !c.stopped) c.stops++;
    c.stopped = stoppedNow;
  }

  _endConvoy(c) {
    c.done = true;
    const sim = this.sim;
    sim.scoring.onMotorcade?.(c.stops);
    const text = c.stops === 0 ? '🌟 PERFECT GREEN WAVE! · hindi huminto ang VIP' : c.stops <= 2 ? `👍 NAKALUSOT ANG VIP · huminto ng ${c.stops}×` : `😠 GALIT ANG VIP · huminto ng ${c.stops}×`;
    sim.notify(`VIPDONE_${c.id}`, text, c.stops <= 2 ? 'good' : 'warn');
    sim.events.push({ type: 'boss', kind: 'vip', state: 'done', stops: c.stops });
  }

  /** Routes to draw: convoys on their way. */
  routes() {
    return this.convoys.filter((c) => !c.done).map((c) => c.route);
  }

  // ------------------------------------------------------------------ bookkeeping
  onDespawn(v) {
    if (!v.getaway) return;
    const c = this.chases.find((x) => x.id === v.getaway);
    if (!c || c.done) return;
    c.done = true;
    this.sim.scoring.onChase?.(false);
    this.sim.notify(`ESCAPE_${c.id}`, '💨 NAKATAKAS ANG CARNAPPER! · viral na sa social media…', 'danger');
    this.sim.events.push({ type: 'boss', kind: 'chase', state: 'escaped' });
  }

  update(dt) {
    // Scripted boss events (Daily Challenge, levels): { t, kind: 'chase' | 'vip' }.
    const script = this.sim.level.bossScript;
    if (script) {
      this._next = this._next || 0;
      while (this._next < script.length && script[this._next].t <= this.sim.scheduleTime) {
        const s = script[this._next++];
        if (s.kind === 'chase') this.startChase();
        else this.startMotorcade();
      }
    }
    for (const c of this.chases) this._updateChase(c, dt);
    for (const c of this.convoys) if (!c.done) this._updateConvoy(c);
    this.chases = this.chases.filter((c) => !c.done || (c.item.vehicle && this.sim.vehicles.includes(c.item.vehicle)));
    this.convoys = this.convoys.filter((c) => !c.done);
  }
}
