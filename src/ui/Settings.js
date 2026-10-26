// Settings screen markup and handlers.

// Chill max traffic slider, in percent; its last notch means no limit.
const CHILL_NO_LIMIT = 325;
const chillLabel = (pct) => (pct >= CHILL_NO_LIMIT ? 'Walang limit' : `${pct}%`);

export function settingsMarkup(save, confirmReset = false) {
  const s = save.settings;
  const chillPct = s.chillMaxTraffic ? Math.round(s.chillMaxTraffic * 100) : CHILL_NO_LIMIT;
  return `
    <div class="panel narrow">
      <h2>Settings</h2>
      <label class="field"><span>Sound effects</span><input type="range" min="0" max="100" value="${Math.round(s.volume * 100)}" data-set="volume" /></label>
      <label class="field"><span>Music</span><input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-set="music" /></label>
      <label class="field check"><input type="checkbox" ${s.musicOn ? 'checked' : ''} data-set="musicOn" /><span>Background music (chill lo-fi)</span></label>
      <label class="field check"><input type="checkbox" ${s.muted ? 'checked' : ''} data-set="muted" /><span>Mute all sound</span></label>
      <div class="field"><span>Default speed</span>
        <div class="seg">${[1, 2, 3].map((n) => `<button data-set="speed" data-value="${n}" class="${s.speed === n ? 'active' : ''}">${n}x</button>`).join('')}</div>
      </div>
      <div class="field"><span>Frame rate</span>
        <div class="seg">${[
          [0, 'Max'],
          [72, '72'],
          [60, '60'],
        ]
          .map(([n, l]) => `<button data-set="fpsCap" data-value="${n}" class="${(s.fpsCap || 0) === n ? 'active' : ''}">${l}</button>`)
          .join('')}</div>
      </div>
      <p class="muted small">144 Hz screen hitching? Try 72: every second frame, perfectly even.</p>
      <label class="field check"><input type="checkbox" ${s.showMetrics ? 'checked' : ''} data-set="showMetrics" /><span>Show traffic metrics panel</span></label>
      <label class="field check"><input type="checkbox" ${s.rain !== false ? 'checked' : ''} data-set="rain" /><span>🌧️ Ulan (rain showers)</span></label>
      <label class="field check"><input type="checkbox" ${s.people !== false ? 'checked' : ''} data-set="people" /><span>🚶 Mga tao (pedestrians)</span></label>
      <p class="muted small">Rain and people changes apply from the next game you start (or Restart).</p>
      <label class="field"><span>☕ Chill Endless · max traffic: <b data-out="chillMaxTraffic">${chillLabel(chillPct)}</b></span><input type="range" min="100" max="${CHILL_NO_LIMIT}" step="25" value="${chillPct}" data-set="chillMaxTraffic" /></label>
      <p class="muted small">Traffic in Chill still grows over time, but stops at this level (100% = starting traffic).</p>
      <label class="field check"><input type="checkbox" ${s.debug ? 'checked' : ''} data-set="debug" /><span>Show intersection reservations (debug)</span></label>
      <div class="field danger-zone">
        ${confirmReset ? '<span>Erase all progress and scores?</span><div class="row-btns"><button class="btn danger" data-set="reset-confirm">Yes, erase</button><button class="btn" data-set="reset-cancel">Cancel</button></div>' : '<button class="btn ghost" data-set="reset">Reset progress…</button>'}
      </div>
      <div class="actions"><button class="btn primary" data-nav="back">Done</button></div>
    </div>`;
}

export function bindSettings(root, game, rerender) {
  root.querySelectorAll('[data-set]').forEach((el) => {
    const key = el.dataset.set;
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (key === 'chillMaxTraffic') {
          game.setChillMaxTraffic(v >= CHILL_NO_LIMIT ? 0 : v / 100);
          root.querySelector('[data-out="chillMaxTraffic"]').textContent = chillLabel(v);
        } else if (key === 'music') game.setMusicVolume(v / 100);
        else game.setVolume(v / 100);
      });
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', () => {
        if (key === 'muted') game.setMuted(el.checked);
        if (key === 'musicOn') game.setMusicOn(el.checked);
        if (key === 'showMetrics') game.setShowMetrics(el.checked);
        if (key === 'debug') game.setDebug(el.checked);
        if (key === 'rain' || key === 'people') game.setWorldOption(key, el.checked);
      });
    } else {
      el.addEventListener('click', () => {
        if (key === 'speed') {
          game.setDefaultSpeed(Number(el.dataset.value));
          rerender(false);
        } else if (key === 'fpsCap') {
          game.setFpsCap(Number(el.dataset.value));
          rerender(false);
        } else if (key === 'reset') rerender(true);
        else if (key === 'reset-cancel') rerender(false);
        else if (key === 'reset-confirm') {
          game.resetProgress();
          rerender(false);
        }
      });
    }
  });
}
