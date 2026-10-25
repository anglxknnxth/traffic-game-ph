// Owns one TrafficPhaseManager per signalised node and the physical signal head positions.
// Unsignalised nodes (U-turn slots, yield junctions) have no lights: their movements always read
// 'green' and right of way is settled by the simulator's priority rules.

import { TrafficPhaseManager } from './TrafficPhaseManager.js';
import { ARMS, DIRS } from '../data/config.js';
import { rightOf } from './LaneManager.js';

export class TrafficLightController {
  constructor(network, { initialGroups = {}, timing = {} } = {}) {
    this.network = network;
    this.managers = new Map();
    this.heads = [];
    for (const I of network.intersections) {
      if (I.kind !== 'signal' || !I.phases.length) continue;
      const m = new TrafficPhaseManager({ phases: I.phases, ...timing });
      const initial = m.resolve(initialGroups[I.id]);
      if (initial && initial !== m.activeGroup) {
        m.activeGroup = initial;
        m.history = [{ state: m.state, group: initial }];
      }
      this.managers.set(I.id, m);
      for (const arm of ARMS) {
        if (!I.approachLanes[arm]) continue;
        const A = I.arms[arm];
        const o = DIRS[arm];
        const d = { x: -o.x, y: -o.y };
        const r = rightOf(d);
        this.heads.push({
          intersectionId: I.id,
          arm,
          group: m.phaseFor(arm, 'straight'),
          x: I.x + o.x * (A.stop + 2.2) + r.x * (A.half + 2.0),
          y: I.y + o.y * (A.stop + 2.2) + r.y * (A.half + 2.0),
          angle: Math.atan2(d.y, d.x),
        });
      }
    }
  }

  manager(id) {
    return this.managers.get(id);
  }

  /** Signal for a movement: 'green' | 'yellow' | 'red' | 'flash'. Unsignalised nodes are always 'green'. */
  signal(id, arm, move = 'straight') {
    const m = this.managers.get(id);
    return m ? m.signalForArm(arm, move) : 'green';
  }

  /** Phase id that releases `arm` doing `move` at node `id` (null at unsignalised nodes). */
  phaseFor(id, arm, move = 'straight') {
    return this.managers.get(id)?.phaseFor(arm, move) ?? null;
  }

  request(id, group) {
    const m = this.managers.get(id);
    if (!m) return { status: 'rejected', reason: 'Unknown intersection', early: false, wait: 0 };
    return m.requestPhase(group);
  }

  /** Switch a node to flashing yellow (every approach becomes stop-and-go). */
  requestFlash(id) {
    const m = this.managers.get(id);
    if (!m) return { status: 'rejected', reason: 'Unknown intersection', early: false, wait: 0 };
    return m.requestFlash();
  }

  update(dt) {
    for (const m of this.managers.values()) m.update(dt);
  }

  /** Safety invariant: one green road per node, or a pair of opposite roads with no left turns. */
  conflictingGreens() {
    let bad = 0;
    for (const m of this.managers.values()) if (m.conflicting()) bad++;
    return bad;
  }
}
