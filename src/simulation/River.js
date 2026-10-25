// River geometry for maps with water (DOM-free): a smooth centre line through the map's control
// points with a constant width. Roads simply cross it (the renderer draws bridges there); the
// simulation only uses it to keep jaywalkers off bridge spans.

const SAMPLE = 2; // metres between centre-line samples

export class River {
  /** def: { points: [[x, y], ...], width, name } */
  constructor(def) {
    this.width = def.width ?? 20;
    this.name = def.name || null;
    this.boats = def.boats ?? 2;
    this.pts = River.smooth(def.points.map(([x, y]) => ({ x, y })));
    this.s = [0];
    for (let i = 1; i < this.pts.length; i++) {
      this.s.push(this.s[i - 1] + Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].y - this.pts[i - 1].y));
    }
    this.length = this.s[this.s.length - 1];
  }

  /** Catmull-Rom spline through the control points, sampled about every SAMPLE metres. */
  static smooth(cp) {
    if (cp.length < 3) return cp;
    const out = [];
    for (let i = 0; i < cp.length - 1; i++) {
      const p0 = cp[Math.max(0, i - 1)];
      const p1 = cp[i];
      const p2 = cp[i + 1];
      const p3 = cp[Math.min(cp.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / SAMPLE));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    out.push({ ...cp[cp.length - 1] });
    return out;
  }

  /** Position and flow heading at distance s along the centre line, offset `d` to the right. */
  pointAt(s, d = 0, out = {}) {
    const S = this.s;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = S.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo];
    const b = this.pts[hi];
    const seg = S[hi] - S[lo] || 1;
    const t = (s - S[lo]) / seg;
    const dx = (b.x - a.x) / seg;
    const dy = (b.y - a.y) / seg;
    out.x = a.x + (b.x - a.x) * t - dy * d;
    out.y = a.y + (b.y - a.y) * t + dx * d;
    out.angle = Math.atan2(dy, dx);
    return out;
  }

  /** Distance from (x, y) to the centre line. */
  distance(x, y) {
    let best = Infinity;
    const p = this.pts;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1].x;
      const ay = p[i - 1].y;
      const dx = p[i].x - ax;
      const dy = p[i].y - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (d < best) best = d;
    }
    return best;
  }

  /** Is (x, y) over the water (or within `margin` of its banks)? */
  contains(x, y, margin = 0) {
    return this.distance(x, y) < this.width / 2 + margin;
  }
}
