// Metro Manila: a big city map with everything at once. EDSA (busway, MRT-3 above, no left turns,
// a U-turn slot), Quezon Ave whose two middle lanes dive into an underpass below the EDSA junction,
// Taft Ave under the LRT-1, the Skyway (elevated, with a toll plaza and on/off ramps down to Aurora
// Blvd and Shaw Blvd), a river with bridges, barangay streets with no lights and a lane drop on Shaw.
//
// districts: the order in which Lumalaking Lungsod (the growing city mode) opens the map.

const SKY = 1; // the Skyway's level

export const metro = {
  id: 'metro',
  name: 'Metro Manila',
  region: 'Metro Manila',
  blurb: 'The whole city in one map: EDSA, the Quezon Ave underpass, Taft under the LRT, the elevated Skyway with its toll plaza and ramps, a river and barangay streets.',
  sceneSeed: 1571,
  theme: 'metro',
  textures: 'metro',
  roads: {
    taft: { name: 'Taft Ave', lanes: 3, median: 0 },
    edsa: { name: 'EDSA', lanes: 5, median: 7, types: ['bus', 'general', 'general', 'general', 'general'] },
    quezon: { name: 'Quezon Ave', lanes: 5, median: 0, types: ['tunnel', 'tunnel', 'general', 'general', 'general'] },
    aurora: { name: 'Aurora Blvd', lanes: 3, median: 0 },
    shaw: { name: 'Shaw Blvd', lanes: 3, median: 0 },
    brgy: { name: 'Kalye', lanes: 1, median: 0 },
    skyway: { name: 'Skyway', lanes: 3, median: 1.2 },
    ramp: { name: 'Skyway Ramp', lanes: 1, median: 1 },
  },
  nodes: [
    { id: 'T1', x: -270, y: -210, kind: 'signal', arms: { N: 'taft', S: 'taft', E: 'aurora', W: 'aurora' }, shape: { W: [{ straight: 40 }, { curve: -25, radius: 140 }] } },
    { id: 'T2', x: -235, y: 0, kind: 'signal', arms: { N: 'taft', S: 'taft', E: 'quezon', W: 'quezon' }, shape: { W: [{ straight: 50 }, { curve: 20, radius: 160 }] } },
    { id: 'T3', x: -285, y: 250, kind: 'signal', arms: { N: 'taft', S: 'taft', E: 'shaw', W: 'shaw' }, shape: { W: [{ straight: 40 }, { curve: 18, radius: 150 }] } },
    { id: 'Y1', x: -110, y: -240, kind: 'yield', arms: { N: 'brgy', E: 'aurora', W: 'aurora' }, major: ['E', 'W'], names: { N: 'Sampaguita St' }, shape: { N: [{ straight: 36 }, { curve: 40, radius: 30 }, { straight: 20 }, { curve: -55, radius: 28 }] } },
    { id: 'Y2', x: -120, y: 290, kind: 'yield', arms: { S: 'brgy', E: 'shaw', W: 'shaw' }, major: ['E', 'W'], names: { S: 'Ilang-Ilang St' }, shape: { S: [{ straight: 36 }, { curve: -40, radius: 30 }, { straight: 20 }, { curve: 55, radius: 28 }] } },
    { id: 'E1', x: 45, y: -215, kind: 'signal', arms: { N: 'edsa', S: 'edsa', W: 'aurora', E: 'ramp' }, noLeft: ['N', 'S'], noCrossing: ['N', 'S'] },
    { id: 'U1', x: 52, y: -105, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['N', 'S'], uturnRate: 0.25 },
    // The middle lanes of Quezon Ave pass under EDSA here (no lights for them).
    { id: 'E2', x: 62, y: 0, shape: { E: [{ straight: 70 }, { curve: -18, radius: 200 }] }, kind: 'signal', underpass: true, arms: { N: 'edsa', S: 'edsa', W: 'quezon', E: 'quezon' }, noLeft: ['N', 'S'], noCrossing: ['N', 'S'] },
    {
      id: 'E3',
      x: 30,
      y: 255,
      kind: 'signal',
      arms: { N: 'edsa', S: 'edsa', W: 'shaw', E: 'shaw' },
      noLeft: ['N', 'S'],
      noCrossing: ['N', 'S'],
      // The curb lane of Shaw ends before EDSA: right turns also go from the middle lane.
      moves: { W: [['straight', 'left'], ['straight', 'right'], ['straight', 'right']] },
    },
    { id: 'G1', x: 470, y: 215, kind: 'signal', arms: { W: 'shaw', E: 'shaw', S: 'ramp' }, shape: { E: [{ straight: 34 }, { curve: 30, radius: 90 }, { straight: 30 }, { curve: -20, radius: 120 }] } },
    // Skyway (elevated): the ramp junctions merge without stopping; the toll plaza is in between.
    {
      id: 'K1',
      x: 330,
      y: -160,
      kind: 'yield',
      rolling: true,
      layer: SKY,
      arms: { N: 'skyway', S: 'skyway', W: 'ramp' },
      major: ['N', 'S'],
      moves: { N: [['straight'], ['straight'], ['straight', 'right']], S: [['straight'], ['straight'], ['straight']], W: [['right']] },
    },
    { id: 'TP', x: 360, y: -30, kind: 'toll', layer: SKY, arms: { N: 'skyway', S: 'skyway' } },
    {
      id: 'K2',
      x: 325,
      y: 350,
      kind: 'yield',
      rolling: true,
      layer: SKY,
      arms: { N: 'skyway', S: 'skyway', E: 'ramp' },
      major: ['N', 'S'],
      moves: { S: [['straight'], ['straight'], ['straight', 'right']], N: [['straight'], ['straight'], ['straight']], E: [['right']] },
    },
  ],
  links: [
    { a: 'T1', aArm: 'S', b: 'T2', bArm: 'N' },
    { a: 'T2', aArm: 'S', b: 'T3', bArm: 'N' },
    { a: 'T1', aArm: 'E', b: 'Y1', bArm: 'W' },
    { a: 'Y1', aArm: 'E', b: 'E1', bArm: 'W' },
    { a: 'T2', aArm: 'E', b: 'E2', bArm: 'W' },
    { a: 'T3', aArm: 'E', b: 'Y2', bArm: 'W' },
    { a: 'Y2', aArm: 'E', b: 'E3', bArm: 'W' },
    { a: 'E1', aArm: 'S', b: 'U1', bArm: 'N' },
    { a: 'U1', aArm: 'S', b: 'E2', bArm: 'N' },
    { a: 'E2', aArm: 'S', b: 'E3', bArm: 'N' },
    { a: 'E3', aArm: 'E', b: 'G1', bArm: 'W' },
    { a: 'E1', aArm: 'E', b: 'K1', bArm: 'W' },
    { a: 'K1', aArm: 'S', b: 'TP', bArm: 'N' },
    { a: 'TP', aArm: 'S', b: 'K2', bArm: 'N' },
    { a: 'K2', aArm: 'E', b: 'G1', bArm: 'S' },
  ],
  laneDrops: [{ node: 'E3', arm: 'W', lane: 2, before: 45 }],
  river: {
    points: [[-760, 140], [-560, 95], [-420, 165], [-260, 110], [-140, 175], [-20, 100], [120, 170], [260, 95], [400, 150], [560, 100], [760, 140]],
    width: 30,
    name: 'ILOG PASIG',
    boats: 6,
  },
  armLength: 140,
  focus: { minX: -340, maxX: 540, minY: -290, maxY: 410 },
  // Lumalaking Lungsod: the city opens district by district.
  districts: [
    { name: 'EDSA – Quezon Ave', nodes: ['E2', 'U1'] },
    { name: 'EDSA corridor', nodes: ['E1', 'E3'] },
    { name: 'Taft Ave', nodes: ['T1', 'T2', 'T3', 'Y1', 'Y2'] },
    { name: 'Skyway', nodes: ['K1', 'TP', 'K2', 'G1'] },
  ],
  // Landmarks in the blocks between the avenues (see LandmarkRenderer).
  landmarks: [
    { kind: 'park', x: -95, y: -110, w: 140, h: 96 },
    { kind: 'court', x: -180, y: -292, w: 30, h: 18 },
    { kind: 'church', x: -185, y: 206, w: 38, h: 26 },
    { kind: 'palengke', x: -205, y: 326, w: 48, h: 30 },
    { kind: 'mall', x: 150, y: 322, w: 92, h: 56 },
    { kind: 'promenade', from: 150, to: 470, side: -1 },
  ],
  overlays: [
    { kind: 'rail', line: 'MRT-3', follow: ['E1', 'U1', 'E2', 'E3'], width: 6.2, translucent: true, station: { at: 0, length: 56, name: 'MRT-3 · QUEZON AVE' } },
    { kind: 'rail', line: 'LRT-1', follow: ['T1', 'T2', 'T3'], width: 7.5, translucent: true, station: { at: 0, length: 40, name: 'LRT-1 · PEDRO GIL' } },
  ],
};
