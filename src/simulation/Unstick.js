// Gate stalemates: two bodies at exactly the minimum gap where any move either makes would close it
// (typically a bus or truck swinging its tail through a turn, and the car that stopped right beside
// its lane at the line). The collision gate never lets a gap shrink, so neither could ever move.
//
//   swing room — drivers approaching the line stop short of where a vehicle crossing the box ahead
//                is about to swing, instead of tucking in beside it (see VehicleAI)
//   atras      — when it still happens: after a while, the one waiting on its lane backs up a metre
//                or two ("atras, atras!") and holds there until the other is through

import { makeObb, obbOverlap, obbDistance } from '../utils/math.js';
import { MIN_BUFFER } from '../data/config.js';

const SWING_AHEAD = 10; // m of a box vehicle's way on that the approach keeps clear of
const SWING_STEP = 2; // m between its sampled poses
const SWING_PAD = 0.4; // m on top of the minimum gap
const SWING_REACH = 22; // m before the stop line where drivers start looking
const CHECK = 10; // steps between swing-room checks per vehicle
const SWING_LONG = 7; // m: buses, trucks and the like
const SWING_PATIENCE = 8; // s held back for someone's swing before giving up on it
const STALE_AFTER = 10; // s pinned by the gate (and not by any rule) before someone backs up
const BACK = 1.6; // m backed up (at most)
const BACK_MIN = 0.3; // m: less than this is not worth it
const BACK_SPEED = 1.0; // m/s
const HOLD = 6; // s it then waits before moving up again

export class Unsticker {
  constructor(sim) {
    this.sim = sim;
    this._poses = new Map(); // box vehicle -> swept poses, for this step
    this._posesAt = -1;
    this._tmp = makeObb();
    this._tmp2 = makeObb();
    this.backups = 0;
  }

  // ---------------------------------------------------------------- swing room
  /** Swept poses of o over the next SWING_AHEAD m of its way (cached for the step). */
  _swept(o) {
    const sim = this.sim;
    if (this._posesAt !== sim.time) {
      this._poses.clear();
      this._posesAt = sim.time;
    }
    let list = this._poses.get(o);
    if (list) return list;
    list = [];
    const end = o.route.length - o.hl;
    for (let k = SWING_STEP; k <= SWING_AHEAD && o.s + k <= end; k += SWING_STEP) list.push(o.poseAt(o.s + k, makeObb()));
    this._poses.set(o, list);
    return list;
  }

  /**
   * Free distance before v's front runs into the swept way of someone crossing (or about to cross)
   * the junction ahead, up to the stop line; Infinity when there is none. Rechecked every few steps,
   * in between carried on by the distance travelled.
   */
  swingRoom(v) {
    const sim = this.sim;
    const c = v._swing;
    if (c && sim.time - c.t < (CHECK - 0.5) * (1 / 60)) return c.room === Infinity ? Infinity : c.room - (v.s - c.s);
    const room = this._swingRoom(v);
    v._swing = { t: sim.time, s: v.s, room };
    return room;
  }

  _swingRoom(v) {
    const sim = this.sim;
    if (v.segment.kind !== 'lane' || v.cf || v.emergency) return Infinity;
    const ce = v.nextConnEntry();
    if (!ce || ce.seg.under) return Infinity;
    const toLine = ce.start - v.front;
    if (toLine > SWING_REACH || toLine < 0.05) return Infinity;
    const I = ce.seg.intersection;
    let others = null;
    // Held back like this for a while already: whatever it waits for is not coming (no new deadlock).
    if ((v.swingWait || 0) > SWING_PATIENCE) return Infinity;
    for (const o of sim.collision.neighbors(v, toLine + 2)) {
      if (o === v || Math.abs((o.layer || 0) - (v.layer || 0)) >= 1) continue;
      // Long vehicles turning, on their way: the ones whose tail swings wide.
      if (o.spec.length < SWING_LONG || o.v < 0.3) continue;
      const seg = o.segment.kind === 'connector' ? o.segment : o.reservations.has(I.id) ? o.nextConnEntry()?.seg : null;
      if (!seg || seg.intersection !== I || (seg.movement !== 'left' && seg.movement !== 'right')) continue;
      // (already inside our envelope: that is the gate's business)
      if (obbOverlap(v.obb, o.obb, MIN_BUFFER)) continue;
      (others ||= []).push(o);
    }
    if (!others) return Infinity;
    const tmp = this._tmp;
    const pad = MIN_BUFFER + SWING_PAD;
    let prev = 0;
    for (const d of [0.5, 1.5, 3, 5, 8, 12, 17, 22]) {
      const dd = Math.min(d, toLine);
      v.poseAt(v.s + dd, tmp);
      for (const o of others) {
        // only where it is going, not where it is now (a vehicle that already sits there is a leader)
        for (const p of this._swept(o)) if (obbOverlap(tmp, p, pad)) return prev;
      }
      prev = dd;
      if (dd >= toLine) break;
    }
    return Infinity;
  }

  // ---------------------------------------------------------------- atras
  /** Every metrics tick: find vehicles pinned by the gate alone, and back up whoever pins them. */
  update(dt) {
    const sim = this.sim;
    for (const v of sim.vehicles) {
      if (v.backing) continue;
      if (!this._pinned(v)) {
        v.gateStuck = 0;
        continue;
      }
      v.gateStuck = (v.gateStuck || 0) + dt;
      if (v.gateStuck < STALE_AFTER) continue;
      const o = this._pinner(v);
      if (o && this._startBackup(o)) v.gateStuck = 0;
    }
  }

  /** Stopped, nothing in the rules holding it, but the gate will not let it move at all. */
  _pinned(v) {
    const sim = this.sim;
    if (v.v > 0.05 || v.cf || v.loading?.state === 'stopped' || v.cornerStop?.state === 'stopped') return false;
    if (v.constraint !== 'free' && v.constraint !== 'probe' && v.constraint !== 'leader' && v.constraint !== 'waiting') return false;
    if (sim.hardLimit(v) - v.front < 0.3) return false;
    const lead = sim.findLeader(v, 4);
    if (lead && lead.gap < 1.2 && lead.vehicle.v < 0.05) return false; // just queued
    return sim.collision.safeAdvance(v, 0.3) < 0.01;
  }

  /** A stationary vehicle on its lane whose body the gate keeps v from closing on. */
  _pinner(v) {
    const sim = this.sim;
    const tmp = this._tmp2;
    v.poseAt(v.s + 0.17, tmp);
    let best = null;
    for (const o of sim.collision.neighbors(v, 0.5)) {
      if (o.segment.kind !== 'lane' || o.cf || o.emergency || o.v > 0.05 || o.backing) continue;
      if (o.loading?.state === 'stopped') continue;
      const dNew = obbDistance(tmp, o.obb);
      if (dNew >= MIN_BUFFER || dNew >= obbDistance(v.obb, o.obb) - 1e-9) continue;
      if (!best || dNew < best.d) best = { o, d: dNew };
    }
    return best?.o || null;
  }

  _startBackup(o) {
    // As far as there is room behind (up to BACK): never out of the lane it is on, and clear of
    // whoever is queued behind it. A little is often enough to let a tail swing past.
    const sim = this.sim;
    const tmp = this._tmp;
    const nb = sim.collision.neighbors(o, BACK + 1.2);
    let room = 0;
    for (const d of [BACK, 1.2, 0.8, 0.5, BACK_MIN]) {
      if (o.localS - o.hl - d < 0.5) continue;
      o.poseAt(o.s - d, tmp);
      if (sim.collision.isClear(tmp, nb)) {
        room = d;
        break;
      }
    }
    if (!room) return false;
    o.backing = { left: room };
    o.say = 'ATRAS!';
    o.sayTimer = 1.8;
    this.backups++;
    this.sim.stats.backups = (this.sim.stats.backups || 0) + 1;
    return true;
  }

  /** Each step, before the others move: those backing up go back a little more (through the gate). */
  step(dt) {
    const sim = this.sim;
    for (const o of sim.vehicles) {
      const bk = o.backing;
      if (!bk) continue;
      if (bk.hold !== undefined) {
        if (sim.time >= bk.hold) o.backing = null;
        continue;
      }
      let ds = Math.min(bk.left, BACK_SPEED * dt, o.localS - o.hl - 0.5);
      const tmp = this._tmp;
      if (ds > 1e-4) {
        o.poseAt(o.s - ds, tmp);
        if (!sim.collision.isClear(tmp, sim.collision.neighbors(o, ds + 1.2))) ds = 0;
      } else ds = 0;
      if (ds > 0) {
        o.s -= ds;
        o.localS -= ds;
        o.v = 0;
        o.updatePose();
        bk.left -= ds;
      }
      if (ds === 0 || bk.left <= 1e-4) {
        bk.hold = sim.time + HOLD;
        bk.front = o.front;
      }
    }
  }

  /** Route coordinate a vehicle that just backed up holds its front at (null: none). */
  holdLimit(v) {
    const bk = v.backing;
    if (!bk) return null;
    return bk.hold !== undefined ? bk.front : v.front;
  }
}
