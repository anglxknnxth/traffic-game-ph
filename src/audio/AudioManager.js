// Procedural traffic audio via the Web Audio API: per-type horns, emergency sirens and an engine
// rumble bed. Voice-limited and rate-limited so heavy honking never floods the mixer.
// No audio files are required; the API degrades to silence where Web Audio is unavailable.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.muted = false;
    this.maxVoices = 7;
    this.active = 0;
    this.lastPlay = 0;
    this.siren = null;
    this.ambient = null;
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
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

  setMuted(m) {
    this.muted = !!m;
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.master) return;
    const target = this.muted ? 0 : this.volume * 0.55;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0;
  }

  _tone(t0, freqs, dur, type, pan, gain = 0.18, cutoff = 2600) {
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
    out.connect(this.master);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 18;
      osc.connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
  }

  /** Play a horn. kind: car | moto | tricycle | jeepney | bus | truck. pan in [-1, 1]. */
  horn(kind, pan = 0, double = false) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlay < 0.045 || this.active >= this.maxVoices) return;
    this.lastPlay = now;
    let dur = 0.3;
    const t = now + Math.random() * 0.03;
    switch (kind) {
      case 'moto':
        this._tone(t, [740, 790], 0.11, 'square', pan, 0.09, 3200);
        this._tone(t + 0.16, [740, 790], 0.11, 'square', pan, 0.09, 3200);
        dur = 0.3;
        break;
      case 'tricycle':
        this._tone(t, [580, 615], 0.13, 'sawtooth', pan, 0.09, 2400);
        this._tone(t + 0.18, [580, 615], 0.13, 'sawtooth', pan, 0.09, 2400);
        dur = 0.34;
        break;
      case 'jeepney': {
        const notes = Math.random() < 0.5 ? [523, 659, 784] : [784, 659, 784, 988];
        notes.forEach((f, i) => this._tone(t + i * 0.13, [f, f * 1.005], 0.12, 'sawtooth', pan, 0.08, 2800));
        dur = notes.length * 0.13 + 0.05;
        break;
      }
      case 'bus':
      case 'truck':
        this._tone(t, [155, 196, 233], double ? 0.9 : 0.6, 'sawtooth', pan, 0.11, 1300);
        dur = double ? 0.95 : 0.65;
        break;
      default:
        this._tone(t, [415, 520], double ? 0.12 : 0.22, 'square', pan, 0.09, 2300);
        if (double) this._tone(t + 0.2, [415, 520], 0.14, 'square', pan, 0.09, 2300);
        dur = double ? 0.38 : 0.24;
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
    this._tone(now, [2950, 3080], 0.16, 'square', pan, 0.045, 6500);
    this._tone(now + 0.22, [2950, 3080], 0.3, 'square', pan, 0.045, 6500);
  }

  click() {
    if (!this.ready) return;
    this._tone(this.ctx.currentTime, [880], 0.05, 'triangle', 0, 0.06, 4000);
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
        pan.connect(this.master);
      } else g.connect(this.master);
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
    this.siren.g.gain.setTargetAtTime(0.05 + 0.02 * Math.min(2, emergencies.length - 1), now, 0.1);
    if (this.siren.pan && panFn) {
      const avg = emergencies.reduce((a, v) => a + panFn(v), 0) / emergencies.length;
      this.siren.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, avg)), now, 0.1);
    }
  }

  /** Low engine rumble scaled by how much traffic is moving. */
  updateAmbient(level) {
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
      filter.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start();
      this.ambient = { src, g };
    }
    if (this.ambient) {
      const target = this.ready ? Math.min(0.12, 0.02 + level * 0.1) : 0;
      this.ambient.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
    }
  }

  silence() {
    if (this.ambient) this.ambient.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    if (this.siren) this.updateSiren([], 0);
  }
}
