// Lumalaking Lungsod (the growing city): the whole map is simulated from the start, but only the
// open districts are shown and in the player's hands. Junctions outside them run on AUTO. Each
// milestone (vehicles through) opens the next district (map.districts) and brings more traffic.

export class CityGrowth {
  constructor(sim, cfg) {
    this.sim = sim;
    const districts = sim.network.map.districts || [];
    this.districts = districts;
    this.milestones = cfg.milestones || [60, 160, 300];
    this.opened = 0;
    this.open = new Set();
    this.events = [];
    this._openDistrict(0, true);
  }

  get total() {
    return this.districts.length;
  }

  /** Vehicles still needed for the next district (null when the whole city is open). */
  get nextAt() {
    return this.opened < this.total ? this.milestones[this.opened - 1] ?? null : null;
  }

  _openDistrict(k, initial = false) {
    const d = this.districts[k];
    if (!d) return;
    for (const id of d.nodes) this.open.add(id);
    this.opened = k + 1;
    const sim = this.sim;
    sim.openNodes = this.open;
    // Junctions not yet open stay on AUTO; open ones go to the player.
    for (const id of sim.lights.managers.keys()) sim.autopilot.setAuto(id, !this.open.has(id));
    sim.demandMul = 1 + 0.18 * k;
    if (!initial) {
      sim.notify(`GROW_${k}`, `BAGONG KANTO! · ${d.name.toUpperCase()} IS OPEN`, 'good');
      this.events.push({ type: 'open', index: k, name: d.name });
    }
  }

  update() {
    if (this.opened >= this.total) return;
    const at = this.milestones[this.opened - 1];
    if (at !== undefined && this.sim.stats.processed >= at) this._openDistrict(this.opened);
  }

  /** World rectangle around the open junctions (the camera focus). */
  focusRect(margin = 70) {
    const nodes = this.sim.network.intersections.filter((I) => this.open.has(I.id));
    if (!nodes.length) return this.sim.network.focusRect();
    const m = Math.max(margin, ...nodes.map((I) => (I.maxStop || 0) + 40));
    return {
      minX: Math.min(...nodes.map((I) => I.x)) - m,
      maxX: Math.max(...nodes.map((I) => I.x)) + m,
      minY: Math.min(...nodes.map((I) => I.y)) - m,
      maxY: Math.max(...nodes.map((I) => I.y)) + m,
    };
  }
}
