// Weather and time-of-day visuals, driven by the simulation's Environment (sim.env).
//   wet road  — a cool tint over the road layer while it rains (drawn under traffic)
//   night     — a darkness light map with holes for street lamps, headlights, brake lights and
//               signal heads, plus a soft additive glow (drawn over everything)
//   rain      — screen-space streaks and splash rings (drawn last), plus signal colours smeared
//               on the wet road and puddles that catch the light
// At night the headlights throw a beam ahead, tail lights glow and windows light up.

import { Rng } from '../utils/math.js';

const DROPS = 420;
const SPRITE = 128; // px across a cached radial falloff
const STREAK_STEP = 0.02; // rain streak length steps (relative), for the streak images
const RINGS = 48; // splash ring images through one splash

/**
 * A radial falloff, `rgb` at full alpha in the centre to transparent at the rim, as an image. Drawn
 * with globalAlpha = a over a circle of radius r it gives exactly what a fresh
 * createRadialGradient(x, y, 0, x, y, r) with stops rgba(rgb, a) -> rgba(rgb, 0) filling that
 * circle gives, without building a gradient per light per frame.
 */
function falloffSprite(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  const h = SPRITE / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(h, h, h, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class WeatherRenderer {
  constructor() {
    this.light = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const rng = new Rng(9001);
    this.drops = Array.from({ length: DROPS }, () => ({ x: rng.next(), y: rng.next(), len: rng.range(0.7, 1.3), speed: rng.range(0.85, 1.15) }));
    this.splashes = Array.from({ length: 90 }, () => ({ x: rng.next(), y: rng.next(), phase: rng.next() }));
    // Big screens draw up to 1.4x DROPS streaks (see _rain): the extra ones come after the splashes
    // so the first DROPS and the splashes stay where they were.
    while (this.drops.length < Math.ceil(DROPS * 1.4)) this.drops.push({ x: rng.next(), y: rng.next(), len: rng.range(0.7, 1.3), speed: rng.range(0.85, 1.15) });
    this._sprites = new Map(); // rgb -> falloff image
    this._grads = new WeakMap(); // context -> { key -> gradient at the origin }
    this._windows = null; // { buildings, path } lit windows of every building, built once
  }

  _sprite(rgb) {
    let s = this._sprites.get(rgb);
    if (!s) this._sprites.set(rgb, (s = falloffSprite(rgb)));
    return s;
  }

  /** A gradient built once per context and key, in coordinates around the origin. */
  _grad(ctx, key, make) {
    let m = this._grads.get(ctx);
    if (!m) this._grads.set(ctx, (m = new Map()));
    let g = m.get(key);
    if (!g) m.set(key, (g = make(ctx)));
    return g;
  }

  /** Lit windows of every building as one path (they are fixed per building), built once. */
  _windowPath(buildings) {
    if (this._windows?.buildings === buildings) return this._windows.path;
    const path = new Path2D();
    for (const b of buildings) {
      const seed = Math.abs(Math.sin(b.cx * 12.9898 + b.cy * 78.233)) * 43758.5453;
      if (seed % 1 < 0.25) continue; // nobody home
      const n = 1 + Math.floor((seed * 7) % 4);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      const pt = (u, w) => [b.cx + u * c - w * s, b.cy + u * s + w * c];
      for (let k = 0; k < n; k++) {
        const u = (((seed * (k + 3)) % 1) - 0.5) * (b.w - 2);
        const w = (((seed * (k + 5)) % 1) - 0.5) * (b.h - 2);
        path.moveTo(...pt(u - 0.6, w - 0.45));
        path.lineTo(...pt(u + 0.6, w - 0.45));
        path.lineTo(...pt(u + 0.6, w + 0.45));
        path.lineTo(...pt(u - 0.6, w + 0.45));
        path.closePath();
      }
    }
    this._windows = { buildings, path };
    return path;
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
  drawAtmosphere(ctx, canvas, camera, sim, lamps, vehicles, time, buildings = []) {
    const env = sim.env;
    if (!env) return;
    const dark = env.darkness;
    if (env.rain > 0.05) this._wetReflections(ctx, sim, env.rain, dark, time, camera.visibleRect(1));
    if (dark > 0.02 && this.light) this._night(ctx, canvas, camera, sim, lamps, vehicles, dark, buildings);
    if (env.rain > 0.02) this._rain(ctx, canvas, camera, env.rain, time);
  }

  /** Wet asphalt mirrors the signal lamps: long soft streaks of colour toward the viewer. */
  _wetReflections(ctx, sim, rain, dark, time, vr) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.1 + 0.25 * dark) * rain;
    const m0 = ctx.getTransform();
    for (const h of sim.lights.heads) {
      if (h.x < vr.minX || h.x > vr.maxX || h.y < vr.minY - 7 || h.y > vr.maxY) continue;
      const m = sim.lights.manager(h.intersectionId);
      const sig = m.signalForGroup(h.group);
      const rgb = sig === 'green' ? '48,209,88' : sig === 'yellow' || sig === 'flash' ? '255,214,10' : '255,59,48';
      ctx.fillStyle = this._grad(ctx, `wet:${rgb}`, (c) => {
        const g = c.createLinearGradient(0, 0, 0, 7);
        g.addColorStop(0, `rgba(${rgb},1)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        return g;
      });
      ctx.setTransform(m0);
      ctx.translate(h.x, h.y);
      ctx.fillRect(-0.5, 0, 1, 7);
    }
    ctx.restore();
  }

  _night(ctx, canvas, camera, sim, lamps, vehicles, dark, buildings) {
    const lc = this.light;
    // The light map is all soft falloff: on high-density screens it is drawn at CSS-pixel
    // resolution and stretched, a quarter of the pixels to fill three times a frame.
    const q = camera.dpr >= 2 ? 0.5 : 1;
    const lw = Math.ceil(canvas.width * q);
    const lh = Math.ceil(canvas.height * q);
    if (lc.width !== lw || lc.height !== lh) {
      lc.width = lw;
      lc.height = lh;
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
    if (q !== 1) {
      const m = l.getTransform();
      l.setTransform(m.a * q, 0, 0, m.d * q, m.e * q, m.f * q);
    }
    const vr = camera.visibleRect(10);
    const black = this._sprite('0,0,0');
    const hole = (x, y, r, a) => {
      l.globalAlpha = a;
      l.drawImage(black, x - r, y - r, 2 * r, 2 * r);
    };
    const seen = (p, r) => p.x > vr.minX - r && p.x < vr.maxX + r && p.y > vr.minY - r && p.y < vr.maxY + r;
    for (const p of lamps) if (seen(p, 10)) hole(p.x, p.y, 10, 0.8);
    for (const h of sim.lights.heads) if (seen(h, 3.2)) hole(h.x, h.y, 3.2, 0.7);
    // Headlight beam: a wedge that widens ahead of the vehicle (one gradient, drawn in each
    // vehicle's own frame)
    const view = l.getTransform();
    const beamGrad = this._grad(l, 'beam', (c) => {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 13);
      g.addColorStop(0, 'rgba(0,0,0,0.8)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    });
    l.globalAlpha = 1;
    l.fillStyle = beamGrad;
    for (const v of vehicles) {
      l.setTransform(view);
      l.translate(v.x, v.y);
      l.rotate(v.angle);
      l.translate(v.hl, 0);
      l.beginPath();
      l.moveTo(0, v.hw);
      l.lineTo(13, 4.2);
      l.lineTo(13, -4.2);
      l.lineTo(0, -v.hw);
      l.closePath();
      l.fill();
    }
    l.setTransform(view);
    for (const v of vehicles) {
      const c = Math.cos(v.angle);
      const s = Math.sin(v.angle);
      hole(v.x + c * v.hl, v.y + s * v.hl, 1.8, 0.9);
      if (v.a < -0.6 || v.v < 0.15) hole(v.x - c * v.hl, v.y - s * v.hl, 1.6, 0.6);
      if (v.emergency) hole(v.x, v.y, 7, 0.6);
    }
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lc, 0, 0, lw / q, lh / q);
    ctx.restore();

    // Warm additive glow on top of the pools.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, sprite, a) => {
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, x - r, y - r, 2 * r, 2 * r);
    };
    const lamp = this._sprite('255,196,120');
    for (const p of lamps) if (seen(p, 8)) glow(p.x, p.y, 8, lamp, 0.16 * dark);
    // Lit windows: a few warm squares on most roofs (fixed per building)
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(255,214,140,${0.55 * dark})`;
    ctx.fill(this._windowPath(buildings));
    const head = this._sprite('255,244,210');
    const tail = this._sprite('255,40,40');
    for (const v of vehicles) {
      const c = Math.cos(v.angle);
      const s = Math.sin(v.angle);
      glow(v.x + c * (v.hl + 4), v.y + s * (v.hl + 4), 5, head, 0.1 * dark);
      if (v.a < -0.6 || v.v < 0.15) glow(v.x - c * v.hl, v.y - s * v.hl, 1.6, tail, 0.3 * dark);
    }
    ctx.restore();
  }

  _rain(ctx, canvas, camera, rain, time) {
    const W = canvas.width;
    const H = canvas.height;
    const k = camera.dpr || 1;
    const n = Math.min(this.drops.length, Math.round(DROPS * Math.min(1, rain) * Math.min(1.4, (W * H) / (1600 * 900 * k * k) + 0.3)));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fall = 1100 * k;
    const len = (12 + 10 * rain) * k;
    // Streaks and rings are stamped from small pre-drawn images (one per streak length / ring size)
    // rather than stroked as hundreds of thin paths every frame.
    const S = this._rainSprites(len, k);
    ctx.globalAlpha = 0.22 + 0.25 * rain;
    for (let i = 0; i < n; i++) {
      const d = this.drops[i];
      const y = (((d.y * H + time * fall * d.speed) % (H + len)) + H + len) % (H + len) - len;
      const x = (((d.x * W + y * 0.18) % W) + W) % W;
      const sp = S.streaks[Math.round((d.len - 0.7) / STREAK_STEP)];
      ctx.drawImage(sp.c, x - sp.ox, y - sp.oy);
    }
    // Splash rings where drops hit the ground
    const m = Math.round(this.splashes.length * rain);
    for (let i = 0; i < m; i++) {
      const sp = this.splashes[i];
      const u = time * 1.6 + sp.phase;
      const t = u % 1;
      const cycle = Math.floor(u); // each ring lands somewhere new every cycle
      const x = ((sp.x + cycle * 0.618034) % 1) * W;
      const y = ((sp.y + cycle * 0.414214) % 1) * H;
      const ring = S.rings[Math.min(RINGS - 1, Math.round(t * (RINGS - 1)))];
      ctx.globalAlpha = (1 - t) * 0.3 * rain;
      ctx.drawImage(ring.c, x - ring.o, y - ring.o / 2);
    }
    ctx.restore();
  }

  /** Streak images for every drop length and ring images through a splash, for this streak length. */
  _rainSprites(len, k) {
    const key = `${Math.round(len * 2)}|${k}`;
    if (this._rainCache?.key === key) return this._rainCache.sprites;
    const make = (w, h, draw) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      const g = c.getContext('2d');
      g.lineWidth = k;
      draw(g);
      return c;
    };
    const pad = k + 1;
    const streaks = [];
    for (let s = 0; s <= Math.round(0.6 / STREAK_STEP); s++) {
      const L = len * (0.7 + s * STREAK_STEP);
      const dx = L * 0.18;
      const c = make(dx + 2 * pad, L + 2 * pad, (g) => {
        g.strokeStyle = 'rgb(205,220,240)';
        g.beginPath();
        g.moveTo(pad + dx, pad);
        g.lineTo(pad, pad + L);
        g.stroke();
      });
      streaks.push({ c, ox: pad + dx, oy: pad });
    }
    const rings = this._rainCache?.k === k ? this._rainCache.sprites.rings : [];
    for (let i = rings.length; i < RINGS; i++) {
      const t = i / (RINGS - 1);
      const rx = (1 + 5 * t) * k;
      const ry = (0.5 + 2.5 * t) * k;
      const o = rx + pad;
      const c = make(2 * o, o, (g) => {
        g.strokeStyle = 'rgb(210,225,245)';
        g.beginPath();
        g.ellipse(o, o / 2, rx, ry, 0, 0, Math.PI * 2);
        g.stroke();
      });
      rings.push({ c, o });
    }
    const sprites = { streaks, rings };
    this._rainCache = { key, k, sprites };
    return sprites;
  }
}
