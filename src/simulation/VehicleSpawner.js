// Vehicle arrivals. Demand is generated per external approach as a Poisson process; arrivals wait in
// an off-map queue until the entry of their lane is physically free (checked with the same collision
// rules as moving vehicles), so spawning can never create an overlap.

import { VEHICLE_TYPES, HEAVY_TYPES, LOADING_TYPES } from '../data/vehicles.js';
import { PERSONALITIES, LOADING_ZONE_S } from '../data/config.js';
import { Route, Vehicle } from './Vehicle.js';
import { Network } from './LaneManager.js';

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
    const ramp = 1 + (this.level.demandRamp || 0) * (Math.max(0, this.sim.scheduleTime) / 60);
    const amp = this.level.demandWave || 0;
    const phase = this.wavePhase.get(key) || 0;
    const wave = 1 + amp * Math.sin((t / 55) * Math.PI * 2 + phase) * 0.8 + amp * 0.4 * Math.sin((t / 23) * Math.PI * 2 + phase * 1.7);
    return Math.max(0, (perMin / 60) * ramp * Math.max(0.2, wave) * this.sim.env.demandFactor);
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
      if (q.length && this.trySpawn(lane, q[0])) q.shift();
    }
  }

  /** Next movement for a vehicle of `type` arriving at the end of `lane`. */
  chooseMovement(lane, type, usedUturn = false) {
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
    return this.rng.weighted(w);
  }

  buildRoute(firstLane, firstMove, type = 'car') {
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
      if (lane.endInt) move = this.chooseMovement(lane, type, usedUturn);
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
    if (dedicated.length && (!general.length || rng.chance(0.85))) return dedicated.length > 1 ? rng.pick(dedicated) : dedicated[0];
    if (general.length === 1) return general[0];
    if (HEAVY_TYPES.has(type)) {
      const curb = general[general.length - 1];
      if (rng.chance(0.8)) return curb;
      const others = general.slice(0, -1);
      return others.length > 1 ? rng.pick(others) : others[0];
    }
    return rng.pick(general);
  }

  createArrival(key, emergency = false) {
    const lanes = this.sim.network.approachLanesByKey(key);
    if (!lanes.length) return;
    const rng = this.rng;
    const type = emergency ? (rng.chance(0.65) ? 'ambulance' : 'firetruck') : rng.weighted(this.level.mix);
    const personality = emergency ? 'patient' : rng.weighted(this.level.personalities);
    const turns = this.level.turns || { left: 0.1, right: 0.1 };
    const avail = new Set();
    for (const l of lanes) if (l.allows(type)) for (const m of Object.keys(l.connectors)) if (m !== 'uturn' && l.connectors[m].toLane.allows(type)) avail.add(m);
    let move;
    if (emergency) move = avail.has('straight') ? 'straight' : [...avail][0];
    else {
      const w = {};
      if (avail.has('straight')) w.straight = Math.max(0, 1 - turns.left - turns.right);
      const sample = (m) => lanes.find((l) => l.connectors[m])?.connectors[m];
      if (avail.has('left')) w.left = turns.left * narrowTurn(type, sample('left'));
      if (avail.has('right')) w.right = turns.right * narrowTurn(type, sample('right'));
      const keys = Object.keys(w);
      if (keys.length && !keys.some((k) => w[k] > 0)) for (const k of keys) w[k] = 1;
      move = keys.length ? rng.weighted(w) : 'straight';
    }
    const lane = this.chooseLane(lanes, type, move);
    if (!lane) return;
    const route = this.buildRoute(lane, move, type);
    const item = { type, personality, route, emergency };
    if (emergency) {
      this.sim.stats.emergencyArrivals++;
      this.sim.stats.emergencyArrivalTimes.push(this.sim.scheduleTime);
      this.pending.get(lane).unshift(item);
      this.sim.notify('EMERGENCY', `${VEHICLE_TYPES[type].label.toUpperCase()} APPROACHING`);
    } else {
      this.pending.get(lane).push(item);
    }
    this.arrivals.push(this.sim.time);
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
      color: this.rng.pick(spec.colors),
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
    if (!item.emergency && LOADING_TYPES.has(item.type) && this.rng.chance(this.level.loadingStops || 0)) {
      const exit = item.route.exitLane;
      // Curbside stop on general roads; buses also stop on their own busway (median stations).
      const stopLane = (exit.isCurb && exit.type === 'general') || (exit.type === 'bus' && item.type === 'bus');
      if (stopLane && exit.length > LOADING_ZONE_S + 10) {
        const start = item.route.startOf(exit);
        veh.loading = { s: start + LOADING_ZONE_S, duration: this.rng.range(3, 8), state: 'pending', timer: 0 };
      }
    }
    sim.addVehicle(veh, lane);
    return true;
  }
}
