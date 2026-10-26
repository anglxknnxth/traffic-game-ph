// Simulation coordinator. DOM-free so it can run headless in tests.
//
// Per fixed step:
//   1. signal state machines advance (all-red waits while vehicles are still clearing)
//   2. arrivals spawn where the lane entry is physically free
//   3. every vehicle decides a desired acceleration (VehicleAI)
//   4. every move is limited by hard rules (no entry without reservation, keep-clear, blockages)
//      and then by the collision gate (CollisionAvoidance) before being applied
//   5. bookkeeping: segment membership, reservation release, despawn at the end of exit roads
//   6. metrics, gridlock detection, horns and scoring

import { Rng } from '../utils/math.js';
import { ARMS, OPPOSITE, SIM_DT, NOTIFY_TEXT, ARM_LABEL } from '../data/config.js';
import { mapForLevel } from '../data/maps/index.js';
import { Network } from './LaneManager.js';
import { TrafficLightController } from './TrafficLightController.js';
import { IntersectionManager } from './IntersectionManager.js';
import { CollisionAvoidance } from './CollisionAvoidance.js';
import { VehicleAI } from './VehicleAI.js';
import { VehicleSpawner } from './VehicleSpawner.js';
import { GridlockDetector, CONGESTION, rankOf } from './GridlockDetector.js';
import { ScoringSystem } from './ScoringSystem.js';
import { Environment } from './Environment.js';
import { LaneChanger } from './LaneChange.js';
import { PedestrianManager } from './PedestrianManager.js';
import { SignalAutopilot } from './Autopilot.js';
import { EventScheduler } from './EventScheduler.js';
import { CityGrowth } from './CityGrowth.js';
import { CounterflowManager } from './Counterflow.js';
import { Enforcement } from './Enforcement.js';
import { SurgeDirector } from './SurgeDirector.js';
import { Passengers } from './Passengers.js';
import { SPECIAL_LABEL } from './Calendar.js';
import { BossEvents } from './BossEvents.js';
import { Approval } from './Approval.js';
import { Forecast } from './Forecast.js';
import { Unsticker } from './Unstick.js';

const METRIC_INTERVAL = 0.25;
const PROBE_MARGIN = 16; // look-ahead probing starts this far outside a node's stop lines
const FREE_FLOW = 50; // vehicles/s: an exit without a downstream gate never holds anyone
const RTOR_GAP = 3; // s: right turn on red needs this much time before green traffic arrives
const EMERGENCY_CLAIM_DIST = 60; // an emergency vehicle this close to a stop line holds that junction
const EMERGENCY_STALL = 4; // s: an emergency vehicle stopped this long (and not about to go) releases its hold

export class TrafficSimulator {
  constructor(level, { seed = 1 } = {}) {
    this.level = level;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.env = new Environment(level, new Rng((seed ^ 0x5bd1e995) >>> 0));
    this.network = new Network(mapForLevel(level));
    this.lights = new TrafficLightController(this.network, { initialGroups: level.initialGroups || {} });
    this.imgr = new Map(this.network.intersections.map((I) => [I.id, new IntersectionManager(I)]));
    this.collision = new CollisionAvoidance();
    this.ai = new VehicleAI(this);
    this.laneChanger = new LaneChanger(this);
    this.detectors = new Map(this.network.intersections.map((I) => [I.id, new GridlockDetector()]));
    this.scoring = new ScoringSystem();
    this.vehicles = [];
    this.time = 0;
    this.scheduleOffset = 0; // scripted events (emergencies, blockages) are timed from session start
    this.events = [];
    this.hornIntensity = 1;
    this.priority = [];
    this.emergencyClaims = [];
    this.notifyCooldown = new Map();
    this._metricTimer = 0;
    this.removedLog = [];
    this.keepRemovedLog = false;
    this.multi = this.network.intersections.length > 1;

    this.blockages = (level.blockages || []).map((b, i) => {
      const exitLanes = this.network.exitLanesByKey(b.exit);
      return { ...b, id: i, laneObjs: b.lanes.map((k) => exitLanes[k]).filter(Boolean), active: false, done: false };
    });
    // Lane drops (map): a lane that ends before the junction. Traffic in it must merge (zipper).
    for (const d of this.network.laneDrops) {
      this.blockages.push({ id: `drop:${d.lane.id}`, kind: 'laneEnd', label: 'LANE ENDS', laneObjs: [d.lane], s: d.s, active: true, done: false, start: -Infinity, end: Infinity });
    }
    this.mergers = [];
    // Downstream discharge (the next, off-map intersection). Per-exit overrides let a level make one
    // direction a chronic bottleneck whose queue can spill back into the box.
    const ds = level.downstream || {};
    for (const lane of this.network.exitLanes) {
      const o = ds.exits?.[lane.exitKey] || {};
      const gateAt = o.gateAt ?? ds.gateAt ?? null;
      const stop = lane.startInt.arms[lane.startArm].exitStop;
      lane.gateLocal = gateAt ? Math.min(lane.length - 0.5, Math.max(20, gateAt - stop)) : lane.length - 0.5;
      lane.gateVisible = !!gateAt;
      // Only exits with a visible "next junction" gate are throttled; every other road drains
      // freely off the edge of the map, so nobody queues at the very end of a road.
      lane.gateRate = gateAt ? o.rate ?? ds.rate ?? 0.9 : FREE_FLOW;
      lane.gateVar = o.variability ?? ds.variability ?? 0;
      lane.gateWave = { phase: this.rng.range(0, Math.PI * 2), period: this.rng.range(45, 85) };
      lane.gate.tokens = 1;
    }
    this.resetStats();
    this.passengers = new Passengers(this); // before the spawner: new PUVs are filled with riders
    this.spawner = new VehicleSpawner(this);
    this.peds = new PedestrianManager(this);
    this.metrics = this._emptyMetrics();
    // AUTO lights: on for every signal when the level asks for it (watch / sandbox modes).
    // Random scenarios (endless modes): breakdowns, roadworks, school out, jeep waves.
    this.cornerStopRate = level.cornerStops || 0;
    this.scenarios = level.randomEvents ? new EventScheduler(this, level.randomEvents) : null;
    this.autopilot = new SignalAutopilot(this, { auto: !!level.autoLights, returnAfter: level.autoReturn ?? null });
    // Growing city: only the open districts are the player's (the rest runs on AUTO).
    this.openNodes = null;
    this.demandMul = 1;
    this.rampMax = Infinity; // Chill Endless: the player's cap on the demand ramp
    this.growth = level.growth ? new CityGrowth(this, level.growth) : null;
    this.enforcement = new Enforcement(this);
    this.counterflow = new CounterflowManager(this);
    this.unstick = new Unsticker(this);
    // Endless modes: the AM and PM peaks arrive as surges, each one followed by an upgrade card.
    this.surge = level.surges ? new SurgeDirector(this) : null;
    // Habulan and VIP motorcades (started by the random events, or by a level script).
    this.boss = new BossEvents(this);
    this.approval = new Approval(this);
    this.forecast = new Forecast(this);
    // Session modifiers the surge cards adjust.
    this.codingMul = 1;
    this.cornerStopMul = 1;
    this.disciplineMul = level.discipline ?? 1; // Davao: drivers who follow the rules
    this.boardingMul = 1;
  }

  /** Midnight: the radio names the new day and anything special about it. */
  _announceDay() {
    const cal = this.env.calendar;
    const tag = cal.tags.find((t) => t !== 'fridayNight' && t !== 'ber');
    const extra = tag ? ` · ${SPECIAL_LABEL[tag]}` : '';
    this.notify('NEW_DAY', `📅 ${cal.dayName().toUpperCase()} · ${cal.label().split(', ')[1]}${extra}`, 'info');
  }

  resetStats() {
    this.stats = {
      processed: 0,
      totalWait: 0,
      recentWaits: [],
      horns: 0,
      hornTimes: [],
      boxBlockEntries: 0,
      earlyRequests: 0,
      emergencyArrivals: 0,
      emergencyArrivalTimes: [],
      emergencyDelays: [],
      gateInterventions: 0,
      spawned: 0,
    };
    this.scoring?.reset();
    this.peds?.resetStats();
    for (const d of this.detectors?.values() || []) {
      d.gridlockTime = 0;
      d.partialTime = 0;
      d.recoveries = 0;
    }
  }

  _emptyMetrics() {
    return {
      vehicles: 0,
      avgSpeed: 0,
      avgWait: 0,
      overallWait: 0,
      longestQueue: 0,
      congestion: 0,
      blockedApproaches: 0,
      level: CONGESTION.NORMAL,
      hornRate: 0,
      horns: 0,
      volume: 0,
      processed: 0,
      pending: 0,
      boxStopped: 0,
      gridlockTime: 0,
      perIntersection: [],
    };
  }

  // ---------------------------------------------------------------- main step
  step(dt = SIM_DT) {
    // Poses at the start of the step, so the renderer can interpolate between steps.
    for (const v of this.vehicles) v.ps = v.s;
    for (const p of this.peds.peds) {
      p.px = p.x;
      p.py = p.y;
      p.pa = p.angle;
    }
    this.time += dt;
    this.env.update(dt, this.scheduleTime);
    if (this.env.newDay && this.env.rushHour) this._announceDay();
    this.lights.update(dt);
    this.updatePriority();
    this.autopilot.update(dt);
    this.scenarios?.update(dt);
    this.surge?.update();
    this.boss.update(dt);
    this.updateBlockages();
    this.peds.update(dt);
    this.spawner.update(dt);
    this.updateGates(dt);

    const vehicles = this.vehicles;
    this._updateMergers();
    this.laneChanger.update();
    this.unstick.step(dt);
    this.collision.rebuild(vehicles);
    this.counterflow.update(dt);
    this.enforcement.update(dt);
    for (let i = 0; i < vehicles.length; i++) this.ai.decide(vehicles[i]);
    for (let i = 0; i < vehicles.length; i++) this.move(vehicles[i], dt);
    this.postMove();
    for (let i = 0; i < this.vehicles.length; i++) this.ai.updateAfterMove(this.vehicles[i], dt);
    this.passengers.update(dt);
    this.approval.observe();
    this.forecast.update(dt);

    this._metricTimer += dt;
    if (this._metricTimer >= METRIC_INTERVAL) {
      this.computeMetrics(this._metricTimer);
      this.approval.update(this._metricTimer);
      this._metricTimer = 0;
      this.growth?.update();
      this.unstick.update(this._metricTimer || METRIC_INTERVAL);
    }
  }

  /**
   * Build ahead of time the junction footprints that vehicles on the road will ask for, within a
   * time budget (ms). Footprints are pure, cached geometry: building one early never changes the
   * simulation, it only keeps that work out of the step that first needs it (a frame hitch).
   */
  prefetch(budgetMs = 1.5) {
    const until = performance.now() + budgetMs;
    for (const v of this.vehicles) {
      const ce = v.nextConnEntry();
      if (!ce || ce.seg.under) continue;
      const mgr = this.imgr.get(ce.seg.intersection.id);
      if (!mgr) continue;
      if (!mgr.hasFootprint(ce.seg, v.spec)) {
        mgr.footprint(ce.seg, v.spec);
        if (performance.now() > until) return false;
      }
      if (!mgr.warmConflicts(ce.seg, until)) return false;
    }
    return true;
  }

  move(v, dt) {
    let newV = v.v + v.a * dt;
    if (newV < 0) newV = 0;
    if (v.creeping && newV > 0.9) newV = 0.9;
    let ds = (v.v + newV) * 0.5 * dt;
    const planned = ds;
    const lim = this.hardLimit(v);
    if (v.s + v.hl + ds > lim) ds = Math.max(0, lim - v.s - v.hl);
    if (ds > 0) ds = this.collision.safeAdvance(v, ds);
    // Out in the oncoming lane its body runs over crosswalk its box reservation does not cover.
    if (ds > 0 && v.cf) ds = this.counterflow.pedClearAdvance(v, ds);
    if (ds < planned - 1e-9) {
      newV = Math.min(newV, ds / dt);
      if (ds < planned * 0.5) this.stats.gateInterventions++;
    }
    v.v = newV;
    if (ds > 0) {
      v.s += ds;
      v.updatePose();
    }
  }

  /** Maximum route coordinate the vehicle's front may reach this step (hard rules). */
  hardLimit(v) {
    let lim = Infinity;
    const ce = v.nextConnEntry();
    if (ce && !ce.seg.under && !v.reservations.has(ce.seg.intersection.id)) lim = ce.start - 0.05;
    const kc = this.keepClearLimit(v);
    if (kc !== null && kc < lim) lim = kc;
    const blk = this.nextBlockage(v);
    if (blk !== null && blk - 0.1 < lim) lim = blk - 0.1;
    const gate = v.route.exitLane.gate;
    if (gate && gate.tokens < 1) {
      const gf = this.gateFront(v);
      if (gf !== null && gf < lim) lim = gf;
    }
    if (v.loading && v.loading.state === 'stopped') lim = Math.min(lim, v.front);
    if (v.cornerStop && v.cornerStop.state === 'stopped') lim = Math.min(lim, v.front);
    const sh = this.sharedFrontLimit(v);
    if (sh !== null && sh < lim) lim = sh;
    const hold = this.unstick.holdLimit(v); // backing up ("atras!"), then waiting a moment there
    if (hold !== null && hold < lim) lim = hold;
    const cf = this.counterflow.frontLimit(v);
    if (cf !== null && cf < lim) lim = cf;
    return lim;
  }

  /**
   * Vehicles waiting at the end of a dropped lane to merge. Traffic in the lanes beside them lets
   * them in one at a time (zipper, see mergeLeader).
   */
  _updateMergers() {
    const list = this.mergers;
    list.length = 0;
    for (const d of this.network.laneDrops) {
      let best = null;
      for (const v of d.lane.vehicles) {
        if (v.lc) continue;
        const gap = d.s - (v.localS + v.hl);
        if (gap < 0 || gap > 14 || v.v > 3) continue;
        if (!best || v.localS > best.localS) best = v;
      }
      if (best) list.push({ v: best, lane: d.lane, targets: LaneChanger.neighbours(d.lane).filter((B) => B.allows(best.type)) });
    }
    // The same at roadworks, a breakdown or fire hoses: whoever waits at the front is let in.
    for (const b of this.blockages) {
      if (!b.active || b.sOf || ['ped', 'laneEnd', 'cf'].includes(b.kind)) continue;
      for (const lane of b.laneObjs) {
        let best = null;
        for (const v of lane.vehicles) {
          if (v.lc) continue;
          const gap = b.s - (v.localS + v.hl);
          if (gap < 0 || gap > 14 || v.v > 3) continue;
          if (!best || v.localS > best.localS) best = v;
        }
        if (best) list.push({ v: best, lane, targets: LaneChanger.neighbours(lane).filter((B) => B.allows(best.type)) });
      }
    }
  }

  /** A merging vehicle the driver of v lets in ahead of it (zipper), as { vehicle, gap }, or null. */
  mergeLeader(v) {
    if (!this.mergers.length || v.segment.kind !== 'lane') return null;
    let best = null;
    for (const m of this.mergers) {
      if (!m.targets.includes(v.segment) || m.v === v) continue;
      const ahead = m.v.localS - v.localS;
      if (ahead < 0.5 || ahead > 30) continue;
      // Zipper: only the driver right behind the merge point waits; whoever let someone in just
      // now does not stop again for the next one.
      if (v.letIn && this.time - v.letIn < 6) continue;
      const lead = this.findLeader(v, 40);
      if (lead && lead.vehicle.localS < m.v.localS && lead.vehicle.segment === v.segment) continue;
      const gap = m.v.localS - m.v.hl - v.localS - v.hl;
      // Already alongside: drive on; the next driver back makes the gap.
      if (gap < 1) continue;
      if (!best || gap < best.gap) best = { vehicle: m.v, gap };
    }
    return best;
  }

  /** Front limit while a time-shared box cell is still held by the vehicle that had it first. */
  sharedFrontLimit(v) {
    if (!v.reservations.size || this.hasPass(v)) return null;
    let lim = null;
    for (const [id, res] of v.reservations) {
      if (!res.shared) continue;
      const c = this.imgr.get(id).sharedLimit(v);
      if (c === null) continue;
      const f = res.connStart + c + v.hl;
      if (lim === null || f < lim) lim = f;
    }
    return lim;
  }

  postMove() {
    const vehicles = this.vehicles;
    let removed = false;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const E = v.route.entries;
      while (v.segIdx < E.length - 1 && v.s > E[v.segIdx].end) {
        this._removeFromSeg(E[v.segIdx].seg, v);
        v.segIdx++;
        const seg = E[v.segIdx].seg;
        seg.vehicles.push(v);
        if (seg.kind === 'lane') seg.committed.delete(v);
      }
      v.localS = v.s - E[v.segIdx].start;

      // Stop-line crossing
      const ce = v.nextConnEntry();
      if (ce && v.front >= ce.start && (ce.seg.under || v.reservations.has(ce.seg.intersection.id))) {
        if (v.emergency && !v.emergencyDone) this._emergencyCleared(v, ce);
        this._checkRedRun(v, ce.seg);
        ce.seg.fromLane.lastCross = this.time;
        v.nextConn++;
      }
      // Progressive reservation release
      if (v.reservations.size) {
        for (const [id, res] of v.reservations) {
          const conn = res.conn;
          const done = this.imgr.get(id).releaseProgress(v, v.s - res.connStart);
          if (done) conn.toLane.committed.delete(v);
        }
      }
      // Downstream gate passage consumes one discharge token; despawn at the end of the exit road.
      const gate = v.route.exitLane.gate;
      if (gate) {
        const gf = this.gateFront(v);
        if (gf !== null && v.front >= gf - 0.02 && gate.tokens >= 1) {
          gate.tokens -= 1;
          v.gatePassed = true;
        } else if (gf === null && !v.gatePassed) {
          // Waved through the gate (see grantPass): it passes without using a token.
          const exit = v.route.exitLane;
          if (v.front >= v.route.startOf(exit) + exit.gateLocal - 0.02) v.gatePassed = true;
        }
        if (v.gatePassed && v.front >= v.route.length - 0.5 - 1e-6) {
          v._remove = true;
          removed = true;
        }
      }
    }
    if (removed) {
      const keep = [];
      for (const v of vehicles) {
        if (v._remove) this._despawn(v);
        else keep.push(v);
      }
      this.vehicles = keep;
    }
    for (const seg of this.network.segments) {
      const list = seg.vehicles;
      for (let i = 1; i < list.length; i++) {
        const x = list[i];
        let j = i - 1;
        while (j >= 0 && list[j].localS > x.localS) {
          list[j + 1] = list[j];
          j--;
        }
        list[j + 1] = x;
      }
      for (let i = 0; i < list.length; i++) list[i].segOrder = i;
    }
  }

  /** Crossing the stop line on red (not a right turn on red, not waved through): a violation. */
  _checkRedRun(v, conn) {
    const I = conn.intersection;
    if (v.emergency || conn.under || I.kind !== 'signal') return;
    if (this.lights.signal(I.id, conn.arm, conn.movement) !== 'red') return;
    if (conn.movement === 'right' || this.hasPass(v) || v.waved > this.time || this.isEscort(v, I)) return;
    this.enforcement.mark(v, 'red', 10);
    this.stats.redRuns = (this.stats.redRuns || 0) + 1;
  }

  _removeFromSeg(seg, v) {
    const k = seg.vehicles.indexOf(v);
    if (k >= 0) seg.vehicles.splice(k, 1);
  }

  _despawn(v) {
    this._removeFromSeg(v.segment, v);
    if (v.lc) this.laneChanger.finish(v);
    for (const id of [...v.reservations.keys()]) this.imgr.get(id).releaseAll(v);
    for (const lane of this.network.lanes) lane.committed.delete(v);
    this.stats.processed++;
    this.stats.totalWait += v.waitTime;
    this.stats.recentWaits.push(v.waitTime);
    if (this.stats.recentWaits.length > 40) this.stats.recentWaits.shift();
    this.scoring.onProcessed(v);
    this.passengers.onDespawn(v);
    this.boss.onDespawn(v);
    if (this.keepRemovedLog) this.removedLog.push({ id: v.id, s: v.s, front: v.front, routeLength: v.route.length });
    this.events.push({ type: 'processed', vehicle: v.type });
  }

  addVehicle(v, lane) {
    // Per-simulation sequence number: decisions keyed on it stay deterministic even when several
    // simulations run side by side (global vehicle ids interleave).
    this._seq = (this._seq || 0) + 1;
    v.seq = this._seq;
    this.vehicles.push(v);
    lane.vehicles.push(v);
    lane.vehicles.sort((a, b) => a.localS - b.localS);
    lane.vehicles.forEach((o, i) => (o.segOrder = i));
    this.collision.add(v);
    this.stats.spawned++;
    if (v.emergency) {
      v.idealTravel = 0;
    }
  }

  _emergencyCleared(v, ce) {
    v.emergencyDone = true;
    const ideal = Math.max(0, ce.start - v.hl - 0.3) / v.spec.maxSpeed;
    const delay = Math.max(0, this.time - v.spawnTime - ideal);
    this.stats.emergencyDelays.push(delay);
    this.scoring.onEmergencyCleared(delay);
    this.notify(`EM_CLEAR_${v.id}`, `${v.spec.label.toUpperCase()} THROUGH · ${delay.toFixed(0)}s delay`, delay <= 25 ? 'good' : 'warn');
  }

  // ---------------------------------------------------------------- queries used by the AI
  findLeader(v, maxDist) {
    const E = v.route.entries;
    const seg = E[v.segIdx].seg;
    const list = seg.vehicles;
    let idx = v.segOrder;
    if (list[idx] !== v) idx = list.indexOf(v);
    // Vehicles still sliding out of this lane (lane change in progress) remain leaders here.
    let ghost = null;
    if (seg.ghosts && seg.ghosts.size) {
      for (const g of seg.ghosts) if (g !== v && g.localS > v.localS && (!ghost || g.localS < ghost.localS)) ghost = g;
    }
    // Someone out in the oncoming lane beside us is not our leader (until they cut back in).
    let next = idx + 1;
    // Those running up to the stop line are never anyone's leader here, nor is one waiting out there
    // to zip back in that has to let us by first (it goes in behind us). One still signalling is.
    while (next < list.length && this.counterflow.outBeside(list[next], seg, v)) next++;
    if (idx >= 0 && next < list.length) {
      const o = list[next];
      const lead = ghost && ghost.localS < o.localS ? ghost : o;
      return { vehicle: lead, gap: lead.localS - lead.hl - v.localS - v.hl };
    }
    if (ghost) return { vehicle: ghost, gap: ghost.localS - ghost.hl - v.localS - v.hl };
    let dist = seg.length - v.localS;
    for (let i = v.segIdx + 1; i < E.length && dist < maxDist; i++) {
      const s2 = E[i].seg;
      if (s2.vehicles.length) {
        const o = s2.vehicles[0];
        return { vehicle: o, gap: dist + o.localS - o.hl - v.hl };
      }
      dist += s2.length;
    }
    return null;
  }

  nearIntersection(v) {
    for (const I of this.network.intersections) if (Network.inCore(I, v.x, v.y, PROBE_MARGIN)) return true;
    return false;
  }

  keepClearLimit(v) {
    const seg = v.segment;
    if (seg.kind !== 'lane' || !seg.keepClear || seg.keepClear.size === 0) return null;
    if (seg.endInt && v.reservations.has(seg.endInt.id)) return null;
    let lim = Infinity;
    for (const [owner, limit] of seg.keepClear) if (owner !== v && limit < lim) lim = limit;
    if (lim === Infinity) return null;
    return v.route.entries[v.segIdx].start + lim;
  }

  nextBlockage(v) {
    let best = null;
    for (const b of this.blockages) {
      if (!b.active) continue;
      for (const lane of b.laneObjs) {
        const start = v.route.startOf(lane);
        if (start < 0) continue;
        const bs = start + (b.sOf ? b.sOf.get(lane) : b.s);
        if (bs >= v.front - 0.05 && bs - v.front < 90 && (best === null || bs < best)) best = bs;
      }
    }
    return best;
  }

  /** True when an active blockage sits on `lane` between lane coordinates s0 and s1. */
  blockageOnLane(lane, s0, s1, kind = null) {
    for (const b of this.blockages) {
      if (!b.active || !b.laneObjs.includes(lane) || (kind && b.kind !== kind)) continue;
      const bs = b.sOf ? b.sOf.get(lane) : b.s;
      if (bs >= s0 && bs <= s1) return true;
    }
    return false;
  }

  isLaneHead(v, ce) {
    const E = v.route.entries;
    if (E[v.segIdx + 1] !== ce) return false;
    if (v.cf) return this.counterflow.atLine(v); // it came up the oncoming lane, beside the queue
    // Someone who came up beside the queue is still crossing the box out to the side: wait for them.
    // (Or is at the line beside us: they go first, unless they are stuck there and cannot go.)
    for (const o of this.counterflow.active) {
      if (o === v || !o.cf || o.cf.lane !== v.segment || o.cf.phase === 'in') continue;
      if (o.segment !== v.segment || o.reservations.size || (this.counterflow.atLine(o) && o.stoppedTime < 2)) return false;
    }
    const list = v.segment.vehicles;
    const id = ce.seg.intersection.id;
    let idx = v.segOrder;
    if (list[idx] !== v) idx = list.indexOf(v);
    for (let i = idx + 1; i < list.length; i++) if (!list[i].reservations.has(id)) return false;
    return true;
  }

  exitSpace(v, conn) {
    const lane = conn.toLane;
    const strict = lane.role === 'link';
    // Space a vehicle really occupies once stopped: its length plus its driver's following gap.
    const footprint = (o) => o.spec.length + o.p.minGap + (strict ? 1.0 : 0.4);
    const first = lane.vehicles[0];
    let free = first ? first.localS - first.hl : lane.length;
    for (const c of lane.committed) if (c !== v) free -= footprint(c);
    for (const b of this.blockages) if (b.active && b.laneObjs.includes(lane)) free = Math.min(free, (b.sOf ? b.sOf.get(lane) : b.s) - 0.5);
    if (!strict && first && first.v > 2) free += Math.min(first.v * 1.5, 12);
    const need = footprint(v);
    if (free >= need) return 'ok';
    if (strict) return 'strict';
    return free >= v.hl ? 'tight' : 'none';
  }

  leftGapOk(v, conn) {
    const I = conn.intersection;
    const opp = OPPOSITE[conn.arm];
    const lanes = I.approachLanes[opp];
    if (!lanes) return true;
    if (this.lights.signal(I.id, opp, 'straight') === 'red') return true;
    for (const lane of lanes) {
      for (const o of lane.vehicles) {
        const oce = o.nextConnEntry();
        if (!oce || oce.seg.intersection !== I || oce.seg.movement !== 'straight') continue;
        const d = oce.start - o.front;
        if (d < -0.01) continue;
        if (o.reservations.has(I.id)) return false;
        if (o.v > 1.0 && d / o.v < v.p.leftGapTime) return false;
      }
    }
    return true;
  }

  /**
   * Unsignalised nodes: no vehicle with right of way may be on, or about to reach, a crossing path.
   * Returns the vehicle we must yield to, or null.
   */
  priorityYield(v, conn) {
    const I = conn.intersection;
    const conflicts = this.imgr.get(I.id).priorityConflicts(conn);
    for (const pc of conflicts) {
      for (const o of pc.fromLane.vehicles) {
        if (o === v) continue;
        const oce = o.nextConnEntry();
        if (!oce || oce.seg !== pc) continue;
        if (o.reservations.has(I.id)) return o;
        const d = oce.start - o.front;
        if (d < -0.01) continue;
        if (o.v > 0.8 && d / o.v < v.p.leftGapTime) return o;
      }
    }
    return null;
  }

  /**
   * Flashing yellow: a vehicle on a crossing path that came to a stop at its line before v did
   * (and has not gone yet). Arrival order is a strict total order, so waits never form a cycle.
   */
  stopOrderBlocker(v, conn) {
    const I = conn.intersection;
    const mine = v.signStop === I.id ? v.signStopAt : Infinity;
    for (const pc of this.imgr.get(I.id).crossConflicts(conn)) {
      const o = pc.fromLane.vehicles[pc.fromLane.vehicles.length - 1];
      if (!o || o === v || o.signStop !== I.id || o.reservations.has(I.id)) continue;
      const oce = o.nextConnEntry();
      if (!oce || oce.seg !== pc) continue;
      if (o.signStopAt < mine || (o.signStopAt === mine && o.seq < v.seq)) return o;
    }
    return null;
  }

  /**
   * Right turn on red: a vehicle with a green or yellow light whose path crosses or merges into
   * v's, and that is already in the box or about to arrive. Null when the turn is clear.
   */
  rightOnRedBlocker(v, conn) {
    const I = conn.intersection;
    for (const pc of this.imgr.get(I.id).crossConflicts(conn)) {
      const s = this.lights.signal(I.id, pc.arm, pc.movement);
      if (s !== 'green' && s !== 'yellow') continue;
      for (const o of pc.fromLane.vehicles) {
        if (o === v) continue;
        const oce = o.nextConnEntry();
        if (!oce || oce.seg.intersection !== I) continue;
        // Wide-swing twins share the same approach lane: any connector of this lane into the
        // conflicting move counts.
        if (oce.seg.arm !== pc.arm || oce.seg.movement !== pc.movement) continue;
        if (o.reservations.has(I.id)) return o;
        const d = oce.start - o.front;
        if (d < -0.01) continue;
        // Moving traffic within ~3 s, or a green head about to pull away. A green vehicle that is
        // itself held (no exit space, people crossing) does not stop the turn.
        if (o.v > 0.5 && d / o.v < RTOR_GAP) return o;
        if (d < 4 && o.v <= 0.5 && o.blockReason !== 'exit' && o.blockReason !== 'pedestrian' && o.blockReason !== 'box') return o;
      }
      // Vehicles already inside the box on this connector hold its cells; the grid check catches
      // them, but a reservation on the way out still counts as "coming".
      for (const o of pc.vehicles) if (o !== v) return o;
    }
    return null;
  }

  /**
   * May v roll through its stop (right on red, flashing yellow, STOP sign) without coming to a
   * halt? Only when no vehicle is in, or anywhere near, a crossing path and the box is free.
   */
  clearToRoll(v, conn, sig, rtor) {
    const I = conn.intersection;
    const mgr = this.imgr.get(I.id);
    if (mgr.findBlocker(v, conn)) return false;
    if (rtor) return !this.rightOnRedBlocker(v, conn);
    if (sig === 'flash' && this.stopOrderBlocker(v, conn)) return false;
    if (I.kind === 'yield' && this.priorityYield(v, conn)) return false;
    for (const pc of mgr.crossConflicts(conn)) {
      if (pc.vehicles.length) return false;
      for (const o of pc.fromLane.vehicles) {
        const oce = o.nextConnEntry();
        if (!oce || oce.seg.intersection !== I || oce.seg.arm !== pc.arm || oce.seg.movement !== pc.movement) continue;
        if (o.reservations.has(I.id)) return false;
        const d = oce.start - o.front;
        if (d > -0.01 && d < 25) return false;
      }
    }
    return true;
  }

  /** Attempt to reserve the intersection path for v. All safety checks live here. */
  /** True when v is queued in front of an emergency vehicle on its lane into I (it clears the way). */
  isEscort(v, I) {
    // Drivers ahead of a siren do not run the red: they keep their place or move over (LaneChange).
    // Except in the player's contraflow cones: there the one in front of a siren goes on through.
    if (v.emergency) return false;
    const cones = v.cf?.zone;
    if (!this.level.escortsRunRed && !cones) return false;
    for (const c of this.emergencyClaims) {
      if (c.I !== I || !c.lane || c.lane !== v.segment || v.localS <= c.v.localS) continue;
      if (this.level.escortsRunRed || c.v.cf?.zone === cones) return true;
    }
    return false;
  }

  /**
   * The emergency claim v must give way to at I when taking `conn` there, or null. Only movements
   * whose paths cross or merge into the emergency vehicle's path give way; everything else keeps
   * flowing. Without a known connector (v is not heading through I) nothing is claimed.
   */
  emergencyClaimFor(v, I, conn = null) {
    if (v.emergency || !this.emergencyClaims.length || this.hasPass(v)) return null;
    if (!conn) {
      const ce = v.nextConnEntry();
      conn = ce && ce.seg.intersection === I ? ce.seg : v.segment.kind === 'connector' && v.segment.intersection === I ? v.segment : null;
    }
    if (!conn) return null;
    for (const c of this.emergencyClaims) {
      if (c.I !== I || c.v === v) continue;
      if (c.lane && c.lane === v.segment && v.localS > c.v.localS) continue; // escort: goes ahead
      if (!c.conn || c.conn === conn || c.conn.toLane === conn.toLane) return c;
      if (this.imgr.get(I.id).crossConflicts(c.conn).includes(conn)) return c;
      if (c.conn.arm === conn.arm && c.conn.fromLane === conn.fromLane) return c;
    }
    return null;
  }

  tryEnter(v, conn, connStart, distToStop) {
    v.blockerId = null;
    if (!this.isLaneHead(v, v.nextConnEntry())) {
      v.blockReason = 'queue';
      return false;
    }
    const I = conn.intersection;
    // Give way to an emergency vehicle about to cross, unless it is too late to stop comfortably.
    const claim = this.emergencyClaimFor(v, I, conn);
    if (claim && (v.v * v.v) / (2 * v.spec.decel) < distToStop - 0.5) {
      v.blockReason = 'emergency';
      v.blockerId = claim.v.id;
      return false;
    }
    // Someone up the oncoming lane at the line, right where our way out runs (sirens included: two
    // of them would each block the other): it goes first.
    const cfo = this.counterflow.active.length && (v.v * v.v) / (2 * v.spec.decel) < distToStop - 0.5 ? this.counterflow.cfInPath(v, conn, connStart) : null;
    if (cfo) {
      v.blockReason = cfo.cf.emergency ? 'emergency' : 'yield';
      v.blockerId = cfo.id;
      return false;
    }
    const mgr = this.imgr.get(I.id);
    // Box sharing: a cell still held by a vehicle that will be long gone by the time we get there
    // does not block entry (the shared cell is then guarded by sharedLimit).
    const arrival = this.level.boxSharing === false || v.emergency ? null : { dist: Math.max(0, distToStop), v: v.v, a: v.spec.accel * v.p.accelFactor };
    const blocker = mgr.findBlocker(v, conn, arrival);
    if (blocker) {
      v.blockReason = blocker.isPed ? 'pedestrian' : 'box';
      v.blockerId = blocker.id;
      return false;
    }
    // Out in the oncoming lane: people on the half of the crosswalk its reservation does not cover.
    if (v.cf && this.counterflow.pedInPath(v, v.s, connStart + conn.length)) {
      v.blockReason = 'pedestrian';
      return false;
    }
    const sig = I.kind === 'signal' ? this.lights.signal(I.id, conn.arm, conn.movement) : 'green';
    // Padaanin: an enforcer waves this vehicle through its red when nothing crossing is coming.
    const waved = sig === 'red' && v.waved > this.time && this.clearToRoll(v, conn, sig, false);
    const onRed = sig === 'red' && !v.emergency && !this.isEscort(v, I) && !waved;
    if (onRed && conn.movement === 'right') {
      // Right turn on red: give way to everything the green releases across or into our path.
      const g = this.rightOnRedBlocker(v, conn);
      if (g) {
        v.blockReason = 'yield';
        v.blockerId = g.id;
        return false;
      }
    } else if (I.kind === 'signal' && !v.emergency && sig === 'flash') {
      // Flashing yellow works as an all-way stop: whoever stopped at the line first goes first.
      const first = this.stopOrderBlocker(v, conn);
      if (first) {
        v.blockReason = 'yield';
        v.blockerId = first.id;
        return false;
      }
    } else if (I.kind === 'signal') {
      if (conn.movement === 'left' && !this.hasPass(v) && !this.leftGapOk(v, conn)) {
        v.blockReason = 'yield';
        return false;
      }
    } else {
      const yieldTo = this.priorityYield(v, conn);
      if (yieldTo) {
        v.blockReason = 'yield';
        v.blockerId = yieldTo.id;
        return false;
      }
    }
    const space = this.exitSpace(v, conn);
    // On green the box may fill up behind a queue that is still moving out: nobody gets stuck,
    // the vehicle simply rolls on as the exit lane drains.
    const flowing = (space === 'tight' && sig === 'green' && this.exitFlowing(conn)) || (space !== 'strict' && this.hasPass(v));
    // On a green, Filipino drivers cross anyway when the road beyond is full: they fill the box
    // and wait in it for the queue ahead (an enforcer at the junction keeps them honest).
    const fillBox = sig === 'green' && !this.level.waitForExit && !this.enforcement.near(I) && space !== 'strict' && !v.emergency;
    if (space !== 'ok' && !flowing && fillBox) {
      v.boxBlocker = true;
      this.enforcement.mark(v, 'box', 20);
      this.stats.boxBlockEntries++;
    } else if (space !== 'ok' && !flowing) {
      v.blockReason = 'exit';
      if (space === 'strict' || v.emergency || onRed) return false;
      if (distToStop > 3 || v.v > 2 || v.decisionTimer > 0) return false;
      v.decisionTimer = this.rng.range(1.8, 3.2);
      let p = space === 'tight' ? v.p.tightAccept : v.p.noneAccept;
      // Impatient/aggressive drivers whose patience has run out at a green light push in more often.
      // Patient drivers never enter without exit space.
      if (v.p.tightAccept > 0 && v.greenWait > v.p.patience) p += space === 'tight' ? 0.2 : 0.08;
      p *= (this.level.boxBlockFactor ?? 1) * this.disciplineMul;
      if (this.enforcement.near(I)) p *= 0.2; // nobody squeezes in under an enforcer's nose
      if (!this.rng.chance(Math.min(0.95, p))) return false;
      v.boxBlocker = true;
      this.enforcement.mark(v, 'box', 20);
      this.stats.boxBlockEntries++;
      this.scoring.onBoxBlock();
    }
    mgr.reserve(v, conn, connStart);
    conn.toLane.committed.add(v);
    v.blockReason = null;
    if (onRed && conn.movement === 'right') {
      this.stats.rightOnRed = (this.stats.rightOnRed || 0) + 1;
      if (this.stats.rightOnRed === 1) this.notify('RTOR', NOTIFY_TEXT.RTOR, 'info');
    }
    return true;
  }

  /** Is the queue in conn's exit lane still moving out (its last vehicle rolling)? */
  exitFlowing(conn) {
    const lane = conn.toLane;
    if (lane.role === 'link' && lane.endInt && lane.length < 40) return false;
    const last = lane.vehicles[0];
    if (!last) return true;
    for (const b of this.blockages) if (b.active && b.laneObjs.includes(lane)) return false;
    return last.v > 0.8 && last.a > -1.5;
  }

  cancelReservation(v, I) {
    const res = v.reservations.get(I.id);
    if (!res) return;
    res.conn.toLane.committed.delete(v);
    this.imgr.get(I.id).releaseAll(v);
  }

  // ---------------------------------------------------------------- environment
  updatePriority() {
    for (const m of this.lights.managers.values()) m.priorityGroup = null;
    const list = [];
    // Emergency vehicles close to a junction claim it: everyone else there gives way (see tryEnter).
    const claims = [];
    for (const v of this.vehicles) {
      if (!v.emergency) continue;
      const ce = v.nextConnEntry();
      if (!ce || ce.seg.under) continue;
      const dist = ce.start - v.front;
      const I = ce.seg.intersection;
      // An enforcer at the junction stops cross traffic for it twice as far out (escort).
      const reach = EMERGENCY_CLAIM_DIST * (this.enforcement.near(I) ? 2 : 1);
      if (dist > reach) continue;
      // Stuck far back in a queue that is not moving yet: cross traffic need not stop for it.
      if (dist > 35 && v.v < 1 && !this.enforcement.near(I)) continue;
      // Stopped behind a queue at its red (nobody ahead will run it): nothing to give way to yet.
      if (v.v < 1 && !v.cf && !this.level.escortsRunRed && !this.isLaneHead(v, ce)) continue;
      // Stalled (waiting on someone at their own red, a stream of people, a blocked swing-out): the
      // rest of the junction keeps its green until it gets going again. Cross traffic still clearing
      // the box ahead of it does not count as a stall: that is through in a moment.
      if (v.v >= 0.3) v.claimStalled = false;
      else if (v.stoppedTime > EMERGENCY_STALL && !v.claimStalled) {
        const b = v.blockReason === 'box' && this.vehicles.find((o) => o.id === v.blockerId);
        v.claimStalled = !b || b.v < 0.5;
      }
      if (v.claimStalled) continue;
      const lane = v.segment.kind === 'lane' && v.segment.endInt === I ? v.segment : null;
      claims.push({ I, v, lane, dist, conn: ce.seg });
    }
    // A stuck vehicle the player waved through: crossing traffic holds back while it goes.
    for (const v of this.vehicles) {
      if (!this.hasPass(v)) continue;
      const seg = v.segment;
      if (seg.kind === 'connector') claims.push({ I: seg.intersection, v, lane: null, dist: 0, conn: seg, pass: true });
      else {
        const ce = v.nextConnEntry();
        // Not while it sits at its own red: it will not go, so nobody should hold back for it.
        const I = ce?.seg.intersection;
        if (ce && ce.start - v.front < 6 && (I.kind !== 'signal' || this.lights.signal(I.id, ce.seg.arm, ce.seg.movement) !== 'red'))
          claims.push({ I, v, lane: null, dist: ce.start - v.front, conn: ce.seg, pass: true });
      }
    }
    this.emergencyClaims = claims;
    for (const v of this.vehicles) {
      if (!v.emergency || v.emergencyDone) continue;
      const ce = v.nextConnEntry();
      if (!ce || ce.seg.under) continue;
      const dist = ce.start - v.front;
      if (dist > 170) continue;
      const I = ce.seg.intersection;
      const mgr = this.lights.manager(I.id);
      if (!mgr) continue; // no lights to change at U-turn slots and yield junctions
      const group = mgr.phaseFor(ce.seg.arm, ce.seg.movement);
      mgr.priorityGroup = group;
      list.push({ vehicleId: v.id, type: v.type, label: v.spec.label, intersectionId: I.id, arm: ce.seg.arm, group, dist, waiting: v.stoppedTime });
    }
    this.priority = list;
  }

  updateBlockages() {
    if (this.blockages.some((b) => b.random && b.done)) this.blockages = this.blockages.filter((b) => !(b.random && b.done));
    for (const b of this.blockages) {
      if (b.done || b.kind === 'ped' || b.kind === 'laneEnd' || b.kind === 'cf') continue; // pedestrians, lane drops and counterflow manage themselves
      const t = this.scheduleTime;
      if (!b.active && t >= b.start && t < b.end) {
        // A breakdown only "appears" on a free stretch of road.
        const covered = b.laneObjs.some((lane) => lane.vehicles.some((o) => o.localS - o.hl < b.s + 1 && o.localS + o.hl > b.s - 1));
        if (!covered) {
          b.active = true;
          this._blockEntry(b, true);
          this.notify(`BLK_ON_${b.id}`, `${NOTIFY_TEXT.EXIT_BLOCKED}: ${this.exitName(b.exit).toUpperCase()} · ${b.label || ''}`.trim(), 'warn');
        }
      }
      if (b.active && t >= b.end) {
        b.active = false;
        b.done = true;
        this._blockEntry(b, false);
        this.notify(`BLK_OFF_${b.id}`, `${NOTIFY_TEXT.EXIT_CLEARED}: ${this.exitName(b.exit).toUpperCase()}`, 'good');
      }
    }
  }

  /**
   * A blockage just past the junction (roadworks, a breakdown, fire hoses): traffic turning or going
   * straight into that lane takes the lane beside it instead (Network.connectorFor), from now on.
   */
  _blockEntry(b, on) {
    if (on && !(b.s < 45)) return;
    for (const lane of b.laneObjs) {
      const was = !!lane.entryBlocked;
      lane.entryBlocked = this.blockages.some((o) => o.active && o.s < 45 && o.laneObjs.includes(lane) && !['ped', 'laneEnd', 'cf'].includes(o.kind));
      if (lane.entryBlocked && !was) this.counterflow._reroute(lane);
    }
  }

  /** Street name of an exit key ('A:N'), e.g. "Rizal St northbound". */
  exitName(key) {
    const [id, arm] = key.split(':');
    const I = this.network.byId.get(id);
    const name = I ? this.network.roadName(I, arm) : null;
    return name ? `${name} ${{ N: 'northbound', S: 'southbound', E: 'eastbound', W: 'westbound' }[arm]}` : ARM_LABEL[arm];
  }

  downstreamFactor(lane) {
    const w = lane.gateWave;
    const mod = 1 + lane.gateVar * Math.sin((this.time / w.period) * Math.PI * 2 + w.phase);
    return Math.max(0.05, mod);
  }

  updateGates(dt) {
    for (const lane of this.network.exitLanes) {
      const g = lane.gate;
      g.tokens = Math.min(g.cap, g.tokens + lane.gateRate * this.downstreamFactor(lane) * dt);
    }
  }

  /** Route coordinate (front) of the downstream gate for v, or null once passed. */
  gateFront(v) {
    if (v.gatePassed || this.hasPass(v) || v.drain > this.time) return null;
    const exit = v.route.exitLane;
    if (!exit.gate) return null;
    if (v._gateS === undefined) v._gateS = v.route.startOf(exit) + exit.gateLocal;
    return v._gateS;
  }

  // ---------------------------------------------------------------- player + events
  requestPhase(intersectionId, group) {
    const res = this.lights.request(intersectionId, group);
    if (res.early) {
      this.stats.earlyRequests++;
      this.scoring.onEarlyRequest();
    }
    return res;
  }

  /** True while the player's "go ahead" for v is active. */
  hasPass(v) {
    return v.pass !== undefined && v.pass > this.time;
  }

  /** The vehicle under world point (x, y), or null. */
  vehicleAt(x, y, margin = 0.6) {
    let best = null;
    let bestD = Infinity;
    for (const v of this.vehicles) {
      const dx = x - v.x;
      const dy = y - v.y;
      const c = Math.cos(v.angle);
      const sn = Math.sin(v.angle);
      const along = dx * c + dy * sn;
      const across = -dx * sn + dy * c;
      if (Math.abs(along) > v.hl + margin || Math.abs(across) > v.spec.width / 2 + margin) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  /** Is v stuck: stopped in or at the box for a while (and not just waiting at a red)? */
  isStuck(v) {
    if (v.emergency || v.cf || v.v > 0.5 || v.stoppedTime < 1.5) return false;
    if (v.segment.kind === 'connector') return true;
    if (v.state === 'BLOCKED_IN_INTERSECTION') return true;
    const ce = v.nextConnEntry();
    if (!ce || ce.seg.under || ce.start - v.front > 6 || v.reservations.has(ce.seg.intersection.id)) return false;
    return v.signal === 'green' || v.signal === 'flash' || ce.seg.intersection.kind !== 'signal';
  }

  /**
   * The player clicked a stuck vehicle: for 10 s it ignores exit-space courtesy, shared-cell order
   * and the downstream gate, crossing traffic gives way to its path, and the queue ahead of it in
   * its exit lane drains freely. The collision gate still applies, so it simply pulls away as soon
   * as there is physical room.
   */
  grantPass(v, seconds = 10) {
    if (!this.isStuck(v)) return false;
    v.pass = this.time + seconds;
    v.reactTimer = 0;
    v.decisionTimer = 0;
    const ce = v.segment.kind === 'connector' ? null : v.nextConnEntry();
    const exit = v.segment.kind === 'connector' ? v.segment.toLane : ce?.seg.toLane;
    for (const o of exit?.vehicles || []) o.drain = this.time + seconds;
    this.stats.passes = (this.stats.passes || 0) + 1;
    this.notify('PASS', NOTIFY_TEXT.PRIORITY_PASS, 'good');
    this.events.push({ type: 'pass', x: v.x, y: v.y, vehicle: v.id });
    return true;
  }

  /** A jeepney / tricycle has stopped at the corner: passengers call it and step off. */
  onCornerStop(v, C) {
    this.stats.cornerStops = (this.stats.cornerStops || 0) + 1;
    const lines = ['PARA PO!', 'BABA!', 'DITO LANG PO!', 'SAKAY NA!'];
    v.say = lines[(v.seq + this.stats.cornerStops) % lines.length];
    v.sayTimer = 1.8;
    this.notify('CORNER_STOP', NOTIFY_TEXT.CORNER_STOP, 'info');
    this.enforcement.mark(v, 'stop', C.duration + 3);
    this.peds.alight?.(v, C.I, C.conn.exitArm);
  }

  /** Flashing yellow at a node: every approach stops, then goes in arrival order when clear. */
  requestFlash(intersectionId) {
    const res = this.lights.requestFlash(intersectionId);
    if (res.status === 'accepted') this.notify(`FLASH:${intersectionId}`, NOTIFY_TEXT.FLASH, 'info');
    return res;
  }

  notify(key, text, severity = 'info') {
    const last = this.notifyCooldown.get(key);
    const cooldown = key.startsWith('HEAVY') ? 25 : 8;
    if (last !== undefined && this.time - last < cooldown) return;
    this.notifyCooldown.set(key, this.time);
    this.events.push({ type: 'notify', key, text, severity });
  }

  emitHorn(v, double) {
    this.stats.horns++;
    this.stats.hornTimes.push(this.time);
    this.events.push({ type: 'horn', horn: v.spec.horn, x: v.x, y: v.y, double, vehicleType: v.type, vehicle: v.id });
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // ---------------------------------------------------------------- metrics
  computeMetrics(dt) {
    const m = this._emptyMetrics();
    const vehicles = this.vehicles;
    let speedSum = 0;
    let longWaiters = 0;
    const activeWaits = [];
    for (const v of vehicles) {
      speedSum += v.v;
      if (v.waitTime > 60) longWaiters++;
      if (v.waitTime > 1) activeWaits.push(v.waitTime);
    }
    m.vehicles = vehicles.length;
    m.avgSpeed = vehicles.length ? speedSum / vehicles.length : 0;
    const waits = this.stats.recentWaits.concat(activeWaits);
    m.avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
    m.overallWait = this.stats.processed ? this.stats.totalWait / this.stats.processed : m.avgWait;
    m.processed = this.stats.processed;
    m.pending = this.spawner.pendingCount();
    m.horns = this.stats.horns;
    const ht = this.stats.hornTimes;
    while (ht.length && ht[0] < this.time - 10) ht.shift();
    m.hornRate = ht.length;
    m.volume = this.spawner.volumePerMinute();

    // Box membership (smoothed so crawling, intermittently-moving blockers still count).
    for (const v of vehicles) {
      v._box = null;
      for (const I of this.network.intersections) {
        if (Math.abs((v.layer || 0) - I.layer) < 0.75 && Network.inCore(I, v.x, v.y)) {
          v._box = I.id;
          break;
        }
      }
      v.boxTime = v._box ? v.boxTime + dt : 0;
    }

    let worst = CONGESTION.NORMAL;
    let congestion = 0;
    let gridlockTime = 0;
    for (const I of this.network.intersections) {
      const approaches = [];
      const mgr = this.lights.manager(I.id);
      let capacity = 0;
      for (const arm of ARMS) {
        const lanes = I.approachLanes[arm];
        if (!lanes) continue;
        let queue = 0;
        let headWait = 0;
        let headReason = null;
        let anyHead = false;
        let allYield = true;
        let lastCross = -Infinity;
        let exitLanes = 0;
        for (const lane of lanes) {
          if (lane.type === 'tunnel' && I.def.underpass) continue; // through traffic below the junction
          capacity += 10;
          queue += this.spawner.pendingFor(lane);
          for (const o of lane.vehicles) if (o.v < 1.5) queue++;
          if (lane.lastCross !== undefined && lane.lastCross > lastCross) lastCross = lane.lastCross;
          const lead = lane.vehicles[lane.vehicles.length - 1];
          if (lead && !lead.reservations.has(I.id) && lane.length - lead.localS - lead.hl < 8) {
            anyHead = true;
            // Yielding to oncoming traffic, an emergency vehicle or people on the crosswalk is not a blockage.
            // A left turner held at its red while the opposite road shares the green is waiting for its own light.
            if (!['yield', 'emergency', 'pedestrian', 'signal', 'toll'].includes(lead.blockReason)) allYield = false;
            if (lead.blockReason === 'exit' && lead.greenWait >= 5) exitLanes++;
            if (lead.greenWait >= headWait) {
              headWait = lead.greenWait;
              headReason = lead.blockReason;
            }
          }
        }
        m.longestQueue = Math.max(m.longestQueue, queue);
        // Minor arms of a yield junction wait for gaps by design; they never count as "green but stuck".
        const signal = I.kind === 'yield' && !I.major.has(arm) ? 'yield' : this.lights.signal(I.id, arm);
        // "Green but stuck": green long enough and nothing from this approach has crossed recently.
        // Without lights, quiet spells are normal: count how long the head has actually been stuck.
        const stuckFor = signal !== 'green' ? 0 : mgr ? Math.min(mgr.timer, this.time - lastCross) : headWait;
        approaches.push({
          arm,
          signal,
          queue,
          headStoppedTime: stuckFor,
          headWait,
          headReason,
          exitLanes,
          // Yielding to oncoming traffic is normal, not a blockage.
          headBlocked: signal === 'green' && anyHead && !allYield && stuckFor >= 6,
        });
      }
      let boxStopped = 0;
      let boxCount = 0;
      for (const v of vehicles) {
        if (v._box !== I.id) continue;
        boxCount++;
        // A jeepney dropping off at the corner is loading, not stuck.
        if (v.avgSpeed < 0.7 && v.boxTime > 3 && v.cornerStop?.state !== 'stopped') boxStopped++;
      }
      const exitsBlocked = approaches.reduce((n, a) => n + a.exitLanes, 0);
      const det = this.detectors.get(I.id);
      const r = det.update(dt, { approaches, boxStopped, exitsBlocked, capacity, pending: 0 });
      for (const e of r.events) {
        if (e.key === 'RECOVERED') {
          this.scoring.onRecovery(e.from);
          continue;
        }
        const text = this.multi ? `${e.text} · ${I.id}` : e.text;
        const sev = e.key === 'RESTORED' ? 'good' : e.key === 'HEAVY_TRAFFIC' || e.key === 'RECOVERY' ? 'info' : 'danger';
        this.notify(`${e.key}_${I.id}`, text, sev);
      }
      if (rankOf(r.level) > rankOf(worst)) worst = r.level;
      congestion = Math.max(congestion, det.congestion);
      gridlockTime += det.gridlockTime;
      m.blockedApproaches += det.blockedApproaches;
      m.boxStopped += boxStopped;
      m.perIntersection.push({ id: I.id, kind: I.kind, level: r.level, congestion: det.congestion, approaches, boxCount, boxStopped });
    }
    m.level = worst;
    m.congestion = congestion;
    m.gridlockTime = gridlockTime;
    const ps = this.peds.stats;
    m.pedsWaiting = ps.waiting;
    m.pedMaxWait = ps.maxWait;
    m.pedsCrossed = ps.crossed;
    this.hornIntensity = 1 + 1.4 * congestion + (worst === CONGESTION.GRIDLOCK ? 0.6 : 0);
    if (m.hornRate >= 14) this.notify('HEAVY_HONKING', NOTIFY_TEXT.HEAVY_HONKING, 'warn');
    this.scoring.update(dt, worst, longWaiters);
    this.metrics = m;
    return m;
  }

  // ---------------------------------------------------------------- scenario helpers
  get scheduleTime() {
    return this.time - this.scheduleOffset;
  }

  /** Run real simulation before the player takes over. shiftSchedule: scripted events start afterwards. */
  runWarmup(warmup, { shiftSchedule = false } = {}) {
    if (!warmup) return;
    if (shiftSchedule) this.scheduleOffset = 1e9;
    const reqs = [...(warmup.requests || [])].sort((a, b) => a.t - b.t);
    const steps = Math.round(warmup.seconds / SIM_DT);
    for (let i = 0; i < steps; i++) {
      while (reqs.length && reqs[0].t <= this.time) {
        const r = reqs.shift();
        this.lights.request(r.id, r.group);
      }
      this.step(SIM_DT);
    }
    if (shiftSchedule) this.scheduleOffset = this.time;
    this.resetStats();
    this.events = [];
  }

  emergencySummary() {
    const delays = this.stats.emergencyDelays;
    return {
      arrivals: this.stats.emergencyArrivals,
      cleared: delays.length,
      worst: delays.length ? Math.max(...delays) : 0,
      avg: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
    };
  }
}
