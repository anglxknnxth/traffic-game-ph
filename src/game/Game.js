// Game shell: owns the loop, camera, renderer, audio, UI and the active simulation session.

import { Camera } from './Camera.js';
import { GameLoop } from './GameLoop.js';
import { GameState, SCREEN, MODE_LABEL } from './GameState.js';
import { LevelManager } from './LevelManager.js';
import { Renderer } from '../rendering/Renderer.js';
import { AudioManager } from '../audio/AudioManager.js';
import { InputManager } from '../input/InputManager.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { loadSave, writeSave, clearSave } from '../utils/storage.js';
import { CAREER_COUNT, PINOY_COUNT } from '../data/levels.js';
import { FLASH_GROUP, playerPhaseRequest } from '../simulation/TrafficPhaseManager.js';
import { Director } from './Director.js';
import { Network } from '../simulation/LaneManager.js';
import { PerfOverlay } from '../ui/PerfOverlay.js';

export class Game {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#game-canvas');
    this.save = loadSave();
    this.state = new GameState(this.save.settings);
    // Phones: start with the metrics panel collapsed so it does not cover the road (toggle via the stats button).
    if (window.innerWidth < 720) this.state.showMetrics = false;
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas, this.camera);
    this.audio = new AudioManager();
    this.audio.setVolume(this.save.settings.volume);
    this.audio.setMuted(this.save.settings.muted);
    this.audio.setMusicVolume(this.save.settings.music);
    this.audio.setMusicOn(this.save.settings.musicOn);
    // Browsers only allow audio after a user gesture: the first tap or key anywhere starts it
    // (so the menu music plays before a level is opened).
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.levels = new LevelManager();
    this.hud = new HUD(root.querySelector('#hud'), this);
    this.menu = new Menu(root.querySelector('#overlay'), this);
    this.input = new InputManager(this.canvas, this);
    this.perf = PerfOverlay.wanted() ? new PerfOverlay() : null;
    const step = this.perf
      ? (dt) => {
          const t = performance.now();
          this.update(dt);
          this.perf.sim += performance.now() - t;
        }
      : (dt) => this.update(dt);
    this.loop = new GameLoop(step, (dt, alpha) => this.render(dt, alpha));
    this.loop.fpsCap = this.save.settings.fpsCap || 0;
    this._em = [];
    this.session = null;
    this.demo = null;
    this.hoveredHead = null;
    this.uiTime = 0;
    this.director = new Director(this);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session && !this.session.ended && !this.state.paused) this.pause(true, true);
    });
  }

  start() {
    this.startDemo();
    this.resize();
    this.menu.showMain();
    this.loop.start();
  }

  get sim() {
    return this.session?.sim || this.demo?.sim || null;
  }

  // ------------------------------------------------------------------ layout
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.setViewport(w, h, dpr);
    this.camera.setInsets(this.session ? this.hud.insets() : { top: 0, bottom: 0, left: 0, right: 0 });
  }

  applyNetwork(sim) {
    if (sim.growth) {
      const f = sim.growth.focusRect();
      this.camera.setFocus(f, sim.network.reachFor(f));
    } else this.camera.setFocus(sim.network.focusRect(), sim.network.viewLimit());
    this.renderer.setNetwork(sim.network);
    this.resize();
  }

  // ------------------------------------------------------------------ sessions
  /** Rain / people on or off (from the next game started). */
  setWorldOption(key, on) {
    this.save.settings[key] = on;
    writeSave(this.save);
  }

  /** Chill Endless max traffic (ramp cap, 0 = no limit). Applies to a running Chill game right away. */
  setChillMaxTraffic(v) {
    this.save.settings.chillMaxTraffic = v;
    writeSave(this.save);
    if (this.session?.mode === 'chill') this.session.sim.rampMax = v || Infinity;
  }

  _options() {
    return { rain: this.save.settings.rain !== false, people: this.save.settings.people !== false };
  }

  startDemo() {
    const sim = this.levels.createSim(this.levels.withOptions(this.levels.demo, this._options()), 4242);
    this.demo = { sim };
    if (!this.session) this.applyNetwork(sim);
  }

  startSession(mode, id) {
    this.audio.unlock();
    const level = this.levels.withOptions(this.levels.get(mode, id), this._options());
    const sim = this.levels.createSim(level);
    if (mode === 'chill') sim.rampMax = this.save.settings.chillMaxTraffic || Infinity;
    this.session = {
      mode,
      id: level.id,
      mapId: mode === 'endless' || mode === 'chill' ? (mode === 'chill' ? id || 'single' : level.map || 'single') : null,
      level,
      sim,
      elapsed: 0,
      tracker: this.levels.createTracker(),
      metricTimer: 0,
      ended: false,
    };
    this.state.screen = SCREEN.PLAYING;
    this.state.paused = false;
    this.state.watch = false;
    this.state.tool = null;
    this.director.reset();
    this.loop.setPaused(false);
    this.loop.speed = this.state.speed;
    this.menu.hide();
    this.hud.show(this.session);
    this.applyNetwork(sim);
    sim.computeMetrics(0.25);
    if (mode === 'tutorial') {
      this.pause(true, false);
      this.hud.startTutorial();
    }
  }

  onTutorialDone() {
    this.save.tutorialDone = true;
    writeSave(this.save);
    this.pause(false);
  }

  restart() {
    if (!this.session) return;
    const m = this.session.mode;
    this.startSession(m, m === 'endless' || m === 'chill' ? this.session.mapId : this.session.id);
  }

  quitToMenu() {
    this.session = null;
    this.hud.hide();
    this.audio.silence();
    this.state.screen = SCREEN.MENU;
    this.state.paused = false;
    this.loop.setPaused(false);
    this.loop.speed = 1;
    if (!this.demo) this.startDemo();
    this.applyNetwork(this.demo.sim);
    this.menu.showMain();
  }

  pause(on, showMenu = false) {
    if (!this.session || this.session.ended) return;
    this.state.paused = on;
    this.loop.setPaused(on);
    this.hud.syncControls();
    if (on) {
      this.audio.silence();
      if (showMenu) this.menu.showPause();
    } else {
      this.menu.hide();
    }
  }

  togglePause() {
    if (!this.session || this.session.ended) return;
    if (this.state.paused) this.pause(false);
    else this.pause(true, true);
  }

  onEscape() {
    if (this.state.tool) {
      this.state.tool = null;
      this.hud.syncControls();
      return;
    }
    if (this.director.follow) {
      this.director.follow = null;
      this.director.shot = null;
      this.hud.toast('Stopped following');
      return;
    }
    if (this.state.watch) {
      this.toggleWatch();
      return;
    }
    if (this.session && !this.session.ended) {
      if (this.menu.current === 'settings') this.menu.showPause();
      else this.togglePause();
    } else if (!this.session && this.menu.current !== 'main') {
      this.menu.showMain();
    }
  }

  setSpeed(n) {
    this.state.speed = n;
    this.loop.speed = n;
    this.hud.syncControls();
  }

  setDefaultSpeed(n) {
    this.save.settings.speed = n;
    writeSave(this.save);
    this.setSpeed(n);
  }

  /** Frame-rate cap: 0 (every display frame), 72 or 60. */
  setFpsCap(n) {
    this.save.settings.fpsCap = n;
    writeSave(this.save);
    this.loop.fpsCap = n;
  }

  setVolume(v) {
    this.audio.setVolume(v);
    if (v > 0 && this.audio.muted) this.audio.setMuted(false);
    this.save.settings.volume = this.audio.volume;
    this.save.settings.muted = this.audio.muted;
    writeSave(this.save);
    this.hud.syncControls();
  }

  setMusicVolume(v) {
    this.audio.setMusicVolume(v);
    if (v > 0 && !this.audio.musicOn) this.audio.setMusicOn(true);
    this.save.settings.music = this.audio.musicVolume;
    this.save.settings.musicOn = this.audio.musicOn;
    writeSave(this.save);
  }

  setMusicOn(on) {
    this.audio.setMusicOn(on);
    this.save.settings.musicOn = this.audio.musicOn;
    writeSave(this.save);
  }

  /** Music mood for the current screen and traffic. */
  musicMood() {
    const s = this.session;
    if (!s) return 'menu';
    if (s.ended || this.state.paused) return 'menu';
    const sim = s.sim;
    const level = sim.metrics.level;
    if (level === 'GRIDLOCK' || sim.metrics.congestion > 0.75) return 'tense';
    if (sim.env.rain > 0.3) return 'rain';
    if (sim.env.darkness > 0.5) return 'night';
    return 'day';
  }

  setMuted(m) {
    this.audio.setMuted(m);
    this.save.settings.muted = m;
    writeSave(this.save);
    this.hud.syncControls();
  }

  toggleMute() {
    this.setMuted(!this.audio.muted);
    this.hud.toast(this.audio.muted ? 'Sound off' : 'Sound on');
  }

  setDebug(d) {
    this.state.debug = d;
    this.save.settings.debug = d;
    writeSave(this.save);
  }

  toggleDebug() {
    this.setDebug(!this.state.debug);
    this.hud.toast(this.state.debug ? 'Reservation overlay on' : 'Reservation overlay off');
  }

  setShowMetrics(on) {
    this.state.showMetrics = on;
    this.save.settings.showMetrics = on;
    writeSave(this.save);
    this.hud.syncControls();
    if (this.session) this.resize();
  }

  toggleMetrics() {
    this.setShowMetrics(!this.state.showMetrics);
  }

  /** Watch mode: HUD out of the way, the camera finds the action by itself. */
  toggleWatch() {
    if (!this.session || this.session.ended) return;
    this.state.watch = !this.state.watch;
    this.director.reset();
    this.hud.syncControls();
    this.hud.toast(this.state.watch ? 'WATCH MODE · panoorin lang · click a vehicle to follow it · H or Esc to exit' : 'Watch mode off');
  }

  /** Follow a vehicle with the camera (watch mode). */
  followVehicle(v) {
    if (!this.state.watch) return false;
    this.director.followVehicle(v);
    this.hud.toast(`Following: ${v.spec.label}`);
    return true;
  }

  toggleMonitor() {
    this.state.showMonitor = !this.state.showMonitor;
    this.hud.syncControls();
    if (this.session) this.resize();
  }

  /** Map overlay: speed heatmap with queue counts, or none. */
  toggleOverlay() {
    this.state.overlay = this.state.overlay === 'heat' ? null : 'heat';
    this.hud.syncControls();
    this.hud.toast(this.state.overlay ? 'Heatmap on: red = stopped, green = moving' : 'Heatmap off');
  }

  resetProgress() {
    const settings = { ...this.save.settings };
    this.save = clearSave();
    this.save.settings = settings;
    writeSave(this.save);
  }

  setHover(head) {
    this.hoveredHead = head;
  }

  requestPhase(intersectionId, group) {
    if (!this.session || this.session.ended || this.state.paused) return;
    const sim = this.session.sim;
    if (sim.openNodes && !sim.openNodes.has(intersectionId)) {
      this.hud.toast('That junction is not open yet: it runs on AUTO', 'info');
      return;
    }
    this.hud.select(intersectionId);
    // The player took this signal over: it leaves AUTO.
    const wasAuto = sim.autopilot.isAuto(intersectionId);
    sim.autopilot.onPlayerInput(intersectionId);
    const m = sim.lights.manager(intersectionId);
    const multi = sim.lights.managers.size > 1;
    const where = multi ? ` (${intersectionId})` : '';
    const ask = m ? playerPhaseRequest(m, group) : group;
    if (ask === null) {
      if (wasAuto) this.hud.toast(`MANUAL${where}: you have the lights · ↺ AUTO to hand back`, 'info');
      return; // tapping the only green does nothing
    }
    const res = sim.requestPhase(intersectionId, ask);
    const label = m?.labelOf(group) || group;
    if (wasAuto) this.hud.toast(`MANUAL${where}: you have the lights · ↺ AUTO to hand back`, 'info');
    else if (res.status === 'accepted') {
      this.audio.click();
      if (ask !== group) this.hud.toast(`${label}${where} red · ${m.labelOf(ask)} stays green`, 'ok');
      else if (res.reason === 'Change cancelled') this.hud.toast(`${label}${where} stays green`, 'ok');
      else if (res.reason === 'Pairing') this.hud.toast(`+ ${label}${where}: both roads go together · no left turn`, 'ok');
      else if (res.reason === 'Dropping pair') this.hud.toast(`Only ${label}${where} now · left turns back in ${res.wait.toFixed(1)}s`, 'ok');
      else if (res.reason === 'Pair kept') this.hud.toast(`Both roads stay green${where}`, 'ok');
      else this.hud.toast(`Switching to ${label}${where}: green in ${res.wait.toFixed(1)}s`, 'ok');
    } else if (res.status === 'ignored') {
      this.hud.toast(`${res.reason}${where}`, 'info');
    }
  }

  /** Tool picked in the HUD: 'enforcer' (station / move enforcers) or 'contraflow' (cone a lane). */
  setTool(tool) {
    this.state.tool = this.state.tool === tool ? null : tool;
    this.hud.syncControls();
    if (this.state.tool === 'enforcer') this.hud.toast('👮 Tap a junction to station an enforcer there (tap again to take them off)', 'info');
    if (this.state.tool === 'contraflow') this.hud.toast('🚧 Tap an undivided road near a junction to cone off a contraflow lane (tap a coned road again to remove)', 'info');
  }

  /** The player tapped the map with a tool, or tapped something the enforcer deals with. */
  toolAt(x, y) {
    const sim = this.session?.sim;
    if (!sim || this.session.ended || this.state.paused) return false;
    const t = this.state.tool;
    if (t === 'enforcer') {
      const I = sim.network.intersections.find((n) => n.layer === 0 && n.kind !== 'uturn' && Network.inCore(n, x, y, 8));
      if (!I) return false;
      const r = sim.enforcement.toggle(I.id);
      this.hud.toast(r.text, r.ok ? 'ok' : 'info');
      this.hud.buildPanels(sim);
      if (r.ok) this.audio.whistle(0);
      if (!sim.enforcement.available) this.state.tool = null;
      this.hud.syncControls();
      return true;
    }
    if (t === 'contraflow') {
      // Tapping the cones (or the coned lane, or that road again) takes them away.
      const hit = sim.counterflow.zoneAtPoint(x, y, Math.max(4, 20 / this.camera.scale));
      const at = this._laneAt(sim, x, y);
      const had = hit || (at && sim.counterflow.zoneAt(at.lane));
      if (had) {
        this.closeZone(had);
        this.state.tool = null;
        this.hud.syncControls();
        return true;
      }
      if (!at) return false;
      // The contraflow runs from where the road was tapped all the way to the junction.
      const z = sim.counterflow.openZone(at.lane, { from: at.s });
      this.hud.toast(typeof z === 'string' ? z : '🚧 Contraflow para sa mga kakaliwa: mula dito hanggang kanto · tap the cones to remove', typeof z === 'string' ? 'info' : 'ok');
      this.state.tool = null;
      this.hud.syncControls();
      return true;
    }
    return false;
  }

  /** Take a contraflow's cones away (the drivers already in it finish first). */
  closeZone(zone) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.counterflow.closeZone(zone);
    if (ok) {
      this.audio.whistle(0);
      this.hud.toast('🚧 Cones being picked up', 'ok');
    }
    return ok;
  }

  /** The inner approach lane nearest to (x, y) (within 5 m) and where along it, for the contraflow tool. */
  _laneAt(sim, x, y) {
    let best = null;
    let bestS = 0;
    let bestD = 5;
    const p = { x: 0, y: 0, dx: 0, dy: 0 };
    for (const lane of sim.network.lanes) {
      if ((lane.role !== 'approach' && lane.role !== 'link') || !lane.endInt) continue;
      const opp = sim.counterflow.oppOf(lane);
      if (!opp) continue;
      for (let s = 0; s < lane.length; s += 2) {
        lane.path.pointAt(s, p);
        // the tap may land on either inner lane: the borrowed one or the queue's own
        const d = Math.min(Math.hypot(p.x - x, p.y - y), Math.hypot(p.x - p.dy * (lane.offset + opp.offset) - x, p.y + p.dx * (lane.offset + opp.offset) - y));
        if (d < bestD) {
          bestD = d;
          best = lane;
          bestS = s;
        }
      }
    }
    return best ? { lane: best, s: bestS } : null;
  }

  /** HULI! Catch a violator (red-! vehicle). */
  catchVehicle(v) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.enforcement.catchVehicle(v);
    if (ok) {
      this.audio.whistle(0);
      this.hud.toast('🚨 HULI! Ticket issued', 'ok');
    }
    return ok;
  }

  /** Padaanin: wave the front vehicle of a red lane through (needs an enforcer at that junction). */
  waveThrough(v) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.enforcement.waveThrough(v);
    if (ok) this.audio.whistle(0);
    return ok;
  }

  /** Saway: send a jaywalker to the crosswalk. */
  saway(p) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.enforcement.saway(p);
    if (ok) {
      this.audio.whistle(0);
      this.hud.toast('Bawal tumawid dito! Sa tawiran po.', 'ok');
    }
    return ok;
  }

  /** Call a tow truck for a stalled vehicle / clear road works. */
  tow(b) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.enforcement.tow(b);
    if (ok) this.hud.toast('🚚 Tow truck called: clear in 8 s', 'ok');
    return ok;
  }

  /** Patawid at junction id (needs an enforcer there). */
  patawid(id) {
    if (!this.session || this.session.ended || this.state.paused) return;
    const r = this.session.sim.enforcement.patawid(id);
    this.hud.toast(r.text, r.ok ? 'ok' : 'info');
    if (r.ok) this.audio.whistle(0);
  }

  /** AUTO lights: one signal, or every signal (id null). */
  setAuto(intersectionId, on) {
    const sim = this.session?.sim;
    if (!sim) return;
    if (intersectionId) sim.autopilot.setAuto(intersectionId, on);
    else sim.autopilot.setAll(on);
    this.hud.toast(on ? (intersectionId ? `AUTO · ${intersectionId}` : 'AUTO LAHAT · the lights run themselves') : 'MANUAL · you have the lights', 'ok');
    this.hud.syncAuto?.();
  }

  /** The player clicked a vehicle: a stuck one is waved through ("bigla na lang aandar"). */
  wavePass(v) {
    if (!this.session || this.session.ended || this.state.paused) return false;
    const ok = this.session.sim.grantPass(v);
    if (ok) {
      this.audio.whistle(0);
      this.hud.toast('Pinadaan! The stuck vehicle goes ahead', 'ok');
    }
    return ok;
  }

  /**
   * What a vehicle's badge means, for the tooltip: { kind: 'bad' | 'stuck' | 'pass', title, why,
   * action }, or null for a vehicle without a badge.
   */
  vehicleInfo(v) {
    const sim = this.session?.sim;
    if (!sim || !v) return null;
    const name = v.spec.label;
    const bad = sim.enforcement.violationOf(v);
    if (bad) {
      const why = { counterflow: 'Nag-counterflow: nasa kabilang linya siya', red: 'Lumusot sa pula', box: 'Pumasok sa box kahit puno ang lalabasan', stop: 'Nagbaba / nagsakay sa loob ng intersection' }[bad];
      return { kind: 'bad', title: `PASAWAY · ${name}`, why, action: bad === 'counterflow' ? 'Click: HULI! (babalik siya sa linya niya)' : 'Click: HULI!' };
    }
    if (sim.hasPass(v)) return { kind: 'pass', title: `PINADAAN · ${name}`, why: 'Inuuna na siya ngayon', action: '' };
    if (!(v.stoppedTime > 3 && sim.isStuck(v))) return null;
    return { kind: 'stuck', title: `NAIPIT · ${name}`, why: this._stuckWhy(sim, v), action: 'Click: padaanin (10 s)' };
  }

  _stuckWhy(sim, v) {
    const find = (id) => (id === null || id === undefined ? null : sim.vehicles.find((o) => o.id === id) || null);
    const who = (o) => (o ? `${o.spec.label.toLowerCase()}${o.cf && !o.cf.legal && !o.cf.emergency ? ' na nag-counterflow' : ''}` : null);
    const blocker = find(v.blockerId);
    switch (v.blockReason) {
      case 'exit':
        return 'Puno ang lalabasan niya';
      case 'box':
        return blocker ? `Hinaharangan ng ${who(blocker)} ang daan niya sa intersection` : 'May nakaharang sa daan niya sa intersection';
      case 'queue':
        return 'Naghihintay sa nauna sa linya';
      case 'pedestrian':
        return 'May tumatawid sa daan niya';
      case 'yield':
        return blocker ? `Nagbibigay-daan sa ${who(blocker)}` : 'Nagbibigay-daan sa paparating';
      case 'emergency':
        return 'Nagbibigay-daan sa ambulansya';
      default:
        break;
    }
    const lead = find(v.leaderId);
    if (v.state === 'BLOCKED_IN_INTERSECTION' || v.segment.kind === 'connector') return lead ? `Naipit sa loob ng box, sa likod ng ${who(lead)}` : 'Naipit sa loob ng box';
    return lead ? `Nakaharang ang ${who(lead)} sa harap niya` : 'Hindi makausad';
  }

  /** Callout text for an emergency vehicle (emergency pointer). */
  emergencyInfo(v) {
    const sim = this.sim;
    const icon = v.type === 'firetruck' ? '🚒' : v.type === 'police' ? '🚓' : '🚑';
    const p = sim.priority.find((x) => x.vehicleId === v.id);
    const ce = v.nextConnEntry();
    const I = ce?.seg.intersection;
    const where = I ? sim.network.armLabel(I, ce.seg.arm) : '';
    if (!p) return { title: `${icon} ${v.spec.label.toUpperCase()}${where ? ` · ${where}` : ''}`, line: 'Clear the way · tabi muna', ok: true };
    const mgr = sim.lights.manager(p.intersectionId);
    const ok = mgr.signalForGroup(p.group) === 'green';
    const at = sim.lights.managers.size > 1 ? ` at ${p.intersectionId}` : '';
    return {
      title: `${icon} ${v.spec.label.toUpperCase()} · ${where}`,
      line: ok ? `Has the green${at} · ${Math.max(0, p.dist).toFixed(0)} m` : `Give ${mgr.labelOf(p.group)} the green${at} · ${Math.max(0, p.dist).toFixed(0)} m`,
      ok,
    };
  }

  /** Flashing yellow on/off. Turning it off hands green to the busiest approach. */
  toggleFlash(intersectionId) {
    if (!this.session || this.session.ended || this.state.paused) return;
    const sim = this.session.sim;
    const m = sim.lights.manager(intersectionId);
    if (!m) return;
    const where = sim.lights.managers.size > 1 ? ` (${intersectionId})` : '';
    if (m.flashing || m.nextGroup === FLASH_GROUP) {
      const p = sim.metrics.perIntersection.find((x) => x.id === intersectionId);
      let best = m.activeGroup;
      let bestQ = -1;
      for (const a of p?.approaches || []) {
        const g = m.phaseFor(a.arm);
        if (g && a.queue > bestQ) [best, bestQ] = [g, a.queue];
      }
      this.requestPhase(intersectionId, best);
      return;
    }
    const res = sim.requestFlash(intersectionId);
    if (res.status === 'accepted') {
      this.audio.click();
      this.hud.toast(`Flashing yellow${where}: stop and go in ${res.wait.toFixed(1)}s`, 'ok');
    }
  }

  // ------------------------------------------------------------------ loop callbacks
  update(dt) {
    const s = this.session;
    if (s) {
      if (s.ended) return;
      s.sim.step(dt);
      s.elapsed += dt;
      // Growing city: a new district opened. Ease the camera out to it and hand over its lights.
      const g = s.sim.growth;
      if (g && g.events.length) {
        for (const e of g.events) {
          const f = g.focusRect();
          this.camera.transitionTo(f, s.sim.network.reachFor(f));
          this.hud.buildPanels(s.sim);
          this.hud.banner?.(`BAGONG KANTO! · ${e.name}`);
          this.audio.click();
        }
        g.events.length = 0;
      }
      s.metricTimer += dt;
      if (s.metricTimer >= 0.25) {
        this.levels.track(s.tracker, s.sim, s.elapsed, s.metricTimer);
        s.metricTimer = 0;
        const end = this.levels.checkEnd(s.level, s.sim, s.tracker, s.elapsed);
        if (end) this.endSession(end);
      }
    } else if (this.demo) {
      const sim = this.demo.sim;
      sim.step(dt);
      if (sim.time > 600) this.startDemo();
    }
  }

  render(dtReal, alpha = 1) {
    this.camera.update(dtReal);
    if (this.session && !this.session.ended && (this.state.watch || this.director.follow)) this.director.update(dtReal, this.session.sim, this.state.watch && !this.state.paused);
    this.uiTime += dtReal;
    const sim = this.sim;
    if (!sim) return;
    // Junction footprints built ahead of need, in a slice of the frame (not while zooming).
    if (!this.camera.animating) sim.prefetch(Math.min(1.5, this.loop.frameMs * 0.1));
    const playing = !!this.session && !this.session.ended;
    const drawStart = this.perf ? performance.now() : 0;
    this.renderer.render(sim, {
      time: sim.time,
      debug: this.state.debug,
      hoveredHead: this.hoveredHead,
      alpha,
      dt: dtReal,
      frameMs: this.loop.frameMs,
      interactive: playing,
      overlay: this.state.overlay,
      tool: this.state.tool,
      emergencyInfo: playing && !this.state.watch ? (v) => this.emergencyInfo(v) : null,
    });
    this.perf?.frame(dtReal, performance.now() - drawStart, this.renderer.tiles, this.loop);
    const events = sim.drainEvents();
    this.audio.updateMusic(this.musicMood());
    if (this.session && !this.session.ended) {
      const playing = !this.state.paused;
      for (const e of events) {
        if (e.type === 'horn' && playing) {
          const p = this.camera.worldToScreen(e.x, e.y);
          if (p.x > -80 && p.x < this.camera.w + 80 && p.y > -80 && p.y < this.camera.h + 80) this.audio.horn(e.horn, (p.x / this.camera.w) * 2 - 1, e.double);
        } else if (e.type === 'pasaway' && playing) {
          const p = this.camera.worldToScreen(e.x, e.y);
          if (p.x > -80 && p.x < this.camera.w + 80 && p.y > -80 && p.y < this.camera.h + 80) this.audio.whistle((p.x / this.camera.w) * 2 - 1);
        } else if (e.type === 'notify') {
          this.hud.notify(e);
        }
      }
      // Sound automation 30 times a second is plenty (the values glide); every frame at 144 Hz
      // only floods the audio thread with events.
      this._audioT = (this._audioT || 0) + dtReal;
      if (playing && this._audioT >= 1 / 30) {
        this._audioT = 0;
        const em = this._em;
        em.length = 0;
        let heavy = 0;
        for (const v of sim.vehicles) {
          if (v.emergency) em.push(v);
          if (v.spec.length > 6) heavy++;
        }
        this.audio.updateSiren(em, sim.time, (v) => (this.camera.worldToScreen(v.x, v.y).x / this.camera.w) * 2 - 1);
        const moving = sim.metrics.vehicles ? sim.metrics.avgSpeed / 10 : 0;
        this.audio.updateAmbient(Math.min(1, (sim.metrics.vehicles / 50) * (0.45 + moving)), sim.vehicles.length ? heavy / sim.vehicles.length : 0);
      }
      this.hud.update(dtReal);
      this.hud.placeTip();
    }
  }

  endSession(end) {
    const s = this.session;
    s.ended = true;
    this.state.screen = SCREEN.RESULTS;
    this.audio.silence();
    const sim = s.sim;
    sim.computeMetrics(0.25);
    const level = s.level;
    const score = sim.scoring.total();
    const success = end.success;
    const stars = this.levels.stars(level, score, success);
    const objectives = this.levels.objectiveStatus(level, sim, s.tracker, true);
    const save = this.save;
    let best = 0;
    let newBest = false;
    let nextLevel = null;
    if (s.mode === 'career' || s.mode === 'tutorial') {
      const key = String(level.id);
      best = save.bestScores[key] || 0;
      if (success && score > best) {
        save.bestScores[key] = score;
        newBest = best > 0;
      }
      save.bestStars[key] = Math.max(save.bestStars[key] || 0, stars);
      if (success) {
        save.unlockedLevel = Math.min(CAREER_COUNT, Math.max(save.unlockedLevel, level.id + 1));
        if (level.id < CAREER_COUNT) nextLevel = level.id + 1;
      }
      if (s.mode === 'tutorial') save.tutorialDone = true;
    } else if (s.mode === 'pinoy') {
      const idx = this.levels.pinoy.findIndex((l) => l.id === level.id);
      best = save.pinoyBest[level.id] || 0;
      if (success && score > best) {
        save.pinoyBest[level.id] = score;
        newBest = best > 0;
      }
      save.pinoyStars[level.id] = Math.max(save.pinoyStars[level.id] || 0, stars);
      if (success) {
        save.pinoyUnlocked = Math.min(PINOY_COUNT, Math.max(save.pinoyUnlocked, idx + 2));
        nextLevel = this.levels.pinoy[idx + 1]?.id ?? null;
      }
    } else if (s.mode === 'endless') {
      const map = s.mapId || 'single';
      best = map === 'single' ? save.endlessBest : save.endlessBestByMap[map] || 0;
      if (score > best) {
        if (map === 'single') save.endlessBest = score;
        else save.endlessBestByMap[map] = score;
        newBest = best > 0;
      }
      save.endlessBestTime = Math.max(save.endlessBestTime, s.elapsed);
    } else if (s.mode === 'challenge') {
      best = save.challengeBest[level.id] || 0;
      if (success && score > best) {
        save.challengeBest[level.id] = score;
        newBest = best > 0;
      }
      if (success && !save.challengesCompleted.includes(level.id)) save.challengesCompleted.push(level.id);
    }
    writeSave(save);
    const label = s.mode === 'career' || s.mode === 'tutorial' ? `${MODE_LABEL[s.mode]} · Level ${level.id} · ${level.name}` : `${MODE_LABEL[s.mode]} · ${level.name}`;
    this.menu.showResults({
      mode: s.mode,
      levelLabel: label,
      success,
      reason: end.reason,
      score,
      stars,
      best,
      newBest,
      nextLevel,
      nextMode: s.mode === 'tutorial' ? 'career' : s.mode,
      processed: sim.stats.processed,
      avgWait: sim.metrics.overallWait,
      elapsed: s.elapsed,
      horns: sim.stats.horns,
      objectives,
      breakdown: sim.scoring.breakdown(),
    });
  }
}
