// Static road tiles drawn off the main thread. The worker rebuilds the same network and road
// renderer as the page (both are deterministic, seeded from the map) and draws each requested
// 256 px tile into an OffscreenCanvas, handing it back as an ImageBitmap (moved, not copied).
// The page never waits for a tile: it shows what it has (see StaticTiles) until this one arrives.
//
// Messages in:  { type: 'init', gen, mapId, textureBase }
//               { type: 'render', gen, key, scale, i, j, elevated }
// Messages out: { type: 'ready', gen }
//               { type: 'tile', gen, key, s, e, ms }   (s / e: ImageBitmap, e null when none)

import { Network } from '../simulation/LaneManager.js';
import { RoadRenderer } from './RoadRenderer.js';
import { TILE } from './tileMath.js';

let gen = -1;
let road = null;
let ready = null;
const canvasS = new OffscreenCanvas(TILE, TILE);
const canvasE = new OffscreenCanvas(TILE, TILE);

function paint(c, scale, i, j, draw) {
  // Drawn on this worker's own CPU thread (willReadFrequently keeps the canvas off the GPU): a
  // GPU canvas here would queue its work on the same GPU thread that presents the page's frames.
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.setLineDash([]);
  g.clearRect(0, 0, TILE, TILE);
  g.setTransform(scale, 0, 0, scale, -i * TILE, -j * TILE);
  draw(g);
  return c.transferToImageBitmap();
}

function render(m) {
  const t0 = performance.now();
  const k = TILE / m.scale;
  road.view = { minX: m.i * k, minY: m.j * k, maxX: (m.i + 1) * k, maxY: (m.j + 1) * k };
  road.ppm = m.scale;
  const s = paint(canvasS, m.scale, m.i, m.j, (g) => road.drawStatic(g));
  const e = road.hasElevated && road.elevatedIn(road.view) ? paint(canvasE, m.scale, m.i, m.j, (g) => road.drawElevated(g)) : null;
  road.view = null;
  postMessage({ type: 'tile', gen: m.gen, key: m.key, s, e, ms: performance.now() - t0 }, e ? [s, e] : [s]);
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    gen = m.gen;
    road = new RoadRenderer(new Network(m.mapId), { textureBase: m.textureBase });
    const mine = gen;
    // Draw nothing before every photo texture is in: one consistent look, no redraws later.
    ready = road.tex.loaded.then(() => {
      if (mine === gen) postMessage({ type: 'ready', gen: mine });
    });
    return;
  }
  if (m.type === 'render') {
    if (m.gen !== gen) return; // for a map that has since been replaced
    ready.then(() => {
      if (m.gen === gen) render(m);
    });
  }
};
