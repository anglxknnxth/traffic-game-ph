// World renderer. Draw order: cached static road layer -> river ripples and boats -> dynamic road
// overlays -> pedestrians -> under-effects ->
// vehicles -> over-effects -> elevated structures -> traffic lights -> weather and night (signal heads
// are drawn again over the darkness). The camera is strictly overhead (scale + translate).

import { RoadRenderer } from './RoadRenderer.js';
import { drawVehicle } from './VehicleRenderer.js';
import { TrafficLightRenderer } from './TrafficLightRenderer.js';
import { EffectsRenderer } from './EffectsRenderer.js';
import { WeatherRenderer } from './WeatherRenderer.js';
import { drawPedestrians, drawPedSignals } from './PedestrianRenderer.js';

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.lights = new TrafficLightRenderer();
    this.effects = new EffectsRenderer();
    this.weather = new WeatherRenderer();
    this.road = null;
    this.network = null;
    this.staticCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.staticKey = '';
    this._visible = [];
    this._saved = [];
    this._dp = { x: 0, y: 0, angle: 0 };
  }

  setNetwork(network) {
    if (this.network === network) return;
    this.network = network;
    this.road = new RoadRenderer(network);
    this.staticKey = '';
    this.staticView = null;
  }

  /**
   * Re-render the static layer for the current camera, unless an eased zoom is running and the
   * cached layer can simply be scaled and shifted (it is re-rendered once the zoom settles).
   * Returns the transform (device pixels) to draw the cached layer with.
   */
  _ensureStatic() {
    const c = this.canvas;
    const cam = this.camera;
    const key = `${c.width}x${c.height}|${cam.scale.toFixed(5)}|${cam.centerX.toFixed(3)}|${cam.centerY.toFixed(3)}|${cam.screenCX.toFixed(1)}|${cam.screenCY.toFixed(1)}|${this.road.version || 0}`;
    const sv = this.staticView;
    if (key === this.staticKey) return null;
    if (cam.animating && sv && sv.w === c.width && sv.h === c.height) {
      const r = cam.scale / sv.scale;
      if (r < 1.4 && r > 1 / 1.4) {
        const dpr = cam.dpr;
        return {
          r,
          tx: dpr * (-sv.scx * r + (sv.cx - cam.centerX) * cam.scale + cam.screenCX),
          ty: dpr * (-sv.scy * r + (sv.cy - cam.centerY) * cam.scale + cam.screenCY),
        };
      }
    }
    this.staticKey = key;
    this.staticView = { w: c.width, h: c.height, scale: cam.scale, cx: cam.centerX, cy: cam.centerY, scx: cam.screenCX, scy: cam.screenCY };
    const sc = this.staticCanvas;
    if (sc.width !== c.width || sc.height !== c.height) {
      sc.width = c.width;
      sc.height = c.height;
    }
    const sctx = sc.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sc.width, sc.height);
    cam.apply(sctx);
    this.road.drawStatic(sctx);
    return null;
  }

  /**
   * Draw the world between the last two simulation steps (alpha 0..1). Every renderer reads
   * x/y/angle, so the display poses are swapped in for the duration of the draw and the simulated
   * poses restored afterwards (nothing in the simulation runs in between).
   */
  render(sim, opts = {}) {
    const alpha = opts.alpha ?? 1;
    const saved = this._saved;
    saved.length = 0;
    const lerpPose = (o) => {
      if (o.px === undefined) return;
      saved.push(o, o.x, o.y, o.angle);
      let da = o.angle - o.pa;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      o.x = o.px + (o.x - o.px) * alpha;
      o.y = o.py + (o.y - o.py) * alpha;
      o.angle = o.pa + da * alpha;
    };
    // Vehicles: the route coordinate is interpolated, so the drawn body follows curves exactly.
    const dp = this._dp;
    for (const v of sim.vehicles) {
      const s = v.ps === undefined ? v.s : v.ps + (v.s - v.ps) * alpha;
      v.displayPose(s, dp);
      saved.push(v, v.x, v.y, v.angle);
      v.x = dp.x;
      v.y = dp.y;
      v.angle = dp.angle;
    }
    if (alpha < 1 && sim.peds) for (const p of sim.peds.peds) lerpPose(p);
    try {
      this._render(sim, opts);
    } finally {
      for (let i = 0; i < saved.length; i += 4) {
        const o = saved[i];
        o.x = saved[i + 1];
        o.y = saved[i + 2];
        o.angle = saved[i + 3];
      }
      saved.length = 0;
    }
  }

  _render(sim, { time = 0, debug = false, hoveredHead = null, dt = 1 / 60 } = {}) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.setNetwork(sim.network);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#4b5a3a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const xf = this._ensureStatic();
    if (xf) {
      ctx.setTransform(xf.r, 0, 0, xf.r, xf.tx, xf.ty);
      ctx.drawImage(this.staticCanvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else ctx.drawImage(this.staticCanvas, 0, 0);
    this.weather.drawWet(ctx, this.canvas, sim.env);

    cam.apply(ctx);
    this.road.drawWater(ctx, time);
    this.road.drawDynamic(ctx, sim, time);
    if (debug) this.effects.drawReservations(ctx, sim);

    const vr = cam.visibleRect(8);
    if (sim.peds?.enabled) {
      drawPedSignals(ctx, sim, time);
      drawPedestrians(ctx, sim.peds.peds, sim.env?.rain || 0, vr);
    }
    const visible = this._visible;
    visible.length = 0;
    for (const v of sim.vehicles) {
      if (v.x > vr.minX && v.x < vr.maxX && v.y > vr.minY && v.y < vr.maxY) visible.push(v);
    }
    this.effects.drawUnder(ctx, visible, time);
    for (const v of visible) drawVehicle(ctx, v, time);
    this.effects.drawOver(ctx, visible, time);
    this.road.drawOverlays(ctx, time);
    this.lights.draw(ctx, sim, time, hoveredHead);
    this.weather.drawAtmosphere(ctx, this.canvas, cam, sim, this.road.scenery.posts, visible, time);
    // Signal heads stay readable at night: draw them over the darkness.
    if (sim.env?.darkness > 0.02) {
      cam.apply(ctx);
      this.lights.draw(ctx, sim, time, hoveredHead);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
