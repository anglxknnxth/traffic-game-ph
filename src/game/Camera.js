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
    this._clampPan();
    this.version++;
  }

  _clampPan() {
    const halfW = this.viewW / 2 / this.scale;
    const halfH = this.viewH / 2 / this.scale;
    const fcx = (this.focus.minX + this.focus.maxX) / 2;
    const fcy = (this.focus.minY + this.focus.maxY) / 2;
    const maxPX = Math.max(0, (this.bounds.maxX - this.bounds.minX) / 2 - halfW);
    const maxPY = Math.max(0, (this.bounds.maxY - this.bounds.minY) / 2 - halfH);
    const bcx = (this.bounds.minX + this.bounds.maxX) / 2 - fcx;
    const bcy = (this.bounds.minY + this.bounds.maxY) / 2 - fcy;
    this.panX = clamp(this.panX, bcx - maxPX, bcx + maxPX);
    this.panY = clamp(this.panY, bcy - maxPY, bcy + maxPY);
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

  zoomAt(factor, px = this.screenCX, py = this.screenCY) {
    const before = this.screenToWorld(px, py);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this._recompute();
    const after = this.screenToWorld(px, py);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
    this._clampPan();
    this.version++;
  }

  panBy(dx, dy) {
    this.panX -= dx / this.scale;
    this.panY -= dy / this.scale;
    this._clampPan();
    this.version++;
  }

  reset() {
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
