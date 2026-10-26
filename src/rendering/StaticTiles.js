// Cache of the static road layer (and the expressway deck) in square tiles of device pixels at the
// camera's zoom. Panning only draws the tiles that come into view (plus a ring of one tile around
// the screen, drawn ahead within a time budget); after a zoom the old tiles are scaled until the new
// ones have been drawn, a few per frame, so neither a pan nor a zoom stalls a frame redrawing the
// whole map. Tiles are drawn with the same world transform as the screen, so they meet seamlessly.

const TILE = 512; // device px per side
const BUDGET_MS = 5; // tile drawing per frame for tiles the old zoom still shows, and the ring ahead
const GAP_MS = 12; // tile drawing per frame for gaps on screen
const KEEP = 2.5; // tiles kept per set, as a multiple of the tiles around the screen

const keyOf = (i, j) => (i + 32768) * 65536 + (j + 32768);

export class StaticTiles {
  constructor() {
    this.sets = []; // [0]: tiles at the current scale, [1]: the previous scale (shown while [0] fills in)
    this.pool = [];
    this.road = null;
    this.version = -1;
    this.frame = 0;
    this.renders = 0; // tiles drawn so far (for the perf overlay)
    this.showPrev = false;
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
    return t;
  }

  /** Does `set` hold every tile over the world rectangle? */
  _covers(set, x0, y0, x1, y1) {
    const k = TILE / set.scale;
    for (let j = Math.floor(y0 / k); j <= Math.floor((y1 - 1e-9) / k); j++) {
      for (let i = Math.floor(x0 / k); i <= Math.floor((x1 - 1e-9) / k); i++) if (!set.tiles.has(keyOf(i, j))) return false;
    }
    return true;
  }

  /** Tile index range of `set` over the screen (grown by `ring` tiles). */
  _range(set, cam, ring = 0) {
    const a = cam.screenToWorld(0, 0);
    const b = cam.screenToWorld(cam.w, cam.h);
    const k = TILE / set.scale;
    return { i0: Math.floor(a.x / k) - ring, i1: Math.floor(b.x / k) + ring, j0: Math.floor(a.y / k) - ring, j1: Math.floor(b.y / k) + ring };
  }

  /**
   * Bring the tiles for this frame up to date. `moving`: the camera is zooming or panning, so the
   * tile scale may lag behind the zoom until it settles.
   */
  update(cam, road, moving) {
    this.frame++;
    if (road !== this.road || road.version !== this.version) {
      for (const set of this.sets) this._drop(set);
      this.sets = [];
      this.road = road;
      this.version = road.version;
      this.elevated = road.hasElevated;
    }
    const s = cam.scale * cam.dpr;
    let cur = this.sets[0];
    // The tile scale follows the zoom once it settles (meanwhile the tiles are scaled), or at once
    // when the zoom has gone so far that scaled tiles would look soft or be too many.
    const r = cur ? s / cur.scale : 0;
    if (!cur || (cur.scale !== s && (!moving || r < 0.25 || r > 4))) {
      if (this.sets[1]) this._drop(this.sets[1]);
      cur = { scale: s, tiles: new Map() };
      this.sets = this.sets[0] ? [cur, this.sets[0]] : [cur];
    }
    const prev = this.sets[1] || null;
    const k = TILE / cur.scale;
    const R = this._range(cur, cam);
    const start = performance.now();
    // Missing tiles on screen. Gaps (where the previous scale shows nothing either) come first,
    // with most of a frame for them; spots the previous scale still covers fill in within the
    // budget. Only the very first picture is drawn whole at once.
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
        else (prev && this._covers(prev, i * k, j * k, (i + 1) * k, (j + 1) * k) ? covered : gaps).push(i, j);
      }
    }
    let left = 0;
    const fill = (list, ms) => {
      for (let n = 0; n < list.length; n += 2) {
        if (performance.now() - start < ms) this._render(cur, list[n], list[n + 1]);
        else left++;
      }
    };
    fill(gaps, zooming ? BUDGET_MS : GAP_MS);
    fill(covered, BUDGET_MS);
    this.showPrev = left > 0 && !!prev;
    if (!left) {
      // Everything on screen is there: the old scale can go, and the ring around the screen is
      // drawn ahead so a pan finds its tiles ready.
      if (prev && !moving) {
        this._drop(prev);
        this.sets.length = 1;
      }
      const G = this._range(cur, cam, 1);
      outer: for (let j = G.j0; j <= G.j1; j++) {
        for (let i = G.i0; i <= G.i1; i++) {
          const t = cur.tiles.get(keyOf(i, j));
          if (t) {
            t.used = this.frame;
            continue;
          }
          if (performance.now() - start >= BUDGET_MS) break outer;
          this._render(cur, i, j);
        }
      }
    }
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

  /** Draw a layer ('s' static, 'e' expressway deck) of the cached tiles. ctx: any transform. */
  draw(ctx, cam, layer) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.showPrev) this._blit(ctx, cam, this.sets[1], layer);
    if (this.sets[0]) this._blit(ctx, cam, this.sets[0], layer);
    ctx.restore();
  }

  _blit(ctx, cam, set, layer) {
    const s = cam.scale * cam.dpr;
    const ox = cam.screenCX * cam.dpr - cam.centerX * s;
    const oy = cam.screenCY * cam.dpr - cam.centerY * s;
    const k = TILE / set.scale;
    const R = this._range(set, cam);
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
