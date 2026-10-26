// Vehicle arrivals. Demand is generated per external approach as a Poisson process; arrivals wait in
// an off-map queue until the entry of their lane is physically free (checked with the same collision
// rules as moving vehicles), so spawning can never create an overlap.

import { VEHICLE_TYPES, HEAVY_TYPES, LOADING_TYPES } from '../data/vehicles.js';
import { PERSONALITIES, LOADING_ZONE_S } from '../data/config.js';
import { Route, Vehicle } from './Vehicle.js';
import { Network } from './LaneManager.js';

// Loading-stop vehicles from before tricycles and multicabs joined them: they keep drawing the same
// random numbers as always, so levels without loading stops replay exactly as before.
const CLASSIC_LOADERS = new Set(['jeepney', 'bus', 'ejeep']);

/** Buses and trucks rarely turn into single-lane streets: they cannot make the swing past waiting cars. */
function narrowTurn(type, conn) {
  return VEHICLE_TYPES[type].length > 8 && conn && conn.toLane.laneCount === 1 ? 0.12 : 1;
}

export class VehicleSpawner {
  constructor(sim) {
    this.sim = sim;
    this.level = sim.level;
    this.rng = sim.rng;
    this.keys = sim.network.externalApproachKeys();
    this.timers = new Map();
    this.pending = new Map();
    this.nextSpawnAt = new Map(); // per lane: queued arrivals enter at a natural headway, not in a burst
    this.wavePhase = new Map();
    for (const lane of sim.network.spawnLanes) this.pending.set(lane, []);
    for (const k of this.keys) {
      this.wavePhase.set(k, this.rng.range(0, Math.PI * 2));
      this.timers.set(k, this.rng.exp(Math.max(this.rate(k, 0), 1e-6)) * 0.6);
    }
    const em = this.level.emergency;
    this.emergencyTimes = em?.times ? [...em.times].sort((a, b) => a - b) : [];
    this.emergencyInterval = em?.interval || null;
    this.nextRandomEmergency = this.emergencyInterval ? this.rng.range(...this.emergencyInterval) : Infinity;
    this.arrivals = []; // timestamps for volume metric
  }

  baseDemand(key) {
    const d = this.level.demand || {};
    const arm = key.split(':')[1];
    return d[key] ?? d[arm] ?? 0;
  }

  /** Arrival rate (veh/s) for an approach at time t. */
  rate(key, t) {
    const perMin = this.baseDemand(key);
    const ramp = Math.min(this.sim.rampMax ?? Infinity, 1 + (this.level.demandRamp || 0) * (Math.max(0, this.sim.scheduleTime) / 60));
    const amp = this.level.demandWave || 0;
    const phase = this.wavePhase.get(key) || 0;
    const wave = 1 + amp * Math.sin((t / 55) * Math.PI * 2 + phase) * 0.8 + amp * 0.4 * Math.sin((t / 23) * Math.PI * 2 + phase * 1.7);
    const scale = (this.level.demandScale ?? 1) * (this.sim.demandMul ?? 1) * (this.sim.codingMul ?? 1);
    return Math.max(0, (perMin / 60) * scale * ramp * Math.max(0.2, wave) * this.sim.env.demandFor(key) * (this.sim.scenarios?.boost(key) ?? 1));
  }

  pendingCount() {
    let n = 0;
    for (const q of this.pending.values()) n += q.length;
    return n;
  }

  pendingFor(lane) {
    return this.pending.get(lane)?.length || 0;
  }

  volumePerMinute() {
    const t = this.sim.time;
    while (this.arrivals.length && this.arrivals[0] < t - 60) this.arrivals.shift();
    const span = Math.min(60, Math.max(10, t));
    return (this.arrivals.length * 60) / span;
  }

  update(dt) {
    const t = this.sim.time;
    for (const key of this.keys) {
      let timer = this.timers.get(key) - dt;
      let guard = 0;
      while (timer <= 0 && guard++ < 5) {
        this.createArrival(key);
        const r = this.rate(key, t);
        timer += r > 0 ? this.rng.exp(r) : 5;
      }
      if (timer <= 0) timer = 0.5;
      this.timers.set(key, timer);
    }
    // Emergencies
    const st = this.sim.scheduleTime;
    while (this.emergencyTimes.length && this.emergencyTimes[0] <= st) {
      this.emergencyTimes.shift();
      this.createArrival(this.rng.pick(this.keys), true);
    }
    if (st >= this.nextRandomEmergency) {
      this.createArrival(this.rng.pick(this.keys), true);
      this.nextRandomEmergency = st + this.rng.range(...this.emergencyInterval);
    }
    // Spawn from queues when the lane entry is free
    for (const [lane, q] of this.pending) {
      if (!q.length || (this.nextSpawnAt.get(lane) ?? 0) > t) continue;
      if (this.trySpawn(lane, q[0])) q.shift();
    }
  }

  /**
   * Waze-style routing for drivers with a navigation app: each movement's weight drops with the
   * queue already standing on the road it leads into, so app users drift to the roads that are
   * moving. Counts a reroute when the app talks the driver out of their first choice.
   */
  _waze(w, connOf) {
    const raw = Object.keys(w).reduce((a, b) => (w[a] >= w[b] ? a : b));
    for (const m of Object.keys(w)) {
      const to = connOf(m)?.toLane;
      if (!to) continue;
      let q = 0;
      for (const o of to.vehicles) if (o.v < 1.5) q++;
      w[m] *= 1 / (1 + (q / 5) ** 2);
    }
    const best = Object.keys(w).reduce((a, b) => (w[a] >= w[b] ? a : b));
    if (best !== raw) this._rerouted(connOf(raw)?.toLane);
  }

  _rerouted(avoided) {
    this.reroutes = (this.reroutes || 0) + 1;
    this._rerouteBatch = (this._rerouteBatch || 0) + 1;
    if (this._rerouteBatch < 12) return;
    this._rerouteBatch = 0;
    const I = avoided?.endInt || avoided?.startInt;
    const road = I ? this.sim.network.roadName(I, avoided.endInt ? avoided.endArm : avoided.startArm) : null;
    this.sim.notify('WAZE', `📱 WAZE: nag-reroute na ang ${this.reroutes} sasakyan${road ? ` palayo sa ${road}` : ''}`, 'info');
  }

  /** Does this arrival drive with a navigation app (the endless modes only)? */
  _appUser(type) {
    if (!this.level.surges) return false;
    const share = { car: 0.35, suv: 0.35, van: 0.3, pickup: 0.25, motorcycle: 0.2 }[type] || 0;
    return share > 0 && this.rng.chance(share);
  }

  /** Next movement for a vehicle of `type` arriving at the end of `lane`. */
  chooseMovement(lane, type, usedUturn = false, app = false) {
    const turns = this.level.turns || { left: 0.1, right: 0.1 };
    const c = lane.connectors;
    const ok = (m) => c[m] && c[m].toLane.allows(type);
    const w = {};
    if (ok('straight')) w.straight = 1 - turns.left - turns.right;
    if (ok('left')) w.left = turns.left * 2 * narrowTurn(type, c.left);
    if (ok('right')) w.right = turns.right * 2 * narrowTurn(type, c.right);
    // Long vehicles cannot swing through a median U-turn slot.
    if (ok('uturn') && !usedUturn && VEHICLE_TYPES[type].length <= 7) w.uturn = lane.endInt.def.uturnRate ?? 0.15;
    const keys = Object.keys(w);
    if (!keys.length) return Object.keys(c)[0];
    if (keys.length === 1) return keys[0];
    if (app) this._waze(w, (m) => c[m]);
    return this.rng.weighted(w);
  }

  buildRoute(firstLane, firstMove, type = 'car', app = false) {
    const segs = [firstLane];
    let lane = firstLane;
    let move = firstMove;
    let usedUturn = false;
    let guard = 0;
    while (lane.endInt && guard++ < 10) {
      const conn = Network.connectorFor(lane, move, VEHICLE_TYPES[type]) || lane.connectors.straight || Object.values(lane.connectors)[0];
      if (!conn) break;
      if (conn.movement === 'uturn') usedUturn = true;
      segs.push(conn);
      lane = conn.toLane;
      segs.push(lane);
      if (lane.endInt) move = this.chooseMovement(lane, type, usedUturn, app);
    }
    return new Route(segs);
  }

  /** Approach lane for a new arrival: dedicated bus/moto lanes first, heavy vehicles keep to the curb. */
  chooseLane(lanes, type, move) {
    const rng = this.rng;
    let cands = lanes.filter((l) => l.connectors[move] && l.allows(type));
    if (!cands.length) cands = lanes.filter((l) => l.allows(type));
    const dedicated = cands.filter((l) => l.allowed);
    const general = cands.filter((l) => !l.allowed);
    if (dedicated.length && (!general.length || type === 'bicycle' || rng.chance(0.85))) return dedicated.length > 1 ? rng.pick(dedicated) : dedicated[0];
    if (general.length === 1) return general[0];
    // Going straight: keep out of the curb lane where you can, so drivers turning right (even on
    // red) are not stuck behind you.
    const curbLane = general[general.length - 1];
    if (move === 'straight' && curbLane.connectors.right && !HEAVY_TYPES.has(type) && rng.chance(0.95)) {
      const others = general.slice(0, -1);
      return others.length > 1 ? rng.pick(others) : others[0];
    }
    if (HEAVY_TYPES.has(type)) {
      const curb = general[general.length - 1];
      if (rng.chance(move === 'straight' && curb.connectors.right ? 0.5 : 0.8)) return curb;
      const others = general.slice(0, -1);
      return others.length > 1 ? rng.pick(others) : others[0];
    }
    return rng.pick(general);
  }

  /** The level's vehicle mix reweighted for the hour (rush PUVs, truck ban, night trikes), cached per game-minute. */
  hourlyMix() {
    const env = this.sim.env;
    const sc = this.sim.scenarios;
    if (!env.rushHour && !sc?.gas) return this.level.mix;
    const minute = Math.floor(env.hour * 60) * 2 + (sc?.gas ? 1 : 0);
    if (this._mixMinute !== minute) {
      this._mixMinute = minute;
      this._mix = Object.fromEntries(Object.entries(this.level.mix).map(([t, w]) => [t, w * env.mixFactor(t) * (sc?.gasFactor(t) ?? 1)]));
    }
    return this._mix;
  }

  /**
   * Queue an arrival on approach `key`. `force` (event vehicles: Habulan, VIP motorcade) fixes the
   * type and adds `flags` to the vehicle; it goes to the front of the queue. Returns the queued item.
   */
  createArrival(key, emergency = false, force = null) {
    const lanes = this.sim.network.approachLanesByKey(key);
    if (!lanes.length) return null;
    const rng = this.rng;
    const mix = this.hourlyMix();
    let type = force?.type || (emergency ? (rng.chance(0.65) ? 'ambulance' : 'firetruck') : rng.weighted(mix));
    // Bicycles only enter on roads with a bike lane; elsewhere the arrival is something else.
    if (type === 'bicycle' && !lanes.some((l) => l.type === 'bike')) {
      const { bicycle, ...rest } = mix;
      type = rng.weighted(rest);
    }
    const personality = force?.personality || (emergency ? 'patient' : rng.weighted(this.level.personalities));
    const turns = this.level.turns || { left: 0.1, right: 0.1 };
    const avail = new Set();
    for (const l of lanes) if (l.allows(type) && (type !== 'bicycle' || l.type === 'bike')) for (const m of Object.keys(l.connectors)) if (m !== 'uturn' && l.connectors[m].toLane.allows(type)) avail.add(m);
    let move;
    let app = false; // drives with a navigation app (Waze-style routing)
    if (emergency || force?.move) move = avail.has(force?.move || 'straight') ? force?.move || 'straight' : [...avail][0];
    else {
      const w = {};
      if (avail.has('straight')) w.straight = Math.max(0, 1 - turns.left - turns.right);
      const sample = (m) => lanes.find((l) => l.connectors[m])?.connectors[m];
      if (avail.has('left')) w.left = turns.left * narrowTurn(type, sample('left'));
      if (avail.has('right')) w.right = turns.right * narrowTurn(type, sample('right'));
      const keys = Object.keys(w);
      if (keys.length && !keys.some((k) => w[k] > 0)) for (const k of keys) w[k] = 1;
      app = !force && this._appUser(type);
      if (app && keys.length > 1) this._waze(w, sample);
      move = keys.length ? rng.weighted(w) : 'straight';
    }
    const lane = this.chooseLane(lanes, type, move);
    if (!lane) return null;
    const route = this.buildRoute(lane, move, type, app);
    const item = { type, personality, route, emergency, flags: force?.flags || null, color: force?.color || null, lane };
    if (force && !emergency) {
      this.pending.get(lane).unshift(item);
    } else if (emergency) {
      this.sim.stats.emergencyArrivals++;
      this.sim.stats.emergencyArrivalTimes.push(this.sim.scheduleTime);
      this.pending.get(lane).unshift(item);
      this.sim.notify('EMERGENCY', `${VEHICLE_TYPES[type].label.toUpperCase()} APPROACHING`);
    } else {
      this.pending.get(lane).push(item);
    }
    this.arrivals.push(this.sim.time);
    return item;
  }

  /** Queue a vehicle right behind `lead` (still waiting off-map), on the very same route. */
  queueBehind(lead, type, { flags = null, color = null, personality = 'patient' } = {}) {
    const q = this.pending.get(lead.lane);
    const at = q.indexOf(lead);
    if (at < 0) return null;
    // behind the lead and whoever of its convoy is already queued after it
    let i = at + 1;
    while (i < q.length && q[i].convoyOf === lead) i++;
    const item = { type, personality, route: new Route(lead.route.entries.map((e) => e.seg)), emergency: false, flags, color, lane: lead.lane, convoyOf: lead };
    q.splice(i, 0, item);
    return item;
  }

  trySpawn(lane, item) {
    const sim = this.sim;
    const spec = VEHICLE_TYPES[item.type];
    const hl = spec.length / 2;
    const s = hl + 0.3;
    const first = lane.vehicles[0];
    let v0 = spec.maxSpeed * 0.8;
    if (first) {
      const gap = first.localS - first.hl - (s + hl);
      if (gap < 3) return false;
      const allowed = Math.sqrt(Math.max(0, 2 * spec.decel * (gap - 3))) * 0.7;
      v0 = Math.min(v0, first.v + allowed);
    }
    const veh = new Vehicle({
      spec,
      personality: PERSONALITIES[item.personality],
      route: item.route,
      color: item.color || this.rng.pick(spec.colors),
      s,
      v: Math.max(0, v0),
      time: sim.time,
      speedVar: this.rng.range(0.92, 1.06),
    });
    // Full collision check against everything nearby (not only this lane).
    const nb = sim.collision.neighbors(veh, 0);
    if (!sim.collision.isClear(veh.obb, nb)) return false;
    veh.hornCooldown = this.rng.range(1, 4);
    const [r0, r1] = veh.p.reaction || [0.5, 0.8];
    veh.reaction = item.emergency ? 0.3 : this.rng.range(r0, r1);
    veh.idealTravel = 0;
    if (item.flags) Object.assign(veh, item.flags);
    item.vehicle = veh;
    sim.passengers?.fill(veh);
    // A packed jeepney usually drives past the stop ("PUNO NA!") unless someone wants off.
    // (no random draws at all on levels without loading stops, so their traffic is unchanged)
    const stops = this.level.loadingStops || 0;
    const packed = stops > 0 && veh.capacity && veh.passengers >= veh.capacity && this.rng.chance(0.6);
    if (!item.emergency && !packed && LOADING_TYPES.has(item.type) && (stops > 0 || CLASSIC_LOADERS.has(item.type)) && this.rng.chance(stops)) {
      const exit = item.route.exitLane;
      // Curbside stop on general roads; buses also stop on their own busway (median stations).
      const stopLane = (exit.isCurb && exit.type === 'general') || (exit.type === 'bus' && item.type === 'bus');
      if (stopLane && exit.length > LOADING_ZONE_S + 10) {
        const start = item.route.startOf(exit);
        veh.loading = { s: start + LOADING_ZONE_S, duration: this.rng.range(3, 8), state: 'pending', timer: 0 };
      }
    }
    sim.addVehicle(veh, lane);
    // The next queued arrival on this lane follows at its driver's own headway.
    const vEntry = Math.max(veh.v, 1);
    this.nextSpawnAt.set(lane, sim.time + Math.min(3, Math.max(0.9, (spec.length + veh.p.minGap) / vEntry + veh.p.headway * 0.6)));
    return true;
  }
}
