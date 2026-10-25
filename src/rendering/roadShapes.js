// Drawing along a road centre line in arm-local coordinates: x = distance from the node along the
// centre line, y = lateral offset (+ = right of the outward direction). On straight stretches this
// is a plain rotated rectangle; on bends the band follows the curve.

const _p = {};

function frameAt(ctx, g, x) {
  g.point(x, 0, _p);
  ctx.translate(_p.x, _p.y);
  ctx.rotate(_p.angle);
}

/** Fill the band x0..x1 (along) by y0..y1 (across). */
export function strip(ctx, g, x0, x1, y0, y1) {
  if (x1 <= x0) return;
  if (g.isStraight(x0, x1)) {
    ctx.save();
    frameAt(ctx, g, x0);
    ctx.fillRect(0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
    ctx.restore();
    return;
  }
  const a = g.offset(x0, x1, y0).points;
  const b = g.offset(x0, x1, y1).points;
  ctx.beginPath();
  ctx.moveTo(a[0].x, a[0].y);
  for (let i = 1; i < a.length; i++) ctx.lineTo(a[i].x, a[i].y);
  for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i].x, b[i].y);
  ctx.closePath();
  ctx.fill();
}

/** Add a polyline along offset y from x0 to x1 to the current path. */
export function addLine(ctx, g, x0, x1, y) {
  if (x1 <= x0) return;
  const pts = g.offset(x0, x1, y).points;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Dashed line of thickness w: dashes of `dash` metres every `period` metres. */
export function dashes(ctx, g, x0, x1, y, dash, period, w) {
  for (let x = x0; x < x1; x += period) strip(ctx, g, x, Math.min(x + dash, x1), y - w / 2, y + w / 2);
}

/** Run fn in a local frame centred on (x, y), rotated with the road there. */
export function withFrame(ctx, g, x, y, fn) {
  g.point(x, y, _p);
  ctx.save();
  ctx.translate(_p.x, _p.y);
  ctx.rotate(_p.angle);
  fn();
  ctx.restore();
}

/** World position and heading of arm-local (x, y). */
export function at(g, x, y, out = {}) {
  return g.point(x, y, out);
}
