// Surface textures for the static layer: asphalt, sidewalk paving, grass, bare soil and roofs
// (corrugated "yero", clay tiles, concrete). Every map gets procedural textures, generated once
// from a fixed seed into small offscreen tiles. A map with `textures: '<set>'` also loads CC0 photo
// textures from public/textures/<set>/ and uses them once they arrive (the procedural ones stay as
// the fallback when offline or a file is missing).
//
// Textures are used as canvas patterns scaled to world metres: `fill(ctx, name)` sets the fill
// style; roof textures modulate the building's own colour (multiply).

import { Rng } from '../utils/math.js';

const SIZE = 256; // px per procedural tile
/** World metres covered by one tile of each texture. */
const METRES = { asphalt: 6, asphaltWorn: 6, sidewalk: 4, grass: 10, dirt: 10, yero: 4, tiles: 5, concrete: 6 };
const PHOTO = { asphalt: 'asphalt', asphaltWorn: 'asphalt-worn', sidewalk: 'sidewalk', grass: 'grass', dirt: 'dirt', yero: 'yero', tiles: 'tiles', concrete: 'concrete' };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Speckle noise: n dots of radius r in colours from `cols`, alpha a. */
function speckle(g, rng, n, r, cols, a) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = a * rng.range(0.4, 1);
    g.fillStyle = rng.pick(cols);
    const x = rng.range(0, SIZE);
    const y = rng.range(0, SIZE);
    const rr = rng.range(r * 0.4, r);
    // Draw wrapped so the tile stays seamless
    for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) {
      if (x + dx < -rr || x + dx > SIZE + rr || y + dy < -rr || y + dy > SIZE + rr) continue;
      g.beginPath();
      g.arc(x + dx, y + dy, rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

const MAKERS = {
  asphalt(g, rng) {
    g.fillStyle = '#3a3d43';
    g.fillRect(0, 0, SIZE, SIZE);
    speckle(g, rng, 60, 22, ['#34373c', '#41444a'], 0.35); // patchy tone
    speckle(g, rng, 2600, 1.3, ['#2a2c30', '#4c5057', '#55585e', '#31343a'], 0.7); // aggregate
    speckle(g, rng, 220, 1.8, ['#62666d'], 0.35);
  },
  asphaltWorn(g, rng) {
    MAKERS.asphalt(g, rng);
    speckle(g, rng, 16, 30, ['#2e3035'], 0.25); // oil and repairs
    g.strokeStyle = 'rgba(20,20,22,0.45)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      // hairline cracks
      let x = rng.range(0, SIZE);
      let y = rng.range(0, SIZE);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += rng.range(-18, 18);
        y += rng.range(-18, 18);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  },
  sidewalk(g, rng) {
    g.fillStyle = '#b8b1a2';
    g.fillRect(0, 0, SIZE, SIZE);
    speckle(g, rng, 900, 1.2, ['#a69f90', '#c6bfb0', '#9c9586'], 0.5);
    speckle(g, rng, 20, 18, ['#a8a192'], 0.2);
    g.strokeStyle = 'rgba(70,64,54,0.35)';
    g.lineWidth = 2;
    for (let k = 0; k <= SIZE; k += SIZE / 4) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, SIZE);
      g.moveTo(0, k);
      g.lineTo(SIZE, k);
      g.stroke();
    }
  },
  grass(g, rng) {
    g.fillStyle = '#52603f';
    g.fillRect(0, 0, SIZE, SIZE);
    speckle(g, rng, 70, 30, ['#4a5838', '#5a6a43', '#606b3f', '#46553a'], 0.5);
    speckle(g, rng, 18, 26, ['#6d6a45', '#75704a'], 0.3); // dry patches
    speckle(g, rng, 3000, 1.4, ['#3f4d31', '#66773f', '#5b6c3d', '#728444'], 0.55); // blades
    speckle(g, rng, 25, 1.5, ['#f5e663', '#ffffff', '#e66f8a'], 0.8); // little flowers
  },
  dirt(g, rng) {
    g.fillStyle = '#6b5a45';
    g.fillRect(0, 0, SIZE, SIZE);
    speckle(g, rng, 60, 26, ['#5f503d', '#7a6850', '#6e5d47'], 0.5);
    speckle(g, rng, 2000, 1.3, ['#4e4032', '#8a775c', '#5a4a39'], 0.6);
  },
  yero(g, rng) {
    // Corrugated sheet: light and dark ridges, rust streaks. Colour comes from the building.
    for (let x = 0; x < SIZE; x += 8) {
      g.fillStyle = '#ffffff';
      g.fillRect(x, 0, 4, SIZE);
      g.fillStyle = '#c9c9c9';
      g.fillRect(x + 4, 0, 4, SIZE);
    }
    speckle(g, rng, 30, 16, ['#b07a4f', '#9b6a46'], 0.25);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, SIZE / 2 - 1, SIZE, 2); // sheet overlap
  },
  tiles(g, rng) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, SIZE, SIZE);
    const row = SIZE / 8;
    for (let y = 0; y < SIZE; y += row) {
      for (let x = (y / row) % 2 ? -row / 2 : 0; x < SIZE; x += row) {
        g.fillStyle = '#d8d8d8';
        g.beginPath();
        g.arc(x + row / 2, y + row, row / 2, Math.PI, 0);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    speckle(g, rng, 400, 1.3, ['#b5b5b5', '#eeeeee'], 0.4);
  },
  concrete(g, rng) {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, SIZE, SIZE);
    speckle(g, rng, 40, 26, ['#d9d9d9', '#e6e6e6', '#cfcfcf'], 0.5); // stains
    speckle(g, rng, 1200, 1.2, ['#c8c8c8', '#ffffff'], 0.5);
  },
};

export class TextureBank {
  constructor(set = null, onChange = null) {
    this.tiles = {};
    this.patterns = new Map();
    this.version = 0;
    this.onChange = onChange;
    if (typeof document === 'undefined') return;
    const rng = new Rng(4321);
    for (const [name, make] of Object.entries(MAKERS)) {
      const c = canvas(SIZE, SIZE);
      make(c.getContext('2d'), rng);
      this.tiles[name] = { img: c, size: SIZE, photo: false };
    }
    if (set) this._loadPhotos(set);
  }

  get ready() {
    return Object.keys(this.tiles).length > 0;
  }

  _loadPhotos(set) {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
    for (const [name, file] of Object.entries(PHOTO)) {
      const img = new Image();
      img.onload = () => {
        this.tiles[name] = { img, size: img.naturalWidth, photo: true };
        this.patterns.clear();
        this.version++;
        this.onChange?.();
      };
      img.onerror = () => {}; // keep the procedural texture
      img.src = `${base}textures/${set}/${file}.jpg`;
    }
  }

  /** A pattern for texture `name`, scaled so one tile covers its METRES in world units. */
  pattern(ctx, name) {
    const t = this.tiles[name];
    if (!t) return null;
    let p = this.patterns.get(name);
    if (!p) {
      p = ctx.createPattern(t.img, 'repeat');
      if (!p) return null;
      const k = (METRES[name] || 6) / t.size;
      if (p.setTransform && typeof DOMMatrix !== 'undefined') p.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      this.patterns.set(name, p);
    }
    return p;
  }

  /** Is the texture a photo (photos are lighter and get toned to the map palette)? */
  isPhoto(name) {
    return !!this.tiles[name]?.photo;
  }
}
