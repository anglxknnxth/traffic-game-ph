// In-game heads-up display: score/time, signal controls, metrics, objectives, notifications,
// emergency banner, playback controls and the tutorial coach.

import { formatTime } from '../utils/math.js';
import { MODE_LABEL } from '../game/GameState.js';
import { CONGESTION } from '../simulation/GridlockDetector.js';
import { FLASH_GROUP } from '../simulation/TrafficPhaseManager.js';
import { Monitor } from './Monitor.js';

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
};

const LEVEL_TEXT = {
  [CONGESTION.NORMAL]: ['Flowing', 'ok'],
  [CONGESTION.HEAVY]: ['Heavy traffic', 'warn'],
  [CONGESTION.PARTIAL]: ['Partly blocked', 'warn'],
  [CONGESTION.GRIDLOCK]: ['GRIDLOCK', 'danger'],
  [CONGESTION.RECOVERY]: ['Recovering', 'info'],
};

const TUTORIAL_STEPS = [
  { title: 'Welcome, traffic controller!', body: 'This is a busy kanto in Metro Manila, seen from directly above. Cars arrive from all four roads and you control the traffic lights.' },
  { title: 'One road at a time', body: 'Every approach has its own green. Tap a road\'s button below, tap its traffic light, or tap the yellow box in the middle to go to the next road. The change takes 2 seconds. Tap the <b>opposite</b> road while one is green and both go together, straight and right only (no left turn); tap a cross road and both turn red. <b>⚠ Flash</b> (or Y) turns every light to flashing yellow: drivers stop, then go when it is clear.' },
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
      <div class="hud-top">
        <div class="hud-block hud-level"><span class="hud-mode"></span><span class="hud-name"></span></div>
        <div class="hud-block hud-time"><span class="lbl">Time</span><b data-k="time">0:00</b></div>
        <div class="hud-block hud-env" hidden><span class="lbl" data-k="clock"></span><b data-k="weather"></b></div>
        <div class="hud-block hud-status" data-k="status"></div>
        <div class="hud-block hud-score"><span class="lbl">Score</span><b data-k="score">0</b></div>
        <div class="hud-actions">
          <button class="icon-btn" data-act="pause" title="Pause (Space)">${ICONS.pause}</button>
          <button class="icon-btn" data-act="menu" title="Menu (Esc)">${ICONS.menu}</button>
        </div>
      </div>
      <div class="hud-objectives"></div>
      <aside class="hud-metrics"></aside>
      <aside class="hud-monitor" hidden></aside>
      <div class="hud-notify" aria-live="polite"></div>
      <div class="hud-emergency" hidden></div>
      <div class="hud-bottom">
        <div class="signal-panels"></div>
        <div class="hud-controls">
          <button class="icon-btn" data-act="restart" title="Restart (R)">${ICONS.restart}</button>
          <div class="seg" role="group" aria-label="Simulation speed">
            <button data-speed="1">1x</button><button data-speed="2">2x</button><button data-speed="3">3x</button><button data-speed="4">4x</button>
          </div>
          <button class="icon-btn" data-act="mute" title="Mute (M)">${ICONS.sound}</button>
          <input class="vol" type="range" min="0" max="100" step="1" data-act="volume" aria-label="Sound effects volume" />
          <button class="icon-btn music-btn" data-act="music" title="Background music on/off">♫</button>
          <button class="icon-btn" data-act="zoomout" title="Zoom out (-)">${ICONS.zoomOut}</button>
          <button class="icon-btn" data-act="zoomin" title="Zoom in (+)">${ICONS.zoomIn}</button>
          <button class="icon-btn" data-act="metrics" title="Toggle metrics">${ICONS.stats}</button>
          <button class="icon-btn mon-btn" data-act="monitor" title="Monitor: queues, throughput, green timeline (T)">📡</button>
          <button class="icon-btn heat-btn" data-act="heat" title="Speed heatmap and queue counts on the map (O)">🌡️</button>
          <button class="icon-btn watch-btn" data-act="watch" title="Watch mode: hide the controls and let the camera find the action (H)">👁</button>
          <button class="icon-btn auto-all" data-act="autoall" title="AUTO LAHAT: every light runs itself (click a light to take it over)" hidden>AUTO</button>
        </div>
      </div>
      <div class="hud-toast"></div>
      <div class="hud-coach" hidden></div>
    `;
    this.el = {
      mode: root.querySelector('.hud-mode'),
      name: root.querySelector('.hud-name'),
      time: root.querySelector('[data-k="time"]'),
      env: root.querySelector('.hud-env'),
      clock: root.querySelector('[data-k="clock"]'),
      weather: root.querySelector('[data-k="weather"]'),
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
      top: root.querySelector('.hud-top'),
      autoAll: root.querySelector('[data-act="autoall"]'),
      monitor: root.querySelector('.hud-monitor'),
      monBtn: root.querySelector('[data-act="monitor"]'),
      heatBtn: root.querySelector('[data-act="heat"]'),
    };
    this.monitor = new Monitor(this.el.monitor);
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
          <div class="phase"><b class="phase-label"></b><span class="phase-count"></span><button class="flash-btn" data-flash="${id}" title="Flashing yellow: every road stops, then goes when clear (Y)">⚠ Flash</button></div>
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
    this.root.classList.toggle('watch', !!g.state.watch);
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
    switch (act) {
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

  /** Space taken by HUD bars, so the camera keeps the intersection clear of them. */
  insets() {
    if (this.root.hidden) return { top: 0, bottom: 0, left: 0, right: 0 };
    const top = this.el.top.getBoundingClientRect().bottom + 6;
    const bottom = window.innerHeight - this.el.bottom.getBoundingClientRect().top + 6;
    const wide = window.innerWidth > 980 && this.game.state.showMetrics;
    const mon = window.innerWidth > 980 && this.game.state.showMonitor;
    return { top, bottom, left: wide ? 236 : 0, right: mon ? 262 : 0 };
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
    const div = document.createElement('div');
    div.className = `note ${e.severity || 'info'}`;
    div.textContent = e.text;
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
    this.monitor.sample(sim, Math.max(0, sim.time - this._simT));
    this._simT = sim.time;
    if (this.game.state.showMonitor) this.monitor.render(sim);
    this.el.time.textContent = lvl.duration ? formatTime(Math.max(0, lvl.duration - s.elapsed)) : formatTime(s.elapsed);
    this.el.score.textContent = sim.scoring.total().toLocaleString();
    // Clock and weather (levels with an environment only)
    this.el.env.hidden = !lvl.env;
    if (lvl.env) {
      const icon = sim.env.weather === 'clear' ? (sim.env.darkness > 0.5 ? '🌙' : '☀️') : sim.env.weather === 'rain' ? '🌧️' : '⛈️';
      this.el.clock.textContent = sim.env.clock();
      this.el.weather.textContent = `${icon} ${sim.env.label()}`;
    }
    const [txt, cls] = LEVEL_TEXT[m.level] || LEVEL_TEXT.NORMAL;
    this.el.status.textContent = txt;
    this.el.status.className = `hud-block hud-status ${cls}`;

    // Signal panels
    this._autoTimer = (this._autoTimer || 0) + 1;
    if (this._autoTimer % 4 === 0) {
      this.syncAuto();
      this._syncTabs();
    }
    for (const p of this.panelEls || []) {
      const mgr = sim.lights.manager(p.id);
      const d = mgr.describe();
      p.label.textContent = d.label;
      p.label.className = `phase-label ${d.state === 'GREEN' ? 'g' : d.state === 'YELLOW' || d.state === 'FLASH' ? 'y' : 'r'}`;
      p.count.textContent = d.state === 'GREEN' || d.state === 'FLASH' ? `${d.elapsed.toFixed(0)}s` : `${d.countdown.toFixed(1)}s → ${mgr.labelOf(d.pending)}`;
      p.flash.classList.toggle('active', mgr.flashing || mgr.nextGroup === FLASH_GROUP);
      p.label.parentElement.classList.toggle('paired', mgr.paired);
      for (const b of p.btns) {
        const group = b.dataset.group;
        const sig = mgr.signalForGroup(group);
        b.dataset.sig = sig;
        b.classList.toggle('partner', mgr.partner === group || (mgr.paired && mgr.activeGroup === group));
        b.classList.toggle('pending', mgr.pendingGroup === group || (mgr.state !== 'GREEN' && mgr.nextGroup === group));
        b.classList.toggle('priority', mgr.priorityGroup === group && sig !== 'green');
      }
    }

    // Objectives
    const st = this.game.levels.objectiveStatus(lvl, sim, s.tracker);
    this.el.objectives.innerHTML = st.length
      ? st.map((o) => `<div class="obj ${o.pass ? 'pass' : ''}"><span>${o.label}</span><b>${o.value}</b><i style="width:${Math.round(Math.max(0, Math.min(1, o.progress)) * 100)}%"></i></div>`).join('')
      : sim.growth
        ? `<div class="obj"><span>${sim.growth.nextAt ? `Next district at ${sim.growth.nextAt} vehicles` : 'The whole city is open'}</span><b>${sim.stats.processed} through</b>${sim.growth.nextAt ? `<i style="width:${Math.round(Math.min(1, sim.stats.processed / sim.growth.nextAt) * 100)}%"></i>` : ''}</div>`
        : lvl.mode === 'endless' || lvl.mode === 'chill'
          ? `<div class="obj"><span>${lvl.mode === 'chill' ? 'Chill · no game over' : 'Survive and move traffic'}</span><b>${sim.stats.processed} through</b></div>`
          : '';

    // Metrics
    if (this.game.state.showMetrics) {
      const cong = Math.round(m.congestion * 100);
      const mgrs = [...sim.lights.managers.values()];
      const phases = mgrs.length > 2 ? `${mgrs.length} signals · ${[...sim.lights.managers.keys()].filter((id) => sim.autopilot.isAuto(id)).length} on AUTO` : mgrs.map((m) => m.describe().label).join(' · ');
      this.el.metrics.innerHTML = `
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
        <div class="row small"><span>Safety rating</span><b>${Math.round(sim.scoring.safety)}%</b></div>`;
    }

    // Emergency banner
    const pr = sim.priority;
    if (pr.length) {
      const p = pr[0];
      const multi = sim.lights.managers.size > 1;
      const mgr = sim.lights.manager(p.intersectionId);
      const ok = mgr.signalForGroup(p.group) === 'green';
      this.el.emergency.hidden = false;
      this.el.emergency.className = `hud-emergency ${ok ? 'ok' : ''}`;
      const I = sim.network.byId.get(p.intersectionId);
      this.el.emergency.innerHTML = `<b>${p.label.toUpperCase()}</b> on ${sim.network.armName(I, p.arm)} ${ok ? 'has a green light' : `will run the red · give <b>${mgr.labelOf(p.group)}</b> green to clear the way`}${multi ? ` at ${p.intersectionId}` : ''} · ${Math.max(0, p.dist).toFixed(0)} m`;
    } else {
      this.el.emergency.hidden = true;
    }
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
