// Lane changes, MOBIL-style.
//   discretionary — the next lane lets the driver go faster by more than their personal threshold,
//                   without making the new follower brake hard (politeness)
//   forced        — the own lane is blocked ahead by a loading jeepney, a breakdown or roadworks
// A change switches the vehicle to the target lane immediately and keeps its body where it was via
// a lateral offset that eases to zero over L metres (see Vehicle.lateralAt), so the collision gate
// always checks the real body sweeping across both lanes. While it is still partly in the old lane
// it stays visible there as a "ghost" leader for the traffic behind it.

import { Route } from './Vehicle.js';
import { Network } from './LaneManager.js';
import { idm } from './VehicleAI.js';
import { LOADING_ZONE_S, SIM_DT } from '../data/config.js';

const CHECK_EVERY = 30; // steps between checks per vehicle (0.5 s at 60 Hz), staggered by id
const SIGNAL_FIRST = 0.8; // seconds of indicator before a discretionary lane change starts

export class LaneChanger {
  constructor(sim) {
    this.sim = sim;
    this.tick = 0;
    this.changes = 0;
  }

  /** Lanes running alongside `lane` in the same direction. */
  static neighbours(lane) {
    let group = null;
    if (lane.role === 'approach' || lane.role === 'link') group = lane.endInt.approachLanes[lane.endArm];
    else if (lane.role === 'exit') group = lane.startInt.exitLanes[lane.startArm];
    if (!group) return [];
    return [group[lane.laneIndex - 1], group[lane.laneIndex + 1]].filter(Boolean);
  }

  update() {
    this.tick++;
    for (const v of this.sim.vehicles) {
      if (v.lc && (v.s >= v.lc.s0 + v.lc.L || v.segment !== v.route.entries[0].seg)) this.finish(v);
      // Signal first: the indicator blinks for a moment before the move, then the choice is checked
      // again (traffic may have changed) and carried out or dropped.
      if (v.lcPending) {
        v.lcPending.t -= SIM_DT;
        if (v.lcPending.t > 0) continue;
        const again = this.choose(v);
        v.lcPending = null;
        if (again) this.execute(v, again.lane, again.L);
        else v.lcCooldown = 1.5;
        continue;
      }
      if (v.lc || v.lcCooldown > 0 || (this.tick + v.seq) % CHECK_EVERY !== 0) continue;
      const target = this.choose(v);
      if (!target) continue;
      if (target.forced) this.execute(v, target.lane, target.L);
      else v.lcPending = { t: SIGNAL_FIRST, dir: target.lane.laneIndex > v.segment.laneIndex ? 1 : -1 };
    }
  }

  finish(v) {
    v.lc.fromLane.ghosts?.delete(v);
    v.lc = null;
  }

  /** Nearest vehicle ahead of / behind longitudinal position `s` on `lane`, ghosts included. */
  _around(lane, s, self) {
    let lead = null;
    let follow = null;
    const scan = (o) => {
      if (o === self) return;
      if (o.localS >= s) {
        if (!lead || o.localS < lead.localS) lead = o;
      } else if (!follow || o.localS > follow.localS) follow = o;
    };
    for (const o of lane.vehicles) scan(o);
    if (lane.ghosts) for (const o of lane.ghosts) scan(o);
    return { lead, follow };
  }

  _accWith(v, lead, gapOverride = null) {
    const sim = this.sim;
    const env = sim.env;
    const P = v.p;
    const v0 = v.spec.maxSpeed * P.speedFactor * v.speedVar * env.speedFactor;
    const a = v.spec.accel * P.accelFactor;
    const b = v.spec.decel * env.brakeFactor;
    if (!lead && gapOverride === null) return a * (1 - Math.pow(v.v / v0, 4));
    const gap = gapOverride ?? lead.localS - lead.hl - v.localS - v.hl;
    return idm(v.v, lead ? lead.v : 0, gap, v0, a, b, P.minGap * env.gapFactor, P.headway * env.headwayFactor);
  }

  /** Is the own lane blocked ahead (loading stop, breakdown, roadworks)? */
  _blockedAhead(v, lane, lead) {
    if (lead && lead.v < 0.5 && (lead.loading?.state === 'stopped' || lead.broken)) {
      return lead.localS - lead.hl - v.localS - v.hl < 40;
    }
    // Sirens: an emergency vehicle stuck behind slow traffic looks for a clearer lane.
    if (v.emergency && lead && lead.v < 2 && lead.localS - lead.hl - v.localS - v.hl < 40) return true;
    // ... and drivers with sirens close behind them move over to let it through.
    if (!v.emergency && this._sirenBehind(v, lane)) return true;
    // A lane that ends: start merging well before the end, as drivers do.
    const lf = v.localS + v.hl;
    if (lane.dropAt !== undefined && lane.dropAt > lf - 0.5 && lane.dropAt - lf < 90) return true;
    const blk = this.sim.nextBlockage(v);
    return blk !== null && blk - v.front < 45;
  }

  /** An emergency vehicle close behind v in its own lane. */
  _sirenBehind(v, lane) {
    for (const o of lane.vehicles) {
      if (!o.emergency || o === v) continue;
      const gap = v.localS - v.hl - o.localS - o.hl;
      if (gap > -0.5 && gap < 35) return true;
    }
    return false;
  }

  choose(v) {
    const seg = v.segment;
    if (seg.kind !== 'lane' || v.reservations.size || v.broken || v.loading?.state === 'stopped') return null;
    if (v.localS - v.hl < 1) return null; // still leaving the box
    const moto = v.type === 'motorcycle';
    const minSpeed = moto ? 0.3 : 1.2;
    const ce = v.nextConnEntry();
    const limit = ce ? ce.start : v.route.length - 12;
    const room = limit - v.front;
    // Long vehicles change lanes gently: a short change would swing a bus body 40° and sweep its tail
    // across the next lane (or over the kerb).
    let L = Math.max(v.spec.length * 2.2, Math.min(24, Math.max(moto ? 5 : 7, v.v * 2.8)));
    // Merging out of a lane that ends: a slow, short move (the end of the lane is open road).
    const dropping = seg.dropAt !== undefined && seg.dropAt > v.localS;
    if (dropping) L = Math.max(v.spec.length * 1.2, Math.min(L, 8 + v.v * 1.5));
    if (room < L + (dropping ? 3 : 12)) return null;
    if (seg.gate && !v.gatePassed && this.sim.gateFront(v) !== null && this.sim.gateFront(v) - v.front < L + 6) return null;
    // Never swerve round someone crossing the road ahead: the body would still be in their lane.
    if (this.sim.blockageOnLane(seg, v.localS, v.front + L + 15, 'ped')) return null;
    const move = ce ? ce.seg.movement : null;

    const own = this._around(seg, v.localS, v);
    const forced = this._blockedAhead(v, seg, own.lead);
    // Stopped in a queue with room in the next lane: drivers slide over (checked per lane below).
    const hop = !forced && v.v < minSpeed && !!own.lead && own.lead.v < 0.5 && own.lead.localS - own.lead.hl - v.localS - v.hl < 12;
    if (v.v < minSpeed && !forced && !hop) return null;
    const accCur = forced ? -3 : this._accWith(v, own.lead);

    const P = v.p;
    let threshold = P.laneChangeGain ?? 0.6;
    if (moto) threshold *= 0.35;
    else if (v.spec.length > 8) threshold *= 1.8;
    let best = null;
    for (const B of LaneChanger.neighbours(seg)) {
      if (!B.allows(v.type)) continue;
      // Cyclists stay in their bike lane, and nobody else rides in one.
      if ((v.type === 'bicycle') !== (B.type === 'bike')) continue;
      if (move && !B.connectors[move]) continue;
      if (this.sim.blockageOnLane(B, v.localS - v.hl - 2, v.localS + 45)) continue;
      // Never move into a lane that ends further on.
      if (B.dropAt !== undefined) continue;
      // Do not drift into a dedicated lane you may use but did not pick (buses stay in the busway, motos in the moto lane, unless forced).
      if (B.allowed && !forced && seg.allowed !== B.allowed && !B.allowed.has(v.type)) continue;
      // No weaving: don't go straight back to the lane just left unless forced.
      if (!forced && v.lcBack && v.lcBack.lane === B && this.sim.time < v.lcBack.until) continue;
      const { lead, follow } = this._around(B, v.localS, v);
      const gapFront = lead ? lead.localS - lead.hl - v.localS - v.hl : Infinity;
      const gapBack = follow ? v.localS - v.hl - follow.localS - follow.hl : Infinity;
      const s0 = P.minGap * this.sim.env.gapFactor;
      if (gapFront < Math.max(1.5, 0.6 * s0, v.v * 0.6) || gapBack < Math.max(1.2, follow ? 0.5 * follow.p.minGap + follow.v * 0.5 : 0)) continue;
      if (forced && gapFront < 0.45 * L) continue;
      // Sliding over from a standstill only into real space, not to the next car's bumper.
      if (hop && (gapFront < Math.max(14, v.spec.length * 2.5) || (lead && lead.v < 0.5 && gapFront < 20))) continue;
      // The vehicle must have room to straighten up before reaching whatever is ahead in its own lane.
      if (own.lead && own.lead.localS - own.lead.hl - v.localS - v.hl < 0.45 * L) continue;
      let followerLoss = 0;
      if (follow) {
        const after = this._accWith(follow, null, gapBack);
        if (after < -(P.safeDecel ?? 3)) continue;
        const before = this._accWith(follow, lead);
        followerLoss = Math.max(0, before - after);
      }
      const accNew = this._accWith(v, lead);
      const gain = accNew - accCur - (P.politeness ?? 0.4) * followerLoss + (forced ? 2 : 0);
      if (gain > threshold && (!best || gain > best.gain)) best = { lane: B, gain, L, forced };
    }
    return best;
  }

  /** New route starting on lane B at the same longitudinal position, keeping the planned movements. */
  _rebuildRoute(v, B, base) {
    const route = v.route;
    const moves = route.connectorIdx.slice(v.nextConn).map((i) => route.entries[i].seg.movement);
    let usedUturn = route.movements.slice(0, v.nextConn).includes('uturn');
    const segs = [B];
    let lane = B;
    for (let i = 0; lane.endInt && i < 10; i++) {
      let m = moves[i];
      if (!m || !lane.connectors[m] || !lane.connectors[m].toLane.allows(v.type)) m = this.sim.spawner.chooseMovement(lane, v.type, usedUturn);
      const conn = Network.connectorFor(lane, m, v.spec) || lane.connectors[m];
      if (!conn) break;
      if (m === 'uturn') usedUturn = true;
      segs.push(conn, conn.toLane);
      lane = conn.toLane;
    }
    return new Route(segs, base);
  }

  execute(v, B, L) {
    const A = v.segment;
    // Whoever was letting this vehicle in has done their turn of the zipper.
    if (A.dropAt !== undefined) for (const o of B.vehicles) if (o.yieldingTo === v.id) o.letIn = this.sim.time;
    const s = v.localS;
    // Lanes of one direction share their longitudinal coordinate, so the new route is shifted to keep
    // the vehicle's route coordinate (and everything keyed on it) continuous.
    const route = this._rebuildRoute(v, B, v.s - s);
    // Body stays put: offset from B's centre line to where the vehicle is now (+ = right of travel).
    const off = A.offset - B.offset;
    const k = A.vehicles.indexOf(v);
    if (k >= 0) A.vehicles.splice(k, 1);
    B.vehicles.push(v);
    B.vehicles.sort((a, b) => a.localS - b.localS);
    B.vehicles.forEach((o, i) => (o.segOrder = i));
    A.vehicles.forEach((o, i) => (o.segOrder = i));
    (A.ghosts || (A.ghosts = new Set())).add(v);

    v.route = route;
    v.segIdx = 0;
    v.localS = s;
    v.nextConn = 0;
    v._gateS = undefined;
    v.lc = { s0: v.s, L, off, fromLane: A };
    v.lcCooldown = 3 + (v.seq % 5);
    v.lcBack = { lane: A, until: this.sim.time + 12 };
    if (v.loading && v.loading.state === 'pending') {
      const exit = route.exitLane;
      const ok = (exit.isCurb && exit.type === 'general') || (exit.type === 'bus' && v.type === 'bus');
      const at = route.startOf(exit) + LOADING_ZONE_S;
      v.loading = ok && exit.length > LOADING_ZONE_S + 10 && at > v.front + 5 ? { ...v.loading, s: at } : null;
    }
    v.updatePose();
    this.changes++;
  }
}
