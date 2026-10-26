// Frame timing readout, only with ?perf in the URL: frames per second against the display's
// refresh rate, average and worst frame time, long frames (a visible hitch: over 1.5x the frame
// interval), simulation and drawing time per frame, and static road tiles drawn with the slowest
// one (twice a second).

export class PerfOverlay {
  static wanted() {
    return typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);
  }

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,0.75);color:#9fe6b0;font:600 11px ui-monospace,Consolas,monospace;white-space:nowrap';
    document.body.appendChild(this.el);
    this.sim = 0; // ms of simulation since the last frame (added by the game loop)
    this._reset(0);
  }

  _reset(tiles) {
    this.n = 0;
    this.time = 0;
    this.worst = 0;
    this.long = 0;
    this.simSum = 0;
    this.drawSum = 0;
    this.tiles = tiles;
  }

  /** One drawn frame: real seconds since the last, ms spent drawing, the tile cache and the loop. */
  frame(dt, drawMs, tiles, loop) {
    this.n++;
    this.time += dt;
    this.worst = Math.max(this.worst, dt);
    if (dt * 1000 > loop.frameMs * 1.5) this.long++;
    this.simSum += this.sim;
    this.drawSum += drawMs;
    this.sim = 0;
    if (this.time < 0.5) return;
    const n = this.n;
    const hz = 1000 / loop.refreshMs;
    this.el.textContent =
      `${(n / this.time).toFixed(0)} fps / ${hz.toFixed(0)} Hz${loop.fpsCap ? ` (cap ${loop.fpsCap})` : ''} · frame ${((1000 * this.time) / n).toFixed(1)} ms (worst ${(1000 * this.worst).toFixed(0)}) · ` +
      `long ${this.long} · sim ${(this.simSum / n).toFixed(1)} ms · draw ${(this.drawSum / n).toFixed(1)} ms · tiles +${tiles.renders - this.tiles} (worst ${tiles.worstTile.toFixed(1)} ms)`;
    tiles.worstTile = 0;
    this._reset(tiles.renders);
  }
}
