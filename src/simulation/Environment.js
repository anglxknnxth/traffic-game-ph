// Weather and time of day. DOM-free; the renderer reads `rain` and `darkness` for visuals.
//
// Level config (all optional):
//   env: {
//     hour: 17.5,          // clock at the start of the session (0–24)
//     rate: 1,             // game minutes that pass per real second (0 = frozen clock)
//     weather: [{ t: 0, type: 'clear' }, { t: 70, type: 'rain' }, { t: 150, type: 'heavyRain' }],
//     random: true,        // pick weather changes at random (endless mode)
//     rushHour: true,      // demand follows the rush-hour curve (peaks 7–9 and 17–19)
//   }
// Rain makes braking distances longer and drivers keep longer gaps; night slows reactions.

export const WEATHER = Object.freeze({ clear: 0, rain: 0.6, heavyRain: 1 });
export const WEATHER_LABEL = { clear: 'Maaraw', rain: 'Umuulan', heavyRain: 'Malakas na ulan' };

export class Environment {
  constructor(level = {}, rng = null) {
    const cfg = level.env || {};
    this.rng = rng;
    this.hour = cfg.hour ?? 9;
    this.rate = cfg.rate ?? 0;
    this.rushHour = !!cfg.rushHour;
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
    this.hour = (this.hour + (this.rate * dt) / 60) % 24;
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
