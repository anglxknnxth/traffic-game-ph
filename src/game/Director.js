// Watch mode camera ("panoorin lang"): every 15–25 s it cuts to something worth watching (an
// emergency vehicle on its way, the longest queue, the toll plaza, traffic up on the expressway,
// a jeepney stopping at a corner) and follows it smoothly. The player can click any vehicle to
// follow it instead; Esc or a drag goes back to the free camera.

export class Director {
  constructor(game) {
    this.game = game;
    this.shot = null;
    this.timer = 0;
    this.follow = null; // vehicle the player picked
  }

  reset() {
    this.shot = null;
    this.timer = 0;
    this.follow = null;
  }

  /** Follow a vehicle chosen by the player. */
  followVehicle(v) {
    this.follow = v;
    this.shot = { kind: 'vehicle', v, zoomK: 1.0 };
  }

  update(dt, sim, auto) {
    const cam = this.game.camera;
    if (this.follow && !sim.vehicles.includes(this.follow)) this.follow = null;
    if (!auto && !this.follow) return;
    this.timer -= dt;
    if (this.follow) this.shot = { kind: 'vehicle', v: this.follow, zoomK: 1 };
    else if (!this.shot || this.timer <= 0 || (this.shot.v && !sim.vehicles.includes(this.shot.v))) this._pick(sim);
    const s = this.shot;
    if (!s) return;
    // Close enough to see the vehicles: about 9 px per metre (or the shot's own zoom).
    const zoom = (9 * (s.zoomK || 1)) / cam.base;
    if (s.v) cam.track(s.v.x, s.v.y, dt, zoom);
    else cam.track(s.x, s.y, dt, zoom);
  }

  _pick(sim) {
    const rng = Math.random;
    this.timer = 15 + rng() * 10;
    const emergency = sim.vehicles.find((v) => v.emergency && !v.emergencyDone);
    if (emergency) {
      this.shot = { kind: 'vehicle', v: emergency, zoomK: 0.8 };
      return;
    }
    const options = [];
    // The longest queue
    let worst = null;
    for (const p of sim.metrics.perIntersection || []) {
      for (const a of p.approaches) if (!worst || a.queue > worst.q) worst = { q: a.queue, id: p.id };
    }
    if (worst && worst.q > 3) {
      const I = sim.network.byId.get(worst.id);
      options.push({ kind: 'spot', x: I.x, y: I.y, zoomK: 0.55 });
    }
    // Special places: toll plaza, the underpass, ramps
    for (const I of sim.network.intersections) {
      if (I.kind === 'toll' || I.def.underpass) options.push({ kind: 'spot', x: I.x, y: I.y, zoomK: 0.7 });
    }
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const high = sim.vehicles.filter((v) => (v.layer || 0) >= 0.5);
    if (high.length) options.push({ kind: 'vehicle', v: pick(high), zoomK: 1 });
    const jeeps = sim.vehicles.filter((v) => v.cornerStop && v.cornerStop.state !== 'done');
    if (jeeps.length) options.push({ kind: 'vehicle', v: pick(jeeps), zoomK: 1.2 });
    const any = sim.vehicles.filter((v) => v.v > 3);
    if (any.length) options.push({ kind: 'vehicle', v: pick(any), zoomK: 1 });
    if (!options.length) {
      const I = pick(sim.network.intersections);
      options.push({ kind: 'spot', x: I.x, y: I.y, zoomK: 0.6 });
    }
    this.shot = pick(options);
  }
}
