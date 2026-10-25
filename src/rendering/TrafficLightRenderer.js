// Traffic signal heads: pole + housing with three lamps, priority rings and transition countdowns.

import { worldText } from './RoadRenderer.js';

const LAMP = {
  red: ['#ff3b30', '#4a1414'],
  yellow: ['#ffd60a', '#4a3d10'],
  green: ['#30d158', '#123d1d'],
};

export class TrafficLightRenderer {
  draw(ctx, sim, time, hovered) {
    for (const h of sim.lights.heads) {
      const mgr = sim.lights.manager(h.intersectionId);
      let sig = mgr.signalForGroup(h.group);
      // Flashing yellow: the amber lamp blinks on every head.
      if (sig === 'flash') sig = Math.floor(time * 2) % 2 === 0 ? 'yellow' : 'off';
      ctx.save();
      ctx.translate(h.x, h.y);

      // Priority request ring (emergency vehicle needs this group)
      if (mgr.priorityGroup === h.group && sig !== 'green') {
        const p = (time * 1.6) % 1;
        ctx.strokeStyle = `rgba(96,165,250,${1 - p})`;
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        ctx.arc(0, 0, 2.4 + p * 2.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (hovered === h) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.rotate(h.angle);
      // pole shadow + pole
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-1.55, -0.55, 3.3, 1.3);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(-1.7, -0.62, 3.4, 1.24);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 0.08;
      ctx.strokeRect(-1.7, -0.62, 3.4, 1.24);
      // lamps: red farthest from the box (toward -x is toward the intersection)
      const order = [
        ['red', 1.05],
        ['yellow', 0],
        ['green', -1.05],
      ];
      for (const [name, x] of order) {
        const on = sig === name;
        const [lit, dim] = LAMP[name];
        if (on) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = lit;
          ctx.beginPath();
          ctx.arc(x, 0, 0.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = on ? lit : dim;
        ctx.beginPath();
        ctx.arc(x, 0, 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Countdown during transitions
      if (mgr.state !== 'GREEN' && (mgr.activeGroup === h.group || mgr.nextGroup === h.group)) {
        const d = mgr.describe();
        if (d.countdown > 0.05) worldText(ctx, String(Math.ceil(d.countdown)), h.x, h.y - 2.4, 1.6, '#ffffff');
      }
    }
  }
}
