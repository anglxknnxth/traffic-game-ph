// Generic training maps: plain two-lane-per-direction roads with no median.
// `single` and `double` reproduce the original layouts exactly.

const street = { lanes: 2, median: 0 };
const four = { N: 'street', E: 'street', S: 'street', W: 'street' };

export const single = {
  id: 'single',
  name: 'Kanto',
  region: 'Training',
  sceneSeed: 1898,
  roads: { street },
  nodes: [{ id: 'A', x: 0, y: 0, kind: 'signal', arms: four }],
  links: [],
};

export const double = {
  id: 'double',
  name: 'Dalawang Kanto',
  region: 'Training',
  sceneSeed: 2024,
  roads: { street },
  nodes: [
    { id: 'A', x: -38, y: 0, kind: 'signal', arms: four },
    { id: 'B', x: 38, y: 0, kind: 'signal', arms: four },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
};

export const corridor = {
  id: 'corridor',
  name: 'Tatlong Kanto',
  region: 'Training',
  sceneSeed: 3131,
  roads: { street },
  nodes: [
    { id: 'A', x: -76, y: 0, kind: 'signal', arms: four },
    { id: 'B', x: 0, y: 0, kind: 'signal', arms: four },
    { id: 'C', x: 76, y: 0, kind: 'signal', arms: four },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'B', aArm: 'E', b: 'C', bArm: 'W' },
  ],
};

export const grid = {
  id: 'grid',
  name: 'Grid ng Maynila',
  region: 'Training',
  sceneSeed: 4444,
  roads: { street },
  nodes: [
    { id: 'A', x: -40, y: -40, kind: 'signal', arms: four },
    { id: 'B', x: 40, y: -40, kind: 'signal', arms: four },
    { id: 'C', x: -40, y: 40, kind: 'signal', arms: four },
    { id: 'D', x: 40, y: 40, kind: 'signal', arms: four },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'C', aArm: 'E', b: 'D', bArm: 'W' },
    { a: 'A', aArm: 'S', b: 'C', bArm: 'N' },
    { a: 'B', aArm: 'S', b: 'D', bArm: 'N' },
  ],
};
