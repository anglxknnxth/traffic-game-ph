// Riders for jeepneys, buses, e-jeeps, multicabs and tricycles. DOM-free.
//
// Every jeepney loading zone (the curb exit lane of an external road) has a queue of people that
// grows with the hour: thin at night, long at the AM and PM peaks, longest on the direction the
// commute is heading (Environment.demandFor). Up to VISIBLE of them stand on the sidewalk as real
// pedestrians (PedestrianManager 'ride' state).
//
// When a PUV pulls into the zone (VehicleAI sets loading.state = 'stopped'), riders get off first,
// then the queue boards up to the vehicle's capacity (plus a few hanging on the back at rush hour:
// sabit). The stop lasts as long as the people take, so a long queue holds up the curb lane.
// A full vehicle often skips the stop altogether (decided at spawn: VehicleSpawner).

import { CAPACITY, SABIT } from '../data/vehicles.js';
import { LOADING_ZONE_S, OPPOSITE } from '../data/config.js';
import { Rng } from '../utils/math.js';

const VISIBLE = 14; // queued riders drawn per stop
const COMFORT = 25; // a queue longer than this costs points
const SAYINGS = ['Sakay na!', 'Isa pa, isa pa!', 'Kasya pa!', 'Lalarga na!', 'Usog lang po!'];

export class Passengers {
  constructor(sim) {
    this.sim = sim;
    this.rng = new Rng(((sim.seed ?? 1) ^ 0x51ed270b) >>> 0);
    this.rate = (sim.level.riders ?? 0.14) * Math.min(1, (sim.level.loadingStops || 0) * 2); // riders/s per stop at base demand
    this.stops = new Map(); // `${node}:${arm}` -> stop
    this.delivered = 0;
    if (!this.rate) return;
    for (const lane of sim.network.exitLanes) {
      const I = lane.startInt;
      const A = I?.arms[lane.startArm];
      if (!A || A.type !== 'external' || !lane.isCurb || lane.type !== 'general' || lane.length < LOADING_ZONE_S + 10) continue;
      const key = `${I.id}:${lane.startArm}`;
      if (this.stops.has(key)) continue;
      this.stops.set(key, {
        key,
        I,
        arm: lane.startArm,
        // the arrivals feeding this exit come from the opposite approach
        demandKey: `${I.id}:${OPPOSITE[lane.startArm]}`,
        u: A.exitStop + LOADING_ZONE_S - 6.5, // middle of the painted zone
        waiting: this.rng.int(2, 8),
        peds: [],
        acc: 0,
      });
    }
  }

  stopFor(lane) {
    return lane?.startInt ? this.stops.get(`${lane.startInt.id}:${lane.startArm}`) : null;
  }

  /** Riders aboard a newly spawned PUV: fuller at rush hour. */
  fill(v) {
    const cap = CAPACITY[v.type];
    if (!cap) return;
    v.capacity = cap;
    const rush = this.sim.env.rushIntensity;
    const gas = this.sim.scenarios?.gas ? 0.15 : 0; // fuel prices up: more people ride
    v.passengers = Math.min(cap, Math.round(cap * this.rng.range(0.25 + gas, 0.7 + 0.3 * rush + gas)));
    v.sabit = 0;
  }

  update(dt) {
    if (!this.stops.size) return;
    const sim = this.sim;
    const peds = sim.peds;
    let over = 0;
    let longest = 0;
    for (const st of this.stops.values()) {
      // Queue growth: a Poisson trickle scaled by the hour and direction.
      st.acc += dt * this.rate * sim.env.demandFor(st.demandKey) * (sim.codingMul ?? 1) ** -0.5 * (sim.scenarios?.gas ? 1.3 : 1);
      while (st.acc >= 1) {
        st.acc -= 1;
        if (st.waiting < 80) st.waiting++;
      }
      // People shown on the sidewalk follow the count.
      st.peds = st.peds.filter((p) => !p.gone);
      if (st.peds.length < Math.min(VISIBLE, st.waiting)) {
        const p = peds.addRider(st.I, st.arm, st.u + this.rng.range(-6, 6));
        if (p) st.peds.push(p);
      }
      if (st.waiting > COMFORT) over += st.waiting - COMFORT;
      if (st.waiting > longest) longest = st.waiting;
    }
    sim.scoring.stopQueue?.(dt, over);
    if (longest > 40) sim.notify('LONG_QUEUE', '🧍🧍🧍 MAHABA NA ANG PILA SA SAKAYAN · let the jeepneys through!', 'warn');

    // Boarding at the zone: once per stop, right when the vehicle has come to rest.
    for (const v of sim.vehicles) {
      const L = v.loading;
      if (!L || L.state !== 'stopped' || L.pax || !v.capacity) continue;
      const st = this.stopFor(v.route.exitLane);
      L.pax = this._board(v, st);
      L.timer = L.duration = Math.min(22, Math.max(2, 1.5 + 0.55 * (L.pax.off + L.pax.on) * (sim.boardingMul ?? 1)));
    }
  }

  _board(v, st) {
    const rng = this.rng;
    const sim = this.sim;
    const off = v.type === 'tricycle' ? v.passengers : Math.round(v.passengers * rng.range(0.15, 0.45));
    v.passengers -= off;
    const sabitMax = Math.round((SABIT[v.type] || 0) * sim.env.rushIntensity);
    const room = Math.max(0, v.capacity + sabitMax - v.passengers);
    const on = st ? Math.min(room, st.waiting) : 0;
    v.passengers += on;
    v.sabit = Math.max(0, v.passengers - v.capacity);
    if (st) {
      st.waiting -= on;
      // the nearest visible riders climb aboard
      for (let i = 0; i < on && st.peds.length; i++) st.peds.pop().gone = true;
      if (off) sim.peds.dropOff(st.I, st.arm, st.u, Math.min(off, 6));
    }
    if (off) this._deliver(off);
    v.say = v.passengers >= v.capacity ? 'PUNO NA!' : on ? rng.pick(SAYINGS) : 'Para po!';
    v.sayTimer = 2;
    return { off, on };
  }

  _deliver(n) {
    this.delivered += n;
    this.sim.stats.passengers = this.delivered;
    this.sim.scoring.onPassengers?.(n * 0.4);
  }

  /** A PUV left the map: whoever is still aboard has arrived. */
  onDespawn(v) {
    if (v.passengers) this._deliver(v.passengers);
  }
}
