// Rivers: muddy banks and grass edges, water with a darker channel and foam along the banks
// (static layer), flowing ripples and bangka outrigger boats (dynamic layer, clipped so boats pass
// under the bridges), and bridges where roads cross: deck shadow on the water, concrete parapets
// with posts and a name plaque.

import { strip } from './roadShapes.js';
import { worldText } from './RoadRenderer.js';

const _p = {};
const _q = {};

function stroke(ctx, river, width, style) {
  const p = river.pts;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.stroke();
}

function offsetLine(ctx, river, d, s0 = 0, s1 = river.length, step = 2) {
  river.pointAt(s0, d, _p);
  ctx.moveTo(_p.x, _p.y);
  for (let s = s0 + step; s <= s1; s += step) {
    river.pointAt(s, d, _p);
    ctx.lineTo(_p.x, _p.y);
  }
}

/** Water, banks and the vegetation edge (drawn into the static layer, under the roads). */
export function drawRiverStatic(ctx, river) {
  const w = river.width;
  stroke(ctx, river, w + 9, '#6b5a3e'); // mud bank
  stroke(ctx, river, w + 5, '#8a7650'); // wet sand
  stroke(ctx, river, w, '#2f6f86'); // shallows
  stroke(ctx, river, w * 0.62, '#255d73'); // channel
  stroke(ctx, river, w * 0.3, '#1f5367');
  // Foam and reflections along both banks
  ctx.strokeStyle = 'rgba(220,240,245,0.35)';
  ctx.lineWidth = 0.35;
  ctx.setLineDash([2.2, 1.6]);
  ctx.beginPath();
  offsetLine(ctx, river, -(w / 2 - 0.5));
  offsetLine(ctx, river, w / 2 - 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Bamboo clumps and nipa along the banks (points beside the water, deterministic). */
export function bankPlants(river, rng) {
  const out = [];
  for (let s = 4; s < river.length; s += rng.range(6, 14)) {
    const side = rng.chance(0.5) ? 1 : -1;
    river.pointAt(s, side * (river.width / 2 + rng.range(3.5, 7)), _p);
    out.push({ x: _p.x, y: _p.y, r: rng.range(1.4, 2.4), kind: rng.chance(0.4) ? 'nipa' : 'bamboo', angle: rng.range(0, Math.PI * 2) });
  }
  return out;
}

export function drawBankPlants(ctx, plants) {
  for (const t of plants) {
    if (t.kind === 'nipa') {
      // fan of fronds
      ctx.strokeStyle = '#4d7c32';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = t.angle + (k / 7) * Math.PI * 2;
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + Math.cos(a) * t.r * 1.4, t.y + Math.sin(a) * t.r * 1.4);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(t.x + 0.6, t.y + 0.8, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5e8c2f';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7aa83e';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Bridge spans: stretches of each road arm whose centre line is over the water.
 * Returns [{ g, u0, u1, half }] in arm-local coordinates.
 */
export function findBridges(river, arms) {
  const spans = [];
  for (const { g, len, half } of arms) {
    let start = null;
    for (let u = 0; u <= len; u += 1) {
      g.point(u, 0, _q);
      const over = river.contains(_q.x, _q.y, 2.5);
      if (over && start === null) start = u;
      if ((!over || u + 1 > len) && start !== null) {
        spans.push({ g, u0: Math.max(0, start - 1.5), u1: Math.min(len, u + 1.5), half });
        start = null;
      }
    }
  }
  return spans;
}

/** Shadow of each deck on the water (static layer, before the road is drawn). */
export function drawBridgeShadows(ctx, spans, sw) {
  ctx.save();
  ctx.translate(1.1, 1.6);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  for (const b of spans) strip(ctx, b.g, b.u0, b.u1, -(b.half + sw + 0.6), b.half + sw + 0.6);
  ctx.restore();
}

/** Parapets with posts and a name plaque (static layer, after the road). */
export function drawBridgeRails(ctx, spans, sw, name) {
  for (const b of spans) {
    const edge = b.half + sw;
    ctx.fillStyle = '#d9d4c7';
    strip(ctx, b.g, b.u0, b.u1, -edge - 0.6, -edge + 0.15);
    strip(ctx, b.g, b.u0, b.u1, edge - 0.15, edge + 0.6);
    ctx.fillStyle = '#8f897c';
    for (let u = b.u0; u <= b.u1; u += 2.5) {
      strip(ctx, b.g, u, u + 0.45, -edge - 0.75, -edge + 0.3);
      strip(ctx, b.g, u, u + 0.45, edge - 0.3, edge + 0.75);
    }
    // Expansion joints across the deck at both ends
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    strip(ctx, b.g, b.u0, b.u0 + 0.25, -edge, edge);
    strip(ctx, b.g, b.u1 - 0.25, b.u1, -edge, edge);
    if (name && b.u1 - b.u0 > 12) {
      b.g.point((b.u0 + b.u1) / 2, edge + 1.9, _q);
      ctx.fillStyle = 'rgba(17,24,39,0.75)';
      const tw = name.length * 0.62 + 1.2;
      ctx.save();
      ctx.translate(_q.x, _q.y);
      ctx.rotate(_q.angle);
      ctx.fillRect(-tw / 2, -0.7, tw, 1.4);
      ctx.restore();
      worldText(ctx, name, _q.x, _q.y, 0.95, '#f8fafc', _q.angle);
    }
  }
}

/** Clip to everything except the bridge decks (so boats pass under them). */
function clipOutBridges(ctx, spans, sw) {
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  for (const b of spans) {
    const e = b.half + sw + 0.8;
    const a = b.g.offset(b.u0, b.u1, -e).points;
    const c = b.g.offset(b.u0, b.u1, e).points;
    ctx.moveTo(a[0].x, a[0].y);
    for (let i = 1; i < a.length; i++) ctx.lineTo(a[i].x, a[i].y);
    for (let i = c.length - 1; i >= 0; i--) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
  }
  ctx.clip('evenodd');
}

function drawBangka(ctx, x, y, angle, color, rower) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0.4, 0.5, 3.4, 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  // outriggers (katig) on bamboo arms
  ctx.strokeStyle = '#a07a4a';
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  for (const ax of [-1.2, 1.2]) {
    ctx.moveTo(ax, -1.9);
    ctx.lineTo(ax, 1.9);
  }
  ctx.stroke();
  ctx.fillStyle = '#c9a66b';
  for (const oy of [-1.9, 1.9]) {
    ctx.beginPath();
    ctx.ellipse(0, oy, 2.4, 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // hull
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(3.3, 0);
  ctx.quadraticCurveTo(1.2, -0.72, -2.8, -0.55);
  ctx.lineTo(-3.1, 0);
  ctx.lineTo(-2.8, 0.55);
  ctx.quadraticCurveTo(1.2, 0.72, 3.3, 0);
  ctx.fill();
  ctx.fillStyle = '#7c5a32';
  ctx.beginPath();
  ctx.ellipse(-0.2, 0, 2.3, 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  if (rower) {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(-1.4, 0, 0.32, 0, Math.PI * 2); // salakot hat
    ctx.fill();
  }
  ctx.restore();
}

const BOAT_COLORS = ['#1d4ed8', '#dc2626', '#f8fafc', '#16a34a', '#f59e0b'];

/** Ripples drifting downstream and boats (dynamic layer, under traffic). */
export function drawRiverDynamic(ctx, river, spans, sw, time) {
  const w = river.width;
  ctx.save();
  clipOutBridges(ctx, spans, sw);
  // ripples: short light strokes moving with the current
  ctx.strokeStyle = 'rgba(210,235,245,0.22)';
  ctx.lineWidth = 0.28;
  ctx.beginPath();
  const flow = (time * 1.2) % 9;
  for (let s = flow; s < river.length; s += 9) {
    for (const d of [-w * 0.28, 0, w * 0.22]) {
      const ss = s + (d > 0 ? 3 : d < 0 ? 5.5 : 0);
      if (ss > river.length - 2) continue;
      river.pointAt(ss, d, _p);
      river.pointAt(ss + 1.8, d, _q);
      ctx.moveTo(_p.x, _p.y);
      ctx.lineTo(_q.x, _q.y);
    }
  }
  ctx.stroke();
  // boats: each drifts along its own lane, alternating directions
  for (let i = 0; i < river.boats; i++) {
    const speed = 1.6 + i * 0.5;
    const dir = i % 2 === 0 ? 1 : -1;
    const span = river.length + 40;
    let s = ((time * speed + i * 137) % span) - 20;
    if (dir < 0) s = river.length - s;
    river.pointAt(s, (dir > 0 ? 1 : -1) * w * 0.22, _p);
    const bob = Math.sin(time * 2 + i) * 0.04;
    drawBangka(ctx, _p.x, _p.y, _p.angle + (dir < 0 ? Math.PI : 0) + bob, BOAT_COLORS[i % BOAT_COLORS.length], true);
  }
  ctx.restore();
}
