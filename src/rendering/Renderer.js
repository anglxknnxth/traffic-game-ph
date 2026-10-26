// World renderer. Draw order: cached static road layer -> river ripples and boats -> dynamic road
// overlays -> pedestrians -> under-effects -> ground vehicles -> over-effects -> tunnel shade ->
// cached expressway layer -> vehicles up on the expressway -> elevated structures -> traffic
// lights -> weather and night (signal heads are drawn again over the darkness). Vehicles under a
// junction (in an underpass) are not drawn. The camera is strictly overhead (scale + translate).

import { RoadRenderer } from './RoadRenderer.js';
import { drawVehicle } from './VehicleRenderer.js';
import { TrafficLightRenderer } from './TrafficLightRenderer.js';
import { EffectsRenderer } from './EffectsRenderer.js';
import { WeatherRenderer } from './WeatherRenderer.js';
import { drawPedestrians, drawPedSignals } from './PedestrianRenderer.js';

const MAX_CACHE = 4096; // px per side of a cached layer
const SETTLE_MS = 150; // re-render the cached layers this long after the camera stops

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
    this.elevCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this._ground = [];
    this._high = [];
    this._visible = [];
    this._saved = [];
    this._dp = { x: 0, y: 0, angle: 0 };
  }

  setNetwork(network) {
    if (this.network === network) return;
    this.network = network;
    this.road = new RoadRenderer(network);
    this.staticView = null;
  }

  /**
   * The static layer (and the expressway deck) is cached a margin bigger than the screen. Panning
   * just shifts the cached image; it is re-rendered when the view leaves the margin, once a zoom
   * has settled (the cached image is scaled meanwhile), on resize, or when the road changes.
   * Returns the transform (device pixels) to draw the cached layer with.
   */
  _ensureStatic() {
    const c = this.canvas;
    const cam = this.camera;
    const dpr = cam.dpr;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const camKey = `${cam.scale}|${cam.centerX}|${cam.centerY}|${cam.screenCX}|${cam.screenCY}`;
    if (camKey !== this._camKey) {
      this._camKey = camKey;
      this._movedAt = now;
    }
    const moving = cam.animating || now - (this._movedAt || 0) < SETTLE_MS;
    const sv = this.staticView;
    const version = this.road.version || 0;
    if (sv && sv.w === c.width && sv.h === c.height && sv.version === version && sv.dpr === dpr) {
      const r = cam.scale / sv.scale;
      const tx = -r * sv.mx - r * dpr * (sv.scx - sv.cx * sv.scale) + dpr * (cam.screenCX - cam.centerX * cam.scale);
      const ty = -r * sv.my - r * dpr * (sv.scy - sv.cy * sv.scale) + dpr * (cam.screenCY - cam.centerY * cam.scale);
      const same = Math.abs(r - 1) < 1e-6;
      const covers = tx <= 0.5 && ty <= 0.5 && tx + r * (c.width + 2 * sv.mx) >= c.width - 0.5 && ty + r * (c.height + 2 * sv.my) >= c.height - 0.5;
      // Same zoom: reuse while the screen is inside the cached area. Mid-zoom: scale it for now.
      if (same ? covers : moving && r > 0.2 && r < 5) return { r, tx, ty };
    }
    // Margin of half a screen each side, keeping the cache within 4096 px.
    const mx = Math.max(0, Math.min(Math.round(c.width / 2), Math.floor((MAX_CACHE - c.width) / 2)));
    const my = Math.max(0, Math.min(Math.round(c.height / 2), Math.floor((MAX_CACHE - c.height) / 2)));
    this.staticView = { w: c.width, h: c.height, dpr, version, scale: cam.scale, cx: cam.centerX, cy: cam.centerY, scx: cam.screenCX, scy: cam.screenCY, mx, my };
    this.staticRenders = (this.staticRenders || 0) + 1;
    const W = c.width + 2 * mx;
    const H = c.height + 2 * my;
    // World rect of the cached area, so scenery outside it is skipped.
    const k = 1 / (cam.scale * dpr);
    const x0 = cam.centerX - (cam.screenCX * dpr + mx) * k;
    const y0 = cam.centerY - (cam.screenCY * dpr + my) * k;
    this.road.view = { minX: x0, minY: y0, maxX: x0 + W * k, maxY: y0 + H * k };
    this.road.ppm = cam.scale * dpr; // device pixels per metre (thin paint fades when zoomed out)
    const paint = (canvas, draw) => {
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      const s = cam.scale * dpr;
      g.setTransform(s, 0, 0, s, (cam.screenCX - cam.centerX * cam.scale) * dpr + mx, (cam.screenCY - cam.centerY * cam.scale) * dpr + my);
      draw(g);
    };
    paint(this.staticCanvas, (g) => this.road.drawStatic(g));
    if (this.road.hasElevated) paint(this.elevCanvas, (g) => this.road.drawElevated(g));
    this.road.view = null;
    return { r: 1, tx: -mx, ty: -my };
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
      if (v.pull > 0.02) {
        // pulled over to the curb for a siren (drawing only)
        dp.x += -Math.sin(dp.angle) * v.pull;
        dp.y += Math.cos(dp.angle) * v.pull;
      }
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

  /** Growing city: everything outside the open districts is "under construction" haze. */
  _drawFog(ctx, f, time) {
    const big = 4000;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.minX - big, f.minY - big, f.maxX - f.minX + 2 * big, f.maxY - f.minY + 2 * big);
    ctx.rect(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY);
    ctx.fillStyle = 'rgba(30,27,22,0.62)';
    ctx.fill('evenodd');
    // Construction tape along the edge
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -(time * 2) % 8;
    ctx.strokeStyle = '#facc15';
    ctx.strokeRect(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY);
    ctx.strokeStyle = '#111827';
    ctx.lineDashOffset = 4 - ((time * 2) % 8);
    ctx.strokeRect(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY);
    ctx.setLineDash([]);
    ctx.restore();
  }

  _render(sim, { time = 0, debug = false, hoveredHead = null, dt = 1 / 60, emergencyInfo = null, interactive = false, overlay = null, tool = null } = {}) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.setNetwork(sim.network);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#4b5a3a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const xf = this._ensureStatic();
    const blit = (canvas) => {
      ctx.setTransform(xf.r, 0, 0, xf.r, xf.tx, xf.ty);
      ctx.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    blit(this.staticCanvas);
    this.weather.drawWet(ctx, this.canvas, sim.env);

    cam.apply(ctx);
    this.road.drawWater(ctx, time);
    this.road.drawDynamic(ctx, sim, time);
    if (debug) this.effects.drawReservations(ctx, sim);
    if (overlay === 'heat') this.effects.drawHeat(ctx, sim, dt);

    const vr = cam.visibleRect(8);
    if (sim.peds?.enabled) {
      drawPedSignals(ctx, sim, time);
      drawPedestrians(ctx, sim.peds.peds, sim.env?.rain || 0, vr);
    }
    const visible = this._visible;
    const ground = this._ground;
    const high = this._high;
    visible.length = 0;
    ground.length = 0;
    high.length = 0;
    for (const v of sim.vehicles) {
      if (!(v.x > vr.minX && v.x < vr.maxX && v.y > vr.minY && v.y < vr.maxY)) continue;
      const L = v.layer || 0;
      if (L <= -1) continue; // under the junction, out of sight
      visible.push(v);
      (L >= 0.5 ? high : ground).push(v);
    }
    this.effects.drawUnder(ctx, ground, time);
    for (const v of ground) drawVehicle(ctx, v, time);
    this.effects.drawOver(ctx, ground, time);
    this.effects.drawSmoke(ctx, visible, time);
    if (sim.enforcement?.posts.size) this.effects.drawEnforcers(ctx, sim, time, tool === 'enforcer');
    if (interactive) this.effects.drawStuck(ctx, sim, ground, time);
    if (sim.network.layered) this.road.drawTrenchShade(ctx);
    if (this.road.hasElevated) {
      // The expressway deck over everything on the ground, then its own traffic.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      blit(this.elevCanvas);
      cam.apply(ctx);
      this.effects.drawUnder(ctx, high, time);
      for (const v of high) drawVehicle(ctx, v, time);
      this.effects.drawOver(ctx, high, time);
      if (interactive) this.effects.drawStuck(ctx, sim, high, time);
    }
    if (overlay === 'heat') this.effects.drawQueueCounts(ctx, sim);
    this.road.drawOverlays(ctx, time);
    this.lights.draw(ctx, sim, time, hoveredHead);
    if (sim.growth) this._drawFog(ctx, sim.growth.focusRect(), time);
    this.weather.drawAtmosphere(ctx, this.canvas, cam, sim, this.road.scenery.posts, visible, time, this.road.scenery.buildings);
    // Signal heads stay readable at night: draw them over the darkness.
    if (sim.env?.darkness > 0.02) {
      cam.apply(ctx);
      this.lights.draw(ctx, sim, time, hoveredHead);
    }
    // Screen-space pass (CSS pixels): emergency pointers.
    if (emergencyInfo) {
      ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
      this.effects.drawEmergencyPointers(ctx, sim, cam, time, emergencyInfo);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
