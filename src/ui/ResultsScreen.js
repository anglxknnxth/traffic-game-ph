// End-of-session summary markup.

import { formatTime } from '../utils/math.js';

const star = (on) => `<span class="star ${on ? 'on' : ''}">★</span>`;

export function resultsMarkup(r) {
  const title = r.mode === 'endless' ? 'Run complete' : r.success ? 'Level cleared!' : 'Level failed';
  const sub = r.reason;
  const stars = r.mode === 'endless' ? '' : `<div class="stars">${star(r.stars >= 1)}${star(r.stars >= 2)}${star(r.stars >= 3)}</div>`;
  const objectives = r.objectives.length
    ? `<ul class="res-obj">${r.objectives.map((o) => `<li class="${o.pass ? 'pass' : 'fail'}"><span>${o.pass ? '✔' : '✖'} ${o.label}</span><b>${o.value}</b></li>`).join('')}</ul>`
    : '';
  const breakdown = `<table class="breakdown">${r.breakdown.map((b) => `<tr><td>${b.label}</td><td>${typeof b.value === 'number' && b.value > 0 ? '+' : ''}${b.value}</td></tr>`).join('')}</table>`;
  const best = r.newBest ? '<div class="badge">New best!</div>' : r.best ? `<div class="muted">Best: ${r.best.toLocaleString()}</div>` : '';
  const next = r.nextLevel ? `<button class="btn primary" data-nav="next">Next level ▸</button>` : '';
  return `
    <div class="panel results ${r.success ? 'win' : 'lose'}">
      <div class="kicker">${r.levelLabel}</div>
      <h2>${title}</h2>
      <p class="muted">${sub}</p>
      ${stars}
      <div class="big-score">${r.score.toLocaleString()}</div>
      ${best}
      <div class="res-stats">
        <div><span>Vehicles</span><b>${r.processed}</b></div>
        <div><span>Avg wait</span><b>${r.avgWait.toFixed(1)}s</b></div>
        <div><span>Time</span><b>${formatTime(r.elapsed)}</b></div>
        <div><span>Horns</span><b>${r.horns}</b></div>
        <div><span>Collisions</span><b>0</b></div>
      </div>
      ${objectives}
      <details><summary>Score breakdown</summary>${breakdown}</details>
      <div class="actions">
        <button class="btn" data-nav="menu">Main menu</button>
        <button class="btn" data-nav="retry">Retry</button>
        ${next}
      </div>
    </div>`;
}
