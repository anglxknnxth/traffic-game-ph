// Static world: ground, sidewalks, asphalt, medians, markings and roadside scenery (drawn once per
// camera change), dynamic road overlays (signal stop-line bars, downstream gates, blockages) and
// elevated structures drawn over traffic (MRT/LRT guideways, footbridges).
//
// Everything is driven by the network geometry: each arm has its own road half-width, median,
// stop line and lane types, so wide avenues, T-junctions and U-turn slots draw correctly. Roads are
// drawn as bands along each arm's centre line, so bends and S-curves follow the lanes exactly.

import { Rng, makeObb, setObb, obbOverlap } from '../utils/math.js';
import { strip, addLine, dashes, withFrame, at } from './roadShapes.js';
import { ARMS, DIRS, LANE_WIDTH, CROSSWALK_WIDTH, SIDEWALK_WIDTH, CURB_RADIUS, LOADING_ZONE_S } from '../data/config.js';
import { rightOf, leftOf } from '../simulation/LaneManager.js';

const SW = SIDEWALK_WIDTH;
const LW = LANE_WIDTH;

const COLORS = {
  ground: '#52603f',
  sidewalk: '#b8b1a2',
  curb: '#dcd5c5',
  asphalt: '#3a3d43',
  white: 'rgba(240,240,236,0.92)',
  yellow: '#f2c230',
  busTint: 'rgba(242,194,48,0.13)',
  motoTint: 'rgba(37,99,235,0.32)',
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

function armFrame(ctx, I, arm) {
  const o = DIRS[arm];
  ctx.translate(I.x, I.y);
  ctx.rotate(Math.atan2(o.y, o.x));
}

export function worldText(ctx, text, x, y, size, color, angle = 0, align = 'center', weight = 700) {
  ctx.save();
  ctx.translate(x, y);
  // Keep labels readable: never draw text upside down, whatever frame we are in.
  const t = ctx.getTransform();
  if (Math.cos(Math.atan2(t.b, t.a) + angle) < -0.1) angle += Math.PI;
  if (angle) ctx.rotate(angle);
  const k = size / 20;
  ctx.scale(k, k);
  ctx.font = `${weight} 20px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export class RoadRenderer {
  constructor(network) {
    this.network = network;
    this.theme = THEMES[network.map.theme] || THEMES.default;
    this.scenery = this._generateScenery();
  }

  _arms(I) {
    return ARMS.filter((a) => I.arms[a].type !== 'none');
  }

  /** Half-width of the road crossing arm `arm` at node I (where corners and frontage begin). */
  _cross(I, arm) {
    return arm === 'N' || arm === 'S' ? I.hy : I.hx;
  }

  _hasCorner(I, adjacent) {
    return I.kind !== 'uturn' && adjacent && I.arms[adjacent].type !== 'none';
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
    const b = net.bounds;
    const area = { minX: b.minX - 30, maxX: b.maxX + 30, minY: b.minY - 30, maxY: b.maxY + 30 };
    const buildings = [];
    const trees = [];
    const sheds = [];
    const posts = [];
    const detail = () => Array.from({ length: rng.int(0, 3) }, () => ({ u: rng.range(0.2, 0.8), v: rng.range(0.2, 0.8), kind: rng.chance(0.5) ? 'tank' : 'ac' }));

    // Frontage buildings along every arm (both sides), shops near intersections.
    for (const I of net.intersections) {
      for (const arm of this._arms(I)) {
        const A = I.arms[arm];
        const g = this._g(I, arm);
        const len = Math.min(armLength(net, I, arm), 170);
        const start = I.kind === 'uturn' ? 0.5 : this._cross(I, arm) + SW + 1.2;
        for (const sgn of [-1, 1]) {
          let t = start;
          while (t < len) {
            const width = rng.range(7, 15);
            const depth = rng.range(9, 17);
            const off = A.half + SW + 0.8 + depth / 2;
            const c = at(g, t + width / 2, sgn * off);
            const r = box(c.x, c.y, width, depth, c.angle);
            if (!hits(r, corridors, 0.6) && !hits(r, buildings, 0.9)) {
              const nearCorner = t < 55;
              buildings.push({
                ...r,
                color: rng.pick(T.roofs),
                ribbed: rng.chance(0.55),
                details: detail(),
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
            if (rng.chance(0.75)) trees.push({ x: q.x, y: q.y, r: rng.range(1.3, 1.9), shade: rng.range(0, 1) });
            else posts.push({ x: q.x, y: q.y });
            st += rng.range(9, 15);
          }
        }
        // Waiting shed at the jeepney loading zone on external exits
        if (A.type === 'external') {
          const q = at(g, A.exitStop + LOADING_ZONE_S - 6, A.half + SW - 1.5);
          sheds.push({ x: q.x, y: q.y, angle: q.angle, color: rng.pick(['#2563eb', '#16a34a', '#dc2626']) });
        }
      }
    }
    // Fill remaining blocks
    for (let i = 0; i < T.fill; i++) {
      const wx = rng.range(8, 20);
      const wy = rng.range(8, 20);
      const cx = rng.range(area.minX, area.maxX);
      const cy = rng.range(area.minY, area.maxY);
      const r = box(cx, cy, wx, wy, 0);
      if (hits(r, corridors, 2) || hits(r, buildings, 1.4)) continue;
      buildings.push({ ...r, color: rng.pick(T.roofs), ribbed: rng.chance(0.5), details: detail(), shop: null });
    }
    // Scattered trees in lots
    for (let i = 0; i < T.trees; i++) {
      const x = rng.range(area.minX, area.maxX);
      const y = rng.range(area.minY, area.maxY);
      const r = box(x, y, 4, 4, 0);
      if (hits(r, corridors, 0.5) || hits(r, buildings, 0.3)) continue;
      trees.push({ x, y, r: rng.range(1.6, 2.6), shade: rng.range(0, 1) });
    }
    return { buildings, trees, sheds, posts, area };
  }

  // ------------------------------------------------------------------ static drawing
  drawStatic(ctx) {
    const net = this.network;
    const a = this.scenery.area;
    const R = CURB_RADIUS;
    ctx.fillStyle = this.theme.ground;
    ctx.fillRect(a.minX - 400, a.minY - 400, a.maxX - a.minX + 800, a.maxY - a.minY + 800);

    const eachArm = (fn) => {
      for (const I of net.intersections) {
        for (const arm of this._arms(I)) fn(I, arm, I.arms[arm], armLength(net, I, arm), this._g(I, arm));
      }
    };
    const p1 = {};
    const p2 = {};

    // Sidewalks
    ctx.fillStyle = COLORS.sidewalk;
    eachArm((I, arm, A, len, g) => strip(ctx, g, 0, len, -(A.half + SW), A.half + SW));
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
    });
    // Asphalt
    ctx.fillStyle = COLORS.asphalt;
    eachArm((I, arm, A, len, g) => strip(ctx, g, 0, len, -A.half, A.half));
    // Rounded curbs where two roads meet
    for (const I of net.intersections) {
      if (I.kind === 'uturn') continue;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          if (I.arms[sx > 0 ? 'E' : 'W'].type === 'none' || I.arms[sy > 0 ? 'S' : 'N'].type === 'none') continue;
          const cx = I.x + sx * (I.hx + R);
          const cy = I.y + sy * (I.hy + R);
          ctx.fillStyle = COLORS.asphalt;
          ctx.fillRect(Math.min(I.x, cx), Math.min(I.y, cy), Math.abs(cx - I.x), Math.abs(cy - I.y));
          ctx.fillStyle = COLORS.sidewalk;
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
      for (let i = 0; i < 40; i++) {
        const arm = rng.pick(ARMS);
        const A = I.arms[arm];
        if (A.type === 'none') continue;
        const x = Math.min(rng.range(A.stop, 90), armLength(net, I, arm) - 2);
        const y = rng.range(-A.half + 1, A.half - 1);
        const rx = rng.range(0.6, 2.2);
        const ry = rng.range(0.3, 1.0);
        const rot = rng.range(0, 3);
        withFrame(ctx, this._g(I, arm), x, y, () => {
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, rot, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    // Medians
    eachArm((I, arm, A, len, g) => this._drawMedian(ctx, I, A, len, g));

    for (const I of net.intersections) this._drawNodeMarkings(ctx, I);
    this._drawScenery(ctx);
  }

  _medianStart(I, A) {
    if (I.kind === 'uturn') return A.stop;
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
    ctx.fillStyle = style === 'grass' ? COLORS.medianGrass : COLORS.median;
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

    const q = {};
    for (const arm of this._arms(I)) {
      const A = I.arms[arm];
      const g = this._g(I, arm);
      const len = armLength(net, I, arm);
      const m = A.median;
      const h = A.half;
      const p = A.profile;
      const xs = A.stop + 0.6;
      const lanes = I.approachLanes[arm] || [];
      const exits = I.exitLanes[arm] || [];

      // ---- Markings that run the length of the arm (they follow its bends)
      // Centre: double yellow on undivided roads
      if (m < 0.3) {
        ctx.fillStyle = COLORS.yellow;
        strip(ctx, g, xs, len, -0.27, -0.14);
        strip(ctx, g, xs, len, 0.14, 0.27);
      }
      // Dedicated lane tints and legends
      const laneStrip = (k, sign) => [sign * (m / 2 + LW * (k + 1)), sign * (m / 2 + LW * k)];
      for (const [list, sign] of [
        [lanes, -1],
        [exits, 1],
      ]) {
        for (const lane of list) {
          if (lane.type === 'general') continue;
          const [ya, yb] = laneStrip(lane.laneIndex, sign);
          ctx.fillStyle = lane.type === 'bus' ? COLORS.busTint : COLORS.motoTint;
          strip(ctx, g, xs, len, Math.min(ya, yb), Math.min(ya, yb) + LW);
          const label = lane.type === 'bus' ? 'BUS LANE' : 'MOTORCYCLE LANE';
          for (let x = xs + 22; x < len - 10; x += 48) {
            at(g, x, sign * lane.offset, q);
            worldText(ctx, label, q.x, q.y, lane.type === 'bus' ? 1.25 : 0.95, lane.type === 'bus' ? 'rgba(242,194,48,0.85)' : 'rgba(255,255,255,0.8)', q.angle);
          }
        }
      }
      // Edge lines
      ctx.fillStyle = COLORS.white;
      strip(ctx, g, xs, len, -h + 0.25, -h + 0.37);
      strip(ctx, g, xs, len, h - 0.37, h - 0.25);
      // Lane dividers. Approach: solid near the stop line, dashed further out. Exit: dashed.
      // Lines next to a dedicated lane are solid (yellow for the busway).
      const divider = (y, approach, special) => {
        ctx.fillStyle = special === 'bus' ? COLORS.yellow : COLORS.white;
        if (special) {
          strip(ctx, g, xs - 0.15, len, y - 0.07, y + 0.07);
          return;
        }
        if (approach) {
          strip(ctx, g, A.stop + 0.45, A.stop + 18.45, y - 0.06, y + 0.06);
          dashes(ctx, g, A.stop + 22, len, y, 3, 7, 0.12);
        } else {
          dashes(ctx, g, A.exitStop + 1.5, len, y, 3, 7, 0.12);
        }
      };
      for (let k = 0; k < p.lanes - 1; k++) {
        const special = (t1, t2) => (t1 === 'bus' || t2 === 'bus' ? 'bus' : t1 === 'moto' || t2 === 'moto' ? 'moto' : null);
        const sp = special(p.types[k], p.types[k + 1]);
        divider(-(m / 2 + LW * (k + 1)), true, sp);
        divider(m / 2 + LW * (k + 1), false, sp);
      }

      // ---- Markings near the junction (always on the straight lead)
      ctx.save();
      armFrame(ctx, I, arm);
      // Through-lane guides across a U-turn slot
      if (I.kind === 'uturn') {
        ctx.fillStyle = 'rgba(240,240,236,0.5)';
        for (let k = 0; k < p.lanes - 1; k++) {
          for (const y of [-(m / 2 + LW * (k + 1)), m / 2 + LW * (k + 1)]) for (let x = 0.5; x < A.stop; x += 3) ctx.fillRect(x, y - 0.05, 1.4, 0.1);
        }
      }

      const minor = I.kind === 'yield' && !I.major.has(arm);
      // Stop line across approach lanes (none for through traffic at U-turn slots or on a major road)
      if (I.kind === 'signal' || minor) {
        ctx.fillStyle = COLORS.white;
        ctx.fillRect(A.stop, -h + 0.2, 0.45, h - m / 2 - 0.45);
        if (minor) worldText(ctx, 'STOP', A.stop + 3.2, -(m / 2 + (h - m / 2) / 2), 1.6, COLORS.white, Math.PI / 2);
      }
      // Zebra crossing
      if (A.cwStart != null) {
        ctx.fillStyle = COLORS.white;
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
          const y0 = lane.offset - LW / 2 + 0.25;
          const y1 = lane.offset + LW / 2 - 0.35;
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

  _drawScenery(ctx) {
    const { buildings, trees, sheds, posts } = this.scenery;
    for (const b of buildings) {
      const w = b.w;
      const h = b.h;
      const minX = -w / 2;
      const minY = -h / 2;
      const maxX = w / 2;
      const maxY = h / 2;
      ctx.save();
      ctx.translate(b.cx + 0.5, b.cy + 0.7);
      ctx.rotate(b.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(minX, minY, w, h);
      ctx.restore();
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(minX, minY, w, h);
      if (b.ribbed) {
        ctx.strokeStyle = 'rgba(0,0,0,0.13)';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        if (w > h) for (let x = minX + 0.6; x < maxX; x += 0.6) { ctx.moveTo(x, minY); ctx.lineTo(x, maxY); }
        else for (let y = minY + 0.6; y < maxY; y += 0.6) { ctx.moveTo(minX, y); ctx.lineTo(maxX, y); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.2;
      ctx.strokeRect(minX, minY, w, h);
      for (const d of b.details) {
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
        // Sign on the roof edge
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
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.arc(t.x + 0.5, t.y + 0.6, t.r, 0, Math.PI * 2);
      ctx.fill();
      const g = Math.round(110 + t.shade * 40);
      ctx.fillStyle = `rgb(${40 + Math.round(t.shade * 20)},${g},${50 + Math.round(t.shade * 15)})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ dynamic overlays
  drawDynamic(ctx, sim, time) {
    const net = this.network;
    // Signal colour on each stop line
    for (const I of net.intersections) {
      if (I.kind !== 'signal') continue;
      for (const arm of ARMS) {
        if (!I.approachLanes[arm]) continue;
        const A = I.arms[arm];
        const sig = sim.lights.signal(I.id, arm);
        ctx.save();
        armFrame(ctx, I, arm);
        ctx.fillStyle = sig === 'green' ? 'rgba(34,197,94,0.75)' : sig === 'yellow' ? 'rgba(250,204,21,0.85)' : 'rgba(239,68,68,0.75)';
        ctx.fillRect(A.stop - 0.72, -A.half + 0.2, 0.5, A.half - A.median / 2 - 0.45);
        ctx.restore();
      }
    }
    // Downstream discharge points (next junction) on jammed exits
    for (const lane of net.exitLanes) {
      if (!lane.gateVisible) continue;
      const I = lane.startInt;
      const A = I.arms[lane.startArm];
      const g = this._g(I, lane.startArm);
      const x = A.exitStop + lane.gateLocal + 0.3;
      const open = lane.gate.tokens >= 1;
      withFrame(ctx, g, x, lane.offset, () => {
        ctx.fillStyle = 'rgba(240,240,236,0.85)';
        ctx.fillRect(0, -LW / 2 + 0.2, 0.4, LW - 0.4);
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
    // Blockages: cones + barrier + label
    for (const b of sim.blockages) {
      if (!b.active || b.kind === 'ped') continue;
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
      if (ov.kind === 'rail') this._drawRail(ctx, ov, b, time);
      else if (ov.kind === 'footbridge') this._drawFootbridge(ctx, ov);
    }
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
