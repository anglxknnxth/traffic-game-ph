// Pointer, touch and keyboard input for the play field.
// Tap/click a signal head (or the box) to request a phase; drag to pan; wheel / pinch to zoom.

import { Network } from '../simulation/LaneManager.js';

/** Every (intersection, phase) pair in key order: 1, 2, ... */
export function phaseKeys(sim) {
  const out = [];
  for (const [id, m] of sim.lights.managers) for (const g of m.groups) out.push({ id, group: g });
  return out;
}

export class InputManager {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.pointers = new Map();
    this.dragDist = 0;
    this.pinchStart = null;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onCancel(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.pointers.size) this.game.setHover(null);
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hitHead(px, py) {
    const sim = this.game.sim;
    if (!sim) return null;
    const cam = this.game.camera;
    const w = cam.screenToWorld(px, py);
    const radius = Math.max(3.4, 26 / cam.scale);
    let best = null;
    let bestD = Infinity;
    for (const h of sim.lights.heads) {
      const d = Math.hypot(h.x - w.x, h.y - w.y);
      if (d < radius && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  hitBox(px, py) {
    const sim = this.game.sim;
    if (!sim) return null;
    const w = this.game.camera.screenToWorld(px, py);
    return sim.network.intersections.find((I) => sim.lights.manager(I.id) && Network.inCore(I, w.x, w.y)) || null;
  }

  onDown(e) {
    this.game.audio.unlock();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this._pos(e));
    this.dragDist = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  }

  onMove(e) {
    const p = this._pos(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const h = this.hitHead(p.x, p.y);
        this.game.setHover(h);
        this.canvas.style.cursor = h || this.hitBox(p.x, p.y) ? 'pointer' : 'grab';
      }
      return;
    }
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStart.d > 10) {
        this.game.camera.zoomAt(d / this.pinchStart.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.pinchStart.d = d;
      }
      this.dragDist += 20;
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    this.dragDist += Math.abs(dx) + Math.abs(dy);
    if (this.dragDist > 6) {
      this.game.camera.panBy(dx, dy);
      this.canvas.style.cursor = 'grabbing';
    }
  }

  onUp(e) {
    const p = this._pos(e);
    const wasTap = this.pointers.size === 1 && this.dragDist <= 6;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (!wasTap) return;
    const head = this.hitHead(p.x, p.y);
    if (head) {
      this.game.requestPhase(head.intersectionId, head.group, 'light');
      return;
    }
    const I = this.hitBox(p.x, p.y);
    if (I) {
      const m = this.game.sim.lights.manager(I.id);
      const current = m.state === 'GREEN' ? m.activeGroup : m.nextGroup || m.activeGroup;
      this.game.requestPhase(I.id, m.groups[(m.groups.indexOf(current) + 1) % m.groups.length], 'box');
    }
  }

  onCancel(e) {
    this.pointers.delete(e.pointerId);
    this.pinchStart = null;
  }

  onWheel(e) {
    e.preventDefault();
    const p = this._pos(e);
    this.game.camera.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  }

  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const g = this.game;
    g.audio.unlock();
    const k = e.key;
    if (k === 'Escape') {
      g.onEscape();
      return;
    }
    if (!g.session || g.session.ended) return;
    // 1–9: every phase of every signal in order (classic junction: 1–4 = N, E, S, W; 5+ = next junction).
    if (k >= '1' && k <= '9' && k.length === 1) {
      const p = phaseKeys(g.sim)[Number(k) - 1];
      if (p) g.requestPhase(p.id, p.group, 'key');
      return;
    }
    const arrowArm = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' }[k];
    if (arrowArm) {
      const [id, m] = [...g.sim.lights.managers][0] || [];
      const group = m?.phaseFor(arrowArm) || m?.phaseFor(arrowArm === 'N' ? 'S' : arrowArm === 'S' ? 'N' : arrowArm === 'E' ? 'W' : 'E');
      if (group) g.requestPhase(id, group, 'key');
      return;
    }
    switch (k) {
      case 'y':
      case 'Y': {
        // Flashing yellow on the junction under the cursor (or the first one).
        const id = g.hoveredHead?.intersectionId || [...g.sim.lights.managers.keys()][0];
        if (id) g.toggleFlash(id);
        break;
      }
      case ' ':
      case 'p':
      case 'P':
        e.preventDefault();
        g.togglePause();
        break;
      case 'r':
      case 'R':
        g.restart();
        break;
      case 'f':
      case 'F':
        g.setSpeed((g.state.speed % 3) + 1);
        break;
      case 'm':
      case 'M':
        g.toggleMute();
        break;
      case 'd':
      case 'D':
        g.toggleDebug();
        break;
      case '+':
      case '=':
        g.camera.zoomAt(1.15);
        break;
      case '-':
      case '_':
        g.camera.zoomAt(1 / 1.15);
        break;
      case '0':
        g.camera.reset();
        break;
      default:
        break;
    }
  }
}
