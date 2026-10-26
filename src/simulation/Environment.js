// Weather and time of day. DOM-free; the renderer reads `rain` and `darkness` for visuals.
//
// Level config (all optional):
//   env: {
//     hour: 17.5,          // clock at the start of the session (0–24)
//     rate: 1,             // game minutes that pass per real second (0 = frozen clock)
//     weather: [{ t: 0, type: 'clear' }, { t: 70, type: 'rain' }, { t: 150, type: 'heavyRain' }],
//     random: true,        // pick weather changes at random (endless mode)
//     rushHour: true,      // demand follows the daily curve: AM and PM peaks, lunch bump, quiet nights
//   }
//   rush: { am: ['N', 'E'], pm: ['S', 'W'], amMul: 1.6, pmMul: 1.7 }  // level-level, optional:
//     approaches (arm or full key) that carry the morning inbound / evening outbound peak.
// Rain makes braking distances longer and drivers keep longer gaps; night slows reactions.

import { Calendar } from './Calendar.js';

const gauss = (h, c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
const TRUCKS = new Set(['truck', 'dumptruck', 'tanker']);
const PUV = new Set(['jeepney', 'ejeep', 'bus', 'multicab']);

export const PHASE_LABEL = {
  dawn: 'Madaling-araw',
  morning: 'Umaga',
  amRush: 'Rush hour (umaga)',
  noon: 'Tanghali',
  afternoon: 'Hapon',
  pmRush: 'Rush hour (gabi)',
  night: 'Gabi',
};

export const WEATHER = Object.freeze({ clear: 0, rain: 0.6, heavyRain: 1 });
export const WEATHER_LABEL = { clear: 'Maaraw', rain: 'Umuulan', heavyRain: 'Malakas na ulan' };

export class Environment {
  constructor(level = {}, rng = null) {
    const cfg = level.env || {};
    this.rng = rng;
    this.hour = cfg.hour ?? 9;
    this.rate = cfg.rate ?? 0;
    this.rushHour = !!cfg.rushHour;
    const rush = level.rush || {};
    this.rushAm = new Set(rush.am || []);
    this.rushPm = new Set(rush.pm || []);
    this.amMul = rush.amMul ?? 1.6;
    this.pmMul = rush.pmMul ?? 1.7;
    this.surgeMul = 1; // raised by the SurgeDirector wave after wave
    this.mallArms = new Set(rush.mall || []); // approaches that feed the malls (weekend, sweldo, Christmas)
    this.school = !!level.school; // a school on the map: student crowds and sundo at 6:30–7:30 and 16–17
    this.calendar = new Calendar(level.calendar || {});
    this.newDay = false; // set for one step after midnight
    this.timeline = [...(cfg.weather || [])].sort((a, b) => a.t - b.t);
    this.random = !!cfg.random;
    this.weather = this.timeline.length && this.timeline[0].t <= 0 ? this.timeline[0].type : cfg.start || 'clear';
    this.rain = WEATHER[this.weather] ?? 0; // smoothed intensity 0..1
    this.nextRandom = this.random ? this._randomDelay() : Infinity;
    this._applyFactors();
  }

  _randomDelay() {
    return this.rng ? this.rng.range(50, 110) : 80;
  }

  /** Advance the clock and weather. `t` is the scripted schedule time. */
  update(dt, t) {
    const h = this.hour + (this.rate * dt) / 60;
    this.newDay = h >= 24;
    if (this.newDay) this.calendar.nextDay();
    this.hour = h % 24;
    while (this.timeline.length && this.timeline[0].t <= t) this.weather = this.timeline.shift().type;
    if (t >= this.nextRandom) {
      const r = this.rng ? this.rng.next() : 0.5;
      this.weather = this.weather === 'clear' ? (r < 0.65 ? 'rain' : 'heavyRain') : r < 0.55 ? 'clear' : this.weather === 'rain' ? 'heavyRain' : 'rain';
      this.nextRandom = t + this._randomDelay();
    }
    const target = WEATHER[this.weather] ?? 0;
    // Rain builds up and dries out over ~10 s rather than switching instantly.
    const k = Math.min(1, dt / 10);
    this.rain += (target - this.rain) * k;
    if (Math.abs(target - this.rain) < 1e-3) this.rain = target;
    this._applyFactors();
  }

  _applyFactors() {
    const r = this.rain;
    const dark = this.darkness;
    this.brakeFactor = 1 - 0.35 * r; // wet asphalt: gentler usable braking
    this.headwayFactor = 1 + 0.5 * r; // drivers leave more time
    this.gapFactor = 1 + 0.4 * r; // and more standstill distance
    this.speedFactor = (1 - 0.15 * r) * (1 - 0.05 * dark);
    this.reactionExtra = 0.25 * dark + 0.15 * r; // seconds
  }

  /** 0 in daylight, 1 at full night, with dusk and dawn ramps. */
  get darkness() {
    const h = this.hour;
    if (h >= 6.5 && h <= 17.5) return 0;
    if (h > 17.5 && h < 19) return (h - 17.5) / 1.5;
    if (h > 5 && h < 6.5) return 1 - (h - 5) / 1.5;
    return 1;
  }

  /** Demand multiplier from the rush-hour curve (1 outside the peaks when enabled). */
  get demandFactor() {
    if (!this.rushHour) return 1;
    const peak = (c) => Math.exp(-((this.hour - c) ** 2) / (2 * 0.9 ** 2));
    return 0.75 + 0.75 * Math.max(peak(8), peak(18));
  }

  /** 0..1: how deep into a commute peak the clock is. */
  get rushIntensity() {
    return Math.max(gauss(this.hour, 8, 0.9), gauss(this.hour, 18.25, 1.1));
  }

  /** Part of the day, for the HUD, music and vehicle mix. */
  get phase() {
    const h = this.hour;
    if (h < 5) return 'dawn';
    if (h < 6.5) return 'morning';
    if (h < 9.5) return 'amRush';
    if (h < 11.5) return 'morning';
    if (h < 13.5) return 'noon';
    if (h < 16.5) return 'afternoon';
    if (h < 20) return 'pmRush';
    return 'night';
  }

  /**
   * Demand multiplier for one approach. Daytime base with a lunch bump, then the AM and PM peaks,
   * which hit hardest on the approaches named in the level's `rush` profile (inbound in the
   * morning, outbound in the evening) and lighter on the others. The calendar reshapes the day:
   * weekends, sweldo, Christmas, Simbang Gabi, Undas and Holy Week. 1 when the curve is off.
   */
  demandFor(key) {
    if (!this.rushHour) return 1;
    const h = this.hour;
    const f = this.calendar.factors(h);
    const arm = key.split(':')[1] ?? key;
    const on = (set) => set.has(key) || set.has(arm);
    const day = h < 5 || h >= 23 ? 0 : h < 7 ? (h - 5) / 2 : h > 21 ? (23 - h) / 2 : 1;
    const base = (0.3 + 0.5 * day + 0.25 * gauss(h, 12.3, 0.7)) * f.base;
    const dir = (set, mul) => (!set.size ? (mul + 1) / 2 : on(set) ? mul : 0.75);
    const am = 0.7 * gauss(h, 8, 0.9) * dir(this.rushAm, this.amMul) * f.am;
    const pm = 0.7 * gauss(h, 18.25, 1.1) * dir(this.rushPm, this.pmMul) * f.pm;
    const mall = f.mall * gauss(h, 15.5, 3) * (!this.mallArms.size ? 1 : on(this.mallArms) ? 1.6 : 0.6);
    const extra = 0.45 * f.church + 0.25 * this.schoolRush;
    // Long weekends: everyone leaves on the outbound (PM-profile) roads, and comes back inbound.
    const exodus = on(this.rushPm) ? f.out : on(this.rushAm) ? f.in : 1;
    return Math.max(0.25, (base + am + pm + mall + extra) * exodus * (1 + (this.surgeMul - 1) * this.rushIntensity));
  }

  /** 0..1 around school start and dismissal on school days, on maps with a school. */
  get schoolRush() {
    if (!this.school || !this.calendar.factors(this.hour).school) return 0;
    return Math.max(gauss(this.hour, 7, 0.45), gauss(this.hour, 16.5, 0.5));
  }

  /** People on the sidewalks at this hour: empty before dawn, crowded at the commute peaks. */
  get crowdFactor() {
    if (!this.rushHour) return 1;
    const h = this.hour;
    const f = this.calendar.factors(h);
    const day = h < 5 || h >= 23 ? 0 : h < 7 ? (h - 5) / 2 : h > 21 ? (23 - h) / 2 : 1;
    const people = 0.25 + 0.75 * day + 0.6 * this.rushIntensity * Math.max(f.am, f.pm) + 0.2 * gauss(h, 12.3, 0.8) + 0.5 * f.mall * gauss(h, 15.5, 3);
    return (people + 1.2 * this.schoolRush) * f.crowd;
  }

  /** The special day in effect now ('' on an ordinary weekday). */
  special() {
    return this.rushHour ? this.calendar.special(this.hour) : '';
  }

  /** Weight multiplier for a vehicle type at this hour: PUV-heavy peaks, truck ban, night trikes. */
  mixFactor(type) {
    if (!this.rushHour) return 1;
    const h = this.hour;
    const f = this.calendar.factors(h);
    if (TRUCKS.has(type)) {
      // Metro Manila truck ban: 6–10 AM and 5–10 PM, on weekdays; trucks move at night instead.
      if (!this.calendar.weekend && ((h >= 6 && h < 10) || (h >= 17 && h < 22))) return 0.05;
      return (h >= 22 || h < 5 ? 2 : 1) * f.truck;
    }
    const rush = this.rushIntensity * Math.max(f.am, f.pm);
    const night = h >= 21 || h < 5;
    if (PUV.has(type)) return (1 + 0.6 * rush) * (night ? (type === 'bus' ? 0.5 : 0.7) : 1) * (type === 'bus' ? f.bus : Math.sqrt(f.bus));
    if (type === 'motorcycle') return 1 + 0.5 * rush;
    if (type === 'tricycle') return night ? 1.6 : 1;
    if (type === 'car' || type === 'suv' || type === 'pickup' || type === 'van') return (1 - 0.15 * rush) * f.car;
    return 1;
  }

  clock() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  label() {
    return WEATHER_LABEL[this.weather] || '';
  }
}
