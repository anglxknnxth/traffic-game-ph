// Procedural traffic audio via the Web Audio API: per-type horns, emergency sirens, an engine
// rumble bed with a diesel chug, and lo-fi background music (MusicPlayer). Sound effects and music
// have their own gain buses under the master. Voice-limited and rate-limited so heavy honking never
// floods the mixer. No audio files are required; the API degrades to silence where Web Audio is
// unavailable.

import { MusicPlayer } from './MusicPlayer.js';

// Vehicle type -> horn voice, where it differs from the spec's horn kind.
const HORN_VOICE = {
  suv: 'suv',
  pickup: 'suv',
  van: 'van',
  motorcycle: 'moto',
  dumptruck: 'truck',
  tanker: 'truck',
  kalesa: 'kalesa',
  police: 'police',
  firetruck: 'airhorn',
};

// Jeepney musical horns; each jeepney keeps its own.
const JEEP_TUNES = [
  [523, 659, 784],
  [784, 659, 784, 988],
  [659, 784, 880, 784],
  [523, 523, 784, 659],
  [880, 784, 659, 523],
];

/** A stable hash of a vehicle id (number or string). */
function hornSeed(id) {
  let h = typeof id === 'number' ? id | 0 : 0;
  if (typeof id === 'string') for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.imul(h ^ 0x9e37, 2654435761) >>> 0;
}

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.musicBus = null;
    this.volume = 0.7; // sound effects
    this.musicVolume = 0.5;
    this.musicOn = true;
    this.muted = false;
    // Horn limiter: a gridlock of drivers leaning on their horns comes out as a few distinct honks
    // (at most 3 at once, ~2 a second, no voice twice in a row), quieter the more of them there are.
    this.maxVoices = 3;
    this.active = 0;
    this.nextHorn = 0;
    this.hornTokens = 3;
    this.hornTokensAt = 0;
    this.hornPressure = 0;
    this.hornPressureAt = 0;
    this.lastVoice = new Map();
    this.siren = null;
    this.ambient = null;
    this.music = null;
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 5;
        this.master = this.ctx.createGain();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        this.sfx.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.music = new MusicPlayer(this.ctx, this.musicBus);
        this._applyVolume();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.enabled = false;
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyVolume();
  }

  setMusicVolume(v) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    this._applyVolume();
  }

  setMusicOn(on) {
    this.musicOn = !!on;
    this._applyVolume();
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.03);
    this.sfx.gain.setTargetAtTime(this.volume * 0.9, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVolume * 0.55 : 0, t, 0.08);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0;
  }

  _tone(t0, freqs, dur, type, pan, gain = 0.18, cutoff = 2600, glide = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.02, dur - 0.04));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      out = p;
    }
    filter.connect(g);
    out.connect(this.sfx);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      if (glide !== 1) {
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * glide, t0 + dur);
      }
      osc.detune.value = (Math.random() - 0.5) * 18;
      osc.connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
  }

  /**
   * Play a horn. kind: the vehicle spec's horn (car | moto | tricycle | jeepney | ejeep | multicab |
   * bus | truck | bell); `type` (vehicle type) picks a more specific voice, `id` the vehicle's own
   * variant and pitch, so the same jeepney always plays the same tune. `crowd`: how many horns went
   * off this frame (only one is played; the rest make the mix duck). pan in [-1, 1].
   */
  horn(kind, pan = 0, double = false, type = null, id = 0, crowd = 1) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.hornPressure = this.hornPressure * Math.exp(-(now - this.hornPressureAt) / 2) + crowd;
    this.hornPressureAt = now;
    this.hornTokens = Math.min(3, this.hornTokens + (now - this.hornTokensAt) * 2);
    this.hornTokensAt = now;
    if (now < this.nextHorn || this.active >= this.maxVoices || this.hornTokens < 1) return;
    const voice = HORN_VOICE[type] || kind || 'car';
    if (now - (this.lastVoice.get(voice) ?? -9) < 0.8) return;
    this.hornTokens -= 1;
    this.nextHorn = now + 0.35 + Math.random() * 0.15;
    this.lastVoice.set(voice, now);

    const seed = hornSeed(id);
    const variant = seed >>> 4;
    const pitch = 1 + ((seed % 9) - 4) / 100; // ±4% per vehicle
    const duck = Math.max(0.5, 1 / Math.sqrt(1 + Math.max(0, this.hornPressure - 1) / 3));
    const t = now + Math.random() * 0.03;
    const T = (dt, freqs, len, wave, gain, cutoff, glide = 1) => this._tone(t + dt, freqs.map((f) => f * pitch), len, wave, pan, gain * duck, cutoff, glide);
    let dur = 0.3;
    switch (voice) {
      case 'moto':
        if (variant % 2) {
          // one thin "piiip" that sags a little
          T(0, [820, 870], 0.22, 'square', 0.13, 3200, 0.92);
          dur = 0.25;
        } else {
          T(0, [740, 790], 0.11, 'square', 0.15, 3200);
          T(0.16, [740, 790], 0.11, 'square', 0.15, 3200);
        }
        break;
      case 'tricycle':
      case 'multicab':
        T(0, [580, 615], 0.13, 'sawtooth', 0.15, 2400);
        T(0.18, [580, 615], 0.13, 'sawtooth', 0.15, 2400);
        dur = 0.34;
        break;
      case 'jeepney': {
        const notes = JEEP_TUNES[variant % JEEP_TUNES.length];
        notes.forEach((f, i) => T(i * 0.13, [f, f * 1.005], 0.12, 'sawtooth', 0.14, 2800));
        dur = notes.length * 0.13 + 0.05;
        break;
      }
      case 'ejeep':
        T(0, [466, 587], 0.16, 'square', 0.14, 2600);
        T(0.22, [466, 587], 0.2, 'square', 0.14, 2600);
        dur = 0.45;
        break;
      case 'bell':
        // bicycle bell: two bright rings with a metallic overtone
        for (const dt of [0, 0.12]) T(dt, [2093, 2637, 3520], 0.1, 'triangle', 0.08, 7000);
        dur = 0.25;
        break;
      case 'kalesa':
        // kalembang: a lower brass bell, rung three times
        for (const dt of [0, 0.16, 0.32]) T(dt, [880, 1320, 1975], 0.14, 'triangle', 0.07, 5000);
        dur = 0.5;
        break;
      case 'police':
        // a short "whoop" yelp
        T(0, [600], 0.35, 'sawtooth', 0.1, 2400, 1.8);
        dur = 0.38;
        break;
      case 'airhorn':
        T(0, [131, 165, 196, 262], double ? 1 : 0.75, 'sawtooth', 0.17, 1600);
        dur = double ? 1.05 : 0.8;
        break;
      case 'bus':
        // air horn that sags at the end ("PHOOOM")
        T(0, [155, 196, 233], double ? 0.9 : 0.6, 'sawtooth', 0.19, 1400, 0.94);
        dur = double ? 0.95 : 0.65;
        break;
      case 'truck':
        if (double) {
          for (const dt of [0, 0.36, 0.72]) T(dt, [117, 147, 175], 0.28, 'sawtooth', 0.19, 1100);
          dur = 1.05;
        } else {
          T(0, [117, 147, 175], 0.65, 'sawtooth', 0.19, 1100);
          dur = 0.7;
        }
        break;
      case 'suv':
        // deeper, thicker dual tone
        T(0, [330, 415], double ? 0.14 : 0.3, 'sawtooth', 0.14, 1700);
        if (double) T(0.22, [330, 415], 0.18, 'sawtooth', 0.14, 1700);
        dur = double ? 0.44 : 0.32;
        break;
      case 'van':
        T(0, [392, 494], double ? 0.14 : 0.34, 'square', 0.13, 2000);
        if (double) T(0.22, [392, 494], 0.16, 'square', 0.13, 2000);
        dur = double ? 0.42 : 0.36;
        break;
      default:
        switch (variant % 3) {
          case 1: // lower, rounder beep
            T(0, [349, 440], double ? 0.14 : 0.28, 'square', 0.14, 1800);
            if (double) T(0.22, [349, 440], 0.16, 'square', 0.14, 1800);
            dur = double ? 0.42 : 0.3;
            break;
          case 2: // short "tit-tit"
            for (const dt of double ? [0, 0.12, 0.24] : [0, 0.12]) T(dt, [470, 590], 0.08, 'square', 0.14, 2600);
            dur = double ? 0.34 : 0.22;
            break;
          default:
            T(0, [415, 520], double ? 0.12 : 0.22, 'square', 0.15, 2300);
            if (double) T(0.2, [415, 520], 0.14, 'square', 0.15, 2300);
            dur = double ? 0.38 : 0.24;
        }
    }
    this.active++;
    setTimeout(() => {
      this.active = Math.max(0, this.active - 1);
    }, dur * 1000);
  }

  /** Traffic enforcer's whistle for pasaway pedestrians (rate-limited). */
  whistle(pan = 0) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastWhistle || 0) < 2.5) return;
    this.lastWhistle = now;
    this._tone(now, [2950, 3080], 0.16, 'square', pan, 0.06, 6500);
    this._tone(now + 0.22, [2950, 3080], 0.3, 'square', pan, 0.06, 6500);
  }

  /** Walkie-talkie bleep before a dispatch message. */
  radio() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastRadio || 0) < 1.5) return;
    this.lastRadio = now;
    this._tone(now, [1320], 0.06, 'square', 0, 0.035, 3000);
    this._tone(now + 0.08, [990], 0.07, 'square', 0, 0.035, 3000);
  }

  click() {
    if (!this.ready) return;
    this._tone(this.ctx.currentTime, [880], 0.05, 'triangle', 0, 0.08, 4000);
  }

  /** Continuous siren while emergency vehicles are on screen. */
  updateSiren(emergencies, time, panFn) {
    if (!this.ctx) return;
    const want = this.ready && emergencies.length > 0;
    if (want && !this.siren) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      let pan = null;
      osc.connect(filter);
      filter.connect(g);
      if (ctx.createStereoPanner) {
        pan = ctx.createStereoPanner();
        g.connect(pan);
        pan.connect(this.sfx);
      } else g.connect(this.sfx);
      osc.start();
      this.siren = { osc, g, pan };
    }
    if (!this.siren) return;
    const now = this.ctx.currentTime;
    if (!want) {
      this.siren.g.gain.setTargetAtTime(0.0001, now, 0.15);
      const s = this.siren;
      this.siren = null;
      setTimeout(() => {
        try {
          s.osc.stop();
        } catch {
          /* already stopped */
        }
      }, 600);
      return;
    }
    const fire = emergencies.some((v) => v.type === 'firetruck');
    const period = fire ? 0.5 : 3.2;
    const phase = (time % period) / period;
    const f = fire ? 700 + 650 * (phase < 0.5 ? phase * 2 : 2 - phase * 2) : 650 + 700 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    this.siren.osc.frequency.setTargetAtTime(f, now, 0.03);
    this.siren.g.gain.setTargetAtTime(0.07 + 0.025 * Math.min(2, emergencies.length - 1), now, 0.1);
    if (this.siren.pan && panFn) {
      const avg = emergencies.reduce((a, v) => a + panFn(v), 0) / emergencies.length;
      this.siren.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, avg)), now, 0.1);
    }
  }

  /**
   * Engine bed: a low noise rumble scaled by moving traffic, plus a pulsing diesel chug that grows
   * with the share of jeepneys, buses and trucks in view (`heavy`, 0..1).
   */
  updateAmbient(level, heavy = 0) {
    if (!this.ctx) return;
    if (!this.ambient && this.ready) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter);
      filter.connect(g);
      g.connect(this.sfx);
      src.start();
      // Diesel chug: a low sawtooth whose loudness is pulsed by a slow LFO.
      const chug = ctx.createOscillator();
      chug.type = 'sawtooth';
      chug.frequency.value = 46;
      const chugFilter = ctx.createBiquadFilter();
      chugFilter.type = 'lowpass';
      chugFilter.frequency.value = 220;
      const chugGain = ctx.createGain();
      chugGain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain);
      lfoGain.connect(chugGain.gain);
      chug.connect(chugFilter);
      chugFilter.connect(chugGain);
      chugGain.connect(this.sfx);
      chug.start();
      lfo.start();
      this.ambient = { src, g, chug, chugGain, lfoGain };
    }
    if (this.ambient) {
      const t = this.ctx.currentTime;
      const on = this.ready;
      this.ambient.g.gain.setTargetAtTime(on ? Math.min(0.22, 0.04 + level * 0.18) : 0, t, 0.4);
      const chug = on ? Math.min(0.09, (0.015 + level * 0.05) * (0.4 + heavy * 1.6)) : 0;
      this.ambient.chugGain.gain.setTargetAtTime(chug, t, 0.5);
      this.ambient.lfoGain.gain.setTargetAtTime(chug * 0.8, t, 0.5);
    }
  }

  /** Background music mood: 'menu' | 'day' | 'night' | 'rain' | 'tense'. */
  updateMusic(mood) {
    if (!this.music || this.ctx.state !== 'running') return;
    this.music.update(this.musicOn && !this.muted && this.musicVolume > 0 ? mood : null);
  }

  silence() {
    if (this.ambient) {
      this.ambient.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.ambient.chugGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.ambient.lfoGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
    if (this.siren) this.updateSiren([], 0);
  }
}
