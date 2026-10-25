// In-game heads-up display: score/time, signal controls, metrics, objectives, notifications,
// emergency banner, playback controls and the tutorial coach.

import { formatTime } from '../utils/math.js';
import { ARM_LABEL } from '../data/config.js';
import { MODE_LABEL } from '../game/GameState.js';
import { CONGESTION } from '../simulation/GridlockDetector.js';

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
  { title: 'Two signal groups', body: 'North–South and East–West take turns. Tap the <b>N–S</b> or <b>E–W</b> buttons below, tap a traffic light, or tap the yellow box in the middle to switch.' },
  { title: 'Safe transitions', body: 'You are in full control: a change starts the moment you tap, with a short <b>yellow</b> and <b>all-red</b> before the next green. Tap the current green during yellow to cancel.' },
  { title: 'Watch the box', body: 'Drivers wait if their exit road is full. Impatient ones may squeeze in anyway and block the yellow box. A red outline means a vehicle is stuck inside.' },
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
        <div class="hud-block hud-status" data-k="status"></div>
        <div class="hud-block hud-score"><span class="lbl">Score</span><b data-k="score">0</b></div>
        <div class="hud-actions">
          <button class="icon-btn" data-act="pause" title="Pause (Space)">${ICONS.pause}</button>
          <button class="icon-btn" data-act="menu" title="Menu (Esc)">${ICONS.menu}</button>
        </div>
      </div>
      <div class="hud-objectives"></div>
      <aside class="hud-metrics"></aside>
      <div class="hud-notify" aria-live="polite"></div>
      <div class="hud-emergency" hidden></div>
      <div class="hud-bottom">
        <div class="signal-panels"></div>
        <div class="hud-controls">
          <button class="icon-btn" data-act="restart" title="Restart (R)">${ICONS.restart}</button>
          <div class="seg" role="group" aria-label="Simulation speed">
            <button data-speed="1">1x</button><button data-speed="2">2x</button><button data-speed="3">3x</button>
          </div>
          <button class="icon-btn" data-act="mute" title="Mute (M)">${ICONS.sound}</button>
          <input class="vol" type="range" min="0" max="100" step="1" data-act="volume" aria-label="Volume" />
          <button class="icon-btn" data-act="zoomout" title="Zoom out (-)">${ICONS.zoomOut}</button>
          <button class="icon-btn" data-act="zoomin" title="Zoom in (+)">${ICONS.zoomIn}</button>
          <button class="icon-btn" data-act="metrics" title="Toggle metrics">${ICONS.stats}</button>
        </div>
      </div>
      <div class="hud-toast"></div>
      <div class="hud-coach" hidden></div>
    `;
    this.el = {
      mode: root.querySelector('.hud-mode'),
      name: root.querySelector('.hud-name'),
      time: root.querySelector('[data-k="time"]'),
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
      bottom: root.querySelector('.hud-bottom'),
      top: root.querySelector('.hud-top'),
    };
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
    const managers = [...sim.lights.managers];
    const multi = managers.length > 1;
    let key = 0;
    this.el.panels.classList.toggle('compact', managers.length > 2);
    this.el.panels.innerHTML = managers
      .map(([id, m]) => {
        const btn = (g) => {
          key++;
          return `<button class="sig-btn" data-int="${id}" data-group="${g}" title="Request ${m.labelOf(g)} green${key <= 9 ? ` (${key})` : ''}"><span class="lamp"></span><span class="sig-name">${m.labelOf(g)}</span></button>`;
        };
        const half = Math.ceil(m.groups.length / 2);
        const left = m.groups.slice(0, half).map(btn).join('');
        const right = m.groups.slice(half).map(btn).join('');
        return `
      <div class="sig-panel" data-int="${id}">
        ${multi ? `<div class="sig-title">Intersection ${id}</div>` : ''}
        <div class="sig-row">
          ${left}
          <div class="phase"><b class="phase-label"></b><span class="phase-count"></span></div>
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
    }));
  }

  syncControls() {
    const g = this.game;
    for (const b of this.root.querySelectorAll('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === g.state.speed);
    this.el.mute.innerHTML = g.audio.muted ? ICONS.mute : ICONS.sound;
    this.el.mute.classList.toggle('active', g.audio.muted);
    this.el.volume.value = Math.round(g.audio.volume * 100);
    this.el.pause.innerHTML = g.state.paused ? ICONS.play : ICONS.pause;
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
      case 'zoomin':
        g.camera.zoomAt(1.2);
        break;
      case 'zoomout':
        g.camera.zoomAt(1 / 1.2);
        break;
      case 'metrics':
        g.toggleMetrics();
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
    return { top, bottom, left: wide ? 236 : 0, right: 0 };
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
    this.el.time.textContent = lvl.duration ? formatTime(Math.max(0, lvl.duration - s.elapsed)) : formatTime(s.elapsed);
    this.el.score.textContent = sim.scoring.total().toLocaleString();
    const [txt, cls] = LEVEL_TEXT[m.level] || LEVEL_TEXT.NORMAL;
    this.el.status.textContent = txt;
    this.el.status.className = `hud-block hud-status ${cls}`;

    // Signal panels
    for (const p of this.panelEls || []) {
      const mgr = sim.lights.manager(p.id);
      const d = mgr.describe();
      p.label.textContent = d.label;
      p.label.className = `phase-label ${d.state === 'GREEN' ? 'g' : d.state === 'YELLOW' ? 'y' : 'r'}`;
      p.count.textContent = d.state === 'GREEN' ? `${d.elapsed.toFixed(0)}s` : `${d.countdown.toFixed(1)}s → ${mgr.labelOf(d.pending)}`;
      for (const b of p.btns) {
        const group = b.dataset.group;
        const sig = mgr.signalForGroup(group);
        b.dataset.sig = sig;
        b.classList.toggle('pending', mgr.pendingGroup === group || (mgr.state !== 'GREEN' && mgr.nextGroup === group));
        b.classList.toggle('priority', mgr.priorityGroup === group && sig !== 'green');
      }
    }

    // Objectives
    const st = this.game.levels.objectiveStatus(lvl, sim, s.tracker);
    this.el.objectives.innerHTML = st.length
      ? st.map((o) => `<div class="obj ${o.pass ? 'pass' : ''}"><span>${o.label}</span><b>${o.value}</b><i style="width:${Math.round(Math.max(0, Math.min(1, o.progress)) * 100)}%"></i></div>`).join('')
      : lvl.mode === 'endless'
        ? `<div class="obj"><span>Survive and move traffic</span><b>${sim.stats.processed} through</b></div>`
        : '';

    // Metrics
    if (this.game.state.showMetrics) {
      const cong = Math.round(m.congestion * 100);
      const phases = [...sim.lights.managers.values()].map((m) => m.describe().label).join(' · ');
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
      this.el.emergency.innerHTML = `<b>${p.label.toUpperCase()}</b> from the ${ARM_LABEL[p.arm]} ${ok ? 'has a green light' : `needs <b>${mgr.labelOf(p.group)}</b> green`}${multi ? ` at ${p.intersectionId}` : ''} · ${Math.max(0, p.dist).toFixed(0)} m`;
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
