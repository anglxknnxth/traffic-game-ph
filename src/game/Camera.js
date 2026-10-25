// Strict top-down camera: only scale and translation, never rotation or tilt.

import { clamp } from '../utils/math.js';

export class Camera {
  constructor() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.base = 1;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.focus = { minX: -46, maxX: 46, minY: -46, maxY: 46 };
    this.bounds = { minX: -120, maxX: 120, minY: -120, maxY: 120 };
    this.minZoom = 0.6;
    this.maxZoom = 3.5;
    this.version = 0;
  }

  setViewport(w, h, dpr) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = dpr;
    this._recompute();
  }

  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    this._recompute();
  }

  setFocus(focus, bounds) {
    this.focus = focus;
    if (bounds) this.bounds = bounds;
    this.targetZoom = null;
    this.anchor = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._recompute();
  }

  get viewW() {
    return Math.max(60, this.w - this.insets.left - this.insets.right);
  }

  get viewH() {
    return Math.max(60, this.h - this.insets.top - this.insets.bottom);
  }

  get scale() {
    return this.base * this.zoom;
  }

  get centerX() {
    return (this.focus.minX + this.focus.maxX) / 2 + this.panX;
  }

  get centerY() {
    return (this.focus.minY + this.focus.maxY) / 2 + this.panY;
  }

  get screenCX() {
    return this.insets.left + this.viewW / 2;
  }

  get screenCY() {
    return this.insets.top + this.viewH / 2;
  }

  _recompute() {
    const fw = this.focus.maxX - this.focus.minX;
    const fh = this.focus.maxY - this.focus.minY;
    this.base = Math.min(this.viewW / fw, this.viewH / fh);
    // Big maps: still allow zooming in until a car is clearly visible (about 14 px per metre).
    this.maxZoom = Math.max(3.5, 14 / this.base);
    // Never zoom out past the bounds: the whole canvas (HUD areas included) must fit inside them,
    // so the ends of the lanes, where vehicles appear and leave, stay off screen.
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    this.zoomFloor = Math.min(this.maxZoom, Math.max(this.minZoom, this.w / (this.base * bw), this.h / (this.base * bh)));
    this.zoom = clamp(this.zoom, this.zoomFloor, this.maxZoom);
    this._clampPan();
    this.version++;
  }

  /** Keep the full visible canvas inside the bounds. */
  _clampPan() {
    const s = this.scale;
    const fcx = (this.focus.minX + this.focus.maxX) / 2;
    const fcy = (this.focus.minY + this.focus.maxY) / 2;
    const fit = (center, lo, hi) => (lo > hi ? (lo + hi) / 2 : clamp(center, lo, hi));
    const cx = fit(fcx + this.panX, this.bounds.minX + this.screenCX / s, this.bounds.maxX - (this.w - this.screenCX) / s);
    const cy = fit(fcy + this.panY, this.bounds.minY + this.screenCY / s, this.bounds.maxY - (this.h - this.screenCY) / s);
    this.panX = cx - fcx;
    this.panY = cy - fcy;
  }

  apply(ctx) {
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, (this.screenCX - this.centerX * this.scale) * this.dpr, (this.screenCY - this.centerY * this.scale) * this.dpr);
  }

  screenToWorld(px, py) {
    return { x: (px - this.screenCX) / this.scale + this.centerX, y: (py - this.screenCY) / this.scale + this.centerY };
  }

  worldToScreen(x, y) {
    return { x: (x - this.centerX) * this.scale + this.screenCX, y: (y - this.centerY) * this.scale + this.screenCY };
  }

  /** Zoom toward a screen point. The zoom eases there over a few frames (see update). */
  zoomAt(factor, px = this.screenCX, py = this.screenCY) {
    const from = this.targetZoom ?? this.zoom;
    this.targetZoom = clamp(from * factor, this.zoomFloor ?? this.minZoom, this.maxZoom);
    const w = this.screenToWorld(px, py);
    this.anchor = { px, py, wx: w.x, wy: w.y };
  }

  /** Ease the focus (and camera limit) to a new area over `secs` (the growing city opening up). */
  transitionTo(focus, bounds, secs = 1.6) {
    this.transition = { from: { ...this.focus }, to: focus, bounds, t: 0, secs, panX: this.panX, panY: this.panY };
    this.bounds = {
      minX: Math.min(this.bounds.minX, bounds.minX),
      maxX: Math.max(this.bounds.maxX, bounds.maxX),
      minY: Math.min(this.bounds.minY, bounds.minY),
      maxY: Math.max(this.bounds.maxY, bounds.maxY),
    };
  }

  /** Keep a world point centred (follow a vehicle, cinematic shots), easing toward it. */
  track(x, y, dt, zoom = null) {
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.6);
    const fcx = (this.focus.minX + this.focus.maxX) / 2;
    const fcy = (this.focus.minY + this.focus.maxY) / 2;
    this.panX += (x - fcx - this.panX) * k;
    this.panY += (y - fcy - this.panY) * k;
    if (zoom !== null) {
      this.zoom += (Math.max(this.zoomFloor ?? this.minZoom, Math.min(this.maxZoom, zoom)) - this.zoom) * k * 0.5;
      this._recompute();
    } else this._clampPan();
    this.version++;
  }

  /** True while an eased zoom is still moving. */
  get animating() {
    return (this.targetZoom !== undefined && this.targetZoom !== null) || !!this.transition;
  }

  /** Advance the zoom easing (call once per rendered frame with real seconds). */
  update(dt) {
    const tr = this.transition;
    if (tr) {
      tr.t = Math.min(tr.secs, tr.t + Math.max(0, dt));
      const e = tr.t / tr.secs;
      const k = e * e * (3 - 2 * e);
      const lerp = (a, b) => a + (b - a) * k;
      this.focus = { minX: lerp(tr.from.minX, tr.to.minX), maxX: lerp(tr.from.maxX, tr.to.maxX), minY: lerp(tr.from.minY, tr.to.minY), maxY: lerp(tr.from.maxY, tr.to.maxY) };
      this.panX = tr.panX * (1 - k);
      this.panY = tr.panY * (1 - k);
      this._recompute();
      if (tr.t >= tr.secs) {
        this.transition = null;
        this.bounds = tr.bounds;
        this._recompute();
      }
      this.version++;
    }
    if (!(this.targetZoom !== undefined && this.targetZoom !== null)) return;
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.09);
    const done = Math.abs(this.targetZoom - this.zoom) < this.targetZoom * 0.002;
    this.zoom = done ? this.targetZoom : this.zoom + (this.targetZoom - this.zoom) * k;
    this._recompute();
    const a = this.anchor;
    if (a) {
      // keep the world point under the cursor fixed while zooming
      const after = this.screenToWorld(a.px, a.py);
      this.panX += a.wx - after.x;
      this.panY += a.wy - after.y;
      this._clampPan();
    }
    this.version++;
    if (done) {
      this.targetZoom = null;
      this.anchor = null;
    }
  }

  panBy(dx, dy) {
    // A drag moves the camera directly; it also keeps a running zoom anchored to the drag.
    if (this.anchor) {
      this.anchor.px += dx;
      this.anchor.py += dy;
    }
    this.panX -= dx / this.scale;
    this.panY -= dy / this.scale;
    this._clampPan();
    this.version++;
  }

  reset() {
    this.targetZoom = null;
    this.anchor = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._recompute();
  }

  visibleRect(margin = 8) {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.w, this.h);
    return { minX: a.x - margin, minY: a.y - margin, maxX: b.x + margin, maxY: b.y + margin };
  }
}
