// Chill lo-fi background music, generated with the Web Audio API (no files).
// A look-ahead scheduler plays a swung 16-step boom-bap groove under warm electric-piano seventh
// chords, a round bass line, an occasional pentatonic lead and vinyl crackle, all through a
// lowpass "tape" filter with a slow pitch wobble. Moods change the progression, tempo, filter and
// drum weight, and crossfade smoothly:
//   menu  — sparse, soft hats only      day   — full groove
//   night — darker minor progression    rain  — extra crackle and an echo
//   tense — faster, minor, busier bass (gridlock)

const PROGRESSIONS = {
  // Each chord is four MIDI notes (one bar each).
  day: [
    [53, 57, 60, 64], // Fmaj7
    [52, 55, 59, 62], // Em7
    [50, 53, 57, 60], // Dm7
    [48, 52, 55, 59], // Cmaj7
  ],
  day2: [
    [50, 53, 57, 60], // Dm7
    [53, 55, 59, 62], // G7 (with F)
    [52, 55, 59, 60], // Cmaj7 / E
    [57, 60, 64, 67], // Am7
  ],
  night: [
    [57, 60, 64, 67], // Am7
    [53, 57, 60, 64], // Fmaj7
    [50, 53, 57, 60], // Dm7
    [52, 56, 59, 62], // E7
  ],
  tense: [
    [57, 60, 64, 67], // Am7
    [58, 62, 65, 69], // Bbmaj7
    [52, 56, 59, 62], // E7
    [57, 60, 63, 67], // Am(maj7-ish, darker)
  ],
};

const MOODS = {
  menu: { bpm: 74, prog: ['day', 'day2'], cutoff: 1300, kick: 0, snare: 0, hat: 0.45, bass: 0.6, lead: 0.12, crackle: 0.5, echo: 0.15 },
  day: { bpm: 82, prog: ['day', 'day2'], cutoff: 2000, kick: 1, snare: 1, hat: 1, bass: 1, lead: 0.25, crackle: 0.45, echo: 0.12 },
  night: { bpm: 74, prog: ['night'], cutoff: 1050, kick: 0.75, snare: 0.6, hat: 0.6, bass: 0.9, lead: 0.18, crackle: 0.6, echo: 0.22 },
  rain: { bpm: 78, prog: ['day2', 'night'], cutoff: 1300, kick: 0.8, snare: 0.7, hat: 0.7, bass: 0.9, lead: 0.2, crackle: 1, echo: 0.35 },
  tense: { bpm: 92, prog: ['tense'], cutoff: 2300, kick: 1.15, snare: 1.1, hat: 1.1, bass: 1.2, lead: 0.15, crackle: 0.35, echo: 0.1 },
};

const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic intervals
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class MusicPlayer {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.mood = null;
    this.params = MOODS.day;
    this.running = false;
    this.timer = null;
    this.step = 0;
    this.bar = 0;
    this.progName = 'day';
    this.cycle = 0;

    // voices -> mix -> tape lowpass -> fade -> out, with an echo send
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(out);
    this.tape = ctx.createBiquadFilter();
    this.tape.type = 'lowpass';
    this.tape.frequency.value = 1800;
    this.tape.Q.value = 0.4;
    this.tape.connect(this.fade);
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.9;
    this.mix.connect(this.tape);
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.32;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.12;
    this.tape.connect(this.echo);
    this.echo.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.fade);
    // Slow tape wobble shared by all pitched voices (in cents).
    this.wow = ctx.createOscillator();
    this.wow.frequency.value = 0.35;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 9;
    this.wow.connect(this.wowDepth);
    this.wow.start();

    this.noise = this._noiseBuffer(1.5, false);
    // Vinyl crackle: sparse random clicks, looping.
    this.crackle = ctx.createBufferSource();
    this.crackle.buffer = this._noiseBuffer(4, true);
    this.crackle.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackle.connect(hp);
    hp.connect(this.crackleGain);
    this.crackleGain.connect(this.fade);
    this.crackle.start();
  }

  _noiseBuffer(seconds, sparse) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      if (sparse) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : (Math.random() * 2 - 1) * 0.012;
      else d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Set the mood (null fades the music out and stops the scheduler). */
  update(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    const t = this.ctx.currentTime;
    if (!mood) {
      this.fade.gain.setTargetAtTime(0, t, 0.5);
      this.crackleGain.gain.setTargetAtTime(0, t, 0.5);
      clearTimeout(this._stopTimer);
      this._stopTimer = setTimeout(() => {
        if (this.mood) return;
        clearInterval(this.timer);
        this.timer = null;
        this.running = false;
      }, 2500);
      return;
    }
    const p = MOODS[mood] || MOODS.day;
    this.params = p;
    // Crossfade over about two seconds.
    this.tape.frequency.setTargetAtTime(p.cutoff, t, 0.8);
    this.echo.gain.setTargetAtTime(p.echo, t, 0.8);
    this.crackleGain.gain.setTargetAtTime(p.crackle * 0.5, t, 0.8);
    this.fade.gain.setTargetAtTime(1, t, 0.7);
    if (!this.running) {
      this.running = true;
      this.step = 0;
      this.bar = 0;
      this.nextTime = t + 0.1;
      this.timer = setInterval(() => this._tick(), 25);
    }
  }

  _tick() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    // Recover from a stall (tab in the background) without a burst of catch-up notes.
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this._schedule(this.step, this.nextTime);
      const sixteenth = 60 / this.params.bpm / 4;
      // Lazy swing: long-short pairs of sixteenths.
      this.nextTime += sixteenth * (this.step % 2 === 0 ? 1.18 : 0.82);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar = (this.bar + 1) % 4;
        if (this.bar === 0) {
          this.cycle++;
          const list = this.params.prog;
          this.progName = list[this.cycle % list.length];
        }
      }
    }
  }

  _schedule(step, t) {
    const p = this.params;
    const prog = PROGRESSIONS[this.progName] || PROGRESSIONS[p.prog[0]];
    const chord = prog[this.bar];
    const barLen = (60 / p.bpm) * 4;
    // Drums
    if (p.kick > 0 && (step === 0 || step === 10 || (step === 7 && this.bar % 2 === 1))) this._kick(t, 0.75 * p.kick);
    if (p.snare > 0 && (step === 4 || step === 12)) this._snare(t, 0.32 * p.snare);
    if (p.hat > 0 && step % 2 === 0) this._hat(t, (step % 4 === 2 ? 0.06 : 0.035) * p.hat);
    // Electric-piano chord on the bar, with a soft push before the next one
    if (step === 0) this._chord(chord, t, barLen * 0.9, 0.06);
    if (step === 14 && this.mood !== 'menu') this._chord(prog[(this.bar + 1) % 4], t, barLen * 0.25, 0.035);
    // Bass: root on 1, a syncopated hit on the "and" of 3, a passing fifth now and then
    const root = chord[0] - 24;
    if (step === 0) this._bass(midi(root), t, barLen * 0.4, 0.22 * p.bass);
    if (step === 10) this._bass(midi(root), t, barLen * 0.18, 0.16 * p.bass);
    if (this.mood === 'tense' && (step === 6 || step === 14)) this._bass(midi(root + 7), t, barLen * 0.1, 0.12 * p.bass);
    // Lead: a few pentatonic notes over the chord
    if ((step === 3 || step === 6 || step === 9 || step === 13) && Math.random() < p.lead) {
      const base = (chord[0] % 12) + 72;
      const n = base + PENTA[Math.floor(Math.random() * PENTA.length)] - (Math.random() < 0.3 ? 12 : 0);
      this._lead(midi(n), t, 0.35 + Math.random() * 0.4, 0.045);
    }
  }

  _env(t, peak, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.35), t + Math.min(dur, 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.mix);
    return g;
  }

  _osc(type, freq, t, dur, dest, wobble = true) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (wobble) this.wowDepth.connect(o.detune);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => {
      try {
        if (wobble) this.wowDepth.disconnect(o.detune);
      } catch {
        /* already disconnected */
      }
    };
  }

  _chord(notes, t, dur, gain) {
    for (const n of notes) {
      const g = this._env(t, gain, 0.012, dur);
      const f = midi(n);
      this._osc('sine', f, t, dur, g);
      const bell = this.ctx.createGain();
      bell.gain.value = 0.18;
      bell.connect(g);
      this._osc('triangle', f * 2, t, Math.min(dur, 0.6), bell);
    }
  }

  _bass(freq, t, dur, gain) {
    const g = this._env(t, gain, 0.01, dur);
    this._osc('sine', freq, t, dur, g, false);
    const h = this.ctx.createGain();
    h.gain.value = 0.25;
    h.connect(g);
    this._osc('triangle', freq * 2, t, dur, h, false);
  }

  _lead(freq, t, dur, gain) {
    const g = this._env(t, gain, 0.02, dur);
    this._osc('triangle', freq, t, dur, g);
  }

  _kick(t, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g);
    g.connect(this.mix);
    o.start(t);
    o.stop(t + 0.42);
  }

  _noiseHit(t, gain, type, freq, dur) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.mix);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.02);
  }

  _snare(t, gain) {
    this._noiseHit(t, gain, 'bandpass', 1700, 0.2);
    const g = this._env(t, gain * 0.35, 0.002, 0.09);
    this._osc('triangle', 185, t, 0.09, g, false);
  }

  _hat(t, gain) {
    this._noiseHit(t, gain, 'highpass', 7200, 0.045);
  }
}
