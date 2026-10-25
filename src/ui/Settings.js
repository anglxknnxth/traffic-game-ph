// Settings screen markup and handlers.

export function settingsMarkup(save, confirmReset = false) {
  const s = save.settings;
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
      <label class="field check"><input type="checkbox" ${s.showMetrics ? 'checked' : ''} data-set="showMetrics" /><span>Show traffic metrics panel</span></label>
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
      el.addEventListener('input', () => (key === 'music' ? game.setMusicVolume(el.value / 100) : game.setVolume(el.value / 100)));
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', () => {
        if (key === 'muted') game.setMuted(el.checked);
        if (key === 'musicOn') game.setMusicOn(el.checked);
        if (key === 'showMetrics') game.setShowMetrics(el.checked);
        if (key === 'debug') game.setDebug(el.checked);
      });
    } else {
      el.addEventListener('click', () => {
        if (key === 'speed') {
          game.setDefaultSpeed(Number(el.dataset.value));
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
