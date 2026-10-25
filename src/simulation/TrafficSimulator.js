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

const METRIC_INTERVAL = 0.25;
const PROBE_MARGIN = 16; // look-ahead probing starts this far outside a node's stop lines
const EMERGENCY_CLAIM_DIST = 60; // an emergency vehicle this close to a stop line holds that junction

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
    // Downstream discharge (the next, off-map intersection). Per-exit overrides let a level make one
    // direction a chronic bottleneck whose queue can spill back into the box.
    const ds = level.downstream || {};
    for (const lane of this.network.exitLanes) {
      const o = ds.exits?.[lane.exitKey] || {};
      const gateAt = o.gateAt ?? ds.gateAt ?? null;
      const stop = lane.startInt.arms[lane.startArm].exitStop;
      lane.gateLocal = gateAt ? Math.min(lane.length - 0.5, Math.max(20, gateAt - stop)) : lane.length - 0.5;
      lane.gateVisible = !!gateAt;
      lane.gateRate = o.rate ?? ds.rate ?? 0.9;
      lane.gateVar = o.variability ?? ds.variability ?? 0;
      lane.gateWave = { phase: this.rng.range(0, Math.PI * 2), period: this.rng.range(45, 85) };
      lane.gate.tokens = 1;
    }
    this.resetStats();
    this.spawner = new VehicleSpawner(this);
    this.peds = new PedestrianManager(this);
    this.metrics = this._emptyMetrics();
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
    this.time += dt;
    this.env.update(dt, this.scheduleTime);
    this.lights.update(dt);
    this.updatePriority();
    this.updateBlockages();
    this.peds.update(dt);
    this.spawner.update(dt);
    this.updateGates(dt);

    const vehicles = this.vehicles;
    this.laneChanger.update();
    this.collision.rebuild(vehicles);
    for (let i = 0; i < vehicles.length; i++) this.ai.decide(vehicles[i]);
    for (let i = 0; i < vehicles.length; i++) this.move(vehicles[i], dt);
    this.postMove();
    for (let i = 0; i < this.vehicles.length; i++) this.ai.updateAfterMove(this.vehicles[i], dt);

    this._metricTimer += dt;
    if (this._metricTimer >= METRIC_INTERVAL) {
      this.computeMetrics(this._metricTimer);
      this._metricTimer = 0;
    }
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
    if (ce && !v.reservations.has(ce.seg.intersection.id)) lim = ce.start - 0.05;
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
      if (ce && v.front >= ce.start && v.reservations.has(ce.seg.intersection.id)) {
        if (v.emergency && !v.emergencyDone) this._emergencyCleared(v, ce);
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
    if (idx >= 0 && idx + 1 < list.length) {
      const o = list[idx + 1];
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

  /** Attempt to reserve the intersection path for v. All safety checks live here. */
  /** True when v is queued in front of an emergency vehicle on its lane into I (it clears the way). */
  isEscort(v, I) {
    if (v.emergency) return false;
    for (const c of this.emergencyClaims) {
      if (c.I === I && c.lane && c.lane === v.segment && v.localS > c.v.localS) return true;
    }
    return false;
  }

  /** The emergency claim v must give way to at I, or null. */
  emergencyClaimFor(v, I) {
    if (v.emergency) return null;
    for (const c of this.emergencyClaims) {
      if (c.I !== I) continue;
      if (c.lane && c.lane === v.segment && v.localS > c.v.localS) continue; // escort: goes ahead
      return c;
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
    const claim = this.emergencyClaimFor(v, I);
    if (claim && (v.v * v.v) / (2 * v.spec.decel) < distToStop - 0.5) {
      v.blockReason = 'emergency';
      v.blockerId = claim.v.id;
      return false;
    }
    const mgr = this.imgr.get(I.id);
    const blocker = mgr.findBlocker(v, conn);
    if (blocker) {
      v.blockReason = blocker.isPed ? 'pedestrian' : 'box';
      v.blockerId = blocker.id;
      return false;
    }
    if (I.kind === 'signal') {
      if (conn.movement === 'left' && !this.leftGapOk(v, conn)) {
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
    if (space !== 'ok') {
      v.blockReason = 'exit';
      if (space === 'strict' || v.emergency) return false;
      if (distToStop > 3 || v.v > 2 || v.decisionTimer > 0) return false;
      v.decisionTimer = this.rng.range(1.8, 3.2);
      let p = space === 'tight' ? v.p.tightAccept : v.p.noneAccept;
      // Impatient/aggressive drivers whose patience has run out at a green light push in more often.
      // Patient drivers never enter without exit space.
      if (v.p.tightAccept > 0 && v.greenWait > v.p.patience) p += space === 'tight' ? 0.2 : 0.08;
      p *= this.level.boxBlockFactor ?? 1;
      if (!this.rng.chance(Math.min(0.95, p))) return false;
      v.boxBlocker = true;
      this.stats.boxBlockEntries++;
      this.scoring.onBoxBlock();
    }
    mgr.reserve(v, conn, connStart);
    conn.toLane.committed.add(v);
    v.blockReason = null;
    return true;
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
      if (!ce) continue;
      const dist = ce.start - v.front;
      if (dist > EMERGENCY_CLAIM_DIST) continue;
      const I = ce.seg.intersection;
      const lane = v.segment.kind === 'lane' && v.segment.endInt === I ? v.segment : null;
      claims.push({ I, v, lane, dist });
    }
    this.emergencyClaims = claims;
    for (const v of this.vehicles) {
      if (!v.emergency || v.emergencyDone) continue;
      const ce = v.nextConnEntry();
      if (!ce) continue;
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
    for (const b of this.blockages) {
      if (b.done || b.kind === 'ped') continue; // pedestrians manage their own blockages
      const t = this.scheduleTime;
      if (!b.active && t >= b.start && t < b.end) {
        // A breakdown only "appears" on a free stretch of road.
        const covered = b.laneObjs.some((lane) => lane.vehicles.some((o) => o.localS - o.hl < b.s + 1 && o.localS + o.hl > b.s - 1));
        if (!covered) {
          b.active = true;
          const [, arm] = b.exit.split(':');
          this.notify(`BLK_ON_${b.id}`, `${NOTIFY_TEXT.EXIT_BLOCKED}: ${ARM_LABEL[arm].toUpperCase()} · ${b.label || ''}`.trim(), 'warn');
        }
      }
      if (b.active && t >= b.end) {
        b.active = false;
        b.done = true;
        const [, arm] = b.exit.split(':');
        this.notify(`BLK_OFF_${b.id}`, `${NOTIFY_TEXT.EXIT_CLEARED}: ${ARM_LABEL[arm].toUpperCase()}`, 'good');
      }
    }
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
    if (v.gatePassed) return null;
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
    this.events.push({ type: 'horn', horn: v.spec.horn, x: v.x, y: v.y, double, vehicleType: v.type });
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
        if (Network.inCore(I, v.x, v.y)) {
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
          capacity += 10;
          queue += this.spawner.pendingFor(lane);
          for (const o of lane.vehicles) if (o.v < 1.5) queue++;
          if (lane.lastCross !== undefined && lane.lastCross > lastCross) lastCross = lane.lastCross;
          const lead = lane.vehicles[lane.vehicles.length - 1];
          if (lead && !lead.reservations.has(I.id) && lane.length - lead.localS - lead.hl < 8) {
            anyHead = true;
            // Yielding to oncoming traffic, an emergency vehicle or people on the crosswalk is not a blockage.
            if (lead.blockReason !== 'yield' && lead.blockReason !== 'emergency' && lead.blockReason !== 'pedestrian') allYield = false;
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
        if (v.avgSpeed < 0.7 && v.boxTime > 3) boxStopped++;
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
