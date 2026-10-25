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
  }

  setNetwork(network) {
    if (this.network === network) return;
    this.network = network;
    this.road = new RoadRenderer(network);
    this.staticKey = '';
  }

  _ensureStatic() {
    const c = this.canvas;
    const cam = this.camera;
    const key = `${c.width}x${c.height}|${cam.version}|${cam.scale.toFixed(5)}|${cam.centerX.toFixed(3)}|${cam.centerY.toFixed(3)}`;
    if (key === this.staticKey) return;
    this.staticKey = key;
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
  }

  render(sim, { time = 0, debug = false, hoveredHead = null } = {}) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.setNetwork(sim.network);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#4b5a3a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this._ensureStatic();
    ctx.drawImage(this.staticCanvas, 0, 0);
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
