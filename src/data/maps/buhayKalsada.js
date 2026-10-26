// More maps inspired by real Philippine roads (the "Buhay-Kalsada" set). Same rules as
// philippines.js: square junctions, trimmed lane counts, roads that bend away from the junctions.
// These also use the rotonda node modifier (rotonda: { island, lanes }), footbridges and
// pedestrian underpasses (footbridge / pedUnderpass: { arm: distance from the node }).

// ---------------------------------------------------------------- batch A: Metro Manila and Rizal

export const ayala = {
  id: 'ayala',
  name: 'Ayala – EDSA',
  region: 'Metro Manila',
  blurb: 'The Makati CBD gate: EDSA with its busway and U-turn slots, Ayala Avenue full of office workers, a footbridge over EDSA and an underpass under Ayala.',
  sceneSeed: 1960,
  theme: 'metro',
  roads: {
    edsa: { name: 'EDSA', lanes: 5, median: 7, types: ['bus', 'general', 'general', 'general', 'general'] },
    ayala: { name: 'Ayala Ave', lanes: 3, median: 2 },
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
      pedUnderpass: { E: 44 },
      shape: { W: [{ straight: 46 }, { curve: 14, radius: 170 }], E: [{ straight: 60 }, { curve: -12, radius: 180 }] },
    },
    { id: 'U1', x: 0, y: -92, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['S'], uturnRate: 0.3 },
    { id: 'U2', x: 0, y: 92, kind: 'uturn', arms: { N: 'edsa', S: 'edsa' }, uturn: ['N'], uturnRate: 0.3 },
  ],
  links: [
    { a: 'A', aArm: 'N', b: 'U1', bArm: 'S' },
    { a: 'A', aArm: 'S', b: 'U2', bArm: 'N' },
  ],
  armLength: 120,
  focus: { minX: -64, maxX: 64, minY: -104, maxY: 104 },
  landmarks: [{ kind: 'mall', x: 78, y: 58, w: 58, h: 38 }],
  overlays: [{ kind: 'rail', line: 'MRT-3', axis: 'y', at: 0, width: 6.2, translucent: true, station: { at: -46, length: 56, name: 'AYALA' } }],
};

export const ortigas = {
  id: 'ortigas',
  name: 'Ortigas – EDSA',
  region: 'Metro Manila',
  blurb: 'EDSA meets Ortigas Avenue by the malls of the Ortigas Center: weekday office rush, weekend and payday mall crowds.',
  sceneSeed: 1983,
  theme: 'metro',
  roads: {
    edsa: { name: 'EDSA', lanes: 4, median: 7, types: ['bus', 'general', 'general', 'general'] },
    ortigas: { name: 'Ortigas Ave', lanes: 3, median: 1.2 },
    adb: { name: 'ADB Ave', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -72, y: 0, kind: 'signal', arms: { N: 'edsa', S: 'edsa', E: 'ortigas', W: 'ortigas' }, noCrossing: ['N', 'S'], shape: { W: [{ straight: 40 }, { curve: -18, radius: 140 }] } },
    { id: 'B', x: 72, y: 0, kind: 'signal', arms: { N: 'adb', S: 'adb', E: 'ortigas', W: 'ortigas' }, shape: { E: [{ straight: 38 }, { curve: 20, radius: 130 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 118,
  focus: { minX: -112, maxX: 112, minY: -62, maxY: 62 },
  landmarks: [
    { kind: 'mall', x: 0, y: 48, w: 66, h: 34 },
    { kind: 'mall', x: 0, y: -50, w: 54, h: 30 },
  ],
  overlays: [{ kind: 'rail', line: 'MRT-3', axis: 'y', at: -72, width: 6.2, translucent: true, station: { at: -40, length: 50, name: 'ORTIGAS' } }],
};

export const quiapo = {
  id: 'quiapo',
  name: 'Quiapo – Recto',
  region: 'Metro Manila',
  blurb: 'Downtown Manila at its busiest: Quezon Boulevard past the church and the palengke, jeepneys at every corner and crowds everywhere.',
  sceneSeed: 1586,
  theme: 'old-manila',
  roads: {
    quezon: { name: 'Quezon Blvd', lanes: 3, median: 1.2 },
    recto: { name: 'C.M. Recto Ave', lanes: 3, median: 1 },
    hidalgo: { name: 'Hidalgo St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: -46, kind: 'signal', arms: { N: 'quezon', S: 'quezon', E: 'recto', W: 'recto' }, shape: { E: [{ straight: 34 }, { curve: -22, radius: 70 }] } },
    { id: 'B', x: 0, y: 46, kind: 'signal', arms: { N: 'quezon', S: 'quezon', E: 'hidalgo', W: 'hidalgo' } },
  ],
  links: [{ a: 'A', aArm: 'S', b: 'B', bArm: 'N' }],
  armLength: 112,
  focus: { minX: -60, maxX: 60, minY: -96, maxY: 96 },
  landmarks: [
    { kind: 'church', x: -50, y: 72, w: 38, h: 26 },
    { kind: 'palengke', x: 52, y: 76, w: 44, h: 28 },
  ],
};

export const baclaran = {
  id: 'baclaran',
  name: 'Roxas Blvd – Baclaran',
  region: 'Metro Manila',
  blurb: 'Roxas Boulevard by the Baclaran church and the bay-side malls: concerts let out, devotees cross, and a barangay road waits to join.',
  sceneSeed: 1932,
  theme: 'metro',
  roads: {
    roxas: { name: 'Roxas Blvd', lanes: 4, median: 4 },
    redemptorist: { name: 'Redemptorist Rd', lanes: 2, median: 0 },
    side: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: -40, y: 0, kind: 'signal', arms: { N: 'roxas', S: 'roxas', E: 'redemptorist', W: 'redemptorist' } },
    {
      id: 'Y1',
      x: 60,
      y: 0,
      kind: 'yield',
      arms: { W: 'redemptorist', E: 'redemptorist', S: 'side' },
      major: ['E', 'W'],
      shape: { S: [{ straight: 36 }, { curve: 35, radius: 35 }, { straight: 18 }, { curve: -35, radius: 35 }] },
    },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'Y1', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -96, maxX: 96, minY: -62, maxY: 62 },
  landmarks: [
    { kind: 'church', x: 12, y: -40, w: 40, h: 26 },
    { kind: 'mall', x: -100, y: 58, w: 64, h: 38 },
  ],
};

export const cubao = {
  id: 'cubao',
  name: 'Cubao – Araneta',
  region: 'Metro Manila',
  blurb: 'Aurora Boulevard under the LRT-2 between the Araneta Coliseum and the Cubao malls: quiet during the game, a flood when it ends.',
  sceneSeed: 1960,
  theme: 'metro',
  roads: {
    aurora: { name: 'Aurora Blvd', lanes: 3, median: 1.2 },
    romulo: { name: 'Gen. Romulo Ave', lanes: 2, median: 0 },
    tuazon: { name: 'P. Tuazon Blvd', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -60, y: 0, kind: 'signal', arms: { N: 'romulo', S: 'romulo', E: 'aurora', W: 'aurora' }, shape: { W: [{ straight: 36 }, { curve: 16, radius: 150 }] } },
    { id: 'B', x: 60, y: 0, kind: 'signal', arms: { N: 'tuazon', S: 'tuazon', E: 'aurora', W: 'aurora' }, shape: { E: [{ straight: 36 }, { curve: -16, radius: 150 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -100, maxX: 100, minY: -62, maxY: 62 },
  landmarks: [
    { kind: 'court', x: 0, y: 46, w: 44, h: 28 },
    { kind: 'mall', x: 0, y: -48, w: 64, h: 32 },
  ],
  overlays: [{ kind: 'rail', line: 'LRT-2', axis: 'x', at: 0, width: 7, translucent: true, station: { at: 0, length: 44, name: 'ARANETA CENTER–CUBAO' } }],
};

export const bgc = {
  id: 'bgc',
  name: 'C5 – Kalayaan',
  region: 'Metro Manila',
  blurb: 'C5 at Kalayaan Avenue on the way into BGC: no left turns, U-turn slots on both sides, and cars, cars, cars.',
  sceneSeed: 2003,
  theme: 'metro',
  roads: {
    c5: { name: 'C5 Road', lanes: 4, median: 4 },
    kalayaan: { name: 'Kalayaan Ave', lanes: 3, median: 1.5 },
  },
  nodes: [
    { id: 'A', x: 0, y: 0, kind: 'signal', arms: { N: 'c5', S: 'c5', E: 'kalayaan', W: 'kalayaan' }, noLeft: ['N', 'S'], noCrossing: ['N', 'S'], footbridge: { S: 44 }, shape: { E: [{ straight: 42 }, { curve: -18, radius: 140 }], W: [{ straight: 42 }, { curve: 16, radius: 150 }] } },
    { id: 'U1', x: 0, y: -90, kind: 'uturn', arms: { N: 'c5', S: 'c5' }, uturn: ['S'], uturnRate: 0.28 },
    { id: 'U2', x: 0, y: 90, kind: 'uturn', arms: { N: 'c5', S: 'c5' }, uturn: ['N'], uturnRate: 0.28 },
  ],
  links: [
    { a: 'A', aArm: 'N', b: 'U1', bArm: 'S' },
    { a: 'A', aArm: 'S', b: 'U2', bArm: 'N' },
  ],
  armLength: 118,
  focus: { minX: -62, maxX: 62, minY: -102, maxY: 102 },
  landmarks: [{ kind: 'mall', x: 74, y: -56, w: 56, h: 36 }],
};

export const masinag = {
  id: 'masinag',
  name: 'Marcos Hwy – Masinag',
  region: 'Rizal',
  blurb: 'Where Antipolo comes down to Marcos Highway: tricycles and jeepneys, a school by the palengke, and a barangay road that has to wait its turn.',
  sceneSeed: 1972,
  theme: 'province',
  roads: {
    marcos: { name: 'Marcos Hwy', lanes: 3, median: 2 },
    sumulong: { name: 'Sumulong Hwy', lanes: 2, median: 0 },
    brgy: { name: 'Brgy. Road', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: -60, y: 0, kind: 'signal', arms: { N: 'sumulong', S: 'sumulong', E: 'marcos', W: 'marcos' }, shape: { N: [{ straight: 34 }, { curve: 30, radius: 45 }, { straight: 16 }, { curve: -30, radius: 45 }] } },
    { id: 'Y1', x: 62, y: 0, kind: 'yield', arms: { W: 'marcos', E: 'marcos', N: 'brgy' }, major: ['E', 'W'], shape: { E: [{ straight: 30 }, { curve: -20, radius: 110 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'Y1', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -100, maxX: 100, minY: -58, maxY: 58 },
  landmarks: [
    { kind: 'palengke', x: 2, y: 42, w: 44, h: 26 },
    { kind: 'court', x: 4, y: -40, w: 30, h: 18 },
  ],
};

export const alabang = {
  id: 'alabang',
  name: 'Alabang – Zapote',
  region: 'Metro Manila',
  blurb: 'The road out of the metro to Las Piñas and Cavite: a mall in the middle, and the whole south going home for Undas and Holy Week.',
  sceneSeed: 1981,
  theme: 'metro',
  roads: {
    zapote: { name: 'Alabang–Zapote Rd', lanes: 3, median: 1.2 },
    montillano: { name: 'Montillano St', lanes: 2, median: 0 },
    madrigal: { name: 'Madrigal Ave', lanes: 2, median: 1 },
  },
  nodes: [
    { id: 'A', x: -66, y: 0, kind: 'signal', arms: { N: 'montillano', S: 'montillano', E: 'zapote', W: 'zapote' }, shape: { W: [{ straight: 36 }, { curve: -22, radius: 120 }] } },
    { id: 'B', x: 66, y: 0, kind: 'signal', arms: { N: 'madrigal', S: 'madrigal', E: 'zapote', W: 'zapote' }, shape: { E: [{ straight: 36 }, { curve: 18, radius: 140 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -106, maxX: 106, minY: -60, maxY: 60 },
  landmarks: [{ kind: 'mall', x: 0, y: 48, w: 66, h: 34 }],
};

// ---------------------------------------------------------------- batch B: rotondas and the regions

export const welcome = {
  id: 'welcome',
  name: 'Welcome Rotonda',
  region: 'Metro Manila',
  blurb: 'The signalised rotonda where Quezon City meets Manila: Quezon Avenue, España, Mayon and E. Rodriguez all feed one ring around the monument.',
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

export const baguio = {
  id: 'baguio',
  name: 'Session Road',
  region: 'Baguio',
  blurb: 'Up in the pines: Session Road comes down to Harrison Road and the Burnham Park rotonda. Cool air, pine trees and the Panagbenga parade.',
  sceneSeed: 1909,
  theme: 'province',
  roads: {
    session: { name: 'Session Rd', lanes: 2, median: 0 },
    harrison: { name: 'Harrison Rd', lanes: 2, median: 0 },
    abanao: { name: 'Abanao St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: -72, y: 0, kind: 'signal', arms: { N: 'session', S: 'session', E: 'harrison', W: 'harrison' }, shape: { N: [{ straight: 32 }, { curve: -30, radius: 40 }, { straight: 14 }, { curve: 30, radius: 40 }] } },
    { id: 'B', x: 78, y: 0, kind: 'yield', rotonda: { island: 9, lanes: 1 }, major: [], rolling: true, arms: { W: 'harrison', E: 'harrison', N: 'abanao', S: 'abanao' } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 112,
  focus: { minX: -110, maxX: 112, minY: -62, maxY: 62 },
  landmarks: [{ kind: 'park', x: 78, y: 70, w: 70, h: 44 }],
};

export const cebu = {
  id: 'cebu',
  name: 'Colon – Fuente Osmeña',
  region: 'Cebu',
  blurb: 'From Colon, the oldest street in the country, up Osmeña Boulevard to the Fuente Osmeña rotonda. Jeepneys everywhere, and Sinulog in January.',
  sceneSeed: 1565,
  theme: 'old-manila',
  roads: {
    osmena: { name: 'Osmeña Blvd', lanes: 3, median: 1 },
    colon: { name: 'Colon St', lanes: 2, median: 0 },
    jones: { name: 'Jones Ave', lanes: 2, median: 0 },
    maxilom: { name: 'Gen. Maxilom Ave', lanes: 2, median: 0 },
    rodriguez: { name: 'B. Rodriguez St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -84, y: 0, kind: 'signal', arms: { N: 'colon', S: 'colon', E: 'osmena', W: 'osmena' }, shape: { W: [{ straight: 34 }, { curve: 20, radius: 90 }] } },
    { id: 'B', x: 86, y: 0, kind: 'signal', rotonda: { island: 13, lanes: 2 }, arms: { W: 'osmena', E: 'jones', N: 'maxilom', S: 'rodriguez' } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -122, maxX: 130, minY: -70, maxY: 70 },
  landmarks: [{ kind: 'church', x: -84, y: 58, w: 38, h: 26 }],
};

export const intramuros = {
  id: 'intramuros',
  name: 'Intramuros',
  region: 'Metro Manila',
  blurb: 'Inside the old walled city: one-lane cobbled streets, kalesas at a horse’s pace, tourists on every sidewalk and San Agustin Church on the corner.',
  sceneSeed: 1571,
  theme: 'old-manila',
  roads: {
    luna: { name: 'Gen. Luna St', lanes: 1, median: 0 },
    real: { name: 'Calle Real', lanes: 1, median: 0 },
    lucia: { name: 'Sta. Lucia St', lanes: 1, median: 0 },
  },
  nodes: [
    { id: 'A', x: 0, y: -45, kind: 'signal', arms: { N: 'luna', S: 'luna', E: 'real', W: 'real' }, shape: { W: [{ straight: 34 }, { curve: 25, radius: 50 }] } },
    { id: 'B', x: 0, y: 45, kind: 'yield', arms: { N: 'luna', S: 'luna', E: 'lucia', W: 'lucia' }, major: ['N', 'S'] },
  ],
  links: [{ a: 'A', aArm: 'S', b: 'B', bArm: 'N' }],
  armLength: 108,
  focus: { minX: -56, maxX: 56, minY: -92, maxY: 92 },
  landmarks: [
    { kind: 'church', x: -40, y: 75, w: 36, h: 24 },
    { kind: 'park', x: 40, y: -80, w: 44, h: 30 },
  ],
};

export const davao = {
  id: 'davao',
  name: 'Roxas Ave – Davao',
  region: 'Davao',
  blurb: 'Davao City’s main avenue: drivers who follow the rules, a strict speed limit and enforcers who mean it. The challenge is pure signal timing.',
  sceneSeed: 1936,
  theme: 'metro',
  roads: {
    roxas: { name: 'Roxas Ave', lanes: 3, median: 2 },
    sanpedro: { name: 'San Pedro St', lanes: 2, median: 0 },
    ponciano: { name: 'Ponciano Reyes St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -70, y: 0, kind: 'signal', arms: { N: 'sanpedro', S: 'sanpedro', E: 'roxas', W: 'roxas' } },
    { id: 'B', x: 70, y: 0, kind: 'signal', arms: { N: 'ponciano', S: 'ponciano', E: 'roxas', W: 'roxas' }, shape: { E: [{ straight: 36 }, { curve: -18, radius: 130 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 118,
  focus: { minX: -108, maxX: 108, minY: -60, maxY: 60 },
  landmarks: [{ kind: 'park', x: 0, y: 50, w: 60, h: 36 }],
};

export const iloilo = {
  id: 'iloilo',
  name: 'Diversion Road – Iloilo',
  region: 'Iloilo',
  blurb: 'A wide, fast road with long straight approaches and few jeepneys. Traffic arrives quickly: give it a green before the queue reaches the edge.',
  sceneSeed: 1937,
  theme: 'province',
  roads: {
    diversion: { name: 'Diversion Rd', lanes: 3, median: 3 },
    jaena: { name: 'Lopez Jaena St', lanes: 2, median: 0 },
    pototan: { name: 'Pototan Rd', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -88, y: 0, kind: 'signal', arms: { N: 'jaena', S: 'jaena', E: 'diversion', W: 'diversion' }, shape: { W: [{ straight: 50 }, { curve: 15, radius: 200 }] } },
    { id: 'B', x: 88, y: 0, kind: 'signal', arms: { N: 'pototan', S: 'pototan', E: 'diversion', W: 'diversion' }, shape: { E: [{ straight: 50 }, { curve: -15, radius: 200 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 150,
  focus: { minX: -126, maxX: 126, minY: -62, maxY: 62 },
  landmarks: [{ kind: 'mall', x: 0, y: 52, w: 70, h: 36 }],
};

export const tagaytay = {
  id: 'tagaytay',
  name: 'Tagaytay Rotonda',
  region: 'Cavite',
  blurb: 'The ridge-top rotonda with no lights: Aguinaldo Highway brings the weekend crowd from Manila, and the road to Nasugbu has one signal.',
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
    { id: 'A', x: -60, y: 0, kind: 'yield', rotonda: { island: 12, lanes: 2 }, major: [], rolling: true, arms: { N: 'aguinaldo', S: 'calamba', W: 'sungay', E: 'nasugbu' } },
    { id: 'B', x: 80, y: 0, kind: 'signal', arms: { W: 'nasugbu', E: 'nasugbu', N: 'brgy', S: 'brgy' }, shape: { E: [{ straight: 30 }, { curve: 24, radius: 90 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -110, maxX: 116, minY: -70, maxY: 70 },
  landmarks: [{ kind: 'park', x: -60, y: -76, w: 48, h: 30 }],
};

export const bacolod = {
  id: 'bacolod',
  name: 'Lacson St – Bacolod',
  region: 'Negros Occidental',
  blurb: 'The City of Smiles: Lacson Street past the plaza and the mall, tricycles by the dozen, and the MassKara parade every October.',
  sceneSeed: 1980,
  theme: 'province',
  roads: {
    lacson: { name: 'Lacson St', lanes: 3, median: 2 },
    burgos: { name: 'Burgos Ave', lanes: 2, median: 0 },
    araneta: { name: 'Araneta St', lanes: 2, median: 0 },
  },
  nodes: [
    { id: 'A', x: -68, y: 0, kind: 'signal', arms: { N: 'burgos', S: 'burgos', E: 'lacson', W: 'lacson' }, shape: { W: [{ straight: 40 }, { curve: -16, radius: 150 }] } },
    { id: 'B', x: 68, y: 0, kind: 'signal', arms: { N: 'araneta', S: 'araneta', E: 'lacson', W: 'lacson' }, shape: { E: [{ straight: 40 }, { curve: 16, radius: 150 }] } },
  ],
  links: [{ a: 'A', aArm: 'E', b: 'B', bArm: 'W' }],
  armLength: 115,
  focus: { minX: -106, maxX: 106, minY: -60, maxY: 60 },
  landmarks: [
    { kind: 'park', x: 0, y: -50, w: 60, h: 34 },
    { kind: 'mall', x: 0, y: 50, w: 60, h: 34 },
  ],
};

// ---------------------------------------------------------------- batch C: player-sketched towns

export const bayanihan = {
  id: 'bayanihan',
  name: 'Bayanihan Rotonda',
  region: 'Lalawigan',
  blurb: 'A busy town centre: five junctions on Rizal Avenue and its side streets, a signalised rotonda by the plaza, a U-turn slot and a barangay road that merges without lights.',
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
    { id: 'D', x: 125, y: 0, kind: 'signal', rotonda: { island: 12, lanes: 2 }, arms: { W: 'rizal', N: 'rizal', E: 'delpilar', S: 'burgos' }, shape: { E: [{ straight: 40 }, { curve: 30, radius: 90 }] } },
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
  blurb: 'Up the mountain: Zigzag Road spirals inward past five junctions and two rotondas to the hilltop crossing, with vegetable trucks coming down from the farms.',
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
    { id: 'R1', x: 60, y: -170, kind: 'signal', rotonda: { island: 12, lanes: 2 }, arms: { W: 'zigzag', E: 'zigzag', S: 'palengke', N: 'strawberry' }, shape: { N: [{ straight: 48 }, { curve: -30, radius: 40 }, { straight: 14 }, { curve: 30, radius: 40 }] } },
    { id: 'I3', x: 220, y: -20, kind: 'signal', arms: { N: 'zigzag', S: 'zigzag', W: 'palengke', E: 'ulap' } },
    { id: 'I4', x: 120, y: 140, kind: 'signal', arms: { E: 'zigzag', W: 'zigzag', N: 'palengke', S: 'minahan' } },
    { id: 'R2', x: -60, y: 60, kind: 'yield', rotonda: { island: 9, lanes: 1 }, major: [], rolling: true, arms: { E: 'zigzag', W: 'pino', N: 'zigzag', S: 'pino' } },
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
