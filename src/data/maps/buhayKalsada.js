// More maps inspired by real Philippine roads (the "Buhay-Kalsada" set). Same rules as
// philippines.js: square junctions, trimmed lane counts, roads that bend away from the junctions.
// Every map has its own road layout (no two share a shape): L-bends, staggered T-junctions, a
// triangle, a fork, a hairpin, a square of one-lane streets, an underpass and so on. They also use
// footbridges and pedestrian underpasses (footbridge / pedUnderpass: { arm: distance from the node }).

// ---------------------------------------------------------------- batch A: Metro Manila and Rizal

// A big junction with one U-turn slot, and Ayala Ave running on into the CBD to an offset T.
export const ayala = {
  id: 'ayala',
  name: 'Ayala – EDSA',
  region: 'Metro Manila',
  blurb: 'The Makati CBD gate: EDSA with its busway and a U-turn slot, a footbridge over EDSA and an underpass under Ayala, which runs on into the CBD to end at Paseo de Roxas.',
  sceneSeed: 1960,
  theme: 'metro',
  roads: {
    edsa: { name: 'EDSA', lanes: 5, median: 7, types: ['bus', 'general', 'general', 'general', 'general'] },
    ayala: { name: 'Ayala Ave', lanes: 3, median: 2 },
    paseo: { name: 'Paseo de Roxas', lanes: 2, median: 1 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: 0,
      kind: 'signal',
      arms: { N: 'edsa', S: 'edsa', E: 'ayala', W: 'ayala' },
      noLeft: ['N', 'S'],
      noCrossing: ['N', 'S'],
      footbridge: { N: 48 },
      pedUnderpass: { W: 40 },
      shape: { W: [{ straight: 46 }, { curve: 14, radius: 170 }] },
    },
    { id: 'U1', x: 0, y: -92, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['S'], uturnRate: 0.3 },
    { id: 'B', x: 125, y: 45, kind: 'signal', arms: { W: 'ayala', N: 'paseo', S: 'paseo' }, shape: { N: [{ straight: 40 }, { curve: 20, radius: 120 }] } },
  ],
  links: [
    { a: 'A', aArm: 'N', b: 'U1', bArm: 'S' },
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
  ],
  armLength: 120,
  focus: { minX: -64, maxX: 160, minY: -104, maxY: 100 },
  landmarks: [{ kind: 'mall', x: 62, y: 86, w: 58, h: 36 }],
  overlays: [{ kind: 'rail', line: 'MRT-3', axis: 'y', at: 0, width: 6.2, translucent: true, station: { at: -46, length: 56, name: 'AYALA' } }],
};

// An L: Ortigas Ave leaves EDSA eastward and swings north into ADB Ave.
export const ortigas = {
  id: 'ortigas',
  name: 'Ortigas – EDSA',
  region: 'Metro Manila',
  blurb: 'EDSA meets Ortigas Avenue, which swings north around the malls of the Ortigas Center to ADB Avenue: weekday office rush, weekend and payday mall crowds.',
  sceneSeed: 1983,
  theme: 'metro',
  roads: {
    edsa: { name: 'EDSA', lanes: 4, median: 7, types: ['bus', 'general', 'general', 'general'] },
    ortigas: { name: 'Ortigas Ave', lanes: 3, median: 1.2 },
    adb: { name: 'ADB Ave', lanes: 2, median: 0 },
    meralco: { name: 'Meralco Ave', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -75, y: 40, kind: 'signal', arms: { N: 'edsa', S: 'edsa', E: 'ortigas', W: 'ortigas' }, noCrossing: ['N', 'S'], shape: { W: [{ straight: 40 }, { curve: -18, radius: 140 }] } },
    { id: 'B', x: 65, y: -45, kind: 'signal', arms: { S: 'ortigas', N: 'adb', E: 'meralco' }, shape: { E: [{ straight: 38 }, { curve: 20, radius: 130 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'S' }],
  armLength: 118,
  focus: { minX: -115, maxX: 115, minY: -100, maxY: 95 },
  landmarks: [
    { kind: 'mall', x: 0, y: -58, w: 54, h: 30 },
    { kind: 'mall', x: 0, y: 96, w: 66, h: 34 },
  ],
  overlays: [{ kind: 'rail', line: 'MRT-3', axis: 'y', at: -75, width: 6.2, translucent: true, station: { at: 0, length: 50, name: 'ORTIGAS' } }],
};

// A triangle of streets around the church: every corner is a junction.
export const quiapo = {
  id: 'quiapo',
  name: 'Quiapo – Recto',
  region: 'Metro Manila',
  blurb: 'Downtown Manila at its busiest: Quezon Boulevard, Recto and Hidalgo make a triangle around the church, with the palengke below and jeepneys at every corner.',
  sceneSeed: 1586,
  theme: 'old-manila',
  roads: {
    quezon: { name: 'Quezon Blvd', lanes: 3, median: 1.2 },
    recto: { name: 'C.M. Recto Ave', lanes: 3, median: 1 },
    hidalgo: { name: 'Hidalgo St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: -50, kind: 'signal', arms: { N: 'quezon', S: 'quezon', E: 'recto', W: 'recto' }, shape: { W: [{ straight: 34 }, { curve: 22, radius: 70 }] } },
    { id: 'B', x: -60, y: 45, kind: 'signal', arms: { N: 'quezon', E: 'hidalgo', S: 'quezon' }, shape: { S: [{ straight: 34 }, { curve: 20, radius: 80 }] } },
    { id: 'C', x: 60, y: 45, kind: 'signal', arms: { N: 'recto', W: 'hidalgo', E: 'recto' }, shape: { E: [{ straight: 36 }, { curve: -18, radius: 120 }] } },
  ],
  links: [
    { a: 'A', aArm: 'S', b: 'B', bArm: 'N' },
    { a: 'A', aArm: 'E', b: 'C', bArm: 'N' },
    { a: 'B', aArm: 'E', b: 'C', bArm: 'W' },
  ],
  armLength: 112,
  focus: { minX: -110, maxX: 110, minY: -110, maxY: 110 },
  landmarks: [
    { kind: 'church', x: 12, y: 8, w: 30, h: 20 },
    { kind: 'palengke', x: 0, y: 86, w: 44, h: 28 },
  ],
};

// A signalised T on the boulevard (nothing on the bay side), a U-turn slot and a yield up the side road.
export const baclaran = {
  id: 'baclaran',
  name: 'Roxas Blvd – Baclaran',
  region: 'Metro Manila',
  blurb: 'Roxas Boulevard by the Baclaran church and the bay-side malls: a T-junction with nothing on the bay side, a U-turn slot for the turnarounds, and a barangay road that waits to join Redemptorist Road.',
  sceneSeed: 1932,
  theme: 'metro',
  roads: {
    roxas: { name: 'Roxas Blvd', lanes: 4, median: 4 },
    redemptorist: { name: 'Redemptorist Rd', lanes: 2, median: 0 },
    side: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: 0, kind: 'signal', arms: { N: 'roxas', S: 'roxas', E: 'redemptorist' } },
    { id: 'U1', x: 0, y: 95, kind: 'uturn', arms: { N: 'roxas', S: 'roxas' }, uturn: ['N'], uturnRate: 0.25 },
    {
      id: 'Y1',
      x: 100,
      y: -30,
      kind: 'yield',
      arms: { W: 'redemptorist', E: 'redemptorist', S: 'side' },
      major: ['E', 'W'],
      shape: { S: [{ straight: 36 }, { curve: 35, radius: 35 }, { straight: 18 }, { curve: -35, radius: 35 }] },
    },
  ],
  links: [
    { a: 'A', aArm: 'S', b: 'U1', bArm: 'N' },
    { a: 'A', aArm: 'E', b: 'Y1', bArm: 'W' },
  ],
  armLength: 115,
  focus: { minX: -100, maxX: 140, minY: -75, maxY: 115 },
  landmarks: [
    { kind: 'church', x: 50, y: -66, w: 40, h: 26 },
    { kind: 'mall', x: -72, y: 55, w: 64, h: 38 },
  ],
};

// An inverted T: Aurora Blvd under the LRT-2, and a spur north to the arena road.
export const cubao = {
  id: 'cubao',
  name: 'Cubao – Araneta',
  region: 'Metro Manila',
  blurb: 'Aurora Boulevard under the LRT-2, with P. Tuazon running up to the road behind the Araneta Coliseum: quiet during the game, a flood when it ends.',
  sceneSeed: 1960,
  theme: 'metro',
  roads: {
    aurora: { name: 'Aurora Blvd', lanes: 3, median: 1.2 },
    romulo: { name: 'Gen. Romulo Ave', lanes: 2, median: 0 },
    tuazon: { name: 'P. Tuazon Blvd', lanes: 2, median: 0 },
    arena: { name: 'Araneta Center Rd', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -70, y: 0, kind: 'signal', arms: { N: 'romulo', S: 'romulo', E: 'aurora', W: 'aurora' }, shape: { W: [{ straight: 36 }, { curve: 16, radius: 150 }], N: [{ straight: 36 }, { curve: -20, radius: 120 }] } },
    { id: 'B', x: 70, y: 0, kind: 'signal', arms: { W: 'aurora', E: 'aurora', N: 'tuazon' }, shape: { E: [{ straight: 36 }, { curve: 16, radius: 150 }] } },
    { id: 'C', x: 70, y: -95, kind: 'yield', arms: { S: 'tuazon', E: 'arena', W: 'arena' }, major: ['E', 'W'], shape: { W: [{ straight: 34 }, { curve: 60, radius: 60 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'B', aArm: 'N', b: 'C', bArm: 'S' },
  ],
  armLength: 115,
  focus: { minX: -110, maxX: 110, minY: -135, maxY: 62 },
  landmarks: [
    { kind: 'court', x: 0, y: 46, w: 44, h: 28 },
    { kind: 'mall', x: 0, y: -50, w: 64, h: 32 },
  ],
  overlays: [{ kind: 'rail', line: 'LRT-2', axis: 'x', at: 0, width: 7, translucent: true, station: { at: 0, length: 44, name: 'ARANETA CENTER–CUBAO' } }],
};

// Staggered T-junctions: Kalayaan comes in from the west, Lawton leaves to the east, one block apart.
export const bgc = {
  id: 'bgc',
  name: 'C5 – Kalayaan',
  region: 'Metro Manila',
  blurb: 'C5 on the way into BGC: Kalayaan Avenue joins from the west and Lawton Avenue leaves to the east one block later. Two staggered T-junctions, and cars, cars, cars.',
  sceneSeed: 2003,
  theme: 'metro',
  roads: {
    c5: { name: 'C5 Road', lanes: 4, median: 4 },
    kalayaan: { name: 'Kalayaan Ave', lanes: 3, median: 1.5 },
    lawton: { name: 'Lawton Ave', lanes: 3, median: 1.5 },
  },
  nodes: [
    { id: 'A', x: 0, y: -45, kind: 'signal', arms: { N: 'c5', S: 'c5', W: 'kalayaan' }, noCrossing: ['N', 'S'], shape: { W: [{ straight: 42 }, { curve: 16, radius: 150 }] } },
    { id: 'B', x: 0, y: 45, kind: 'signal', arms: { N: 'c5', S: 'c5', E: 'lawton' }, noCrossing: ['N', 'S'], footbridge: { S: 44 }, shape: { E: [{ straight: 42 }, { curve: -18, radius: 140 }] } },
  ],
  links: [{ a: 'A', aArm: 'S', b: 'B', bArm: 'N' }],
  armLength: 118,
  focus: { minX: -90, maxX: 90, minY: -100, maxY: 100 },
  landmarks: [{ kind: 'mall', x: 66, y: -60, w: 56, h: 36 }],
};

// A T on the highway, with the yield one block up the side road where the barangay road joins.
export const masinag = {
  id: 'masinag',
  name: 'Marcos Hwy – Masinag',
  region: 'Rizal',
  blurb: 'Where Antipolo comes down to Marcos Highway: Sumulong winds down to a T-junction, a barangay road squeezes onto Sumulong just above it, and a school sits by the palengke.',
  sceneSeed: 1972,
  theme: 'province',
  roads: {
    marcos: { name: 'Marcos Hwy', lanes: 3, median: 2 },
    sumulong: { name: 'Sumulong Hwy', lanes: 2, median: 0 },
    brgy: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: 30, kind: 'signal', arms: { W: 'marcos', E: 'marcos', N: 'sumulong' }, shape: { E: [{ straight: 30 }, { curve: -20, radius: 110 }] } },
    {
      id: 'Y1',
      x: -20,
      y: -70,
      kind: 'yield',
      arms: { S: 'sumulong', N: 'sumulong', W: 'brgy' },
      major: ['N', 'S'],
      shape: {
        N: [{ straight: 30 }, { curve: 30, radius: 45 }, { straight: 16 }, { curve: -30, radius: 45 }],
        W: [{ straight: 36 }, { curve: 30, radius: 40 }, { straight: 18 }, { curve: -30, radius: 40 }],
      },
    },
  ],
  links: [{ a: 'Y1', aArm: 'S', b: 'A', bArm: 'N' }],
  armLength: 115,
  focus: { minX: -100, maxX: 100, minY: -120, maxY: 72 },
  landmarks: [
    { kind: 'palengke', x: 0, y: 70, w: 44, h: 26 },
    { kind: 'court', x: 52, y: -40, w: 30, h: 18 },
  ],
};

// A fork: Alabang–Zapote Road splits in two, each branch with its own signal; the mall sits in the fork.
export const alabang = {
  id: 'alabang',
  name: 'Alabang – Zapote',
  region: 'Metro Manila',
  blurb: 'The road out of the metro to Las Piñas and Cavite splits in two around the mall, each branch with its own signal. The whole south goes home for Undas and Holy Week.',
  sceneSeed: 1981,
  theme: 'metro',
  roads: {
    zapote: { name: 'Alabang–Zapote Rd', lanes: 3, median: 1.2 },
    montillano: { name: 'Montillano St', lanes: 2, median: 0 },
    madrigal: { name: 'Madrigal Ave', lanes: 2, median: 1 },
    filinvest: { name: 'Filinvest Ave', lanes: 2, median: 1 },
  },
  nodes: [
    { id: 'A', x: -85, y: 0, kind: 'signal', arms: { W: 'zapote', E: 'zapote', S: 'montillano' }, shape: { W: [{ straight: 36 }, { curve: -22, radius: 120 }] } },
    { id: 'B', x: 65, y: -40, kind: 'signal', arms: { W: 'zapote', E: 'zapote', N: 'madrigal' }, shape: { E: [{ straight: 36 }, { curve: 18, radius: 140 }] } },
    { id: 'C', x: 40, y: 90, kind: 'signal', arms: { N: 'montillano', S: 'montillano', E: 'filinvest' } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'A', aArm: 'S', b: 'C', bArm: 'N' },
  ],
  armLength: 115,
  focus: { minX: -125, maxX: 110, minY: -100, maxY: 130 },
  landmarks: [{ kind: 'mall', x: 22, y: 10, w: 46, h: 26 }],
};

// ---------------------------------------------------------------- batch B: the regions

// A dogleg: España and Quezon Ave do not line up, so traffic jogs between two T-junctions.
export const welcome = {
  id: 'welcome',
  name: 'Quezon Ave – España',
  region: 'Metro Manila',
  blurb: 'Where Quezon City meets Manila: España and Quezon Avenue do not line up, so every car jogs between two T-junctions, one for Mayon and one for E. Rodriguez.',
  sceneSeed: 1948,
  theme: 'old-manila',
  roads: {
    quezon: { name: 'Quezon Ave', lanes: 3, median: 2 },
    espana: { name: 'España Blvd', lanes: 3, median: 1.2 },
    mayon: { name: 'Mayon St', lanes: 2, median: 0 },
    erod: { name: 'E. Rodriguez Sr. Ave', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -45, y: -35, kind: 'signal', arms: { W: 'espana', N: 'mayon', E: 'quezon' }, shape: { W: [{ straight: 46 }, { curve: -18, radius: 160 }] } },
    { id: 'B', x: 45, y: 35, kind: 'signal', arms: { W: 'quezon', E: 'quezon', S: 'erod' }, shape: { E: [{ straight: 46 }, { curve: -20, radius: 150 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 120,
  focus: { minX: -95, maxX: 95, minY: -85, maxY: 85 },
  landmarks: [{ kind: 'park', x: -50, y: 45, w: 40, h: 40 }],
};

// A hairpin: Harrison Rd doubles back on itself down to Abanao, with Burnham Park between the roads.
export const baguio = {
  id: 'baguio',
  name: 'Session Road',
  region: 'Baguio',
  blurb: 'Up in the pines: Session Road comes down to Harrison Road, which doubles back in a hairpin to Abanao Street with Burnham Park in between. Cool air, pine trees and the Panagbenga parade.',
  sceneSeed: 1909,
  theme: 'province',
  roads: {
    session: { name: 'Session Rd', lanes: 2, median: 0 },
    harrison: { name: 'Harrison Rd', lanes: 2, median: 0 },
    abanao: { name: 'Abanao St', lanes: 1, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: -30,
      y: -50,
      kind: 'signal',
      arms: { N: 'session', W: 'harrison', E: 'harrison' },
      shape: { N: [{ straight: 32 }, { curve: -30, radius: 40 }, { straight: 14 }, { curve: 30, radius: 40 }], W: [{ straight: 40 }, { curve: 15, radius: 150 }] },
    },
    { id: 'B', x: -30, y: 50, kind: 'yield', arms: { E: 'harrison', W: 'abanao', S: 'abanao' }, major: ['E', 'W'] },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'E' }],
  armLength: 112,
  focus: { minX: -125, maxX: 40, minY: -110, maxY: 110 },
  landmarks: [{ kind: 'park', x: -92, y: 0, w: 66, h: 46 }],
};

// A staircase: signal, yield, signal, each a step up from the last.
export const cebu = {
  id: 'cebu',
  name: 'Colon – Fuente Osmeña',
  region: 'Cebu',
  blurb: 'From Colon, the oldest street in the country, Osmeña Boulevard climbs in steps past a side street to the Basilica up to Fuente Osmeña. Jeepneys everywhere, and Sinulog in January.',
  sceneSeed: 1565,
  theme: 'old-manila',
  roads: {
    osmena: { name: 'Osmeña Blvd', lanes: 3, median: 1 },
    colon: { name: 'Colon St', lanes: 2, median: 0 },
    burgos: { name: 'P. Burgos St', lanes: 1, median: 0 },
    jones: { name: 'Jones Ave', lanes: 2, median: 0 },
    maxilom: { name: 'Gen. Maxilom Ave', lanes: 2, median: 0 },
    rodriguez: { name: 'B. Rodriguez St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -110, y: 45, kind: 'signal', arms: { N: 'colon', S: 'colon', E: 'osmena', W: 'osmena' }, shape: { W: [{ straight: 34 }, { curve: 20, radius: 90 }] } },
    { id: 'Y', x: 0, y: 0, kind: 'yield', arms: { W: 'osmena', E: 'osmena', N: 'burgos' }, major: ['E', 'W'], shape: { N: [{ straight: 40 }, { curve: -25, radius: 60 }] } },
    { id: 'B', x: 110, y: -45, kind: 'signal', arms: { W: 'osmena', E: 'jones', N: 'maxilom', S: 'rodriguez' }, shape: { E: [{ straight: 34 }, { curve: -18, radius: 120 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'Y', bArm: 'W' },
    { a: 'Y', aArm: 'E', b: 'B', bArm: 'W' },
  ],
  armLength: 115,
  focus: { minX: -150, maxX: 150, minY: -100, maxY: 100 },
  landmarks: [
    { kind: 'church', x: -62, y: -40, w: 38, h: 26 },
    { kind: 'park', x: 55, y: 45, w: 44, h: 30 },
  ],
};

// A square of one-lane streets inside the walls: two signals and two give-way corners.
export const intramuros = {
  id: 'intramuros',
  name: 'Intramuros',
  region: 'Metro Manila',
  blurb: 'Inside the old walled city: a square of one-lane cobbled streets around San Agustin, kalesas at a horse’s pace and tourists on every sidewalk.',
  sceneSeed: 1571,
  theme: 'old-manila',
  roads: {
    luna: { name: 'Gen. Luna St', lanes: 1, median: 0 },
    cabildo: { name: 'Cabildo St', lanes: 1, median: 0 },
    real: { name: 'Calle Real', lanes: 1, median: 0 },
    lucia: { name: 'Sta. Lucia St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: -45, y: -45, kind: 'signal', arms: { N: 'luna', S: 'luna', W: 'real', E: 'real' }, shape: { W: [{ straight: 34 }, { curve: 25, radius: 50 }] } },
    { id: 'B', x: 45, y: -45, kind: 'yield', arms: { N: 'cabildo', S: 'cabildo', W: 'real', E: 'real' }, major: ['E', 'W'] },
    { id: 'C', x: -45, y: 45, kind: 'yield', arms: { N: 'luna', S: 'luna', W: 'lucia', E: 'lucia' }, major: ['N', 'S'] },
    { id: 'D', x: 45, y: 45, kind: 'signal', arms: { N: 'cabildo', S: 'cabildo', W: 'lucia', E: 'lucia' }, shape: { S: [{ straight: 34 }, { curve: -25, radius: 50 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'A', aArm: 'S', b: 'C', bArm: 'N' },
    { a: 'B', aArm: 'S', b: 'D', bArm: 'N' },
    { a: 'C', aArm: 'E', b: 'D', bArm: 'W' },
  ],
  armLength: 100,
  focus: { minX: -95, maxX: 95, minY: -95, maxY: 95 },
  landmarks: [
    { kind: 'church', x: 0, y: 0, w: 34, h: 24 },
    { kind: 'park', x: 100, y: -100, w: 44, h: 30 },
  ],
};

// A crescent: three signals along a gently curving avenue, for a three-light green wave.
export const davao = {
  id: 'davao',
  name: 'Roxas Ave – Davao',
  region: 'Davao',
  blurb: 'Davao City’s main avenue curves past three signals: drivers who follow the rules, a strict speed limit and enforcers who mean it. The challenge is pure signal timing.',
  sceneSeed: 1936,
  theme: 'metro',
  roads: {
    roxas: { name: 'Roxas Ave', lanes: 3, median: 2 },
    sanpedro: { name: 'San Pedro St', lanes: 2, median: 0 },
    claveria: { name: 'Claveria St', lanes: 2, median: 0 },
    ponciano: { name: 'Ponciano Reyes St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -115, y: 35, kind: 'signal', arms: { N: 'sanpedro', S: 'sanpedro', E: 'roxas', W: 'roxas' }, shape: { W: [{ straight: 36 }, { curve: 15, radius: 160 }] } },
    { id: 'B', x: 0, y: 0, kind: 'signal', arms: { N: 'claveria', S: 'claveria', E: 'roxas', W: 'roxas' } },
    { id: 'C', x: 115, y: 35, kind: 'signal', arms: { N: 'ponciano', S: 'ponciano', E: 'roxas', W: 'roxas' }, shape: { E: [{ straight: 36 }, { curve: -15, radius: 160 }] } },
  ],
  links: [
    { a: 'A', aArm: 'E', b: 'B', bArm: 'W' },
    { a: 'B', aArm: 'E', b: 'C', bArm: 'W' },
  ],
  armLength: 118,
  focus: { minX: -160, maxX: 160, minY: -70, maxY: 85 },
  landmarks: [{ kind: 'park', x: -57, y: 72, w: 50, h: 30 }],
};

// An underpass: the middle lanes of Diversion Road dive under the junction; a yield up the cross street.
export const iloilo = {
  id: 'iloilo',
  name: 'Diversion Road – Iloilo',
  region: 'Iloilo',
  blurb: 'A wide, fast road whose middle lanes dive under the junction. The outer lanes and Lopez Jaena share the signal, and a barangay road up the street gives way. Traffic arrives quickly.',
  sceneSeed: 1937,
  theme: 'province',
  roads: {
    diversion: { name: 'Diversion Rd', lanes: 3, median: 3, types: ['tunnel', 'general', 'general'] },
    jaena: { name: 'Lopez Jaena St', lanes: 2, median: 0 },
    brgy: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: 0,
      y: 0,
      kind: 'signal',
      underpass: true,
      arms: { N: 'jaena', S: 'jaena', E: 'diversion', W: 'diversion' },
      shape: { W: [{ straight: 80 }, { curve: 15, radius: 200 }], E: [{ straight: 80 }, { curve: -15, radius: 200 }] },
    },
    { id: 'Y1', x: 0, y: -90, kind: 'yield', arms: { S: 'jaena', N: 'jaena', W: 'brgy', E: 'brgy' }, major: ['N', 'S'] },
  ],
  links: [{ a: 'A', aArm: 'N', b: 'Y1', bArm: 'S' }],
  armLength: 150,
  focus: { minX: -130, maxX: 130, minY: -130, maxY: 65 },
  landmarks: [{ kind: 'mall', x: 80, y: 52, w: 70, h: 36 }],
};

// A ridge road: an unsignalised crossroads (the through road has priority) and one signal toward Nasugbu.
export const tagaytay = {
  id: 'tagaytay',
  name: 'Tagaytay Ridge',
  region: 'Cavite',
  blurb: 'The ridge road with no lights where Aguinaldo Highway brings the weekend crowd from Manila. The side roads give way, and the road to Nasugbu has one signal.',
  sceneSeed: 1938,
  theme: 'province',
  roads: {
    aguinaldo: { name: 'Aguinaldo Hwy', lanes: 2, median: 1 },
    calamba: { name: 'Tagaytay–Calamba Rd', lanes: 2, median: 0 },
    sungay: { name: 'Sungay Rd', lanes: 1, median: 0 },
    nasugbu: { name: 'Tagaytay–Nasugbu Hwy', lanes: 2, median: 0 },
    brgy: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    {
      id: 'A',
      x: -80,
      y: 0,
      kind: 'yield',
      arms: { N: 'aguinaldo', S: 'calamba', W: 'sungay', E: 'nasugbu' },
      major: ['N', 'S'],
      shape: { N: [{ straight: 36 }, { curve: 20, radius: 120 }], S: [{ straight: 36 }, { curve: -20, radius: 120 }] },
    },
    { id: 'B', x: 75, y: -35, kind: 'signal', arms: { W: 'nasugbu', E: 'nasugbu', S: 'brgy' }, shape: { E: [{ straight: 30 }, { curve: 24, radius: 90 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -120, maxX: 115, minY: -90, maxY: 75 },
  landmarks: [{ kind: 'park', x: -10, y: 55, w: 48, h: 30 }],
};

// A chain along Lacson St: a give-way corner, the signal, another give-way corner.
export const bacolod = {
  id: 'bacolod',
  name: 'Lacson St – Bacolod',
  region: 'Negros Occidental',
  blurb: 'The City of Smiles: Lacson Street runs past the plaza and the mall, with one signal at Burgos Avenue and side streets that give way above and below it. Tricycles by the dozen, and the MassKara parade every October.',
  sceneSeed: 1980,
  theme: 'province',
  roads: {
    lacson: { name: 'Lacson St', lanes: 3, median: 2 },
    burgos: { name: 'Burgos Ave', lanes: 2, median: 0 },
    galo: { name: 'Galo St', lanes: 1, median: 0 },
    araneta: { name: 'Araneta St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'Y1', x: 0, y: -85, kind: 'yield', arms: { N: 'lacson', S: 'lacson', W: 'galo' }, major: ['N', 'S'], shape: { W: [{ straight: 40 }, { curve: 25, radius: 50 }] } },
    { id: 'A', x: 0, y: 0, kind: 'signal', arms: { N: 'lacson', S: 'lacson', E: 'burgos', W: 'burgos' }, shape: { W: [{ straight: 40 }, { curve: -16, radius: 150 }], E: [{ straight: 40 }, { curve: 16, radius: 150 }] } },
    { id: 'Y2', x: 0, y: 85, kind: 'yield', arms: { N: 'lacson', S: 'lacson', E: 'araneta' }, major: ['N', 'S'], shape: { E: [{ straight: 40 }, { curve: 25, radius: 50 }] } },
  ],
  links: [
    { a: 'Y1', aArm: 'S', b: 'A', bArm: 'N' },
    { a: 'A', aArm: 'S', b: 'Y2', bArm: 'N' },
  ],
  armLength: 115,
  focus: { minX: -90, maxX: 90, minY: -125, maxY: 125 },
  landmarks: [
    { kind: 'park', x: -55, y: -42, w: 60, h: 34 },
    { kind: 'mall', x: 55, y: 42, w: 60, h: 34 },
  ],
};

// ---------------------------------------------------------------- batch C: player-sketched towns

export const bayanihan = {
  id: 'bayanihan',
  name: 'Bayanihan',
  region: 'Lalawigan',
  blurb: 'A busy town centre: six signals on Rizal Avenue and its side streets, the plaza junction where every side street meets, a U-turn slot and a barangay road that merges without lights.',
  sceneSeed: 1898,
  theme: 'province',
  roads: {
    rizal: { name: 'Rizal Ave', lanes: 3, median: 1 },
    mabini: { name: 'Mabini St', lanes: 2, median: 0 },
    bonifacio: { name: 'Bonifacio St', lanes: 2, median: 0 },
    luna: { name: 'Luna St', lanes: 2, median: 0 },
    burgos: { name: 'Burgos St', lanes: 2, median: 0 },
    delpilar: { name: 'Del Pilar St', lanes: 2, median: 0 },
    sampaguita: { name: 'Sampaguita St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: -90, y: -135, kind: 'signal', arms: { N: 'mabini', W: 'luna', S: 'mabini' } },
    { id: 'B', x: -25, y: 0, kind: 'signal', arms: { W: 'mabini', N: 'bonifacio', E: 'rizal', S: 'burgos' } },
    { id: 'C', x: 200, y: -150, kind: 'signal', arms: { N: 'delpilar', E: 'luna', W: 'bonifacio', S: 'rizal' }, footbridge: { N: 40 } },
    { id: 'U', x: 50, y: 0, kind: 'uturn', arms: { W: 'rizal', E: 'rizal' }, uturn: ['W', 'E'], uturnRate: 0.2 },
    { id: 'D', x: 125, y: 0, kind: 'signal', arms: { W: 'rizal', N: 'rizal', E: 'delpilar', S: 'burgos' }, shape: { E: [{ straight: 40 }, { curve: 30, radius: 90 }] } },
    { id: 'F', x: -25, y: 110, kind: 'signal', arms: { N: 'burgos', W: 'luna', E: 'luna', S: 'burgos' } },
    { id: 'G', x: 125, y: 110, kind: 'signal', arms: { N: 'burgos', W: 'luna', S: 'burgos' } },
    { id: 'Y', x: -150, y: 110, kind: 'yield', arms: { E: 'luna', W: 'luna', S: 'sampaguita' }, major: ['E', 'W'], shape: { S: [{ straight: 36 }, { curve: -40, radius: 30 }, { straight: 20 }, { curve: 55, radius: 28 }] } },
  ],
  links: [
    { a: 'A', aArm: 'S', b: 'B', bArm: 'W' },
    { a: 'B', aArm: 'N', b: 'C', bArm: 'W' },
    { a: 'B', aArm: 'E', b: 'U', bArm: 'W' },
    { a: 'U', aArm: 'E', b: 'D', bArm: 'W' },
    { a: 'C', aArm: 'S', b: 'D', bArm: 'N' },
    { a: 'B', aArm: 'S', b: 'F', bArm: 'N' },
    { a: 'D', aArm: 'S', b: 'G', bArm: 'N' },
    { a: 'F', aArm: 'E', b: 'G', bArm: 'W' },
    { a: 'Y', aArm: 'E', b: 'F', bArm: 'W' },
  ],
  armLength: 110,
  focus: { minX: -200, maxX: 250, minY: -210, maxY: 170 },
  landmarks: [
    { kind: 'church', x: -150, y: -175, w: 40, h: 28 },
    { kind: 'palengke', x: 60, y: -55, w: 60, h: 34 },
    { kind: 'park', x: 200, y: 40, w: 48, h: 40 },
  ],
};

// A mountain town where the main road winds inward up the hill, Baguio-style.
export const ikotbundok = {
  id: 'ikotbundok',
  name: 'Ikot-Bundok',
  region: 'Cordillera',
  blurb: 'Up the mountain: Zigzag Road spirals inward past six junctions to the hilltop crossing, with vegetable trucks coming down from the farms.',
  sceneSeed: 1925,
  theme: 'province',
  roads: {
    zigzag: { name: 'Zigzag Rd', lanes: 2, median: 0 },
    pino: { name: 'Pino St', lanes: 2, median: 0 },
    ulap: { name: 'Ulap Rd', lanes: 1, median: 0 },
    strawberry: { name: 'Strawberry Farm Rd', lanes: 1, median: 0 },
    minahan: { name: 'Minahan Rd', lanes: 1, median: 0 },
    palengke: { name: 'Palengke St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'I1', x: -200, y: 150, kind: 'signal', arms: { N: 'zigzag', E: 'pino', W: 'minahan', S: 'zigzag' }, shape: { S: [{ straight: 34 }, { curve: -50, radius: 40 }, { straight: 22 }, { curve: 100, radius: 36 }, { straight: 22 }, { curve: -50, radius: 40 }] } },
    { id: 'I2', x: -200, y: -120, kind: 'signal', arms: { S: 'zigzag', E: 'zigzag', N: 'ulap', W: 'pino' } },
    { id: 'R1', x: 60, y: -170, kind: 'signal', arms: { W: 'zigzag', E: 'zigzag', S: 'palengke', N: 'strawberry' }, shape: { N: [{ straight: 48 }, { curve: -30, radius: 40 }, { straight: 14 }, { curve: 30, radius: 40 }] } },
    { id: 'I3', x: 220, y: -20, kind: 'signal', arms: { N: 'zigzag', S: 'zigzag', W: 'palengke', E: 'ulap' } },
    { id: 'I4', x: 120, y: 140, kind: 'signal', arms: { E: 'zigzag', W: 'zigzag', N: 'palengke', S: 'minahan' } },
    { id: 'R2', x: -60, y: 60, kind: 'signal', arms: { E: 'zigzag', W: 'pino', N: 'zigzag', S: 'pino' } },
    { id: 'I5', x: 40, y: -40, kind: 'signal', arms: { N: 'palengke', E: 'palengke', S: 'palengke', W: 'zigzag' } },
  ],
  links: [
    { a: 'I1', aArm: 'N', b: 'I2', bArm: 'S' },
    { a: 'I2', aArm: 'E', b: 'R1', bArm: 'W' },
    { a: 'R1', aArm: 'E', b: 'I3', bArm: 'N' },
    { a: 'I3', aArm: 'S', b: 'I4', bArm: 'E' },
    { a: 'I4', aArm: 'W', b: 'R2', bArm: 'E' },
    { a: 'R2', aArm: 'N', b: 'I5', bArm: 'W' },
    { a: 'I1', aArm: 'E', b: 'R2', bArm: 'W' },
    { a: 'R1', aArm: 'S', b: 'I5', bArm: 'N' },
    { a: 'I3', aArm: 'W', b: 'I5', bArm: 'E' },
    { a: 'I4', aArm: 'N', b: 'I5', bArm: 'S' },
  ],
  armLength: 110,
  focus: { minX: -260, maxX: 280, minY: -230, maxY: 210 },
  landmarks: [
    { kind: 'park', x: -120, y: -40, w: 60, h: 60 },
    { kind: 'church', x: 120, y: -80, w: 36, h: 26 },
  ],
};
