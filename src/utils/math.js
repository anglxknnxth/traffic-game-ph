// Math helpers: seeded RNG, arc-length paths, Bezier curves and oriented bounding boxes.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  next() {
    return this._next();
  }
  range(a, b) {
    return a + (b - a) * this._next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p) {
    return this._next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  weighted(weights) {
    let total = 0;
    for (const k in weights) total += Math.max(0, weights[k]);
    const keys = Object.keys(weights);
    if (total <= 0) return keys[0];
    let r = this._next() * total;
    for (const k of keys) {
      const w = Math.max(0, weights[k]);
      if (r < w) return k;
      r -= w;
    }
    return keys[keys.length - 1];
  }
  exp(rate) {
    return rate > 0 ? -Math.log(1 - this._next()) / rate : Infinity;
  }
}

/** Polyline with arc-length parameterisation; extrapolates linearly past both ends. */
export class Path {
  constructor(points) {
    const pts = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push({ x: p.x, y: p.y });
    }
    if (pts.length < 2) throw new Error('Path needs at least two distinct points');
    const n = pts.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.cum = new Float64Array(n);
    let L = 0;
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.ys[i] = pts[i].y;
      if (i > 0) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      this.cum[i] = L;
    }
    this.length = L;
    this.n = n;
  }

  pointAt(s, out) {
    const { xs, ys, cum, n } = this;
    let i;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = n - 2;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const segLen = cum[i + 1] - cum[i];
    const dx = (xs[i + 1] - xs[i]) / segLen;
    const dy = (ys[i + 1] - ys[i]) / segLen;
    const t = s - cum[i];
    out.x = xs[i] + dx * t;
    out.y = ys[i] + dy * t;
    out.dx = dx;
    out.dy = dy;
    return out;
  }

  points() {
    const res = [];
    for (let i = 0; i < this.n; i++) res.push({ x: this.xs[i], y: this.ys[i] });
    return res;
  }
}

export function cubicBezierPoints(p0, p1, p2, p3, segments = 28) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    pts.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Oriented bounding boxes: { x, y, c, s, hl, hw } where (c, s) is the heading
// unit vector, hl the half-length along heading and hw the half-width.

export function makeObb() {
  return { x: 0, y: 0, c: 1, s: 0, hl: 1, hw: 1 };
}

export function setObb(o, x, y, c, s, hl, hw) {
  o.x = x;
  o.y = y;
  o.c = c;
  o.s = s;
  o.hl = hl;
  o.hw = hw;
  return o;
}

export function copyObb(dst, src) {
  return setObb(dst, src.x, src.y, src.c, src.s, src.hl, src.hw);
}

/**
 * Separating-axis overlap test. `pad` inflates box `a` on every side.
 * Touching boxes (zero penetration within `eps`) are not considered overlapping.
 */
export function obbOverlap(a, b, pad = 0, eps = 1e-9) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ahl = a.hl + pad;
  const ahw = a.hw + pad;
  // axis a.u
  let ax = a.c;
  let ay = a.s;
  if (Math.abs(dx * ax + dy * ay) >= ahl + b.hl * Math.abs(b.c * ax + b.s * ay) + b.hw * Math.abs(-b.s * ax + b.c * ay) - eps) return false;
  // axis a.v
  ax = -a.s;
  ay = a.c;
  if (Math.abs(dx * ax + dy * ay) >= ahw + b.hl * Math.abs(b.c * ax + b.s * ay) + b.hw * Math.abs(-b.s * ax + b.c * ay) - eps) return false;
  // axis b.u
  ax = b.c;
  ay = b.s;
  if (Math.abs(dx * ax + dy * ay) >= b.hl + ahl * Math.abs(a.c * ax + a.s * ay) + ahw * Math.abs(-a.s * ax + a.c * ay) - eps) return false;
  // axis b.v
  ax = -b.s;
  ay = b.c;
  if (Math.abs(dx * ax + dy * ay) >= b.hw + ahl * Math.abs(a.c * ax + a.s * ay) + ahw * Math.abs(-a.s * ax + a.c * ay) - eps) return false;
  return true;
}

export function obbCorners(o, out = new Float64Array(8)) {
  const ux = o.c * o.hl;
  const uy = o.s * o.hl;
  const vx = -o.s * o.hw;
  const vy = o.c * o.hw;
  out[0] = o.x + ux + vx;
  out[1] = o.y + uy + vy;
  out[2] = o.x + ux - vx;
  out[3] = o.y + uy - vy;
  out[4] = o.x - ux - vx;
  out[5] = o.y - uy - vy;
  out[6] = o.x - ux + vx;
  out[7] = o.y - uy + vy;
  return out;
}

export function pointSegDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  return cx * cx + cy * cy;
}

const _ca = new Float64Array(8);
const _cb = new Float64Array(8);

/** Minimum distance between two OBBs (0 when they overlap). */
export function obbDistance(a, b) {
  if (obbOverlap(a, b, 0, -1e-9)) return 0;
  obbCorners(a, _ca);
  obbCorners(b, _cb);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const px = _ca[i * 2];
    const py = _ca[i * 2 + 1];
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      const d = pointSegDist2(px, py, _cb[j * 2], _cb[j * 2 + 1], _cb[k * 2], _cb[k * 2 + 1]);
      if (d < best) best = d;
    }
  }
  for (let i = 0; i < 4; i++) {
    const px = _cb[i * 2];
    const py = _cb[i * 2 + 1];
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      const d = pointSegDist2(px, py, _ca[j * 2], _ca[j * 2 + 1], _ca[k * 2], _ca[k * 2 + 1]);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
