// Fixed-step simulation with requestAnimationFrame rendering.
// Simulation speed (1x/2x/3x) runs more fixed steps per real second; the step size never changes,
// so collision checks and signal timing behave identically at every speed.
// Work per frame is budgeted against the display's own refresh interval (measured): a 144 Hz
// screen leaves 6.9 ms a frame, not 16.7. An optional frame cap (60 / 72) draws only every so
// many display frames: 72 on a 144 Hz screen is every second frame, perfectly even.

import { SIM_DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../data/config.js';

const STEP_BUDGET_MS = 10; // most simulation work allowed per frame (on a 60 Hz screen)
const STEP_BUDGET_FRAC = 0.45; // ... and at most this share of a frame on a faster one
const MAX_BACKLOG = 3; // steps carried over to the next frame when the budget ran out

export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.speed = 1;
    this.paused = false;
    this.acc = 0;
    this.running = false;
    this.last = 0;
    this.tick = 0;
    this.refreshMs = 1000 / 60; // measured time between display frames (running average)
    this.fpsCap = 0; // 0: draw every display frame
    this._frame = this._frame.bind(this);
  }

  /** Time between drawn frames: the display's, or the cap's when that is longer. */
  get frameMs() {
    return this.fpsCap > 0 ? Math.max(this.refreshMs, 1000 / this.fpsCap) : this.refreshMs;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.tick = this.last;
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  setPaused(p) {
    this.paused = p;
    this.acc = 0;
  }

  _frame(t) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    const gap = t - this.tick;
    this.tick = t;
    if (gap > 0 && gap < 100) this.refreshMs += (gap - this.refreshMs) * 0.05;
    // Frame cap: skip display frames until it is time (a little early is fine: vsync rounds it).
    if (this.fpsCap > 0 && t - this.last < 1000 / this.fpsCap - this.refreshMs / 2) return;
    let dt = (t - this.last) / 1000;
    this.last = t;
    // Clamp large gaps (tab switches, debugger pauses) so vehicles never jump.
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (!this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      // Time budget: on a slow frame the simulation falls a little behind real time instead of
      // running a burst of catch-up steps (which would make the next frame slow too, and so on).
      // (At least one step always runs when one is due.)
      const until = performance.now() + Math.min(STEP_BUDGET_MS, this.frameMs * STEP_BUDGET_FRAC);
      while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.update(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
        if (performance.now() > until) break;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      else if (this.acc > MAX_BACKLOG * SIM_DT) this.acc = MAX_BACKLOG * SIM_DT;
    }
    try {
      // alpha: how far real time has run past the last simulated step (0..1), for interpolation.
      this.render(dt, this.paused ? 1 : Math.min(1, this.acc / SIM_DT));
    } catch (err) {
      console.error(err);
    }
  }
}
