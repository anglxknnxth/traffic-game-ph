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
import { FLASH_GROUP } from '../simulation/TrafficPhaseManager.js';

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
    this.loop = new GameLoop((dt) => this.update(dt), (dt) => this.render(dt));
    this.session = null;
    this.demo = null;
    this.hoveredHead = null;
    this.uiTime = 0;

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
    this.camera.setFocus(sim.network.focusRect(), sim.network.viewLimit());
    this.renderer.setNetwork(sim.network);
    this.resize();
  }

  // ------------------------------------------------------------------ sessions
  startDemo() {
    const sim = this.levels.createSim(this.levels.demo, 4242);
    this.demo = { sim, nextSwitch: sim.time + 10 };
    if (!this.session) this.applyNetwork(sim);
  }

  startSession(mode, id) {
    this.audio.unlock();
    const level = this.levels.get(mode, id);
    const sim = this.levels.createSim(level);
    this.session = {
      mode,
      id: level.id,
      mapId: mode === 'endless' ? level.map || 'single' : null,
      level,
      sim,
      elapsed: 0,
      tracker: this.levels.createTracker(),
      metricTimer: 0,
      ended: false,
    };
    this.state.screen = SCREEN.PLAYING;
    this.state.paused = false;
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
    this.startSession(this.session.mode, this.session.mode === 'endless' ? this.session.mapId : this.session.id);
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
    const res = sim.requestPhase(intersectionId, group);
    const multi = sim.lights.managers.size > 1;
    const where = multi ? ` (${intersectionId})` : '';
    const label = sim.lights.manager(intersectionId)?.labelOf(group) || group;
    if (res.status === 'accepted') {
      this.audio.click();
      if (res.reason === 'Change cancelled') this.hud.toast(`${label}${where} stays green`, 'ok');
      else this.hud.toast(`Switching to ${label}${where}: green in ${res.wait.toFixed(1)}s`, 'ok');
    } else if (res.status === 'ignored') {
      this.hud.toast(`${res.reason}${where}`, 'info');
    }
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
      if (sim.time > this.demo.nextSwitch) {
        demoAutopilot(sim);
        this.demo.nextSwitch = sim.time + 1;
      }
      if (sim.time > 600) this.startDemo();
    }
  }

  render(dtReal, alpha = 1) {
    this.camera.update(dtReal);
    this.uiTime += dtReal;
    const sim = this.sim;
    if (!sim) return;
    this.renderer.render(sim, { time: sim.time, debug: this.state.debug, hoveredHead: this.hoveredHead, alpha, dt: dtReal });
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
      if (playing) {
        const em = sim.vehicles.filter((v) => v.emergency);
        this.audio.updateSiren(em, sim.time, (v) => (this.camera.worldToScreen(v.x, v.y).x / this.camera.w) * 2 - 1);
        const moving = sim.metrics.vehicles ? sim.metrics.avgSpeed / 10 : 0;
        let heavy = 0;
        for (const v of sim.vehicles) if (v.spec.length > 6) heavy++;
        this.audio.updateAmbient(Math.min(1, (sim.metrics.vehicles / 50) * (0.45 + moving)), sim.vehicles.length ? heavy / sim.vehicles.length : 0);
      }
      this.hud.update(dtReal);
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

/** Simple queue-balancing controller for the menu background. */
function demoAutopilot(sim) {
  for (const [id, m] of sim.lights.managers) {
    if (m.state !== 'GREEN' || m.pendingGroup) continue;
    const p = sim.metrics.perIntersection.find((x) => x.id === id);
    if (!p) continue;
    const q = Object.fromEntries(m.groups.map((g) => [g, 0]));
    for (const a of p.approaches) {
      const g = m.phaseFor(a.arm);
      if (g) q[g] += a.queue;
    }
    let other = null;
    for (const g of m.groups) if (g !== m.activeGroup && (other === null || q[g] > q[other])) other = g;
    if (other && m.timer > 7 && (q[other] > q[m.activeGroup] * 1.3 + 1 || m.timer > 24)) sim.requestPhase(id, other);
  }
}
