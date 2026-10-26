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
      if (sim.openNodes && !sim.openNodes.has(h.intersectionId)) continue;
      const d = Math.hypot(h.x - w.x, h.y - w.y);
      if (d < radius && d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  hitVehicle(px, py) {
    const sim = this.game.sim;
    if (!sim || !this.game.session) return null;
    const cam = this.game.camera;
    const w = cam.screenToWorld(px, py);
    return sim.vehicleAt(w.x, w.y, Math.max(0.6, 10 / cam.scale));
  }

  hitJaywalker(x, y) {
    const sim = this.game.sim;
    if (!sim?.peds?.enabled) return null;
    const r = Math.max(1.5, 12 / this.game.camera.scale);
    let best = null;
    let bestD = r;
    for (const p of sim.peds.peds) {
      if (p.state !== 'jaywait') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  hitBlockage(x, y) {
    const sim = this.game.sim;
    if (!sim) return null;
    const q = { x: 0, y: 0, dx: 0, dy: 0 };
    for (const b of sim.blockages) {
      if (!b.active || ['ped', 'laneEnd', 'cf'].includes(b.kind)) continue;
      for (const lane of b.laneObjs) {
        const s = b.sOf ? b.sOf.get(lane) : b.s;
        lane.path.pointAt(Math.min(lane.length, s + 4), q);
        if (Math.hypot(q.x - x, q.y - y) < 7) return b;
      }
    }
    return null;
  }

  hitBox(px, py) {
    const sim = this.game.sim;
    if (!sim) return null;
    const w = this.game.camera.screenToWorld(px, py);
    return sim.network.intersections.find((I) => sim.lights.manager(I.id) && (!sim.openNodes || sim.openNodes.has(I.id)) && Network.inCore(I, w.x, w.y)) || null;
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
        const v = h ? null : this.hitVehicle(p.x, p.y);
        const sim = this.game.sim;
        const stuck = v && (sim.isStuck(v) || sim.enforcement.violationOf(v));
        this.canvas.style.cursor = this.game.state.tool ? 'crosshair' : h || stuck || this.hitBox(p.x, p.y) ? 'pointer' : 'grab';
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
      if (this.game.director) {
        // A drag takes the camera back from the watch-mode director for a while.
        this.game.director.follow = null;
        this.game.director.shot = null;
        this.game.director.timer = 12;
      }
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
    const g = this.game;
    const w = g.camera.screenToWorld(p.x, p.y);
    // A tool picked in the HUD (station an enforcer, cone a contraflow lane)
    if (g.state.tool && g.toolAt(w.x, w.y)) return;
    // A vehicle: HULI! a violator, wave a stuck one through, padaanin at an enforcer's junction,
    // or follow it in watch mode. Clicking is always optional: everything also clears by itself.
    const v = this.hitVehicle(p.x, p.y);
    if (v && g.sim.enforcement.violationOf(v) && g.catchVehicle(v)) return;
    if (v && g.wavePass(v)) return;
    if (v && g.waveThrough(v)) return;
    if (v && g.followVehicle?.(v)) return;
    // A jaywalker waiting at the curb: saway
    const ped = this.hitJaywalker(w.x, w.y);
    if (ped && g.saway(ped)) return;
    // A stalled vehicle or road works: call a tow truck
    const blk = this.hitBlockage(w.x, w.y);
    if (blk && g.tow(blk)) return;
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
      // With many junctions, the number keys work the one shown in the control box.
      const sel = g.hud.selected;
      const list = g.sim.lights.managers.size > 2 && sel ? g.sim.lights.manager(sel).groups.map((group) => ({ id: sel, group })) : phaseKeys(g.sim);
      const p = list[Number(k) - 1];
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
        g.setSpeed((g.state.speed % 4) + 1);
        break;
      case 'm':
      case 'M':
        g.toggleMute();
        break;
      case 'd':
      case 'D':
        g.toggleDebug();
        break;
      case 't':
      case 'T':
        g.toggleMonitor();
        break;
      case 'o':
      case 'O':
        g.toggleOverlay();
        break;
      case 'h':
      case 'H':
        g.toggleWatch?.();
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
