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
      noCrossing: ['N', 'S'],
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
    cw: { name: 'Commonwealth', lanes: 7, median: 3, types: ['general', 'general', 'general', 'general', 'general', 'moto', 'bike'] },
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
      noCrossing: ['E', 'W'],
      shape: {
        W: [{ straight: 34 }, { curve: -18, radius: 160 }],
        // Bends east, then straightens north again so it never meets Don Antonio as it runs off screen.
        N: [{ straight: 44 }, { curve: 35, radius: 45 }, { straight: 15 }, { curve: -35, radius: 45 }],
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
      noCrossing: ['E', 'W'],
      shape: { E: [{ straight: 34 }, { curve: 22, radius: 150 }], N: [{ straight: 44 }, { curve: -40, radius: 40 }, { straight: 15 }, { curve: 40, radius: 40 }] },
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
    espana: { name: 'España Blvd', lanes: 4, median: 3, types: ['general', 'general', 'general', 'bike'] },
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
    { id: 'A', x: 0, y: 0, kind: 'signal', arms: { N: 'rizal', E: 'highway', W: 'highway' }, shape: { N: [{ straight: 34 }, { curve: 20, radius: 50 }, { straight: 30 }, { curve: -20, radius: 50 }] } },
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
  // The town river: the highway crosses it on a short bridge between the barangay road and the plaza.
  river: { points: [[-30, -160], [-34, -80], [-40, 5], [-47, 70], [-38, 160]], width: 16, name: 'TULAY NG POBLACION', boats: 2 },
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
        S: [{ straight: 28 }, { curve: -35, radius: 50 }, { straight: 30 }, { curve: 35, radius: 50 }],
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
  // A mountain river winds through the valley; the S-bend crosses it on a bridge.
  river: { points: [[30, -170], [18, -90], [8, -35], [1, 3], [8, 45], [24, 90], [38, 170]], width: 18, name: 'TULAY NG LIKO-LIKO', boats: 1 },
  armLength: 120,
  focus: { minX: -100, maxX: 100, minY: -62, maxY: 68 },
};

export const tulay = {
  id: 'tulay',
  name: 'Dalawang Pampang',
  region: 'Metro Manila',
  blurb: 'A city river with a signal on each bank, joined by one short bridge. Riverside streets feed both ends.',
  sceneSeed: 1947,
  theme: 'old-manila',
  roads: {
    avenida: { name: 'Avenida', lanes: 3, median: 0, types: ['general', 'general', 'bike'] },
    tulay: { name: 'Tulay Ave', lanes: 2, median: 0 },
    pampang: { name: 'Pampang St', lanes: 1, median: 0 },
    ilaya: { name: 'Ilaya St', lanes: 1, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: -40,
      kind: 'signal',
      arms: { N: 'avenida', S: 'tulay', E: 'pampang', W: 'pampang' },
      shape: { N: [{ straight: 34 }, { curve: 25, radius: 70 }], E: [{ straight: 40 }, { curve: -12, radius: 160 }], W: [{ straight: 40 }, { curve: 10, radius: 180 }] },
    },
    {
      id: 'B',
      x: 0,
      y: 40,
      kind: 'signal',
      arms: { N: 'tulay', S: 'avenida', E: 'ilaya', W: 'ilaya' },
      shape: { S: [{ straight: 34 }, { curve: -30, radius: 60 }], E: [{ straight: 40 }, { curve: 10, radius: 180 }], W: [{ straight: 40 }, { curve: -12, radius: 160 }] },
    },
  ],
  links: [{ a: 'A', aArm: 'S', b: 'B', bArm: 'N' }],
  river: { points: [[-280, 8], [-150, -3], [-60, 3], [0, 0], [60, -4], [150, 4], [280, -6]], width: 22, name: 'TULAY NG PAMPANG', boats: 3 },
  armLength: 115,
  focus: { minX: -70, maxX: 70, minY: -92, maxY: 92 },
};

// A highway town strip: two side streets join the highway with no traffic light (they give way and
// merge), then the curb lane ends before the signal at Burgos St (3 lanes become 2: zipper merge).
export const serbisyo = {
  id: 'serbisyo',
  name: 'MacArthur Hwy',
  region: 'Gitnang Luzon',
  blurb: 'Side streets feed straight onto the highway with no light, and the curb lane ends before the Burgos St signal: three lanes squeeze into two.',
  sceneSeed: 1936,
  theme: 'province',
  roads: {
    hwy: { name: 'MacArthur Hwy', lanes: 3, median: 2 },
    side: { name: 'Service Rd', lanes: 1, median: 0 },
    sampaguita: { name: 'Sampaguita St', lanes: 1, median: 0 },
    burgos: { name: 'Burgos St', lanes: 2, median: 0 },
  },
  nodes: [
    {
      id: 'Y1',
      x: -120,
      y: 0,
      kind: 'yield',
      arms: { S: 'side', E: 'hwy', W: 'hwy' },
      major: ['E', 'W'],
      shape: { S: [{ straight: 40 }, { curve: 30, radius: 45 }, { straight: 20 }, { curve: -30, radius: 45 }], W: [{ straight: 40 }, { curve: -12, radius: 200 }] },
    },
    {
      id: 'Y2',
      x: -10,
      y: 0,
      kind: 'yield',
      arms: { N: 'sampaguita', E: 'hwy', W: 'hwy' },
      major: ['E', 'W'],
      shape: { N: [{ straight: 40 }, { curve: -35, radius: 40 }, { straight: 15 }, { curve: 35, radius: 40 }] },
    },
    {
      id: 'A',
      x: 110,
      y: 0,
      kind: 'signal',
      arms: { N: 'burgos', S: 'burgos', E: 'hwy', W: 'hwy' },
      // The curb lane ends before the junction, so right turns also go from the middle lane.
      moves: { W: [['straight', 'left'], ['straight', 'right'], ['straight', 'right']] },
      shape: { E: [{ straight: 40 }, { curve: 14, radius: 180 }], N: [{ straight: 40 }, { curve: 30, radius: 55 }], S: [{ straight: 40 }, { curve: -25, radius: 60 }] },
    },
  ],
  links: [
    { a: 'Y1', aArm: 'E', b: 'Y2', bArm: 'W' },
    { a: 'Y2', aArm: 'E', b: 'A', bArm: 'W' },
  ],
  laneDrops: [{ node: 'A', arm: 'W', lane: 2, before: 45 }],
  armLength: 115,
  focus: { minX: -160, maxX: 150, minY: -60, maxY: 60 },
};
