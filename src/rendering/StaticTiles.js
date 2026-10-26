// Cache of the static road layer (and the expressway deck) in square tiles of device pixels at the
// camera's zoom. Panning only draws the tiles that come into view (plus a ring around the screen,
// two tiles deep in the direction the camera is moving, drawn ahead within a time budget); after a
// zoom the old tiles are scaled until the new ones have been drawn, a few per frame, so neither a
// pan nor a zoom stalls a frame redrawing the whole map. Tiles are drawn with the same world
// transform as the screen, so they meet seamlessly.
//
// Budgets follow the display: a 144 Hz screen has 6.9 ms per frame, not 16.7. A tile is only
// started when the time it usually takes still fits in this frame's budget. Under everything sits
// a coarse overview of the whole playable area (built once, a few tiles per frame): wherever the
// tiles at the current zoom are not ready yet (the edges while zooming out, a fast pan), the
// overview shows a soft picture for a few frames instead of the frame waiting for new tiles.

const TILE = 256; // device px per side
const RING_FRAC = 0.25; // of a frame: tile drawing for spots the old zoom still shows, and the ring ahead
const GAP_FRAC = 0.45; // of a frame: tile drawing for gaps on screen
const KEEP = 2.5; // tiles kept per set, as a multiple of the tiles around the screen
const OVERVIEW_RES = 0.5; // overview scale, relative to the camera's furthest zoom-out
const MAX_OVERVIEW_TILES = 160;

const keyOf = (i, j) => (i + 32768) * 65536 + (j + 32768);

export class StaticTiles {
  constructor() {
    this.sets = []; // [0]: tiles at the current scale, [1]: the previous scale (shown while [0] fills in)
    this.overview = null; // coarse tiles over the whole camera area (shown under gaps)
    this.pool = [];
    this.road = null;
    this.version = -1;
    this.frame = 0;
    this.renders = 0; // tiles drawn so far (for the perf overlay)
    this.worstTile = 0; // slowest tile drawn since the perf overlay last read it (ms)
    this.showPrev = false;
    this.showOverview = false;
    this._R = { i0: 0, i1: 0, j0: 0, j1: 0 };
    this._G = { i0: 0, i1: 0, j0: 0, j1: 0 };
    this._B = { i0: 0, i1: 0, j0: 0, j1: 0 };
    this._cx = null;
    this._cy = null;
  }

  _canvas() {
    const c = this.pool.pop() || document.createElement('canvas');
    if (c.width !== TILE || c.height !== TILE) {
      c.width = TILE;
      c.height = TILE;
    }
    return c;
  }

  _drop(set) {
    for (const t of set.tiles.values()) {
      this.pool.push(t.s);
      if (t.e) this.pool.push(t.e);
    }
    set.tiles.clear();
  }

  _render(set, i, j) {
    const t0 = performance.now();
    const road = this.road;
    const S = set.scale;
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
    const t = { s: paint((g) => road.drawStatic(g)), e: e ? paint((g) => road.drawElevated(g)) : null, used: this.frame };
    road.view = null;
    set.tiles.set(keyOf(i, j), t);
    this.renders++;
    const ms = performance.now() - t0;
    set.est = (set.est ?? ms) + (ms - (set.est ?? ms)) * 0.2; // usual ms per tile of this set
    if (ms > this.worstTile) this.worstTile = ms;
    return t;
  }

  /** Does `set` hold every tile over the world rectangle? */
  _covers(set, x0, y0, x1, y1) {
    if (!set) return false;
    const k = TILE / set.scale;
    for (let j = Math.floor(y0 / k); j <= Math.floor((y1 - 1e-9) / k); j++) {
      for (let i = Math.floor(x0 / k); i <= Math.floor((x1 - 1e-9) / k); i++) if (!set.tiles.has(keyOf(i, j))) return false;
    }
    return true;
  }

  /** Tile index range of `set` over the screen (grown by `ring` tiles), written into `out`. */
  _range(set, cam, ring = 0, out = this._R) {
    const k = TILE / set.scale;
    const s = cam.scale;
    // (cam.screenToWorld without the allocation)
    const ax = (0 - cam.screenCX) / s + cam.centerX;
    const ay = (0 - cam.screenCY) / s + cam.centerY;
    const bx = (cam.w - cam.screenCX) / s + cam.centerX;
    const by = (cam.h - cam.screenCY) / s + cam.centerY;
    out.i0 = Math.floor(ax / k) - ring;
    out.i1 = Math.floor(bx / k) + ring;
    out.j0 = Math.floor(ay / k) - ring;
    out.j1 = Math.floor(by / k) + ring;
    return out;
  }

  /** Coarse scale for the overview: half the resolution of the furthest zoom-out, within a tile cap. */
  _overviewScale(cam) {
    const b = cam.bounds;
    let s = cam.base * (cam.zoomFloor ?? cam.minZoom) * cam.dpr * OVERVIEW_RES;
    const tiles = () => Math.ceil(((b.maxX - b.minX) * s) / TILE + 1) * Math.ceil(((b.maxY - b.minY) * s) / TILE + 1);
    while (tiles() > MAX_OVERVIEW_TILES && s > 1e-3) s *= 0.8;
    return s;
  }

  /**
   * Bring the tiles for this frame up to date. `moving`: the camera is zooming or panning, so the
   * tile scale may lag behind the zoom until it settles. `frameMs`: time between display frames.
   */
  update(cam, road, moving, frameMs = 1000 / 60) {
    this.frame++;
    if (road !== this.road || road.version !== this.version) {
      for (const set of this.sets) this._drop(set);
      if (this.overview) this._drop(this.overview);
      this.sets = [];
      this.overview = null;
      this.road = road;
      this.version = road.version;
      this.elevated = road.hasElevated;
    }
    const ringMs = Math.max(1.5, frameMs * RING_FRAC);
    const gapMs = Math.max(2.5, frameMs * GAP_FRAC);
    const s = cam.scale * cam.dpr;
    let cur = this.sets[0];
    // The tile scale follows the zoom once it settles (meanwhile the tiles are scaled), or at once
    // when the zoom has gone so far that scaled tiles would look soft or be too many.
    const r = cur ? s / cur.scale : 0;
    if (!cur || (cur.scale !== s && (!moving || r < 0.25 || r > 4))) {
      if (this.sets[1]) this._drop(this.sets[1]);
      cur = { scale: s, tiles: new Map(), est: this.sets[0]?.est ?? 2 };
      this.sets = this.sets[0] ? [cur, this.sets[0]] : [cur];
    }
    // The overview follows the camera's limits (a resize, a district opening up).
    const os = this._overviewScale(cam);
    if (!this.overview || os / this.overview.scale < 0.5 || os / this.overview.scale > 2) {
      if (this.overview) this._drop(this.overview);
      this.overview = { scale: os, tiles: new Map(), complete: false };
    }
    const ov = this.overview;
    const prev = this.sets[1] || null;
    const k = TILE / cur.scale;
    const R = this._range(cur, cam);
    const start = performance.now();
    const fits = (ms, set = cur) => performance.now() - start + (set.est ?? 2) <= ms;
    // Missing tiles on screen. Gaps (where neither the previous scale nor the overview shows
    // anything) come first, with most of a frame for them; spots something else still covers
    // fill in within the smaller budget. Only the very first picture is drawn whole at once.
    const first = !cur.tiles.size && !prev;
    const zooming = moving && cur.scale !== s;
    const gaps = [];
    const covered = [];
    for (let j = R.j0; j <= R.j1; j++) {
      for (let i = R.i0; i <= R.i1; i++) {
        const t = cur.tiles.get(keyOf(i, j));
        if (t) {
          t.used = this.frame;
          continue;
        }
        if (first) this._render(cur, i, j);
        else {
          const x0 = i * k;
          const y0 = j * k;
          (this._covers(prev, x0, y0, x0 + k, y0 + k) || this._covers(ov, x0, y0, x0 + k, y0 + k) ? covered : gaps).push(i, j);
        }
      }
    }
    let left = 0;
    const fill = (list, ms, force) => {
      for (let n = 0; n < list.length; n += 2) {
        // A real gap always gets one tile per frame, so it can never stay empty.
        if ((force && n === 0) || fits(ms)) this._render(cur, list[n], list[n + 1]);
        else left++;
      }
    };
    fill(gaps, zooming ? ringMs : gapMs, true);
    fill(covered, ringMs, false);
    this.showPrev = left > 0 && !!prev;
    this.showOverview = left > 0;
    if (!left) {
      // Everything on screen is there: the old scale can go, and the ring around the screen is
      // drawn ahead (two deep on the side the camera is heading) so a pan finds its tiles ready.
      if (prev && !moving) {
        this._drop(prev);
        this.sets.length = 1;
      }
      const G = this._range(cur, cam, 1, this._G);
      const dx = this._cx === null ? 0 : cam.centerX - this._cx;
      const dy = this._cy === null ? 0 : cam.centerY - this._cy;
      if (dx > 0) G.i1++;
      else if (dx < 0) G.i0--;
      if (dy > 0) G.j1++;
      else if (dy < 0) G.j0--;
      outer: for (let j = G.j0; j <= G.j1; j++) {
        for (let i = G.i0; i <= G.i1; i++) {
          const t = cur.tiles.get(keyOf(i, j));
          if (t) {
            t.used = this.frame;
            continue;
          }
          if (!fits(ringMs)) break outer;
          this._render(cur, i, j);
        }
      }
      // Spare time on a still frame: build the overview (at least one tile on an idle frame, as its
      // tiles cover much more of the map each and may take longer than the budget).
      if (!ov.complete && !moving) {
        let one = performance.now() - start < 0.5;
        this._fillOverview(cam, ov, () => {
          if (fits(ringMs, ov)) return true;
          const ok = one;
          one = false;
          return ok;
        });
      }
    }
    this._cx = cam.centerX;
    this._cy = cam.centerY;
    // Forget the tiles used longest ago once the set grows well past what the screen needs.
    const ring = (R.i1 - R.i0 + 3) * (R.j1 - R.j0 + 3);
    if (cur.tiles.size > ring * KEEP) {
      const old = [...cur.tiles].sort((a, b) => a[1].used - b[1].used);
      for (let n = 0; n < old.length && cur.tiles.size > ring * KEEP; n++) {
        const [key, t] = old[n];
        if (t.used === this.frame) break;
        cur.tiles.delete(key);
        this.pool.push(t.s);
        if (t.e) this.pool.push(t.e);
      }
    }
  }

  /** Draw overview tiles over the camera's limits while `more()` allows. */
  _fillOverview(cam, ov, more) {
    const b = cam.bounds;
    const k = TILE / ov.scale;
    for (let j = Math.floor(b.minY / k); j <= Math.floor(b.maxY / k); j++) {
      for (let i = Math.floor(b.minX / k); i <= Math.floor(b.maxX / k); i++) {
        if (ov.tiles.has(keyOf(i, j))) continue;
        if (!more()) return;
        this._render(ov, i, j);
      }
    }
    ov.complete = true;
  }

  /** Draw a layer ('s' static, 'e' expressway deck) of the cached tiles. ctx: any transform. */
  draw(ctx, cam, layer) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.showOverview && this.overview) this._blit(ctx, cam, this.overview, layer);
    if (this.showPrev) this._blit(ctx, cam, this.sets[1], layer);
    if (this.sets[0]) this._blit(ctx, cam, this.sets[0], layer);
    ctx.restore();
  }

  _blit(ctx, cam, set, layer) {
    const s = cam.scale * cam.dpr;
    const ox = cam.screenCX * cam.dpr - cam.centerX * s;
    const oy = cam.screenCY * cam.dpr - cam.centerY * s;
    const k = TILE / set.scale;
    const R = this._range(set, cam, 0, this._B);
    for (let j = R.j0; j <= R.j1; j++) {
      // Whole device pixels at both edges, so neighbouring tiles share no partly covered pixel.
      const y0 = Math.round(oy + j * k * s);
      const y1 = Math.round(oy + (j + 1) * k * s);
      for (let i = R.i0; i <= R.i1; i++) {
        const t = set.tiles.get(keyOf(i, j));
        const c = t && t[layer];
        if (!c) continue;
        const x0 = Math.round(ox + i * k * s);
        const x1 = Math.round(ox + (i + 1) * k * s);
        ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
}
