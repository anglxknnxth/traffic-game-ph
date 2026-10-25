// Weather and time-of-day visuals, driven by the simulation's Environment (sim.env).
//   wet road  — a cool tint over the road layer while it rains (drawn under traffic)
//   night     — a darkness light map with holes for street lamps, headlights, brake lights and
//               signal heads, plus a soft additive glow (drawn over everything)
//   rain      — screen-space streaks and splash rings (drawn last)

import { Rng } from '../utils/math.js';

const DROPS = 420;

export class WeatherRenderer {
  constructor() {
    this.light = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const rng = new Rng(9001);
    this.drops = Array.from({ length: DROPS }, () => ({ x: rng.next(), y: rng.next(), len: rng.range(0.7, 1.3), speed: rng.range(0.85, 1.15) }));
    this.splashes = Array.from({ length: 90 }, () => ({ x: rng.next(), y: rng.next(), phase: rng.next() }));
  }

  /** Cool wet sheen over the static road layer. Call in screen space, before traffic. */
  drawWet(ctx, canvas, env) {
    if (!env || env.rain < 0.02) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(22,38,64,${0.2 * env.rain})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Night light map and rain. Call last, with the camera transform applied. */
  drawAtmosphere(ctx, canvas, camera, sim, lamps, vehicles, time) {
    const env = sim.env;
    if (!env) return;
    const dark = env.darkness;
    if (dark > 0.02 && this.light) this._night(ctx, canvas, camera, sim, lamps, vehicles, dark);
    if (env.rain > 0.02) this._rain(ctx, canvas, camera, env.rain, time);
  }

  _night(ctx, canvas, camera, sim, lamps, vehicles, dark) {
    const lc = this.light;
    if (lc.width !== canvas.width || lc.height !== canvas.height) {
      lc.width = canvas.width;
      lc.height = canvas.height;
    }
    const l = lc.getContext('2d');
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lc.width, lc.height);
    l.fillStyle = `rgba(5,9,26,${0.7 * dark})`;
    l.fillRect(0, 0, lc.width, lc.height);

    // Cut light pools out of the darkness.
    l.globalCompositeOperation = 'destination-out';
    camera.apply(l);
    const hole = (x, y, r, a) => {
      const g = l.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.beginPath();
      l.arc(x, y, r, 0, Math.PI * 2);
      l.fill();
    };
    for (const p of lamps) hole(p.x, p.y, 10, 0.8);
    for (const h of sim.lights.heads) hole(h.x, h.y, 3.2, 0.7);
    for (const v of vehicles) {
      const c = Math.cos(v.angle);
      const s = Math.sin(v.angle);
      // headlight beam: a pool ahead of the vehicle plus the lamps themselves
      hole(v.x + c * (v.hl + 4.5), v.y + s * (v.hl + 4.5), 5.5, 0.75);
      hole(v.x + c * v.hl, v.y + s * v.hl, 1.8, 0.9);
      if (v.a < -0.6 || v.v < 0.15) hole(v.x - c * v.hl, v.y - s * v.hl, 1.6, 0.6);
      if (v.emergency) hole(v.x, v.y, 7, 0.6);
    }
    l.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lc, 0, 0);
    ctx.restore();

    // Warm additive glow on top of the pools.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, rgb, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of lamps) glow(p.x, p.y, 8, '255,196,120', 0.16 * dark);
    for (const v of vehicles) {
      const c = Math.cos(v.angle);
      const s = Math.sin(v.angle);
      glow(v.x + c * (v.hl + 4), v.y + s * (v.hl + 4), 5, '255,244,210', 0.1 * dark);
      if (v.a < -0.6 || v.v < 0.15) glow(v.x - c * v.hl, v.y - s * v.hl, 1.6, '255,40,40', 0.3 * dark);
    }
    ctx.restore();
  }

  _rain(ctx, canvas, camera, rain, time) {
    const W = canvas.width;
    const H = canvas.height;
    const k = camera.dpr || 1;
    const n = Math.round(DROPS * Math.min(1, rain) * Math.min(1.4, (W * H) / (1600 * 900 * k * k) + 0.3));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = `rgba(205,220,240,${0.22 + 0.25 * rain})`;
    ctx.lineWidth = 1 * k;
    ctx.beginPath();
    const fall = 1100 * k;
    const len = (12 + 10 * rain) * k;
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      const y = (((d.y * H + time * fall * d.speed) % (H + len)) + H + len) % (H + len) - len;
      const x = (((d.x * W + y * 0.18) % W) + W) % W;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.18 * d.len, y + len * d.len);
    }
    ctx.stroke();
    // Splash rings where drops hit the ground
    ctx.strokeStyle = `rgba(210,225,245,${0.3 * rain})`;
    const m = Math.round(this.splashes.length * rain);
    for (let i = 0; i < m; i++) {
      const sp = this.splashes[i];
      const u = time * 1.6 + sp.phase;
      const t = u % 1;
      const cycle = Math.floor(u); // each ring lands somewhere new every cycle
      const x = ((sp.x + cycle * 0.618034) % 1) * W;
      const y = ((sp.y + cycle * 0.414214) % 1) * H;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.ellipse(x, y, (1 + 5 * t) * k, (0.5 + 2.5 * t) * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
