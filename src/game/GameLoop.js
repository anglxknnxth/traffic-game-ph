// Fixed-step simulation with requestAnimationFrame rendering.
// Simulation speed (1x/2x/3x) runs more fixed steps per real second; the step size never changes,
// so collision checks and signal timing behave identically at every speed.

import { SIM_DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../data/config.js';

const STEP_BUDGET_MS = 10; // simulation work allowed per frame, leaving the rest for drawing
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
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
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
      const until = performance.now() + STEP_BUDGET_MS;
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
    requestAnimationFrame(this._frame);
  }
}
