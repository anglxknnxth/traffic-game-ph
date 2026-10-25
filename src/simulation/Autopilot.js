// AUTO traffic lights: a queue-balancing controller for every signal, with player override.
//
// Each signal is either AUTO (this controller picks its greens) or MANUAL (the player does).
// The controller looks every second at the queue on each road and switches when another road (or
// a pair of opposite roads, which run together with no left turns) needs it clearly more, or when
// the current green has run long. A road that has waited too long always gets its turn, and an
// approaching emergency vehicle is given its green right away. It only ever asks the signal for a
// change through the normal request path, so yellow and all-red always run.

const TICK = 1; // s between decisions
const MIN_GREEN = 6; // s before the controller changes a green it picked
const MAX_GREEN = 32; // s: a long green gives way to any waiting road
const STARVE = 45; // s: a road with a queue waiting this long goes next

export class SignalAutopilot {
  constructor(sim, { auto = false, returnAfter = null } = {}) {
    this.sim = sim;
    this.returnAfter = returnAfter; // s of no player input before a MANUAL signal goes back to AUTO
    this.state = new Map();
    for (const id of sim.lights.managers.keys()) this.state.set(id, { auto, lastInput: -Infinity, served: new Map(), want: null, timer: 0 });
    this._t = 0;
  }

  isAuto(id) {
    return !!this.state.get(id)?.auto;
  }

  get allAuto() {
    for (const st of this.state.values()) if (!st.auto) return false;
    return this.state.size > 0;
  }

  get anyAuto() {
    for (const st of this.state.values()) if (st.auto) return true;
    return false;
  }

  setAuto(id, on) {
    const st = this.state.get(id);
    if (st) {
      st.auto = on;
      st.want = null;
    }
  }

  setAll(on) {
    for (const id of this.state.keys()) this.setAuto(id, on);
  }

  /** The player touched signal `id`: it becomes MANUAL (until returnAfter seconds of quiet). */
  onPlayerInput(id) {
    const st = this.state.get(id);
    if (!st) return;
    st.auto = false;
    st.want = null;
    st.lastInput = this.sim.time;
  }

  update(dt) {
    const sim = this.sim;
    for (const [id, st] of this.state) {
      const m = sim.lights.manager(id);
      // Remember when each road last had a green (for fairness).
      for (const g of m.groups) if (m.signalForGroup(g) === 'green') st.served.set(g, sim.time);
      if (!st.auto && this.returnAfter !== null && sim.time - st.lastInput > this.returnAfter) st.auto = true;
    }
    this._t += dt;
    if (this._t < TICK) return;
    this._t = 0;
    for (const [id, st] of this.state) if (st.auto) this._decide(id, st);
  }

  /** Queue score per phase: vehicles waiting plus a weight for how long the head has waited. */
  _queues(id, m) {
    const p = this.sim.metrics.perIntersection.find((x) => x.id === id);
    const q = Object.fromEntries(m.groups.map((g) => [g, 0]));
    const head = Object.fromEntries(m.groups.map((g) => [g, 0]));
    if (!p) return { q, head };
    for (const a of p.approaches) {
      const g = m.phaseFor(a.arm);
      if (!g) continue;
      q[g] += a.queue;
      head[g] = Math.max(head[g], a.headWait || 0);
    }
    return { q, head };
  }

  _decide(id, st) {
    const sim = this.sim;
    const m = sim.lights.manager(id);
    if (m.state !== 'GREEN' || m.flashing) return;
    if (m.pair && m.pair.stage !== 'on') return; // a pair is being set up or dropped
    // A pending pair from the last switch: add the opposite road once our road is green.
    if (st.want && st.want.pair && m.activeGroup === st.want.group && !m.pair) {
      const opp = m.oppositeOf(st.want.group);
      st.want = null;
      if (opp) sim.requestPhase(id, opp);
      return;
    }
    const served = new Set([m.activeGroup, ...(m.pair ? [m.pair.other] : [])]);
    // Emergency vehicles first.
    if (m.priorityGroup && !served.has(m.priorityGroup)) {
      if (m.timer > 1.5) this._switch(id, st, m, m.priorityGroup, false);
      return;
    }
    if (m.priorityGroup) return; // keep its green
    // A left turner held at the head of a paired road blocks its lane: give that road its left back.
    if (m.pair && m.timer > 3) {
      for (const g of [m.activeGroup, m.pair.other]) {
        if (this._leftHead(id, m, g) > 3) {
          sim.requestPhase(id, g);
          return;
        }
      }
    }
    const { q } = this._queues(id, m);
    const cur = [...served].reduce((n, g) => n + q[g], 0);
    // Candidates: each road alone, and each pair of opposite roads.
    let best = null;
    let bestScore = -Infinity;
    const consider = (group, pair, score) => {
      if (score > bestScore) {
        best = { group, pair };
        bestScore = score;
      }
    };
    for (const g of m.groups) {
      consider(g, false, q[g]);
      const opp = m.oppositeOf(g);
      // Two opposite roads together move more traffic, minus the left turners who must wait.
      if (opp && q[g] >= 2 && q[opp] >= 2 && this._leftHead(id, m, g) < 0 && this._leftHead(id, m, opp) < 0) consider(g, true, (q[g] + q[opp]) * 0.85);
    }
    // Fairness: anyone left waiting too long goes next.
    let starving = null;
    for (const g of m.groups) {
      if (served.has(g) || q[g] < 1) continue;
      const since = sim.time - (st.served.get(g) ?? -Infinity);
      if (since > STARVE && (!starving || since > starving.since)) starving = { g, since };
    }
    if (m.timer < MIN_GREEN) return;
    if (starving) {
      this._switch(id, st, m, starving.g, false);
      return;
    }
    if (!best) return;
    const same = best.pair ? served.has(best.group) && served.has(m.oppositeOf(best.group)) : served.size === 1 && served.has(best.group);
    if (same) return;
    if (bestScore > cur * 1.3 + 1.5 || (m.timer > MAX_GREEN && bestScore > 0)) this._switch(id, st, m, best.group, best.pair);
  }

  /**
   * Seconds the vehicle at the head of a lane of `group`'s road has been waiting to turn left or
   * U-turn there (-1 when no lane has one waiting at the line).
   */
  _leftHead(id, m, group) {
    const I = this.sim.network.byId.get(id);
    let worst = -1;
    for (const arm of m.byId.get(group)?.arms || []) {
      for (const lane of I.approachLanes[arm] || []) {
        const v = lane.vehicles[lane.vehicles.length - 1];
        if (!v || v.reservations.has(id)) continue;
        const ce = v.nextConnEntry();
        if (!ce || ce.seg.intersection !== I || (ce.seg.movement !== 'left' && ce.seg.movement !== 'uturn')) continue;
        if (ce.start - v.front > 4) continue;
        worst = Math.max(worst, v.stoppedTime);
      }
    }
    return worst;
  }

  _switch(id, st, m, group, pair) {
    const sim = this.sim;
    if (m.pair) {
      // Paired now: keep one road of the pair, or change to a cross road.
      if (group === m.activeGroup || group === m.pair.other) {
        if (!pair) sim.requestPhase(id, group);
        return;
      }
    } else if (pair && (group === m.activeGroup || m.oppositeOf(group) === m.activeGroup)) {
      // Our road is one of the pair: just add the other.
      sim.requestPhase(id, group === m.activeGroup ? m.oppositeOf(group) : group);
      return;
    }
    st.want = pair ? { group, pair: true } : null;
    sim.requestPhase(id, group);
  }
}
