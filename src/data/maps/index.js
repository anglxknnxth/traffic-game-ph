// Map registry. Levels name a map with `map` (or the legacy `layout` key).

import { single, double, corridor, grid } from './generic.js';
import { edsa, commonwealth, taft, espana, poblacion, likoliko } from './philippines.js';

export const MAPS = { single, double, corridor, grid, edsa, commonwealth, taft, espana, poblacion, likoliko };

export function getMap(id = 'single') {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown map ${id}`);
  return map;
}

export function mapForLevel(level) {
  return getMap(level.map || level.layout || 'single');
}
