// Rush-hour surges for the endless modes. DOM-free.
//
// The day's two commute peaks (Environment.rushIntensity) become waves the player has to survive:
//   calm → warning (the radio counts down to the peak) → surge (peak demand, tense music)
//   → cleared: score bonus and a choice of one of three upgrade cards (sim.events 'surgeCards').
// Every wave comes back heavier (env.surgeMul), less what the player's cards took off.

import { PHASE_LABEL } from './Environment.js';

const PEAKS = [
  { c: 8, hw: 1.05, label: 'umaga' },
  { c: 18.25, hw: 1.3, label: 'gabi' },
];
const WARN_HOURS = 0.75; // game hours of warning before a surge starts
const WAVE_STEP = 0.15; // each later wave adds this much peak demand

/** Upgrade cards offered after a surge. `apply(sim)` changes the running session. */
export const SURGE_CARDS = {
  enforcer: { icon: '👮', name: 'Dagdag Enforcer', text: '+1 traffic enforcer at +1 marshal na puwedeng i-station', apply: (sim) => (sim.enforcement.max++, sim.enforcement.marshalMax++) },
  tow: { icon: '🚚', name: 'Mabilis na Tow', text: 'Tow truck dumarating sa 4 s imbes na 8 s', apply: (sim) => (sim.enforcement.towTime = Math.max(3, (sim.enforcement.towTime ?? 8) / 2)) },
  barker: { icon: '📣', name: 'Barker sa Sakayan', text: '"Cubao! Cubao!" · 35% mas mabilis sumakay at bumaba ang pasahero', apply: (sim) => (sim.boardingMul = (sim.boardingMul ?? 1) * 0.65) },
  wfh: { icon: '🏠', name: 'Work From Home Advisory', text: 'Mas magaan ang susunod na mga rush hour (−12% peak)', apply: (sim) => (sim.surge.relief += 0.12) },
  coding: { icon: '🔢', name: 'Number Coding', text: '8% na mas kaunting sasakyan sa buong araw', apply: (sim) => (sim.codingMul = (sim.codingMul ?? 1) * 0.92) },
  kanto: { icon: '🚫', name: 'Bawal Magbaba sa Kanto', text: 'Kalahati na lang ang jeep na humihinto sa gitna ng kanto', apply: (sim) => (sim.cornerStopMul = (sim.cornerStopMul ?? 1) * 0.5) },
  disiplina: { icon: '📏', name: 'Disiplina Campaign', text: 'Mas kaunting lumulusot sa red at sumisingit sa box', apply: (sim) => (sim.disciplineMul = (sim.disciplineMul ?? 1) * 0.7) },
};

export class SurgeDirector {
  constructor(sim) {
    this.sim = sim;
    this.state = 'calm';
    this.wave = 0;
    this.relief = 0;
    this.peak = null; // the peak being warned about / surged through
    this.countdown = 0; // real seconds to the surge (warning) or left in it (surge)
    this.offered = null; // card ids waiting for the player's pick
    this.taken = [];
  }

  /** Seconds of real time for `hours` of game clock. */
  _secs(hours) {
    const rate = this.sim.env.rate || 1;
    return (hours * 60) / rate;
  }

  update() {
    const sim = this.sim;
    const env = sim.env;
    if (!env.rushHour || !env.rate) return;
    const h = env.hour;
    let inside = null;
    let next = null;
    let nextIn = Infinity;
    for (const p of PEAKS) {
      const d = (((h - p.c) % 24) + 36) % 24 - 12; // signed hours from the peak centre
      if (Math.abs(d) < p.hw) inside = p;
      const toStart = (((p.c - p.hw - h) % 24) + 24) % 24;
      if (toStart < nextIn) {
        nextIn = toStart;
        next = p;
      }
    }
    if (inside) {
      if (this.state !== 'surge') this._start(inside);
      const d = (((h - inside.c) % 24) + 36) % 24 - 12;
      this.countdown = this._secs(inside.hw - d);
    } else {
      if (this.state === 'surge') this._clear();
      if (nextIn <= WARN_HOURS) {
        if (this.state !== 'warning') {
          this.state = 'warning';
          this.peak = next;
          sim.notify('SURGE_SOON', `⏰ RUSH HOUR ${next.label.toUpperCase()} · darating na ang dagsa ng sasakyan!`, 'warn');
          sim.events.push({ type: 'surge', state: 'warning', wave: this.wave + 1 });
        }
        this.countdown = this._secs(nextIn);
      } else if (this.state === 'warning') {
        this.state = 'calm';
      }
    }
  }

  _start(peak) {
    const sim = this.sim;
    this.state = 'surge';
    this.peak = peak;
    this.wave++;
    sim.env.surgeMul = Math.max(0.6, 1 + WAVE_STEP * (this.wave - 1) - this.relief);
    sim.notify('SURGE_ON', `🚨 RUSH HOUR WAVE ${this.wave} · ${PHASE_LABEL[sim.env.phase] || ''} — dagsa ng sasakyan at pasahero!`, 'danger');
    sim.events.push({ type: 'surge', state: 'surge', wave: this.wave });
  }

  _clear() {
    const sim = this.sim;
    this.state = 'calm';
    sim.scoring.onSurgeCleared?.(this.wave);
    sim.notify('SURGE_DONE', `✅ NALAMPASAN ANG RUSH HOUR WAVE ${this.wave}!`, 'good');
    this.offered = this._draw(3);
    sim.events.push({ type: 'surge', state: 'cleared', wave: this.wave });
    if (this.offered.length) sim.events.push({ type: 'surgeCards', wave: this.wave, cards: this.offered });
  }

  _draw(n) {
    const pool = Object.keys(SURGE_CARDS).filter((id) => !(id === 'enforcer' && ((!this.sim.enforcement.max && !this.sim.level.enforcer) || this.sim.enforcement.max >= this.sim.enforcement.junctions)));
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.sim.rng.next() * pool.length), 1)[0]);
    return out;
  }

  /** The player picked a card. Returns true when it was one of the offered ones. */
  pick(id) {
    if (!this.offered?.includes(id)) return false;
    SURGE_CARDS[id].apply(this.sim);
    this.taken.push(id);
    this.offered = null;
    this.sim.notify(`CARD_${id}`, `${SURGE_CARDS[id].icon} ${SURGE_CARDS[id].name.toUpperCase()}`, 'good');
    return true;
  }
}
