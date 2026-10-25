// Road network built from a map definition (src/data/maps): nodes, directed lanes and node
// connectors. Right-hand traffic (Philippines).
//
// Nodes are axis-aligned junctions with up to four arms (N/E/S/W):
//   'signal' — player-controlled traffic lights
//   'uturn'  — median U-turn slot; through traffic has priority over U-turners
//   'yield'  — unsignalised; vehicles on minor arms stop and wait for a gap
// Each arm uses a road profile: lanes per direction, median width and lane types. Lanes of one
// direction are indexed from the median (0) to the curb (n-1). With two lanes and no median this
// reproduces the classic layout: lane 0 straight + left, lane 1 straight + right.
// Arms may curve away from the node (see RoadGeometry): lanes are offset curves of the arm's centre
// line and use the distance along it as their coordinate, so parallel lanes stay in step.

import { Path, cubicBezierPoints } from '../utils/math.js';
import { ARMS, DIRS, LANE_WIDTH, CROSSWALK_WIDTH, ARM_LENGTH, ARM_LABEL, GROUP_LABEL } from '../data/config.js';
import { getMap } from '../data/maps/index.js';
import { Centerline, STRAIGHT_LEAD, LINK_LEAD, curveLimits } from './RoadGeometry.js';

export const CROSSWALK_GAP = 0.8; // asphalt between the crossing road edge and the zebra
export const MOVE_ORDER = ['straight', 'left', 'right', 'uturn'];

/** Vehicle types allowed on dedicated lanes (null = everyone). */
export const LANE_ALLOWED = {
  general: null,
  bus: new Set(['bus', 'ambulance', 'firetruck']),
  moto: new Set(['motorcycle']),
};

/** Legacy helper: the map definition for a layout id ('single', 'double', ...). */
export function buildLayout(kind = 'single') {
  return getMap(kind);
}

export const rightOf = (d) => ({ x: -d.y, y: d.x });
export const leftOf = (d) => ({ x: d.y, y: -d.x });

function armOf(vec) {
  for (const a of ARMS) {
    if (Math.abs(DIRS[a].x - vec.x) < 1e-6 && Math.abs(DIRS[a].y - vec.y) < 1e-6) return a;
  }
  return null;
}

function normalizeProfile(map, ref) {
  const p = typeof ref === 'string' ? map.roads?.[ref] : ref;
  if (!p) throw new Error(`Map ${map.id}: unknown road ${ref}`);
  const lanes = p.lanes ?? 2;
  const types = Array.from({ length: lanes }, (_, k) => p.types?.[k] || 'general');
  const median = p.median ?? 0;
  return { key: typeof ref === 'string' ? ref : null, name: p.name || null, lanes, median, types, half: median / 2 + lanes * LANE_WIDTH };
}

export class Segment {
  constructor(kind, id, path) {
    this.kind = kind; // 'lane' | 'connector'
    this.id = id;
    this.path = path;
    this.length = path.length;
    this.vehicles = []; // vehicles whose centre lies on this segment, sorted by localS
  }
}

export class Network {
  constructor(layout) {
    const map = typeof layout === 'string' ? getMap(layout) : layout;
    this.map = map;
    this.layout = { kind: map.id };
    this.lanes = [];
    this.connectors = [];
    this.segments = [];
    this.spawnLanes = [];
    this.exitLanes = [];
    this.intersections = map.nodes.map((d, index) => ({
      id: d.id,
      index,
      kind: d.kind || 'signal',
      def: d,
      x: d.x,
      y: d.y,
      arms: {},
      approachLanes: {},
      exitLanes: {},
      connectors: [],
      major: new Set(d.major || []),
    }));
    this.byId = new Map(this.intersections.map((I) => [I.id, I]));

    for (const I of this.intersections) {
      for (const arm of ARMS) {
        const ref = I.def.arms?.[arm];
        if (!ref) {
          I.arms[arm] = { type: 'none' };
          continue;
        }
        const link = (map.links || []).find((l) => (l.a === I.id && l.aArm === arm) || (l.b === I.id && l.bArm === arm));
        const profile = normalizeProfile(map, ref);
        I.arms[arm] = link
          ? { type: 'link', link, other: link.a === I.id ? link.b : link.a, profile }
          : { type: 'external', profile, length: I.def.armLength?.[arm] ?? map.armLength ?? ARM_LENGTH };
      }
      this._nodeGeometry(I);
    }
    this._buildCenterlines(map);
    for (const I of this.intersections) {
      for (const arm of ARMS) if (I.arms[arm].type === 'external') this._buildExternalArm(I, arm);
    }
    for (const link of map.links || []) {
      this._buildLink(this.byId.get(link.a), link.aArm, this.byId.get(link.b), link.bArm);
      this._buildLink(this.byId.get(link.b), link.bArm, this.byId.get(link.a), link.aArm);
    }
    for (const I of this.intersections) {
      this._buildConnectors(I);
      I.phases = I.kind === 'signal' ? this._phases(I) : [];
    }
    this.bounds = this._computeBounds();
  }

  // ------------------------------------------------------------------ geometry
  _nodeGeometry(I) {
    const half = (a) => (I.arms[a].type === 'none' ? 0 : I.arms[a].profile.half);
    I.hx = Math.max(half('N'), half('S')); // half-width of the north–south road
    I.hy = Math.max(half('E'), half('W')); // half-width of the east–west road
    let uturnHalf = 0;
    if (I.kind === 'uturn') {
      // Depth needed for a U-turn from the first general lane to the first general lane opposite.
      let d = 0;
      for (const arm of I.def.uturn || []) {
        const p = I.arms[arm].profile;
        const g = Math.max(0, p.types.indexOf('general'));
        d = Math.max(d, p.median + LANE_WIDTH * (2 * g + 1));
      }
      uturnHalf = Math.max(6, d / 4 + 2.6);
    }
    for (const arm of ARMS) {
      const A = I.arms[arm];
      if (A.type === 'none') continue;
      A.half = A.profile.half;
      A.median = A.profile.median;
      if (I.kind === 'uturn') {
        A.stop = uturnHalf;
        A.exitStop = uturnHalf;
        A.cwStart = null;
      } else {
        const cross = arm === 'N' || arm === 'S' ? I.hy : I.hx;
        A.cwStart = cross + CROSSWALK_GAP;
        // Single-lane streets get a set-back stop line so trucks and buses can swing in past waiting cars.
        const setback = I.def.setback?.[arm] ?? (A.profile.lanes === 1 ? 5 : 0);
        A.exitStop = A.cwStart + CROSSWALK_WIDTH + CROSSWALK_GAP; // where exit lanes begin
        A.stop = A.exitStop + setback; // approach stop line
      }
    }
    const stopOr = (a, fallback) => (I.arms[a].type === 'none' ? fallback : I.arms[a].stop);
    I.core = {
      minX: I.x - stopOr('W', I.hx),
      maxX: I.x + stopOr('E', I.hx),
      minY: I.y - stopOr('N', I.hy),
      maxY: I.y + stopOr('S', I.hy),
    };
    I.maxStop = Math.max(...ARMS.map((a) => stopOr(a, 0)));
  }

  /** Centre line of every arm, oriented outward from its node (links get one shared line). */
  _buildCenterlines(map) {
    for (const I of this.intersections) {
      for (const arm of ARMS) {
        const A = I.arms[arm];
        if (A.type !== 'external') continue;
        // Drawn well past the end of the lanes so the road runs off screen.
        A.center = Centerline.fromShape(I, DIRS[arm], I.def.shape?.[arm] || [], A.length + 130, A.stop + STRAIGHT_LEAD);
        this._checkRadius(I, arm, A);
      }
    }
    for (const link of map.links || []) {
      const A = this.byId.get(link.a);
      const B = this.byId.get(link.b);
      const c = Centerline.link(A, DIRS[link.aArm], A.arms[link.aArm].stop + LINK_LEAD, B, DIRS[link.bArm], B.arms[link.bArm].stop + LINK_LEAD);
      A.arms[link.aArm].center = c;
      B.arms[link.bArm].center = c.reversed();
      this._checkRadius(A, link.aArm, A.arms[link.aArm]);
    }
  }

  _checkRadius(I, arm, A) {
    if (A.center.minRadius < A.half + 3) throw new Error(`Map ${this.map.id}: ${I.id}${arm} bends too tightly (radius ${A.center.minRadius.toFixed(1)} m for a road ${(2 * A.half).toFixed(1)} m wide)`);
  }

  /** True when (x, y) lies inside the node box (between the stop lines). */
  static inCore(I, x, y, pad = 0) {
    const c = I.core;
    return x > c.minX - pad && x < c.maxX + pad && y > c.minY - pad && y < c.maxY + pad;
  }

  /** Lane along `center` from u0 to u1 at lateral offset d (reversed: travelling toward u0). */
  _makeLane(id, role, center, u0, u1, d, reversed, props) {
    const { points, params } = center.offset(u0, u1, d);
    if (reversed) {
      points.reverse();
      params.reverse();
      for (let i = 0; i < params.length; i++) params[i] = u1 - params[i];
    }
    const lane = new Segment('lane', id, new Path(points, params));
    Object.assign(lane, props);
    lane.role = role;
    lane.committed = new Set(); // vehicles holding a reservation into this lane
    lane.keepClear = new Map(); // vehicle -> max front localS while that reservation lasts
    lane.connectors = {};
    lane.start = points[0];
    lane.end = points[points.length - 1];
    lane.curves = curveLimits(center, u0, u1, reversed);
    lane.allowed = LANE_ALLOWED[lane.type] || null;
    lane.allows = (type) => !lane.allowed || lane.allowed.has(type);
    this.lanes.push(lane);
    this.segments.push(lane);
    return lane;
  }

  _laneProps(profile, k) {
    return {
      laneIndex: k,
      laneCount: profile.lanes,
      type: profile.types[k],
      isCurb: k === profile.lanes - 1,
      offset: profile.median / 2 + LANE_WIDTH * (k + 0.5),
      road: profile.name,
    };
  }

  _buildExternalArm(I, arm) {
    const A = I.arms[arm];
    const p = A.profile;
    const c = A.center;
    const L = A.length;
    I.approachLanes[arm] = [];
    I.exitLanes[arm] = [];
    for (let k = 0; k < p.lanes; k++) {
      const lp = this._laneProps(p, k);
      const off = lp.offset;
      // Approach lanes sit left of the outward direction (right of travel toward the node).
      const a = this._makeLane(`${I.id}:${arm}:in${k}`, 'approach', c, A.stop, L, -off, true, {
        ...lp, endInt: I, endArm: arm, startInt: null, startArm: null, spawn: true, demandKey: `${I.id}:${arm}`, arm,
      });
      I.approachLanes[arm][k] = a;
      this.spawnLanes.push(a);

      const e = this._makeLane(`${I.id}:${arm}:out${k}`, 'exit', c, A.exitStop, L, off, false, {
        ...lp, endInt: null, endArm: null, startInt: I, startArm: arm, despawn: true, exitKey: `${I.id}:${arm}`, arm,
      });
      e.gate = { tokens: 1, cap: 1.5 };
      I.exitLanes[arm][k] = e;
      this.exitLanes.push(e);
    }
  }

  _buildLink(A, aArm, B, bArm) {
    const p = A.arms[aArm].profile;
    const pb = B.arms[bArm].profile;
    if (p.lanes !== pb.lanes || Math.abs(p.median - pb.median) > 1e-9) throw new Error(`Link ${A.id}${aArm}–${B.id}${bArm}: road profiles differ`);
    const c = A.arms[aArm].center; // runs from A to B
    const sa = A.arms[aArm].exitStop;
    const sb = c.length - B.arms[bArm].stop;
    if (sb - sa < 5) throw new Error(`Link ${A.id}${aArm}–${B.id}${bArm}: nodes too close`);
    A.exitLanes[aArm] = A.exitLanes[aArm] || [];
    B.approachLanes[bArm] = B.approachLanes[bArm] || [];
    for (let k = 0; k < p.lanes; k++) {
      const lp = this._laneProps(p, k);
      const off = lp.offset;
      const lane = this._makeLane(`${A.id}${aArm}>${B.id}${bArm}:${k}`, 'link', c, sa, sb, off, false, {
        ...lp,
        startInt: A,
        startArm: aArm,
        endInt: B,
        endArm: bArm,
        spawn: false,
        arm: bArm,
      });
      A.exitLanes[aArm][k] = lane;
      B.approachLanes[bArm][k] = lane;
    }
  }

  // ------------------------------------------------------------------ movements
  _exitArm(X, move) {
    const d = { x: -DIRS[X].x, y: -DIRS[X].y };
    if (move === 'uturn') return X;
    return armOf(move === 'straight' ? d : move === 'left' ? leftOf(d) : rightOf(d));
  }

  /** Movements allowed from each approach lane of arm X (array per lane, in MOVE_ORDER). */
  laneMoves(I, X) {
    const lanes = I.approachLanes[X];
    const def = I.def;
    if (def.moves?.[X]) return def.moves[X].map((m) => [...m]);
    const has = (m) => {
      const Y = this._exitArm(X, m);
      return !!(Y && I.exitLanes[Y]?.length);
    };
    const S = has('straight');
    const L = has('left') && !(def.noLeft || []).includes(X);
    const R = has('right') && !(def.noRight || []).includes(X);
    const moves = lanes.map(() => []);
    const assign = (idxs) => {
      if (!idxs.length) return;
      if (idxs.length === 1) {
        if (S) moves[idxs[0]].push('straight');
        if (L) moves[idxs[0]].push('left');
        if (R) moves[idxs[0]].push('right');
        return;
      }
      if (S) {
        for (const i of idxs) moves[i].push('straight');
        if (L) moves[idxs[0]].push('left');
        if (R) moves[idxs[idxs.length - 1]].push('right');
        return;
      }
      const half = Math.ceil(idxs.length / 2);
      idxs.forEach((i, j) => {
        if (L && (j < half || !R)) moves[i].push('left');
        if (R && (j >= half || !L)) moves[i].push('right');
      });
    };
    const byType = (t) => lanes.map((l, i) => (l.type === t ? i : -1)).filter((i) => i >= 0);
    const general = byType('general');
    assign(general);
    for (const i of byType('bus')) {
      if (S) moves[i].push('straight');
      else assign([i]);
    }
    for (const i of byType('moto')) {
      if (S) moves[i].push('straight');
      if (R && lanes[i].isCurb) moves[i].push('right');
      if (!S && !(R && lanes[i].isCurb)) assign([i]);
    }
    if ((def.uturn || []).includes(X) && has('uturn') && general.length) moves[general[0]].push('uturn');
    return moves.map((ms) => MOVE_ORDER.filter((m) => ms.includes(m)));
  }

  /** Exit lane for approach lane `lane` doing `move`, keeping dedicated lanes connected to their own type. */
  _targetLane(I, X, lane, move, laneMoves) {
    const Y = this._exitArm(X, move);
    const out = I.exitLanes[Y];
    if (!out?.length) return null;
    let pool = out.filter((l) => l.type === lane.type);
    if (!pool.length) pool = out.filter((l) => l.type === 'general');
    if (!pool.length) pool = out;
    const lanes = I.approachLanes[X];
    const peers = lanes.filter((l, i) => l.type === lane.type && laneMoves[i].includes(move));
    const j = Math.max(0, peers.indexOf(lane));
    if (move === 'right') return pool[pool.length - 1 - Math.min(j, pool.length - 1)];
    return pool[Math.min(j, pool.length - 1)];
  }

  _buildConnectors(I) {
    for (const X of ARMS) {
      const lanes = I.approachLanes[X];
      if (!lanes) continue;
      const d = { x: -DIRS[X].x, y: -DIRS[X].y };
      const laneMoves = this.laneMoves(I, X);
      for (let k = 0; k < lanes.length; k++) {
        const lane = lanes[k];
        lane.moves = laneMoves[k];
        for (const m of laneMoves[k]) {
          const Y = this._exitArm(X, m);
          const toLane = this._targetLane(I, X, lane, m, laneMoves);
          if (!toLane) continue;
          const kOut = toLane.laneIndex;
          const exitVec = m === 'uturn' ? { x: -d.x, y: -d.y } : DIRS[Y];
          const p0 = lane.end;
          const p3 = toLane.start;
          let pts;
          let widePts = null;
          if (m === 'straight') {
            const lateral = Math.abs((p3.x - p0.x) * -d.y + (p3.y - p0.y) * d.x);
            if (lateral < 1e-6) pts = [p0, p3];
            else {
              const len = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
              pts = cubicBezierPoints(p0, { x: p0.x + d.x * len, y: p0.y + d.y * len }, { x: p3.x - d.x * len, y: p3.y - d.y * len }, p3, 24);
            }
          } else if (m === 'uturn') {
            const k3 = (2 * Math.hypot(p3.x - p0.x, p3.y - p0.y)) / 3;
            pts = cubicBezierPoints(p0, { x: p0.x + d.x * k3, y: p0.y + d.y * k3 }, { x: p3.x + d.x * k3, y: p3.y + d.y * k3 }, p3, 40);
          } else {
            const q = Math.abs(d.x) < 1e-6 ? { x: p0.x, y: p3.y } : { x: p3.x, y: p0.y };
            const r1 = Math.hypot(q.x - p0.x, q.y - p0.y);
            const r2 = Math.hypot(q.x - p3.x, q.y - p3.y);
            const curve = (kappa) =>
              cubicBezierPoints(p0, { x: p0.x + d.x * r1 * kappa, y: p0.y + d.y * r1 * kappa }, { x: p3.x - exitVec.x * r2 * kappa, y: p3.y - exitVec.y * r2 * kappa }, p3, 32);
            pts = curve(0.5523);
            // Long vehicles run deeper into the box before turning (a wider swing).
            widePts = curve(0.82);
          }
          const conn = new Segment('connector', `${I.id}:${X}${k}>${Y}${kOut}`, new Path(pts));
          conn.intersection = I;
          conn.arm = X;
          conn.exitArm = Y;
          conn.movement = m;
          conn.laneIndex = k;
          conn.fromLane = lane;
          conn.toLane = toLane;
          this._addConnector(I, conn);
          lane.connectors[m] = conn;
          if (widePts) {
            const wide = new Segment('connector', `${conn.id}w`, new Path(widePts));
            Object.assign(wide, { intersection: I, arm: X, exitArm: Y, movement: m, laneIndex: k, fromLane: lane, toLane, wide: true });
            this._addConnector(I, wide);
            lane.connectorsWide = lane.connectorsWide || {};
            lane.connectorsWide[m] = wide;
          }
        }
      }
    }
  }

  _addConnector(I, conn) {
    I.connectors.push(conn);
    this.connectors.push(conn);
    this.segments.push(conn);
  }

  /** Connector a vehicle of this size takes for `move` from `lane` (wide swing for buses and trucks). */
  static connectorFor(lane, move, spec) {
    if (spec && spec.length > 8 && lane.connectorsWide?.[move]) return lane.connectorsWide[move];
    return lane.connectors[move];
  }

  /** Signal phases for a node: the map's own list, or one phase per road axis. */
  _phases(I) {
    const present = (a) => I.arms[a].type !== 'none' && I.approachLanes[a]?.length;
    const label = (arms) => {
      const names = new Set(arms.map((a) => I.arms[a].profile.name));
      if (names.size === 1 && [...names][0]) return [...names][0];
      if (arms.length === 1) return ARM_LABEL[arms[0]];
      return GROUP_LABEL[arms.join('')] || arms.join('–');
    };
    if (I.def.phases) return I.def.phases.map((p) => ({ ...p, label: p.label || label(p.arms) }));
    const phases = [];
    for (const axis of [['N', 'S'], ['E', 'W']]) {
      const arms = axis.filter(present);
      if (arms.length) phases.push({ id: arms.join(''), arms, label: label(arms) });
    }
    return phases;
  }

  _computeBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const l of this.lanes) {
      const { xs, ys } = l.path;
      for (let i = 0; i < xs.length; i++) {
        minX = Math.min(minX, xs[i]);
        minY = Math.min(minY, ys[i]);
        maxX = Math.max(maxX, xs[i]);
        maxY = Math.max(maxY, ys[i]);
      }
    }
    return { minX, minY, maxX, maxY };
  }

  /** Region the camera should always keep visible. */
  focusRect(margin = 46) {
    if (this.map.focus) return { ...this.map.focus };
    const nodes = this.intersections.filter((I) => I.kind !== 'uturn');
    const m = Math.max(margin, ...nodes.map((I) => I.maxStop + 34.4));
    const xs = nodes.map((I) => I.x);
    const ys = nodes.map((I) => I.y);
    return {
      minX: Math.min(...xs) - m,
      maxX: Math.max(...xs) + m,
      minY: Math.min(...ys) - m,
      maxY: Math.max(...ys) + m,
    };
  }

  externalApproachKeys() {
    const keys = [];
    for (const I of this.intersections) {
      for (const arm of ARMS) if (I.arms[arm].type === 'external') keys.push(`${I.id}:${arm}`);
    }
    return keys;
  }

  approachLanesByKey(key) {
    const [id, arm] = key.split(':');
    return this.byId.get(id)?.approachLanes[arm] || [];
  }

  exitLanesByKey(key) {
    const [id, arm] = key.split(':');
    return this.byId.get(id)?.exitLanes[arm] || [];
  }
}
