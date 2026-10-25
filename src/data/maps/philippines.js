// Maps inspired by real Philippine roads. Geometry is simplified for play: junctions are square and
// lane counts are trimmed so the junction fits on screen, but roads bend away from the junctions
// (shape ops, see RoadGeometry). Roads under a rail line stay straight.
//
// Road profile: lanes per direction, median width (m), lane types from the median to the curb
// ('general' | 'bus' | 'moto'). Node kinds: 'signal' (player-controlled lights), 'uturn' (median
// U-turn slot, through traffic has priority) and 'yield' (unsignalised, minor arms stop and yield).

export const edsa = {
  id: 'edsa',
  name: 'EDSA – Aurora',
  region: 'Metro Manila',
  blurb: 'Five lanes each way, the EDSA Carousel busway beside the MRT-3 median, and U-turn slots instead of left turns.',
  sceneSeed: 1986,
  theme: 'metro',
  roads: {
    edsa: { name: 'EDSA', lanes: 5, median: 7, types: ['bus', 'general', 'general', 'general', 'general'] },
    aurora: { name: 'Aurora Blvd', lanes: 3, median: 1.2 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: 0,
      kind: 'signal',
      arms: { N: 'edsa', S: 'edsa', E: 'aurora', W: 'aurora' },
      noLeft: ['N', 'S'],
      shape: { E: [{ straight: 44 }, { curve: 22, radius: 120 }], W: [{ straight: 44 }, { curve: 16, radius: 140 }] },
    },
    { id: 'U1', x: 0, y: -88, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['S'], uturnRate: 0.3 },
    { id: 'U2', x: 0, y: 88, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['N'], uturnRate: 0.3 },
  ],
  links: [
    { a: 'A', aArm: 'N', b: 'U1', bArm: 'S' },
    { a: 'A', aArm: 'S', b: 'U2', bArm: 'N' },
  ],
  armLength: 120,
  focus: { minX: -62, maxX: 62, minY: -102, maxY: 102 },
  overlays: [{ kind: 'rail', line: 'MRT-3', axis: 'y', at: 0, width: 6.2, translucent: true, station: { at: -42, length: 56, name: 'ARANETA CENTER–CUBAO' } }],
};

export const commonwealth = {
  id: 'commonwealth',
  name: 'Commonwealth Ave',
  region: 'Metro Manila',
  blurb: 'A very wide avenue with a blue motorcycle lane, a concrete median and a U-turn slot between two signals.',
  sceneSeed: 1975,
  theme: 'metro',
  roads: {
    cw: { name: 'Commonwealth', lanes: 6, median: 3, types: ['general', 'general', 'general', 'general', 'general', 'moto'] },
    tandang: { name: 'Tandang Sora', lanes: 2, median: 0 },
    antonio: { name: 'Don Antonio', lanes: 2, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: -74,
      y: 0,
      kind: 'signal',
      arms: { N: 'tandang', S: 'tandang', E: 'cw', W: 'cw' },
      noLeft: ['E', 'W'],
      shape: {
        W: [{ straight: 34 }, { curve: -18, radius: 160 }],
        N: [{ straight: 44 }, { curve: 35, radius: 45 }],
        S: [{ straight: 44 }, { curve: -25, radius: 50 }, { straight: 20 }, { curve: 25, radius: 50 }],
      },
    },
    { id: 'U1', x: 0, y: 0, kind: 'uturn', arms: { E: 'cw', W: 'cw' }, uturn: ['E', 'W'], uturnRate: 0.25 },
    {
      id: 'B',
      x: 74,
      y: 0,
      kind: 'signal',
      arms: { N: 'antonio', S: 'antonio', E: 'cw', W: 'cw' },
      noLeft: ['E', 'W'],
      shape: { E: [{ straight: 34 }, { curve: 22, radius: 150 }], N: [{ straight: 44 }, { curve: -40, radius: 40 }] },
    },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'U1', bArm: 'W' },
    { a: 'U1', aArm: 'E', b: 'B', bArm: 'W' },
  ],
  armLength: 115,
  focus: { minX: -112, maxX: 112, minY: -60, maxY: 60 },
  overlays: [{ kind: 'footbridge', axis: 'x', at: -36 }],
};

export const taft = {
  id: 'taft',
  name: 'Taft Avenue',
  region: 'Metro Manila',
  blurb: 'Older, tighter Manila streets under the LRT-1, packed with jeepneys and students crossing.',
  sceneSeed: 1901,
  theme: 'old-manila',
  roads: {
    taft: { name: 'Taft Ave', lanes: 3, median: 1.4 },
    pedrogil: { name: 'Pedro Gil', lanes: 2, median: 0 },
    quirino: { name: 'Quirino Ave', lanes: 3, median: 1 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: -46,
      kind: 'signal',
      arms: { N: 'taft', S: 'taft', E: 'pedrogil', W: 'pedrogil' },
      shape: { W: [{ straight: 32 }, { curve: 35, radius: 40 }], E: [{ straight: 32 }, { curve: -30, radius: 50 }] },
    },
    {
      id: 'B',
      x: 0,
      y: 46,
      kind: 'signal',
      arms: { N: 'taft', S: 'taft', E: 'quirino', W: 'quirino' },
      shape: { W: [{ straight: 34 }, { curve: -25, radius: 60 }], E: [{ straight: 34 }, { curve: 30, radius: 55 }] },
    },
  ],
  links: [{ a: 'A', aArm: 'S', b: 'B', bArm: 'N' }],
  armLength: 115,
  focus: { minX: -60, maxX: 60, minY: -96, maxY: 96 },
  overlays: [{ kind: 'rail', line: 'LRT-1', axis: 'y', at: 0, width: 7.5, translucent: true, station: { at: 0, length: 40, name: 'PEDRO GIL–QUIRINO' } }],
};

export const espana = {
  id: 'espana',
  name: 'España – Lacson',
  region: 'Metro Manila',
  blurb: 'The tree-lined boulevard by the university belt, and the first street to flood when it rains.',
  sceneSeed: 1611,
  theme: 'old-manila',
  roads: {
    espana: { name: 'España Blvd', lanes: 3, median: 3 },
    lacson: { name: 'Lacson Ave', lanes: 3, median: 1.6 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: 0,
      kind: 'signal',
      arms: { N: 'lacson', S: 'lacson', E: 'espana', W: 'espana' },
      shape: {
        E: [{ straight: 32 }, { curve: 18, radius: 140 }],
        W: [{ straight: 32 }, { curve: 18, radius: 140 }],
        N: [{ straight: 34 }, { curve: -15, radius: 160 }],
      },
    },
  ],
  links: [],
  armLength: 120,
};

export const poblacion = {
  id: 'poblacion',
  name: 'Poblacion',
  region: 'Probinsya',
  blurb: 'The national highway through the town proper: a signalised T-junction by the plaza and barangay roads that must yield.',
  sceneSeed: 1898,
  theme: 'province',
  roads: {
    highway: { name: 'National Hwy', lanes: 2, median: 0 },
    rizal: { name: 'Rizal St', lanes: 1, median: 0 },
    brgy: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: 0, kind: 'signal', arms: { N: 'rizal', E: 'highway', W: 'highway' }, shape: { N: [{ straight: 34 }, { curve: 20, radius: 50 }] } },
    {
      id: 'Y1',
      x: -80,
      y: 10,
      kind: 'yield',
      arms: { S: 'brgy', E: 'highway', W: 'highway' },
      major: ['E', 'W'],
      shape: {
        W: [{ straight: 26 }, { curve: -25, radius: 90 }],
        S: [{ straight: 32 }, { curve: 40, radius: 30 }, { straight: 20 }, { curve: -50, radius: 28 }],
      },
    },
    {
      id: 'Y2',
      x: 80,
      y: -8,
      kind: 'yield',
      arms: { N: 'brgy', E: 'highway', W: 'highway' },
      major: ['E', 'W'],
      shape: {
        E: [{ straight: 26 }, { curve: 20, radius: 100 }],
        N: [{ straight: 32 }, { curve: -45, radius: 30 }, { straight: 18 }, { curve: 55, radius: 28 }],
      },
    },
  ],
  links: [
    { a: 'Y1', aArm: 'E', b: 'A', bArm: 'W' },
    { a: 'A', aArm: 'E', b: 'Y2', bArm: 'W' },
  ],
  armLength: 115,
  focus: { minX: -108, maxX: 108, minY: -55, maxY: 55 },
};

export const likoliko = {
  id: 'likoliko',
  name: 'Liko-Liko',
  region: 'Probinsya',
  blurb: 'A winding mountain-town road: two signals on an S-bend, with sitio roads twisting off into the hills.',
  sceneSeed: 2112,
  theme: 'province',
  roads: {
    hwy: { name: 'Mountain Rd', lanes: 2, median: 0 },
    sitio: { name: 'Sitio Rd', lanes: 1, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: -52,
      y: -12,
      kind: 'signal',
      arms: { N: 'sitio', S: 'hwy', E: 'hwy', W: 'hwy' },
      shape: {
        W: [{ straight: 30 }, { curve: -40, radius: 45 }, { straight: 20 }, { curve: 55, radius: 40 }],
        N: [{ straight: 34 }, { curve: 50, radius: 32 }, { straight: 15 }, { curve: -70, radius: 30 }],
        S: [{ straight: 28 }, { curve: -35, radius: 50 }],
      },
    },
    {
      id: 'B',
      x: 54,
      y: 18,
      kind: 'signal',
      arms: { N: 'hwy', S: 'sitio', E: 'hwy', W: 'hwy' },
      shape: {
        E: [{ straight: 30 }, { curve: 45, radius: 45 }, { straight: 25 }, { curve: -60, radius: 40 }],
        S: [{ straight: 34 }, { curve: -50, radius: 32 }, { straight: 15 }, { curve: 65, radius: 30 }],
        N: [{ straight: 28 }, { curve: 30, radius: 55 }],
      },
    },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 120,
  focus: { minX: -100, maxX: 100, minY: -62, maxY: 68 },
};
