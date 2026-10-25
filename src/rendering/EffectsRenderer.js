// Visual feedback layered around vehicles: horn rings and text, box-blocking warnings, emergency
// strobe glow, long-wait heat and the optional reservation debug overlay.

import { worldText } from './RoadRenderer.js';
import { AI_STATE } from '../simulation/Vehicle.js';

export class EffectsRenderer {
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
        const maxF = v.spec.horn === 'bus' || v.spec.horn === 'truck' ? 0.9 : 0.55;
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
