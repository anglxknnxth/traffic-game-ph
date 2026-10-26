// Cache of the static road layer (and the expressway deck) in 256 px tiles, organised like a web
// map: zoom levels in √2 steps (see tileMath), one shared cache over all levels.
//
// Tiles are drawn by Web Workers (tileWorker.js) and arrive as ImageBitmaps, so drawing a tile,
// however busy that part of the map, never costs the page a frame. Without workers (older
// browsers) they are drawn here, a few per frame within a time budget.
//
// Every frame each tile slot on screen shows the target level's tile if it is cached, else the
// same spot cut from the nearest level that has it whole (a sharper one first, then coarser ones),
// down to the base level: a coarse set over the whole camera area, drawn first and never thrown
// away. So the screen is never blank, a zoom shows the right level the moment it is ready, and
// zooming back finds the levels already visited still cached.
//
// Requests go out in order: base level, the target level on screen (centre first), the ring just
// off screen (deeper on the side the camera heads to), and when the camera rests, the levels one
// step in and out, so the next wheel notch is sharp at once.

import { TILE, levelScale, levelFor, tileKey } from './tileMath.js';

const MAX_TILES = 320; // cached tiles over all levels (~80 MB at 256 px)
const BASE_MAX_TILES = 64; // the base level covers the camera area in at most this many tiles
const IN_FLIGHT = 2; // tile requests outstanding per worker
const RING_FRAC = 0.25; // of a frame: drawing tiles on the page when there are no workers
const GAP_FRAC = 0.45;

const textureBase = () => {
  try {
    return new URL(`${import.meta.env?.BASE_URL || './'}textures/`, location.href).href;
  } catch {
    return null;
  }
};

export class StaticTiles {
  constructor() {
    this.cache = new Map(); // tileKey -> { L, i, j, s, e, used, stale, page }
    this.pool = []; // page canvases to reuse
    this.road = null;
    this.version = -1;
    this.frame = 0;
    this.renders = 0; // tiles drawn so far (for the perf overlay)
    this.worstTile = 0; // slowest tile since the perf overlay last read it (ms)
    this.est = 3; // usual ms per tile drawn on the page
    this.ops = []; // this frame's blits: { t, sx, sy, sw, sh, dx, dy, dw, dh }
    this.nOps = 0;
    this.blurry = 0; // target-level slots on screen not yet at their own level (for ?bench)
    this.gen = 0;
    this.workers = null; // [{ w, ready, busy }], or [] when tiles are drawn on the page
    this.pending = new Map(); // tileKey -> worker
    this.baseL = null;
    this._baseSig = '';
    this._cx = null;
    this._cy = null;
  }

  // ------------------------------------------------------------------ workers
  _startWorkers() {
    this.workers = [];
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || /[?&]noworkers\b/.test(location.search)) return;
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let k = 0; k < n; k++) {
      let w;
      try {
        w = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
      } catch {
        break;
      }
      const slot = { w, ready: false, busy: 0 };
      w.onmessage = (ev) => this._onMessage(slot, ev.data);
      w.onerror = () => this._dropWorker(slot);
      this.workers.push(slot);
    }
  }

  _dropWorker(slot) {
    slot.w.terminate();
    this.workers = this.workers.filter((o) => o !== slot);
    for (const [key, o] of this.pending) if (o === slot) this.pending.delete(key);
  }

  _onMessage(slot, m) {
    if (m.gen !== this.gen) {
      m.s?.close?.();
      m.e?.close?.();
      return;
    }
    if (m.type === 'ready') {
      const first = !this.workers.some((o) => o.ready);
      slot.ready = true;
      // Tiles drawn on the page before the workers were ready get redrawn by them (same look as
      // the rest: the workers wait for the photo textures).
      if (first) for (const t of this.cache.values()) if (t.page) t.stale = true;
      return;
    }
    if (m.type !== 'tile') return;
    slot.busy = Math.max(0, slot.busy - 1);
    this.pending.delete(m.key);
    const old = this.cache.get(m.key);
    if (old) this._free(old);
    const L = Math.floor(m.key / 4294967296) - 64;
    this.cache.set(m.key, { L, s: m.s, e: m.e, used: this.frame, stale: false, page: false });
    this.renders++;
    if (m.ms > this.worstTile) this.worstTile = m.ms;
    this.workerMs = (this.workerMs || 0) + m.ms; // total worker time spent on tiles (perf overlay / ?bench)
  }

  _free(t) {
    if (t.page) {
      this.pool.push(t.s);
      if (t.e) this.pool.push(t.e);
    } else {
      t.s?.close?.();
      t.e?.close?.();
    }
  }

  _setRoad(road) {
    for (const t of this.cache.values()) this._free(t);
    this.cache.clear();
    this.pending.clear();
    this.road = road;
    this.version = road.version;
    this.elevated = road.hasElevated;
    this.gen++;
    this.baseL = null;
    this._baseSig = '';
    if (this.workers === null) this._startWorkers();
    const mapId = road.network.map?.id;
    if (!mapId) this.workers.length = 0; // a map the workers cannot look up: draw here
    for (const slot of this.workers) {
      slot.ready = false;
      slot.busy = 0;
      slot.w.postMessage({ type: 'init', gen: this.gen, mapId, textureBase: textureBase() });
    }
  }

  // ------------------------------------------------------------------ drawing a tile on the page
  _canvas() {
    const c = this.pool.pop() || document.createElement('canvas');
    if (c.width !== TILE || c.height !== TILE) {
      c.width = TILE;
      c.height = TILE;
    }
    return c;
  }

  _renderHere(L, i, j) {
    const t0 = performance.now();
    const road = this.road;
    const S = levelScale(L);
    const k = TILE / S;
    const paint = (draw) => {
      const c = this._canvas();
      const g = c.getContext('2d');
      // a pooled canvas: start from a clean state whatever the last tile drawn in it left
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.setLineDash([]);
      g.clearRect(0, 0, TILE, TILE);
      g.setTransform(S, 0, 0, S, -i * TILE, -j * TILE);
      draw(g);
      return c;
    };
    road.view = { minX: i * k, minY: j * k, maxX: (i + 1) * k, maxY: (j + 1) * k };
    road.ppm = S;
    const e = this.elevated && road.elevatedIn(road.view);
    const key = tileKey(L, i, j);
    const old = this.cache.get(key);
    if (old) this._free(old);
    this.cache.set(key, { L, s: paint((g) => road.drawStatic(g)), e: e ? paint((g) => road.drawElevated(g)) : null, used: this.frame, stale: false, page: true });
    road.view = null;
    this.renders++;
    const ms = performance.now() - t0;
    this.est += (ms - this.est) * 0.2;
    if (ms > this.worstTile) this.worstTile = ms;
  }

  // ------------------------------------------------------------------ per frame
  /** Base level: the sharpest one that still covers the camera's whole area in BASE_MAX_TILES. */
  _base(cam) {
    const b = cam.bounds;
    const sig = `${b.minX}|${b.minY}|${b.maxX}|${b.maxY}|${cam.dpr}|${cam.w}|${cam.h}`;
    if (sig === this._baseSig) return;
    this._baseSig = sig;
    let L = levelFor(cam.base * (cam.zoomFloor ?? cam.minZoom) * cam.dpr) - 1;
    const count = (L) => {
      const k = TILE / levelScale(L);
      return (Math.floor(b.maxX / k) - Math.floor(b.minX / k) + 1) * (Math.floor(b.maxY / k) - Math.floor(b.minY / k) + 1);
    };
    while (count(L) > BASE_MAX_TILES) L--;
    this.baseL = L;
    const k = TILE / levelScale(L);
    this.baseKeys = [];
    for (let j = Math.floor(b.minY / k); j <= Math.floor(b.maxY / k); j++) for (let i = Math.floor(b.minX / k); i <= Math.floor(b.maxX / k); i++) this.baseKeys.push(L, i, j);
  }

  /** Tile index range of level L over the screen, grown by `ring`. */
  _range(cam, L, ring = 0) {
    const k = TILE / levelScale(L);
    const s = cam.scale;
    return {
      i0: Math.floor(((0 - cam.screenCX) / s + cam.centerX) / k) - ring,
      i1: Math.floor(((cam.w - cam.screenCX) / s + cam.centerX) / k) + ring,
      j0: Math.floor(((0 - cam.screenCY) / s + cam.centerY) / k) - ring,
      j1: Math.floor(((cam.h - cam.screenCY) / s + cam.centerY) / k) + ring,
    };
  }

  _op(t, sx, sy, sw, sh, dx, dy, dw, dh) {
    let o = this.ops[this.nOps];
    if (!o) this.ops.push((o = {}));
    this.nOps++;
    o.t = t;
    o.sx = sx;
    o.sy = sy;
    o.sw = sw;
    o.sh = sh;
    o.dx = dx;
    o.dy = dy;
    o.dw = dw;
    o.dh = dh;
    t.used = this.frame;
  }

  /**
   * Fill the world rect [x0,x1]×[y0,y1] (a target slot with no tile yet) from level Lc, if every
   * tile of Lc it needs is cached (or `partial`: whatever Lc has). True when drawn.
   */
  _fillFrom(Lc, x0, y0, x1, y1, ox, oy, s, partial) {
    const Sc = levelScale(Lc);
    const kc = TILE / Sc;
    const i0 = Math.floor(x0 / kc);
    const i1 = Math.floor((x1 - 1e-9) / kc);
    const j0 = Math.floor(y0 / kc);
    const j1 = Math.floor((y1 - 1e-9) / kc);
    if (!partial) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!this.cache.has(tileKey(Lc, i, j))) return false;
    }
    let drew = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = this.cache.get(tileKey(Lc, i, j));
        if (!t) continue;
        const ax = Math.max(x0, i * kc);
        const bx = Math.min(x1, (i + 1) * kc);
        const ay = Math.max(y0, j * kc);
        const by = Math.min(y1, (j + 1) * kc);
        const dx0 = Math.round(ox + ax * s);
        const dx1 = Math.round(ox + bx * s);
        const dy0 = Math.round(oy + ay * s);
        const dy1 = Math.round(oy + by * s);
        if (dx1 <= dx0 || dy1 <= dy0) continue;
        this._op(t, (ax - i * kc) * Sc, (ay - j * kc) * Sc, (bx - ax) * Sc, (by - ay) * Sc, dx0, dy0, dx1 - dx0, dy1 - dy0);
        drew = true;
      }
    }
    return drew || !partial;
  }

  /**
   * Bring the tiles for this frame up to date and plan what to draw. `moving`: the camera is
   * zooming or panning. `frameMs`: time between display frames (budgets for drawing on the page).
   */
  update(cam, road, moving, frameMs = 1000 / 60) {
    this.frame++;
    if (road !== this.road) this._setRoad(road);
    else if (road.version !== this.version) {
      // Photo textures arrived on the page: page-drawn tiles are redrawn, shown meanwhile.
      this.version = road.version;
      for (const t of this.cache.values()) if (t.page) t.stale = true;
    }
    this._base(cam);
    const s = cam.scale * cam.dpr;
    const L = levelFor(s);
    const k = TILE / levelScale(L);
    const ox = Math.round(cam.screenCX * cam.dpr - cam.centerX * s);
    const oy = Math.round(cam.screenCY * cam.dpr - cam.centerY * s);
    const R = this._range(cam, L);
    const cx = (R.i0 + R.i1) / 2;
    const cy = (R.j0 + R.j1) / 2;
    const useWorkers = this.workers.some((o) => o.ready);
    // The very first picture of a map is drawn here, whole (the workers are still starting up).
    if (!this.cache.size) for (let j = R.j0; j <= R.j1; j++) for (let i = R.i0; i <= R.i1; i++) this._renderHere(L, i, j);

    this.nOps = 0;
    const need = [];
    let empty = 0;
    for (let j = R.j0; j <= R.j1; j++) {
      for (let i = R.i0; i <= R.i1; i++) {
        const t = this.cache.get(tileKey(L, i, j));
        const x0 = Math.round(ox + i * k * s);
        const x1 = Math.round(ox + (i + 1) * k * s);
        const y0 = Math.round(oy + j * k * s);
        const y1 = Math.round(oy + (j + 1) * k * s);
        if (t) {
          this._op(t, 0, 0, TILE, TILE, x0, y0, x1 - x0, y1 - y0);
          if (t.stale) need.push(i, j);
          continue;
        }
        need.push(i, j);
        // Not here yet: the same spot from the nearest level that has it whole.
        const wx0 = i * k;
        const wy0 = j * k;
        let done = this._fillFrom(L + 1, wx0, wy0, wx0 + k, wy0 + k, ox, oy, s, false);
        for (let Lc = L - 1; !done && Lc > this.baseL; Lc--) done = this._fillFrom(Lc, wx0, wy0, wx0 + k, wy0 + k, ox, oy, s, false);
        if (!done && !this._fillFrom(this.baseL, wx0, wy0, wx0 + k, wy0 + k, ox, oy, s, true)) empty++;
      }
    }
    this.blurry = need.length / 2;
    this.empty = empty; // slots showing nothing at all (the ground colour) this frame

    // What to ask for, most urgent first.
    const want = [];
    let wanted = 0;
    const add = (Lw, i, j) => {
      const key = tileKey(Lw, i, j);
      const t = this.cache.get(key);
      wanted++;
      if (t && !t.stale) t.used = this.frame; // still wanted: not the one to forget
      else if (!this.pending.has(key)) want.push(key, Lw, i, j);
    };
    for (let n = 0; n < this.baseKeys.length; n += 3) add(this.baseKeys[n], this.baseKeys[n + 1], this.baseKeys[n + 2]);
    // Zooming: the level (and view) the zoom will end at comes first, so it is sharp on arrival.
    if (cam.targetZoom !== undefined && cam.targetZoom !== null) {
      const sF = cam.base * cam.targetZoom;
      const LF = levelFor(sF * cam.dpr);
      if (LF !== L) {
        const a = cam.anchor;
        const fx = a ? a.wx - (a.px - cam.screenCX) / sF : cam.centerX;
        const fy = a ? a.wy - (a.py - cam.screenCY) / sF : cam.centerY;
        const kF = TILE / levelScale(LF);
        const i0 = Math.floor((fx - cam.screenCX / sF) / kF);
        const i1 = Math.floor((fx + (cam.w - cam.screenCX) / sF) / kF);
        const j0 = Math.floor((fy - cam.screenCY / sF) / kF);
        const j1 = Math.floor((fy + (cam.h - cam.screenCY) / sF) / kF);
        const mi = (i0 + i1) / 2;
        const mj = (j0 + j1) / 2;
        const slots = [];
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) slots.push([Math.hypot(i - mi, j - mj), i, j]);
        slots.sort((p, q) => p[0] - q[0]);
        for (const [, i, j] of slots) add(LF, i, j);
      }
    }
    const order = [];
    for (let n = 0; n < need.length; n += 2) order.push(n);
    order.sort((a, b) => Math.hypot(need[a] - cx, need[a + 1] - cy) - Math.hypot(need[b] - cx, need[b + 1] - cy));
    for (const n of order) add(L, need[n], need[n + 1]);
    // The ring just off screen, two deep on the side the camera is heading.
    const G = this._range(cam, L, 1);
    const dx = this._cx === null ? 0 : cam.centerX - this._cx;
    const dy = this._cy === null ? 0 : cam.centerY - this._cy;
    if (dx > 0) G.i1++;
    else if (dx < 0) G.i0--;
    if (dy > 0) G.j1++;
    else if (dy < 0) G.j0--;
    this._cx = cam.centerX;
    this._cy = cam.centerY;
    for (let j = G.j0; j <= G.j1; j++) for (let i = G.i0; i <= G.i1; i++) if (i < R.i0 || i > R.i1 || j < R.j0 || j > R.j1) add(L, i, j);
    // Resting: the levels one step in and out, ready for the next zoom.
    if (!moving && !want.length) {
      for (const Ln of [L - 1, L + 1]) {
        const N = this._range(cam, Ln);
        for (let j = N.j0; j <= N.j1; j++) for (let i = N.i0; i <= N.i1; i++) add(Ln, i, j);
      }
    }

    if (useWorkers) {
      let n = 0;
      for (const slot of this.workers) {
        while (slot.ready && slot.busy < IN_FLIGHT && n < want.length) {
          const key = want[n];
          const Lw = want[n + 1];
          slot.w.postMessage({ type: 'render', gen: this.gen, key, scale: levelScale(Lw), i: want[n + 2], j: want[n + 3] });
          this.pending.set(key, slot);
          slot.busy++;
          n += 4;
        }
      }
    } else if (!this.workers.length) {
      // No workers: draw on the page within a slice of the frame (one at least while a slot on
      // screen has nothing better than the base level).
      const start = performance.now();
      const budget = Math.max(1.5, frameMs * (moving ? RING_FRAC : GAP_FRAC));
      for (let n = 0; n < want.length; n += 4) {
        if (n > 0 && performance.now() - start + this.est > budget) break;
        this._renderHere(want[n + 1], want[n + 2], want[n + 3]);
      }
    }
    // (never below what this frame wants, or the cache would drop tiles only to ask for them again)
    this._evict(Math.max(MAX_TILES, Math.ceil(wanted * 1.5)));
  }

  /** Forget the tiles used longest ago once the cache is over `cap` (never the base level). */
  _evict(cap) {
    if (this.cache.size <= cap) return;
    const old = [];
    for (const [key, t] of this.cache) if (t.used < this.frame && t.L !== this.baseL) old.push([t.used, key]);
    old.sort((a, b) => a[0] - b[0]);
    for (let n = 0; n < old.length && this.cache.size > cap; n++) {
      const t = this.cache.get(old[n][1]);
      this.cache.delete(old[n][1]);
      this._free(t);
    }
  }

  /** Draw a layer ('s' static, 'e' expressway deck) as planned in update. ctx: any transform. */
  draw(ctx, cam, layer) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let n = 0; n < this.nOps; n++) {
      const o = this.ops[n];
      const img = o.t[layer];
      if (img) ctx.drawImage(img, o.sx, o.sy, o.sw, o.sh, o.dx, o.dy, o.dw, o.dh);
    }
    ctx.restore();
  }
}
