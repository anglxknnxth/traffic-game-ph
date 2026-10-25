// Per-vehicle decision making: car following (IDM), signal compliance, intersection entry requests,
// creeping, loading stops and horn behaviour. Weather scales braking, gaps and speed; every driver
// has a reaction time (a start-up delay when the queue ahead moves, and a perception lag on the
// leader's speed). Decisions only produce a desired acceleration; the
// simulator applies hard limits and the collision gate afterwards.

import { clamp } from '../utils/math.js';
import { MIN_BUFFER } from '../data/config.js';
import { AI_STATE } from './Vehicle.js';

const SIREN_CROSS_SPEED = 6; // m/s: emergency vehicles slow to this before crossing against a red

export function idm(v, vLead, gap, v0, a, b, s0, T) {
  const dv = v - vLead;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const g = Math.max(gap, 0.05);
  const r = sStar / g;
  return a * (1 - Math.pow(v / v0, 4) - r * r);
}

export function idmStop(v, gap, v0, a, b) {
  if (gap <= 0.02) return v > 0.05 ? -1e3 : -b;
  return idm(v, 0, gap, v0, a, b, 0.15, 0.3);
}

const HORN_TEXT = {
  car: ['BEEP!', 'BEEP BEEP!', 'PEEP!'],
  moto: ['PIP PIP!', 'MEEP!'],
  jeepney: ['TOOT TOOT!', 'PAPAPA!', 'BEEP!'],
  tricycle: ['PRRP!', 'MEEP MEEP!'],
  bus: ['HOOONK!', 'BRAAAP!'],
  truck: ['HOOONK!', 'BWAAAM!'],
};

export class VehicleAI {
  constructor(sim) {
    this.sim = sim;
  }

  decide(v) {
    const sim = this.sim;
    const env = sim.env;
    const spec = v.spec;
    const P = v.p;
    const v0 = spec.maxSpeed * P.speedFactor * v.speedVar * env.speedFactor;
    const aMax = spec.accel * P.accelFactor;
    const b = spec.decel * env.brakeFactor;
    const T = P.headway * env.headwayFactor;
    let acc = aMax * (1 - Math.pow(v.v / v0, 4));
    let constraint = 'free';
    v.leaderId = null;
    v.creeping = false;
    v.blockReason = null;
    v.signal = null;
    const front = v.s + v.hl;

    // 1. Car following
    const lead = sim.findLeader(v, Math.max(55, v.v * 5));
    if (lead) {
      v.leaderId = lead.vehicle.id;
      let s0 = P.minGap * env.gapFactor;
      if (v.emergency) s0 = Math.max(s0, 2.0);
      if (P.creep && v.stoppedTime > 1.5 && lead.vehicle.v < 0.3 && lead.gap > P.creepGap + 0.15) {
        s0 = P.creepGap;
        v.creeping = true;
      }
      // Perception lag: the follower reacts to the leader's speed from a moment ago, unless the gap
      // is already critical (then everyone brakes at once).
      const critical = s0 + v.v * T * 0.6;
      const vLead = lead.gap > critical ? lead.vehicle.speedAgo(v.reaction + env.reactionExtra) : lead.vehicle.v;
      const aL = idm(v.v, vLead, lead.gap, v0, aMax, b, s0, T);
      if (aL < acc) {
        acc = aL;
        constraint = 'leader';
      }
    }
    // Mid lane change: keep a safe gap to traffic in the lane being left as well.
    if (v.lc && v.lc.fromLane && Math.abs(v.lateralOffset()) > 0.9) {
      let best = null;
      for (const o of v.lc.fromLane.vehicles) {
        if (o === v || o.localS <= v.localS) continue;
        if (!best || o.localS < best.localS) best = o;
      }
      if (best) {
        const gap = best.localS - best.hl - v.localS - v.hl;
        const aF = idm(v.v, best.v, gap, v0, aMax, b, P.minGap * env.gapFactor, T);
        if (aF < acc) {
          acc = aF;
          constraint = 'leader';
        }
      }
    }

    // Curves: ease off to a comfortable cornering speed before and through a bend.
    if (v.v > 3) {
      const aC = this.curveAccel(v, aMax, b);
      if (aC < acc) {
        acc = aC;
        constraint = 'curve';
      }
    }

    // 2. Intersection entry
    const ce = v.nextConnEntry();
    if (ce) {
      const conn = ce.seg;
      const I = conn.intersection;
      const distToStop = ce.start - front;
      const sig = sim.lights.signal(I.id, conn.arm, conn.movement);
      v.signal = sig;
      let res = v.reservations.get(I.id);
      // Sirens: emergency vehicles (and the cars queued in front of them, clearing the way) do not
      // wait for green. They still need a free path through the box, and they slow down first.
      const sirens = sig !== 'green' && I.kind === 'signal' && (v.emergency || sim.isEscort(v, I));
      if (sirens && distToStop < 45 && v.v > SIREN_CROSS_SPEED) {
        const aSlow = (SIREN_CROSS_SPEED * SIREN_CROSS_SPEED - v.v * v.v) / (2 * Math.max(1, distToStop - 1));
        if (aSlow < acc) {
          acc = Math.max(aSlow, -b);
          constraint = 'sirens';
        }
      }
      if (!res && distToStop > -0.05) {
        const reqDist = Math.max(8, (v.v * v.v) / (2 * b) + 6);
        let want = false;
        let duringYellow = false;
        if (distToStop <= reqDist) {
          if (sig === 'green' || sirens) want = true;
          else if (sig === 'yellow') {
            const stopNeed = (v.v * v.v) / (2 * b);
            const t = distToStop / Math.max(v.v, 0.1);
            want = stopNeed > distToStop - 0.3 || (v.v > 4 && t < P.yellowRunTime);
            duringYellow = want;
          }
        }
        // STOP sign on the minor arms of a yield junction: come to a full stop before looking for a gap.
        if (want && I.kind === 'yield' && !I.major.has(conn.arm) && v.signStop !== I.id) {
          if (distToStop < 1.6 && v.v < 0.3) v.signStop = I.id;
          else {
            want = false;
            v.blockReason = 'sign';
          }
        }
        if (want && sim.tryEnter(v, conn, ce.start, distToStop)) {
          res = v.reservations.get(I.id);
          if (res) res.yellowCommit = duringYellow || sirens;
        }
        if (!res) {
          const aS = idmStop(v.v, distToStop - P.stopMargin, v0, aMax, b);
          if (aS < acc) {
            acc = aS;
            constraint = sig === 'green' || sirens ? 'waiting' : 'signal';
          }
          if (sig !== 'green' && !sirens && !v.blockReason) v.blockReason = 'signal';
        }
      } else if (res && distToStop > 0 && sig !== 'green' && !res.yellowCommit && !sirens) {
        // Granted earlier but the light changed before we reached the line: stop if we comfortably can.
        const decel = sig === 'yellow' ? b : spec.hardDecel * 0.7;
        const need = (v.v * v.v) / (2 * decel);
        if (need < distToStop - 0.3) {
          sim.cancelReservation(v, I);
          const aS = idmStop(v.v, distToStop - P.stopMargin, v0, aMax, b);
          if (aS < acc) acc = aS;
          constraint = 'signal';
          v.blockReason = 'signal';
        }
      }
    }

    // 3. Keep-clear zones (long vehicles turning across the adjacent lane)
    const kc = sim.keepClearLimit(v);
    if (kc !== null) {
      const aK = idmStop(v.v, kc - front, v0, aMax, b);
      if (aK < acc) {
        acc = aK;
        constraint = 'keepclear';
        v.blockReason = v.blockReason || 'box';
      }
    }

    // 4. Jeepney / bus loading stop
    if (v.loading && v.loading.state !== 'done') {
      const L = v.loading;
      const d = L.s - front;
      if (L.state === 'pending' && d < 70) {
        if (d < 0.8 && v.v < 0.3) {
          L.state = 'stopped';
          L.timer = L.duration;
        } else {
          const aP = idmStop(v.v, d, v0, aMax, b);
          if (aP < acc) {
            acc = aP;
            constraint = 'loading';
          }
        }
      }
      if (L.state === 'stopped') {
        acc = Math.min(acc, -b);
        constraint = 'loading';
      }
    }

    // 5. Roadworks / stalled vehicle blockages
    const blk = sim.nextBlockage(v);
    if (blk !== null) {
      const aB = idmStop(v.v, blk - front - 0.3, v0, aMax, b);
      if (aB < acc) {
        acc = aB;
        constraint = 'blocked';
      }
    }

    // 6. Downstream exit bottleneck (off-map)
    const gate = v.route.exitLane.gate;
    const gateFront = gate && gate.tokens < 1 ? sim.gateFront(v) : null;
    if (gateFront !== null) {
      const d = gateFront - front;
      if (d < 45) {
        const aG = idmStop(v.v, d, v0, aMax, b);
        if (aG < acc) {
          acc = aG;
          constraint = 'downstream';
        }
      }
    }

    // 7. Look-ahead probe for crossing / merging traffic near intersections
    if (sim.nearIntersection(v) && v.v > 0.05) {
      const maxD = Math.min(16, (v.v * v.v) / (2 * b) + 4);
      const free = sim.collision.probe(v, maxD);
      if (free !== Infinity) {
        const aPr = idm(v.v, 0, free, v0, aMax, b, MIN_BUFFER + 0.25, 0.6);
        if (aPr < acc) {
          acc = aPr;
          constraint = 'probe';
        }
      }
    }

    // Start-up reaction: once whatever held a stopped vehicle clears, it takes a moment to go.
    if (v.v < 0.3 && acc > 0.05) {
      if (v.reactTimer === null) v.reactTimer = v.reaction + env.reactionExtra;
      if (v.reactTimer > 0) {
        acc = Math.min(acc, 0);
        constraint = 'reacting';
      }
    } else if (v.v >= 0.3 || acc <= 0.05) {
      v.reactTimer = null;
    }

    v.constraint = constraint;
    v.a = clamp(acc, -spec.hardDecel, aMax);
  }

  /** Acceleration that respects the cornering speed of curved lanes ahead (Infinity when none). */
  curveAccel(v, aMax, b) {
    const E = v.route.entries;
    let best = Infinity;
    let ahead = -v.localS - v.hl; // distance from the front to the start of the segment being scanned
    for (let i = v.segIdx; i < E.length && ahead < 70; i++) {
      const seg = E[i].seg;
      if (seg.curves?.length) {
        for (const c of seg.curves) {
          const d0 = ahead + c.s0;
          const d1 = ahead + c.s1;
          if (d1 < -v.spec.length || d0 > 70) continue;
          let a;
          if (d0 <= 0) a = Math.max(-b, aMax * (1 - Math.pow(v.v / c.vmax, 4))); // in the bend
          else if (v.v > c.vmax) a = Math.max(-b, (c.vmax * c.vmax - v.v * v.v) / (2 * d0));
          else continue;
          if (a < best) best = a;
        }
      }
      ahead += seg.length;
    }
    return best;
  }

  /** Post-move bookkeeping: waiting time, state label, horns. */
  updateAfterMove(v, dt) {
    const sim = this.sim;
    if (v.v < 1.2) {
      v.stoppedTime += dt;
      v.waitTime += dt;
    } else {
      v.stoppedTime = 0;
    }
    // Time stuck while our own signal is green, and a smoothed speed for blockage detection.
    if (v.v < 0.5 && v.signal === 'green') v.greenWait += dt;
    else v.greenWait = 0;
    v.avgSpeed += (v.v - v.avgSpeed) * Math.min(1, dt / 3);
    if (v.decisionTimer > 0) v.decisionTimer -= dt;
    if (v.reactTimer > 0) v.reactTimer -= dt;
    if (v.lcCooldown > 0) v.lcCooldown -= dt;
    v.recordSpeed(dt);
    if (v.hornFlash > 0) v.hornFlash -= dt;
    v.hornCooldown -= dt;
    if (v.loading && v.loading.state === 'stopped') {
      v.loading.timer -= dt;
      if (v.loading.timer <= 0) v.loading.state = 'done';
    }

    v.state = this.classify(v, sim);
    if (!v.emergency) this.horn(v, sim);
  }

  classify(v, sim) {
    const seg = v.segment;
    if (sim.time - v.spawnTime < 0.6) return AI_STATE.SPAWNING;
    if (seg.kind === 'connector') {
      if (v.v < 0.3 && v.stoppedTime > 1) return AI_STATE.BLOCKED_IN_INTERSECTION;
      if (seg.movement !== 'straight') return AI_STATE.TURNING;
      return AI_STATE.ENTERING_INTERSECTION;
    }
    if ((seg.role === 'exit' || seg.role === 'link') && seg.startInt && v.localS < v.hl + 1) {
      // Only "blocked in the intersection" while the rear is still inside the box.
      if (v.localS - v.hl < -0.3 && v.v < 0.3 && v.stoppedTime > 1) return AI_STATE.BLOCKED_IN_INTERSECTION;
      return AI_STATE.EXITING_INTERSECTION;
    }
    if (v.loading && v.loading.state === 'stopped') return AI_STATE.LOADING;
    if (seg.despawn && v.gatePassed && v.route.length - v.front < 12) return AI_STATE.DESPAWNING;
    const ce = v.nextConnEntry();
    if (ce && v.reservations.size && ce.start - v.front < 0.5) return AI_STATE.ENTERING_INTERSECTION;
    if (v.creeping) return AI_STATE.CREEPING_FORWARD;
    if (v.constraint === 'reacting') return AI_STATE.REACTING;
    if (v.constraint === 'signal' && v.v < 0.5) return AI_STATE.STOPPED_AT_RED;
    if ((v.constraint === 'waiting' || v.constraint === 'keepclear') && v.v < 0.5) return AI_STATE.WAITING_FOR_SPACE;
    if (v.constraint === 'leader') return v.a < -1 ? AI_STATE.BRAKING : AI_STATE.FOLLOWING;
    if (v.a < -1) return AI_STATE.BRAKING;
    return AI_STATE.APPROACHING;
  }

  horn(v, sim) {
    if (v.hornCooldown > 0) return;
    const P = v.p;
    const stuck = v.v < 0.5;
    if (!stuck) return;
    const atGreen = v.signal === 'green' && v.stoppedTime > P.hornDelay;
    const inBox = v.state === AI_STATE.BLOCKED_IN_INTERSECTION && v.stoppedTime > P.hornDelay * 1.5;
    const behindStuckLeader = v.leaderId !== null && v.stoppedTime > P.hornDelay * 2 && v.waitTime > P.patience * 0.5;
    const longWait = v.waitTime > P.patience && v.stoppedTime > 2;
    if (!(atGreen || inBox || behindStuckLeader || longWait)) {
      v.hornCooldown = 0.5;
      return;
    }
    let chance = P.hornChance * sim.hornIntensity;
    if (!atGreen && !inBox) chance *= 0.45; // honking at a red light is less common
    if (sim.rng.chance(Math.min(0.95, chance))) {
      const opts = HORN_TEXT[v.spec.horn] || HORN_TEXT.car;
      v.hornFlash = v.spec.horn === 'bus' || v.spec.horn === 'truck' ? 0.9 : 0.55;
      v.hornText = sim.rng.chance(0.45) ? sim.rng.pick(opts) : null;
      v.horns++;
      const [lo, hi] = P.hornCooldown;
      v.hornCooldown = sim.rng.range(lo, hi) / Math.sqrt(sim.hornIntensity);
      sim.emitHorn(v, P.key === 'aggressive' && sim.rng.chance(0.5));
    } else {
      v.hornCooldown = sim.rng.range(0.6, 1.8);
    }
  }
}
