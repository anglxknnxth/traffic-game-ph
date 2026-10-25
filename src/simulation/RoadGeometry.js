// Road centre lines. Every arm of a node (and every link between two nodes) has a centre line that
// starts at the node centre and runs outward. Lanes are offset curves of it: a point `d` metres to
// the right of the centre line at distance `u` is C(u) + rightOf(T(u)) * d, which on a straight arm
// is exactly the old arm frame (local x = u, local y = d).
//
// Shapes (map data, per node arm):  shape: { N: [{ straight: 45 }, { curve: -30, radius: 70 }, ...] }
//   straight: metres along the current heading
//   curve:    degrees to turn (+ = clockwise on screen) over an arc of `radius` metres
// The road continues straight at the final heading for as long as the arm needs. Roads stay
// straight near junctions (STRAIGHT_LEAD past the stop line) so stop lines, crosswalks, lane arrows
// and the conflict grid keep their simple geometry.
//
// Links between nodes that are not aligned become S-curves: a straight lead out of each node joined
// by a cubic Bézier.

// The intersection conflict grid reaches GRID_EXTENSION (10 m) past each stop line and connector
// footprints extrapolate straight from the stop line, so lanes must stay straight a little beyond.
export const STRAIGHT_LEAD = 14; // metres past the stop line that must stay straight on external arms
export const LINK_LEAD = 12; // the same for each end of a link road

const SAMPLE = 1; // metres between centre line samples on curves

export class Centerline {
  /** pts: [{ x, y, tx, ty, u }] in increasing u with unit tangents. */
  constructor(pts) {
    this.pts = pts;
    this.n = pts.length;
    this.us = Float64Array.from(pts, (p) => p.u);
    this.length = pts[pts.length - 1].u;
    let minR = Infinity;
    for (let i = 1; i < this.n; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dphi = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
      if (dphi > 1e-9) minR = Math.min(minR, (b.u - a.u) / dphi);
    }
    this.minRadius = minR;
    this.straight = this.n === 2;
  }

  _index(u) {
    const us = this.us;
    if (u <= us[0]) return 0;
    if (u >= us[this.n - 1]) return this.n - 2;
    let lo = 0;
    let hi = this.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (us[mid] <= u) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Position and unit tangent at u (extrapolates straight past both ends). */
  pose(u, out = {}) {
    const P = this.pts;
    if (u <= 0 || u >= this.length) {
      const e = u <= 0 ? P[0] : P[this.n - 1];
      const k = u <= 0 ? u : u - this.length;
      out.x = e.x + e.tx * k;
      out.y = e.y + e.ty * k;
      out.tx = e.tx;
      out.ty = e.ty;
      return out;
    }
    const i = this._index(u);
    const a = P[i];
    const b = P[i + 1];
    const t = (u - a.u) / (b.u - a.u);
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    const tx = a.tx + (b.tx - a.tx) * t;
    const ty = a.ty + (b.ty - a.ty) * t;
    const m = Math.hypot(tx, ty) || 1;
    out.tx = tx / m;
    out.ty = ty / m;
    return out;
  }

  /** Point d metres right of the centre line at u, with the heading angle there. */
  point(u, d, out = {}) {
    this.pose(u, out);
    out.x += -out.ty * d;
    out.y += out.tx * d;
    out.angle = Math.atan2(out.ty, out.tx);
    return out;
  }

  /** True when the centre line has no bend between u0 and u1. */
  isStraight(u0, u1) {
    if (this.straight) return true;
    const a = this.pose(Math.max(0, u0));
    const b = this.pose(Math.min(this.length, u1));
    if (Math.abs(a.tx * b.ty - a.ty * b.tx) > 1e-9 || a.tx * b.tx + a.ty * b.ty < 0) return false;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[i];
      if (p.u <= u0 || p.u >= u1) continue;
      if (Math.abs(a.tx * p.ty - a.ty * p.tx) > 1e-9) return false;
    }
    return true;
  }

  /** Offset curve from u0 to u1 (u0 < u1) at lateral offset d: points plus their centre line u. */
  offset(u0, u1, d) {
    const points = [];
    const params = [];
    const add = (u) => {
      const p = this.point(u, d);
      points.push({ x: p.x, y: p.y });
      params.push(u);
    };
    add(u0);
    for (let i = 0; i < this.n; i++) {
      const u = this.pts[i].u;
      if (u > u0 + 1e-6 && u < u1 - 1e-6) add(u);
    }
    add(u1);
    // Collapse collinear runs so straight lanes stay two-point paths.
    const keepP = [points[0]];
    const keepU = [params[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = keepP[keepP.length - 1];
      const b = points[i];
      const c = points[i + 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 1e-7) {
        keepP.push(b);
        keepU.push(params[i]);
      }
    }
    keepP.push(points[points.length - 1]);
    keepU.push(params[params.length - 1]);
    return { points: keepP, params: keepU };
  }

  /** The same line walked from the other end. */
  reversed() {
    const L = this.length;
    return new Centerline(
      [...this.pts].reverse().map((p) => ({ x: p.x, y: p.y, tx: -p.tx, ty: -p.ty, u: L - p.u })),
    );
  }

  /**
   * Arm centre line from the node centre along `dir`, following shape ops, at least `length` long.
   * `minLead` is the straight distance the shape must keep before its first bend.
   */
  static fromShape(origin, dir, ops = [], length, minLead = 0) {
    const pts = [{ x: origin.x, y: origin.y, tx: dir.x, ty: dir.y, u: 0 }];
    let x = origin.x;
    let y = origin.y;
    let phi = Math.atan2(dir.y, dir.x);
    let u = 0;
    let firstBend = null;
    for (const op of ops) {
      if (op.straight) {
        u += op.straight;
        x += Math.cos(phi) * op.straight;
        y += Math.sin(phi) * op.straight;
        pts.push({ x, y, tx: Math.cos(phi), ty: Math.sin(phi), u });
      } else if (op.curve) {
        const R = op.radius;
        if (!(R > 0)) throw new Error('Curve needs a positive radius');
        if (firstBend === null) firstBend = u;
        const total = (op.curve * Math.PI) / 180;
        const len = Math.abs(total) * R;
        const steps = Math.max(2, Math.ceil(len / SAMPLE));
        const dphi = total / steps;
        for (let k = 0; k < steps; k++) {
          // Exact arc step: chord 2R·sin(dφ/2) along the mid heading.
          const chord = 2 * R * Math.sin(Math.abs(dphi) / 2);
          const mid = phi + dphi / 2;
          x += Math.cos(mid) * chord;
          y += Math.sin(mid) * chord;
          phi += dphi;
          u += len / steps;
          pts.push({ x, y, tx: Math.cos(phi), ty: Math.sin(phi), u });
        }
      }
    }
    if (firstBend !== null && firstBend < minLead - 1e-6) throw new Error(`Road bends ${firstBend.toFixed(1)} m from the junction; keep at least ${minLead.toFixed(1)} m straight`);
    if (u < length) {
      const k = length - u;
      pts.push({ x: x + Math.cos(phi) * k, y: y + Math.sin(phi) * k, tx: Math.cos(phi), ty: Math.sin(phi), u: length });
    }
    return new Centerline(mergeStraight(pts));
  }

  /**
   * Link centre line from node A (leaving along eA) to node B (entering against eB, B's outward
   * arm direction). Straight when the nodes line up, otherwise an S-curve between straight leads.
   */
  static link(A, eA, leadA, B, eB, leadB) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const along = dx * eA.x + dy * eA.y;
    const lateral = -dx * eA.y + dy * eA.x;
    const opposite = Math.abs(eA.x + eB.x) < 1e-9 && Math.abs(eA.y + eB.y) < 1e-9;
    if (opposite && Math.abs(lateral) < 1e-9) {
      return new Centerline([
        { x: A.x, y: A.y, tx: eA.x, ty: eA.y, u: 0 },
        { x: B.x, y: B.y, tx: eA.x, ty: eA.y, u: along },
      ]);
    }
    const p0 = { x: A.x + eA.x * leadA, y: A.y + eA.y * leadA };
    const p3 = { x: B.x + eB.x * leadB, y: B.y + eB.y * leadB };
    const span = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    if (span < 8) throw new Error('Link too short for its curve');
    const k = span * 0.42;
    const p1 = { x: p0.x + eA.x * k, y: p0.y + eA.y * k };
    const p2 = { x: p3.x + eB.x * k, y: p3.y + eB.y * k };
    const pts = [{ x: A.x, y: A.y, tx: eA.x, ty: eA.y, u: 0 }, { x: p0.x, y: p0.y, tx: eA.x, ty: eA.y, u: leadA }];
    const steps = Math.max(8, Math.ceil((span * 1.3) / SAMPLE));
    let u = leadA;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const s = 1 - t;
      const x = s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x;
      const y = s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y;
      const ddx = 3 * s * s * (p1.x - p0.x) + 6 * s * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
      const ddy = 3 * s * s * (p1.y - p0.y) + 6 * s * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
      const m = Math.hypot(ddx, ddy) || 1;
      u += Math.hypot(x - prev.x, y - prev.y);
      pts.push({ x, y, tx: ddx / m, ty: ddy / m, u });
      prev = { x, y };
    }
    u += leadB;
    pts.push({ x: B.x, y: B.y, tx: -eB.x, ty: -eB.y, u });
    return new Centerline(pts);
  }
}

/** Drop intermediate points on straight runs (same tangent and collinear). */
function mergeStraight(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const sameDir = Math.abs(a.tx * b.ty - a.ty * b.tx) < 1e-9 && Math.abs(b.tx * c.ty - b.ty * c.tx) < 1e-9;
    if (!sameDir) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Curved stretches of a lane as [{ s0, s1, vmax }] in lane coordinates (comfortable cornering speed). */
export function curveLimits(center, uStart, uEnd, reversed) {
  const out = [];
  const P = center.pts;
  for (let i = 1; i < center.n; i++) {
    const a = P[i - 1];
    const b = P[i];
    if (b.u <= uStart || a.u >= uEnd) continue;
    const dphi = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
    if (dphi < 1e-6) continue;
    const R = (b.u - a.u) / dphi;
    const vmax = Math.sqrt(2.2 * R);
    if (vmax > 15) continue; // gentle bends need no slowing
    const u0 = Math.max(uStart, a.u);
    const u1 = Math.min(uEnd, b.u);
    const s0 = reversed ? uEnd - u1 : u0 - uStart;
    const s1 = reversed ? uEnd - u0 : u1 - uStart;
    const last = out[out.length - 1];
    if (last && Math.abs(last.vmax - vmax) < 0.3 && Math.abs((reversed ? last.s0 : last.s1) - (reversed ? s1 : s0)) < 1e-6) {
      if (reversed) last.s0 = s0;
      else last.s1 = s1;
    } else out.push({ s0, s1, vmax });
  }
  out.sort((p, q) => p.s0 - q.s0);
  return out;
}
