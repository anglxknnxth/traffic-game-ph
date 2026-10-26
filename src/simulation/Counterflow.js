// Counterflow ("singit sa kontra"), on undivided roads only.
//
//   pasaway   — an aggressive motorcycle or tricycle (sometimes a private car or a jeepney) stuck in
//               a long queue swings into the oncoming lane, overtakes a few vehicles and cuts back in
//   emergency — an ambulance or fire truck stuck behind a queue runs up the oncoming lane to the
//               junction; oncoming drivers stop and pull over
//   contraflow— the player cones off the oncoming inner lane (enforcer tool): queued drivers may use
//               it legally to get to the front faster
//
// How it stays collision-free: the vehicle never leaves its own lane in the simulation. It keeps its
// route coordinate and only slides sideways (a lateral offset) into the oncoming lane, so every
// move, sideways ones included, passes the collision gate. Before it swings out it reserves the
// stretch of the oncoming lane it will use as a blockage, and only when no oncoming vehicle is in
// that stretch or too close to stop before it. It also picks its way back in first: the vehicle it
// will end up in front of (the follower) sees it as its leader as soon as it is ahead, so the gap
// stays open; it slides back when the gap beside it is clear. A HULI! click, or 15 s stuck out
// there, sends it back at once (the vehicle beside or behind it holds).

import { laneSAt } from './PedestrianManager.js';
import { makeObb } from '../utils/math.js';
import { LaneChanger } from './LaneChange.js';

const MOTO = new Set(['motorcycle', 'tricycle']);
const PRIVATE = new Set(['car', 'suv', 'pickup', 'van', 'jeepney', 'multicab']);
const LAT_SPEED = 1.7; // m/s sideways
const STUCK_LIMIT = 15; // s out there before it is made to come back
const STOP_CLEAR = 18; // a pasaway gets back in at least this far before the stop line
const CHECK_EVERY = 30; // steps between decisions per vehicle

export const COUNTERFLOW_DEFAULTS = Object.freeze({ moto: 0, car: 0, minWait: 10, minQueue: 4, emergency: false });

export class CounterflowManager {
  constructor(sim) {
    this.sim = sim;
    this.cfg = { ...COUNTERFLOW_DEFAULTS, ...(sim.level.counterflow || {}) };
    this.active = [];
    this.zones = [];
    this.tick = 0;
    this.count = 0;
    this.cooldownUntil = -Infinity;
  }

  /** The oncoming lane a vehicle on `lane` could use, or null (divided road, wrong lane, ...). */
  oppOf(lane) {
    if (lane._opp !== undefined) return lane._opp;
    let opp = null;
    if (lane.kind === 'lane' && (lane.role === 'approach' || lane.role === 'link') && lane.laneIndex === 0 && lane.type === 'general' && lane.endInt) {
      const I = lane.endInt;
      const A = I.arms[lane.endArm];
      const o = I.exitLanes[lane.endArm]?.[0];
      if (I.layer === 0 && A.median < 0.3 && o && o.type === 'general' && !I.def.underpass) opp = o;
    }
    lane._opp = opp;
    return opp;
  }

  /** Coordinate on the oncoming lane level with coordinate s on `lane`. */
  oppS(lane, opp, s) {
    const u = lane.cReversed ? lane.cu1 - s : lane.cu0 + s;
    return laneSAt(opp, lane.center, u);
  }

  /** Is the stretch [sa, sb] of the oncoming lane free, with everyone short of it able to stop? */
  _windowClear(opp, sa, sb, margin = 1.5) {
    for (const o of opp.vehicles) {
      const front = o.localS + o.hl;
      const rear = o.localS - o.hl;
      if (rear < sb + 1 && front > sa - 1) return false;
      if (front <= sa) {
        const stop = (o.v * o.v) / (2 * o.spec.decel) + margin;
        if (front + stop > sa) return false;
      }
    }
    // Vehicles turning into the oncoming lane from the junction right now
    for (const c of opp.committed) if (c.reservations.size && c.v > 1 && sa < 12) return false;
    return true;
  }

  get enabled() {
    return this.cfg.moto > 0 || this.cfg.car > 0 || this.cfg.emergency || this.zones.length > 0;
  }

  update(dt) {
    this.tick++;
    const sim = this.sim;
    if (this.cfg.moto > 0 || this.cfg.car > 0 || this.cfg.emergency || this.zones.length) {
      for (const v of sim.vehicles) {
        if (v.cf || (this.tick + v.seq) % CHECK_EVERY !== 0) continue;
        if (v.emergency) this._maybeEmergency(v);
        else if (!v.cfDone) this._maybePasaway(v);
      }
    }
    for (const z of this.zones) this._updateZone(z, dt);
    if (this.zones.some((z) => z.state === 'gone')) this.zones = this.zones.filter((z) => z.state !== 'gone');
    for (const v of this.active) this._step(v, dt);
    this.active = this.active.filter((v) => v.cf);
  }

  // ------------------------------------------------------------------ deciding
  _maybePasaway(v) {
    const sim = this.sim;
    if (v.lc || v.reservations.size || v.loading?.state === 'stopped') return;
    const lane = v.segment;
    const opp = this.oppOf(lane);
    if (!opp) return;
    const moto = MOTO.has(v.type);
    const zone = this.zones.find((z) => z.lane === lane && z.state === 'open');
    if (!zone) {
      if (!moto && !PRIVATE.has(v.type)) return;
      if (moto ? v.personality === 'patient' || v.personality === 'cautious' : v.personality !== 'aggressive') return;
      // Crawling in a queue for a while (cars give it longer before they try)
      const minWait = moto ? this.cfg.minWait : Math.max(25, this.cfg.minWait);
      if (v.v > 2.5 || v.waitTime < minWait || sim.time < (v.cfNextTry || 0)) return;
      if (sim.enforcement?.near(lane.endInt)) return; // nobody tries it in front of an enforcer
      // One at a time on a stretch of road
      if (this.active.some((o) => o.cf && o.cf.opp === opp)) return;
      v.cfNextTry = sim.time + 8;
      if (!sim.rng.chance(moto ? this.cfg.moto : this.cfg.car)) return;
    } else if (v.v > 2 || v.localS < zone.s0 || v.localS > zone.s1 - 10 || !sim.rng.chance(0.35)) return;
    this._plan(v, lane, opp, moto ? 6 : 3, zone);
  }

  /** Pick the vehicle to get in front of, check the oncoming lane, and swing out. */
  _plan(v, lane, opp, maxK, zone = null) {
    const list = lane.vehicles;
    const idx = list.indexOf(v);
    const ahead = list.slice(idx + 1).filter((o) => !o.cf);
    if (ahead.length < (zone ? 1 : this.cfg.minQueue)) return false;
    const limit = zone ? zone.s1 - 2 : lane.length - STOP_CLEAR;
    // A real gap in the queue ahead, between X (who will be behind us) and Y; in a contraflow lane
    // drivers simply run up to its end and cut in where they can.
    for (let k = Math.min(maxK, ahead.length); k >= 1; k--) {
      const X = ahead[k - 1];
      const Y = ahead[k] || null;
      const gapRear = X.localS + X.hl + 1.0;
      const gapFront = Math.min(limit, Y ? Y.localS - Y.hl - 1.0 : limit);
      let target = gapRear + v.spec.length + 0.3; // our front once we are just ahead of X
      if (target > gapFront) {
        if (!zone) continue;
        target = Math.min(limit, Math.max(target, gapFront));
      }
      if (target > limit) continue;
      const sa = this.oppS(lane, opp, target + 3);
      const sb = this.oppS(lane, opp, v.localS - v.hl - 1);
      if (!zone && !this._windowClear(opp, Math.min(sa, sb), Math.max(sa, sb))) return false;
      this._start(v, lane, opp, { target, follower: X, legal: !!zone, zone, sa: Math.min(sa, sb), limit });
      return true;
    }
    return false;
  }

  _start(v, lane, opp, { target, follower = null, legal = false, zone = null, sa, emergency = false, limit = target }) {
    const sim = this.sim;
    const full = -(lane.offset + opp.offset); // to the left of travel
    const block = zone ? null : { id: `cf:${v.id}`, kind: 'cf', label: '', laneObjs: [opp], s: Math.max(0.5, sa), active: true, done: false, start: -Infinity, end: Infinity };
    if (block) sim.blockages.push(block);
    v.cf = { lane, opp, phase: 'out', full, target, follower, legal, zone, block, t: 0, emergency, forced: false, limit };
    v.cfOff = 0;
    v.cfYaw = 0;
    this.active.push(v);
    if (zone) zone.users.add(v);
    if (!legal && !emergency) {
      this.count++;
      sim.stats.counterflows = (sim.stats.counterflows || 0) + 1;
      v.violation = { kind: 'counterflow', until: Infinity };
      sim.notify(`CF_${lane.id}`, `⚠ COUNTERFLOW sa ${sim.network.roadName(lane.endInt, lane.endArm) || 'kalsada'}! · click it: HULI!`, 'warn');
    }
    if (emergency) sim.notify(`CFE_${v.id}`, `${v.spec.label.toUpperCase()} COUNTERFLOW · tabi muna!`, 'warn');
  }

  /** Sirens stuck behind a queue: up the oncoming lane to the stop line. */
  _maybeEmergency(v) {
    if (!this.cfg.emergency || v.emergencyDone || v.lc) return;
    const lane = v.segment;
    const opp = this.oppOf(lane);
    if (!opp) return;
    const lead = this.sim.findLeader(v, 40);
    if (!lead || lead.vehicle.v > 1 || lead.gap > 25 || v.stoppedTime < 4) return;
    const target = lane.length - 0.3;
    if (target - (v.localS + v.hl) > 140) return;
    const sa = this.oppS(lane, opp, target + 2);
    const sb = this.oppS(lane, opp, v.localS - v.hl - 1);
    if (!this._windowClear(opp, Math.min(sa, sb), Math.max(sa, sb), 3)) return;
    this._start(v, lane, opp, { target, sa: Math.min(sa, sb), emergency: true });
  }

  // ------------------------------------------------------------------ moving
  /** Try to slide sideways by d; the collision gate decides. */
  _slide(v, d, dt) {
    const sim = this.sim;
    const old = v.cfOff;
    v.cfOff = old + d;
    const tmp = this._tmp || (this._tmp = makeObb());
    v.poseAt(v.s, tmp);
    const nb = sim.collision.neighbors(v, Math.abs(d) + 0.5);
    if (!sim.collision.isClear(tmp, nb)) {
      v.cfOff = old;
      return false;
    }
    v.updatePose();
    return true;
  }

  /** Would the vehicle fit back in its own lane right where it is? */
  _fitsBack(v) {
    const sim = this.sim;
    const old = v.cfOff;
    v.cfOff = 0;
    const tmp = this._tmp2 || (this._tmp2 = makeObb());
    v.poseAt(v.s, tmp);
    v.cfOff = old;
    return sim.collision.isClear(tmp, sim.collision.neighbors(v, Math.abs(old) + 0.5));
  }

  _step(v, dt) {
    const sim = this.sim;
    const cf = v.cf;
    if (!cf) return;
    cf.t += dt;
    // Left its lane (crossed into the junction): emergency vehicles ease back over the box, once
    // the whole body is past the stop line (clear of the queue it came up beside).
    if (v.segment !== cf.lane) {
      const e = v.route.entries[v.segIdx];
      if (!cf.decay && v.s - v.hl > e.start + 1) cf.decay = { s0: v.s, L: 16, off0: v.cfOff };
      if (cf.decay && v.s > cf.decay.s0 + cf.decay.L) this._finish(v);
      return;
    }
    const step = LAT_SPEED * dt;
    if (cf.phase === 'out') {
      const d = Math.max(-step, cf.full - v.cfOff);
      if (Math.abs(cf.full - v.cfOff) < 0.02) cf.phase = 'run';
      else this._slide(v, d, dt);
      return;
    }
    // Pull over: oncoming drivers near a siren in their lane move to the curb (drawing only).
    if (cf.emergency) {
      for (const o of cf.opp.vehicles) o.pullTo = 0.9;
      return;
    }
    const passed = !cf.follower || cf.follower.segment !== cf.lane || v.localS - v.hl >= cf.follower.localS + cf.follower.hl + 0.6;
    // Still beside someone in our own lane (the queue crept up): get just ahead of them, as far as
    // the reserved stretch allows.
    if (cf.phase === 'run') {
      for (const o of cf.lane.vehicles) {
        if (o === v || o.cf) continue;
        if (Math.abs(o.localS - v.localS) < o.hl + v.hl + 0.9 && o.localS >= v.localS - v.hl) {
          const want = Math.min(cf.limit, o.localS + o.hl + 1.2 + v.spec.length);
          if (want > cf.target + 0.05) this._extend(v, want);
        }
      }
    }
    // Slide back only once the whole space beside us in our own lane is clear.
    if (cf.phase === 'run' && (passed || cf.forced) && this._fitsBack(v)) cf.phase = 'in';
    if (cf.phase === 'in') {
      const d = Math.min(step, -v.cfOff);
      if (v.cfOff > -0.03) this._finish(v);
      else this._slide(v, d, dt);
    }
    // Out there too long (or caught): come back now.
    if (!cf.forced && !cf.legal && cf.t > STUCK_LIMIT) this.forceReturn(v);
    if (!cf.legal && cf.t > 6) {
      const blocked = cf.opp.vehicles.some((o) => o.v < 0.3 && o.localS + o.hl > cf.block.s - 15 && o.localS < cf.block.s);
      if (blocked) sim.scoring.onCounterflowBlock?.(dt);
    }
  }

  /** Move the target further on, if the oncoming lane is still clear that far (the window grows). */
  _extend(v, target) {
    const cf = v.cf;
    if (cf.zone || !cf.block) {
      cf.target = target;
      return;
    }
    const sa = Math.min(this.oppS(cf.lane, cf.opp, target + 3), cf.block.s);
    if (sa < cf.block.s - 0.05 && !this._windowClear(cf.opp, sa, cf.block.s)) return;
    cf.block.s = Math.max(0.5, sa);
    cf.target = target;
  }

  /** HULI!, or stuck too long: stop advancing and slide back in beside the nearest vehicle behind. */
  forceReturn(v) {
    const cf = v.cf;
    if (!cf || cf.emergency) return;
    cf.forced = true;
    cf.target = v.localS + v.hl; // stop here (or just past whoever is beside us, see _step)
    cf.follower = null;
    if (cf.phase === 'out') cf.phase = 'run';
    v.cfDone = true;
  }

  _finish(v) {
    const cf = v.cf;
    const sim = this.sim;
    if (cf.block) {
      cf.block.active = false;
      cf.block.done = true;
      const k = sim.blockages.indexOf(cf.block);
      if (k >= 0) sim.blockages.splice(k, 1);
    }
    if (cf.zone) cf.zone.users.delete(v);
    v.cf = null;
    v.cfOff = 0;
    v.cfYaw = 0;
    v.cfDone = true;
    if (v.violation?.kind === 'counterflow') v.violation = { kind: 'counterflow', until: sim.time + 6 };
    v.updatePose();
  }

  /** Front limit (route coordinate) for a vehicle out in the oncoming lane, or null. */
  frontLimit(v) {
    const cf = v.cf;
    if (!cf || cf.emergency || v.segment !== cf.lane) return null;
    return v.route.entries[v.segIdx].start + cf.target;
  }

  // ------------------------------------------------------------------ contraflow zones (player tool)
  /**
   * Cone off the oncoming inner lane beside `lane` for `secs`: from the stop line back `length` m.
   * Returns the zone, or a reason string when it cannot be done here.
   */
  openZone(lane, secs = 60, length = 80) {
    const sim = this.sim;
    const opp = this.oppOf(lane);
    if (!opp) return 'Only on undivided roads (no median), next to the inner lane';
    if (this.zones.some((z) => z.lane === lane)) return 'Already coned off';
    if (sim.time < this.cooldownUntil) return `Cones are busy: ${Math.ceil(this.cooldownUntil - sim.time)}s`;
    const s1 = lane.length - STOP_CLEAR + 4;
    const s0 = Math.max(4, s1 - length);
    if (s1 - s0 < 30) return 'Road too short for a contraflow lane';
    const sa = Math.min(this.oppS(lane, opp, s1 + 3), this.oppS(lane, opp, s0));
    const block = { id: `cz:${lane.id}`, kind: 'cf', label: '', laneObjs: [opp], s: Math.max(0.5, sa), active: true, done: false, start: -Infinity, end: Infinity };
    sim.blockages.push(block);
    // Cones along the centre line every 6 m, with a taper at each end
    const cones = [];
    const g = lane.center;
    const oppLat = opp.center === g ? opp.cOffset : -opp.cOffset; // centre of the borrowed lane
    const at = (s, k) => {
      const u = lane.cReversed ? lane.cu1 - s : lane.cu0 + s;
      // taper: k in 0..1 moves the cone from the centre line across the borrowed lane
      const p = g.point(u, oppLat * k);
      return { x: p.x, y: p.y };
    };
    for (let i = 0; i < 4; i++) cones.push(at(s0 - 12 + i * 3, 1 - i / 4));
    for (let s = s0; s <= s1; s += 6) cones.push(at(s, 0));
    for (let i = 1; i <= 4; i++) cones.push(at(s1 + i * 3, i / 4));
    const zone = { lane, opp, s0, s1, block, cones, placed: 0, placeT: 0, state: 'placing', until: sim.time + secs, users: new Set() };
    this.zones.push(zone);
    sim.notify(`CZ_${lane.id}`, `🚧 CONTRAFLOW sa ${sim.network.roadName(lane.endInt, lane.endArm) || 'kalsada'} · cones going up`, 'info');
    return zone;
  }

  _updateZone(z, dt) {
    const sim = this.sim;
    if (z.state === 'placing') {
      z.placeT += dt;
      while (z.placeT >= 0.15 && z.placed < z.cones.length) {
        z.placeT -= 0.15;
        z.placed++;
      }
      const s0o = Math.min(this.oppS(z.lane, z.opp, z.s0), this.oppS(z.lane, z.opp, z.s1 + 3));
      const s1o = Math.max(this.oppS(z.lane, z.opp, z.s0), this.oppS(z.lane, z.opp, z.s1 + 3));
      const empty = !z.opp.vehicles.some((o) => o.localS + o.hl > s0o && o.localS - o.hl < s1o);
      if (z.placed >= z.cones.length && empty) {
        z.state = 'open';
        sim.notify(`CZO_${z.lane.id}`, '🚧 CONTRAFLOW LANE OPEN', 'good');
      }
    } else if (z.state === 'open') {
      if (sim.time >= z.until) z.state = 'closing';
    } else if (z.state === 'closing') {
      if (!z.users.size) {
        z.placeT += dt;
        while (z.placeT >= 0.12 && z.placed > 0) {
          z.placeT -= 0.12;
          z.placed--;
        }
        if (z.placed <= 0) {
          z.block.active = false;
          const k = sim.blockages.indexOf(z.block);
          if (k >= 0) sim.blockages.splice(k, 1);
          z.state = 'gone';
          this.cooldownUntil = sim.time + 30;
          sim.notify(`CZC_${z.lane.id}`, 'Contraflow closed · cones picked up', 'info');
        }
      }
    }
  }

  /** Neighbouring lanes of a lane (exposed for the HUD tool hit-test). */
  static neighbours(lane) {
    return LaneChanger.neighbours(lane);
  }
}
