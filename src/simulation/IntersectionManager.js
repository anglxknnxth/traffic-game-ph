// Intersection space reservation.
// The intersection (plus a margin past each stop line) is divided into a fine grid of conflict cells.
// Each connector + vehicle type has a precomputed footprint: the cells its padded body sweeps while
// traversing, and the path progress after which each cell is free again. A vehicle may only enter
// when every footprint cell is free (or held by a vehicle on the very same connector, which is then
// simply its leader). Cells are released progressively as the vehicle's body leaves them.
// The grid is rectangular so wide avenues (EDSA, Commonwealth) fit; unsignalised nodes add a
// right-of-way rank per movement.

import { makeObb, setObb, obbOverlap } from '../utils/math.js';
import { CELL_SIZE, FOOTPRINT_PAD, GRID_EXTENSION, LANE_WIDTH, ARMS } from '../data/config.js';
import { VEHICLE_TYPES } from '../data/vehicles.js';

const SHARE_MARGIN = 1.0; // seconds between one vehicle leaving a shared cell and the next arriving
const PED_AHEAD = 2.5; // metres of crosswalk a walking pedestrian holds ahead of themselves
const _pt = { x: 0, y: 0, dx: 0, dy: 0 };
const _pa = { x: 0, y: 0, dx: 0, dy: 0 };
const _pb = { x: 0, y: 0, dx: 0, dy: 0 };

/**
 * Right-of-way rank of a movement at an unsignalised node (lower goes first).
 * U-turn slots: through traffic before U-turners. Yield nodes: major-road straight/right, then
 * major-road lefts, then everything from the minor arms.
 */
export function priorityRank(I, conn) {
  if (I.kind === 'uturn') return conn.movement === 'uturn' ? 1 : 0;
  if (I.kind === 'yield') {
    const major = I.major.has(conn.arm);
    if (major) return conn.movement === 'left' ? 1 : 0;
    return conn.movement === 'left' ? 3 : 2;
  }
  return 0;
}

export class IntersectionManager {
  constructor(intersection, { cellSize = CELL_SIZE, pad = FOOTPRINT_PAD, extension = GRID_EXTENSION } = {}) {
    const I = intersection;
    this.I = I;
    this.id = I.id;
    this.cellSize = cellSize;
    this.pad = pad;
    // The grid covers the box plus `extension` past every stop line (wide roads give a rectangle).
    const c = I.core;
    const halfX = Math.max(c.maxX - I.x, I.x - c.minX, I.hx) + extension;
    const halfY = Math.max(c.maxY - I.y, I.y - c.minY, I.hy) + extension;
    this.nx = Math.ceil((2 * halfX) / cellSize);
    this.ny = Math.ceil((2 * halfY) / cellSize);
    this.n = this.nx; // row stride
    this.ox = I.x - halfX;
    this.oy = I.y - halfY;
    this.owners = Array.from({ length: this.nx * this.ny }, () => []);
    this.cache = new Map();
    this.conflictCache = new Map();
    this.crossCache = new Map();
    this.reservationCount = 0;
  }

  cellCenter(idx) {
    const ix = idx % this.nx;
    const iy = (idx / this.nx) | 0;
    return { x: this.ox + (ix + 0.5) * this.cellSize, y: this.oy + (iy + 0.5) * this.cellSize };
  }

  _isCore(idx) {
    const c = this.cellCenter(idx);
    const k = this.I.core;
    return c.x >= k.minX && c.x <= k.maxX && c.y >= k.minY && c.y <= k.maxY;
  }

  /** Cells covered by an OBB; calls fn(cellIndex). */
  _rasterize(obb, fn) {
    const cs = this.cellSize;
    const ex = Math.abs(obb.c) * obb.hl + Math.abs(obb.s) * obb.hw;
    const ey = Math.abs(obb.s) * obb.hl + Math.abs(obb.c) * obb.hw;
    const x0 = Math.max(0, Math.floor((obb.x - ex - this.ox) / cs));
    const x1 = Math.min(this.nx - 1, Math.floor((obb.x + ex - this.ox) / cs));
    const y0 = Math.max(0, Math.floor((obb.y - ey - this.oy) / cs));
    const y1 = Math.min(this.ny - 1, Math.floor((obb.y + ey - this.oy) / cs));
    if (x0 > x1 || y0 > y1) return;
    const cell = this._cellObb || (this._cellObb = makeObb());
    const h = cs / 2 - 0.01;
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        setObb(cell, this.ox + (ix + 0.5) * cs, this.oy + (iy + 0.5) * cs, 1, 0, h, h);
        if (obbOverlap(cell, obb)) fn(iy * this.n + ix);
      }
    }
  }

  /** Footprint of `spec` traversing `conn`: cells + the connector progress after which each is free. */
  footprint(conn, spec) {
    const key = `${conn.id}|${spec.key}`;
    let fp = this.cache.get(key);
    if (fp) return fp;
    const hl = spec.length / 2 + this.pad;
    const hw = spec.width / 2 + this.pad;
    const lastS = new Map();
    const firstS = new Map();
    const obb = makeObb();
    const path = conn.path;
    const step = 0.3;
    const sStart = -spec.length / 2;
    const sEnd = path.length + spec.length / 2 + 0.2;
    for (let s = sStart; s <= sEnd + 1e-9; s += step) {
      path.pointAt(s, _pt);
      path.pointAt(s - 0.6, _pa);
      path.pointAt(s + 0.6, _pb);
      const ang = Math.atan2(_pb.y - _pa.y, _pb.x - _pa.x);
      setObb(obb, _pt.x, _pt.y, Math.cos(ang), Math.sin(ang), hl, hw);
      this._rasterize(obb, (idx) => {
        if (!firstS.has(idx)) firstS.set(idx, s);
        lastS.set(idx, s);
      });
    }
    const cells = Int32Array.from(lastS.keys());
    const last = Float64Array.from(cells, (c) => lastS.get(c));
    const first = Float64Array.from(cells, (c) => firstS.get(c));
    const index = new Map();
    for (let i = 0; i < cells.length; i++) index.set(cells[i], i);

    // Cells outside the core that intrude on *other* approach lanes: those lanes must keep clear.
    // (Pedestrian crossings never reach into a lane outside the box.)
    const keepClear = [];
    const lanes = [];
    if (!conn.ped) for (const arm of ARMS) for (const l of this.I.approachLanes[arm] || []) if (l !== conn.fromLane) lanes.push(l);
    const outer = [];
    for (let i = 0; i < cells.length; i++) if (!this._isCore(cells[i])) outer.push(i);
    if (outer.length) {
      for (const lane of lanes) {
        const intr = [];
        const laneBox = makeObb();
        const lp = lane.path;
        lp.pointAt(lane.length - 7, _pt);
        setObb(laneBox, _pt.x, _pt.y, _pt.dx, _pt.dy, 7, LANE_WIDTH / 2);
        const cellBox = makeObb();
        const h = this.cellSize / 2;
        for (const i of outer) {
          const c = this.cellCenter(cells[i]);
          setObb(cellBox, c.x, c.y, 1, 0, h, h);
          if (obbOverlap(cellBox, laneBox)) intr.push(i);
        }
        if (!intr.length) continue;
        // Scan front positions from far back toward the stop line; stop at the first contact.
        const probe = makeObb();
        let limit = null;
        for (let f = lane.length - 14; f <= lane.length + 0.01; f += 0.25) {
          lp.pointAt(f - 0.75, _pt);
          setObb(probe, _pt.x, _pt.y, _pt.dx, _pt.dy, 0.75, 1.3);
          let hit = false;
          for (const i of intr) {
            const c = this.cellCenter(cells[i]);
            setObb(cellBox, c.x, c.y, 1, 0, h, h);
            if (obbOverlap(cellBox, probe)) {
              hit = true;
              break;
            }
          }
          if (hit) {
            limit = f - 0.3;
            break;
          }
        }
        if (limit !== null) {
          let release = 0;
          for (const i of intr) release = Math.max(release, last[i]);
          keepClear.push({ lane, limit, release, cellIdx: intr.map((i) => cells[i]) });
        }
      }
    }

    fp = { cells, firstS: first, lastS: last, index, keepClear };
    this.cache.set(key, fp);
    return fp;
  }

  /** True when every footprint cell is free of conflicting reservations. */
  canReserve(vehicle, conn) {
    return this.findBlocker(vehicle, conn) === null;
  }

  /**
   * The vehicle preventing `vehicle` from reserving `conn`, or null when the path is free.
   * With `arrival` ({ dist, v, a }: distance from the front to the stop line, speed, acceleration),
   * a cell still held by a moving vehicle that will have left it well before we can get there is
   * treated as free: the two reservations then share it, and the later vehicle must stop short of
   * it until the earlier one has released it (see sharedLimit).
   */
  findBlocker(vehicle, conn, arrival = null) {
    const fp = this.footprint(conn, vehicle.spec);
    const { cells } = fp;
    for (let i = 0; i < cells.length; i++) {
      const owners = this.owners[cells[i]];
      for (let j = 0; j < owners.length; j++) {
        const o = owners[j];
        if (o === vehicle) continue;
        const r = o.reservations.get(this.id);
        if (r && r.conn === conn) continue;
        if (arrival && r && this._clearsBefore(o, r, cells[i], vehicle, fp.firstS[i], arrival)) continue;
        return o;
      }
    }
    // Vehicles physically standing in intruded areas of other lanes block the reservation.
    for (const kc of fp.keepClear) {
      for (const other of kc.lane.vehicles) {
        if (other === vehicle) continue;
        if (other.localS + other.hl <= kc.limit) continue;
        return other;
      }
    }
    return null;
  }

  /** Connectors whose traffic has right of way over `conn` and whose paths cross it (unsignalised nodes). */
  priorityConflicts(conn) {
    let list = this.conflictCache.get(conn);
    if (list) return list;
    list = [];
    const rank = priorityRank(this.I, conn);
    if (rank > 0) {
      const mine = new Set(this.footprint(conn, VEHICLE_TYPES.car).cells);
      for (const other of this.I.connectors) {
        if (other === conn || priorityRank(this.I, other) >= rank) continue;
        const cells = this.footprint(other, VEHICLE_TYPES.car).cells;
        for (let i = 0; i < cells.length; i++) {
          if (mine.has(cells[i])) {
            list.push(other);
            break;
          }
        }
      }
    }
    this.conflictCache.set(conn, list);
    return list;
  }

  /** Connectors from the other approaches whose paths overlap this one (all-way-stop order). */
  crossConflicts(conn) {
    let list = this.crossCache.get(conn);
    if (list) return list;
    list = [];
    const mine = new Set(this.footprint(conn, VEHICLE_TYPES.car).cells);
    for (const other of this.I.connectors) {
      if (other.arm === conn.arm) continue;
      const cells = this.footprint(other, VEHICLE_TYPES.car).cells;
      for (let i = 0; i < cells.length; i++) {
        if (mine.has(cells[i])) {
          list.push(other);
          break;
        }
      }
    }
    this.crossCache.set(conn, list);
    return list;
  }

  /**
   * Will vehicle O (reservation r) have left cell `idx` at least SHARE_MARGIN seconds before
   * `vehicle` could possibly reach it? Only for moving, well-behaved vehicles.
   */
  _clearsBefore(o, r, idx, vehicle, firstS, arrival) {
    if (o.isPed || o.v < 2 || o.a < -1 || o.boxBlocker || o.emergency) return false;
    if (o.cornerStop && o.cornerStop.state !== 'done') return false;
    const k = r.fp.index.get(idx);
    if (k === undefined) return false;
    const left = r.fp.lastS[k] - (o.s - r.connStart);
    if (left <= 0) return true;
    const tClear = left / o.v;
    if (tClear > 3) return false;
    // Earliest arrival of our body centre at the cell: full acceleration from the current speed.
    const d = arrival.dist + vehicle.hl + firstS;
    if (d <= 0) return false;
    const a = Math.max(0.5, arrival.a);
    const tArrive = (-arrival.v + Math.sqrt(arrival.v * arrival.v + 2 * a * d)) / a;
    return tClear + SHARE_MARGIN < tArrive;
  }

  reserve(vehicle, conn, connStart) {
    const fp = this.footprint(conn, vehicle.spec);
    const held = new Uint8Array(fp.cells.length).fill(1);
    // Cells still held by someone else (time-shared, see findBlocker): wait short of them until freed.
    let shared = null;
    for (let i = 0; i < fp.cells.length; i++) {
      const owners = this.owners[fp.cells[i]];
      for (const o of owners) {
        if (o === vehicle || o.isPed) continue;
        const r = o.reservations.get(this.id);
        if (r && r.conn === conn) continue;
        (shared ||= []).push({ idx: fp.cells[i], firstS: fp.firstS[i], owner: o });
      }
      owners.push(vehicle);
    }
    const res = { conn, fp, held, remaining: fp.cells.length, connStart, keepClearActive: fp.keepClear.length > 0, shared };
    vehicle.reservations.set(this.id, res);
    for (const kc of fp.keepClear) kc.lane.keepClear.set(vehicle, kc.limit);
    this.reservationCount++;
    return res;
  }

  /**
   * Furthest connector progress (body centre) `vehicle` may reach while cells it shares are still
   * held by the vehicle that had them first; null when nothing is pending.
   */
  sharedLimit(vehicle) {
    const res = vehicle.reservations.get(this.id);
    if (!res || !res.shared) return null;
    let lim = null;
    let pending = false;
    for (const sc of res.shared) {
      if (!sc.owner || !this.owners[sc.idx].includes(sc.owner)) {
        sc.owner = null;
        continue;
      }
      pending = true;
      const l = sc.firstS - 0.3;
      if (lim === null || l < lim) lim = l;
    }
    if (!pending) res.shared = null;
    return lim;
  }

  _removeOwner(idx, vehicle) {
    const arr = this.owners[idx];
    const k = arr.indexOf(vehicle);
    if (k >= 0) {
      arr[k] = arr[arr.length - 1];
      arr.pop();
    }
  }

  /** Release cells the vehicle body has fully passed. Returns true when the reservation is gone. */
  releaseProgress(vehicle, progress) {
    const res = vehicle.reservations.get(this.id);
    if (!res) return true;
    const { fp, held } = res;
    for (let i = 0; i < held.length; i++) {
      if (held[i] && progress > fp.lastS[i]) {
        held[i] = 0;
        res.remaining--;
        this._removeOwner(fp.cells[i], vehicle);
      }
    }
    if (res.keepClearActive) {
      let any = false;
      for (const kc of fp.keepClear) {
        if (progress > kc.release) kc.lane.keepClear.delete(vehicle);
        else any = true;
      }
      res.keepClearActive = any;
    }
    if (res.remaining <= 0) {
      this._finish(vehicle, res);
      return true;
    }
    return false;
  }

  releaseAll(vehicle) {
    const res = vehicle.reservations.get(this.id);
    if (!res) return;
    const { fp, held } = res;
    for (let i = 0; i < held.length; i++) {
      if (held[i]) {
        held[i] = 0;
        this._removeOwner(fp.cells[i], vehicle);
      }
    }
    res.remaining = 0;
    this._finish(vehicle, res);
  }

  _finish(vehicle, res) {
    for (const kc of res.fp.keepClear) kc.lane.keepClear.delete(vehicle);
    vehicle.reservations.delete(this.id);
  }

  // ---------------------------------------------------------------- pedestrians
  // Pedestrians reserve their crosswalk line exactly like vehicles reserve a path. They share cells
  // with each other (people walk past one another) but never with a vehicle, in either direction.

  /** The vehicle holding any cell of footprint `fp`, or null when a pedestrian may step out. */
  vehicleOn(fp) {
    for (let i = 0; i < fp.cells.length; i++) {
      const owners = this.owners[fp.cells[i]];
      for (let j = 0; j < owners.length; j++) if (!owners[j].isPed) return owners[j];
    }
    return null;
  }

  reservePed(ped, conn, fp) {
    const held = new Uint8Array(fp.cells.length).fill(1);
    for (let i = 0; i < fp.cells.length; i++) this.owners[fp.cells[i]].push(ped);
    ped.reservations.set(this.id, { conn, fp, held, remaining: fp.cells.length });
  }

  /**
   * Moving window: make sure the pedestrian holds every crossing cell from `progress` to
   * `progress + PED_AHEAD`. Returns false, acquiring nothing, when a vehicle holds any of them
   * (the pedestrian then waits where they are). After waiting `patient` seconds mid-road they
   * also claim every free cell still ahead, so no new vehicle can cut in before they finish.
   */
  pedAdvance(ped, conn, fp, progress, patient = 0) {
    let res = ped.reservations.get(this.id);
    if (!res || res.conn !== conn) {
      if (res) this.releasePedAll(ped);
      res = { conn, fp, held: new Uint8Array(fp.cells.length), remaining: 0 };
      ped.reservations.set(this.id, res);
    }
    const reach = progress + PED_AHEAD;
    for (let i = 0; i < fp.cells.length; i++) {
      if (res.held[i] || fp.firstS[i] > reach || fp.lastS[i] < progress) continue;
      const owners = this.owners[fp.cells[i]];
      for (let j = 0; j < owners.length; j++) if (!owners[j].isPed) {
        if (patient > 1) this._pedClaimAhead(ped, res, progress);
        return false;
      }
    }
    for (let i = 0; i < fp.cells.length; i++) {
      if (res.held[i] || fp.firstS[i] > reach || fp.lastS[i] < progress) continue;
      res.held[i] = 1;
      res.remaining++;
      this.owners[fp.cells[i]].push(ped);
    }
    return true;
  }

  _pedClaimAhead(ped, res, progress) {
    const fp = res.fp;
    for (let i = 0; i < fp.cells.length; i++) {
      if (res.held[i] || fp.lastS[i] < progress) continue;
      const owners = this.owners[fp.cells[i]];
      if (owners.some((o) => !o.isPed)) continue;
      res.held[i] = 1;
      res.remaining++;
      owners.push(ped);
    }
  }

  /** Release crossing cells the pedestrian has walked past. */
  releasePed(ped, progress) {
    const res = ped.reservations.get(this.id);
    if (!res) return;
    for (let i = 0; i < res.held.length; i++) {
      if (res.held[i] && progress > res.fp.lastS[i]) {
        res.held[i] = 0;
        res.remaining--;
        this._removeOwner(res.fp.cells[i], ped);
      }
    }
    // (The reservation record stays while crossing: the window keeps acquiring cells ahead.)
  }

  releasePedAll(ped) {
    const res = ped.reservations.get(this.id);
    if (!res) return;
    for (let i = 0; i < res.held.length; i++) if (res.held[i]) this._removeOwner(res.fp.cells[i], ped);
    ped.reservations.delete(this.id);
  }

  /** Iterate reserved cells: fn(x, y, size, ownerList). */
  forEachReserved(fn) {
    for (let i = 0; i < this.owners.length; i++) {
      if (this.owners[i].length) {
        const c = this.cellCenter(i);
        fn(c.x, c.y, this.cellSize, this.owners[i]);
      }
    }
  }

  reservedCellCount() {
    let n = 0;
    for (const o of this.owners) if (o.length) n++;
    return n;
  }
}
