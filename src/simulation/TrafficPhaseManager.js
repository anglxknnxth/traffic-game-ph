// Signal phase state machine for one intersection.
//   GREEN(phase) -> YELLOW -> ALL_RED (clearance) -> GREEN(next phase)
//   GREEN(phase) -> YELLOW -> ALL_RED -> FLASH (flashing yellow: every approach is stop-and-go)
//   FLASH -> ALL_RED -> GREEN(phase)
// The player is fully in control: there is no minimum green, a change starts the moment it is
// requested, and a change in progress can be redirected or cancelled. Yellow and a short fixed
// all-red still run between greens. A phase is a set of approach arms (optionally limited to some
// movements); by default every approach is its own phase.
//
// Paired greens: while one single-road phase is green, requesting the road opposite it adds that
// road (its left turn first goes yellow then red, then the opposite road turns green). Both run
// straight and right only, so their paths never cross. Requesting one of the pair again drops the
// other through yellow; requesting any cross road changes over normally (both go yellow).

import { SIGNAL_TIMING, OPPOSITE } from '../data/config.js';

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
// Movements that cross the opposite road's straight traffic: banned while paired.
const CROSSING_MOVES = new Set(['left', 'uturn']);

/**
 * What a player's tap on `group` asks of the manager: tapping one of two paired greens turns just
 * that road red (the request keeps its partner), tapping the only green does nothing (null).
 * Anything else is requested as it is.
 */
export function playerPhaseRequest(m, group) {
  if (m.state !== PHASE.GREEN || m.signalForGroup(group) !== 'green') return group;
  const P = m.pair;
  if (P && P.stage === 'on') return group === m.activeGroup ? P.other : m.activeGroup;
  if (!P && group === m.activeGroup) return null;
  return group;
}

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
    // Paired green: { other, stage: 'adding' | 'on' | 'dropping', drop, t }. `other` is the second
    // green road; while dropping, `drop` is the road going yellow and the other one stays.
    this.pair = null;
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

  /** True when both roads of a pair are green (or the pair is being set up or taken down). */
  get paired() {
    return !!this.pair;
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

  /** The phase that may be paired with `group`: the single road opposite a single road. */
  oppositeOf(group) {
    const p = this.byId.get(group);
    if (!p || p.moves || p.arms.size !== 1) return null;
    const opp = OPPOSITE[[...p.arms][0]];
    for (const q of this.phases) if (!q.moves && q.arms.size === 1 && q.arms.has(opp)) return q.id;
    return null;
  }

  /** The other road of the pair (null when not paired). */
  get partner() {
    return this.pair ? this.pair.other : null;
  }

  /**
   * Signal of one movement of `group`. Straight and right follow the phase; left (and U-turns)
   * read red while paired.
   */
  _groupSignal(group, move) {
    if (this.state === PHASE.FLASH) return 'flash';
    const P = this.pair;
    const main = group === this.activeGroup;
    const other = P && group === P.other;
    if (!main && !other) return 'red';
    if (this.state === PHASE.ALL_RED) return 'red';
    const banned = P && CROSSING_MOVES.has(move);
    let s = this.state === PHASE.GREEN ? 'green' : 'yellow';
    if (P) {
      const leaving = P.stage === 'dropping' ? P.drop : null;
      if (group === leaving) return P.t < this.yellow ? 'yellow' : 'red';
      if (P.stage === 'adding') {
        if (other) return 'red';
        // The main road's left turn clears first: yellow, then red.
        if (banned) return P.t < this.yellow && s === 'green' ? 'yellow' : 'red';
        return s;
      }
      if (P.stage === 'dropping') {
        // The road that stays gets its left turn back once the dropped road has cleared.
        if (banned) return 'red';
        return s;
      }
      if (banned) return 'red';
    }
    return s;
  }

  signalForGroup(group) {
    return this._groupSignal(group, 'straight');
  }

  /** 'green' | 'yellow' | 'red' | 'flash' (flashing yellow: stop, then go when clear). */
  signalForArm(arm, move = 'straight') {
    if (this.state === PHASE.FLASH) return 'flash';
    if (this.covers(this.activeGroup, arm, move)) return this._groupSignal(this.activeGroup, move);
    if (this.pair && this.covers(this.pair.other, arm, move)) return this._groupSignal(this.pair.other, move);
    return 'red';
  }

  greenGroups() {
    return this.groups.filter((g) => this.signalForGroup(g) === 'green');
  }

  /**
   * Safety check for the controller: two greens are fine only as a pair of opposite roads with
   * their crossing movements on red.
   */
  conflicting() {
    const greens = this.groups.filter((g) => ['straight', 'right', 'left', 'uturn'].some((m) => this._groupSignal(g, m) === 'green'));
    if (greens.length <= 1) return false;
    if (greens.length > 2 || this.oppositeOf(greens[0]) !== greens[1]) return true;
    return greens.some((g) => this._groupSignal(g, 'left') === 'green' || this._groupSignal(g, 'uturn') === 'green');
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
      const P = this.pair;
      if (P) {
        if (P.stage === 'dropping') {
          if (group === P.drop && P.t < this.yellow) {
            // Changed our mind while it was still yellow: keep both roads.
            this.pair = { other: P.other, stage: 'on', drop: null, t: 0 };
            return { status: 'accepted', reason: 'Pair kept', early: false, wait: 0 };
          }
          if (group === this.activeGroup || group === P.other) return { status: 'ignored', reason: 'Already changing', early: false, wait: this.remaining() };
        } else if (group === this.activeGroup || group === P.other) {
          if (P.stage === 'adding') {
            if (group === P.other) return { status: 'ignored', reason: 'Already changing', early: false, wait: this.remaining() };
            this.pair = null; // cancel: the main road keeps all its movements
            return { status: 'accepted', reason: 'Change cancelled', early: false, wait: 0 };
          }
          // Keep `group` alone; the other road goes yellow, then red.
          const drop = group === this.activeGroup ? P.other : this.activeGroup;
          this.pair = { other: P.other, stage: 'dropping', drop, t: 0 };
          return { status: 'accepted', reason: 'Dropping pair', early: false, wait: this.remaining() };
        }
      } else {
        if (group === this.activeGroup) return { status: 'ignored', reason: 'Already green', early: false, wait: 0 };
        if (this.oppositeOf(this.activeGroup) === group) {
          this.pair = { other: group, stage: 'adding', drop: null, t: 0 };
          this.history.push({ state: 'PAIR', group });
          return { status: 'accepted', reason: 'Pairing', early: false, wait: this.remaining() };
        }
      }
      this._beginYellow(group);
      return { status: 'accepted', reason: 'Changing', early: false, wait: this.remaining() };
    }
    if (group === this.nextGroup) return { status: 'ignored', reason: 'Already changing', early: false, wait: this.remaining() };
    // Picking the current group during yellow cancels the change: it simply stays green.
    if (this.state === PHASE.YELLOW && group === this.activeGroup) {
      this.hold = null;
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

  /**
   * Patawid: hold every road on red for `secs` so people can cross (an enforcer's call), then give
   * the green back to the road that had it. Returns false when already holding.
   */
  holdForPeople(secs = 12) {
    if (this.hold || this.state === PHASE.FLASH) return false;
    const resume = this.state === PHASE.GREEN ? this.activeGroup : this.nextGroup || this.activeGroup;
    this.hold = { secs, resume };
    if (this.state === PHASE.GREEN) this._beginYellow(resume);
    else this.nextGroup = resume;
    return true;
  }

  /** True while every road is held for people crossing (after the clearance). */
  get pedHold() {
    return !!this.hold && this.state === PHASE.ALL_RED && this.timer >= this.allRed;
  }

  /** Seconds left of a people hold. */
  get pedHoldLeft() {
    return this.hold ? Math.max(0, this.allRed + this.hold.secs - (this.state === PHASE.ALL_RED ? this.timer : 0)) : 0;
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
    // A pair being set up never turned its second road green: just drop it.
    if (this.pair && this.pair.stage === 'adding') this.pair = null;
    if (this.pair && this.pair.stage === 'dropping') {
      // The dropped road is already yellow or red; the one staying is the only real green.
      const keep = this.pair.drop === this.activeGroup ? this.pair.other : this.activeGroup;
      this.activeGroup = keep;
      this.pair = null;
    }
    this.state = PHASE.YELLOW;
    this.nextGroup = next;
    this.timer = 0;
    this.history.push({ state: this.state, group: this.activeGroup });
  }

  /** Advance timers. All-red is a fixed interval; box safety is enforced per vehicle. */
  update(dt) {
    this.timer += dt;
    const P = this.pair;
    if (P && this.state === PHASE.GREEN) {
      P.t += dt;
      if (P.t >= this.yellow + this.allRed) {
        if (P.stage === 'adding') {
          this.pair = { other: P.other, stage: 'on', drop: null, t: 0 };
          this.switches++;
          this.history.push({ state: this.state, group: `${this.activeGroup}+${P.other}` });
        } else if (P.stage === 'dropping') {
          this.activeGroup = P.drop === this.activeGroup ? P.other : this.activeGroup;
          this.pair = null;
          this.timer = 0;
          this.history.push({ state: this.state, group: this.activeGroup });
        }
      }
    }
    switch (this.state) {
      case PHASE.YELLOW:
        if (this.timer >= this.yellow) {
          this.state = PHASE.ALL_RED;
          this.pair = null;
          this.timer = 0;
          this.history.push({ state: this.state, group: null });
        }
        break;
      case PHASE.ALL_RED:
        if (this.timer >= this.allRed + (this.hold ? this.hold.secs : 0)) {
          if (this.hold) {
            if (this.nextGroup !== FLASH_GROUP && !this.byId.has(this.nextGroup)) this.nextGroup = this.hold.resume;
            this.hold = null;
          }
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
    if (this.pair && this.pair.stage !== 'on') return Math.max(0, this.yellow + this.allRed - this.pair.t);
    return 0;
  }

  /** HUD description of the phase. `countdown` is one continuous count to the next green. */
  describe() {
    if (this.state === PHASE.GREEN) {
      const P = this.pair;
      if (P) {
        const both = `${this.labelOf(this.activeGroup)} + ${this.labelOf(P.other)}`;
        if (P.stage === 'on') return { label: `GREEN ${both} · NO LEFT TURN`, state: this.state, group: this.activeGroup, partner: P.other, countdown: null, pending: null, elapsed: this.timer };
        const label = P.stage === 'adding' ? `ADDING ${this.labelOf(P.other)}` : `DROPPING ${this.labelOf(P.drop)}`;
        return { label, state: this.state, group: this.activeGroup, partner: P.other, countdown: this.remaining(), pending: P.stage === 'adding' ? P.other : null, elapsed: this.timer };
      }
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
