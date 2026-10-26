// Overlay screens: main menu, level select, challenges, briefing, pause, settings, high scores, results.

import { settingsMarkup, bindSettings } from './Settings.js';
import { resultsMarkup } from './ResultsScreen.js';
import { formatTime } from '../utils/math.js';
import { mapForLevel, getMap } from '../data/maps/index.js';

// Dev server only: every career level is playable. Production builds keep normal progression.
const DEV_UNLOCK_ALL = import.meta.env.DEV;

const objectiveText = (o) => {
  switch (o.type) {
    case 'processed':
      return `Move at least <b>${o.target}</b> vehicles through`;
    case 'avgWait':
      return `Keep the average wait at or below <b>${o.target}s</b>`;
    case 'rollingWait':
      return `Never let the rolling average wait exceed <b>${o.target}s</b>`;
    case 'maxGridlockTime':
      return `Spend no more than <b>${o.target}s</b> in gridlock`;
    case 'emergency':
      return `Get every emergency vehicle through with at most <b>${o.target}s</b> delay`;
    case 'clearGridlock':
      return `Clear the box and keep traffic flowing for <b>${o.target}s</b>`;
    case 'pedCrossed':
      return `Help at least <b>${o.target}</b> pedestrians across`;
    case 'pedWait':
      return `Keep the average pedestrian wait at or below <b>${o.target}s</b>`;
    default:
      return '';
  }
};

export class Menu {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.current = null;
    this.prev = null;
    root.addEventListener('click', (e) => this.onClick(e));
  }

  hide() {
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.current = null;
  }

  _show(name, html, cls = '') {
    if (this.current && this.current !== name) this.prev = this.current;
    this.current = name;
    this.root.hidden = false;
    this.root.className = `overlay ${cls}`;
    this.root.innerHTML = html;
    const first = this.root.querySelector('.btn.primary, .btn');
    first?.focus({ preventScroll: true });
  }

  showMain() {
    const save = this.game.save;
    const cont = save.unlockedLevel;
    this._show(
      'main',
      `
      <div class="panel main-menu">
        <div class="logo">
          <div class="logo-lights"><i class="r"></i><i class="y"></i><i class="g"></i></div>
          <h1>Traffic Control<span>Philippines</span></h1>
          <p class="tagline">Bumusina, sumingit, ma-gridlock — and keep the kanto moving.</p>
        </div>
        <div class="menu-grid">
          <button class="btn primary big" data-nav="play" data-mode="career" data-id="${cont}">▶ Start Game <small>Level ${cont}</small></button>
          <button class="btn" data-nav="levels">Career Mode</button>
          <button class="btn pinoy" data-nav="pinoy">🇵🇭 Pinoy Roads</button>
          <button class="btn" data-nav="brief" data-mode="endless">Endless Mode</button>
          <button class="btn chill" data-nav="brief" data-mode="chill" data-id="single">☕ Chill Endless <small>walang game over</small></button>
          <button class="btn grow" data-nav="brief" data-mode="growing">🌆 Lumalaking Lungsod</button>
          <button class="btn" data-nav="challenges">Challenge Mode</button>
          <button class="btn" data-nav="levels">Level Selection</button>
          <button class="btn" data-nav="tutorial">Tutorial${save.tutorialDone ? ' ✔' : ''}</button>
          <button class="btn" data-nav="settings">Settings</button>
          <button class="btn" data-nav="scores">High Scores</button>
        </div>
        <p class="foot muted">Top-down traffic signal control · zero collisions, maximum honking</p>
      </div>`,
      'dim',
    );
  }

  showLevels() {
    const save = this.game.save;
    const cards = this.game.levels.career
      .map((l) => {
        const locked = !DEV_UNLOCK_ALL && l.id > save.unlockedLevel;
        const stars = save.bestStars[String(l.id)] || 0;
        const best = save.bestScores[String(l.id)];
        return `<button class="card ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-nav="brief" data-mode="career" data-id="${l.id}"`}>
          <span class="num">${l.id}</span>
          <span class="card-title">${l.name}</span>
          <span class="card-sub">${l.subtitle}</span>
          <span class="card-foot">${locked ? '🔒 Locked' : `<span class="stars-sm">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>${best ? ` · ${best.toLocaleString()}` : ''}`}</span>
        </button>`;
      })
      .join('');
    this._show('levels', `<div class="panel wide"><h2>Career · Select level</h2><div class="cards">${cards}</div><div class="actions"><button class="btn" data-nav="menu">Back</button></div></div>`, 'dim');
  }

  showPinoy() {
    const save = this.game.save;
    const cards = this.game.levels.pinoy
      .map((l, i) => {
        const locked = !DEV_UNLOCK_ALL && i + 1 > save.pinoyUnlocked;
        const stars = save.pinoyStars[l.id] || 0;
        const best = save.pinoyBest[l.id];
        const map = getMap(l.map);
        return `<button class="card ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-nav="brief" data-mode="pinoy" data-id="${l.id}"`}>
          <span class="num">${i + 1}</span>
          <span class="card-title">${l.name}</span>
          <span class="card-sub">📍 ${map.name}${map.region && map.region !== 'Training' ? ` · ${map.region}` : ''}</span>
          <span class="card-foot">${locked ? '🔒 Locked' : `<span class="stars-sm">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>${best ? ` · ${best.toLocaleString()}` : ''}`}</span>
        </button>`;
      })
      .join('');
    this._show(
      'pinoy',
      `<div class="panel wide"><h2>🇵🇭 Pinoy Roads</h2><p class="muted">Real-world inspired roads: EDSA, Commonwealth, Taft, España and the town plaza. Clear one to unlock the next.</p><div class="cards">${cards}</div><div class="actions"><button class="btn" data-nav="menu">Back</button></div></div>`,
      'dim',
    );
  }

  showChallenges() {
    const save = this.game.save;
    const cards = this.game.levels.challenges
      .map((c) => {
        const done = save.challengesCompleted.includes(c.id);
        const best = save.challengeBest[c.id];
        return `<button class="card ${done ? 'done' : ''}" data-nav="brief" data-mode="challenge" data-id="${c.id}">
          <span class="num">${c.id.toUpperCase()}</span>
          <span class="card-title">${c.name}</span>
          <span class="card-sub">${c.subtitle}</span>
          <span class="card-foot">${done ? '✔ Completed' : 'Not completed'}${best ? ` · ${best.toLocaleString()}` : ''}</span>
        </button>`;
      })
      .join('');
    this._show('challenges', `<div class="panel wide"><h2>Challenges</h2><div class="cards">${cards}</div><div class="actions"><button class="btn" data-nav="menu">Back</button></div></div>`, 'dim');
  }

  showBriefing(mode, id) {
    const lvl = this.game.levels.get(mode, id);
    const pinoyIdx = mode === 'pinoy' ? this.game.levels.pinoy.indexOf(lvl) : -1;
    const objectives = (lvl.objectives || []).map((o) => `<li>${objectiveText(o)}</li>`).join('');
    const extra = [];
    if (lvl.duration) extra.push(`Duration ${formatTime(lvl.duration)}`);
    const map = mapForLevel(lvl);
    if (map.region !== 'Training') extra.push(`📍 ${map.name}`);
    const signals = map.nodes.filter((n) => (n.kind || 'signal') === 'signal').length;
    if (signals > 1) extra.push(`${signals} connected signals`);
    if (map.nodes.some((n) => n.kind === 'uturn')) extra.push('U-turn slots');
    if (map.nodes.some((n) => n.kind === 'yield')) extra.push('Yield junctions');
    if (map.river) extra.push('🌊 River & bridge');
    if (Object.values(map.roads || {}).some((r) => r.types?.includes('bike'))) extra.push('🚲 Bike lanes');
    const heavy = ['truck', 'dumptruck', 'tanker'].reduce((n, t) => n + (lvl.mix?.[t] || 0), 0);
    if (heavy >= 0.1) extra.push('🚚 Trucks');
    if (lvl.cornerStops > 0 && ['jeepney', 'ejeep', 'multicab', 'tricycle'].some((t) => lvl.mix?.[t] > 0)) extra.push('🚏 Jeeps stop at corners');
    if (lvl.pedestrians?.cross) extra.push('🚶 Pedestrians');
    if (lvl.pedestrians?.jaywalk) extra.push('Pasaway jaywalkers');
    if (lvl.emergency) extra.push('Emergency vehicles');
    if (lvl.blockages?.length) extra.push('Blocked exits');
    if (lvl.env) {
      const wx = (lvl.env.weather || []).map((w) => w.type);
      if (wx.includes('heavyRain') || wx.includes('rain')) extra.push('🌧️ Rain');
      else if (lvl.env.random) extra.push('🌦️ Changing weather');
      const h = lvl.env.hour ?? 9;
      const end = h + ((lvl.env.rate || 0) * (lvl.duration || 600)) / 60;
      if (h >= 17.5 || h < 5.5) extra.push('🌙 Night');
      else if (end > 17.5) extra.push('🌆 Dusk to night');
    }
    const label =
      mode === 'career'
        ? `Level ${lvl.id}`
        : mode === 'challenge'
          ? `Challenge ${String(lvl.id).toUpperCase()}`
          : mode === 'pinoy'
            ? `Pinoy Roads · ${pinoyIdx + 1}`
            : mode === 'chill'
              ? 'Chill Endless · no game over'
              : mode === 'growing'
                ? 'Lumalaking Lungsod'
                : 'Endless';
    // Endless can be played on any map
    const picked = mode === 'chill' ? id || 'single' : lvl.map || 'single';
    const mapPick =
      mode === 'endless' || mode === 'chill'
        ? `<h4>Map</h4><div class="chips map-pick">${this.game.levels
            .endlessMaps()
            .map((m) => `<button class="chip ${m === picked ? 'active' : ''}" data-nav="brief" data-mode="${mode}" data-id="${m}">${getMap(m).name}</button>`)
            .join('')}</div>`
        : '';
    if (lvl.allowAuto) extra.push('🤖 AUTO lights');
    if (lvl.fail === null && mode !== 'growing') extra.push('☕ No game over');
    if (lvl.randomEvents) extra.push('🎲 Random events');
    const blurb = map.blurb ? `<p class="muted">📍 <b>${map.name}</b> — ${map.blurb}</p>` : '';
    this._show(
      'brief',
      `
      <div class="panel narrow briefing">
        <div class="kicker">${label}</div>
        <h2>${lvl.name}</h2>
        <p class="sub">${lvl.subtitle}</p>
        <p>${lvl.description}</p>
        ${blurb}
        ${mapPick}
        ${objectives ? `<h4>Objectives</h4><ul class="obj-list">${objectives}</ul>` : ''}
        ${lvl.mode === 'endless' ? '<p class="muted">The run ends when congestion stays critical for 30 seconds. Score as much as you can.</p>' : ''}
        ${lvl.mode === 'chill' ? '<p class="muted">No game over: play as long as you like, gridlock and all. Press <b>H</b> to hide the HUD and watch.</p>' : ''}
        <div class="chips">${extra.map((x) => `<span class="chip">${x}</span>`).join('')}</div>
        <div class="tip"><b>Tip:</b> ${lvl.tip}</div>
        <div class="actions">
          <button class="btn" data-nav="${mode === 'challenge' ? 'challenges' : mode === 'career' ? 'levels' : mode === 'pinoy' ? 'pinoy' : 'menu'}">Back</button>
          <button class="btn primary" data-nav="play" data-mode="${mode}" data-id="${mode === 'endless' ? lvl.map || 'single' : mode === 'chill' ? picked : lvl.id}">Start ▸</button>
        </div>
      </div>`,
      'dim',
    );
  }

  showPause() {
    const s = this.game.session;
    this._show(
      'pause',
      `
      <div class="panel narrow">
        <h2>Paused</h2>
        <p class="muted">${s ? s.level.name : ''}</p>
        <div class="menu-col">
          <button class="btn primary" data-nav="resume">Resume</button>
          <button class="btn" data-nav="restart">Restart level</button>
          <button class="btn" data-nav="settings">Settings</button>
          <button class="btn" data-nav="quit">Quit to main menu</button>
        </div>
        <p class="muted small">Keys: 1–4 green a road (arrows too) · Y flashing yellow · Space pause · F speed · M mute · R restart · +/− zoom</p>
      </div>`,
      'dim',
    );
  }

  showSettings(confirmReset = false) {
    const back = this.current === 'settings' ? this.prev : this.current;
    this._show('settings', settingsMarkup(this.game.save, confirmReset), 'dim');
    this.prev = back;
    bindSettings(this.root, this.game, (c) => this.showSettings(c));
  }

  showScores() {
    const save = this.game.save;
    const rows = this.game.levels.career
      .map((l) => {
        const best = save.bestScores[String(l.id)];
        const stars = save.bestStars[String(l.id)] || 0;
        return `<tr><td>${l.id}. ${l.name}</td><td>${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</td><td>${best ? best.toLocaleString() : '—'}</td></tr>`;
      })
      .join('');
    const ch = this.game.levels.challenges
      .map((c) => `<tr><td>${c.id.toUpperCase()}. ${c.name}</td><td>${save.challengesCompleted.includes(c.id) ? '✔' : ''}</td><td>${save.challengeBest[c.id] ? save.challengeBest[c.id].toLocaleString() : '—'}</td></tr>`)
      .join('');
    const pinoy = this.game.levels.pinoy
      .map((l, i) => {
        const stars = save.pinoyStars[l.id] || 0;
        const best = save.pinoyBest[l.id];
        return `<tr><td>${i + 1}. ${l.name}</td><td>${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</td><td>${best ? best.toLocaleString() : '—'}</td></tr>`;
      })
      .join('');
    const endless = Object.entries(save.endlessBestByMap)
      .filter(([m]) => this.game.levels.endlessMaps().includes(m))
      .map(([m, v]) => `<tr><td>${getMap(m).name}</td><td></td><td>${v.toLocaleString()}</td></tr>`)
      .join('');
    this._show(
      'scores',
      `
      <div class="panel">
        <h2>High Scores</h2>
        <table class="scores"><thead><tr><th>Career</th><th>Stars</th><th>Best</th></tr></thead><tbody>${rows}</tbody></table>
        <table class="scores"><thead><tr><th>Challenges</th><th>Done</th><th>Best</th></tr></thead><tbody>${ch}</tbody></table>
        <table class="scores"><thead><tr><th>Pinoy Roads</th><th>Stars</th><th>Best</th></tr></thead><tbody>${pinoy}</tbody></table>
        <table class="scores"><thead><tr><th>Endless Rush</th><th></th><th>Best</th></tr></thead><tbody><tr><td>Kanto</td><td>${save.endlessBestTime ? formatTime(save.endlessBestTime) : ''}</td><td>${save.endlessBest ? save.endlessBest.toLocaleString() : '—'}</td></tr>${endless}</tbody></table>
        <div class="actions"><button class="btn" data-nav="menu">Back</button></div>
      </div>`,
      'dim',
    );
  }

  showResults(result) {
    this.lastResult = result;
    this._show('results', resultsMarkup(result), 'dim');
  }

  onClick(e) {
    const el = e.target.closest('[data-nav]');
    if (!el || el.disabled) return;
    const g = this.game;
    g.audio.unlock();
    g.audio.click();
    const nav = el.dataset.nav;
    switch (nav) {
      case 'menu':
        if (g.session) g.quitToMenu();
        else this.showMain();
        break;
      case 'levels':
        this.showLevels();
        break;
      case 'challenges':
        this.showChallenges();
        break;
      case 'pinoy':
        this.showPinoy();
        break;
      case 'scores':
        this.showScores();
        break;
      case 'settings':
        this.showSettings(false);
        break;
      case 'tutorial':
        g.startSession('tutorial', 1);
        break;
      case 'brief':
        this.showBriefing(el.dataset.mode, el.dataset.id);
        break;
      case 'play':
        g.startSession(el.dataset.mode, el.dataset.id);
        break;
      case 'resume':
        g.pause(false);
        break;
      case 'restart':
      case 'retry':
        g.restart();
        break;
      case 'quit':
        g.quitToMenu();
        break;
      case 'next':
        if (this.lastResult?.nextLevel) this.showBriefing(this.lastResult.nextMode || 'career', this.lastResult.nextLevel);
        break;
      case 'back':
        if (this.prev === 'pause') this.showPause();
        else this.showMain();
        break;
      default:
        break;
    }
  }
}
