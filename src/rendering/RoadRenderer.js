// Static world: ground, sidewalks, asphalt, medians, markings and roadside scenery (drawn once per
// camera change), dynamic road overlays (signal stop-line bars, downstream gates, blockages) and
// elevated structures drawn over traffic (MRT/LRT guideways, footbridges).
// Grade separation: nodes on level 1 (an elevated expressway) are left out of the ground layer and
// drawn by drawElevated over ground traffic; their shadow falls on the ground. Tunnel lanes under an
// underpass node are drawn as a walled trench that disappears under the junction.
//
// Everything is driven by the network geometry: each arm has its own road half-width, median,
// stop line and lane types, so wide avenues, T-junctions and U-turn slots draw correctly. Roads are
// drawn as bands along each arm's centre line, so bends and S-curves follow the lanes exactly.

import { Rng, makeObb, setObb, obbOverlap } from '../utils/math.js';
import { strip, addLine, dashes, withFrame, at } from './roadShapes.js';
import { ARMS, DIRS, CROSSWALK_WIDTH, SIDEWALK_WIDTH, CURB_RADIUS, LOADING_ZONE_S } from '../data/config.js';
import { rightOf, leftOf, SLOT_KINDS } from '../simulation/LaneManager.js';
import { TextureBank, makeCanvas, context2d } from './TextureBank.js';
import { drawLandmark, landmarkFootprints } from './LandmarkRenderer.js';
import { drawRiverStatic, drawRiverDynamic, drawBridgeShadows, drawBridgeRails, findBridges, bankPlants, drawBankPlants } from './RiverRenderer.js';

const SW = SIDEWALK_WIDTH;

const COLORS = {
  ground: '#52603f',
  sidewalk: '#b8b1a2',
  curb: '#dcd5c5',
  asphalt: '#3a3d43',
  white: 'rgba(240,240,236,0.92)',
  yellow: '#f2c230',
  busTint: 'rgba(242,194,48,0.13)',
  motoTint: 'rgba(37,99,235,0.32)',
  bikeTint: 'rgba(22,163,74,0.42)',
  median: '#a8a29e',
  medianGrass: '#4f7a3c',
};

const SHOP_NAMES = ['SARI-SARI', 'KARINDERYA', 'BAKERY', 'BOTIKA', 'VULCANIZING', 'LUGAWAN', 'TAPSILOGAN', 'PISO WIFI', 'HARDWARE', 'BARBERSHOP', 'LOAD', 'MILK TEA', 'PANCITERIA', 'ISAWAN'];
const ROOF_COLORS = ['#8f9ca6', '#7b8a94', '#a35a3c', '#b4683f', '#6f7f5f', '#9aa5ad', '#c9c2b0', '#6b7b8c', '#8b5e4a', '#d1cbbd', '#5f6f7e'];
const AWNING = [
  ['#e63946', '#f1faee'],
  ['#1d4ed8', '#f8fafc'],
  ['#16a34a', '#fefce8'],
  ['#f59e0b', '#fff7ed'],
  ['#9333ea', '#faf5ff'],
];

/** Per-map look: ground, building density and the kind of shops along the road. */
const THEMES = {
  default: { ground: COLORS.ground, fill: 700, trees: 160, shopChance: 0.75, gap: [0.6, 2.6], roofs: ROOF_COLORS, shops: SHOP_NAMES },
  metro: {
    ground: '#4d5745',
    fill: 760,
    trees: 70,
    shopChance: 0.85,
    gap: [0.4, 1.8],
    roofs: ['#8f9ca6', '#7b8a94', '#9aa5ad', '#c9c2b0', '#6b7b8c', '#d1cbbd', '#5f6f7e', '#b7bcc2', '#a3a8ae'],
    shops: ['PAWNSHOP', 'REMITTANCE', 'BANK', 'FAST FOOD', 'CONVENIENCE', 'BOTIKA', 'MONEY CHANGER', 'CELLPHONE REPAIR', 'BAKERY', 'GYM', 'LOTTO', 'PRINTING'],
  },
  'old-manila': {
    ground: '#555642',
    fill: 820,
    trees: 60,
    shopChance: 0.9,
    gap: [0.2, 1.0],
    roofs: ['#a35a3c', '#b4683f', '#8b5e4a', '#9c4f37', '#7b8a94', '#c9c2b0', '#6f5b4b', '#9aa5ad'],
    shops: ['PHOTOCOPY', 'BOOKSTORE', 'DORM', 'KARINDERYA', 'SCHOOL SUPPLIES', 'BOTIKA', 'SIOMAI', 'SHAWARMA', 'LUGAWAN', 'PISO PRINT', 'TAILORING', 'MILK TEA'],
  },
  province: {
    ground: '#5d743f',
    fill: 220,
    trees: 480,
    shopChance: 0.55,
    gap: [2.5, 9],
    roofs: ['#a35a3c', '#b4683f', '#6f7f5f', '#8b5e4a', '#c9c2b0', '#7b8a94', '#9c4f37', '#d1cbbd'],
    shops: ['SARI-SARI', 'AGRIVET', 'BIGASAN', 'KARINDERYA', 'VULCANIZING', 'BAKERY', 'BOTIKA', 'LECHON', 'HARDWARE', 'PISO WIFI'],
  },
};

const sideArms = (arm) => {
  const o = DIRS[arm];
  const a = (v) => ARMS.find((k) => Math.abs(DIRS[k].x - v.x) < 1e-6 && Math.abs(DIRS[k].y - v.y) < 1e-6);
  return { pos: a(rightOf(o)), neg: a(leftOf(o)) }; // local +y / -y in the arm frame
};

/** Length to draw along an arm: to the map edge for external roads, halfway for links. */
export function armLength(network, I, arm) {
  const A = I.arms[arm];
  if (A.type === 'link') return A.center.length / 2 + 0.05;
  return (A.length || 120) + 120;
}

/** Oriented box (centre, size along/across, angle) with a cached AABB for quick rejection. */
function box(cx, cy, w, h, angle) {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const ex = Math.abs(c) * (w / 2) + Math.abs(sn) * (h / 2);
  const ey = Math.abs(sn) * (w / 2) + Math.abs(c) * (h / 2);
  return { cx, cy, w, h, angle, obb: setObb(makeObb(), cx, cy, c, sn, w / 2, h / 2), minX: cx - ex, maxX: cx + ex, minY: cy - ey, maxY: cy + ey };
}

function hits(r, list, m) {
  for (const q of list) {
    if (r.minX > q.maxX + m || r.maxX < q.minX - m || r.minY > q.maxY + m || r.maxY < q.minY - m) continue;
    if (obbOverlap(r.obb, q.obb, m)) return true;
  }
  return false;
}

/** Painted bicycle symbol on a bike lane (pointing along `angle`). */
function drawBikeSymbol(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.arc(-0.55, 0, 0.32, 0, Math.PI * 2);
  ctx.moveTo(0.87, 0);
  ctx.arc(0.55, 0, 0.32, 0, Math.PI * 2);
  ctx.moveTo(-0.55, 0);
  ctx.lineTo(-0.1, -0.35);
  ctx.lineTo(0.35, -0.35);
  ctx.lineTo(0.55, 0);
  ctx.moveTo(-0.1, -0.35);
  ctx.lineTo(0, 0);
  ctx.lineTo(0.35, -0.35);
  ctx.stroke();
  ctx.restore();
}

function armFrame(ctx, I, arm) {
  const o = DIRS[arm];
  ctx.translate(I.x, I.y);
  ctx.rotate(Math.atan2(o.y, o.x));
}

// Labels are stamped from cached images, one per (text, colour, weight, pixel size). Pixel sizes
// come in √2 steps at or above the screen's, so a label is never drawn soft, and while zooming
// the glyphs are not rasterised afresh every frame (only once per step, per label).
const TEXT_FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
const TEXT_MAX = 800;
const textSprites = new Map();

function textSprite(text, px, color, weight) {
  const key = `${px}|${weight}|${color}|${text}`;
  let s = textSprites.get(key);
  if (s) {
    textSprites.delete(key); // keep the most recently used last (LRU order)
    textSprites.set(key, s);
    return s;
  }
  const font = `${weight} ${px}px ${TEXT_FONT}`;
  const probe = makeCanvas(1, 1);
  if (!probe) return null;
  const pg = context2d(probe);
  pg.font = font;
  const pad = Math.ceil(px * 0.15) + 1;
  const w = Math.ceil(pg.measureText(text).width) + 2 * pad;
  const h = Math.ceil(px * 1.35) + 2 * pad;
  const c = makeCanvas(w, h);
  const g = context2d(c);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2);
  s = { c, w, h, pad };
  textSprites.set(key, s);
  if (textSprites.size > TEXT_MAX) textSprites.delete(textSprites.keys().next().value);
  return s;
}

export function worldText(ctx, text, x, y, size, color, angle = 0, align = 'center', weight = 700) {
  ctx.save();
  ctx.translate(x, y);
  // Keep labels readable: never draw text upside down, whatever frame we are in.
  const t = ctx.getTransform();
  if (Math.cos(Math.atan2(t.b, t.a) + angle) < -0.1) angle += Math.PI;
  if (angle) ctx.rotate(angle);
  const want = size * Math.hypot(t.a, t.b); // device px of the em
  const px = want >= 2 ? Math.min(256, Math.max(6, 2 ** (Math.ceil(Math.log2(want) * 2) / 2))) : 0;
  const s = px ? textSprite(text, Math.round(px), color, weight) : null;
  if (s) {
    const k = size / Math.round(px); // world units per sprite pixel
    const x0 = align === 'left' ? -s.pad : align === 'right' ? -(s.w - s.pad) : -s.w / 2;
    ctx.drawImage(s.c, x0 * k, (-s.h / 2) * k, s.w * k, s.h * k);
  } else if (px) {
    const k = size / 20;
    ctx.scale(k, k);
    ctx.font = `${weight} 20px ${TEXT_FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}

/**
 * A tree seen from above: a shadow toward the lower right, then a canopy of overlapping lobes in
 * three greens with the sun side lit (acacia and mango), or now and then a coconut palm's fronds.
 */
function drawTree(ctx, t) {
  const seed = Math.abs(Math.sin(t.x * 3.7 + t.y * 9.1) * 1e4) % 1;
  const r = t.r;
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath();
  ctx.ellipse(t.x + r * 0.55, t.y + r * 0.75, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  if (seed < 0.14) {
    // coconut palm: radial fronds round a small crown
    ctx.strokeStyle = '#4d7f2c';
    ctx.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + seed * 10;
      ctx.lineWidth = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.quadraticCurveTo(t.x + Math.cos(a) * r * 0.7, t.y + Math.sin(a) * r * 0.7 - 0.2, t.x + Math.cos(a) * r * 1.25, t.y + Math.sin(a) * r * 1.25);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4f2a';
    ctx.beginPath();
    ctx.arc(t.x, t.y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const dark = `rgb(${34 + Math.round(t.shade * 14)},${78 + Math.round(t.shade * 26)},${36 + Math.round(t.shade * 10)})`;
  const mid = `rgb(${48 + Math.round(t.shade * 18)},${104 + Math.round(t.shade * 30)},${44 + Math.round(t.shade * 12)})`;
  const lit = `rgb(${84 + Math.round(t.shade * 20)},${140 + Math.round(t.shade * 26)},${62 + Math.round(t.shade * 12)})`;
  const lobes = 5;
  ctx.fillStyle = dark;
  for (let k = 0; k < lobes; k++) {
    const a = (k / lobes) * Math.PI * 2 + seed * 6;
    ctx.beginPath();
    ctx.arc(t.x + Math.cos(a) * r * 0.42, t.y + Math.sin(a) * r * 0.42, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = mid;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + seed * 3;
    ctx.beginPath();
    ctx.arc(t.x - r * 0.12 + Math.cos(a) * r * 0.28, t.y - r * 0.12 + Math.sin(a) * r * 0.28, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(t.x - r * 0.3, t.y - r * 0.32, r * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(t.x - r * 0.4, t.y - r * 0.42, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

export class RoadRenderer {
  /** `textureBase`: URL of the photo texture sets (given by a tile worker, see tileWorker.js). */
  constructor(network, { textureBase = null } = {}) {
    this.network = network;
    this.theme = THEMES[network.map.theme] || THEMES.default;
    this.bridges = network.river ? findBridges(network.river, this._armBands()) : [];
    this.scenery = this._generateScenery();
    // Surface textures (procedural; photo textures on maps that have a set). The static layer is
    // re-rendered when photos finish loading (version is part of the renderer's cache key).
    this.version = 0;
    this.tex = new TextureBank(network.map.textures || 'metro', () => this.version++, { baseUrl: textureBase }); // CC0 photo set on every map
  }

  /** Every drawn arm as { g, len, half } (for bridge detection). */
  _armBands() {
    const out = [];
    for (const I of this.network.intersections) {
      if (this._elevated(I)) continue; // the expressway spans the river on its own deck
      for (const arm of this._arms(I)) out.push({ g: this._g(I, arm), len: armLength(this.network, I, arm), half: I.arms[arm].half });
    }
    return out;
  }

  /** River water as oriented boxes, so buildings and trees stay on dry land. */
  _waterBoxes() {
    const r = this.network.river;
    if (!r) return [];
    const out = [];
    const p = {};
    for (let s = 0; s < r.length; s += 6) {
      r.pointAt(Math.min(r.length, s + 3), 0, p);
      out.push(box(p.x, p.y, 7.5, r.width + 8, p.angle));
    }
    return out;
  }

  /** Water ripples and boats, under traffic. */
  drawWater(ctx, time, vr = null) {
    if (this.network.river) drawRiverDynamic(ctx, this.network.river, this.bridges, SW, time, vr);
  }

  _arms(I) {
    return ARMS.filter((a) => I.arms[a].type !== 'none');
  }

  /** Node on the expressway level (drawn by drawElevated). */
  _elevated(I) {
    return I.layer >= 1;
  }

  /** Arm of a ground node that is a ramp up to the expressway (no sidewalks, low walls). */
  _ramp(I, arm) {
    const A = I.arms[arm];
    return A.type === 'link' && this.network.byId.get(A.other).layer >= 1 && !this._elevated(I);
  }

  get hasElevated() {
    return this.network.intersections.some((I) => this._elevated(I));
  }

  /** Half-width of the road crossing arm `arm` at node I (where corners and frontage begin). */
  _cross(I, arm) {
    return arm === 'N' || arm === 'S' ? I.hy : I.hx;
  }

  _hasCorner(I, adjacent) {
    return !SLOT_KINDS.has(I.kind) && adjacent && I.arms[adjacent].type !== 'none';
  }

  /** Centre line of an arm, oriented outward from I. */
  _g(I, arm) {
    return I.arms[arm].center;
  }

  // ------------------------------------------------------------------ scenery generation
  /** Road + sidewalk footprint as oriented boxes (short chunks along bends). */
  _corridors() {
    const boxes = [];
    for (const I of this.network.intersections) {
      let wx = 0;
      let wy = 0;
      for (const arm of this._arms(I)) {
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = armLength(this.network, I, arm);
        const w = A.half + SW;
        const step = g.isStraight(0, len) ? len : 5;
        for (let x = 0; x < len; x += step) {
          const x1 = Math.min(len, x + step);
          const c = at(g, (x + x1) / 2, 0);
          boxes.push(box(c.x, c.y, x1 - x + 1, 2 * w, c.angle));
        }
        if (DIRS[arm].x === 0) wx = Math.max(wx, w);
        else wy = Math.max(wy, w);
      }
      boxes.push(box(I.x, I.y, 2 * wx, 2 * wy, 0));
    }
    return boxes;
  }

  _generateScenery() {
    const net = this.network;
    const T = this.theme;
    const rng = new Rng(net.map.sceneSeed ?? 1898);
    const corridors = this._corridors();
    // Landmarks (plaza, simbahan, ...) keep their own ground: nothing else is built on them.
    const marks = [];
    for (const l of net.map.landmarks || []) for (const f of landmarkFootprints(l, net.river)) marks.push(box(f.x, f.y, f.w + 4, f.h + 4, f.angle));
    const water = [...this._waterBoxes(), ...marks];
    const river = net.river;
    const wet = (x, y, m = 2) => !!river && river.contains(x, y, m);
    const b = net.bounds;
    const area = { minX: b.minX - 30, maxX: b.maxX + 30, minY: b.minY - 30, maxY: b.maxY + 30 };
    const buildings = [];
    const trees = [];
    const sheds = [];
    const posts = [];
    const detail = () => Array.from({ length: rng.int(0, 3) }, () => ({ u: rng.range(0.2, 0.8), v: rng.range(0.2, 0.8), kind: rng.chance(0.5) ? 'tank' : 'ac' }));

    // Frontage buildings along every arm (both sides), shops near intersections.
    for (const I of net.intersections) {
      if (this._elevated(I)) continue;
      for (const arm of this._arms(I)) {
        if (this._ramp(I, arm)) continue;
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = Math.min(armLength(net, I, arm), (A.length || 120) + 40);
        const start = SLOT_KINDS.has(I.kind) ? 0.5 : this._cross(I, arm) + SW + 1.2;
        for (const sgn of [-1, 1]) {
          let t = start;
          while (t < len) {
            const width = rng.range(7, 15);
            const depth = rng.range(9, 17);
            const off = A.half + SW + 0.8 + depth / 2;
            const c = at(g, t + width / 2, sgn * off);
            const r = box(c.x, c.y, width, depth, c.angle);
            if (!hits(r, corridors, 0.6) && !hits(r, buildings, 0.9) && !hits(r, water, 1)) {
              const nearCorner = t < 55;
              buildings.push({
                ...r,
                color: rng.pick(T.roofs),
                ribbed: rng.chance(0.55),
                details: detail(),
                tiled: false,
                shop: nearCorner && rng.chance(T.shopChance) ? { name: rng.pick(T.shops), awning: rng.pick(AWNING) } : null,
                face: { x: 0, y: -sgn }, // toward the road, in the building's own frame
              });
            }
            t += width + rng.range(T.gap[0], T.gap[1]);
          }
          // Trees and lamp posts on the sidewalk
          let st = (A.stop || 0) + 9 + rng.range(0, 6);
          while (st < len - 4) {
            const q = at(g, st, sgn * (A.half + SW - 1.0));
            if (rng.chance(0.75)) {
              if (!wet(q.x, q.y) && !hits(box(q.x, q.y, 3, 3, 0), marks, 0)) trees.push({ x: q.x, y: q.y, r: rng.range(1.3, 1.9), shade: rng.range(0, 1) });
            } else posts.push({ x: q.x, y: q.y });
            st += rng.range(9, 15);
          }
        }
        // Waiting shed at the jeepney loading zone on external exits
        if (A.type === 'external') {
          const q = at(g, A.exitStop + LOADING_ZONE_S - 6, A.half + SW - 1.5);
          if (!wet(q.x, q.y, 3)) sheds.push({ x: q.x, y: q.y, angle: q.angle, color: rng.pick(['#2563eb', '#16a34a', '#dc2626']) });
        }
      }
    }
    // Fill remaining blocks (density stays the same on maps whose roads were extended)
    const areaScale = Math.max(1, ((area.maxX - area.minX) * (area.maxY - area.minY)) / (320 * 300));
    for (let i = 0; i < Math.round(T.fill * areaScale); i++) {
      const wx = rng.range(8, 20);
      const wy = rng.range(8, 20);
      const cx = rng.range(area.minX, area.maxX);
      const cy = rng.range(area.minY, area.maxY);
      const r = box(cx, cy, wx, wy, 0);
      if (hits(r, corridors, 2) || hits(r, buildings, 1.4) || hits(r, water, 1.5)) continue;
      buildings.push({ ...r, color: rng.pick(T.roofs), ribbed: rng.chance(0.5), details: detail(), shop: null });
    }
    // Scattered trees in lots
    for (let i = 0; i < Math.round(T.trees * areaScale); i++) {
      const x = rng.range(area.minX, area.maxX);
      const y = rng.range(area.minY, area.maxY);
      const r = box(x, y, 4, 4, 0);
      if (hits(r, corridors, 0.5) || hits(r, buildings, 0.3) || wet(x, y, 3) || hits(r, marks, 0.5)) continue;
      trees.push({ x, y, r: rng.range(1.6, 2.6), shade: rng.range(0, 1) });
    }
    // Bamboo and nipa along the river banks (own RNG so maps without water are unchanged)
    const plants = river ? bankPlants(river, new Rng((net.map.sceneSeed ?? 1898) + 31)).filter((t) => !hits(box(t.x, t.y, 3, 3, 0), corridors, 0.5) && !hits(box(t.x, t.y, 3, 3, 0), marks, 0)) : [];
    for (const b of buildings) if (!b.ribbed && /^#(a3|b4|8b|9c|6f5)/.test(b.color)) b.tiled = true;
    // Bare patches of soil in the empty lots (own RNG so the rest of the scene is unchanged)
    const lr = new Rng((net.map.sceneSeed ?? 1898) + 77);
    const lots = [];
    for (let i = 0; i < Math.round(30 * areaScale); i++) {
      const x = lr.range(area.minX, area.maxX);
      const y = lr.range(area.minY, area.maxY);
      if (hits(box(x, y, 10, 10, 0), corridors, 1) || wet(x, y, 4) || hits(box(x, y, 10, 10, 0), marks, 1)) continue;
      lots.push({ x, y, rx: lr.range(5, 14), ry: lr.range(3, 9), angle: lr.range(0, Math.PI) });
    }
    return { buildings, trees, sheds, posts, area, bankPlants: plants, lots };
  }

  // ------------------------------------------------------------------ static drawing
  drawStatic(ctx) {
    const net = this.network;
    const a = this.scenery.area;
    const R = CURB_RADIUS;
    ctx.fillStyle = this.theme.ground;
    ctx.fillRect(a.minX - 400, a.minY - 400, a.maxX - a.minX + 800, a.maxY - a.minY + 800);
    // Grass and bare soil, tinted toward the map's own ground colour
    const grass = this.tex.pattern(ctx, 'grass');
    if (grass) {
      ctx.globalAlpha = this.tex.isPhoto('grass') ? 0.7 : 0.85;
      ctx.fillStyle = grass;
      ctx.fillRect(a.minX - 400, a.minY - 400, a.maxX - a.minX + 800, a.maxY - a.minY + 800);
      const dirt = this.tex.pattern(ctx, 'dirt');
      if (dirt) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = dirt;
        for (const lot of this.scenery.lots || []) {
          if (this._off(lot.x, lot.y, Math.max(lot.rx, lot.ry))) continue;
          ctx.save();
          ctx.translate(lot.x, lot.y);
          ctx.rotate(lot.angle);
          ctx.beginPath();
          ctx.ellipse(0, 0, lot.rx, lot.ry, 0, 0, Math.PI * 2);
          ctx.restore();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = this.theme.ground;
      ctx.fillRect(a.minX - 400, a.minY - 400, a.maxX - a.minX + 800, a.maxY - a.minY + 800);
      ctx.globalAlpha = 1;
    }
    if (net.river) {
      drawRiverStatic(ctx, net.river);
      drawBankPlants(ctx, this.scenery.bankPlants);
      drawBridgeShadows(ctx, this.bridges, SW);
    }

    // Ground level only (the expressway is drawn by drawElevated); ramps have no sidewalks.
    const eachArm = (fn, sidewalks = false) => {
      for (const I of net.intersections) {
        if (this._elevated(I)) continue;
        for (const arm of this._arms(I)) {
          if ((sidewalks && this._ramp(I, arm)) || this._armOff(I, arm)) continue;
          fn(I, arm, I.arms[arm], armLength(net, I, arm), this._g(I, arm));
        }
      }
    };
    const p1 = {};
    const p2 = {};
    this._drawElevatedShadows(ctx);

    // Sidewalks
    ctx.fillStyle = this.tex.pattern(ctx, 'sidewalk') || COLORS.sidewalk;
    eachArm((I, arm, A, len, g) => strip(ctx, g, 0, len, -(A.half + SW), A.half + SW), true);
    // Sidewalk paving joints
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 0.08;
    eachArm((I, arm, A, len, g) => {
      const h = A.half;
      ctx.beginPath();
      for (let x = this._cross(I, arm) + SW; x < len; x += 2) {
        for (const sgn of [1, -1]) {
          at(g, x, sgn * (h + 0.3), p1);
          at(g, x, sgn * (h + SW), p2);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
      }
      ctx.stroke();
    }, true);
    // Ramps: low concrete walls instead of sidewalks
    ctx.fillStyle = '#b9b5ad';
    for (const I of net.intersections) {
      for (const arm of this._arms(I)) {
        if (!this._ramp(I, arm) || this._armOff(I, arm)) continue;
        const A = I.arms[arm];
        strip(ctx, this._g(I, arm), this._cross(I, arm) + 2, armLength(net, I, arm), -(A.half + 0.7), A.half + 0.7);
      }
    }
    // Asphalt (older, patched roads in the old city and the provinces)
    const asphalt = this.tex.pattern(ctx, this._asphaltName()) || COLORS.asphalt;
    ctx.fillStyle = asphalt;
    eachArm((I, arm, A, len, g) => strip(ctx, g, 0, len, -A.half, A.half));
    // Rounded curbs where two roads meet
    for (const I of net.intersections) {
      if (SLOT_KINDS.has(I.kind) || this._elevated(I) || this._off(I.x, I.y, Math.max(I.hx, I.hy) + R + 2)) continue;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          if (I.arms[sx > 0 ? 'E' : 'W'].type === 'none' || I.arms[sy > 0 ? 'S' : 'N'].type === 'none') continue;
          const cx = I.x + sx * (I.hx + R);
          const cy = I.y + sy * (I.hy + R);
          ctx.fillStyle = asphalt;
          ctx.fillRect(Math.min(I.x, cx), Math.min(I.y, cy), Math.abs(cx - I.x), Math.abs(cy - I.y));
          ctx.fillStyle = this.tex.pattern(ctx, 'sidewalk') || COLORS.sidewalk;
          ctx.beginPath();
          ctx.arc(cx, cy, R, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = COLORS.curb;
          ctx.lineWidth = 0.25;
          ctx.beginPath();
          const start = Math.atan2(-sy, -sx) - Math.PI / 4;
          ctx.arc(cx, cy, R, start, start + Math.PI / 2);
          ctx.stroke();
        }
      }
    }
    // Curb edge lines
    ctx.strokeStyle = COLORS.curb;
    ctx.lineWidth = 0.25;
    eachArm((I, arm, A, len, g) => {
      const sides = sideArms(arm);
      const cross = this._cross(I, arm);
      const from = (adj) => (this._hasCorner(I, adj) ? cross + R : 0);
      ctx.beginPath();
      addLine(ctx, g, from(sides.pos), len, A.half + 0.12);
      addLine(ctx, g, from(sides.neg), len, -A.half - 0.12);
      ctx.stroke();
    });
    // Asphalt texture patches
    const rng = new Rng(77);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (const I of net.intersections) {
      if (this._elevated(I)) continue;
      for (let i = 0; i < 40; i++) {
        const arm = rng.pick(ARMS);
        const A = I.arms[arm];
        if (A.type === 'none') continue;
        const x = Math.min(rng.range(A.stop, 90), armLength(net, I, arm) - 2);
        const y = rng.range(-A.half + 1, A.half - 1);
        const rx = rng.range(0.6, 2.2);
        const ry = rng.range(0.3, 1.0);
        const rot = rng.range(0, 3);
        // (every random draw above is made even for a patch outside the view, so the rest match)
        if (this.view && this._off(at(this._g(I, arm), x, y, p1).x, p1.y, 3)) continue;
        withFrame(ctx, this._g(I, arm), x, y, () => {
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, rot, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    // Medians
    eachArm((I, arm, A, len, g) => this._drawMedian(ctx, I, A, len, g));

    for (const I of net.intersections) if (!this._elevated(I) && !this._arms(I).every((arm) => this._armOff(I, arm))) this._drawNodeMarkings(ctx, I);
    this._drawTunnels(ctx);
    this._drawLaneDrops(ctx);
    if (net.river) drawBridgeRails(ctx, this.bridges, SW, net.river.name);
    this._drawRoadWear(ctx);
    this._drawScenery(ctx);
    this._drawStreetFurniture(ctx);
  }

  /** Manholes and tyre-darkened asphalt where traffic stops (fixed per map). */
  _drawRoadWear(ctx) {
    const rng = new Rng((this.network.map.sceneSeed ?? 1) + 5);
    for (const I of this.network.intersections) {
      if (this._elevated(I)) continue;
      for (const arm of this._arms(I)) {
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = armLength(this.network, I, arm);
        // Outside the view: nothing is drawn, but the random draws below are still made.
        const off = this._armOff(I, arm);
        // Tyre-darkened strip in each approach lane before the stop line
        if (!off && (I.kind === 'signal' || (I.kind === 'yield' && !I.major.has(arm)))) {
          for (const lane of I.approachLanes[arm] || []) {
            if (lane.type === 'tunnel' && I.def.underpass) continue;
            ctx.fillStyle = 'rgba(10,10,12,0.13)';
            for (const dy of [-0.65, 0.65]) strip(ctx, g, A.stop + 0.6, A.stop + 14, -lane.offset + dy - 0.28, -lane.offset + dy + 0.28);
          }
        }
        // Manholes in the lanes
        for (let k = 0; k < 3; k++) {
          const u = rng.range(A.stop + 20, Math.min(len - 5, A.stop + 140));
          const lane = rng.pick([...(I.approachLanes[arm] || []), ...(I.exitLanes[arm] || [])]);
          if (!lane || u >= len) continue;
          const q = at(g, u, (lane.role === 'exit' || (lane.startInt === I && lane.role === 'link') ? 1 : -1) * lane.offset + rng.range(-0.6, 0.6));
          if (off) continue;
          ctx.fillStyle = '#2b2d31';
          ctx.beginPath();
          ctx.arc(q.x, q.y, 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(150,150,150,0.45)';
          ctx.lineWidth = 0.06;
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Street furniture: blue MMDA street-name signs at the corners, "BAWAL MAGBABA/MAGSAKAY DITO"
   * signs, and the tangle of overhead wires strung between the posts.
   */
  _drawStreetFurniture(ctx) {
    const net = this.network;
    const p = {};
    for (const I of net.intersections) {
      if (I.kind !== 'signal' && I.kind !== 'yield') continue;
      if (this._elevated(I)) continue;
      this._arms(I).forEach((arm, idx) => {
        const A = I.arms[arm];
        if (this._ramp(I, arm) || this._armOff(I, arm)) return;
        const g = this._g(I, arm);
        const name = net.roadName(I, arm);
        if (name) {
          // Sign on the right of the traffic coming in, facing it
          at(g, A.cwStart + CROSSWALK_WIDTH + 13, -(A.half + SW * 0.55), p);
          const w = Math.min(7, name.length * 0.62 + 1.2);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle + Math.PI / 2);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(-w / 2 + 0.25, -0.55 + 0.3, w, 1.3);
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(-w / 2, -0.65, w, 1.3);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.08;
          ctx.strokeRect(-w / 2 + 0.12, -0.53, w - 0.24, 1.06);
          ctx.restore();
          worldText(ctx, name.toUpperCase(), p.x, p.y, 0.72, '#ffffff', p.angle + Math.PI / 2, 'center', 800);
        }
        if (I.kind === 'signal' && idx % 2 === 0 && A.type === 'external') {
          // "No loading or unloading" by the corner on the exit side
          at(g, A.exitStop + 10, A.half + SW * 0.6, p);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(-2.9 + 0.25, -0.6 + 0.3, 5.8, 1.2);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-2.9, -0.6, 5.8, 1.2);
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 0.16;
          ctx.strokeRect(-2.9, -0.6, 5.8, 1.2);
          ctx.restore();
          worldText(ctx, 'BAWAL MAGBABA DITO', p.x, p.y, 0.62, '#b91c1c', p.angle, 'center', 900);
        }
      });
    }
    // Overhead wires: sagging bundles between neighbouring posts, now and then across the road
    const wires = this._wireList();
    if (!wires.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const w of wires) {
      if (this._off(w.a.x, w.a.y, 28)) continue;
      const { a, b: best } = w;
      for (let k = 0; k < w.strands.length; k++) {
        const { mx, my } = w.strands[k];
        ctx.strokeStyle = k === 0 ? 'rgba(15,15,18,0.55)' : 'rgba(25,25,30,0.38)';
        ctx.lineWidth = k === 0 ? 0.09 : 0.06;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + k * 0.08);
        ctx.quadraticCurveTo(mx, my, best.x, best.y + k * 0.08);
        ctx.stroke();
      }
      // A transformer or a tangle on some posts
      if (w.tangle) {
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(a.x - 0.45, a.y - 0.45, 0.9, 0.9);
        ctx.strokeStyle = 'rgba(15,15,18,0.5)';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (const t of w.tangle) {
          ctx.moveTo(t[0], t[1]);
          ctx.quadraticCurveTo(t[2], t[3], t[4], t[5]);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The wire bundles between posts, worked out once per map (same random draws every time). */
  _wireList() {
    if (this._wires) return this._wires;
    const posts = this.scenery.posts;
    const out = [];
    const rng = new Rng((this.network.map.sceneSeed ?? 1) + 9);
    for (let i = 0; i < posts.length; i++) {
      const a = posts[i];
      let best = null;
      let bestD = 26;
      for (let j = 0; j < posts.length; j++) {
        if (j === i) continue;
        const b = posts[j];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > 6 && d < bestD && (b.x > a.x || (b.x === a.x && b.y > a.y))) {
          best = b;
          bestD = d;
        }
      }
      if (!best) continue;
      const n = rng.int(2, 4);
      const strands = [];
      for (let k = 0; k < n; k++) {
        const sag = rng.range(0.6, 1.8);
        strands.push({ mx: (a.x + best.x) / 2 + rng.range(-0.4, 0.4), my: (a.y + best.y) / 2 + sag });
      }
      let tangle = null;
      if (rng.chance(0.25)) {
        tangle = [];
        for (let k = 0; k < 6; k++) tangle.push([a.x + rng.range(-0.8, 0.8), a.y + rng.range(-0.8, 0.8), a.x + rng.range(-1.2, 1.2), a.y + rng.range(-1.2, 1.2), a.x + rng.range(-0.8, 0.8), a.y + rng.range(-0.8, 0.8)]);
      }
      out.push({ a, b: best, strands, tangle });
    }
    this._wires = out;
    return out;
  }

  /** Shadow of the expressway and its ramps on the ground (sun from the upper left), with piers. */
  _drawElevatedShadows(ctx) {
    const net = this.network;
    const sx = 2.6;
    const sy = 3.4;
    for (const I of net.intersections) {
      if (!this._elevated(I)) continue;
      for (const arm of this._arms(I)) {
        if (this._armOff(I, arm)) continue;
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = armLength(net, I, arm);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        strip(ctx, g, 0, len, -(A.half + 0.7), A.half + 0.7);
        ctx.restore();
        // Piers every 30 m along the centre line
        ctx.fillStyle = '#9b978f';
        for (let u = 12; u < len; u += 30) {
          const q = at(g, u, 0);
          ctx.fillRect(q.x - 1.1 + sx * 0.5, q.y - 1.1 + sy * 0.5, 2.2, 2.2);
        }
      }
    }
  }

  /** The expressway level: decks, parapets, markings, toll booths (drawn over ground traffic). */
  drawElevated(ctx) {
    const net = this.network;
    const nodes = net.intersections.filter((I) => this._elevated(I));
    if (!nodes.length) return;
    for (const I of nodes) {
      if (this._arms(I).every((arm) => this._armOff(I, arm))) continue;
      for (const arm of this._arms(I)) {
        if (this._armOff(I, arm)) continue;
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = armLength(net, I, arm);
        ctx.fillStyle = '#c9c5bc'; // parapet
        strip(ctx, g, 0, len, -(A.half + 0.75), A.half + 0.75);
        ctx.fillStyle = this.tex.pattern(ctx, 'asphalt') || '#44474d'; // deck asphalt
        strip(ctx, g, 0, len, -A.half, A.half);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        strip(ctx, g, 0, len, A.half, A.half + 0.2);
        strip(ctx, g, 0, len, -A.half - 0.2, -A.half);
        // Expansion joints
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let u = 20; u < len; u += 40) strip(ctx, g, u, u + 0.25, -A.half, A.half);
        this._drawMedian(ctx, I, A, len, g);
      }
      this._drawNodeMarkings(ctx, I);
    }
  }

  /**
   * Underpass: the tunnel lanes of each arm run down a walled trench from the portal to the
   * junction, then under it (the junction box covers them).
   */
  _drawTunnels(ctx) {
    for (const I of this.network.intersections) {
      if (!I.def.underpass) continue;
      for (const arm of this._arms(I)) {
        const band = this._tunnelBand(I, arm);
        if (!band) continue;
        const { g, u0, u1, y } = band;
        // Trench floor, darker toward the covered part
        const n = 8;
        for (let i = 0; i < n; i++) {
          const a = u0 + ((u1 - u0) * i) / n;
          const b = u0 + ((u1 - u0) * (i + 1)) / n;
          ctx.fillStyle = 'rgba(10,12,16,' + (0.55 - (0.4 * i) / n).toFixed(3) + ')';
          strip(ctx, g, a, b, -y, y);
        }
        // Walls on both sides and down the middle
        ctx.fillStyle = '#cfcac0';
        strip(ctx, g, u0, u1, y - 0.15, y + 0.45);
        strip(ctx, g, u0, u1, -y - 0.45, -y + 0.15);
        strip(ctx, g, u0, u1, -0.3, 0.3);
        // Portal: the tunnel mouth under the junction
        ctx.fillStyle = '#0b0d10';
        strip(ctx, g, u0 - 1.5, u0 + 1.2, -y, y);
        ctx.fillStyle = '#e5e1d8';
        strip(ctx, g, u0 + 1.2, u0 + 1.7, -y - 0.45, y + 0.45);
        const q = at(g, u0 + 6, -y / 2);
        worldText(ctx, 'UNDERPASS', q.x, q.y, 1.1, 'rgba(242,194,48,0.9)', q.angle + Math.PI / 2);
        const q2 = at(g, u0 + 6, y / 2);
        worldText(ctx, 'UNDERPASS', q2.x, q2.y, 1.1, 'rgba(242,194,48,0.9)', q2.angle - Math.PI / 2);
      }
    }
  }

  /** Arm-local band of the tunnel lanes at an underpass node: { g, u0, u1, y } or null. */
  _tunnelBand(I, arm) {
    const A = I.arms[arm];
    const lanes = (I.approachLanes[arm] || []).filter((l) => l.type === 'tunnel');
    if (!lanes.length) return null;
    const y = Math.max(...lanes.map((l) => l.offset + l.width / 2));
    const u0 = A.exitStop + 0.5;
    const u1 = Math.min(armLength(this.network, I, arm), A.exitStop + 70);
    return { g: this._g(I, arm), u0, u1, y };
  }

  /** Darken traffic down in the trench (drawn over vehicles). */
  drawTrenchShade(ctx) {
    for (const I of this.network.intersections) {
      if (!I.def.underpass) continue;
      for (const arm of this._arms(I)) {
        const band = this._tunnelBand(I, arm);
        if (!band) continue;
        const { g, u0, u1, y } = band;
        const n = 6;
        for (let i = 0; i < n; i++) {
          const a = u0 + ((u1 - u0) * i) / n;
          const b = u0 + ((u1 - u0) * (i + 1)) / n;
          ctx.fillStyle = 'rgba(5,6,8,' + (0.42 - (0.36 * i) / n).toFixed(3) + ')';
          strip(ctx, g, a, b, -y + 0.15, y - 0.15);
        }
      }
    }
  }

  /** A contraflow lane: orange cones, a CONTRAFLOW sign and a blinking arrow board. */
  _drawZone(ctx, z, time) {
    const n = Math.min(z.placed, z.cones.length);
    for (let i = 0; i < n; i++) {
      const c = z.cones[i];
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(c.x + 0.15, c.y + 0.2, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    if (n < 2) return;
    const a = z.cones[0];
    const b = z.cones[Math.min(n - 1, 5)];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.fillStyle = '#111827';
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);
    ctx.fillRect(-4.5, -1.1, 3.4, 2.2);
    const on = Math.floor(time * 2) % 2 === 0;
    ctx.fillStyle = on ? '#fbbf24' : '#3f3f46';
    for (let k = 0; k < 3; k++) ctx.fillRect(-4.2 + k * 1, -0.2, 0.6, 0.4);
    ctx.restore();
    worldText(ctx, z.state === 'open' ? 'CONTRAFLOW' : z.state === 'closing' ? 'CLOSING' : 'CONES…', a.x, a.y - 2.4, 1.1, '#fbbf24');
  }

  /** Outline of a stretch of a lane (from s0 to s1 along it, w wide) as a closed path. */
  _laneStrip(ctx, lane, s0, s1, w) {
    const P = lane.path;
    const pt = { x: 0, y: 0, dx: 0, dy: 0 };
    const left = [];
    const right = [];
    for (let s = s0; s <= s1 + 1e-6; s += Math.max(0.5, Math.min(2, (s1 - s0) / 8))) {
      P.pointAt(Math.min(s, s1), pt);
      left.push([pt.x - pt.dy * (w / 2), pt.y + pt.dx * (w / 2)]);
      right.push([pt.x + pt.dy * (w / 2), pt.y - pt.dx * (w / 2)]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
  }

  /** Lane drops: hatched gore where the lane has ended, "LANE ENDS" and merge arrows before it. */
  _drawLaneDrops(ctx) {
    const pt = { x: 0, y: 0, dx: 0, dy: 0 };
    for (const d of this.network.laneDrops || []) {
      const lane = d.lane;
      const s0 = d.s;
      const s1 = lane.length;
      // The dead stretch: painted over with chevrons (it is no longer a lane).
      ctx.save();
      this._laneStrip(ctx, lane, s0, s1, lane.width - 0.3);
      ctx.fillStyle = '#34373c';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(240,240,236,0.8)';
      ctx.lineWidth = 0.22;
      const side = lane.laneIndex > 0 ? -1 : 1; // the lane it merges into is toward the median
      for (let s = s0 + 1; s < s1 + 4; s += 2.6) {
        lane.path.pointAt(Math.min(s, s1), pt);
        ctx.beginPath();
        ctx.moveTo(pt.x - pt.dy * 2 * side + pt.dx * 0, pt.y + pt.dx * 2 * side);
        ctx.lineTo(pt.x + pt.dy * 2 * side + pt.dx * 2.4, pt.y - pt.dx * 2 * side + pt.dy * 2.4);
        ctx.stroke();
      }
      ctx.restore();
      // Taper line from the lane edge to the end point
      lane.path.pointAt(s0, pt);
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 0.18;
      this._laneStrip(ctx, lane, s0, s1, lane.width - 0.3);
      ctx.stroke();
      // Legend and merge arrows before the end
      for (const back of [12, 34, 58]) {
        const s = s0 - back;
        if (s < 4) continue;
        lane.path.pointAt(s, pt);
        const ang = Math.atan2(pt.dy, pt.dx);
        if (back === 12) {
          worldText(ctx, 'LANE ENDS', pt.x, pt.y, 1.15, 'rgba(242,194,48,0.95)', ang - Math.PI / 2);
          continue;
        }
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(240,240,236,0.85)';
        // A bent arrow: forward, then over into the next lane (toward local -y = left of travel)
        ctx.fillRect(-2.2, -0.12, 2.4, 0.24);
        ctx.beginPath();
        ctx.moveTo(0.2, -0.12);
        ctx.lineTo(1.4, side * 1.2 - 0.12);
        ctx.lineTo(1.4, side * 1.2 + 0.12);
        ctx.lineTo(0.2, 0.12);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(2.1, side * 1.9);
        ctx.lineTo(0.9, side * 1.6);
        ctx.lineTo(1.8, side * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  _asphaltName() {
    const t = this.network.map.theme;
    return t === 'old-manila' || t === 'province' ? 'asphaltWorn' : 'asphalt';
  }

  _medianStart(I, A) {
    if (SLOT_KINDS.has(I.kind)) return A.stop;
    return A.cwStart + CROSSWALK_WIDTH + 0.4;
  }

  _drawMedian(ctx, I, A, len, g) {
    const m = A.median;
    if (m < 0.3) return;
    const x0 = this._medianStart(I, A);
    if (x0 >= len) return;
    const style = A.profile.medianStyle || (m >= 2.5 ? (this.network.map.theme === 'old-manila' ? 'grass' : 'concrete') : 'barrier');
    if (style === 'barrier') {
      // Jersey barrier: a narrow concrete wall on the centre line.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      strip(ctx, g, x0, len, -0.25, 0.45);
      ctx.fillStyle = '#c4c0b8';
      strip(ctx, g, x0, len, -0.35, 0.35);
      ctx.fillStyle = '#e7e3da';
      strip(ctx, g, x0, len, -0.08, 0.08);
      return;
    }
    const h = m / 2 - 0.15;
    ctx.fillStyle = style === 'grass' ? this.tex.pattern(ctx, 'grass') || COLORS.medianGrass : COLORS.median;
    strip(ctx, g, x0, len, -h, h);
    ctx.strokeStyle = COLORS.yellow;
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    addLine(ctx, g, x0, len, -h);
    addLine(ctx, g, x0, len, h);
    const e0 = at(g, x0, -h);
    const e1 = at(g, x0, h);
    ctx.moveTo(e0.x, e0.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.stroke();
    if (style === 'grass') {
      for (let x = x0 + 4; x < len - 2; x += 9) {
        withFrame(ctx, g, x, 0, () => {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.arc(0.3, 0.35, Math.min(1.4, h), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3f7a35';
          ctx.beginPath();
          ctx.arc(0, 0, Math.min(1.4, h), 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  }

  _drawNodeMarkings(ctx, I) {
    const net = this.network;
    if (I.kind === 'signal') {
      // Yellow box junction ("Don't block the box")
      const bx = I.hx - 0.5;
      const by = I.hy - 0.5;
      if (bx > 0 && by > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(I.x - bx, I.y - by, 2 * bx, 2 * by);
        ctx.clip();
        ctx.strokeStyle = 'rgba(242,194,48,0.55)';
        ctx.lineWidth = 0.16;
        ctx.beginPath();
        const span = 2 * Math.max(bx, by);
        for (let k = -2 * span; k <= 2 * span; k += 2.2) {
          ctx.moveTo(I.x - span + k, I.y - span);
          ctx.lineTo(I.x - span + k + 2 * span, I.y + span);
          ctx.moveTo(I.x + span - k, I.y - span);
          ctx.lineTo(I.x + span - k - 2 * span, I.y + span);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = COLORS.yellow;
        ctx.lineWidth = 0.22;
        ctx.strokeRect(I.x - bx, I.y - by, 2 * bx, 2 * by);
      }
    }
    if (I.kind === 'uturn') worldText(ctx, 'U-TURN SLOT', I.x, I.y, 1.3, 'rgba(242,194,48,0.9)', Math.abs(DIRS[this._arms(I)[0]].x) > 0 ? 0 : Math.PI / 2);
    if (I.kind === 'toll') worldText(ctx, 'TOLL PLAZA', I.x, I.y, 1.5, 'rgba(242,194,48,0.95)', Math.abs(DIRS[this._arms(I)[0]].x) > 0 ? 0 : Math.PI / 2);

    const q = {};
    for (const arm of this._arms(I)) {
      if (this._armOff(I, arm)) continue;
      const A = I.arms[arm];
      const g = this._g(I, arm);
      const len = armLength(net, I, arm);
      const m = A.median;
      const h = A.half;
      const p = A.profile;
      const xs = A.stop + 0.6;
      const lanes = I.approachLanes[arm] || [];
      const exits = I.exitLanes[arm] || [];

      // ---- Markings that run the length of the road. Each is one stroked line along the centre
      // line, so it follows bends and keeps an even dash rhythm; a link road is painted once, from
      // its `a` end all the way to the stop line at the other end.
      // Dedicated lane tints and legends
      // Outer edge of lane k (lanes may differ in width: bike lanes are narrow)
      const outer = (k) => p.offsets[k] + p.widths[k] / 2;
      for (const [list, sign] of [
        [lanes, -1],
        [exits, 1],
      ]) {
        for (const lane of list) {
          if (lane.type === 'general' || lane.type === 'tunnel') continue;
          const k = lane.laneIndex;
          const ya = sign * outer(k);
          const yb = sign * (outer(k) - p.widths[k]);
          ctx.fillStyle = lane.type === 'bus' ? COLORS.busTint : lane.type === 'bike' ? COLORS.bikeTint : COLORS.motoTint;
          strip(ctx, g, xs, len, Math.min(ya, yb), Math.max(ya, yb));
          if (lane.type === 'bike') {
            for (let x = xs + 14; x < len - 6; x += 26) {
              at(g, x, sign * lane.offset, q);
              drawBikeSymbol(ctx, q.x, q.y, q.angle + (sign < 0 ? Math.PI : 0));
            }
            continue;
          }
          const label = lane.type === 'bus' ? 'BUS LANE' : 'MOTORCYCLE LANE';
          for (let x = xs + 22; x < len - 10; x += 48) {
            at(g, x, sign * lane.offset, q);
            worldText(ctx, label, q.x, q.y, lane.type === 'bus' ? 1.25 : 0.95, lane.type === 'bus' ? 'rgba(242,194,48,0.85)' : 'rgba(255,255,255,0.8)', q.angle);
          }
        }
      }
      const link = A.type === 'link' ? A.link : null;
      if (!link || link.a === I.id) {
        // Far end: the other node's stop line (links) or the end of the drawn road.
        let farStop = len + 40;
        let farExit = len + 40;
        if (link) {
          const BA = net.byId.get(link.b).arms[link.bArm];
          farStop = g.length - BA.stop;
          farExit = g.length - BA.exitStop;
        }
        const limit = link ? farStop : len;
        const end = Math.min(limit, farStop - 0.6);
        const paint = (y, w, kind, x0, x1, dash) => this._paintLine(ctx, g, x0, Math.min(x1, limit), y, w, kind, dash);
        // Centre: double solid yellow on undivided roads
        if (m < 0.3) {
          paint(-0.2, 0.12, 'yellow', xs, end);
          paint(0.2, 0.12, 'yellow', xs, end);
        }
        // Edge lines along both curbs
        paint(-h + 0.31, 0.12, 'white', xs, end);
        paint(h - 0.31, 0.12, 'white', xs, end);
        // Lane lines: broken white (3 m paint, 6 m gap), solid for the last 18 m before a stop line;
        // solid next to a dedicated lane (yellow along the busway).
        const special = (t1, t2) => (t1 === 'bus' || t2 === 'bus' ? 'bus' : [t1, t2].includes('moto') ? 'moto' : [t1, t2].includes('bike') ? 'bike' : null);
        for (let k = 0; k < p.lanes - 1; k++) {
          const sp = special(p.types[k], p.types[k + 1]);
          if (sp) {
            for (const y of [-outer(k), outer(k)]) paint(y, 0.14, sp === 'bus' ? 'yellow' : 'white', xs - 0.15, end);
            continue;
          }
          // Lanes heading into this node (left of the outward direction, -y)
          paint(-outer(k), 0.12, 'white', A.stop + 0.45, A.stop + 18.45);
          paint(-outer(k), 0.12, 'white', A.stop + 22, link ? farExit - 1.5 : len, [3, 6]);
          // Lanes leaving it (+y): on a link they head into the far node's stop line
          if (link) {
            paint(outer(k), 0.12, 'white', A.exitStop + 1.5, farStop - 22, [3, 6]);
            paint(outer(k), 0.12, 'white', farStop - 18.45, farStop - 0.45);
          } else paint(outer(k), 0.12, 'white', A.exitStop + 1.5, len, [3, 6]);
        }
      }

      // ---- Markings near the junction (always on the straight lead)
      ctx.save();
      armFrame(ctx, I, arm);
      // Through-lane guides across a U-turn slot
      if (SLOT_KINDS.has(I.kind)) {
        ctx.fillStyle = 'rgba(240,240,236,0.5)';
        for (let k = 0; k < p.lanes - 1; k++) {
          for (const y of [-outer(k), outer(k)]) for (let x = 0.5; x < A.stop; x += 3) ctx.fillRect(x, y - 0.05, 1.4, 0.1);
        }
      }

      const minor = I.kind === 'yield' && !I.major.has(arm);
      // Stop line across approach lanes (none for through traffic at U-turn slots or on a major road)
      if (minor && I.def.rolling) {
        // A merge: give-way triangles and YIELD, no stop needed
        ctx.fillStyle = COLORS.white;
        for (let y = -h + 0.4; y < -m / 2 - 0.4; y += 0.9) {
          ctx.beginPath();
          ctx.moveTo(A.stop + 0.9, y);
          ctx.lineTo(A.stop, y + 0.35);
          ctx.lineTo(A.stop + 0.9, y + 0.7);
          ctx.closePath();
          ctx.fill();
        }
        worldText(ctx, 'YIELD', A.stop + 3.4, -(m / 2 + (h - m / 2) / 2), 1.4, COLORS.white, Math.PI / 2);
      } else if (I.kind === 'signal' || minor || I.kind === 'toll') {
        ctx.fillStyle = this._paintStyle(ctx, 'white');
        ctx.fillRect(A.stop, -h + 0.2, 0.45, h - m / 2 - 0.45);
        if (minor) worldText(ctx, 'STOP', A.stop + 3.2, -(m / 2 + (h - m / 2) / 2), 1.6, COLORS.white, Math.PI / 2);
      }
      // Toll booths: an island with a booth between each pair of lanes, ETC by the median
      if (I.kind === 'toll' && lanes.length) {
        for (let k = 0; k <= lanes.length; k++) {
          const yEdge = k === 0 ? -(m / 2) : -(lanes[k - 1].offset + lanes[k - 1].width / 2);
          ctx.fillStyle = '#d6d0c4';
          ctx.fillRect(A.stop - 0.2, yEdge - 0.35, 6, 0.7);
          ctx.fillStyle = k % 2 ? '#1d4ed8' : '#dc2626';
          ctx.fillRect(A.stop + 1.2, yEdge - 0.55, 2.2, 1.1);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillRect(A.stop + 1.4, yEdge - 0.4, 0.5, 0.8);
        }
        worldText(ctx, 'ETC', A.stop + 8, -lanes[0].offset, 1.1, 'rgba(250,204,21,0.95)', Math.PI / 2);
        for (let k = 1; k < lanes.length; k++) worldText(ctx, 'CASH', A.stop + 8, -lanes[k].offset, 1.0, 'rgba(255,255,255,0.85)', Math.PI / 2);
      }
      // Zebra crossing
      if (A.cwStart != null) {
        ctx.fillStyle = this._paintStyle(ctx, 'white');
        for (let y = -h + 0.45; y < h - 0.4; y += 1.0) ctx.fillRect(A.cwStart, y, CROSSWALK_WIDTH, 0.55);
      }
      // Lane arrows (pointing toward the intersection = local -x)
      for (const lane of lanes) if (lane.moves?.length) this._arrow(ctx, A.stop + 8, -lane.offset, lane.moves);
      ctx.restore();

      // Jeepney loading zone on the curb exit lane, bus stop on the busway (may sit on a bend)
      if (A.type === 'external') {
        for (const lane of exits) {
          const isJeep = lane.isCurb && lane.type === 'general';
          const isBus = lane.type === 'bus';
          if (!isJeep && !isBus) continue;
          const x0 = A.exitStop + LOADING_ZONE_S - 13;
          const y0 = lane.offset - lane.width / 2 + 0.25;
          const y1 = lane.offset + lane.width / 2 - 0.35;
          ctx.strokeStyle = 'rgba(242,194,48,0.85)';
          ctx.lineWidth = 0.14;
          ctx.setLineDash([0.8, 0.6]);
          ctx.beginPath();
          addLine(ctx, g, x0, x0 + 13.3, y0);
          addLine(ctx, g, x0, x0 + 13.3, y1);
          for (const x of [x0, x0 + 13.3]) {
            at(g, x, y0, q);
            ctx.moveTo(q.x, q.y);
            at(g, x, y1, q);
            ctx.lineTo(q.x, q.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          at(g, x0 + 6.6, lane.offset, q);
          worldText(ctx, isBus ? 'BUS STOP' : 'JEEP STOP', q.x, q.y, 1.1, 'rgba(242,194,48,0.9)', q.angle);
        }
      }
    }
  }

  /**
   * Road paint: thermoplastic off-white or yellow with a little grain and wear (the asphalt shows
   * through here and there). A pattern in world units, made once per canvas.
   */
  _paintStyle(ctx, kind) {
    // One pattern per kind, shared by every canvas the static layer is drawn into.
    const set = this._paints || (this._paints = {});
    if (set[kind] !== undefined) return set[kind];
    const base = kind === 'yellow' ? '#e9b934' : '#ebe8dd';
    let style = base;
    const c = makeCanvas(64, 64);
    if (c) {
      const k = context2d(c);
      k.fillStyle = base;
      k.fillRect(0, 0, 64, 64);
      const rng = new Rng(kind === 'yellow' ? 71 : 37);
      // grain
      for (let i = 0; i < 260; i++) {
        k.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.18)';
        k.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1);
      }
      // worn spots where the asphalt shows through
      k.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 26; i++) {
        k.fillStyle = 'rgba(0,0,0,' + rng.range(0.25, 0.7).toFixed(2) + ')';
        k.beginPath();
        k.arc(rng.range(0, 64), rng.range(0, 64), rng.range(0.6, 2.4), 0, Math.PI * 2);
        k.fill();
      }
      const pat = ctx.createPattern(c, 'repeat');
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') {
        pat.setTransform(new DOMMatrix().scale(1 / 40)); // 64 px of pattern = 1.6 m of road
        style = pat;
      }
    }
    set[kind] = style;
    return style;
  }

  /** One painted line along offset y from x0 to x1 (dash = [paint, gap] in metres, or solid). */
  _paintLine(ctx, g, x0, x1, y, w, kind, dash) {
    if (x1 - x0 < 0.2) return;
    ctx.save();
    ctx.strokeStyle = this._paintStyle(ctx, kind);
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    // Thinner than a pixel at this zoom: fade it instead of letting it shimmer.
    const px = w * (this.ppm || 10);
    if (px < 1) ctx.globalAlpha = Math.max(0.35, px);
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    addLine(ctx, g, x0, x1, y);
    ctx.stroke();
    ctx.restore();
  }

  /** Lane arrow pointing toward the junction (local -x); left of travel is local +y. */
  _arrow(ctx, x, y, moves) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(240,240,236,0.8)';
    const head = (hx, hy, dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(hx + dx * 1.0, hy + dy * 1.0);
      ctx.lineTo(hx - dy * 0.55, hy + dx * 0.55);
      ctx.lineTo(hx + dy * 0.55, hy - dx * 0.55);
      ctx.closePath();
      ctx.fill();
    };
    // stem
    ctx.fillRect(-0.4, -0.12, 2.8, 0.24);
    if (moves.includes('straight')) {
      ctx.fillRect(-1.2, -0.12, 1.0, 0.24);
      head(-1.2, 0, -1, 0);
    }
    for (const turn of ['left', 'right']) {
      if (!moves.includes(turn)) continue;
      const sy = turn === 'left' ? 1 : -1;
      ctx.fillRect(0.48, sy > 0 ? 0 : -1.0, 0.24, 1.0);
      head(0.6, sy * 0.9, 0, sy);
    }
    if (moves.includes('uturn')) {
      ctx.strokeStyle = 'rgba(240,240,236,0.8)';
      ctx.lineWidth = 0.24;
      ctx.beginPath();
      ctx.arc(-0.4, 0.75, 0.75, Math.PI / 2, (3 * Math.PI) / 2, false);
      ctx.stroke();
      head(0.4, 1.5, 1, 0);
    }
    ctx.restore();
  }

  /** Outside the area being drawn (the cached view), so it can be skipped. */
  _off(x, y, r) {
    const V = this.view;
    return !!V && (x + r < V.minX || x - r > V.maxX || y + r < V.minY || y - r > V.maxY);
  }

  /**
   * World box around everything drawn along an arm: its centre line out to the end of the drawn
   * road (and the far stop line of a link), widened past the sidewalks to take in signs and shadows.
   */
  _armBox(I, arm) {
    const boxes = this._armBoxes || (this._armBoxes = new Map());
    const key = `${I.id}:${arm}`;
    let b = boxes.get(key);
    if (b) return b;
    const A = I.arms[arm];
    const g = this._g(I, arm);
    const len = Math.max(armLength(this.network, I, arm), g.length) + 40;
    b = { minX: I.x, minY: I.y, maxX: I.x, maxY: I.y };
    const p = {};
    const add = (u) => {
      g.point(u, 0, p);
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    };
    for (let u = 0; u < len; u += 4) add(u);
    add(len);
    for (const q of g.pts) if (q.u < len) add(q.u);
    const r = A.half + SW + 12;
    b.minX -= r;
    b.minY -= r;
    b.maxX += r;
    b.maxY += r;
    boxes.set(key, b);
    return b;
  }

  /** Does anything on the expressway level reach into world rectangle V? */
  elevatedIn(V) {
    for (const I of this.network.intersections) {
      if (!this._elevated(I)) continue;
      for (const arm of this._arms(I)) {
        const b = this._armBox(I, arm);
        if (!(b.maxX < V.minX || b.minX > V.maxX || b.maxY < V.minY || b.minY > V.maxY)) return true;
      }
    }
    return false;
  }

  /** The arm lies wholly outside the area being drawn. */
  _armOff(I, arm) {
    const V = this.view;
    if (!V) return false;
    const b = this._armBox(I, arm);
    return b.maxX < V.minX || b.minX > V.maxX || b.maxY < V.minY || b.minY > V.maxY;
  }

  _drawScenery(ctx) {
    const { buildings, trees, sheds, posts } = this.scenery;
    for (const l of this.network.map.landmarks || []) {
      if (l.kind !== 'promenade' && this._off(l.x, l.y, Math.max(l.w, l.h))) continue;
      drawLandmark(ctx, l, { river: this.network.river, text: worldText });
    }
    // Level of detail from the zoom (device pixels per metre): far out, signs and rooftop clutter
    // are smaller than a pixel, so they are left out (a full redraw of a big map stays quick).
    const ppm = this.ppm || 10;
    const lod = ppm < 2.2 ? 0 : ppm < 5 ? 1 : 2;
    for (const b of buildings) {
      if (this._off(b.cx, b.cy, Math.max(b.w, b.h) + 4)) continue;
      const w = b.w;
      const h = b.h;
      const minX = -w / 2;
      const minY = -h / 2;
      const maxX = w / 2;
      const maxY = h / 2;
      // Height in storeys (fixed per building): taller shops on the avenues, low houses behind.
      const storeys = b.storeys || (b.storeys = 1 + (Math.abs(Math.sin(b.cx * 12.9898 + b.cy * 78.233) * 43758.5453) % 1) * (b.shop ? 6 : 3.2));
      // Shadow: the roof outline swept away from the sun (upper left), longer for taller buildings.
      const sl = 0.55 + storeys * 0.75;
      if (lod === 0) {
        ctx.save();
        ctx.translate(b.cx + sl * 0.35, b.cy + sl * 0.5);
        ctx.rotate(b.angle);
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.fillRect(minX, minY, w + sl * 0.3, h + sl * 0.3);
        ctx.restore();
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.rotate(b.angle);
        ctx.fillStyle = b.color;
        ctx.fillRect(minX, minY, w, h);
        ctx.restore();
        continue;
      }
      const corners = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ].map(([x, y]) => [b.cx + x * Math.cos(b.angle) - y * Math.sin(b.angle), b.cy + x * Math.sin(b.angle) + y * Math.cos(b.angle)]);
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i];
        const [bx2, by2] = corners[(i + 1) % 4];
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx2, by2);
        ctx.lineTo(bx2 + sl * 0.7, by2 + sl);
        ctx.lineTo(ax + sl * 0.7, ay + sl);
        ctx.closePath();
      }
      ctx.fill('nonzero');
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(minX, minY, w, h);
      // Roof material: corrugated yero, clay tiles or a concrete deck, in the building's colour
      const roof = this.tex.pattern(ctx, b.ribbed ? 'yero' : b.tiled ? 'tiles' : 'concrete');
      if (roof) {
        ctx.save();
        if (b.ribbed && w < h) ctx.rotate(Math.PI / 2); // ridges run along the long side
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = roof;
        if (b.ribbed && w < h) ctx.fillRect(minY, -maxX, h, w);
        else ctx.fillRect(minX, minY, w, h);
        ctx.restore();
      }
      if (b.ribbed && !roof) {
        ctx.strokeStyle = 'rgba(0,0,0,0.13)';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        if (w > h) for (let x = minX + 0.6; x < maxX; x += 0.6) { ctx.moveTo(x, minY); ctx.lineTo(x, maxY); }
        else for (let y = minY + 0.6; y < maxY; y += 0.6) { ctx.moveTo(minX, y); ctx.lineTo(maxX, y); }
        ctx.stroke();
      }
      // Bevel: the parapet catches the light on the sun side and falls into shade on the other.
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(minX, minY, w, 0.3);
      ctx.fillRect(minX, minY, 0.3, h);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(minX, maxY - 0.3, w, 0.3);
      ctx.fillRect(maxX - 0.3, minY, 0.3, h);
      if (!b.ribbed) {
        // Concrete roof deck: a parapet wall all round
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.18;
        ctx.strokeRect(minX + 0.5, minY + 0.5, w - 1, h - 1);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.15;
      ctx.strokeRect(minX, minY, w, h);
      for (const d of lod === 2 ? b.details : []) {
        const x = minX + d.u * w;
        const y = minY + d.v * h;
        if (d.kind === 'tank') {
          ctx.fillStyle = '#2b6cb0';
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 0.1;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#d9d9d9';
          ctx.fillRect(x - 0.6, y - 0.45, 1.2, 0.9);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 0.08;
          ctx.strokeRect(x - 0.6, y - 0.45, 1.2, 0.9);
        }
      }
      if (b.shop) {
        // Awning along the side facing the road
        const f = b.face;
        const [c1, c2] = b.shop.awning;
        const depth = 1.4;
        let ax, ay, aw, ah;
        if (f.x > 0) [ax, ay, aw, ah] = [maxX, minY + 0.6, depth, h - 1.2];
        else if (f.x < 0) [ax, ay, aw, ah] = [minX - depth, minY + 0.6, depth, h - 1.2];
        else if (f.y > 0) [ax, ay, aw, ah] = [minX + 0.6, maxY, w - 1.2, depth];
        else [ax, ay, aw, ah] = [minX + 0.6, minY - depth, w - 1.2, depth];
        const horiz = aw > ah;
        const n = Math.max(2, Math.floor((horiz ? aw : ah) / 0.8));
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 ? c2 : c1;
          if (horiz) ctx.fillRect(ax + (aw * i) / n, ay, aw / n + 0.01, ah);
          else ctx.fillRect(ax, ay + (ah * i) / n, aw, ah / n + 0.01);
        }
        // Sign on the roof edge (only once it is big enough to read)
        if (lod < 2) {
          ctx.restore();
          continue;
        }
        const sx = f.x !== 0 ? (f.x > 0 ? maxX - 1.3 : minX + 1.3) : 0;
        const sy = f.y !== 0 ? (f.y > 0 ? maxY - 1.3 : minY + 1.3) : 0;
        const ang = f.x !== 0 ? -Math.PI / 2 : 0;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang);
        const tw = Math.min(b.shop.name.length * 0.75 + 1, (f.x !== 0 ? h : w) - 1);
        ctx.fillStyle = '#fefae0';
        ctx.fillRect(-tw / 2, -0.75, tw, 1.5);
        ctx.strokeStyle = c1;
        ctx.lineWidth = 0.18;
        ctx.strokeRect(-tw / 2, -0.75, tw, 1.5);
        worldText(ctx, b.shop.name, 0, 0.02, 1.0, '#1f2937');
        ctx.restore();
      }
      ctx.restore();
    }
    for (const sh of sheds) {
      if (this._off(sh.x, sh.y, 4)) continue;
      const w = 4.5;
      const h = 1.8;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-w / 2 + 0.3, -h / 2 + 0.4, w, h);
      ctx.fillStyle = sh.color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-w / 2, -0.1, w, 0.2);
      ctx.restore();
    }
    for (const p of posts) {
      if (this._off(p.x, p.y, 2)) continue;
      ctx.fillStyle = '#4b5563';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,180,0.18)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const t of trees) {
      if (this._off(t.x, t.y, t.r + 1)) continue;
      if (lod === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.arc(t.x + t.r * 0.5, t.y + t.r * 0.7, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3c7a35';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
        ctx.fill();
      } else drawTree(ctx, t);
    }
  }

  // ------------------------------------------------------------------ dynamic overlays
  drawDynamic(ctx, sim, time, vr = null) {
    const net = this.network;
    const off = (x, y, r) => vr && (x < vr.minX - r || x > vr.maxX + r || y < vr.minY - r || y > vr.maxY + r);
    // Signal colour on each stop line
    for (const I of net.intersections) {
      if (I.kind !== 'signal' || off(I.x, I.y, (I.maxStop || 30) + 10)) continue;
      for (const arm of ARMS) {
        if (!I.approachLanes[arm]) continue;
        const A = I.arms[arm];
        const sig = sim.lights.signal(I.id, arm);
        ctx.save();
        armFrame(ctx, I, arm);
        ctx.fillStyle =
          sig === 'green' ? 'rgba(34,197,94,0.75)' : sig === 'yellow' ? 'rgba(250,204,21,0.85)' : sig === 'flash' ? `rgba(250,204,21,${Math.floor(time * 2) % 2 ? 0.25 : 0.85})` : 'rgba(239,68,68,0.75)';
        ctx.fillRect(A.stop - 0.72, -A.half + 0.2, 0.5, A.half - A.median / 2 - 0.45);
        ctx.restore();
      }
    }
    // Downstream discharge points (next junction) on jammed exits
    for (const lane of net.exitLanes) {
      if (!lane.gateVisible) continue;
      const I = lane.startInt;
      const A = I.arms[lane.startArm];
      if (off(I.x, I.y, A.exitStop + lane.gateLocal + 12)) continue;
      const g = this._g(I, lane.startArm);
      const x = A.exitStop + lane.gateLocal + 0.3;
      const open = lane.gate.tokens >= 1;
      withFrame(ctx, g, x, lane.offset, () => {
        ctx.fillStyle = 'rgba(240,240,236,0.85)';
        ctx.fillRect(0, -lane.width / 2 + 0.2, 0.4, lane.width - 0.4);
        ctx.fillStyle = open ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        ctx.arc(1.2, 0, 0.45, 0, Math.PI * 2);
        ctx.fill();
      });
      if (lane.isCurb) {
        const q = at(g, x + 3.5, A.half + 1.6);
        worldText(ctx, 'NEXT JUNCTION', q.x, q.y, 1.2, 'rgba(255,255,255,0.85)', q.angle + Math.PI / 2);
      }
    }
    // Contraflow lanes: the cones (going up one by one), the sign and a flashing arrow board
    for (const z of sim.counterflow?.zones || []) this._drawZone(ctx, z, time);
    // Blockages: cones + barrier + label
    for (const b of sim.blockages) {
      if (!b.active || b.kind === 'ped' || b.kind === 'laneEnd' || b.kind === 'cf') continue;
      for (const lane of b.laneObjs) {
        const A = lane.startInt.arms[lane.startArm];
        withFrame(ctx, this._g(lane.startInt, lane.startArm), A.exitStop + b.s, lane.offset, () => {
          // stalled vehicle silhouette beyond the cones
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(1.6, -1.1, 7, 2.3);
          ctx.fillStyle = '#6b7280';
          ctx.fillRect(1.4, -1.2, 7, 2.4);
          ctx.fillStyle = '#9ca3af';
          ctx.fillRect(6.4, -1.0, 1.6, 2.0);
          const blink = Math.floor(time * 3) % 2 === 0;
          ctx.fillStyle = blink ? '#fbbf24' : '#92400e';
          ctx.fillRect(1.4, -1.2, 0.4, 0.4);
          ctx.fillRect(1.4, 0.8, 0.4, 0.4);
          if (b.towing !== undefined) {
            // tow truck backed up to the wreck
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(8.8, -1.0, 6.6, 2.3);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(8.6, -1.15, 6.4, 2.3);
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(12.6, -1.0, 2.2, 2.0);
            ctx.fillStyle = '#9ca3af';
            ctx.fillRect(7.8, -0.12, 1.2, 0.24);
            ctx.fillStyle = blink ? '#f97316' : '#fde68a';
            ctx.fillRect(13.6, -1.15, 0.5, 2.3);
          }
          for (let k = -1; k <= 1; k++) {
            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.arc(0.3, k * 1.1, 0.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0.3, k * 1.1, 0.18, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }
      const lane = b.laneObjs[b.laneObjs.length - 1];
      if (lane) {
        const A = lane.startInt.arms[lane.startArm];
        const q = at(this._g(lane.startInt, lane.startArm), A.exitStop + b.s + 5, A.half + 2.6);
        ctx.fillStyle = 'rgba(17,24,39,0.82)';
        const tw = (b.label || 'BLOCKED').length * 0.78 + 1.6;
        ctx.fillRect(q.x - tw / 2, q.y - 0.9, tw, 1.8);
        worldText(ctx, b.label || 'BLOCKED', q.x, q.y, 1.15, '#fbbf24');
      }
    }
  }

  // ------------------------------------------------------------------ elevated structures (over traffic)
  drawOverlays(ctx, time) {
    const net = this.network;
    const b = net.bounds;
    for (const ov of net.map.overlays || []) {
      if (ov.kind === 'rail') (ov.follow ? this._drawRailAlong(ctx, ov, time) : this._drawRail(ctx, ov, b, time));
      else if (ov.kind === 'footbridge') this._drawFootbridge(ctx, ov);
    }
  }

  /**
   * Centre line of a rail line that follows a road through the nodes in `ov.follow` (N to S): in
   * from the first node's North arm, along the links, out along the last node's South arm. Each
   * point carries its distance along the line and the unit tangent.
   */
  _railLine(ov) {
    this._rails = this._rails || new Map();
    if (this._rails.has(ov)) return this._rails.get(ov);
    const net = this.network;
    const nodes = ov.follow.map((id) => net.byId.get(id));
    const pts = [];
    const add = (c, u0, u1) => {
      const n = Math.max(2, Math.ceil(Math.abs(u1 - u0) / 3));
      for (let i = 0; i <= n; i++) {
        const p = c.point(u0 + ((u1 - u0) * i) / n, 0);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) pts.push({ x: p.x, y: p.y });
      }
    };
    const first = nodes[0].arms.N.center;
    add(first, first.length, 0);
    for (let i = 0; i < nodes.length - 1; i++) add(nodes[i].arms.S.center, 0, nodes[i].arms.S.center.length);
    const last = nodes[nodes.length - 1].arms.S.center;
    add(last, 0, last.length);
    let d = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      pts[i].d = d;
      pts[i].tx = (b.x - a.x) / m;
      pts[i].ty = (b.y - a.y) / m;
    }
    const line = { pts, length: d };
    this._rails.set(ov, line);
    return line;
  }

  /** Point at distance d along a rail line: { x, y, angle }. */
  _railAt(line, d) {
    const P = line.pts;
    let lo = 0;
    let hi = P.length - 1;
    d = Math.max(0, Math.min(line.length, d));
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (P[mid].d <= d) lo = mid;
      else hi = mid;
    }
    const a = P[lo];
    const b = P[hi];
    const k = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** An elevated rail line bending with the road under it: guideway, tracks, station, trains. */
  _drawRailAlong(ctx, ov, time) {
    const line = this._railLine(ov);
    const w = ov.width;
    const stroke = (off, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      line.pts.forEach((p, i) => {
        const x = p.x - p.ty * off;
        const y = p.y + p.tx * off;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    const alpha = ov.translucent ? 0.62 : 0.95;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha * 0.55;
    ctx.translate(0, 1.4);
    stroke(0, w, '#000');
    ctx.translate(0, -1.4);
    ctx.globalAlpha = alpha;
    stroke(0, w, '#9ea3a8');
    stroke(-w / 2 + 0.17, 0.35, '#7c8186');
    stroke(w / 2 - 0.17, 0.35, '#7c8186');
    for (const ty of [-w / 4, w / 4]) {
      stroke(ty, 1.5, '#5b5f63');
      stroke(ty - 0.49, 0.12, '#c9ced3');
      stroke(ty + 0.49, 0.12, '#c9ced3');
    }
    const colour = ov.line === 'MRT-3' ? '#2563eb' : '#16a34a';
    if (ov.station) {
      const s = ov.station;
      const p = this._railAt(line, s.at);
      const sw = w + 3.2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-s.length / 2 + 0.8, -sw / 2 + 1.4, s.length, sw);
      ctx.fillStyle = '#d6d3cd';
      ctx.fillRect(-s.length / 2, -sw / 2, s.length, sw);
      ctx.fillStyle = colour;
      ctx.fillRect(-s.length / 2, -sw / 2, s.length, 0.9);
      ctx.fillRect(-s.length / 2, sw / 2 - 0.9, s.length, 0.9);
      ctx.restore();
      worldText(ctx, s.name, p.x, p.y, 1.25, '#1f2937', p.angle);
    }
    // A train now and then, car by car along the curve
    const period = 70;
    const ph = (time % period) / period;
    if (ph < 0.45) {
      const head = (line.length + 40) * (ph / 0.45);
      const off = ov.line === 'MRT-3' ? -w / 4 : w / 4;
      for (let c = 0; c < 3; c++) {
        const d = head - c * 13 - 6.2;
        if (d < 0 || d > line.length) continue;
        const p = this._railAt(line, d);
        ctx.save();
        ctx.translate(p.x - Math.sin(p.angle) * off, p.y + Math.cos(p.angle) * off);
        ctx.rotate(p.angle);
        ctx.fillStyle = ov.line === 'MRT-3' ? '#e5e7eb' : '#f3f4f6';
        ctx.fillRect(-6.2, -1.4, 12.4, 2.8);
        ctx.fillStyle = ov.line === 'MRT-3' ? '#1d4ed8' : '#15803d';
        ctx.fillRect(-6.2, -0.35, 12.4, 0.7);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  _drawRail(ctx, ov, b, time) {
    const vertical = ov.axis === 'y';
    const w = ov.width;
    const from = (vertical ? b.minY : b.minX) - 140;
    const to = (vertical ? b.maxY : b.maxX) + 140;
    ctx.save();
    if (vertical) {
      ctx.translate(ov.at, 0);
      ctx.rotate(Math.PI / 2);
    } else ctx.translate(0, ov.at);
    // now the guideway runs along local x, centred on y = 0
    const alpha = ov.translucent ? 0.62 : 0.95;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(from, -w / 2 + 1.4, to - from, w);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#9ea3a8';
    ctx.fillRect(from, -w / 2, to - from, w);
    ctx.fillStyle = '#7c8186';
    ctx.fillRect(from, -w / 2, to - from, 0.35);
    ctx.fillRect(from, w / 2 - 0.35, to - from, 0.35);
    // two tracks
    ctx.fillStyle = '#5b5f63';
    for (const ty of [-w / 4, w / 4]) {
      ctx.fillRect(from, ty - 0.75, to - from, 1.5);
      ctx.fillStyle = '#c9ced3';
      ctx.fillRect(from, ty - 0.55, to - from, 0.12);
      ctx.fillRect(from, ty + 0.43, to - from, 0.12);
      ctx.fillStyle = '#5b5f63';
    }
    // Station platform and roof
    if (ov.station) {
      const s = ov.station;
      const sw = w + 3.2;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(s.at - s.length / 2 + 0.8, -sw / 2 + 1.4, s.length, sw);
      ctx.fillStyle = '#d6d3cd';
      ctx.fillRect(s.at - s.length / 2, -sw / 2, s.length, sw);
      ctx.fillStyle = ov.line === 'MRT-3' ? '#2563eb' : '#16a34a';
      ctx.fillRect(s.at - s.length / 2, -sw / 2, s.length, 0.9);
      ctx.fillRect(s.at - s.length / 2, sw / 2 - 0.9, s.length, 0.9);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      for (let x = s.at - s.length / 2 + 2; x < s.at + s.length / 2; x += 2) {
        ctx.moveTo(x, -sw / 2 + 0.9);
        ctx.lineTo(x, sw / 2 - 0.9);
      }
      ctx.stroke();
      worldText(ctx, s.name, s.at, 0, 1.25, '#1f2937');
    }
    // A train now and then
    const period = 70;
    const ph = (time % period) / period;
    if (ph < 0.45) {
      const len = 3 * 13;
      const x = from + (to - from + len) * (ph / 0.45) - len;
      const ty = ov.line === 'MRT-3' ? -w / 4 : w / 4;
      for (let c = 0; c < 3; c++) {
        const cx = x + c * 13;
        ctx.fillStyle = ov.line === 'MRT-3' ? '#e5e7eb' : '#f3f4f6';
        ctx.fillRect(cx, ty - 1.4, 12.4, 2.8);
        ctx.fillStyle = ov.line === 'MRT-3' ? '#1d4ed8' : '#15803d';
        ctx.fillRect(cx, ty - 0.35, 12.4, 0.7);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawFootbridge(ctx, ov) {
    const net = this.network;
    // Span the road at this position: find the widest road crossing the line.
    let half = 10;
    let centre = 0;
    for (const I of net.intersections) {
      for (const arm of this._arms(I)) {
        const o = DIRS[arm];
        const alongX = o.x !== 0;
        if (alongX !== (ov.axis === 'x')) continue;
        half = Math.max(half, I.arms[arm].half);
        centre = alongX ? I.y : I.x;
      }
    }
    const span = half + SW;
    ctx.save();
    ctx.globalAlpha = 0.9;
    const draw = (x, y, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 0.8, y + 1.0, w, h);
      ctx.fillStyle = '#8f969c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#c7ccd1';
      ctx.fillRect(x + 0.2, y + 0.2, w - 0.4, h - 0.4);
    };
    if (ov.axis === 'x') {
      draw(ov.at - 1.4, centre - span, 2.8, 2 * span);
      ctx.fillStyle = '#1e40af';
      ctx.fillRect(ov.at - 1.4, centre - 1.2, 2.8, 2.4);
    } else {
      draw(centre - span, ov.at - 1.4, 2 * span, 2.8);
    }
    ctx.restore();
  }
}
