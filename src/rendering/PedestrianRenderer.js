// Top-down people: shoulders and head with a walking swing. Umbrellas in the rain (and a few against
// the sun), white uniforms and backpacks for students, a taho vendor with his two buckets, a shout
// bubble over pasaway pedestrians, and the walk / don't-walk lights at each crosswalk.

import { worldText } from './RoadRenderer.js';

const SKIN = '#b9825a';
// People are drawn a little larger than life so they read at the default zoom (their collision
// radius in the simulation is unchanged).
const DRAW_SCALE = 1.35;
const SIGNAL_SCALE = 1.4;
const _p = {};

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPed(ctx, p, rain) {
  const L = p.look;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.scale(DRAW_SCALE, DRAW_SCALE);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ellipse(ctx, 0.08, 0.1, 0.26, 0.34);
  const swing = p.moving ? Math.sin(p.step * Math.PI) * 0.17 : 0;
  // legs and feet (local +x = walking direction)
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(swing - 0.1, -0.15, 0.2, 0.1);
  ctx.fillRect(-swing - 0.1, 0.05, 0.2, 0.1);
  // backpack
  if (L.bag) {
    ctx.fillStyle = L.bag;
    ctx.fillRect(-0.27, -0.16, 0.13, 0.32);
  }
  // shoulders and arms
  ctx.fillStyle = L.shirt;
  ellipse(ctx, 0, 0, 0.16, 0.27);
  ctx.fillStyle = SKIN;
  ellipse(ctx, -swing * 0.8, -0.28, 0.06, 0.06);
  ellipse(ctx, swing * 0.8, 0.28, 0.06, 0.06);
  // taho vendor: a pole across the shoulders with a bucket on each end
  if (p.kind === 'vendor') {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-0.03, -0.66, 0.06, 1.32);
    for (const y of [-0.66, 0.66]) {
      ctx.fillStyle = '#cbd5e1';
      ellipse(ctx, 0, y, 0.19, 0.19);
      ctx.fillStyle = '#f5deb3';
      ellipse(ctx, 0, y, 0.12, 0.12);
    }
  }
  // head
  ctx.fillStyle = L.hair;
  ellipse(ctx, 0.02, 0, 0.12, 0.12);
  // umbrella
  if (rain > 0.2 ? L.rainUmbrella : L.sunUmbrella) {
    ctx.globalAlpha = 0.93;
    ctx.fillStyle = L.umbrella;
    ellipse(ctx, 0.04, 0, 0.5, 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.moveTo(0.04, 0);
      ctx.lineTo(0.04 + Math.cos(a) * 0.5, Math.sin(a) * 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** People, culled to the visible rectangle. */
export function drawPedestrians(ctx, peds, rain, rect) {
  for (const p of peds) {
    if (p.x < rect.minX || p.x > rect.maxX || p.y < rect.minY || p.y > rect.maxY) continue;
    drawPed(ctx, p, rain);
  }
  for (const p of peds) {
    if (!(p.shout > 0) || p.x < rect.minX || p.x > rect.maxX || p.y < rect.minY || p.y > rect.maxY) continue;
    const a = Math.min(1, p.shout / 0.4);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(17,24,39,0.85)';
    ctx.fillRect(p.x - 2.3, p.y - 2.1, 4.6, 1.3);
    worldText(ctx, 'PASAWAY!', p.x, p.y - 1.45, 0.95, '#fde047', 0, 'center', 800);
    ctx.globalAlpha = 1;
  }
}

/** Walk / don't-walk lights on both kerbs of every crosswalk. */
export function drawPedSignals(ctx, sim, time) {
  const peds = sim.peds;
  for (const c of peds.crossings) {
    const state = peds.walkState(c);
    const blink = Math.floor(time * 3) % 2 === 0;
    const on = state === 'walk' ? '#22c55e' : state === 'flash' ? (blink ? '#f97316' : '#3f3f46') : '#ef4444';
    for (const side of [-1, 1]) {
      c.g.point(c.A.cwStart + 3.9, side * (c.A.half + 0.8), _p);
      ctx.save();
      ctx.translate(_p.x, _p.y);
      ctx.rotate(_p.angle);
      ctx.scale(SIGNAL_SCALE, SIGNAL_SCALE);
      ctx.fillStyle = '#111827';
      ctx.fillRect(-0.35, -0.35, 0.7, 0.7);
      ctx.fillStyle = on;
      if (state === 'walk') {
        // little walking figure
        ellipse(ctx, 0, -0.17, 0.08, 0.08);
        ctx.fillRect(-0.05, -0.1, 0.1, 0.2);
        ctx.fillRect(-0.15, 0.08, 0.1, 0.16);
        ctx.fillRect(0.05, 0.08, 0.1, 0.16);
      } else {
        // raised hand
        ctx.fillRect(-0.16, -0.12, 0.32, 0.3);
        ctx.fillRect(-0.16, -0.22, 0.07, 0.12);
        ctx.fillRect(-0.06, -0.25, 0.07, 0.14);
        ctx.fillRect(0.04, -0.22, 0.07, 0.12);
      }
      ctx.restore();
    }
  }
}
