// Vehicle entity and route (sequence of lane/connector segments with a single arc-length coordinate).

import { makeObb, setObb } from '../utils/math.js';

export const AI_STATE = {
  SPAWNING: 'SPAWNING',
  APPROACHING: 'APPROACHING',
  FOLLOWING: 'FOLLOWING',
  BRAKING: 'BRAKING',
  STOPPED_AT_RED: 'STOPPED_AT_RED',
  WAITING_FOR_SPACE: 'WAITING_FOR_SPACE',
  CREEPING_FORWARD: 'CREEPING_FORWARD',
  REACTING: 'REACTING',
  CHANGING_LANE: 'CHANGING_LANE',
  ENTERING_INTERSECTION: 'ENTERING_INTERSECTION',
  TURNING: 'TURNING',
  BLOCKED_IN_INTERSECTION: 'BLOCKED_IN_INTERSECTION',
  EXITING_INTERSECTION: 'EXITING_INTERSECTION',
  LOADING: 'LOADING',
  DESPAWNING: 'DESPAWNING',
};

const _a = { x: 0, y: 0, dx: 0, dy: 0 };
const _b = { x: 0, y: 0, dx: 0, dy: 0 };

export class Route {
  /** `base` is the route coordinate where the first segment starts (lane changes keep s continuous). */
  constructor(segments, base = 0) {
    this.entries = [];
    let s = base;
    for (const seg of segments) {
      this.entries.push({ seg, start: s, end: s + seg.length });
      s += seg.length;
    }
    this.length = s;
    this.connectorIdx = [];
    this.entries.forEach((e, i) => {
      if (e.seg.kind === 'connector') this.connectorIdx.push(i);
    });
    this.exitLane = this.entries[this.entries.length - 1].seg;
    this.movements = this.connectorIdx.map((i) => this.entries[i].seg.movement);
  }

  indexAt(s) {
    const E = this.entries;
    if (s <= E[0].end) return 0;
    for (let i = 1; i < E.length; i++) if (s <= E[i].end) return i;
    return E.length - 1;
  }

  position(s, out) {
    const e = this.entries[this.indexAt(s)];
    return e.seg.path.pointAt(s - e.start, out);
  }

  /** Position at route coordinate s and heading by central difference (smooth through curves). */
  sample(s, out) {
    this.position(s, out);
    const x = out.x;
    const y = out.y;
    this.position(s - 0.6, _a);
    this.position(s + 0.6, _b);
    out.angle = Math.atan2(_b.y - _a.y, _b.x - _a.x);
    out.x = x;
    out.y = y;
    return out;
  }

  /** Route coordinate where lane `seg` starts, or -1 when not on the route. */
  startOf(seg) {
    for (const e of this.entries) if (e.seg === seg) return e.start;
    return -1;
  }
}

let nextId = 1;
export function resetVehicleIds() {
  nextId = 1;
}

const _p = { x: 0, y: 0, dx: 0, dy: 0, angle: 0 };
const HISTORY = 24; // speed samples kept for perception delay (0.1 s apart)

/**
 * Lateral offset (metres, + = right of travel) and its slope during a lane change at route
 * coordinate s. The offset eases from `off` to 0 over `L` metres, so the body really sweeps
 * across both lanes and the heading turns smoothly.
 */
export function lateralAt(lc, s, out) {
  const t = (s - lc.s0) / lc.L;
  if (t >= 1) {
    out.off = 0;
    out.slope = 0;
  } else if (t <= 0) {
    out.off = lc.off;
    out.slope = 0;
  } else {
    out.off = lc.off * 0.5 * (1 + Math.cos(Math.PI * t));
    out.slope = (-lc.off * 0.5 * Math.PI * Math.sin(Math.PI * t)) / lc.L;
  }
  return out;
}
const _lat = { off: 0, slope: 0 };

export class Vehicle {
  constructor({ spec, personality, route, color, s = 0, v = 0, time = 0, speedVar = 1 }) {
    this.id = nextId++;
    this.spec = spec;
    this.type = spec.key;
    this.p = personality;
    this.personality = personality.key;
    this.route = route;
    this.color = color;
    this.emergency = !!spec.emergency;
    this.hl = spec.length / 2;
    this.hw = spec.width / 2;
    this.radius = Math.hypot(this.hl, this.hw);
    this.speedVar = speedVar;

    this.s = s;
    this.v = v;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.angle = 0;
    this.obb = makeObb();

    this.segIdx = route.indexAt(s);
    this.localS = s - route.entries[this.segIdx].start;
    this.nextConn = 0; // pointer into route.connectorIdx
    this.reservations = new Map(); // intersectionId -> reservation

    this.state = AI_STATE.SPAWNING;
    this.spawnTime = time;
    this.waitTime = 0;
    this.stoppedTime = 0;
    this.greenWait = 0;
    this.avgSpeed = v;
    this.boxTime = 0;
    this.hornCooldown = 1 + Math.random() * 2;
    this.hornFlash = 0;
    this.hornText = null;
    this.horns = 0;
    this.blockReason = null;
    this.constraint = 'free';
    this.decisionTimer = 0;
    this.creeping = false;
    this.boxBlocker = false;
    this.leaderId = null;
    this.signal = null;
    this.loading = null;
    this.emergencyDone = false;
    this.gatePassed = false;
    this.idealTravel = 0;
    this.lc = null; // active lane change { s0, L, off, fromLane }
    this.lcCooldown = 2;
    this.reaction = 0.6; // seconds; set from the driver's personality at spawn
    this.reactTimer = null; // pending start-up delay
    this.vHist = new Float32Array(HISTORY).fill(v);
    this.vHistIdx = 0;
    this.vHistT = 0;
    this.blockerId = null;
    this.updatePose();
  }

  _pose(s) {
    this.route.sample(s, _p);
    if (this.lc) {
      lateralAt(this.lc, s, _lat);
      if (_lat.off !== 0 || _lat.slope !== 0) {
        const c = Math.cos(_p.angle);
        const sn = Math.sin(_p.angle);
        _p.x += -sn * _lat.off;
        _p.y += c * _lat.off;
        _p.angle += Math.atan(_lat.slope);
      }
    }
    return _p;
  }

  poseAt(s, out) {
    const p = this._pose(s);
    return setObb(out, p.x, p.y, Math.cos(p.angle), Math.sin(p.angle), this.hl, this.hw);
  }

  updatePose() {
    const p = this._pose(this.s);
    this.x = p.x;
    this.y = p.y;
    this.angle = p.angle;
    setObb(this.obb, p.x, p.y, Math.cos(p.angle), Math.sin(p.angle), this.hl, this.hw);
  }

  /** Current lateral offset from the lane centre (0 outside lane changes). */
  lateralOffset() {
    return this.lc ? lateralAt(this.lc, this.s, _lat).off : 0;
  }

  /** Record speed for perception delay (call once per step). */
  recordSpeed(dt) {
    this.vHistT += dt;
    if (this.vHistT >= 0.1) {
      this.vHistT -= 0.1;
      this.vHistIdx = (this.vHistIdx + 1) % HISTORY;
      this.vHist[this.vHistIdx] = this.v;
    }
  }

  /** Speed this vehicle had `ago` seconds earlier (what a slow-reacting follower still perceives). */
  speedAgo(ago) {
    const k = Math.min(HISTORY - 1, Math.max(0, Math.round(ago / 0.1)));
    if (k === 0) return this.v;
    return this.vHist[(this.vHistIdx - k + HISTORY) % HISTORY];
  }

  get front() {
    return this.s + this.hl;
  }

  get segment() {
    return this.route.entries[this.segIdx].seg;
  }

  nextConnEntry() {
    const idx = this.route.connectorIdx[this.nextConn];
    return idx === undefined ? null : this.route.entries[idx];
  }

  /** Turn indicator: -1 left, 1 right, 0 none — shown when close to or inside a turn. */
  turnSignal() {
    if (this.lc) return this.lc.off > 0 ? -1 : 1; // moving toward the target lane
    const ce = this.nextConnEntry();
    let conn = null;
    if (this.segment.kind === 'connector') conn = this.segment;
    else if (ce && ce.start - this.front < 35) conn = ce.seg;
    if (!conn) return 0;
    return conn.movement === 'left' ? -1 : conn.movement === 'right' ? 1 : 0;
  }
}
