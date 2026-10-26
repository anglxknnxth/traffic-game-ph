// Road network built from a map definition (src/data/maps): nodes, directed lanes and node
// connectors. Right-hand traffic (Philippines).
//
// Nodes are axis-aligned junctions with up to four arms (N/E/S/W):
//   'signal' — player-controlled traffic lights
//   'uturn'  — median U-turn slot; through traffic has priority over U-turners
//   'yield'  — unsignalised; vehicles on minor arms stop and wait for a gap (def.rolling: they only
//              give way, as at a highway on-ramp)
//   'toll'   — toll plaza: every vehicle stops at its booth for a moment, then drives on
//   'pass'   — a plain join between two roads (no control)
// Grade separation: a node may sit on another level (def.layer: 1 for an elevated expressway), a
// link between levels is a ramp, and lanes of type 'tunnel' pass under a node marked
// def.underpass (an underpass). Vehicles only interact with vehicles on a nearby level.
// Each arm uses a road profile: lanes per direction, median width and lane types. Lanes of one
// direction are indexed from the median (0) to the curb (n-1). With two lanes and no median this
// reproduces the classic layout: lane 0 straight + left, lane 1 straight + right.
// Arms may curve away from the node (see RoadGeometry): lanes are offset curves of the arm's centre
// line and use the distance along it as their coordinate, so parallel lanes stay in step.

import { Path, cubicBezierPoints } from '../utils/math.js';
import { ARMS, DIRS, LANE_WIDTH, BIKE_LANE_WIDTH, CROSSWALK_WIDTH, ARM_LENGTH, ARM_LABEL, GROUP_LABEL } from '../data/config.js';
import { getMap } from '../data/maps/index.js';
import { Centerline, STRAIGHT_LEAD, LINK_LEAD, curveLimits, pathCurveLimits } from './RoadGeometry.js';
import { River } from './River.js';

export const CROSSWALK_GAP = 0.8; // asphalt between the crossing road edge and the zebra
const REACH_MARGIN = 20; // lanes run this far past the camera's limit (longer than any vehicle)
export const MOVE_ORDER = ['straight', 'left', 'right', 'uturn'];
/** Direction traffic from each approach travels into the junction (for phase labels). */
const ARM_ARROW = { N: '↓', E: '←', S: '↑', W: '→' };

/** Nodes laid out like a U-turn slot: a short straight box with no crosswalks. */
export const SLOT_KINDS = new Set(['uturn', 'toll', 'pass']);
// Level of a vehicle: ground 0, elevated 1, ramps 0.5, tunnel trench -0.5, under a junction -1.
// Two vehicles interact only when their levels differ by less than 1.
export const RAMP_LAYER = 0.5;
export const TRENCH_LAYER = -0.5;
export const UNDER_LAYER = -1;
const PORTAL = 70; // m from an underpass node where its tunnel lanes leave ground level

/** Vehicle types allowed on dedicated lanes (null = everyone). */
export const LANE_ALLOWED = {
  general: null,
  tunnel: null,
  bus: new Set(['bus', 'ambulance', 'firetruck']),
  moto: new Set(['motorcycle']),
  bike: new Set(['bicycle']),
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
  // Bike lanes are narrower than traffic lanes; every lane's centre offset is cumulative.
  const widths = types.map((t) => (t === 'bike' ? BIKE_LANE_WIDTH : LANE_WIDTH));
  const offsets = [];
  let edge = median / 2;
  for (const w of widths) {
    offsets.push(edge + w / 2);
    edge += w;
  }
  // The curb lane for loading and right turns is the outermost lane that is not a bike lane.
  let curb = lanes - 1;
  while (curb > 0 && types[curb] === 'bike') curb--;
  return { key: typeof ref === 'string' ? ref : null, name: p.name || null, lanes, median, types, widths, offsets, curb, half: edge, layer: p.layer ?? 0 };
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
      layer: d.layer ?? 0,
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
    this.reach = this._reachRect();
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
    this._assignLayers();
    this.bounds = this._computeBounds();
    this.river = map.river ? new River(map.river) : null;
    // Lane drops: { node, arm, lane, before } -> that approach lane ends `before` m from the stop line.
    this.laneDrops = (map.laneDrops || []).map((d) => {
      const lane = this.byId.get(d.node).approachLanes[d.arm][d.lane];
      if (!lane) throw new Error(`Map ${map.id}: no lane ${d.lane} on ${d.node}${d.arm}`);
      lane.dropAt = lane.length - d.before;
      return { lane, s: lane.dropAt, before: d.before };
    });
  }

  // ------------------------------------------------------------------ geometry
  _nodeGeometry(I) {
    const half = (a) => (I.arms[a].type === 'none' ? 0 : I.arms[a].profile.half);
    I.hx = Math.max(half('N'), half('S')); // half-width of the north–south road
    I.hy = Math.max(half('E'), half('W')); // half-width of the east–west road
    if (I.def.rotonda) {
      // Rotonda: a central island ringed by `lanes` circulating lanes; the box is the ring's square.
      const r = I.def.rotonda;
      const ri = r.island ?? 10;
      const ro = Math.max(ri + (r.lanes ?? 2) * LANE_WIDTH + 0.6, I.hx + 1, I.hy + 1);
      I.ring = { ri, ro, lanes: r.lanes ?? 2 };
      I.hx = ro;
      I.hy = ro;
    }
    let uturnHalf = 0;
    if (SLOT_KINDS.has(I.kind)) {
      // Depth needed for a U-turn from the first general lane to the first general lane opposite.
      let d = 0;
      for (const arm of I.def.uturn || []) {
        const p = I.arms[arm].profile;
        const g = Math.max(0, p.types.indexOf('general'));
        d = Math.max(d, 2 * p.offsets[g]);
      }
      uturnHalf = Math.max(6, d / 4 + 2.6);
    }
    for (const arm of ARMS) {
      const A = I.arms[arm];
      if (A.type === 'none') continue;
      A.half = A.profile.half;
      A.median = A.profile.median;
      if (SLOT_KINDS.has(I.kind)) {
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
        const build = () => Centerline.fromShape(I, DIRS[arm], I.def.shape?.[arm] || [], A.length + 130, A.stop + STRAIGHT_LEAD);
        A.center = build();
        // Lanes must run past the edge of anything the camera can show, so vehicles appear and
        // leave beyond the screen edge.
        const need = this._leaveReach(A.center) + REACH_MARGIN;
        if (need > A.length) {
          A.length = Math.ceil(need);
          A.center = build();
        }
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

  /**
   * The largest area the camera may show: the focus rect widened for landscape screens (and, less,
   * for portrait ones). External roads are extended to leave it.
   */
  _reachRect(f = this.focusRect()) {
    const fw = f.maxX - f.minX;
    const fh = f.maxY - f.minY;
    const cx = (f.minX + f.maxX) / 2;
    const cy = (f.minY + f.maxY) / 2;
    const hx = Math.max(fw / 2, (1.9 * fh) / 2) * 1.25 + 10;
    const hy = Math.max(fh / 2, (1.2 * fw) / 2) * 1.25 + 10;
    return { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy };
  }

  /** Distance along a centre line at which it leaves the reach rect (its full length if never). */
  _leaveReach(center) {
    const R = this.reach;
    const p = {};
    for (let u = 0; u <= center.length; u += 2) {
      center.point(u, 0, p);
      if (p.x < R.minX || p.x > R.maxX || p.y < R.minY || p.y > R.maxY) return u;
    }
    return center.length;
  }

  /** Area the camera is kept inside (so lane ends stay off screen). */
  viewLimit() {
    return { ...this.reach };
  }

  /** Camera limit for a smaller focus area (growing city), never beyond the full reach. */
  reachFor(focus) {
    const r = this._reachRect(focus);
    const R = this.reach;
    return { minX: Math.max(R.minX, r.minX), maxX: Math.min(R.maxX, r.maxX), minY: Math.max(R.minY, r.minY), maxY: Math.min(R.maxY, r.maxY) };
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
    // Where the lane sits on its road (pedestrians crossing mid-block use this).
    lane.center = center;
    lane.cu0 = u0;
    lane.cu1 = u1;
    lane.cReversed = reversed;
    lane.cOffset = d;
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
      isCurb: k === profile.curb,
      isEdge: k === profile.lanes - 1,
      width: profile.widths[k],
      offset: profile.offsets[k],
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
    if (p.lanes !== pb.lanes || Math.abs(p.median - pb.median) > 1e-9 || p.types.join() !== pb.types.join()) throw new Error(`Link ${A.id}${aArm}–${B.id}${bArm}: road profiles differ`);
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
    // Through lanes that dive under a junction: straight on only, everywhere.
    for (const i of byType('tunnel')) if (S) moves[i].push('straight');
    for (const i of byType('bus')) {
      if (S) moves[i].push('straight');
      else assign([i]);
    }
    for (const i of byType('moto')) {
      if (S) moves[i].push('straight');
      if (R && lanes[i].isCurb) moves[i].push('right');
      if (!S && !(R && lanes[i].isCurb)) assign([i]);
    }
    // Bike lanes run along the edge: straight on, and right turns from the edge.
    for (const i of byType('bike')) {
      if (S) moves[i].push('straight');
      if (R && lanes[i].isEdge) moves[i].push('right');
      if (!moves[i].length) assign([i]);
    }
    // A rotonda lets anyone go all the way round and come back (from the inner lane).
    if (((def.uturn || []).includes(X) || def.rotonda) && has('uturn') && general.length) moves[general[0]].push('uturn');
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
    // A bike lane with no bike lane ahead joins the outermost general lane.
    if (lane.type === 'bike' && pool[0].type !== 'bike') return pool[pool.length - 1];
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
      const laneMoves = this.laneMoves(I, X);
      for (let k = 0; k < lanes.length; k++) {
        const lane = lanes[k];
        lane.moves = laneMoves[k];
        for (const m of laneMoves[k]) {
          const toLane = this._targetLane(I, X, lane, m, laneMoves);
          if (!toLane) continue;
          const made = this._connect(I, X, k, lane, m, toLane);
          lane.connectors[m] = made.conn;
          if (made.wide) (lane.connectorsWide = lane.connectorsWide || {})[m] = made.wide;
          // An inner exit lane can be coned off for a contraflow: the same movement into the next
          // lane is built too (only used while that lane is closed).
          const outs = I.exitLanes[made.conn.exitArm].filter((l) => l.type === 'general');
          if (toLane === outs[0] && outs[1] && m !== 'uturn') {
            const alt = this._connect(I, X, k, lane, m, outs[1], 'a');
            (lane.connectorsAlt = lane.connectorsAlt || {})[m] = alt.conn;
            if (alt.wide) (lane.connectorsAltWide = lane.connectorsAltWide || {})[m] = alt.wide;
          }
        }
      }
    }
  }

  /** Connector (and a wide-swing twin for turns) from approach lane `lane` doing `m` into `toLane`. */
  _connect(I, X, k, lane, m, toLane, tag = '') {
    const d = { x: -DIRS[X].x, y: -DIRS[X].y };
    const Y = this._exitArm(X, m);
    const kOut = toLane.laneIndex;
    const exitVec = m === 'uturn' ? { x: -d.x, y: -d.y } : DIRS[Y];
    const p0 = lane.end;
    const p3 = toLane.start;
    let pts;
    let widePts = null;
    if (I.ring) {
      pts = this._ringPath(I, p0, p3, m, k, lane);
    } else if (m === 'straight') {
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
    const conn = new Segment('connector', `${I.id}:${X}${k}>${Y}${kOut}${tag}`, new Path(pts));
    conn.intersection = I;
    conn.arm = X;
    conn.exitArm = Y;
    conn.movement = m;
    conn.laneIndex = k;
    conn.fromLane = lane;
    conn.toLane = toLane;
    // Tunnel lanes go under an underpass node: no lights, no conflicts with the junction above.
    conn.under = !!(I.def.underpass && lane.type === 'tunnel' && m === 'straight');
    this._addConnector(I, conn);
    let wide = null;
    if (widePts) {
      wide = new Segment('connector', `${conn.id}w`, new Path(widePts));
      Object.assign(wide, { intersection: I, arm: X, exitArm: Y, movement: m, laneIndex: k, fromLane: lane, toLane, wide: true });
      this._addConnector(I, wide);
    }
    return { conn, wide };
  }

  /**
   * Path round a rotonda from approach point p0 to exit point p3, counter-clockwise on screen
   * (right-hand traffic keeps the island on its left). Right turns and the curb lane ride the outer
   * ring lane, lefts, U-turns and the inner approach lanes the inner one. The radius eases in from
   * the stop line and back out to the exit, and the heading is radial at both ends, so the path
   * joins its lanes without a kink.
   */
  _ringPath(I, p0, p3, m, k, lane) {
    const { ri, ro, lanes } = I.ring;
    const rIn = ri + 0.3 + LANE_WIDTH / 2;
    const rOut = ro - 0.3 - LANE_WIDTH / 2;
    const inner = lanes > 1 && (m === 'left' || m === 'uturn' || (m === 'straight' && k === 0 && !lane.isCurb));
    const rc = lanes > 1 ? (inner ? rIn : rOut) : (rIn + rOut) / 2;
    const a0 = Math.atan2(p0.y - I.y, p0.x - I.x);
    const a3 = Math.atan2(p3.y - I.y, p3.x - I.x);
    const r0 = Math.hypot(p0.x - I.x, p0.y - I.y);
    const r3 = Math.hypot(p3.x - I.x, p3.y - I.y);
    let sweep = (a0 - a3) % (Math.PI * 2);
    if (sweep <= 0.05) sweep += Math.PI * 2;
    const n = Math.max(24, Math.ceil(sweep / 0.08));
    const ta = Math.min(0.3, 0.9 / sweep); // share of the path spent easing in (and out)
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const e = u * u * (3 - 2 * u); // heading starts and ends radial
      const a = a0 - sweep * e;
      let r = rc;
      if (u < ta) r += (r0 - rc) * (1 - u / ta) ** 2;
      if (u > 1 - ta) r += (r3 - rc) * ((u - (1 - ta)) / ta) ** 2;
      pts.push({ x: I.x + Math.cos(a) * r, y: I.y + Math.sin(a) * r });
    }
    pts[0] = { x: p0.x, y: p0.y };
    pts[n] = { x: p3.x, y: p3.y };
    return pts;
  }

  /** Levels of lanes and connectors (see RAMP_LAYER etc.). Lanes may change level along their length. */
  _assignLayers() {
    for (const c of this.connectors) c.layer = c.under ? UNDER_LAYER : c.intersection.layer;
    for (const lane of this.lanes) {
      const a = lane.startInt ? lane.startInt.layer : null;
      const b = lane.endInt ? lane.endInt.layer : null;
      let base = a ?? b ?? 0;
      if (a !== null && b !== null && a !== b) base = RAMP_LAYER;
      lane.layerA = base;
      lane.layerB = base;
      lane.layerSplit = Infinity;
      if (lane.type === 'tunnel') {
        // Down into the trench toward an underpass node, up again after it.
        if (lane.endInt?.def.underpass) {
          lane.layerB = TRENCH_LAYER;
          lane.layerSplit = Math.max(0, lane.length - PORTAL);
        } else if (lane.startInt?.def.underpass) {
          lane.layerA = TRENCH_LAYER;
          lane.layerSplit = Math.min(lane.length, PORTAL);
        }
      }
      lane.layered = lane.layerA !== 0 || lane.layerB !== 0;
    }
    this.layered = this.lanes.some((l) => l.layered) || this.connectors.some((c) => c.layer !== 0);
  }

  _addConnector(I, conn) {
    // Turns get a cornering speed, so drivers ease off before the turn instead of braking in it.
    conn.curves = conn.movement === 'straight' ? [] : pathCurveLimits(conn.path);
    I.connectors.push(conn);
    this.connectors.push(conn);
    this.segments.push(conn);
  }

  /** Connector a vehicle of this size takes for `move` from `lane` (wide swing for buses and trucks). */
  static connectorFor(lane, move, spec) {
    // A coned-off exit lane (contraflow): the same movement into the next lane instead.
    if (lane.connectors[move]?.toLane.closed && lane.connectorsAlt?.[move]) {
      if (spec && spec.length > 8 && lane.connectorsAltWide?.[move]) return lane.connectorsAltWide[move];
      return lane.connectorsAlt[move];
    }
    if (spec && spec.length > 8 && lane.connectorsWide?.[move]) return lane.connectorsWide[move];
    return lane.connectors[move];
  }

  /**
   * Signal phases for a node: the map's own list, or one phase per approach. Each approach is
   * controlled on its own (the opposite road stays red), with all of its movements released.
   */
  _phases(I) {
    const present = (a) => I.arms[a].type !== 'none' && I.approachLanes[a]?.length;
    const label = (arms) => {
      if (arms.length === 1) return this.armLabel(I, arms[0]);
      const names = new Set(arms.map((a) => this.roadName(I, a)));
      if (names.size === 1 && [...names][0]) return [...names][0];
      return GROUP_LABEL[arms.join('')] || arms.join('–');
    };
    if (I.def.phases) return I.def.phases.map((p) => ({ ...p, label: p.label || label(p.arms) }));
    return ARMS.filter(present).map((a) => ({ id: a, arms: [a], label: label([a]) }));
  }

  /** Level of a point s along segment seg. */
  static layerAt(seg, s) {
    if (seg.kind === 'connector') return seg.layer ?? 0;
    return s < seg.layerSplit ? seg.layerA ?? 0 : seg.layerB ?? 0;
  }

  /** Street name of arm `arm` at node I (the node's own name for it, else the road's). */
  roadName(I, arm) {
    return I.def.names?.[arm] || I.arms[arm]?.profile?.name || null;
  }

  /** Short label for traffic coming in on arm `arm`: "Rizal St ↓" (or "North" for unnamed roads). */
  armLabel(I, arm) {
    const name = this.roadName(I, arm);
    return name ? `${name} ${ARM_ARROW[arm]}` : ARM_LABEL[arm];
  }

  /** Long label: "Rizal St (from the north)". */
  armName(I, arm) {
    const name = this.roadName(I, arm);
    const from = `from the ${ARM_LABEL[arm].toLowerCase()}`;
    return name ? `${name} (${from})` : ARM_LABEL[arm];
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
