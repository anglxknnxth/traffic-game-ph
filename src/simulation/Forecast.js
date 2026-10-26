// "Hula": a short-range forecast of which approaches are about to fill up. DOM-free and cheap.
//
// For every approach into a junction, once a second: the queue standing on it now, the rate cars
// arrive (the spawner's own demand curve on roads from the map edge, the moving traffic on a link
// between two junctions) and the rate it can discharge (about one car per two seconds per lane,
// times the share of the last minute it has had green). When more arrive than leave, the time until
// the queue reaches the end of the road is the forecast. A full road between two junctions is how
// gridlock starts, so those are flagged sooner.
//
// It is a queue-flow estimate, not a second simulation: it runs on every step budget for free.
//
// sim.forecast.items: [{ key, I, arm, label, inS, link }] for approaches that fill within HORIZON s.

const HORIZON = 120;
const SAT_FLOW = 0.45; // vehicles/s per lane on green
const SHARE_TAU = 60; // s: memory of the green share
const JAM = 7.2; // m of road per queued vehicle
const NOTIFY_AT = 30; // s: the radio warns this far ahead (endless modes)
const NOTIFY_GAP = 45; // s between warnings for one approach

export class Forecast {
  constructor(sim) {
    this.sim = sim;
    this.items = [];
    this.timer = 0;
    this.share = new Map(); // `${node}:${arm}` -> smoothed green share 0..1
    this.eta = new Map(); // smoothed seconds-to-full
    this.warned = new Map();
  }

  update(dt) {
    const sim = this.sim;
    // The green share is sampled every step so short greens count.
    for (const I of sim.network.intersections) {
      if (I.kind !== 'signal') continue;
      for (const arm of Object.keys(I.approachLanes)) {
        const key = `${I.id}:${arm}`;
        const g = sim.lights.signal(I.id, arm) === 'green' ? 1 : 0;
        const s = this.share.get(key) ?? 0.4;
        this.share.set(key, s + (g - s) * Math.min(1, dt / SHARE_TAU));
      }
    }
    this.timer += dt;
    if (this.timer < 1) return;
    const step = this.timer;
    this.timer = 0;
    const items = [];
    for (const I of sim.network.intersections) {
      if (I.kind === 'uturn' || I.kind === 'toll' || I.kind === 'pass') continue; // slots: their queues show at the junctions
      for (const [arm, lanes] of Object.entries(I.approachLanes)) {
        if (!lanes?.length) continue;
        const it = this._approach(I, arm, lanes, step);
        if (it) items.push(it);
      }
    }
    items.sort((a, b) => a.inS - b.inS);
    this.items = items;
    if (sim.level.surges) this._warn(items);
  }

  _approach(I, arm, lanes, step) {
    const sim = this.sim;
    const key = `${I.id}:${arm}`;
    let queued = 0;
    let moving = 0;
    let room = 0;
    let general = 0;
    for (const lane of lanes) {
      room += lane.length / JAM;
      if (lane.type === 'general' || lane.type === 'tunnel') general++;
      for (const v of lane.vehicles) {
        if (v.v < 1.5) queued++;
        else moving++;
      }
    }
    const link = lanes[0].role !== 'approach';
    // Arrivals: the demand curve at the map edge, the traffic already on its way on a link.
    let arrive;
    let overflow = 0;
    if (!link) {
      arrive = sim.spawner.keys.includes(key) ? sim.spawner.rate(key, sim.time) : 0;
      for (const lane of lanes) overflow += sim.spawner.pendingFor(lane);
    } else {
      const len = lanes[0].length;
      arrive = moving / Math.max(4, len / 9);
    }
    const share = I.kind === 'signal' ? this.share.get(key) ?? 0.4 : 0.6;
    const leave = SAT_FLOW * Math.max(1, general) * share;
    const limit = room * (link ? 0.7 : 0.85);
    let inS;
    if (overflow > 2 || queued >= limit) inS = 0;
    else {
      const net = arrive - leave;
      inS = net > 0.01 ? (limit - queued) / net : Infinity;
    }
    // Smooth so the number does not jump around from one second to the next.
    const prev = this.eta.get(key);
    const smooth = prev === undefined || !Number.isFinite(prev) || !Number.isFinite(inS) ? inS : prev + (inS - prev) * Math.min(1, step / 4);
    this.eta.set(key, smooth);
    if (!(smooth < HORIZON)) return null;
    return { key, I, arm, label: sim.network.armLabel(I, arm), inS: Math.max(0, smooth), link, lanes };
  }

  _warn(items) {
    const sim = this.sim;
    for (const it of items) {
      if (it.inS > NOTIFY_AT) break;
      const last = this.warned.get(it.key);
      if (last !== undefined && sim.time - last < NOTIFY_GAP) continue;
      this.warned.set(it.key, sim.time);
      const full = it.inS < 1;
      const what = it.link ? (full ? 'puno na ang kalsada sa pagitan ng mga kanto (gridlock!)' : 'mapupuno ang kalsada sa pagitan ng mga kanto (gridlock!)') : full ? 'umabot na sa dulo ang pila' : 'aabot na sa dulo ang pila';
      sim.notify(`FC_${it.key}`, `🔮 HULA: ${it.label} · ${what}${full ? '' : ` in ~${Math.round(it.inS)} s`}`, 'warn');
      break; // one warning at a time
    }
  }
}
