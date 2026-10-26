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
// route coordinate and only moves sideways (a lateral offset) into the oncoming lane, so every
// move, sideways ones included, passes the collision gate. Before it swings out it reserves the
// stretch of the oncoming lane it will use as a blockage, and only when no oncoming vehicle is in
// that stretch or too close to stop before it. It also picks its way back in first: the vehicle it
// will end up in front of (the follower) sees it as its leader as soon as it is ahead, so the gap
// stays open. A HULI! click, or 15 s stuck out there, sends it back (the vehicle behind it holds).
//
// Swinging out and back in looks like a normal lane change: the indicator blinks first, then the
// offset eases across over the next few metres of forward travel (a "sweep", see Vehicle._cfOff)
// and the nose follows the curve. Only a vehicle stuck halfway falls back to sliding sideways.
// When the player lifts the cones, those still well short of the stop line zip back in: each waits
// beside the queue for a gap, never right behind another one that just came back in.

import { laneSAt } from './PedestrianManager.js';
import { makeObb } from '../utils/math.js';
import { LaneChanger } from './LaneChange.js';
import { Network } from './LaneManager.js';
import { Route } from './Vehicle.js';
import { VEHICLE_TYPES } from '../data/vehicles.js';

const MOTO = new Set(['motorcycle', 'tricycle']);
const PRIVATE = new Set(['car', 'suv', 'pickup', 'van', 'jeepney', 'multicab']);
const LAT_SPEED = 1.7; // m/s sideways
const STUCK_LIMIT = 15; // s out there before it is made to come back
const STOP_CLEAR = 18; // a pasaway gets back in at least this far before the stop line
const CHECK_EVERY = 30; // steps between decisions per vehicle
const TAPER = 6; // m of the taper where a contraflow lane begins
const MAX_YAW = 0.32; // rad: how far the nose turns while swinging out or back
const YAW_EASE = 0.25; // s: how quickly the nose follows the swing
const SIGNAL_FIRST = 0.8; // s of indicator before swinging out (as for a lane change)
const CUT_MIN = 4; // m of travel needed to swing back in
const CUT_MAX = 10;
const MERGE_CLEAR = 15; // cones lifted: those this close to the stop line go on through instead
const ZIP_GAP = 8; // s: nobody zips in right behind someone who just came back from the cones

export const COUNTERFLOW_DEFAULTS = Object.freeze({ moto: 0, car: 0, minWait: 10, minQueue: 4, emergency: false });

export class CounterflowManager {
  constructor(sim) {
    this.sim = sim;
    this.cfg = { ...COUNTERFLOW_DEFAULTS, ...(sim.level.counterflow || {}) };
    this.active = [];
    this.zones = [];
    this.tick = 0;
    this.count = 0;
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
    for (const c of opp.committed) if (c.reservations.size && sa < 12) return false;
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
    if (zone) {
      // A coned contraflow lane: queued drivers whose whole body is beside it may use it.
      if (v.v > 2.5 || v.localS - v.hl < zone.s0 + 1 || v.localS + v.hl > lane.length - 3 || !this._canPullOut(v) || !sim.rng.chance(0.35)) return;
      // It is a lane for those turning left (or U-turning) at the junction ahead.
      const move = v.nextConnEntry()?.seg.movement;
      if (move !== 'left' && move !== 'uturn') return;
      // Only into a free bit of the lane: nobody already in it close behind, alongside, or within
      // the stretch it needs to swing out (and room for the swing before the stop line).
      const out = this._swingL(v);
      if (v.localS + v.hl + out > lane.length - 1.5) return;
      for (const o of zone.users) {
        const p = this._along(o, lane);
        if (p !== null && p > v.localS - v.hl - 10 && p < v.localS + v.hl + o.hl + out + 2) return;
      }
      this._startFront(v, lane, opp, { zone, legal: true, target: lane.length - 0.3 });
      return;
    }
    if (!moto && !PRIVATE.has(v.type)) return;
    if (moto ? v.personality === 'patient' || v.personality === 'cautious' : v.personality !== 'aggressive') return;
    // Crawling in a queue for a while (cars give it longer before they try)
    const minWait = moto ? this.cfg.minWait : Math.max(25, this.cfg.minWait);
    if (v.v > 2.5 || v.waitTime < minWait || sim.time < (v.cfNextTry || 0)) return;
    if (sim.enforcement?.near(lane.endInt)) return; // nobody tries it in front of an enforcer
    // One at a time on a stretch of road
    if (this.active.some((o) => o.cf && o.cf.opp === opp)) return;
    v.cfNextTry = sim.time + 6;
    // Too close behind the car ahead to swing the nose out
    if (!this._canPullOut(v)) return;
    // The longer the wait, the likelier they lose patience.
    const base = moto ? this.cfg.moto : this.cfg.car;
    if (!sim.rng.chance(Math.min(0.9, base * (1 + v.waitTime / 20)))) return;
    if (this._plan(v, lane, opp, moto ? 6 : 3)) return;
    // No gap to cut into: run up the oncoming lane as far as it is clear, toward the stop line.
    // One at a time per junction: two of them on opposite roads would each block the other's exit.
    if (this.active.some((o) => o.cf && o.cf.front && !o.cf.legal && !o.cf.emergency && o.cf.lane.endInt === lane.endInt)) return;
    // Only the really fed-up go all the way.
    if (v.waitTime < Math.max(20, minWait * 2) || !sim.rng.chance(0.5)) return;
    const target = this._reach(v, lane, opp, 1.5);
    if (target !== null) this._startFront(v, lane, opp, { target });
  }

  /** Pick the vehicle to get in front of (a real gap in the queue), check the oncoming lane, swing out. */
  _plan(v, lane, opp, maxK) {
    const list = lane.vehicles;
    const idx = list.indexOf(v);
    const ahead = list.slice(idx + 1).filter((o) => !o.cf);
    if (ahead.length < this.cfg.minQueue) return false;
    const limit = lane.length - STOP_CLEAR;
    const out = this._swingL(v);
    for (let k = Math.min(maxK, ahead.length); k >= 1; k--) {
      const X = ahead[k - 1];
      const Y = ahead[k] || null;
      const gapRear = X.localS + X.hl + 1.0;
      const gapFront = Math.min(limit, Y ? Y.localS - Y.hl - 1.0 : limit);
      const target = gapRear + v.spec.length + 0.3; // our front once we are just ahead of X
      // Room to swing back in (a few metres of travel) before the vehicle at the front of the gap,
      // and room to swing out before getting there.
      if (target + CUT_MIN > gapFront || target > limit || target - v.localS - v.hl < out) continue;
      const sa = this.oppS(lane, opp, target + CUT_MIN + 3);
      const sb = this.oppS(lane, opp, v.localS - v.hl - 1);
      if (!this._windowClear(opp, Math.min(sa, sb), Math.max(sa, sb))) return false;
      this._start(v, lane, opp, { target, follower: X, sa: Math.min(sa, sb), limit });
      return true;
    }
    return false;
  }

  /**
   * The furthest point (front, lane coordinate) toward the stop line the vehicle can reserve on the
   * oncoming lane right now, or null when not even two of its lengths are free.
   */
  _reach(v, lane, opp, margin) {
    const rear = this.oppS(lane, opp, v.localS - v.hl - 1);
    const least = v.localS + v.hl + Math.max(2 * v.spec.length, this._swingL(v));
    for (let t = lane.length - 0.3; t >= least; t -= 2) {
      const sa = this.oppS(lane, opp, t + 3);
      if (this._windowClear(opp, Math.min(sa, rear), Math.max(sa, rear), margin)) return t;
    }
    return null;
  }

  /** Out into the oncoming lane heading for the stop line (pasaway, contraflow user or siren). */
  _startFront(v, lane, opp, { target, zone = null, legal = false, emergency = false }) {
    const sa = Math.min(this.oppS(lane, opp, target + 3), this.oppS(lane, opp, v.localS - v.hl - 1));
    this._start(v, lane, opp, { target, sa, zone, legal, emergency, limit: lane.length - 0.3 });
    v.cf.front = true;
  }

  _start(v, lane, opp, { target, follower = null, legal = false, zone = null, sa, emergency = false, limit = target }) {
    const sim = this.sim;
    const full = -(lane.offset + opp.offset); // to the left of travel
    const block = zone ? null : { id: `cf:${v.id}`, kind: 'cf', label: '', laneObjs: [opp], s: Math.max(0.5, sa), active: true, done: false, start: -Infinity, end: Infinity };
    if (block) sim.blockages.push(block);
    // Indicator first; the swing out starts when it has blinked for a moment.
    v.cf = { lane, opp, phase: 'signal', signalT: SIGNAL_FIRST, sweep: null, full, target, follower, legal, zone, block, t: 0, emergency, forced: false, limit, front: false };
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

  /** Sirens held up behind slow traffic: they ignore the centre line and go up the oncoming lane. */
  _maybeEmergency(v) {
    if (!this.cfg.emergency || v.emergencyDone || v.lc) return;
    const lane = v.segment;
    const opp = this.oppOf(lane);
    if (!opp) return;
    const lead = this.sim.findLeader(v, 40);
    const held = v.v < 3 && lead && lead.vehicle.v < 4 && lead.gap < 20;
    v.cfSlowT = held ? (v.cfSlowT || 0) + CHECK_EVERY / 60 : 0;
    if (v.cfSlowT < 1.5 || !this._canPullOut(v)) return;
    const target = this._reach(v, lane, opp, 3);
    if (target !== null) this._startFront(v, lane, opp, { target, emergency: true });
  }

  // ------------------------------------------------------------------ moving
  /**
   * Try to move sideways by d with the nose turned by yaw (a real lane change, not a crab walk);
   * the collision gate checks the whole new body. Falls back to the same slide without turning.
   */
  _slide(v, d, yaw) {
    const sim = this.sim;
    const oldOff = v.cfOff;
    const oldYaw = v.cfYaw || 0;
    const tmp = this._tmp || (this._tmp = makeObb());
    const nb = sim.collision.neighbors(v, Math.abs(d) + 1.2);
    for (const y of [yaw, oldYaw]) {
      v.cfOff = oldOff + d;
      v.cfYaw = y;
      v.poseAt(v.s, tmp);
      if (sim.collision.isClear(tmp, nb)) {
        v.updatePose();
        return true;
      }
    }
    v.cfOff = oldOff;
    v.cfYaw = oldYaw;
    return false;
  }

  /** Ease the nose back toward straight, through the gate. */
  _straighten(v, dt) {
    const y = v.cfYaw || 0;
    if (Math.abs(y) < 1e-3) {
      v.cfYaw = 0;
      return;
    }
    const k = Math.min(1, dt / YAW_EASE);
    this._slide(v, 0, y - y * k);
  }

  /** Metres of forward travel over which the vehicle swings across (a tight lane change). */
  _swingL(v) {
    // Never sharper than ~38° (motorcycles) or ~33° (everything else) at the steepest point.
    const w = Math.abs(v.cf?.full ?? -(v.segment.offset + (this.oppOf(v.segment)?.offset ?? 0)));
    const minL = Math.max(MOTO.has(v.type) ? 4.5 : v.spec.length > 6 ? 1.6 * v.spec.length : 7, w * (MOTO.has(v.type) ? 2.0 : 2.4));
    return Math.max(minL, Math.min(20, v.v * 2.8));
  }

  /** Is there room ahead in its own lane for the nose to swing out before the car in front? */
  _canPullOut(v) {
    const lead = this.sim.findLeader(v, 30);
    return !lead || lead.gap >= 0.35 * this._swingL(v);
  }

  /** Ease the sideways offset to `to` over the next L metres of forward travel. */
  _sweep(v, to, L) {
    v.cf.sweep = { s0: v.s, L, from: v._cfOff(v.s), to };
  }

  /**
   * Swing back into the own lane like a lane change, into a real gap: room ahead for the sweep, and
   * the driver behind either far enough back or stopped to let it in. False when there is none.
   */
  _cutIn(v) {
    const sim = this.sim;
    const cf = v.cf;
    const lane = cf.lane;
    let A = null;
    let F = null;
    const scan = (o) => {
      if (o === v || (o.cf && o.cf.phase !== 'in' && o.cf.phase !== 'signal')) return;
      if (o.localS >= v.localS) {
        if (!A || o.localS < A.localS) A = o;
      } else if (!F || o.localS > F.localS) F = o;
    };
    for (const o of lane.vehicles) scan(o);
    if (lane.ghosts) for (const o of lane.ghosts) scan(o);
    // Zipper: one from the cones, then one from the lane; never right behind another one.
    if (cf.merge) {
      cf.zipOk = !(A && (A.zipAt > sim.time - ZIP_GAP || A.cf?.merge));
      if (!cf.zipOk) return false;
    }
    const end = A ? A.localS - A.hl : lane.length - 0.3;
    // (the front limit sits a little past the end of the curve, so it is driven to the very end)
    const L = Math.min(CUT_MAX, end - Math.max(1.5, v.p.minGap) - 0.5 - v.localS - v.hl);
    if (L < CUT_MIN) return false;
    if (F) {
      const gapBack = v.localS - v.hl - F.localS - F.hl;
      // A driver who has stopped (or is holding back for us) lets the tail start in a little early:
      // the body stays well out to the side for the first part of the sweep.
      const letting = F.v < 0.5 || F.leaderId === v.id;
      if (gapBack < (letting ? 0.5 - 0.35 * L : 0.5)) return false;
      if (!letting && sim.laneChanger._accWith(F, null, gapBack) < -(F.p.safeDecel ?? 3)) return false;
    }
    if (!this._extend(v, v.localS + v.hl + L)) return false;
    this._sweep(v, 0, L);
    cf.phase = 'in';
    cf.stuckIn = 0;
    return true;
  }

  /** One step of the sideways swing toward offset `goal`: speed and heading follow forward speed. */
  _swing(v, goal, dt) {
    const rate = Math.min(LAT_SPEED, Math.max(0.4, 0.35 * v.v + 0.4));
    const left = goal - v.cfOff;
    const d = Math.sign(left) * Math.min(Math.abs(left), rate * dt);
    const want = Math.max(-MAX_YAW, Math.min(MAX_YAW, Math.atan2(d / dt, Math.max(v.v, 1.2))));
    const y = v.cfYaw || 0;
    this._slide(v, d, y + (want - y) * Math.min(1, dt / YAW_EASE));
  }

  _step(v, dt) {
    const sim = this.sim;
    const cf = v.cf;
    if (!cf) return;
    cf.t += dt;
    // Mid-sweep, the offset follows the distance travelled; keep the plain values in step with it.
    if (cf.sweep) {
      v.cfOff = v._cfOff(v.s);
      v.cfYaw = v._cfYaw(v.s);
    }
    // Left its lane (crossed into the junction): ease back over the box once the whole body is
    // past the stop line (clear of the queue it came up beside).
    if (v.segment !== cf.lane) {
      const e = v.route.entries[v.segIdx];
      if (!cf.decay && v.s - v.hl > e.start + 1) {
        this._sweep(v, 0, 16);
        cf.decay = cf.sweep;
      }
      if (cf.decay && v.s > cf.decay.s0 + cf.decay.L) this._finish(v);
      return;
    }
    if (cf.phase === 'signal') {
      cf.signalT -= dt;
      if (cf.signalT <= 0) {
        cf.phase = 'out';
        this._sweep(v, cf.full, this._swingL(v));
      }
      return;
    }
    if (cf.phase === 'out' && cf.sweep) {
      if (v.s >= cf.sweep.s0 + cf.sweep.L - 0.02) {
        cf.sweep = null;
        v.cfOff = cf.full;
        v.cfYaw = 0;
        cf.phase = 'run';
      } else {
        // Can't get out (something in the way, not just someone out there ahead waiting for their
        // light): stop the sweep here and tuck back in sideways.
        cf.stuckOut = v.v < 0.05 && !this.cfLeader(v) ? (cf.stuckOut || 0) + dt : 0;
        if (cf.stuckOut > 3 && !cf.emergency) {
          cf.sweep = null;
          cf.phase = 'in';
          cf.front = false;
          cf.forced = true;
          cf.target = Math.min(cf.target, v.localS + v.hl);
        }
      }
      return;
    }
    if (cf.phase === 'out') {
      // (sideways fallback: swinging out again after a cut-in that got blocked)
      if (Math.abs(cf.full - v.cfOff) < 0.02) cf.phase = 'run';
      else {
        const before = v.cfOff;
        this._swing(v, cf.full, dt);
        // Can't get out (someone is already there): give up and tuck back in.
        cf.stuckOut = v.cfOff === before ? (cf.stuckOut || 0) + dt : 0;
        if (cf.stuckOut > 3 && !cf.emergency) {
          cf.phase = 'in';
          cf.front = false;
          cf.forced = true;
          cf.target = Math.min(cf.target, v.localS + v.hl);
        }
      }
      return;
    }
    if (cf.phase === 'run') this._straighten(v, dt);
    // Heading for the stop line: grow the reserved stretch as the oncoming traffic stops.
    if (cf.front && !cf.forced && cf.target < cf.lane.length - 0.3) this._extend(v, Math.min(cf.lane.length - 0.3, cf.target + 2));
    // Pull over: oncoming drivers near a siren in their lane move to the curb (drawing only).
    if (cf.emergency) {
      for (const o of cf.opp.vehicles) o.pullTo = 0.9;
      return;
    }
    if (cf.merge) {
      // Cones lifted: wait beside the queue (no running ahead of it) until there is a gap to zip into.
      if (cf.phase === 'run') {
        if (!cf.held) {
          cf.target = Math.min(cf.target, v.localS + v.hl);
          cf.held = true;
        }
        this._cutIn(v);
      }
    } else if (!cf.front) {
      // Past the vehicle to get in front of (the tail may start in a little early, see _cutIn).
      const passed = !cf.follower || cf.follower.segment !== cf.lane || v.localS - v.hl >= cf.follower.localS + cf.follower.hl + 0.6 - 0.35 * CUT_MIN;
      // Still beside someone in our own lane (the queue crept up): get just ahead of them, as far
      // as the reserved stretch allows.
      if (cf.phase === 'run') {
        for (const o of cf.lane.vehicles) {
          if (o === v || o.cf) continue;
          if (Math.abs(o.localS - v.localS) < o.hl + v.hl + 0.9 && o.localS >= v.localS - v.hl) {
            const want = Math.min(cf.limit, o.localS + o.hl + 1.2 + v.spec.length);
            if (want > cf.target + 0.05) this._extend(v, want);
          }
        }
      }
      // Swing back in once there is a real gap.
      if (cf.phase === 'run' && (passed || cf.forced)) this._cutIn(v);
    } else if (cf.phase === 'run' && cf.forced) this._cutIn(v);
    // Told to get back in but there is no room beside: rather than parking out there (and blocking
    // the oncoming lane), carry on to the stop line and through the junction.
    if (cf.forced && cf.phase === 'run') {
      cf.noRoomT = (cf.noRoomT || 0) + dt;
      if (cf.noRoomT > 5) {
        cf.forced = false;
        cf.front = true;
        cf.noStuck = true;
        cf.noRoomT = 0;
      }
    }
    if (cf.phase === 'in' && cf.sweep) {
      if (v.s >= cf.sweep.s0 + cf.sweep.L - 0.02) this._finish(v);
      else {
        // Held up halfway in for long: finish the move sideways (below) instead.
        cf.stuckIn = v.v < 0.05 ? (cf.stuckIn || 0) + dt : 0;
        if (cf.stuckIn > 6) {
          cf.sweep = null;
          cf.stuckIn = 0;
        }
      }
    } else if (cf.phase === 'in') {
      if (v.cfOff > -0.03 && Math.abs(v.cfYaw || 0) < 0.02) this._finish(v);
      else if (v.cfOff > -0.03) this._straighten(v, dt);
      else {
        const before = v.cfOff;
        this._swing(v, 0, dt);
        // Someone took the space while it was cutting back in: swing back out and carry on.
        cf.stuckIn = v.cfOff === before ? (cf.stuckIn || 0) + dt : 0;
        if (cf.stuckIn > 3 && cf.opp && !cf.zone?.state?.startsWith('gon')) {
          cf.stuckIn = 0;
          cf.phase = 'out';
          cf.forced = false;
          cf.front = true;
          cf.noStuck = true;
        }
      }
    }
    // Out there too long (or caught): come back now. Waiting at the stop line is not "stuck".
    if (!cf.forced && !cf.legal && !cf.noStuck && cf.t > STUCK_LIMIT && !this.atLine(v)) this.forceReturn(v);
    if (!cf.legal && cf.block && cf.t > 6) {
      const blocked = cf.opp.vehicles.some((o) => o.v < 0.3 && o.localS + o.hl > cf.block.s - 15 && o.localS < cf.block.s);
      if (blocked) sim.scoring.onCounterflowBlock?.(dt);
    }
  }

  /** Move the target further on, if the oncoming lane is still clear that far (the window grows). */
  _extend(v, target) {
    const cf = v.cf;
    if (cf.zone || !cf.block) {
      cf.target = target;
      return true;
    }
    const sa = Math.min(this.oppS(cf.lane, cf.opp, target + 3), cf.block.s);
    if (sa < cf.block.s - 0.05 && !this._windowClear(cf.opp, sa, cf.block.s, cf.emergency ? 3 : 1.5)) return false;
    cf.block.s = Math.max(0.5, sa);
    cf.target = target;
    return true;
  }

  /** HULI!, or stuck too long: stop advancing and swing back in beside the nearest vehicle behind. */
  forceReturn(v) {
    const cf = v.cf;
    if (!cf || cf.emergency) return;
    // Caught before it even pulled out, or already on its way back in.
    if (cf.phase === 'signal') {
      this._finish(v);
      return;
    }
    v.cfDone = true;
    if (cf.phase === 'in') return;
    cf.forced = true;
    cf.target = Math.min(cf.target, v.localS + v.hl); // stop here (or just past whoever is beside us)
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
    if (cf.merge) v.zipAt = sim.time;
    v.cf = null;
    v.cfOff = 0;
    v.cfYaw = 0;
    v.cfDone = true;
    if (v.violation?.kind === 'counterflow') v.violation = { kind: 'counterflow', until: sim.time + 6 };
    v.updatePose();
  }

  /**
   * Out in the oncoming lane and through to the stop line: from here the vehicle is the head of its
   * lane and goes on its own signal (or is already crossing the box).
   */
  atLine(v) {
    const cf = v.cf;
    if (!cf) return false;
    if (v.segment !== cf.lane) return true;
    if (!(cf.front || cf.emergency) || cf.forced || cf.phase !== 'run') return false;
    if (cf.target < cf.lane.length - 0.5) return false;
    // Goes into the box only on its own: never on the tail of someone on the same path (its body is
    // still out to the side until it is through).
    const ce = v.nextConnEntry();
    if (ce && ce.seg.vehicles.some((o) => o !== v && o.localS - o.hl < ce.seg.length)) return false;
    const id = cf.lane.endInt.id;
    if (cf.lane.vehicles.some((o) => o !== v && !o.cf && o.reservations.has(id))) return false;
    const lead = this.cfLeader(v);
    return !lead || lead.vehicle.segment !== cf.lane;
  }

  /** Is o (ahead of v on `lane`) out in the oncoming lane, so not v's leader in its own lane? */
  outBeside(o, lane, v) {
    const cf = o.cf;
    if (!cf || cf.phase === 'in' || cf.phase === 'signal') return false;
    if (cf.front && cf.lane === lane) return true;
    if (cf.merge && !cf.zipOk) return true;
    return o.localS - o.hl - v.localS - v.hl < 0.5;
  }

  /** The next vehicle ahead of v out in the same oncoming stretch (they follow each other there). */
  cfLeader(v) {
    const cf = v.cf;
    const at = this._along(v, cf.lane);
    if (at === null) return null;
    let best = null;
    for (const o of this.active) {
      if (o === v || !o.cf || o.cf.lane !== cf.lane || o.cf.phase === 'in' || o.cf.phase === 'signal') continue;
      const p = this._along(o, cf.lane);
      if (p === null || p <= at) continue;
      const gap = p - o.hl - at - v.hl;
      if (!best || gap < best.gap) best = { vehicle: o, gap: Math.max(0, gap) };
    }
    return best;
  }

  /** Distance travelled along `lane` and the connector after it (null once further on). */
  _along(v, lane) {
    if (v.segment === lane) return v.localS;
    if (v.route.entries[v.segIdx - 1]?.seg === lane) return lane.length + v.localS;
    return null;
  }

  /** Front limit (route coordinate) for a vehicle out in the oncoming lane, or null. */
  frontLimit(v) {
    const cf = v.cf;
    if (!cf || v.segment !== cf.lane || this.atLine(v)) return null;
    if (cf.phase === 'signal') return v.front; // stays put while the indicator blinks
    if (cf.emergency && cf.target >= cf.lane.length - 0.5) return null;
    return v.route.entries[v.segIdx].start + cf.target;
  }

  // ------------------------------------------------------------------ contraflow zones (player tool)
  /**
   * Cone off the oncoming inner lane beside `lane` from lane coordinate `from` (where the player
   * tapped; else `length` m back from the stop line) all the way to the junction, until the player
   * takes the cones away (or for `secs` when given). Oncoming traffic that would have used that
   * lane takes the next one. Returns the zone, or a reason string when it cannot be done here.
   */
  openZone(lane, { secs = Infinity, length = 80, from = null } = {}) {
    const sim = this.sim;
    const opp = this.oppOf(lane);
    if (!opp) return 'Only on undivided roads (no median), next to the inner lane';
    const had = this.zoneAt(lane);
    if (had) return had;
    // The oncoming side keeps a lane of its own: it needs two.
    const outs = lane.endInt.exitLanes[lane.endArm].filter((l) => l.type === 'general');
    const opp1 = outs[1];
    if (!opp1) return 'Kailangan ng 2 lane sa kabila (oncoming) para sa contraflow';
    const len = lane.length;
    const taper = Math.min(TAPER, len * 0.15);
    const s0 = Math.min(len - 6, Math.max(taper + 1, from ?? len - length));
    const block = { id: `cz:${lane.id}`, kind: 'cf', label: '', laneObjs: [opp], s: 0.5, active: false, done: false, start: -Infinity, end: Infinity };
    sim.blockages.push(block);
    // Cones between the borrowed lane and the oncoming lane that stays open, from the junction out,
    // then a taper back to the centre line where the contraflow lane begins.
    const g = lane.center;
    const lat = (o) => (o.center === g ? o.cOffset : -o.cOffset);
    const mid = (lat(opp) + lat(opp1)) / 2;
    const at = (s, k) => {
      const u = lane.cReversed ? lane.cu1 - s : lane.cu0 + s;
      const p = g.point(u, mid * k);
      return { x: p.x, y: p.y };
    };
    const cones = [];
    for (let s = len - 1; s > s0 + 2; s -= 6) cones.push(at(s, 1));
    for (let i = 0; i < 4; i++) cones.push(at(s0 - (i * taper) / 3, 1 - (0.85 * i) / 3));
    const zone = { lane, opp, s0, s1: len, block, cones, placed: 0, placeT: 0, state: 'placing', until: sim.time + secs, users: new Set() };
    this.zones.push(zone);
    // Oncoming drivers who were going to use that lane take the next one from now on.
    opp.closed = true;
    this._reroute(opp);
    sim.notify(`CZ_${lane.id}`, `🚧 CONTRAFLOW sa ${sim.network.roadName(lane.endInt, lane.endArm) || 'kalsada'} · cones going up`, 'info');
    return zone;
  }

  /**
   * The zone under world point (x, y): one of its cones within `r`, or anywhere on the coned lane
   * itself (players tap the lane as often as the small cones).
   */
  zoneAtPoint(x, y, r = 4) {
    const q = { x: 0, y: 0 };
    for (const z of this.zones) {
      if (z.state === 'closing' || z.state === 'gone') continue;
      for (let i = 0; i < z.placed; i++) if (Math.hypot(z.cones[i].x - x, z.cones[i].y - y) < r) return z;
      const a = Math.min(this.oppS(z.lane, z.opp, z.s0), this.oppS(z.lane, z.opp, z.s1));
      const b = Math.max(this.oppS(z.lane, z.opp, z.s0), this.oppS(z.lane, z.opp, z.s1));
      for (let s = Math.max(0, a); s <= Math.min(z.opp.length, b); s += 1.5) {
        z.opp.path.pointAt(s, q);
        if (Math.hypot(q.x - x, q.y - y) < Math.max(2, r * 0.6)) return z;
      }
    }
    return null;
  }

  /** The zone on this road (either inner lane of it), if any. */
  zoneAt(lane) {
    return this.zones.find((z) => z.state !== 'gone' && (z.lane === lane || z.opp === lane)) || null;
  }

  /**
   * Take the cones away: nobody new goes in and the cones come up. Those already at (or near) the
   * stop line go on through; the rest zip back into their own lane as gaps come (see _cutIn).
   */
  closeZone(zone) {
    if (!zone || zone.state === 'closing' || zone.state === 'gone') return false;
    zone.state = 'closing';
    zone.placeT = 0;
    for (const v of [...zone.users]) {
      const cf = v.cf;
      if (!cf || v.segment !== cf.lane || this.atLine(v) || v.localS + v.hl > cf.lane.length - MERGE_CLEAR) continue;
      if (cf.phase === 'signal') {
        this._finish(v); // had not pulled out yet
        continue;
      }
      cf.merge = true;
      cf.front = false;
    }
    return true;
  }

  /** New routes for everyone not yet committed whose route still runs into a closed lane. */
  _reroute(closed) {
    const sim = this.sim;
    for (const v of sim.vehicles) {
      if (v.segment.kind !== 'lane' || v.lc || v.cf || v.reservations.size) continue;
      const E = v.route.entries;
      let uses = false;
      for (let i = v.segIdx + 1; i < E.length; i++) {
        if (E[i].seg === closed) {
          uses = true;
          break;
        }
      }
      if (!uses) continue;
      const route = sim.laneChanger._rebuildRoute(v, v.segment, v.s - v.localS);
      v.route = route;
      v.segIdx = 0;
      v.nextConn = 0;
      v._gateS = undefined;
      v.updatePose();
    }
    // Arrivals still waiting to enter the map have their routes planned already.
    for (const q of sim.spawner.pending.values()) {
      for (const item of q) if (item.route.entries.some((e) => e.seg === closed)) item.route = this._routeAvoiding(item.route, item.type);
    }
  }

  /** The same trip (same lanes in, same movements) with closed lanes swapped for the next one. */
  _routeAvoiding(route, type) {
    const moves = route.movements;
    let lane = route.entries[0].seg;
    const segs = [lane];
    for (let i = 0; lane.endInt && i < 10; i++) {
      const m = moves[i] && lane.connectors[moves[i]] ? moves[i] : this.sim.spawner.chooseMovement(lane, type);
      const conn = Network.connectorFor(lane, m, VEHICLE_TYPES[type]) || lane.connectors[m];
      if (!conn) break;
      segs.push(conn, conn.toLane);
      lane = conn.toLane;
    }
    return new Route(segs);
  }

  _updateZone(z, dt) {
    const sim = this.sim;
    if (z.state === 'placing') {
      z.placeT += dt;
      while (z.placeT >= 0.15 && z.placed < z.cones.length) {
        z.placeT -= 0.15;
        z.placed++;
      }
      // Opens once the cones are down and nobody is in, or still heading into, the borrowed lane.
      const busy = z.opp.vehicles.length > 0 || [...z.opp.committed].some((c) => c.reservations.size);
      if (z.placed >= z.cones.length && !busy) {
        z.block.active = true;
        z.state = 'open';
        sim.notify(`CZO_${z.lane.id}`, '🚧 CONTRAFLOW LANE OPEN', 'good');
      }
    } else if (z.state === 'open') {
      if (sim.time >= z.until) this.closeZone(z);
    } else if (z.state === 'closing') {
      // The cones come up straight away, from the far end toward the junction; the lane only goes
      // back to oncoming traffic once the last driver using it is out.
      z.placeT += dt;
      while (z.placeT >= 0.12 && z.placed > 0) {
        z.placeT -= 0.12;
        z.placed--;
      }
      if (!z.users.size) {
        if (z.placed <= 0) {
          z.block.active = false;
          const k = sim.blockages.indexOf(z.block);
          if (k >= 0) sim.blockages.splice(k, 1);
          z.opp.closed = false;
          z.state = 'gone';
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
