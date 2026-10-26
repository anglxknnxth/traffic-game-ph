// Hard collision gate. Every proposed vehicle movement passes through here before it is applied.
// A move is rejected (shortened, possibly to zero) when the vehicle body, swept between its current
// and proposed pose, would come closer than MIN_BUFFER to any other vehicle.

import { makeObb, obbOverlap, obbDistance } from '../utils/math.js';
import { MIN_BUFFER, MAX_VEHICLE_RADIUS } from '../data/config.js';

export class SpatialHash {
  constructor(cellSize = 12) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.pool = [];
  }
  clear() {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }
  _key(ix, iy) {
    return ix * 73856093 + iy * 19349663;
  }
  insert(item, x, y, r) {
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this._key(ix, iy);
        let arr = this.cells.get(k);
        if (!arr) {
          arr = this.pool.pop() || [];
          this.cells.set(k, arr);
        }
        arr.push(item);
      }
    }
  }
  query(x, y, r, out, stamp) {
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const arr = this.cells.get(this._key(ix, iy));
        if (!arr) continue;
        for (const it of arr) {
          if (it._qstamp !== stamp) {
            it._qstamp = stamp;
            out.push(it);
          }
        }
      }
    }
    return out;
  }
}

export class CollisionAvoidance {
  constructor({ buffer = MIN_BUFFER, sweepStep = 0.2 } = {}) {
    this.buffer = buffer;
    this.sweepStep = sweepStep;
    this.hash = new SpatialHash(12);
    this.vehicles = [];
    this._tmp = makeObb();
    this._nb = [];
    this._stamp = 0;
    this.rejections = 0;
  }

  /** Rebuild the broad-phase grid. Movement per step is tiny, so a margin keeps it valid all step. */
  rebuild(vehicles) {
    this.vehicles = vehicles;
    this.hash.clear();
    for (const v of vehicles) this.hash.insert(v, v.x, v.y, v.radius + 0.6);
  }

  /** Add a vehicle mid-step (e.g. just spawned). */
  add(v) {
    this.hash.insert(v, v.x, v.y, v.radius + 0.6);
  }

  neighbors(v, extra = 0) {
    const out = this._nb;
    out.length = 0;
    this._stamp++;
    this.hash.query(v.x, v.y, v.radius + extra + MAX_VEHICLE_RADIUS + this.buffer + 1.2, out, this._stamp);
    let w = 0;
    const reach = v.radius + extra + this.buffer + 0.7;
    for (let i = 0; i < out.length; i++) {
      const n = out[i];
      if (n === v) continue;
      // Different levels (an expressway above, a tunnel below) never interact.
      if (Math.abs((n.layer || 0) - (v.layer || 0)) >= 1) continue;
      const dx = n.x - v.x;
      const dy = n.y - v.y;
      const r = reach + n.radius;
      if (dx * dx + dy * dy > r * r) continue;
      out[w++] = n;
    }
    out.length = w;
    return out;
  }

  /**
   * True if `vehicle` may occupy `pose`. A pose closer than the buffer to a neighbour is allowed only
   * when it does not reduce the current separation and the bodies do not physically overlap.
   */
  isPoseSafe(vehicle, pose, neighbors) {
    const buf = this.buffer;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!obbOverlap(pose, n.obb, buf)) continue;
      const dNew = obbDistance(pose, n.obb);
      if (dNew >= buf) continue;
      if (dNew > 0) {
        const dCur = obbDistance(vehicle.obb, n.obb);
        // (float noise only: a 1e-6 slack let two stuck bodies creep together about 1 cm per 3 min)
        if (dNew >= dCur - 1e-9) continue;
      }
      return false;
    }
    return true;
  }

  /** Strict check (no escape clause): pose keeps at least the buffer from every neighbour. */
  isClear(pose, neighbors) {
    const buf = this.buffer;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (obbOverlap(pose, n.obb, buf) && obbDistance(pose, n.obb) < buf) return false;
    }
    return true;
  }

  /**
   * Largest advance <= ds along the vehicle's own path that keeps it collision-free.
   * `poseFn(s, out)` writes the vehicle OBB at route coordinate s.
   */
  safeAdvance(vehicle, ds, poseFn = (s, out) => vehicle.poseAt(s, out)) {
    if (ds <= 0) return 0;
    const nb = this.neighbors(vehicle, ds);
    if (nb.length === 0) return ds;
    const tmp = this._tmp;
    const steps = Math.max(1, Math.ceil(ds / this.sweepStep));
    let safe = 0;
    for (let i = 1; i <= steps; i++) {
      const d = (ds * i) / steps;
      poseFn(vehicle.s + d, tmp);
      if (this.isPoseSafe(vehicle, tmp, nb)) {
        safe = d;
        continue;
      }
      // bisect between last safe and first unsafe sample
      let lo = safe;
      let hi = d;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        poseFn(vehicle.s + mid, tmp);
        if (this.isPoseSafe(vehicle, tmp, nb)) lo = mid;
        else hi = mid;
      }
      this.rejections++;
      return lo;
    }
    return ds;
  }

  /**
   * Look ahead along the vehicle's path for an obstacle not handled by car-following (crossing or
   * merging traffic). Returns the free distance before the first conflicting pose, or Infinity.
   */
  probe(vehicle, maxDist, poseFn = (s, out) => vehicle.poseAt(s, out)) {
    if (maxDist <= 0) return Infinity;
    const nb = this.neighbors(vehicle, maxDist);
    if (nb.length === 0) return Infinity;
    // ignore neighbours already inside our inflated envelope (handled by the hard gate)
    const relevant = [];
    for (const n of nb) if (!obbOverlap(vehicle.obb, n.obb, this.buffer)) relevant.push(n);
    if (relevant.length === 0) return Infinity;
    const tmp = this._tmp;
    const marks = [0.6, 1.5, 3, 5, 8, 12, 16];
    let prev = 0;
    for (const d of marks) {
      if (d > maxDist) break;
      poseFn(vehicle.s + d, tmp);
      for (const n of relevant) {
        if (obbOverlap(tmp, n.obb, this.buffer)) return prev;
      }
      prev = d;
    }
    return Infinity;
  }

  /** Checks every pair (via the grid) for overlap or buffer violation. Used by tests and debug. */
  static auditPairs(vehicles, minSeparation = 0) {
    const hash = new SpatialHash(12);
    for (const v of vehicles) hash.insert(v, v.x, v.y, v.radius);
    const issues = [];
    const seen = new Set();
    let stamp = 1;
    const out = [];
    for (const v of vehicles) {
      out.length = 0;
      stamp++;
      hash.query(v.x, v.y, v.radius + MAX_VEHICLE_RADIUS + 1, out, `audit${stamp}`);
      for (const n of out) {
        if (n === v) continue;
        if (Math.abs((n.layer || 0) - (v.layer || 0)) >= 1) continue;
        const key = v.id < n.id ? `${v.id}:${n.id}` : `${n.id}:${v.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!obbOverlap(v.obb, n.obb, minSeparation)) continue;
        const d = obbDistance(v.obb, n.obb);
        if (d === 0 || d < minSeparation) issues.push({ a: v.id, b: n.id, distance: d });
      }
    }
    return issues;
  }
}
