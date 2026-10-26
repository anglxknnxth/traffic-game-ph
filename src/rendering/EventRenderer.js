// Overlays for the boss events and the calendar: the VIP motorcade's route, the ring on a fleeing
// getaway car, and parol lanterns on the street lamps at Christmas.

import { drawPedestrians } from './PedestrianRenderer.js';
import { SIDEWALK_WIDTH } from '../data/config.js';
import { worldText } from './RoadRenderer.js';
import { rightOf } from '../simulation/LaneManager.js';

const _p = {};
const _q = {};

/**
 * Footbridges (a deck over the traffic, with the people walking on it) and pedestrian underpasses
 * (stair openings on both sidewalks). Drawn after the vehicles.
 */
export function drawCrossovers(ctx, sim, vr) {
  const list = sim.peds?.crossovers;
  if (!list?.length) return;
  ctx.save();
  for (const c of list) {
    const reach = c.A.half + SIDEWALK_WIDTH * 0.75;
    c.A.center.point(c.u, -reach, _p);
    c.A.center.point(c.u, reach, _q);
    if (Math.max(_p.x, _q.x) < vr.minX || Math.min(_p.x, _q.x) > vr.maxX || Math.max(_p.y, _q.y) < vr.minY || Math.min(_p.y, _q.y) > vr.maxY) continue;
    const ax = Math.cos(_p.angle);
    const ay = Math.sin(_p.angle);
    if (c.kind === 'bridge') {
      // shadow, deck, railings
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(_p.x + 1.2, _p.y + 1.6);
      ctx.lineTo(_q.x + 1.2, _q.y + 1.6);
      ctx.stroke();
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(_p.x, _p.y);
      ctx.lineTo(_q.x, _q.y);
      ctx.stroke();
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 0.22;
      for (const s of [-1.2, 1.2]) {
        ctx.beginPath();
        ctx.moveTo(_p.x + ax * s, _p.y + ay * s);
        ctx.lineTo(_q.x + ax * s, _q.y + ay * s);
        ctx.stroke();
      }
    }
    // stairs at both ends, along the sidewalk
    ctx.fillStyle = c.kind === 'bridge' ? '#6b7280' : '#1f2937';
    for (const e of [_p, _q]) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      ctx.fillRect(-2.2, -0.75, 4.4, 1.5);
      ctx.fillStyle = c.kind === 'bridge' ? '#d1d5db' : '#111827';
      for (let k = -2; k <= 2; k += 0.6) ctx.fillRect(k, -0.7, 0.12, 1.4);
      ctx.restore();
    }
  }
  ctx.restore();
  drawPedestrians(ctx, sim.peds.peds, sim.env?.rain || 0, vr, true);
}
const PAROL = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ec4899'];

/**
 * Hula overlay: approaches forecast to fill up glow along their last stretch before the stop line,
 * pulsing faster the sooner it happens, with the seconds left next to the road.
 */
export function drawForecast(ctx, sim, time) {
  const items = sim.forecast?.items;
  if (!items?.length) return;
  ctx.save();
  ctx.lineCap = 'butt';
  for (const it of items) {
    const urgent = it.inS < 20;
    const rgb = urgent ? '239,68,68' : it.inS < 60 ? '249,115,22' : '250,204,21';
    const pulse = 0.55 + 0.45 * Math.sin(time * (urgent ? 9 : 4));
    for (const lane of it.lanes) {
      const path = lane.path;
      const from = Math.max(0, path.length - Math.min(path.length, 70));
      ctx.strokeStyle = `rgba(${rgb},${(0.18 + 0.22 * pulse).toFixed(3)})`;
      ctx.lineWidth = (lane.width || 3.5) * 0.85;
      ctx.beginPath();
      for (let s = from; s <= path.length; s += 4) {
        path.pointAt(Math.min(s, path.length), _p);
        if (s === from) ctx.moveTo(_p.x, _p.y);
        else ctx.lineTo(_p.x, _p.y);
      }
      ctx.stroke();
    }
    const lane = it.lanes[it.lanes.length - 1];
    lane.path.pointAt(Math.max(0, lane.path.length - 26), _p);
    const n = rightOf({ x: _p.dx, y: _p.dy });
    const tx = _p.x + n.x * (lane.width + 3.5);
    const ty = _p.y + n.y * (lane.width + 3.5);
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(tx - 5.2, ty - 1.4, 10.4, 2.8);
    worldText(ctx, it.inS < 1 ? '🔮 PUNO NA' : `🔮 ~${Math.round(it.inS)}s`, tx, ty + 0.05, 1.5, `rgb(${rgb})`);
  }
  ctx.restore();
}

/** SUNOG: flames licking out of the burning building and a column of smoke drifting off. */
export function drawFires(ctx, sim, time) {
  const fires = sim.scenarios?.active.filter((e) => e.kind === 'fire');
  if (!fires?.length) return;
  ctx.save();
  for (const f of fires) {
    // smoke: puffs rising and spreading with time
    for (let i = 0; i < 7; i++) {
      const k = (time * 0.35 + i / 7) % 1;
      const r = 2.5 + k * 7;
      ctx.fillStyle = `rgba(60,60,64,${(0.45 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(f.x + k * 9 + Math.sin(i * 2.1) * 2, f.y - k * 14, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // flames: flickering tongues of orange and yellow
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + time * 1.3;
      const fl = 1.4 + 0.8 * Math.abs(Math.sin(time * 9 + i * 1.7));
      ctx.fillStyle = i % 2 ? '#f97316' : '#facc15';
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * 1.6, f.y + Math.sin(a) * 1.6, fl, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 1.5 + 0.4 * Math.sin(time * 11), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Dashed gold line along every VIP convoy's route (under the vehicles). */
export function drawVipRoutes(ctx, sim, time) {
  const routes = sim.boss?.routes();
  if (!routes?.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
  ctx.lineWidth = 0.7;
  ctx.setLineDash([2.4, 1.8]);
  ctx.lineDashOffset = -time * 6;
  ctx.lineCap = 'round';
  for (const r of routes) {
    ctx.beginPath();
    let first = true;
    for (const e of r.entries) {
      const path = e.seg.path;
      for (let s = 0; s <= path.length; s += 3) {
        path.pointAt(Math.min(s, path.length), _p);
        if (first) ctx.moveTo(_p.x, _p.y);
        else ctx.lineTo(_p.x, _p.y);
        first = false;
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A pulsing ring on each getaway car still on the run (red; green once it is cornered). */
export function drawChase(ctx, sim, time) {
  const chases = sim.boss?.chases;
  if (!chases?.length) return;
  ctx.save();
  for (const c of chases) {
    const v = c.item.vehicle;
    if (!v || c.done || !sim.vehicles.includes(v)) continue;
    const k = (time * 2) % 1;
    ctx.strokeStyle = v.cornered ? `rgba(34, 197, 94, ${1 - k})` : `rgba(239, 68, 68, ${1 - k})`;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(v.x, v.y, 3 + k * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Parol on the street lamps after dark, from December 1 to Christmas Day. */
export function drawParols(ctx, sim, posts, time, vr) {
  const cal = sim.env?.rushHour ? sim.env.calendar : null;
  if (!cal || !posts?.length || sim.env.darkness < 0.15) return;
  if (!(cal.has.has('christmas') || cal.has.has('simbang') || cal.has.has('pasko'))) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, sim.env.darkness * 1.4);
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (p.x < vr.minX || p.x > vr.maxX || p.y < vr.minY || p.y > vr.maxY) continue;
    const c = PAROL[i % PAROL.length];
    const tw = 0.75 + 0.25 * Math.sin(time * 3 + i);
    ctx.fillStyle = c;
    ctx.shadowColor = c;
    ctx.shadowBlur = 8 * tw;
    // five-pointed star
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.45 : 1.1;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const x = p.x + Math.cos(a) * r;
      const y = p.y + Math.sin(a) * r;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
