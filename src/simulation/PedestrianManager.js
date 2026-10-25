// Pedestrians: people crossing at signalised crosswalks, pasaway jaywalkers crossing mid-block, and
// strollers on the sidewalks. DOM-free, runs headless in the tests.
//
// Safety, same rules as for vehicles:
//   - A crossing pedestrian reserves its crosswalk line in the junction's conflict grid, the very
//     cells vehicles reserve for their paths. Neither can enter space the other holds.
//   - A jaywalker steps off the curb only when every vehicle heading for that spot can still stop
//     comfortably, and then acts as a blockage on each lane until it has crossed it.
//   - Strollers stay on the sidewalk.
//
// Level config (all optional):
//   pedestrians: {
//     cross: 2,        // people per minute arriving at each crosswalk
//     jaywalk: 1,      // jaywalkers per minute on the whole map
//     strollers: 1.5,  // people per minute entering each sidewalk from the map edge
//     patience: [35, 70],  // seconds at a red before some cross anyway
//     mix: { adult: 0.6, student: 0.25, elderly: 0.1, vendor: 0.05 },
//   }
// Maps can list arms without a crosswalk: node.noCrossing = ['N', 'S'] (footbridges on EDSA).
// The manager has its own random stream, so traffic on levels without pedestrians is unchanged.

import { Rng, Path, pointSegDist2 } from '../utils/math.js';
import { ARMS, DIRS, LANE_WIDTH, SIDEWALK_WIDTH, OPPOSITE } from '../data/config.js';
import { rightOf, leftOf } from './LaneManager.js';
import { PHASE } from './TrafficPhaseManager.js';

export const PED_SPEC = Object.freeze({ key: 'ped', length: 0.6, width: 0.6 });
export const PED_RADIUS = 0.3;

const SW = SIDEWALK_WIDTH;
const CURB = 0.5; // crossing lines start and end this far onto the sidewalk
const LONG_WAIT = 45; // seconds: waiting longer than this costs points
const MAX_PEDS = 260;
// Turning paths can cut across a sidewalk corner (a narrow road meeting a wide one): people keep
// this far from any path a vehicle can take (widest half-width + body + a margin).
const TURN_CLEAR = 1.3 + PED_RADIUS + 0.35;
const CLEAR_STEP = 0.5; // m along the road between samples of the clearance table
const CLEAR_SPAN = 30; // m from the node centre covered by the table

const SHIRTS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f5f5f4', '#1f2937', '#84cc16', '#14b8a6', '#b45309', '#64748b'];
const HAIR = ['#1c1917', '#292524', '#3f2a1d', '#44403c', '#1f1a17'];
const GREY = ['#d6d3d1', '#a8a29e', '#e7e5e4'];
const UMBRELLAS = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0f172a', '#db2777', '#0891b2'];
const BAGS = ['#1e3a8a', '#7f1d1d', '#14532d', '#111827', '#9d174d'];
const KINDS = {
  adult: { speed: [1.15, 1.45] },
  student: { speed: [1.25, 1.55] },
  elderly: { speed: [0.75, 0.95] },
  vendor: { speed: [0.9, 1.1] },
};

const armOf = (v) => ARMS.find((a) => Math.abs(DIRS[a].x - v.x) < 1e-6 && Math.abs(DIRS[a].y - v.y) < 1e-6) || null;

/** Lane coordinate of road distance u, for a lane on centre line g or on g walked backwards. */
export function laneSAt(lane, g, u) {
  const uu = lane.center === g ? u : g.length - u;
  return lane.cReversed ? lane.cu1 - uu : uu - lane.cu0;
}

/** Lateral offset of a lane in g's frame. */
function laneOffsetOn(lane, g) {
  return lane.center === g ? lane.cOffset : -lane.cOffset;
}

const _pt = {};

export class PedestrianManager {
  constructor(sim) {
    this.sim = sim;
    this.peds = [];
    this.crossings = [];
    this.crossingAt = new Map();
    this.sites = [];
    this.seq = 0;
    this.clearance = new Map();
    this.resetStats();
    const cfg = sim.level.pedestrians;
    this.cfg = cfg
      ? { cross: 0, jaywalk: 0, strollers: 0, patience: [35, 70], join: 0.3, ...cfg, mix: cfg.mix || { adult: 0.6, student: 0.25, elderly: 0.1, vendor: 0.05 } }
      : null;
    this.rng = new Rng(((sim.seed ?? 1) ^ 0x7f4a7c15) >>> 0);
    if (!this.cfg) return;
    if (this.cfg.cross > 0) this._buildCrossings();
    if (this.cfg.jaywalk > 0) this._buildSites();
    this.jayTimer = this.cfg.jaywalk > 0 ? this.rng.exp(this.cfg.jaywalk / 60) : Infinity;
    // Sidewalk ends at the map edge, two per external road.
    this.ends = [];
    for (const I of sim.network.intersections) {
      if (I.layer !== 0) continue; // no sidewalks up on the expressway
      for (const arm of ARMS) {
        if (I.arms[arm].type !== 'external') continue;
        for (const side of [-1, 1]) this.ends.push({ I, arm, side, timer: this.cfg.strollers > 0 ? this.rng.exp(this.cfg.strollers / 60) : Infinity });
      }
    }
    this._seedStrollers();
  }

  resetStats() {
    this.stats = { crossed: 0, totalWait: 0, redCrossers: 0, jaywalkers: 0, waiting: 0, maxWait: 0, longWaiting: 0 };
  }

  get enabled() {
    return !!this.cfg;
  }

  // ------------------------------------------------------------------ setup
  _buildCrossings() {
    for (const I of this.sim.network.intersections) {
      if (I.kind !== 'signal') continue;
      const grid = this.sim.imgr.get(I.id);
      const skip = new Set(I.def.noCrossing || []);
      for (const arm of ARMS) {
        const A = I.arms[arm];
        if (A.type === 'none' || A.cwStart == null || skip.has(arm)) continue;
        const g = A.center;
        const edge = A.half + CURB;
        const lines = {};
        for (const from of [-1, 1]) {
          // One walking line per direction so people pass each other.
          const u = A.cwStart + (from < 0 ? 1.0 : 2.0);
          const a = g.point(u, from * edge);
          const b = g.point(u, -from * edge);
          const conn = { id: `ped:${I.id}:${arm}:${from}`, path: new Path([a, b]), ped: true, intersection: I };
          lines[from] = { from, u, conn, fp: grid.footprint(conn, PED_SPEC), length: conn.path.length };
        }
        const c = { I, arm, A, g, grid, lines, timer: this.rng.exp(this.cfg.cross / 60) };
        this.crossings.push(c);
        this.crossingAt.set(`${I.id}:${arm}`, c);
      }
    }
  }

  _buildSites() {
    const net = this.sim.network;
    for (const I of net.intersections) {
      // Nobody walks across an expressway, a ramp or a road with a tunnel trench in the middle.
      if (I.layer !== 0 || I.def.underpass) continue;
      for (const arm of ARMS) {
        const A = I.arms[arm];
        if (A.type === 'link' && net.byId.get(A.other).layer !== 0) continue;
        if (A.type === 'external') {
          const u0 = A.stop + 18;
          const u1 = A.length - 45;
          if (u1 > u0 + 5) this.sites.push({ I, arm, g: A.center, half: A.half, u0, u1, lanes: [...(I.approachLanes[arm] || []), ...(I.exitLanes[arm] || [])] });
        } else if (A.type === 'link' && A.link.a === I.id && A.link.aArm === arm) {
          const B = net.byId.get(A.other);
          const u0 = A.stop + 18;
          const u1 = A.center.length - B.arms[A.link.bArm].stop - 18;
          if (u1 > u0 + 5) this.sites.push({ I, arm, g: A.center, half: A.half, u0, u1, lanes: [...(I.exitLanes[arm] || []), ...(I.approachLanes[arm] || [])] });
        }
      }
    }
  }

  _seedStrollers() {
    if (!(this.cfg.strollers > 0)) return;
    for (const e of this.ends) {
      const A = e.I.arms[e.arm];
      const n = Math.round(this.cfg.strollers * 1.4);
      for (let i = 0; i < n; i++) {
        const p = this._newPed();
        p.road = { I: e.I, arm: e.arm };
        p.side = e.side;
        p.u = this.rng.range(this._corner(e.I, e.arm, e.side).u + 4, A.length);
        p.dir = this.rng.chance(0.5) ? 1 : -1;
        this._place(p);
        this.peds.push(p);
      }
    }
  }

  _newPed(kind = null) {
    const rng = this.rng;
    const k = kind || rng.weighted(this.cfg.mix);
    const spec = KINDS[k] || KINDS.adult;
    return {
      id: `P${++this.seq}`,
      isPed: true,
      kind: k,
      look: {
        shirt: k === 'student' ? '#f8fafc' : rng.pick(SHIRTS),
        hair: k === 'elderly' ? rng.pick(GREY) : rng.pick(HAIR),
        umbrella: rng.pick(UMBRELLAS),
        sunUmbrella: rng.chance(0.08),
        rainUmbrella: rng.chance(0.85),
        bag: k === 'student' ? rng.pick(BAGS) : null,
      },
      speed: rng.range(...spec.speed),
      reservations: new Map(),
      x: 0,
      y: 0,
      angle: 0,
      state: 'walk',
      moving: true,
      step: rng.range(0, 6),
      wait: 0,
      patience: rng.range(...this.cfg.patience),
      shout: 0,
      red: false,
      road: null,
      u: 0,
      side: 1,
      lat: rng.range(0.9, SW - 0.8),
      dir: -1,
      decided: false,
      goal: null,
      cross: null,
      jay: null,
      gone: false,
    };
  }

  // ------------------------------------------------------------------ signals
  /** 'walk' | 'flash' | 'stop' | 'gap' (flashing yellow: cross when clear) for the crosswalk across arm c.arm. */
  walkState(c) {
    const m = this.sim.lights.manager(c.I.id);
    if (!m) return 'walk';
    if (m.state === PHASE.FLASH) return 'gap';
    if (m.state === PHASE.ALL_RED) return 'stop';
    // Only the crosswalk on the right of a green road walks: its straight and left traffic never
    // drives over it, and its right turners give way to people (the shared conflict grid).
    let walk = false;
    for (const arm of ARMS) {
      if (!c.I.approachLanes[arm]) continue;
      const s = m.signalForArm(arm, 'straight');
      if (s === 'red') continue;
      if (arm === c.arm) return 'stop'; // traffic on this road is moving
      if (armOf(rightOf({ x: -DIRS[arm].x, y: -DIRS[arm].y })) === c.arm) walk = true;
      else if (m.signalForArm(arm, 'left') !== 'red' && armOf(leftOf({ x: -DIRS[arm].x, y: -DIRS[arm].y })) === c.arm) return 'stop';
      else if (armOf({ x: -DIRS[arm].x, y: -DIRS[arm].y }) === c.arm) return 'stop'; // straight across it
    }
    if (!walk) return 'stop';
    return m.state === PHASE.GREEN ? 'walk' : 'flash';
  }

  // ------------------------------------------------------------------ sidewalk geometry
  /**
   * Where the sidewalk on `side` of arm `arm` ends at its node and where it continues:
   * the adjacent road round the corner, the road straight on (T-junctions, U-turn slots), or nothing.
   */
  _corner(I, arm, side) {
    const o = DIRS[arm];
    if (I.kind !== 'uturn') {
      const adj = side > 0 ? armOf(rightOf(o)) : armOf(leftOf(o));
      if (adj && I.arms[adj].type !== 'none') {
        const cross = arm === 'N' || arm === 'S' ? I.hy : I.hx;
        const crossAdj = adj === 'N' || adj === 'S' ? I.hy : I.hx;
        return { u: cross + SW / 2, next: { arm: adj, side: -side, u: crossAdj + SW / 2 }, blend: true };
      }
    }
    const opp = OPPOSITE[arm];
    if (I.arms[opp].type !== 'none') return { u: 0, next: { arm: opp, side: -side, u: 0 }, blend: false };
    return { u: I.kind === 'uturn' ? 0 : (arm === 'N' || arm === 'S' ? I.hy : I.hx) + SW / 2, next: null, blend: false };
  }

  /**
   * A jeepney or tricycle stopped at the corner of `exitArm`: 1–3 passengers step off onto that
   * corner's sidewalk (the exit side), and people strolling right there may hop on.
   */
  alight(v, I, exitArm) {
    if (!this.cfg || I.arms[exitArm]?.type === 'none') return;
    const rng = this.rng;
    const side = 1; // exit lanes run on the right of the outward direction
    const base = this._corner(I, exitArm, side).u;
    for (const p of this.peds) {
      if (p.state !== 'walk' || p.road?.I !== I || p.road.arm !== exitArm || p.side !== side) continue;
      if (Math.abs(p.u - base) < 6 && rng.chance(0.5)) p.gone = true; // boarded
    }
    const n = rng.int(1, 3);
    for (let i = 0; i < n && this.peds.length < MAX_PEDS; i++) {
      const p = this._newPed();
      p.road = { I, arm: exitArm };
      p.side = side;
      p.u = base + rng.range(0.5, 3.5);
      p.dir = rng.chance(0.6) ? 1 : -1;
      this._place(p);
      this.peds.push(p);
    }
  }

  /**
   * Smallest distance from the kerb (into the sidewalk) that keeps a person clear of every turning
   * path at node I, at road distance u along arm `arm` on `side`. Tabulated once per sidewalk.
   */
  minLat(I, arm, side, u) {
    if (u > CLEAR_SPAN) return 0;
    const key = `${I.id}:${arm}:${side}`;
    let t = this.clearance.get(key);
    if (!t) {
      t = this._clearanceTable(I, arm, side);
      this.clearance.set(key, t);
    }
    const i = Math.max(0, Math.min(t.length - 1, Math.round(u / CLEAR_STEP)));
    return t[i];
  }

  _clearanceTable(I, arm, side) {
    const A = I.arms[arm];
    const n = Math.ceil(CLEAR_SPAN / CLEAR_STEP) + 1;
    const t = new Float32Array(n);
    const paths = I.connectors.map((c) => c.path);
    const clear = (x, y) => {
      for (const P of paths) {
        for (let i = 1; i < P.n; i++) {
          if (pointSegDist2(x, y, P.xs[i - 1], P.ys[i - 1], P.xs[i], P.ys[i]) < TURN_CLEAR * TURN_CLEAR) return false;
        }
      }
      return true;
    };
    for (let i = 0; i < n; i++) {
      const u = i * CLEAR_STEP;
      let lat = 0;
      while (lat < SW - 0.3) {
        A.center.point(u, side * (A.half + lat), _pt);
        if (clear(_pt.x, _pt.y)) break;
        lat += 0.25;
      }
      t[i] = Math.min(lat, SW - 0.3);
    }
    return t;
  }

  /** Position a sidewalk walker. Near a corner they drift to the middle of the sidewalk. */
  _place(p) {
    const A = p.road.I.arms[p.road.arm];
    const c = this._corner(p.road.I, p.road.arm, p.side);
    const k = c.blend ? Math.min(1, Math.max(0, (p.u - c.u) / 5)) : 1;
    const lat = Math.max(SW / 2 + (p.lat - SW / 2) * k, this.minLat(p.road.I, p.road.arm, p.side, p.u));
    A.center.point(p.u, p.side * (A.half + lat), _pt);
    p.x = _pt.x;
    p.y = _pt.y;
    p.angle = _pt.angle + (p.dir < 0 ? Math.PI : 0);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (!this.cfg) return;
    this._spawn(dt);
    let waiting = 0;
    let maxWait = 0;
    let longWaiting = 0;
    for (const p of this.peds) {
      p.moving = true;
      switch (p.state) {
        case 'walk':
          this._walk(p, dt);
          break;
        case 'wait':
          this._waitAtCrossing(p, dt);
          break;
        case 'cross':
          this._crossing(p, dt);
          break;
        case 'jaywait':
          this._jayWait(p, dt);
          break;
        case 'jaywalk':
          this._jayWalk(p, dt);
          break;
        default:
          break;
      }
      if (p.moving) p.step += dt * p.speed * 2.4;
      if (p.shout > 0) p.shout -= dt;
      if (p.state === 'wait') {
        waiting++;
        if (p.wait > maxWait) maxWait = p.wait;
        if (p.wait > LONG_WAIT) longWaiting++;
      }
    }
    if (this.peds.some((p) => p.gone)) {
      const keep = [];
      for (const p of this.peds) {
        if (!p.gone) keep.push(p);
        else for (const id of [...p.reservations.keys()]) this.sim.imgr.get(id).releasePedAll(p);
      }
      this.peds = keep;
    }
    this.stats.waiting = waiting;
    this.stats.maxWait = maxWait;
    this.stats.longWaiting = longWaiting;
    this.sim.scoring.pedWaiting?.(dt, longWaiting);
    if (maxWait > 50) this.sim.notify('PEDESTRIANS_WAITING', 'PEDESTRIANS WAITING TO CROSS', 'warn');
  }

  _spawn(dt) {
    const rng = this.rng;
    const room = this.peds.length < MAX_PEDS;
    // Strollers entering from the map edge
    for (const e of this.ends) {
      e.timer -= dt;
      if (e.timer > 0) continue;
      e.timer = rng.exp(this.cfg.strollers / 60);
      if (!room) continue;
      const p = this._newPed();
      p.road = { I: e.I, arm: e.arm };
      p.side = e.side;
      p.u = e.I.arms[e.arm].length + 20;
      p.dir = -1;
      this._place(p);
      this.peds.push(p);
    }
    // People heading for a crosswalk (they come out of the shops near the corner)
    for (const c of this.crossings) {
      c.timer -= dt;
      if (c.timer > 0) continue;
      c.timer = rng.exp(this.cfg.cross / 60);
      const from = rng.chance(0.5) ? 1 : -1;
      const queued = this.peds.filter((q) => q.goal?.c === c && q.goal.from === from).length;
      if (!room || queued >= 12) continue;
      const p = this._newPed();
      p.road = { I: c.I, arm: c.arm };
      p.side = from;
      p.u = c.lines[from].u + rng.range(8, 18);
      p.dir = -1;
      p.decided = true;
      this._setGoal(p, c, from);
      this._place(p);
      this.peds.push(p);
    }
    // Pasaway
    this.jayTimer -= dt;
    if (this.jayTimer <= 0) {
      this.jayTimer = rng.exp(this.cfg.jaywalk / 60);
      if (room && this.sites.length) this._spawnJaywalker();
    }
  }

  /**
   * Waiting spot: back from the kerb and beside the crosswalk. Turning vehicles sweep the rounded
   * corner (curb radius 4 m), so people stand at least ~0.6 m inside it.
   */
  _setGoal(p, c, from) {
    let waitU = c.A.cwStart + this.rng.range(0.8, 3.2);
    let waitLat = this.rng.range(1.8, 3.2);
    // Step back along the sidewalk until the spot is clear of turning vehicles.
    for (let k = 0; k < 24 && this.minLat(c.I, c.arm, from, waitU) > waitLat; k++) {
      waitLat = Math.min(SW - 0.4, Math.max(waitLat, this.minLat(c.I, c.arm, from, waitU)));
      if (this.minLat(c.I, c.arm, from, waitU) > waitLat) waitU += 0.5;
    }
    p.goal = { c, from, waitU, waitLat };
  }

  _walk(p, dt) {
    const I = p.road.I;
    const A = I.arms[p.road.arm];
    p.u += p.dir * p.speed * dt;
    if (p.dir > 0) {
      if (A.type === 'external') {
        if (p.u > A.length + 25) p.gone = true;
      } else if (A.type === 'link' && p.u >= A.center.length / 2 && this.sim.network.byId.get(A.other).layer !== 0) {
        p.dir = -1; // the sidewalk ends where the ramp climbs: walk back
      } else if (A.type === 'link' && p.u >= A.center.length / 2) {
        const B = this.sim.network.byId.get(A.other);
        const bArm = A.link.a === I.id ? A.link.bArm : A.link.aArm;
        p.road = { I: B, arm: bArm };
        p.u = B.arms[bArm].center.length - p.u;
        p.side = -p.side;
        p.dir = -1;
        p.decided = false;
      }
    } else {
      const c = this.crossingAt.get(`${I.id}:${p.road.arm}`);
      const corner = this._corner(I, p.road.arm, p.side);
      // Some walkers decide to cross here as they near the corner.
      if (!p.decided && c && p.u < corner.u + 14) {
        p.decided = true;
        if (this.rng.chance(this.cfg.join)) this._setGoal(p, c, p.side);
      }
      if (p.goal && p.goal.c === c && p.goal.from === p.side && p.u <= Math.max(p.goal.waitU, corner.u)) {
        p.u = p.goal.waitU;
        p.lat = p.goal.waitLat;
        p.state = 'wait';
        p.wait = 0;
        A.center.point(p.u, p.side * (A.half + p.lat), _pt);
        p.x = _pt.x;
        p.y = _pt.y;
        p.angle = _pt.angle + (p.side > 0 ? -Math.PI / 2 : Math.PI / 2); // face the road
        return;
      }
      if (p.u <= corner.u) {
        if (corner.next) {
          p.road = { I, arm: corner.next.arm };
          p.side = corner.next.side;
          p.u = corner.next.u + (corner.u - p.u);
        }
        p.dir = 1;
        p.goal = null;
      }
    }
    if (!p.gone) this._place(p);
  }

  _waitAtCrossing(p, dt) {
    p.moving = false;
    p.wait += dt;
    const c = p.goal.c;
    const line = c.lines[p.goal.from];
    const ws = this.walkState(c);
    let red = false;
    if (ws === 'gap') {
      // Flashing yellow: cross in a gap, taking turns with the drivers stopped at the lines.
      if (p.wait < 40 && (this._trafficComing(c) || this._driversWaiting(c))) return;
    } else if (ws !== 'walk') {
      // Pasaway: tired of waiting, crosses against the light when the road looks clear.
      if (ws === 'flash' || p.wait < p.patience || !this.rng.chance(dt * 0.12)) return;
      if (this._trafficComing(c)) return;
      red = true;
    }
    // Only the first stretch of the crosswalk needs to be clear: a car crossing its far end does
    // not stop people stepping out (they hold a moving window as they walk, see _crossing).
    if (!c.grid.pedAdvance(p, line.conn, line.fp, 0)) return;
    const start = line.conn.path.points()[0];
    const lead = Math.hypot(start.x - p.x, start.y - p.y);
    p.cross = { c, line, s: -lead, lead, x0: p.x, y0: p.y };
    p.state = 'cross';
    p.red = red;
    if (red) {
      p.shout = 2.5;
      this.stats.redCrossers++;
      this.sim.scoring.onPedRedCross?.();
      this.sim.events.push({ type: 'pasaway', x: p.x, y: p.y });
    }
  }

  /** Is anything about to drive into the junction? (pedestrians look before crossing on red) */
  _trafficComing(c) {
    for (const v of this.sim.vehicles) {
      if (v.reservations.has(c.I.id)) return true;
      const ce = v.nextConnEntry();
      if (!ce || ce.seg.intersection !== c.I) continue;
      const d = ce.start - v.front;
      if (d >= 0 && d < 35 && v.v > 2) return true;
    }
    return false;
  }

  /** Under flashing yellow: has a driver already stopped at a line of this junction, waiting to go? */
  _driversWaiting(c) {
    for (const v of this.sim.vehicles) {
      if (v.signStop === c.I.id && !v.reservations.has(c.I.id) && v.v < 0.5) {
        const ce = v.nextConnEntry();
        if (ce && ce.seg.intersection === c.I) return true;
      }
    }
    return false;
  }

  _crossing(p, dt) {
    const cr = p.cross;
    const ws = this.walkState(cr.c);
    const hurry = ws === 'walk' || ws === 'gap' ? 1 : 1.6;
    const next = cr.s + p.speed * hurry * dt;
    // Hold the crosswalk just ahead; if a vehicle is crossing it, wait where we stand.
    if (!cr.c.grid.pedAdvance(p, cr.line.conn, cr.line.fp, Math.max(0, next), cr.waitMid || 0)) {
      p.moving = false;
      cr.waitMid = (cr.waitMid || 0) + dt;
      this.stats.maxMidWait = Math.max(this.stats.maxMidWait || 0, cr.waitMid);
      return;
    }
    cr.waitMid = 0;
    cr.s = next;
    if (cr.s < 0) {
      const t = 1 + cr.s / Math.max(cr.lead, 1e-6);
      const s0 = cr.line.conn.path.points()[0];
      p.x = cr.x0 + (s0.x - cr.x0) * t;
      p.y = cr.y0 + (s0.y - cr.y0) * t;
      p.angle = Math.atan2(s0.y - cr.y0, s0.x - cr.x0);
      return;
    }
    cr.line.conn.path.pointAt(Math.min(cr.s, cr.line.length), _pt);
    p.x = _pt.x;
    p.y = _pt.y;
    p.angle = Math.atan2(_pt.dy, _pt.dx);
    cr.c.grid.releasePed(p, cr.s);
    if (cr.s >= cr.line.length) {
      cr.c.grid.releasePedAll(p);
      this.stats.crossed++;
      this.stats.totalWait += p.wait;
      this.sim.scoring.onPedCrossed?.(p.wait);
      // Carry on along the far sidewalk.
      p.state = 'walk';
      p.road = { I: cr.c.I, arm: cr.c.arm };
      p.side = -cr.line.from;
      p.u = cr.line.u;
      p.lat = this.rng.range(0.9, SW - 0.8);
      p.dir = this.rng.chance(0.5) ? 1 : -1;
      p.decided = true;
      p.goal = null;
      p.cross = null;
      this._place(p);
    }
  }

  // ------------------------------------------------------------------ pasaway jaywalkers
  _spawnJaywalker() {
    const rng = this.rng;
    const total = this.sites.reduce((n, s) => n + (s.u1 - s.u0), 0);
    let r = rng.range(0, total);
    let site = this.sites[0];
    for (const s of this.sites) {
      if (r < s.u1 - s.u0) {
        site = s;
        break;
      }
      r -= s.u1 - s.u0;
    }
    const p = this._newPed(rng.chance(0.15) ? 'vendor' : rng.chance(0.3) ? 'student' : 'adult');
    p.road = { I: site.I, arm: site.arm };
    p.side = rng.chance(0.5) ? 1 : -1;
    p.u = rng.range(site.u0, site.u1);
    // Nobody climbs the parapet of a bridge to cross.
    if (this.sim.network.river) {
      site.g.point(p.u, 0, _pt);
      if (this.sim.network.river.contains(_pt.x, _pt.y, 4)) return;
    }
    p.lat = 0.6;
    p.state = 'jaywait';
    p.wait = 0;
    p.jay = { site, y: p.side * (site.half + 0.6), blockage: null };
    site.g.point(p.u, p.jay.y, _pt);
    p.x = _pt.x;
    p.y = _pt.y;
    p.angle = _pt.angle + (p.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.peds.push(p);
  }

  /** Can a jaywalker cross the road at u right now without making anyone brake hard? */
  _jaySafe(site, u) {
    const sim = this.sim;
    const brake = sim.env?.brakeFactor ?? 1;
    const a = site.g.point(u, -(site.half + 1));
    const b = site.g.point(u, site.half + 1);
    for (const v of sim.vehicles) {
      // Anything physically close to the crossing line (including a car half-way through a lane change)
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((v.x - a.x) * abx + (v.y - a.y) * aby) / (abx * abx + aby * aby)));
      if (Math.hypot(a.x + abx * t - v.x, a.y + aby * t - v.y) < v.hl + 2.5) return false;
      for (const lane of site.lanes) {
        const st = v.route.startOf(lane);
        if (st < 0) continue;
        const at = st + laneSAt(lane, site.g, u);
        const rear = v.front - v.spec.length;
        if (rear < at + 2 && v.front > at - 2) return false;
        if (v.front <= at - 2) {
          const gap = at - 2 - v.front;
          if (gap < (v.v * v.v) / (2 * v.spec.decel * brake) + 6) return false;
        }
      }
    }
    return true;
  }

  _jayWait(p, dt) {
    p.moving = false;
    p.wait += dt;
    const site = p.jay.site;
    if (p.wait > 20) {
      // Gives up and walks off along the sidewalk.
      p.state = 'walk';
      p.lat = this.rng.range(0.9, SW - 0.8);
      p.dir = this.rng.chance(0.5) ? 1 : -1;
      p.decided = true;
      p.jay = null;
      return;
    }
    if (!this._jaySafe(site, p.u)) return;
    const sOf = new Map(site.lanes.map((lane) => [lane, laneSAt(lane, site.g, p.u) - 1.3]));
    const blockage = { id: `J${p.id}`, kind: 'ped', label: '', active: true, done: false, laneObjs: [...site.lanes], sOf };
    this.sim.blockages.push(blockage);
    p.jay.blockage = blockage;
    p.state = 'jaywalk';
    p.shout = 2.5;
    this.stats.jaywalkers++;
    this.sim.events.push({ type: 'pasaway', x: p.x, y: p.y });
    // The nearest driver heading this way leans on the horn.
    let best = null;
    let bestGap = 45;
    for (const v of this.sim.vehicles) {
      for (const lane of site.lanes) {
        const st = v.route.startOf(lane);
        if (st < 0) continue;
        const gap = st + laneSAt(lane, site.g, p.u) - v.front;
        if (gap > 0 && gap < bestGap) {
          bestGap = gap;
          best = v;
        }
      }
    }
    if (best && best.hornCooldown <= 0.5) {
      best.hornFlash = best.spec.bigHorn ? 0.9 : 0.55;
      best.hornText = 'HOY!';
      best.hornCooldown = 3;
      this.sim.emitHorn(best, true);
    }
  }

  _jayWalk(p, dt) {
    const j = p.jay;
    const site = j.site;
    const dirY = -p.side;
    j.y += dirY * p.speed * 1.2 * dt;
    site.g.point(p.u, j.y, _pt);
    p.x = _pt.x;
    p.y = _pt.y;
    p.angle = _pt.angle + (dirY > 0 ? Math.PI / 2 : -Math.PI / 2);
    // Free each lane once the pedestrian is clear of it.
    const b = j.blockage;
    if (b.laneObjs.length) {
      b.laneObjs = b.laneObjs.filter((lane) => dirY * (j.y - laneOffsetOn(lane, site.g)) < (lane.width ?? LANE_WIDTH) / 2 + PED_RADIUS + 0.4);
    }
    if (dirY * j.y >= site.half + 0.6) {
      b.active = false;
      b.done = true;
      b.laneObjs = [];
      const k = this.sim.blockages.indexOf(b);
      if (k >= 0) this.sim.blockages.splice(k, 1);
      p.state = 'walk';
      p.side = -p.side;
      p.lat = this.rng.range(0.9, SW - 0.8);
      p.dir = this.rng.chance(0.5) ? 1 : -1;
      p.decided = true;
      p.jay = null;
      this._place(p);
    }
  }

  // ------------------------------------------------------------------ queries
  /** Pedestrians on the road surface right now (crossing or jaywalking). */
  onRoad() {
    return this.peds.filter((p) => (p.state === 'cross' && p.cross.s >= 0) || p.state === 'jaywalk');
  }
}
