// Traffic enforcers and violations.
//
// Violations a vehicle can be caught for (click it: "HULI!"):
//   counterflow — out in the oncoming lane (it is sent back into its own lane at once)
//   red         — crossed its stop line on red (not a right turn on red, not an emergency)
//   box         — squeezed into the box with no exit space
//   stop        — a jeepney or tricycle stopping inside the junction to load or unload
//
// Enforcers the player stations at a junction (level.enforcer.count of them):
//   - drivers behave within 40 m of them: no counterflow, no corner stops in the box, far fewer
//     box-blocking squeezes, no late yellow runs
//   - "padaanin": tap the vehicle at the front of a red lane and it is waved through when nothing
//     crossing is coming
//   - "patawid": every crosswalk at the junction gets a walk light (all-red for traffic) for 12 s
//   - an emergency vehicle heading for the junction is given way twice as far out
// Anywhere: tap a waiting jaywalker to send them to the crosswalk; tap a stalled vehicle or road
// works to call a tow truck (cleared in 8 s).

export const ENFORCER_REACH = 40; // m

export class Enforcement {
  constructor(sim) {
    this.sim = sim;
    const cfg = sim.level.enforcer || {};
    this.max = cfg.count ?? 0;
    this.posts = new Map(); // node id -> { id, x, y, wave }
    this.caught = 0;
    this.log = [];
  }

  get available() {
    return this.max - this.posts.size;
  }

  /** Is an enforcer stationed at node I? */
  near(I) {
    return !!I && this.posts.has(I.id);
  }

  /** Is (x, y) within an enforcer's reach? */
  watched(x, y) {
    for (const p of this.posts.values()) if (Math.hypot(p.x - x, p.y - y) < ENFORCER_REACH) return true;
    return false;
  }

  /** Station an enforcer at node `id` (or take them off if one is there). Returns a status text. */
  toggle(id) {
    const I = this.sim.network.byId.get(id);
    if (!I || I.layer !== 0) return { ok: false, text: 'Enforcers stand at street junctions' };
    if (this.posts.has(id)) {
      this.posts.delete(id);
      return { ok: true, text: `Enforcer off duty at ${id}` };
    }
    if (this.available <= 0) return { ok: false, text: `All ${this.max} enforcers are on duty: tap one to move them` };
    // Stand at a corner of the box, on the sidewalk
    const x = I.x - (I.hx + 2.5);
    const y = I.y - (I.hy + 2.5);
    this.posts.set(id, { id, x, y, wave: 0 });
    this.sim.notify(`ENF_${id}`, `👮 ENFORCER ON DUTY · ${this._name(I)}`, 'good');
    return { ok: true, text: `Enforcer on duty at ${this._name(I)}` };
  }

  _name(I) {
    const net = this.sim.network;
    return [...new Set(['N', 'E', 'S', 'W'].map((a) => net.roadName(I, a)).filter(Boolean))].slice(0, 2).join(' × ') || I.id;
  }

  // ------------------------------------------------------------------ violations
  /** The violation v can be caught for right now, or null. */
  violationOf(v) {
    if (v.emergency || v.caught) return null;
    if (v.cf && !v.cf.legal && !v.cf.emergency) return 'counterflow';
    const x = v.violation;
    if (x && x.until > this.sim.time) return x.kind;
    return null;
  }

  mark(v, kind, secs = 10) {
    if (v.emergency) return;
    v.violation = { kind, until: this.sim.time + secs };
  }

  /** HULI! Returns true when v was caught for something. */
  catchVehicle(v) {
    const kind = this.violationOf(v);
    if (!kind) return false;
    const sim = this.sim;
    v.caught = true;
    v.say = 'HULI!';
    v.sayTimer = 2.2;
    this.caught++;
    sim.stats.caught = (sim.stats.caught || 0) + 1;
    sim.scoring.onCatch?.(kind);
    const label = { counterflow: 'COUNTERFLOW', red: 'BEATING THE RED', box: 'BLOCKING THE BOX', stop: 'BAWAL MAGBABA DITO' }[kind];
    sim.notify(`HULI_${v.id}`, `🚨 HULI! ${v.spec.label.toUpperCase()} · ${label}`, 'good');
    sim.events.push({ type: 'pasaway', x: v.x, y: v.y, huli: true });
    if (kind === 'counterflow') sim.counterflow.forceReturn(v);
    if (kind === 'stop' && v.cornerStop?.state === 'stopped') v.cornerStop.timer = Math.min(v.cornerStop.timer, 0.5);
    this.log.push({ t: sim.time, kind, id: v.id });
    return true;
  }

  // ------------------------------------------------------------------ enforcer actions
  /** Padaanin: wave the vehicle at the front of a red lane through (only with an enforcer there). */
  waveThrough(v) {
    const ce = v.nextConnEntry();
    if (!ce || v.reservations.size || v.emergency) return false;
    const I = ce.seg.intersection;
    if (!this.near(I) || ce.start - v.front > 6 || v.v > 1 || v.signal === 'green') return false;
    v.waved = this.sim.time + 5;
    v.reactTimer = 0;
    const post = this.posts.get(I.id);
    if (post) post.wave = 2;
    this.sim.notify(`WAVE_${I.id}`, '👮 PADAANIN! · the enforcer waves a lane through', 'info');
    return true;
  }

  /** Patawid: everyone at the junction stops so people can cross (needs an enforcer there). */
  patawid(id) {
    const I = this.sim.network.byId.get(id);
    if (!this.near(I)) return { ok: false, text: 'Station an enforcer there first' };
    const m = this.sim.lights.manager(id);
    if (!m) return { ok: false, text: 'No lights here' };
    const r = m.holdForPeople(12);
    if (r) this.sim.notify(`PATAWID_${id}`, '🚸 PATAWID! · all traffic stops for people crossing', 'good');
    const post = this.posts.get(id);
    if (post) post.wave = 3;
    return { ok: r, text: r ? 'Patawid: walk on every crosswalk for 12 s' : 'Already holding traffic' };
  }

  /** Saway: a waiting jaywalker is told to use the crosswalk. */
  saway(p) {
    const peds = this.sim.peds;
    if (!p || p.state !== 'jaywait') return false;
    p.state = 'walk';
    p.dir = p.u > (p.road?.I.arms[p.road.arm].stop ?? 0) + 30 ? -1 : 1;
    p.decided = false;
    p.jay = null;
    p.shout = 0;
    p.wait = 0;
    peds.stats.sinaway = (peds.stats.sinaway || 0) + 1;
    this.sim.scoring.onSaway?.();
    this.sim.events.push({ type: 'pasaway', x: p.x, y: p.y });
    return true;
  }

  /** Tow a stalled vehicle / clear road works: gone in 8 s. */
  tow(b) {
    const sim = this.sim;
    if (!b || !b.active || b.towing || ['ped', 'laneEnd', 'cf'].includes(b.kind)) return false;
    b.towing = sim.scheduleTime;
    b.end = Math.min(b.end, sim.scheduleTime + 8);
    sim.notify(`TOW_${b.id}`, `🚚 TOW TRUCK ON THE WAY · ${b.label || 'blockage'} cleared in 8 s`, 'info');
    return true;
  }

  update(dt) {
    for (const p of this.posts.values()) if (p.wave > 0) p.wave -= dt;
  }
}
