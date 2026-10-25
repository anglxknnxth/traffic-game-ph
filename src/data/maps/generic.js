// Generic training maps: plain two-lane-per-direction roads with no median. Junctions are square,
// but the roads bend, slant and wind as they leave them (shape ops, see RoadGeometry).

const street = { lanes: 2, median: 0 };
const four = { N: 'street', E: 'street', S: 'street', W: 'street' };

export const single = {
  id: 'single',
  name: 'Kanto',
  region: 'Training',
  sceneSeed: 1898,
  roads: { street },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: 0,
      kind: 'signal',
      arms: four,
      shape: {
        N: [{ straight: 30 }, { curve: 25, radius: 60 }],
        E: [{ straight: 34 }, { curve: -30, radius: 45 }, { straight: 20 }, { curve: 30, radius: 45 }],
        W: [{ straight: 28 }, { curve: 35, radius: 40 }],
      },
    },
  ],
  links: [],
};

export const double = {
  id: 'double',
  name: 'Dalawang Kanto',
  region: 'Training',
  sceneSeed: 2024,
  roads: { street },
  nodes: [
    {
      id: 'A',
      x: -38,
      y: 0,
      kind: 'signal',
      arms: four,
      shape: {
        N: [{ straight: 30 }, { curve: -30, radius: 50 }],
        W: [{ straight: 30 }, { curve: -20, radius: 70 }, { straight: 30 }, { curve: 25, radius: 60 }],
      },
    },
    {
      id: 'B',
      x: 38,
      y: 0,
      kind: 'signal',
      arms: four,
      shape: {
        S: [{ straight: 30 }, { curve: -30, radius: 50 }],
        E: [{ straight: 30 }, { curve: 25, radius: 55 }, { straight: 25 }, { curve: -35, radius: 50 }],
      },
    },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
};

// The middle junction sits off the line of the other two, so both links are S-bends.
export const corridor = {
  id: 'corridor',
  name: 'Tatlong Kanto',
  region: 'Training',
  sceneSeed: 3131,
  roads: { street },
  nodes: [
    { id: 'A', x: -90, y: 0, kind: 'signal', arms: four, shape: { W: [{ straight: 30 }, { curve: 25, radius: 60 }], N: [{ straight: 30 }, { curve: -25, radius: 55 }] } },
    { id: 'B', x: 0, y: 14, kind: 'signal', arms: four, shape: { S: [{ straight: 30 }, { curve: 30, radius: 50 }, { straight: 20 }, { curve: -30, radius: 50 }] } },
    { id: 'C', x: 90, y: 0, kind: 'signal', arms: four, shape: { E: [{ straight: 30 }, { curve: -25, radius: 60 }], N: [{ straight: 30 }, { curve: 30, radius: 50 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'B', aArm: 'E', b: 'C', bArm: 'W' },
  ],
};

// Outer roads fan out diagonally from each corner of the block.
export const grid = {
  id: 'grid',
  name: 'Grid ng Maynila',
  region: 'Training',
  sceneSeed: 4444,
  roads: { street },
  nodes: [
    { id: 'A', x: -40, y: -40, kind: 'signal', arms: four, shape: { N: [{ straight: 28 }, { curve: -30, radius: 50 }], W: [{ straight: 28 }, { curve: 30, radius: 50 }] } },
    { id: 'B', x: 40, y: -40, kind: 'signal', arms: four, shape: { N: [{ straight: 28 }, { curve: 30, radius: 50 }], E: [{ straight: 28 }, { curve: -30, radius: 50 }] } },
    { id: 'C', x: -40, y: 40, kind: 'signal', arms: four, shape: { S: [{ straight: 28 }, { curve: 30, radius: 50 }], W: [{ straight: 28 }, { curve: -30, radius: 50 }] } },
    { id: 'D', x: 40, y: 40, kind: 'signal', arms: four, shape: { S: [{ straight: 28 }, { curve: -30, radius: 50 }], E: [{ straight: 28 }, { curve: 30, radius: 50 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'C', aArm: 'E', b: 'D', bArm: 'W' },
    { a: 'A', aArm: 'S', b: 'C', bArm: 'N' },
    { a: 'B', aArm: 'S', b: 'D', bArm: 'N' },
  ],
};
