// Score keeping. Safety carries the largest weight: the final score is scaled by the safety rating
// and the safety rating itself adds a large bonus.

import { clamp } from '../utils/math.js';
import { CONGESTION } from './GridlockDetector.js';

export class ScoringSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.b = {
      flow: 0,
      waitBonus: 0,
      emergency: 0,
      recovery: 0,
      gridlock: 0,
      waiting: 0,
      unsafe: 0,
      boxBlock: 0,
      emergencyPenalty: 0,
      peds: 0,
      pedWaiting: 0,
    };
    this.safety = 100;
    this.counts = { processed: 0, earlyRequests: 0, boxBlocks: 0, emergencies: 0, slowEmergencies: 0, recoveries: 0 };
  }

  onProcessed(vehicle) {
    this.counts.processed++;
    this.b.flow += vehicle.emergency ? 25 : 10;
    this.b.waitBonus += Math.max(0, 8 - vehicle.waitTime / 4);
  }

  onEarlyRequest() {
    this.counts.earlyRequests++;
    this.b.unsafe -= 5;
    this.safety -= 2;
  }

  onBoxBlock() {
    this.counts.boxBlocks++;
    this.b.boxBlock -= 3;
    this.safety -= 0.6;
  }

  onEmergencyCleared(delay) {
    this.counts.emergencies++;
    if (delay <= 10) this.b.emergency += 80;
    else if (delay <= 25) this.b.emergency += 40;
    else {
      this.counts.slowEmergencies++;
      this.b.emergencyPenalty -= 30;
      this.safety -= 5;
    }
  }

  /** A pedestrian made it across the crosswalk after waiting `wait` seconds. */
  onPedCrossed(wait) {
    this.b.peds += 4 + Math.max(0, 5 - wait / 8);
  }

  /** A pedestrian gave up waiting and crossed against the light. */
  onPedRedCross() {
    this.b.unsafe -= 4;
    this.safety -= 1;
  }

  /** People kept waiting too long at the crosswalks. */
  pedWaiting(dt, longWaiting) {
    if (longWaiting > 0) this.b.pedWaiting -= Math.min(longWaiting, 20) * 0.05 * dt;
  }

  onRecovery(fromLevel) {
    this.counts.recoveries++;
    this.b.recovery += fromLevel === CONGESTION.GRIDLOCK ? 60 : 25;
  }

  update(dt, level, longWaiters) {
    if (level === CONGESTION.GRIDLOCK) {
      this.b.gridlock -= 4 * dt;
      this.safety -= 0.12 * dt;
    } else if (level === CONGESTION.PARTIAL) {
      this.b.gridlock -= 1.2 * dt;
    }
    this.b.waiting -= Math.min(longWaiters, 40) * 0.05 * dt;
    this.safety = clamp(this.safety, 0, 100);
  }

  positive() {
    const b = this.b;
    return b.flow + b.waitBonus + b.emergency + b.recovery + b.peds;
  }

  negative() {
    const b = this.b;
    return b.gridlock + b.waiting + b.unsafe + b.boxBlock + b.emergencyPenalty + b.pedWaiting;
  }

  total() {
    const base = Math.max(0, this.positive() + this.negative());
    const s = clamp(this.safety, 0, 100);
    return Math.round(base * (0.5 + 0.5 * (s / 100)) + s * 4);
  }

  breakdown() {
    const r = (x) => Math.round(x);
    return [
      { label: 'Vehicles through', value: r(this.b.flow) },
      { label: 'Low-wait bonus', value: r(this.b.waitBonus) },
      { label: 'Emergency response', value: r(this.b.emergency + this.b.emergencyPenalty) },
      { label: 'Gridlock recovery', value: r(this.b.recovery) },
      { label: 'Gridlock / blockage', value: r(this.b.gridlock) },
      { label: 'Excessive waiting', value: r(this.b.waiting) },
      { label: 'Safety penalties', value: r(this.b.unsafe) },
      { label: 'Box-blocking entries', value: r(this.b.boxBlock) },
      ...(this.b.peds || this.b.pedWaiting
        ? [
            { label: 'Pedestrians crossed', value: r(this.b.peds) },
            { label: 'Pedestrians kept waiting', value: r(this.b.pedWaiting) },
          ]
        : []),
      { label: 'Safety rating', value: `${Math.round(this.safety)}%` },
    ];
  }
}
