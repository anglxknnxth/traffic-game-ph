// Rotonda maps for tests only. No shipped map uses the rotonda node modifier any more, but the
// engine still supports it, so these keep its regressions covered.

import { MAPS } from '../../src/data/maps/index.js';
import { bayanihan } from '../../src/data/maps/buhayKalsada.js';

/** The old Welcome Rotonda: one signalised rotonda, four roads. */
export const rotondaWelcome = {
  id: 'rotondaWelcome',
  name: 'Welcome Rotonda',
  region: 'Metro Manila',
  blurb: 'Test map: a signalised rotonda.',
  sceneSeed: 1948,
  theme: 'old-manila',
  roads: {
    quezon: { name: 'Quezon Ave', lanes: 3, median: 2 },
    espana: { name: 'España Blvd', lanes: 3, median: 1.2 },
    mayon: { name: 'Mayon St', lanes: 2, median: 0 },
    erod: { name: 'E. Rodriguez Sr. Ave', lanes: 2, median: 0 },
  },
  nodes: [{ id: 'A', x: 0, y: 0, kind: 'signal', rotonda: { island: 11, lanes: 2 }, arms: { N: 'mayon', S: 'erod', E: 'quezon', W: 'espana' }, shape: { E: [{ straight: 46 }, { curve: -20, radius: 150 }], W: [{ straight: 46 }, { curve: -18, radius: 160 }] } }],
  links: [],
  armLength: 120,
  focus: { minX: -78, maxX: 78, minY: -78, maxY: 78 },
  landmarks: [{ kind: 'park', x: -64, y: -64, w: 40, h: 40 }],
};

/** Bayanihan as it was, with the signalised rotonda at D. */
export const rotondaBayanihan = {
  ...bayanihan,
  id: 'rotondaBayanihan',
  nodes: bayanihan.nodes.map((n) => (n.id === 'D' ? { ...n, rotonda: { island: 12, lanes: 2 } } : n)),
};

/** Register the fixtures so levels can name them with `map`. */
export function registerRotondaMaps() {
  MAPS.rotondaWelcome = rotondaWelcome;
  MAPS.rotondaBayanihan = rotondaBayanihan;
}
