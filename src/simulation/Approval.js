// Commuter approval: what the city thinks of the traffic manager, 0–100. DOM-free.
//
// It drifts toward a target set by how the roads feel right now (waits, gridlock, long queues at
// the jeepney stops) and jumps on the big moments, read back from the simulation's own events and
// stats so no other system has to call in: an ambulance through fast or slow, a carnapper caught or
// escaped, a VIP motorcade's green wave, a rush hour survived, a gridlock.
// Big jumps go viral: sim.events gets { type: 'viral', text, tag, good }.
// level.approvalFail: the run ends when approval sits at 0 for FAIL_S seconds (not in Chill).

import { CONGESTION } from './GridlockDetector.js';

const FAIL_S = 60;
const GOOD_TAGS = ['#EDSAOk', '#GreenWave', '#SalamatMMDA', '#AngLuwag', '#BiyaheNgMayPagAsa'];
const BAD_TAGS = ['#MMDAResign', '#TrafficNaNaman', '#ParkingLotNaPo', '#SabitNaNaman', '#WalangUsad'];

export class Approval {
  constructor(sim) {
    this.sim = sim;
    this.value = 60;
    this.zeroTime = 0;
    this.trending = [];
    this.tagSeq = 0;
    this._seenEvents = 0;
    this._emDelays = 0;
    this._lastLevel = CONGESTION.NORMAL;
  }

  get mood() {
    const v = this.value;
    return v >= 75 ? '😊' : v >= 50 ? '🙂' : v >= 30 ? '😤' : '🤬';
  }

  /** Seconds left before the run ends at 0 approval (Infinity when not failing). */
  get failIn() {
    return this.sim.level.approvalFail && this.value <= 0 ? Math.max(0, FAIL_S - this.zeroTime) : Infinity;
  }

  get failed() {
    return !!this.sim.level.approvalFail && this.zeroTime >= FAIL_S;
  }

  _bump(d, viral = null) {
    this.value = Math.max(0, Math.min(100, this.value + d));
    if (!viral) return;
    const good = d > 0;
    const pool = good ? GOOD_TAGS : BAD_TAGS;
    const tag = pool[(this.tagSeq++ * 7 + Math.round(this.value)) % pool.length]; // no draw from the traffic's random stream
    this.trending = [tag, ...this.trending.filter((t) => t !== tag)].slice(0, 3);
    this.sim.events.push({ type: 'viral', text: viral, tag, good });
  }

  /** Every metrics interval (dt ≈ 0.25 s). */
  update(dt) {
    const sim = this.sim;
    const m = sim.metrics;
    // Where opinion is heading: short waits and free roads please people, gridlock does not.
    let target = 80 - Math.min(60, m.avgWait * 1.1);
    if (m.level === CONGESTION.GRIDLOCK) target -= 30;
    else if (m.level === CONGESTION.PARTIAL) target -= 12;
    const longQueue = [...(sim.passengers?.stops.values() || [])].some((s) => s.waiting > 40);
    if (longQueue) target -= 10;
    this.value += (Math.max(0, target) - this.value) * Math.min(1, dt / 40);

    if (m.level === CONGESTION.GRIDLOCK && this._lastLevel !== CONGESTION.GRIDLOCK) this._bump(-5, 'GRIDLOCK na naman! Walang gumagalaw 😭');
    this._lastLevel = m.level;

    // Emergencies through: fast is applauded, slow is remembered.
    const delays = sim.stats.emergencyDelays;
    while (this._emDelays < delays.length) {
      const d = delays[this._emDelays++];
      if (d <= 10) this._bump(4, 'Ang bilis nakadaan ng ambulansya! 🚑👏');
      else if (d > 25) this._bump(-6, 'Naipit ang ambulansya sa traffic… 😡');
    }

    if (this.value <= 0.5) {
      this.value = 0;
      this.zeroTime += dt;
      if (sim.level.approvalFail) sim.notify('APPROVAL_ZERO', `🔥 GALIT NA ANG BUONG LUNGSOD · ayusin ang traffic bago ka ma-sibak (${Math.ceil(this.failIn)} s)`, 'danger');
    } else this.zeroTime = 0;
  }

  /**
   * End of every step: the events this step added. The Game swaps in a fresh array when it drains
   * them (once a frame, after the steps), so a new array starts the count again.
   */
  observe() {
    const ev = this.sim.events;
    if (ev !== this._evArr) {
      this._evArr = ev;
      this._seenEvents = 0;
    }
    const n = ev.length;
    for (let i = this._seenEvents; i < n; i++) this._onEvent(ev[i]);
    this._seenEvents = ev.length;
  }

  _onEvent(e) {
    if (e.type === 'surge' && e.state === 'cleared') this._bump(5, `Nakaraos din sa rush hour! Wave ${e.wave} ✅`);
    else if (e.type === 'boss' && e.kind === 'chase' && e.state === 'caught') this._bump(10, 'HULI ang carnapper! Galing ng traffic enforcer 🚓🔥');
    else if (e.type === 'boss' && e.kind === 'chase' && e.state === 'escaped') this._bump(-12, 'Nakatakas ang carnapper sa gitna ng traffic?! 😱');
    else if (e.type === 'boss' && e.kind === 'vip' && e.state === 'done') {
      if (e.stops === 0) this._bump(6, 'Perfect green wave para sa VIP… sana kami rin 😅');
      else if (e.stops > 2) this._bump(-4, 'Isinara ang kalsada para sa VIP, kami naiwan sa traffic 🙄');
    } else if (e.type === 'pasaway' && e.huli) this._bump(1);
  }
}
