// Visual feedback layered around vehicles: horn rings and text, box-blocking warnings, emergency
// strobe glow, long-wait heat, "click me" badges on stuck vehicles, the emergency pointer (a callout
// on the vehicle, or an arrow at the screen edge when it is off screen) and the optional reservation
// debug overlay.

import { worldText } from './RoadRenderer.js';
import { AI_STATE } from '../simulation/Vehicle.js';

const SMOKY = new Set(['jeepney', 'truck', 'bus', 'dumptruck', 'tanker', 'tricycle']);

export class EffectsRenderer {
  constructor() {
    this.puffs = [];
    this.lastTime = 0;
  }

  /** Old diesels puff black smoke when they pull away. */
  drawSmoke(ctx, vehicles, time) {
    const dt = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    for (const v of vehicles) {
      if (!SMOKY.has(v.type) || v.a < 0.7 || v.v > 7) continue;
      v._puff = (v._puff || 0) - dt;
      if (v._puff > 0) continue;
      v._puff = 0.18 + ((v.id * 37) % 10) / 40;
      const c = Math.cos(v.angle);
      const s = Math.sin(v.angle);
      this.puffs.push({ x: v.x - c * (v.hl + 0.3) + s * 0.4, y: v.y - s * (v.hl + 0.3) - c * 0.4, t: 0, dark: v.type === 'jeepney' || v.type === 'dumptruck' });
    }
    if (this.puffs.length > 300) this.puffs.splice(0, this.puffs.length - 300);
    const keep = [];
    for (const p of this.puffs) {
      p.t += dt;
      if (p.t > 1.6) continue;
      keep.push(p);
      const k = p.t / 1.6;
      ctx.fillStyle = p.dark ? `rgba(40,40,40,${0.35 * (1 - k)})` : `rgba(120,120,120,${0.25 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(p.x + k * 0.8, p.y - k * 0.6, 0.35 + k * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    this.puffs = keep;
  }

  drawUnder(ctx, vehicles, time) {
    for (const v of vehicles) {
      if (v.stoppedTime > 12 && !v.emergency) {
        const k = Math.min(1, (v.stoppedTime - 12) / 40);
        ctx.fillStyle = `rgba(239,68,68,${0.1 + 0.22 * k})`;
        ctx.beginPath();
        ctx.ellipse(v.x, v.y, v.hl + 0.7, v.hw + 0.7, v.angle, 0, Math.PI * 2);
        ctx.fill();
      }
      if (v.emergency) {
        const on = Math.floor(time * 6) % 2 === 0;
        ctx.fillStyle = on ? 'rgba(239,68,68,0.22)' : 'rgba(59,130,246,0.22)';
        ctx.beginPath();
        ctx.arc(v.x, v.y, v.hl + 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawOver(ctx, vehicles, time) {
    for (const v of vehicles) {
      if (v.state === AI_STATE.BLOCKED_IN_INTERSECTION) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 6);
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.angle);
        ctx.strokeStyle = `rgba(239,68,68,${0.45 + 0.5 * pulse})`;
        ctx.lineWidth = 0.28;
        ctx.strokeRect(-v.hl - 0.35, -v.hw - 0.35, 2 * v.hl + 0.7, 2 * v.hw + 0.7);
        ctx.restore();
      }
      if (v.hornFlash > 0) {
        const maxF = v.spec.bigHorn ? 0.9 : 0.55;
        const p = 1 - v.hornFlash / maxF;
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.angle);
        for (let k = 0; k < 3; k++) {
          const r = 0.7 + k * 0.75 + p * 1.2;
          ctx.strokeStyle = `rgba(255,214,10,${Math.max(0, 0.9 - p - k * 0.2)})`;
          ctx.lineWidth = 0.2;
          ctx.beginPath();
          ctx.arc(v.hl, 0, r, -0.75, 0.75);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // Horn text bubbles (screen-aligned)
    for (const v of vehicles) {
      if (v.hornFlash > 0 && v.hornText) {
        const y = v.y - v.hl - 2.2;
        const w = v.hornText.length * 0.72 + 1.2;
        ctx.fillStyle = 'rgba(17,24,39,0.82)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(v.x - w / 2, y - 0.9, w, 1.8, 0.6) : ctx.rect(v.x - w / 2, y - 0.9, w, 1.8);
        ctx.fill();
        worldText(ctx, v.hornText, v.x, y + 0.02, 1.15, '#ffd60a');
      } else if (v.sayTimer > 0 && v.say) {
        // Passengers calling a stop ("PARA PO!") while a jeepney drops off at the corner
        const y = v.y - v.hl - 2.2;
        const w = v.say.length * 0.72 + 1.2;
        ctx.globalAlpha = Math.min(1, v.sayTimer / 0.4);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(v.x - w / 2, y - 0.9, w, 1.8, 0.6) : ctx.rect(v.x - w / 2, y - 0.9, w, 1.8);
        ctx.fill();
        worldText(ctx, v.say, v.x, y + 0.02, 1.15, '#166534');
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Badges for stuck vehicles the player can wave through, and a GO arrow on those waved through. */
  drawStuck(ctx, sim, vehicles, time) {
    for (const v of vehicles) {
      const pass = sim.hasPass(v);
      // A violator the player can catch (HULI!) gets a red badge
      const bad = sim.enforcement.violationOf(v);
      if (!pass && !bad && !(v.stoppedTime > 3 && sim.isStuck(v))) continue;
      const y = v.y - v.hl - 1.6;
      const pulse = 0.5 + 0.5 * Math.sin(time * 5 + v.seq);
      ctx.fillStyle = bad ? `rgba(220,38,38,${0.8 + 0.2 * pulse})` : pass ? 'rgba(34,197,94,0.95)' : `rgba(245,158,11,${0.75 + 0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(v.x, y, 1.05 + (pass ? 0 : 0.15 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(17,24,39,0.8)';
      ctx.lineWidth = 0.14;
      ctx.stroke();
      worldText(ctx, bad ? '!' : pass ? 'GO' : '!', v.x, y + 0.04, pass && !bad ? 0.85 : 1.3, bad ? '#ffffff' : '#111827');
    }
  }

  /** Traffic enforcers at their posts: blue uniform, white cap, an arm waving traffic on. */
  drawEnforcers(ctx, sim, time, showReach) {
    for (const p of sim.enforcement.posts.values()) {
      if (showReach) {
        ctx.strokeStyle = 'rgba(59,130,246,0.55)';
        ctx.lineWidth = 0.3;
        ctx.setLineDash([1.5, 1.2]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const wave = p.wave > 0 ? Math.sin(time * 14) * 0.9 : Math.sin(time * 2.2) * 0.35;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(2.4, 2.4);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0.12, 0.15, 0.45, 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // arm with the white glove
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(0.2, 0);
      ctx.lineTo(0.2 + Math.cos(wave) * 0.55, Math.sin(wave) * 0.55);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0.2 + Math.cos(wave) * 0.6, Math.sin(wave) * 0.6, 0.09, 0, Math.PI * 2);
      ctx.fill();
      // body (blue uniform, reflective vest stripe) and white cap
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.32, 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d9f99d';
      ctx.fillRect(-0.06, -0.22, 0.12, 0.44);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(0, 0, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      worldText(ctx, '👮', p.x, p.y - 2.2, 1.6, '#fff');
    }
  }

  /**
   * Screen-space pointer for each emergency vehicle (ctx in CSS pixels). `info(v)` returns
   * { title, line, ok } for the callout.
   */
  drawEmergencyPointers(ctx, sim, cam, time, info) {
    const ins = cam.insets;
    const pad = 14;
    const left = ins.left + pad;
    const right = cam.w - ins.right - pad;
    const top = ins.top + pad;
    const bottom = cam.h - ins.bottom - pad;
    for (const v of sim.vehicles) {
      if (!v.emergency || v.emergencyDone) continue;
      const d = info(v);
      if (!d) continue;
      const p = cam.worldToScreen(v.x, v.y);
      const on = p.x > left && p.x < right && p.y > top && p.y < bottom;
      const strobe = Math.floor(time * 4) % 2 === 0;
      const accent = d.ok ? '#22c55e' : strobe ? '#ef4444' : '#3b82f6';
      ctx.save();
      ctx.font = '700 12px system-ui, sans-serif';
      const w = Math.max(ctx.measureText(d.title).width, ctx.measureText(d.line).width) + 20;
      const h = 40;
      let bx;
      let by;
      let tip;
      if (on) {
        // Callout above the vehicle (below it near the top edge), tail pointing at it.
        const above = p.y - 30 - h > top;
        bx = Math.min(right - w, Math.max(left, p.x - w / 2));
        by = above ? p.y - 30 - h : p.y + 30;
        tip = { x: p.x, y: above ? p.y - 12 : p.y + 12, bx: Math.min(bx + w - 12, Math.max(bx + 12, p.x)), by: above ? by + h : by };
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16 + 3 * Math.sin(time * 6), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Off screen: a marker on the edge, pointing toward the vehicle.
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const k = Math.min((right - left - 24) / 2 / Math.max(1e-6, Math.abs(dx)), (bottom - top - 24) / 2 / Math.max(1e-6, Math.abs(dy)));
        const ex = cx + dx * k;
        const ey = cy + dy * k;
        const ang = Math.atan2(dy, dx);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(ang) * 16, ey + Math.sin(ang) * 16);
        ctx.lineTo(ex + Math.cos(ang + 2.5) * 13, ey + Math.sin(ang + 2.5) * 13);
        ctx.lineTo(ex + Math.cos(ang - 2.5) * 13, ey + Math.sin(ang - 2.5) * 13);
        ctx.closePath();
        ctx.fill();
        bx = Math.min(right - w, Math.max(left, ex - w / 2 - Math.cos(ang) * (w / 2 + 10)));
        by = Math.min(bottom - h, Math.max(top, ey - h / 2 - Math.sin(ang) * (h / 2 + 12)));
        tip = null;
      }
      ctx.fillStyle = 'rgba(15,23,42,0.92)';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, w, h, 8) : ctx.rect(bx, by, w, h);
      ctx.fill();
      ctx.stroke();
      if (tip) {
        ctx.beginPath();
        ctx.moveTo(tip.bx - 7, tip.by);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(tip.bx + 7, tip.by);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'top';
      ctx.fillText(d.title, bx + 10, by + 6);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = d.ok ? '#86efac' : '#fde68a';
      ctx.fillText(d.line, bx + 10, by + 22);
      ctx.restore();
    }
  }

  /**
   * Speed heatmap: each lane coloured by how fast its traffic moves (smoothed), red when stopped,
   * green at free flow. Empty lanes fade back to nothing.
   */
  drawHeat(ctx, sim, dt) {
    const k = Math.min(1, dt / 1.5);
    for (const lane of sim.network.lanes) {
      const list = lane.vehicles;
      let target = null;
      if (list.length) {
        let sum = 0;
        let max = 0;
        for (const v of list) {
          sum += v.v;
          max += v.spec.maxSpeed * 0.8;
        }
        target = Math.min(1, sum / Math.max(1e-6, max));
      }
      if (lane._heat === undefined) lane._heat = { v: 1, a: 0 };
      const h = lane._heat;
      h.a += ((target === null ? 0 : 1) - h.a) * k;
      if (target !== null) h.v += (target - h.v) * k;
      if (h.a < 0.03) continue;
      const hue = Math.round(120 * h.v);
      ctx.strokeStyle = `hsla(${hue},90%,50%,${0.5 * h.a})`;
      ctx.lineWidth = (lane.width || 3.5) * 0.8;
      ctx.lineCap = 'butt';
      const P = lane.path;
      ctx.beginPath();
      ctx.moveTo(P.xs[0], P.ys[0]);
      for (let i = 1; i < P.n; i++) ctx.lineTo(P.xs[i], P.ys[i]);
      ctx.stroke();
    }
  }

  /** Queue length label at every approach (stopped vehicles plus those still to arrive). */
  drawQueueCounts(ctx, sim) {
    for (const p of sim.metrics.perIntersection || []) {
      const I = sim.network.byId.get(p.id);
      if (I.kind === 'uturn') continue;
      for (const a of p.approaches) {
        if (!a.queue) continue;
        const A = I.arms[a.arm];
        const pt = A.center.point(Math.min(A.stop + 9, A.center.length - 1), -(A.half / 2 + A.median / 4));
        const txt = String(a.queue);
        const w = txt.length * 0.9 + 1.8;
        ctx.fillStyle = a.headBlocked ? 'rgba(220,38,38,0.92)' : a.queue > 12 ? 'rgba(217,119,6,0.92)' : 'rgba(15,23,42,0.85)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(pt.x - w / 2, pt.y - 1.1, w, 2.2, 1) : ctx.rect(pt.x - w / 2, pt.y - 1.1, w, 2.2);
        ctx.fill();
        worldText(ctx, txt, pt.x, pt.y + 0.05, 1.5, '#fff');
      }
    }
  }

  drawReservations(ctx, sim) {
    for (const mgr of sim.imgr.values()) {
      mgr.forEachReserved((x, y, size, owners) => {
        const o = owners[0];
        // Pedestrian crossings in white, vehicle paths in a colour per vehicle.
        ctx.fillStyle = o.isPed ? 'rgba(255,255,255,0.45)' : `hsla(${(o.id * 67) % 360},85%,55%,${owners.length > 1 ? 0.55 : 0.32})`;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      });
    }
    for (const lane of sim.network.lanes) {
      if (!lane.keepClear.size) continue;
      for (const limit of lane.keepClear.values()) {
        const p = lane.path.pointAt(limit, { x: 0, y: 0, dx: 0, dy: 0 });
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
