// In-game heads-up display: score/time, signal controls, metrics, objectives, notifications,
// emergency banner, playback controls and the tutorial coach.

import { formatTime } from '../utils/math.js';
import { MODE_LABEL } from '../game/GameState.js';
import { CONGESTION } from '../simulation/GridlockDetector.js';
import { FLASH_GROUP } from '../simulation/TrafficPhaseManager.js';
import { Monitor } from './Monitor.js';
import { djLine } from './RadioDJ.js';

export const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 1 1-6.6 4.7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 4v6h6z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="2.4" rx="1"/><rect x="4" y="11" width="16" height="2.4" rx="1"/><rect x="4" y="16" width="16" height="2.4" rx="1"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.8" width="14" height="2.4" rx="1"/><rect x="10.8" y="5" width="2.4" height="14" rx="1"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.8" width="14" height="2.4" rx="1"/></svg>',
  stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="12" width="3.5" height="8" rx="1"/><rect x="10.25" y="7" width="3.5" height="13" rx="1"/><rect x="16.5" y="4" width="3.5" height="16" rx="1"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="2.5" y="7" width="5" height="3.4" rx="1"/><rect x="9.5" y="13.5" width="5" height="3.4" rx="1"/><rect x="16.5" y="9" width="5" height="3.4" rx="1"/></svg>',
};

// Phones and short landscape windows: the control rail folds away behind its toggle.
const RAIL_FOLDS = '(max-width: 720px), (max-height: 520px)';
const railFolds = () => typeof matchMedia !== 'undefined' && matchMedia(RAIL_FOLDS).matches;
// Picking one of these on a phone closes the rail again (a tool then waits for a tap on the map).
const RAIL_CLOSES = new Set(['restart', 'metrics', 'monitor', 'heat', 'forecast', 'enforcer', 'contraflow', 'watch', 'autoall']);

/** el[prop] = value, skipping the write (and the style / layout work it triggers) when unchanged. */
function set(el, prop, value) {
  const memo = el._hudSet || (el._hudSet = {});
  if (memo[prop] === value) return;
  memo[prop] = value;
  el[prop] = value;
}

const LEVEL_TEXT = {
  [CONGESTION.NORMAL]: ['Flowing', 'ok'],
  [CONGESTION.HEAVY]: ['Heavy traffic', 'warn'],
  [CONGESTION.PARTIAL]: ['Partly blocked', 'warn'],
  [CONGESTION.GRIDLOCK]: ['GRIDLOCK', 'danger'],
  [CONGESTION.RECOVERY]: ['Recovering', 'info'],
};

const TUTORIAL_STEPS = [
  { title: 'Welcome, traffic controller!', body: 'This is a busy kanto in Metro Manila, seen from directly above. Cars arrive from all four roads and you control the traffic lights.' },
  { title: 'One road at a time', body: 'Every approach has its own green. Tap a road\'s button below, tap its traffic light, or tap the yellow box in the middle to go to the next road. The change takes 2 seconds. Tap the <b>opposite</b> road while one is green and both go together, straight and right only (no left turn); tap one of the two greens to turn just that road red; tap a cross road and both turn red. <b>⚠ Flash</b> (or Y) turns every light to flashing yellow: drivers stop, then go when it is clear.' },
  { title: 'Safe transitions', body: 'You are in full control: a change starts the moment you tap, with a short <b>yellow</b> and <b>all-red</b> before the next green. Tap the current green during yellow to cancel.' },
  { title: 'Watch the box', body: 'Drivers wait if their exit road is full. Impatient ones may squeeze in anyway and block the yellow box. A red outline means a vehicle is stuck inside. A vehicle with an orange <b>!</b> is stuck: tap it and it goes ahead (optional, it clears on its own too).' },
  { title: 'Your goal', body: 'Move as many vehicles as you can and keep waiting times low. Your target is shown at the top. Keys: <b>1</b>/<b>2</b> switch phases, <b>Space</b> pauses, <b>F</b> changes speed.' },
];

export class HUD {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.timer = 0;
    this.notes = [];
    this.tutorialStep = -1;
    this.root.innerHTML = `
      <div class="hud-fx" aria-hidden="true"></div>
      <div class="hud-live" aria-hidden="true">
        <i class="cb tl"></i><i class="cb tr"></i><i class="cb bl"></i><i class="cb br"></i>
        <div class="live-tag"><b class="live-dot">● LIVE</b><span class="live-cam">CAM 01</span></div>
        <div class="live-ts">--</div>
      </div>
      <div class="hud-top">
        <div class="hud-block hud-level"><span class="hud-mode"></span><span class="hud-name"></span></div>
        <div class="hud-block hud-time"><span class="lbl">Time</span><b data-k="time">0:00</b></div>
        <div class="hud-block hud-env" hidden><span class="lbl" data-k="clock"></span><b data-k="weather"></b></div>
        <div class="hud-block hud-status" data-k="status"></div>
        <div class="hud-block hud-surge" hidden><span class="lbl" data-k="surgeLbl"></span><b data-k="surgeTime"></b><i class="surge-bar"><i data-k="surgeFill"></i></i></div>
        <div class="hud-block hud-approval" hidden title="Commuter approval: what the city thinks of your traffic"><span class="lbl">Approval</span><b data-k="approval"></b></div>
        <div class="hud-block hud-score"><span class="lbl">Score</span><b data-k="score">0</b></div>
        <div class="hud-actions">
          <button class="icon-btn" data-act="pause" title="Pause (Space)">${ICONS.pause}</button>
          <button class="icon-btn" data-act="menu" title="Menu (Esc)">${ICONS.menu}</button>
        </div>
      </div>
      <div class="hud-objectives"></div>
      <div class="hud-side">
        <aside class="hud-metrics"></aside>
        <aside class="hud-monitor" hidden></aside>
        <div class="hud-notify" aria-live="polite"></div>
        <div class="hud-feed" hidden></div>
      </div>
      <div class="hud-emergency" hidden></div>
      <div class="hud-bottom">
        <div class="signal-panels"></div>
      </div>
      <nav class="hud-rail" aria-label="Game controls">
        <button class="icon-btn rail-toggle" data-act="rail" title="Show / hide the controls" aria-expanded="false">${ICONS.tools}</button>
        <div class="hud-controls">
          <button class="icon-btn" data-act="restart" title="Restart (R)">${ICONS.restart}</button>
          <div class="seg" role="group" aria-label="Simulation speed">
            <button data-speed="1">1x</button><button data-speed="2">2x</button><button data-speed="3">3x</button><button data-speed="4">4x</button>
          </div>
          <button class="icon-btn" data-act="zoomin" title="Zoom in (+)">${ICONS.zoomIn}</button>
          <button class="icon-btn" data-act="zoomout" title="Zoom out (-)">${ICONS.zoomOut}</button>
          <button class="icon-btn" data-act="metrics" title="Toggle metrics">${ICONS.stats}</button>
          <button class="icon-btn mon-btn" data-act="monitor" title="Monitor: queues, throughput, green timeline (T)">📡</button>
          <button class="icon-btn heat-btn" data-act="heat" title="Speed heatmap and queue counts on the map (O)">🌡️</button>
          <button class="icon-btn forecast-btn" data-act="forecast" title="Hula: forecast which roads will fill up, and when">🔮</button>
          <button class="icon-btn tool-btn" data-act="enforcer" title="Station a traffic enforcer at a junction" hidden>👮<small class="tool-n"></small></button>
          <button class="icon-btn tool-btn" data-act="contraflow" title="Cone off a contraflow lane (tap the cones to remove)" hidden>🚧</button>
          <button class="icon-btn auto-all" data-act="autoall" title="AUTO LAHAT: every light runs itself (click a light to take it over)" hidden>AUTO</button>
          <button class="icon-btn watch-btn" data-act="watch" title="Watch mode: hide the controls and let the camera find the action (H)">👁</button>
          <button class="icon-btn" data-act="mute" title="Mute (M)">${ICONS.sound}</button>
          <input class="vol" type="range" min="0" max="100" step="1" data-act="volume" aria-label="Sound effects volume" />
          <button class="icon-btn music-btn" data-act="music" title="Background music on/off">♫</button>
        </div>
      </nav>
      <div class="hud-toast"></div>
      <div class="veh-tip" hidden><b class="vt-title"></b><span class="vt-why"></span><i class="vt-act"></i></div>
      <div class="hud-ticker"><span class="tk-tag">TRAFFIC UPDATE</span><div class="tk-wrap"><span class="tk-text"></span></div></div>
      <div class="hud-coach" hidden></div>
    `;
    this.el = {
      mode: root.querySelector('.hud-mode'),
      name: root.querySelector('.hud-name'),
      time: root.querySelector('[data-k="time"]'),
      env: root.querySelector('.hud-env'),
      clock: root.querySelector('[data-k="clock"]'),
      weather: root.querySelector('[data-k="weather"]'),
      approvalBox: root.querySelector('.hud-approval'),
      approval: root.querySelector('[data-k="approval"]'),
      surge: root.querySelector('.hud-surge'),
      surgeLbl: root.querySelector('[data-k="surgeLbl"]'),
      surgeTime: root.querySelector('[data-k="surgeTime"]'),
      surgeFill: root.querySelector('[data-k="surgeFill"]'),
      status: root.querySelector('[data-k="status"]'),
      score: root.querySelector('[data-k="score"]'),
      objectives: root.querySelector('.hud-objectives'),
      metrics: root.querySelector('.hud-metrics'),
      notify: root.querySelector('.hud-notify'),
      emergency: root.querySelector('.hud-emergency'),
      panels: root.querySelector('.signal-panels'),
      toast: root.querySelector('.hud-toast'),
      coach: root.querySelector('.hud-coach'),
      pause: root.querySelector('[data-act="pause"]'),
      mute: root.querySelector('[data-act="mute"]'),
      volume: root.querySelector('[data-act="volume"]'),
      music: root.querySelector('[data-act="music"]'),
      bottom: root.querySelector('.hud-bottom'),
      rail: root.querySelector('.hud-rail'),
      tip: root.querySelector('.veh-tip'),
      railBtn: root.querySelector('[data-act="rail"]'),
      top: root.querySelector('.hud-top'),
      side: root.querySelector('.hud-side'),
      cam: root.querySelector('.live-cam'),
      ts: root.querySelector('.live-ts'),
      autoAll: root.querySelector('[data-act="autoall"]'),
      feed: root.querySelector('.hud-feed'),
      ticker: root.querySelector('.tk-text'),
      monitor: root.querySelector('.hud-monitor'),
      monBtn: root.querySelector('[data-act="monitor"]'),
      enfBtn: root.querySelector('[data-act="enforcer"]'),
      cfBtn: root.querySelector('[data-act="contraflow"]'),
      heatBtn: root.querySelector('[data-act="heat"]'),
      forecastBtn: root.querySelector('[data-act="forecast"]'),
    };
    this.monitor = new Monitor(this.el.monitor);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => (this._layoutDirty = true));
      this._ro.observe(this.el.bottom);
      this._ro.observe(this.root);
    }
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.el.volume.addEventListener('input', () => game.setVolume(this.el.volume.value / 100));
    this.hide();
  }

  show(session) {
    this.root.hidden = false;
    this.session = session;
    const lvl = session.level;
    this.el.mode.textContent = session.mode === 'career' || session.mode === 'tutorial' ? `${MODE_LABEL[session.mode]} · Level ${lvl.id}` : MODE_LABEL[session.mode];
    this.el.name.textContent = lvl.name;
    this.el.notify.innerHTML = '';
    this.notes = [];
    this.buildPanels(session.sim);
    this.monitor.reset();
    this._simT = session.sim.time;
    this.syncControls();
    this.update(1, true);
    this.root.classList.toggle('metrics-hidden', !this.game.state.showMetrics);
    this.tutorialStep = -1;
    this.el.coach.hidden = true;
  }

  hide() {
    this.root.hidden = true;
    this.session = null;
    this.hideTip();
  }

  buildPanels(sim) {
    // Growing city: only the open junctions have controls.
    const managers = [...sim.lights.managers].filter(([id]) => !sim.openNodes || sim.openNodes.has(id));
    const multi = managers.length > 1;
    let key = 0;
    // Many junctions: an MMDA-style control box with one tab per junction and one panel showing.
    const tabbed = managers.length > 2;
    if (!tabbed || !managers.some(([id]) => id === this.selected)) this.selected = managers[0]?.[0] ?? null;
    this.el.panels.classList.toggle('compact', managers.length > 2);
    this.el.panels.classList.toggle('tabbed', tabbed);
    const tabs = tabbed
      ? `<div class="ctl-tabs">${managers
          .map(([id]) => {
            const I = sim.network.byId.get(id);
            const names = [...new Set(['N', 'E', 'S', 'W'].map((a) => sim.network.roadName(I, a)).filter(Boolean))].slice(0, 2).join(' × ');
            return `<button class="ctl-tab" data-tab="${id}" title="${names}"><i class="tab-dot"></i><b>${id}</b><span>${names}</span></button>`;
          })
          .join('')}</div>`
      : '';
    this.el.panels.innerHTML = tabs + managers
      .map(([id, m]) => {
        const btn = (g) => {
          key++;
          return `<button class="sig-btn" data-int="${id}" data-group="${g}" title="Request ${m.labelOf(g)} green${key <= 9 ? ` (${key})` : ''}"><span class="lamp"></span><span class="sig-name">${m.labelOf(g)}</span></button>`;
        };
        const half = Math.ceil(m.groups.length / 2);
        const left = m.groups.slice(0, half).map(btn).join('');
        const right = m.groups.slice(half).map(btn).join('');
        const auto = sim.level.allowAuto ? `<button class="auto-btn" data-auto="${id}" title="Hand this signal to AUTO, or take it back">AUTO</button>` : '';
        return `
      <div class="sig-panel" data-int="${id}" ${tabbed && id !== this.selected ? 'hidden' : ''}>
        ${multi || auto ? `<div class="sig-title">${multi ? `Intersection ${id}${tabbed ? ` · ${this._junctionName(sim, id)}` : ''}` : ''}${auto}</div>` : ''}
        <div class="sig-row">
          ${left}
          <div class="phase"><b class="phase-label"></b><span class="phase-count"></span><button class="flash-btn" data-flash="${id}" title="Flashing yellow: every road stops, then goes when clear (Y)">⚠ Flash</button>${sim.enforcement.near(sim.network.byId.get(id)) ? `<button class="flash-btn patawid-btn" data-patawid="${id}" title="The enforcer stops all traffic so people can cross (12 s)">🚸 Patawid</button>` : ''}</div>
          ${right}
        </div>
      </div>`;
      })
      .join('');
    this.panelEls = [...this.el.panels.querySelectorAll('.sig-panel')].map((p) => ({
      id: p.dataset.int,
      label: p.querySelector('.phase-label'),
      count: p.querySelector('.phase-count'),
      btns: [...p.querySelectorAll('.sig-btn')],
      flash: p.querySelector('.flash-btn'),
      auto: p.querySelector('.auto-btn'),
    }));
    this.tabEls = [...this.el.panels.querySelectorAll('.ctl-tab')];
    this.el.autoAll.hidden = !sim.level.allowAuto;
    this.syncAuto();
    this._syncTabs();
  }

  _junctionName(sim, id) {
    const I = sim.network.byId.get(id);
    return [...new Set(['N', 'E', 'S', 'W'].map((a) => sim.network.roadName(I, a)).filter(Boolean))].slice(0, 2).join(' × ');
  }

  /** Show junction `id` in the control box (a tapped light, a tab). */
  select(id) {
    if (!this.tabEls?.length || id === this.selected || !this.panelEls.some((p) => p.id === id)) return;
    this.selected = id;
    for (const p of this.el.panels.querySelectorAll('.sig-panel')) p.hidden = p.dataset.int !== id;
    this._syncTabs();
  }

  _syncTabs() {
    const sim = this.session?.sim;
    if (!sim || !this.tabEls?.length) return;
    for (const t of this.tabEls) {
      const id = t.dataset.tab;
      t.classList.toggle('active', id === this.selected);
      t.classList.toggle('auto', sim.autopilot.isAuto(id));
      const p = sim.metrics.perIntersection?.find((x) => x.id === id);
      t.classList.toggle('alert', !!p && (p.level === 'GRIDLOCK' || p.level === 'PARTIAL' || p.approaches.some((a) => a.headBlocked)));
      t.classList.toggle('siren', sim.priority.some((x) => x.intersectionId === id));
    }
  }

  /** AUTO badges: lit while the autopilot runs that signal. */
  syncAuto() {
    const sim = this.session?.sim;
    if (!sim) return;
    for (const p of this.panelEls || []) {
      const on = sim.autopilot.isAuto(p.id);
      p.auto?.classList.toggle('active', on);
      if (p.auto) p.auto.textContent = on ? 'AUTO' : '↺ AUTO';
    }
    this.el.autoAll.classList.toggle('active', sim.autopilot.allAuto);
  }

  syncControls() {
    const g = this.game;
    for (const b of this.root.querySelectorAll('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === g.state.speed);
    this.el.mute.innerHTML = g.audio.muted ? ICONS.mute : ICONS.sound;
    this.el.mute.classList.toggle('active', g.audio.muted);
    this.el.volume.value = Math.round(g.audio.volume * 100);
    this.el.music.classList.toggle('active', g.audio.musicOn);
    this.el.pause.innerHTML = g.state.paused ? ICONS.play : ICONS.pause;
    this.el.monitor.hidden = !g.state.showMonitor;
    this.el.monBtn.classList.toggle('active', !!g.state.showMonitor);
    this.el.heatBtn.classList.toggle('active', g.state.overlay === 'heat');
    this.el.forecastBtn.classList.toggle('active', !!g.state.forecast);
    this.root.classList.toggle('watch', !!g.state.watch);
    const sim = this.session?.sim;
    const enf = sim?.enforcement;
    this.el.enfBtn.hidden = !enf || enf.max <= 0;
    this.el.cfBtn.hidden = !enf || enf.max <= 0;
    if (enf) this.el.enfBtn.querySelector('.tool-n').textContent = `${enf.available}`;
    this.el.enfBtn.classList.toggle('active', g.state.tool === 'enforcer');
    this.el.cfBtn.classList.toggle('active', g.state.tool === 'contraflow');
    this.root.querySelector('[data-act="watch"]').classList.toggle('active', !!g.state.watch);
    this.root.classList.toggle('metrics-hidden', !g.state.showMetrics);
  }

  onClick(e) {
    const g = this.game;
    g.audio.unlock();
    const sig = e.target.closest('.sig-btn');
    if (sig) {
      g.requestPhase(sig.dataset.int, sig.dataset.group, 'button');
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      this.select(tab.dataset.tab);
      return;
    }
    const pw = e.target.closest('[data-patawid]');
    if (pw) {
      g.patawid(pw.dataset.patawid);
      return;
    }
    const auto = e.target.closest('[data-auto]');
    if (auto) {
      const id = auto.dataset.auto;
      g.setAuto(id, !g.sim.autopilot.isAuto(id));
      return;
    }
    const flash = e.target.closest('[data-flash]');
    if (flash) {
      g.toggleFlash(flash.dataset.flash);
      return;
    }
    const sp = e.target.closest('[data-speed]');
    if (sp) {
      g.setSpeed(Number(sp.dataset.speed));
      return;
    }
    const coach = e.target.closest('[data-coach]');
    if (coach) {
      this.nextTutorial(coach.dataset.coach === 'skip');
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act && act !== 'rail' && RAIL_CLOSES.has(act) && railFolds()) this.setRail(false);
    switch (act) {
      case 'rail':
        this.setRail(!this.railOpen);
        break;
      case 'pause':
        g.togglePause();
        break;
      case 'menu':
        g.pause(true, true);
        break;
      case 'restart':
        g.restart();
        break;
      case 'mute':
        g.toggleMute();
        break;
      case 'music':
        g.setMusicOn(!g.audio.musicOn);
        this.syncControls();
        this.toast(g.audio.musicOn ? 'Music on' : 'Music off');
        break;
      case 'zoomin':
        g.camera.zoomAt(1.2);
        break;
      case 'zoomout':
        g.camera.zoomAt(1 / 1.2);
        break;
      case 'metrics':
        g.toggleMetrics();
        break;
      case 'monitor':
        g.toggleMonitor();
        break;
      case 'heat':
        g.toggleOverlay();
        break;
      case 'forecast':
        g.toggleForecast();
        break;
      case 'enforcer':
        g.setTool('enforcer');
        break;
      case 'contraflow':
        g.setTool('contraflow');
        break;
      case 'watch':
        g.toggleWatch();
        break;
      case 'autoall':
        g.setAuto(null, !g.sim.autopilot.allAuto);
        break;
      default:
        break;
    }
  }

  /** Phones: fold the control rail away behind its toggle, or open it over the map. */
  setRail(open) {
    this.railOpen = open;
    this.root.classList.toggle('rail-open', open);
    this.el.railBtn.setAttribute('aria-expanded', String(open));
    this.el.railBtn.classList.toggle('active', open);
  }

  /** Space taken by HUD bars, so the camera keeps the intersection clear of them. */
  insets() {
    if (this.root.hidden) return { top: 0, bottom: 0, left: 0, right: 0 };
    const top = this.el.top.getBoundingClientRect().bottom + 6;
    const bottom = window.innerHeight - this.el.bottom.getBoundingClientRect().top + 6;
    // The control rail on the left edge (folded away over the map on phones), and everything on
    // the side in one column next to it.
    const rail = railFolds() ? 0 : Math.max(0, this.el.rail.getBoundingClientRect().right);
    const side = window.innerWidth > 980 && (this.game.state.showMetrics || this.game.state.showMonitor);
    return { top, bottom, left: rail + (side ? 184 : 0), right: 0 };
  }

  /** Big centred banner (a new district opened, ...). */
  banner(text) {
    let b = this.root.querySelector('.hud-banner');
    if (!b) {
      b = document.createElement('div');
      b.className = 'hud-banner';
      this.root.appendChild(b);
    }
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  /**
   * Explain a vehicle's "!" badge in a small card above it. `ms`: how long it stays (0: until
   * hideTip, for a mouse hover). `fixed`: show this info instead of the live one (after a tap acted).
   */
  showTip(v, ms = 0, fixed = null) {
    this.tip = { v, until: ms ? performance.now() + ms : Infinity, fixed };
    this.placeTip();
  }

  hideTip() {
    this.tip = null;
    this.el.tip.hidden = true;
  }

  /** Keep the tip on its vehicle (every frame while one is shown). */
  placeTip() {
    const t = this.tip;
    if (!t) return;
    const g = this.game;
    const v = t.v;
    const info = t.fixed || g.vehicleInfo(v);
    if (!info || v._remove || !g.sim?.vehicles.includes(v) || performance.now() > t.until) {
      this.hideTip();
      return;
    }
    const el = this.el.tip;
    el.hidden = false;
    set(el, 'className', `veh-tip ${info.kind}`);
    set(el.firstChild, 'textContent', info.title);
    set(el.children[1], 'textContent', info.why);
    set(el.children[2], 'textContent', info.action);
    const p = g.camera.worldToScreen(v.x, v.y - v.hl - 2.4);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
  }

  /** First badge of a session: say once what the colours mean. */
  _badgeHint(sim) {
    if (this._badgeHinted === this.session) return;
    for (const v of sim.vehicles) {
      if (!this.game.vehicleInfo(v)) continue;
      this._badgeHinted = this.session;
      this.notify({ severity: 'info', text: '❗ dilaw = naipit · ❗ pula = pasaway · hover (o pindutin nang matagal) ang sasakyan para sa detalye' });
      return;
    }
  }

  toast(text, kind = 'info') {
    const t = this.el.toast;
    t.textContent = text;
    t.className = `hud-toast show ${kind}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (t.className = 'hud-toast'), 1800);
  }

  notify(e) {
    // Refresh an identical notice that is still on screen instead of stacking a duplicate.
    for (const n of this.el.notify.children) {
      if (n.textContent === e.text && !n.classList.contains('fade')) return;
    }
    // Notices arrive over the radio, MMDA dispatch style.
    const div = document.createElement('div');
    div.className = `note radio ${e.severity || 'info'}`;
    div.innerHTML = `<span class="radio-time">${this._stamp(false)}</span><span class="radio-from">BASE</span><span class="radio-txt"></span>`;
    div.querySelector('.radio-txt').textContent = e.text;
    this.game.audio.radio?.();
    this.el.notify.prepend(div);
    this.notes.push(div);
    while (this.el.notify.children.length > 3) this.el.notify.lastChild.remove();
    setTimeout(() => div.classList.add('fade'), 3600);
    setTimeout(() => div.remove(), 4200);
  }

  update(dt, force = false) {
    if (!this.session) return;
    this.timer += dt;
    if (!force && this.timer < 0.12) return;
    this.timer = 0;
    const s = this.session;
    const sim = s.sim;
    const m = sim.metrics;
    const lvl = s.level;
    // The side column stops above the stack of panels at the bottom-left. Measured only when the
    // layout changed (a resize, panels rebuilt: see the ResizeObserver) or once a second, never
    // every update: a layout read in a busy frame can force a whole style and layout pass.
    this._layoutN = (this._layoutN || 0) + 1;
    if (this._layoutDirty !== false || this._layoutN % 8 === 0 || force) {
      this._layoutDirty = false;
      const sideTop = this.el.side.getBoundingClientRect().top;
      const room = Math.round(this.el.bottom.getBoundingClientRect().top - sideTop - 8);
      if (room > 0 && room !== this._sideRoom) {
        this._sideRoom = room;
        this.el.side.style.maxHeight = `${room}px`;
      }
    }
    this._street(sim);
    this._live(sim);
    this._badgeHint(sim);
    this.monitor.sample(sim, Math.max(0, sim.time - this._simT));
    this._simT = sim.time;
    // The monitor rebuilds a whole panel of markup: twice a second is enough to read it.
    this._monT = (this._monT || 0) + 1;
    if (this.game.state.showMonitor && (this._monT % 4 === 0 || force)) this.monitor.render(sim);
    set(this.el.time, 'textContent', lvl.duration ? formatTime(Math.max(0, lvl.duration - s.elapsed)) : formatTime(s.elapsed));
    set(this.el.score, 'textContent', sim.scoring.total().toLocaleString());
    // Clock and weather (levels with an environment only)
    this.el.env.hidden = !lvl.env;
    if (lvl.env) {
      const icon = sim.env.weather === 'clear' ? (sim.env.darkness > 0.5 ? '🌙' : '☀️') : sim.env.weather === 'rain' ? '🌧️' : '⛈️';
      const cal = sim.env.rushHour ? sim.env.calendar : null;
      set(this.el.clock, 'textContent', cal ? `${cal.label()} · ${sim.env.clock()}` : sim.env.clock());
      const special = sim.env.special();
      set(this.el.weather, 'textContent', special ? `${icon} ${special}` : `${icon} ${sim.env.label()}`);
      set(this.el.env, 'title', special ? `${sim.env.label()} · ${special}` : sim.env.label());
    }
    // Commuter approval (the endless modes)
    const ap = sim.approval;
    const showAp = !!lvl.surges && !!ap;
    set(this.el.approvalBox, 'hidden', !showAp);
    if (showAp) {
      const v = Math.round(ap.value);
      set(this.el.approval, 'textContent', `${ap.mood} ${v}%`);
      set(this.el.approvalBox, 'className', `hud-block hud-approval ${v < 25 ? 'bad' : v < 50 ? 'meh' : 'ok'}`);
    }
    // Rush-hour surge: countdown while it is coming, intensity bar while it lasts.
    const sg = sim.surge;
    const showSurge = !!sg && sg.state !== 'calm';
    set(this.el.surge, 'hidden', !showSurge);
    if (showSurge) {
      const on = sg.state === 'surge';
      set(this.el.surge, 'className', `hud-block hud-surge ${on ? 'on' : 'soon'}`);
      set(this.el.surgeLbl, 'textContent', on ? `🚨 RUSH HOUR · WAVE ${sg.wave}` : `⏰ RUSH HOUR in`);
      set(this.el.surgeTime, 'textContent', formatTime(Math.max(0, sg.countdown)));
      this.el.surgeFill.style.width = `${Math.round((on ? sim.env.rushIntensity : 0) * 100)}%`;
    }
    const [txt, cls] = LEVEL_TEXT[m.level] || LEVEL_TEXT.NORMAL;
    set(this.el.status, 'textContent', txt);
    set(this.el.status, 'className', `hud-block hud-status ${cls}`);

    // Signal panels
    this._autoTimer = (this._autoTimer || 0) + 1;
    if (this._autoTimer % 4 === 0) {
      this.syncAuto();
      this._syncTabs();
    }
    for (const p of this.panelEls || []) {
      const mgr = sim.lights.manager(p.id);
      const d = mgr.describe();
      set(p.label, 'textContent', d.label);
      set(p.label, 'className', `phase-label ${d.state === 'GREEN' ? 'g' : d.state === 'YELLOW' || d.state === 'FLASH' ? 'y' : 'r'}`);
      set(p.count, 'textContent', d.state === 'GREEN' || d.state === 'FLASH' ? `${d.elapsed.toFixed(0)}s` : `${d.countdown.toFixed(1)}s → ${mgr.labelOf(d.pending)}`);
      p.flash.classList.toggle('active', mgr.flashing || mgr.nextGroup === FLASH_GROUP);
      p.label.parentElement.classList.toggle('paired', mgr.paired);
      for (const b of p.btns) {
        const group = b.dataset.group;
        const sig = mgr.signalForGroup(group);
        if (b.dataset.sig !== sig) b.dataset.sig = sig;
        b.classList.toggle('partner', mgr.partner === group || (mgr.paired && mgr.activeGroup === group));
        b.classList.toggle('pending', mgr.pendingGroup === group || (mgr.state !== 'GREEN' && mgr.nextGroup === group));
        b.classList.toggle('priority', mgr.priorityGroup === group && sig !== 'green');
      }
    }

    // Objectives
    const st = this.game.levels.objectiveStatus(lvl, sim, s.tracker);
    set(this.el.objectives, 'innerHTML', st.length
      ? st.map((o) => `<div class="obj ${o.pass ? 'pass' : ''}"><span>${o.label}</span><b>${o.value}</b><i style="width:${Math.round(Math.max(0, Math.min(1, o.progress)) * 100)}%"></i></div>`).join('')
      : sim.growth
        ? `<div class="obj"><span>${sim.growth.nextAt ? `Next district at ${sim.growth.nextAt} vehicles` : 'The whole city is open'}</span><b>${sim.stats.processed} through</b>${sim.growth.nextAt ? `<i style="width:${Math.round(Math.min(1, sim.stats.processed / sim.growth.nextAt) * 100)}%"></i>` : ''}</div>`
        : lvl.mode === 'endless' || lvl.mode === 'chill'
          ? `<div class="obj"><span>${lvl.mode === 'chill' ? 'Chill · no game over' : 'Survive and move traffic'}</span><b>${sim.stats.processed} through</b></div>`
          : '');

    // Metrics
    if (this.game.state.showMetrics) {
      const cong = Math.round(m.congestion * 100);
      const mgrs = [...sim.lights.managers.values()];
      const phases = mgrs.length > 2 ? `${mgrs.length} signals · ${[...sim.lights.managers.keys()].filter((id) => sim.autopilot.isAuto(id)).length} on AUTO` : mgrs.map((m) => m.describe().label).join(' · ');
      set(this.el.metrics, 'innerHTML', `
        <h4>Traffic</h4>
        <div class="row"><span>Level</span><b>${typeof lvl.id === 'number' ? lvl.id : lvl.name}</b></div>
        <div class="row"><span>Vehicles through</span><b>${m.processed}</b></div>
        <div class="row"><span>On the road</span><b>${m.vehicles}${m.pending ? ` <small>+${m.pending}</small>` : ''}</b></div>
        <div class="row"><span>Volume</span><b>${m.volume.toFixed(0)} <small>veh/min</small></b></div>
        <div class="row"><span>Avg wait</span><b>${m.avgWait.toFixed(1)}s</b></div>
        <div class="row"><span>Longest queue</span><b>${m.longestQueue}</b></div>
        <div class="row"><span>Blocked approaches</span><b class="${m.blockedApproaches ? 'bad' : ''}">${m.blockedApproaches}</b></div>
        <div class="row"><span>Horns</span><b>${m.horns} <small>(${m.hornRate}/10s)</small></b></div>
        ${sim.peds?.crossings.length ? `<div class="row"><span>Pedestrians across</span><b>${m.pedsCrossed}</b></div><div class="row"><span>Waiting to cross</span><b class="${m.pedMaxWait > 45 ? 'bad' : ''}">${m.pedsWaiting}${m.pedMaxWait > 1 ? ` <small>max ${m.pedMaxWait.toFixed(0)}s</small>` : ''}</b></div>` : ''}
        <div class="row"><span>Congestion</span><b class="${cong > 70 ? 'bad' : cong > 45 ? 'warnc' : ''}">${cong}%</b></div>
        <div class="bar"><i style="width:${cong}%;background:${cong > 70 ? '#ef4444' : cong > 45 ? '#f59e0b' : '#22c55e'}"></i></div>
        <div class="row small"><span>Phase</span><b>${phases}</b></div>
        <div class="row small"><span>Safety rating</span><b>${Math.round(sim.scoring.safety)}%</b></div>`);
    }

    // Emergency banner
    const pr = sim.priority;
    if (pr.length) {
      const p = pr[0];
      const multi = sim.lights.managers.size > 1;
      const mgr = sim.lights.manager(p.intersectionId);
      const ok = mgr.signalForGroup(p.group) === 'green';
      this.el.emergency.hidden = false;
      set(this.el.emergency, 'className', `hud-emergency ${ok ? 'ok' : ''}`);
      const I = sim.network.byId.get(p.intersectionId);
      set(this.el.emergency, 'innerHTML', `<b>${p.label.toUpperCase()}</b> on ${sim.network.armName(I, p.arm)} ${ok ? 'has a green light' : `will run the red · give <b>${mgr.labelOf(p.group)}</b> green to clear the way`}${multi ? ` at ${p.intersectionId}` : ''} · ${Math.max(0, p.dist).toFixed(0)} m`);
    } else {
      this.el.emergency.hidden = true;
    }
  }

  // ------------------------------------------------------------------ live feed frame
  /** Sim time of day as HH:MM (or the full CCTV timestamp: date and HH:MM:SS). */
  _stamp(withDate = true) {
    const sim = this.session?.sim;
    if (!sim) return '';
    const secs = this.session.level.env ? sim.env.hour * 3600 : 7 * 3600 + sim.time;
    const t = Math.floor(secs) % 86400;
    const p = (n) => String(n).padStart(2, '0');
    const hms = `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
    if (!withDate) return hms.slice(0, 5);
    const d = new Date();
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${hms}`;
  }

  /** CCTV overlay: the camera named after the junction in view, and a running timestamp. */
  _live(sim) {
    const cam = this.game.camera;
    let best = null;
    let bestD = Infinity;
    for (const I of sim.network.intersections) {
      if (I.kind !== 'signal' && I.kind !== 'yield') continue;
      const d = Math.hypot(I.x - cam.centerX, I.y - cam.centerY);
      if (d < bestD) {
        bestD = d;
        best = I;
      }
    }
    if (best) {
      const n = sim.network.intersections.indexOf(best) + 1;
      const label = `CAM ${String(n).padStart(2, '0')} · ${this._junctionName(sim, best.id).toUpperCase() || best.id}`;
      if (this.el.cam.textContent !== label) this.el.cam.textContent = label;
    }
    set(this.el.ts, 'textContent', this._stamp(true));
  }

  // ------------------------------------------------------------------ street talk
  /**
   * News ticker along the bottom and a commuter "feed" post now and then, both written from what
   * is happening on the roads right now.
   */
  _street(sim) {
    const now = sim.time;
    if (this._tickT === undefined || now - this._tickT > 20 || this._tickSim !== sim) {
      this._tickT = now;
      this._tickSim = sim;
      this.el.ticker.textContent = this._news(sim).join('   •   ');
      this.el.ticker.style.animation = 'none';
      void this.el.ticker.offsetWidth;
      this.el.ticker.style.animation = '';
    }
    if (this._feedT === undefined || now - this._feedT > 14 || this._feedSim !== sim) {
      this._feedT = now;
      this._feedSim = sim;
      const post = this._post(sim);
      const f = this.el.feed;
      f.hidden = !post;
      if (post) {
        f.innerHTML = `<div class="fd-head"><b>${post.user}</b><span>· ngayon lang</span></div><div class="fd-body"></div><div class="fd-mood">Commuter mood ${post.mood}</div>`;
        f.querySelector('.fd-body').textContent = post.text;
        f.classList.remove('show');
        void f.offsetWidth;
        f.classList.add('show');
      }
    }
  }

  /** Roads ranked by queue: [{ name, queue, wait }]. */
  _roads(sim) {
    const out = [];
    for (const p of sim.metrics.perIntersection || []) {
      const I = sim.network.byId.get(p.id);
      if (I.kind === 'uturn' || I.kind === 'toll') continue;
      for (const a of p.approaches) out.push({ name: sim.network.roadName(I, a.arm) || 'the main road', queue: a.queue, wait: a.headWait });
    }
    return out.sort((a, b) => b.queue - a.queue);
  }

  _news(sim) {
    const roads = this._roads(sim);
    const items = [];
    const worst = roads[0];
    const best = roads.filter((r) => r.queue <= 2).pop();
    if (worst && worst.queue > 8) items.push(`MABIGAT ang daloy sa ${worst.name.toUpperCase()} (${worst.queue} sasakyan sa pila)`);
    else if (worst) items.push(`MALUWAG pa sa ${worst.name.toUpperCase()}`);
    if (best && best !== worst) items.push(`Maluwag sa ${best.name}`);
    const env = sim.env;
    if (env.rain > 0.5) items.push('Malakas na ulan: mag-ingat, madulas ang kalsada');
    else if (env.rain > 0.1) items.push('Umuulan sa Metro: bagalan ang takbo');
    if (env.darkness > 0.5) items.push('Gabi na: buksan ang headlights');
    if (sim.priority.length) items.push(`EMERGENCY: ${sim.priority[0].label} papunta sa ${sim.priority[0].intersectionId}, tumabi muna`);
    const blk = sim.blockages.find((b) => b.active && b.kind !== 'ped' && b.kind !== 'laneEnd');
    if (blk) items.push(`${blk.label || 'Sagabal'} sa ${sim.exitName(blk.exit)}`);
    items.push(`${sim.stats.processed} sasakyan na ang nakadaan`);
    if (sim.passengers?.delivered) items.push(`${sim.passengers.delivered} pasahero ang naihatid`);
    items.push(sim.env.clock());
    if (sim.level.surges) items.unshift(djLine(sim));
    return items;
  }

  _post(sim) {
    const roads = this._roads(sim);
    if (!roads.length) return null;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const users = ['@commuter_juan', '@titamaria', '@jeepney.driver', '@student_ust', '@grabkuya', '@callcenter.ate', '@riderph', '@lolo_ben'];
    const avg = sim.metrics.avgWait;
    const mood = sim.level.surges && sim.approval ? `${sim.approval.mood} ${Math.round(sim.approval.value)}%` : avg < 15 ? '😊' : avg < 30 ? '😐' : avg < 50 ? '😤' : '🤬';
    const r = roads[0];
    let text;
    if (sim.metrics.level === 'GRIDLOCK') text = pick([`GRIDLOCK na naman! Di na gumagalaw dito 😭`, `Sino nag-block ng box?! Wala nang makadaan 🙄`]);
    else if (r.queue > 10) text = pick([`Grabe ${Math.max(5, Math.round(r.wait / 60) + 5)} mins na ako dito sa ${r.name} 😤`, `Ang haba ng pila sa ${r.name}, lalakarin ko na lang 🚶`, `${r.name} parking lot na naman 🙃`]);
    else if (avg < 15) text = pick([`Ang luwag ngayon sa ${r.name}! 👏 Galing ng nag-aayos ng ilaw`, `Wow, green wave! Walang hinto 🚀`, `Ang bilis ng biyahe today, salamat MMDA 🙏`]);
    else text = pick([`Usad-pagong sa ${r.name} pero okay lang 🐢`, `Sana mabilis yung green sa ${r.name} 🙏`, `Traffic as usual, sounds trip muna 🎧`]);
    const tag = sim.approval?.trending[0];
    return { user: pick(users), text: tag && sim.level.surges ? `${text} ${tag}` : text, mood };
  }

  /** A big moment went viral: show it in the feed right away. */
  viral(e) {
    const sim = this.session?.sim;
    if (!sim) return;
    const users = ['@balitang_kalsada', '@metro.updates', '@commuter_juan', '@titamaria', '@riderph'];
    const f = this.el.feed;
    this._feedT = sim.time; // the regular post waits its turn
    f.hidden = false;
    f.innerHTML = `<div class="fd-head"><b>${users[Math.floor(Math.random() * users.length)]}</b><span>· 🔥 VIRAL</span></div><div class="fd-body"></div><div class="fd-mood">Trending ${e.tag} · Approval ${sim.approval.mood} ${Math.round(sim.approval.value)}%</div>`;
    f.querySelector('.fd-body').textContent = e.text;
    f.classList.toggle('viral-good', !!e.good);
    f.classList.toggle('viral-bad', !e.good);
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
    // the DJ talks about it at once
    this._tickT = undefined;
  }

  // ------------------------------------------------------------------ tutorial coach
  startTutorial() {
    this.tutorialStep = 0;
    this.renderCoach();
  }

  renderCoach() {
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) {
      this.el.coach.hidden = true;
      this.game.onTutorialDone();
      return;
    }
    this.el.coach.hidden = false;
    const last = this.tutorialStep === TUTORIAL_STEPS.length - 1;
    this.el.coach.innerHTML = `
      <div class="coach-step">${this.tutorialStep + 1} / ${TUTORIAL_STEPS.length}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="coach-actions">
        <button class="btn ghost" data-coach="skip">Skip</button>
        <button class="btn primary" data-coach="next">${last ? "Let's go!" : 'Next'}</button>
      </div>`;
  }

  nextTutorial(skip) {
    this.tutorialStep = skip ? TUTORIAL_STEPS.length : this.tutorialStep + 1;
    this.renderCoach();
  }
}
