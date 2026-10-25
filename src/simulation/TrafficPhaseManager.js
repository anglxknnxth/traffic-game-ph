// Signal phase state machine for one intersection.
//   GREEN(phase) -> YELLOW -> ALL_RED (clearance) -> GREEN(next phase)
//   GREEN(phase) -> YELLOW -> ALL_RED -> FLASH (flashing yellow: every approach is stop-and-go)
//   FLASH -> ALL_RED -> GREEN(phase)
// The player is fully in control: there is no minimum green, a change starts the moment it is
// requested, and a change in progress can be redirected or cancelled. Yellow and a short fixed
// all-red still run between greens, and only one phase is ever green. A phase is a set of approach
// arms (optionally limited to some movements); by default every approach is its own phase.

import { SIGNAL_TIMING } from '../data/config.js';

export const PHASE = Object.freeze({ GREEN: 'GREEN', YELLOW: 'YELLOW', ALL_RED: 'ALL_RED', FLASH: 'FLASH' });
/** Pseudo group id used as the target of a change into flashing yellow. */
export const FLASH_GROUP = '*flash';
export const DEFAULT_PHASES = Object.freeze([
  { id: 'N', arms: ['N'], label: 'North' },
  { id: 'E', arms: ['E'], label: 'East' },
  { id: 'S', arms: ['S'], label: 'South' },
  { id: 'W', arms: ['W'], label: 'West' },
]);
// Old paired group ids (still used by some level data and saved warm-ups).
const LEGACY_AXIS = { NS: ['N', 'S'], EW: ['E', 'W'] };

export class TrafficPhaseManager {
  constructor({
    phases = DEFAULT_PHASES,
    initialGroup = phases[0].id,
    yellow = SIGNAL_TIMING.yellow,
    allRed = SIGNAL_TIMING.allRed,
  } = {}) {
    this.phases = phases.map((p) => ({ id: p.id, label: p.label || p.id, arms: new Set(p.arms), moves: p.moves ? new Set(p.moves) : null }));
    this.groups = this.phases.map((p) => p.id);
    this.byId = new Map(this.phases.map((p) => [p.id, p]));
    const initial = this.resolve(initialGroup);
    if (!initial) throw new Error(`Unknown group ${initialGroup}`);
    this.yellow = yellow;
    this.allRed = allRed;
    this.state = PHASE.GREEN;
    this.activeGroup = initial;
    this.nextGroup = null;
    this.pendingGroup = null; // never set: requests act immediately (kept for callers that check it)
    this.timer = 0;
    this.earlyRequests = 0;
    this.switches = 0;
    this.priorityGroup = null;
    this.history = [{ state: this.state, group: this.activeGroup }];
  }

  /** Phase id for `group`, accepting the old paired ids ('NS' -> first N/S phase). Null if none. */
  resolve(group) {
    if (this.byId.has(group)) return group;
    const axis = LEGACY_AXIS[group];
    if (!axis) return null;
    for (const arm of axis) for (const p of this.phases) if (p.arms.has(arm)) return p.id;
    return null;
  }

  get flashing() {
    return this.state === PHASE.FLASH;
  }

  labelOf(group) {
    if (group === FLASH_GROUP) return 'FLASHING YELLOW';
    return this.byId.get(group)?.label || group || '';
  }

  /** True when `group` releases traffic from `arm` doing `move`. */
  covers(group, arm, move = 'straight') {
    const p = this.byId.get(group);
    return !!p && p.arms.has(arm) && (!p.moves || p.moves.has(move));
  }

  /** First phase that releases `arm` doing `move` (null when none does). */
  phaseFor(arm, move = 'straight') {
    for (const p of this.phases) if (p.arms.has(arm) && (!p.moves || p.moves.has(move))) return p.id;
    for (const p of this.phases) if (p.arms.has(arm)) return p.id;
    return null;
  }

  signalForGroup(group) {
    if (this.state === PHASE.FLASH) return 'flash';
    if (group !== this.activeGroup) return 'red';
    if (this.state === PHASE.GREEN) return 'green';
    if (this.state === PHASE.YELLOW) return 'yellow';
    return 'red';
  }

  /** 'green' | 'yellow' | 'red' | 'flash' (flashing yellow: stop, then go when clear). */
  signalForArm(arm, move = 'straight') {
    if (this.state === PHASE.FLASH) return 'flash';
    return this.covers(this.activeGroup, arm, move) ? this.signalForGroup(this.activeGroup) : 'red';
  }

  greenGroups() {
    return this.groups.filter((g) => this.signalForGroup(g) === 'green');
  }

  /**
   * Switch to `group` right away. Returns { status, reason, early, wait }.
   * status: 'accepted' (change started, redirected or cancelled), 'ignored', 'rejected'.
   */
  requestPhase(requested) {
    const group = this.resolve(requested);
    if (!group) return { status: 'rejected', reason: 'Unknown signal group', early: false, wait: 0 };
    if (this.state === PHASE.FLASH) {
      // Leave flashing yellow through a clearance interval.
      this.state = PHASE.ALL_RED;
      this.nextGroup = group;
      this.timer = 0;
      this.history.push({ state: this.state, group: null });
      return { status: 'accepted', reason: 'Changing', early: false, wait: this.remaining() };
    }
    if (this.state === PHASE.GREEN) {
      if (group === this.activeGroup) return { status: 'ignored', reason: 'Already green', early: false, wait: 0 };
      this._beginYellow(group);
      return { status: 'accepted', reason: 'Changing', early: false, wait: this.remaining() };
    }
    if (group === this.nextGroup) return { status: 'ignored', reason: 'Already changing', early: false, wait: this.remaining() };
    // Picking the current group during yellow cancels the change: it simply stays green.
    if (this.state === PHASE.YELLOW && group === this.activeGroup) {
      this.state = PHASE.GREEN;
      this.nextGroup = null;
      this.timer = 0;
      this.history.push({ state: this.state, group: this.activeGroup });
      return { status: 'accepted', reason: 'Change cancelled', early: false, wait: 0 };
    }
    // Otherwise the transition in progress is redirected to the new group.
    this.nextGroup = group;
    return { status: 'accepted', reason: 'Redirected', early: false, wait: this.remaining() };
  }

  /** Change to flashing yellow (through the normal yellow and all-red clearance). */
  requestFlash() {
    if (this.state === PHASE.FLASH) return { status: 'ignored', reason: 'Already flashing', early: false, wait: 0 };
    if (this.state === PHASE.GREEN) {
      this._beginYellow(FLASH_GROUP);
      return { status: 'accepted', reason: 'Changing', early: false, wait: this.remaining() };
    }
    if (this.nextGroup === FLASH_GROUP) return { status: 'ignored', reason: 'Already changing', early: false, wait: this.remaining() };
    this.nextGroup = FLASH_GROUP;
    return { status: 'accepted', reason: 'Redirected', early: false, wait: this.remaining() };
  }

  _beginYellow(next) {
    this.state = PHASE.YELLOW;
    this.nextGroup = next;
    this.timer = 0;
    this.history.push({ state: this.state, group: this.activeGroup });
  }

  /** Advance timers. All-red is a fixed interval; box safety is enforced per vehicle. */
  update(dt) {
    this.timer += dt;
    switch (this.state) {
      case PHASE.YELLOW:
        if (this.timer >= this.yellow) {
          this.state = PHASE.ALL_RED;
          this.timer = 0;
          this.history.push({ state: this.state, group: null });
        }
        break;
      case PHASE.ALL_RED:
        if (this.timer >= this.allRed) {
          this.timer = 0;
          if (this.nextGroup === FLASH_GROUP) {
            this.state = PHASE.FLASH;
            this.nextGroup = null;
            this.history.push({ state: this.state, group: null });
          } else {
            this.state = PHASE.GREEN;
            this.activeGroup = this.nextGroup;
            this.nextGroup = null;
            this.switches++;
            this.history.push({ state: this.state, group: this.activeGroup });
          }
          if (this.history.length > 64) this.history.splice(0, this.history.length - 64);
        }
        break;
      default:
        break;
    }
  }

  /** Seconds until the change in progress completes (yellow and all-red combined); 0 otherwise. */
  remaining() {
    if (this.state === PHASE.YELLOW) return Math.max(0, this.yellow - this.timer) + this.allRed;
    if (this.state === PHASE.ALL_RED) return Math.max(0, this.allRed - this.timer);
    return 0;
  }

  /** HUD description of the phase. `countdown` is one continuous count to the next green. */
  describe() {
    if (this.state === PHASE.GREEN) {
      return { label: `GREEN ${this.labelOf(this.activeGroup)}`, state: this.state, group: this.activeGroup, countdown: null, pending: null, elapsed: this.timer };
    }
    if (this.state === PHASE.FLASH) {
      return { label: 'FLASHING YELLOW · STOP & GO', state: this.state, group: null, countdown: null, pending: null, elapsed: this.timer };
    }
    const yellow = this.state === PHASE.YELLOW;
    return {
      label: yellow ? `YELLOW ${this.labelOf(this.activeGroup)}` : 'ALL-RED',
      state: this.state,
      group: yellow ? this.activeGroup : null,
      countdown: this.remaining(),
      pending: this.nextGroup,
      elapsed: this.timer,
    };
  }
}
