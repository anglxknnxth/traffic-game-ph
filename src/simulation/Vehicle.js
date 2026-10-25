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
  constructor(segments) {
    this.entries = [];
    let s = 0;
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
    this.updatePose();
  }

  poseAt(s, out) {
    this.route.sample(s, _p);
    return setObb(out, _p.x, _p.y, Math.cos(_p.angle), Math.sin(_p.angle), this.hl, this.hw);
  }

  updatePose() {
    this.route.sample(this.s, _p);
    this.x = _p.x;
    this.y = _p.y;
    this.angle = _p.angle;
    setObb(this.obb, _p.x, _p.y, Math.cos(_p.angle), Math.sin(_p.angle), this.hl, this.hw);
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
    const ce = this.nextConnEntry();
    let conn = null;
    if (this.segment.kind === 'connector') conn = this.segment;
    else if (ce && ce.start - this.front < 35) conn = ce.seg;
    if (!conn) return 0;
    return conn.movement === 'left' ? -1 : conn.movement === 'right' ? 1 : 0;
  }
}
