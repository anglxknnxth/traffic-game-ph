// Landmarks a map can place in its blocks (map.landmarks): a plaza, a covered barangay court, a
// simbahan, a palengke, a mall and a riverside promenade. Drawn into the cached static layer, in
// the landmark's own frame (centre x, y; size w × h; angle), top-down like the rest of the city.

import { Rng } from '../utils/math.js';

/** Oriented footprint(s) of a landmark as [{ x, y, w, h, angle }] (the promenade follows the river). */
export function landmarkFootprints(l, river) {
  if (l.kind !== 'promenade') return [{ x: l.x, y: l.y, w: l.w, h: l.h, angle: l.angle || 0 }];
  if (!river) return [];
  const out = [];
  const p = {};
  const off = l.side * (river.width / 2 + 3.5);
  for (let s = l.from; s < l.to; s += 6) {
    river.pointAt(Math.min(l.to, s + 3), off, p);
    out.push({ x: p.x, y: p.y, w: 7, h: 7, angle: p.angle });
  }
  return out;
}

/** Draw one landmark. `text(ctx, str, x, y, size, color, angle)` writes a world-space label. */
export function drawLandmark(ctx, l, { river, text }) {
  if (l.kind === 'promenade') {
    drawPromenade(ctx, l, river);
    return;
  }
  const fn = DRAW[l.kind];
  if (!fn) return;
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(l.angle || 0);
  fn(ctx, l.w, l.h, new Rng(Math.round(l.x * 7 + l.y * 13)), text);
  ctx.restore();
}

function shadow(ctx, w, h, dx = 1.6, dy = 2.2) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(-w / 2 + dx, -h / 2 + dy, w, h);
}

function tree(ctx, x, y, r, rng) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.6, r, 0, Math.PI * 2);
  ctx.fill();
  const greens = ['#2f6b2a', '#3a7d33', '#4b8f3a'];
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = greens[k];
    ctx.beginPath();
    ctx.arc(x - k * 0.25 + rng.range(-0.2, 0.2), y - k * 0.3, r * (1 - k * 0.25), 0, Math.PI * 2);
    ctx.fill();
  }
}

const DRAW = {
  /** Plaza: lawn, a hedge border, curving walks, a fountain, a monument, benches and shade trees. */
  park(ctx, w, h, rng, text) {
    ctx.fillStyle = '#d6d0c2';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#5f9a45';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
    // lawn stripes from the mower
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = -w / 2 + 2; x < w / 2 - 2; x += 6) ctx.fillRect(x, -h / 2 + 2, 3, h - 4);
    // hedge
    ctx.strokeStyle = '#2e5e23';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-w / 2 + 2.6, -h / 2 + 2.6, w - 5.2, h - 5.2);
    // curving walks corner to corner, and a ring round the fountain
    ctx.strokeStyle = '#e7e0cf';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, -h / 2 + 2);
    ctx.bezierCurveTo(-w / 4, -h / 6, -w / 6, h / 8, 0, 0);
    ctx.bezierCurveTo(w / 6, -h / 8, w / 4, h / 6, w / 2 - 2, h / 2 - 2);
    ctx.moveTo(w / 2 - 2, -h / 2 + 2);
    ctx.bezierCurveTo(w / 5, -h / 4, w / 8, -h / 10, 0, 0);
    ctx.bezierCurveTo(-w / 8, h / 10, -w / 5, h / 4, -w / 2 + 2, h / 2 - 2);
    ctx.moveTo(0, -h / 2 + 2);
    ctx.lineTo(0, h / 2 - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    // fountain
    ctx.fillStyle = '#cfc8b8';
    ctx.beginPath();
    ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b8fc4';
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.25;
    for (const r of [1.6, 3, 4.3]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.arc(0, 0, 0.9, 0, Math.PI * 2);
    ctx.fill();
    // monument with a flagpole in front
    const my = -h / 2 + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-2.6, my - 2.2, 6, 5.2);
    ctx.fillStyle = '#b9b2a1';
    ctx.fillRect(-3, my - 2.6, 6, 5.2);
    ctx.fillStyle = '#8a8475';
    ctx.fillRect(-1.2, my - 1.2, 2.4, 2.4);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(4.6, my - 0.2, 0.4, 0.4);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(5, my - 0.2, 1.6, 0.5);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(5, my + 0.3, 1.6, 0.5);
    // benches along the ring
    ctx.fillStyle = '#7c4a21';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.4;
      ctx.save();
      ctx.translate(Math.cos(a) * 12.6, Math.sin(a) * 12.6);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-1.1, -0.3, 2.2, 0.6);
      ctx.restore();
    }
    // shade trees on the lawns
    for (let k = 0; k < Math.round((w * h) / 260); k++) {
      const x = rng.range(-w / 2 + 6, w / 2 - 6);
      const y = rng.range(-h / 2 + 6, h / 2 - 6);
      if (Math.hypot(x, y) < 15 || Math.abs(x) < 3) continue;
      tree(ctx, x, y, rng.range(2, 3.4), rng);
    }
    text(ctx, 'PLAZA', 0, h / 2 - 5, 2.2, '#f8fafc', 0);
  },

  /** Covered barangay basketball court: concrete slab, court lines, hoops, a see-through roof. */
  court(ctx, w, h, rng, text) {
    shadow(ctx, w, h);
    ctx.fillStyle = '#b8b4ab';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const cw = w - 4;
    const ch = h - 4;
    ctx.fillStyle = '#3f7d5a';
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = '#c2653a';
    ctx.fillRect(-cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 0.18;
    ctx.strokeRect(-cw / 2 + 1, -ch / 2 + 1, cw - 2, ch - 2);
    ctx.beginPath();
    ctx.moveTo(0, -ch / 2 + 1);
    ctx.lineTo(0, ch / 2 - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.stroke();
    for (const s of [-1, 1]) {
      const x = s * (cw / 2 - 1);
      ctx.strokeRect(Math.min(x, x - s * 5.8), -2.4, 5.8, 4.8);
      ctx.beginPath();
      ctx.arc(x, 0, 6.75, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? (3 * Math.PI) / 2 : Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - s * 0.4 - 0.1, -0.9, 0.2, 1.8);
      ctx.strokeStyle = '#ea580c';
      ctx.beginPath();
      ctx.arc(x - s * 0.9, 0, 0.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f8fafc';
    }
    // the yero roof, ribbed and see-through so the court still shows
    ctx.fillStyle = 'rgba(148,163,184,0.28)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(71,85,105,0.35)';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (let x = -w / 2; x <= w / 2; x += 1.2) {
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(71,85,105,0.5)';
    ctx.fillRect(-w / 2, -0.25, w, 0.5);
    text(ctx, 'BRGY. COURT', 0, h / 2 + 1.6, 1.3, '#f8fafc', 0);
  },

  /** Simbahan: a stone patio, a cross-shaped clay roof with its ridges, a bell tower. */
  church(ctx, w, h, rng, text) {
    ctx.fillStyle = '#cbc4b4';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    for (let x = -w / 2; x < w / 2; x += 2) {
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
    }
    for (let y = -h / 2; y < h / 2; y += 2) {
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
    }
    ctx.stroke();
    const L = w * 0.62; // nave length (along x)
    const N = h * 0.36; // nave width
    const tx = w * 0.12; // transept position
    const T = h * 0.78; // transept span
    const x0 = -w / 2 + w * 0.26;
    const roof = (x, y, a, b) => {
      ctx.fillRect(x - a / 2, y - b / 2, a, b);
    };
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roof(x0 + L / 2 + 1.6, 2.2, L, N);
    roof(x0 + L / 2 + tx + 1.6, 2.2, N, T);
    ctx.fillStyle = '#a4472f';
    roof(x0 + L / 2, 0, L, N);
    roof(x0 + L / 2 + tx, 0, N, T);
    // ridge shading: one slope lit, one in shade
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x0, 0, L, N / 2);
    ctx.fillRect(x0 + L / 2 + tx, -T / 2, N / 2, T);
    ctx.strokeStyle = '#7c2d1b';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + L, 0);
    ctx.moveTo(x0 + L / 2 + tx, -T / 2);
    ctx.lineTo(x0 + L / 2 + tx, T / 2);
    ctx.stroke();
    // bell tower at the front, with a cross
    const bx = x0 - 3.2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(bx - 3 + 2.2, -3 + 3, 6, 6);
    ctx.fillStyle = '#e8e0cf';
    ctx.fillRect(bx - 3, -3, 6, 6);
    ctx.fillStyle = '#8b6a3e';
    ctx.beginPath();
    ctx.moveTo(bx - 3, -3);
    ctx.lineTo(bx, 0);
    ctx.lineTo(bx + 3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b4f2c';
    ctx.beginPath();
    ctx.moveTo(bx - 3, 3);
    ctx.lineTo(bx, 0);
    ctx.lineTo(bx + 3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f5d76e';
    ctx.fillRect(bx - 0.15, -1.2, 0.3, 2.4);
    ctx.fillRect(bx - 0.8, -0.5, 1.6, 0.3);
    // patio trees
    for (const s of [-1, 1]) tree(ctx, -w / 2 + 4, s * (h / 2 - 4), 2.2, rng);
    text(ctx, 'SIMBAHAN', x0 + L / 2, h / 2 - 1.8, 1.5, '#7c2d1b', 0);
  },

  /** Palengke: rows of stalls under colourful tarps, with aisles between them. */
  palengke(ctx, w, h, rng, text) {
    shadow(ctx, w, h);
    ctx.fillStyle = '#9c968a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const tarps = ['#dc2626', '#2563eb', '#f59e0b', '#16a34a', '#db2777', '#0ea5e9', '#eab308'];
    const rows = Math.max(2, Math.floor((h - 4) / 6.5));
    const rowH = (h - 4) / rows;
    for (let r = 0; r < rows; r++) {
      const y = -h / 2 + 2 + r * rowH;
      let x = -w / 2 + 1.5;
      while (x < w / 2 - 3) {
        const sw = Math.min(w / 2 - 1.5 - x, rng.range(3, 5));
        ctx.fillStyle = rng.pick(tarps);
        ctx.fillRect(x, y + 0.6, sw - 0.3, rowH - 2.4);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y + 0.6, sw - 0.3, (rowH - 2.4) / 2);
        // crates and baskets of produce at the stall front
        ctx.fillStyle = rng.pick(['#65a30d', '#f97316', '#facc15', '#92400e']);
        ctx.fillRect(x + 0.4, y + rowH - 1.7, sw - 1.1, 0.6);
        x += sw;
      }
    }
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 0.3;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    text(ctx, 'PALENGKE', 0, -h / 2 - 1.6, 1.8, '#fde68a', 0);
  },

  /** Mall: a big flat roof with skylights, AC plant, and a rooftop car park with parked cars. */
  mall(ctx, w, h, rng, text) {
    shadow(ctx, w, h, 3, 4);
    ctx.fillStyle = '#c9c6bf';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#b7b3aa';
    ctx.fillRect(-w / 2, -h / 2, w, 1.2);
    ctx.fillRect(-w / 2, h / 2 - 1.2, w, 1.2);
    // rooftop car park on the right half
    const px = 2;
    ctx.fillStyle = '#5b5f66';
    ctx.fillRect(px, -h / 2 + 3, w / 2 - 5, h - 6);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    const cars = ['#e5e7eb', '#111827', '#dc2626', '#1d4ed8', '#9ca3af', '#f8fafc'];
    for (let x = px + 1; x < w / 2 - 4; x += 2.6) {
      for (const y0 of [-h / 2 + 3, h / 2 - 8]) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + 5);
      }
    }
    ctx.stroke();
    for (let x = px + 1; x < w / 2 - 6; x += 2.6) {
      for (const y0 of [-h / 2 + 3.4, h / 2 - 7.6]) {
        if (!rng.chance(0.65)) continue;
        ctx.fillStyle = rng.pick(cars);
        ctx.fillRect(x + 0.45, y0, 1.7, 4.2);
      }
    }
    // skylights and AC units on the left half
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(-w / 2 + 5 + k * ((w / 2 - 8) / 4), -h / 4, (w / 2 - 12) / 4, h / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-w / 2 + 5 + k * ((w / 2 - 8) / 4), -h / 4, (w / 2 - 12) / 8, h / 2);
    }
    ctx.fillStyle = '#9ca3af';
    for (let k = 0; k < 6; k++) ctx.fillRect(-w / 2 + 4 + k * 3.2, h / 2 - 6, 2.2, 2.2);
    text(ctx, 'CITY MALL', -w / 4, -h / 2 + 3.4, 2.4, '#1e3a8a', 0);
  },
};

/** Riverside promenade: a paved walk along the bank with lamp posts and benches. */
function drawPromenade(ctx, l, river) {
  if (!river) return;
  const p = {};
  const off = l.side * (river.width / 2 + 3.5);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (width, color, o = off) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let s = l.from; s <= l.to; s += 2) {
      river.pointAt(s, o, p);
      if (s === l.from) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  };
  path(6.4, '#bfb7a6');
  path(5.2, '#ddd5c3');
  path(0.25, 'rgba(0,0,0,0.12)', off - l.side * 1.4);
  path(0.25, 'rgba(0,0,0,0.12)', off + l.side * 1.4);
  // lamp posts on the water side, benches on the land side
  for (let s = l.from + 4; s < l.to; s += 14) {
    river.pointAt(s, off - l.side * 2.4, p);
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(253,230,138,0.85)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.18, 0, Math.PI * 2);
    ctx.fill();
    river.pointAt(s + 7, off + l.side * 2.2, p);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#7c4a21';
    ctx.fillRect(-1.1, -0.3, 2.2, 0.6);
    ctx.restore();
  }
  ctx.restore();
}
