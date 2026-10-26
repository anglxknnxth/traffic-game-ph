// Tile geometry shared by the page (StaticTiles) and the tile workers (tileWorker.js).
// Zoom levels come in √2 steps: level L draws at 2^(L/2) device pixels per metre. A frame uses the
// level at or just above the screen's density, so tiles are only ever scaled down (by at most
// √2), never stretched: they stay sharp at every zoom.

export const TILE = 256; // device px per tile side

export const levelScale = (L) => 2 ** (L / 2);

/** The level whose scale is the smallest at or above `s` device px per metre. */
export const levelFor = (s) => Math.ceil(Math.log2(Math.max(1e-6, s)) * 2 - 1e-9);

/** One number per (level, column, row); exact for |i|, |j| < 32768 and |L| < 64. */
export const tileKey = (L, i, j) => ((L + 64) * 65536 + (i + 32768)) * 65536 + (j + 32768);
