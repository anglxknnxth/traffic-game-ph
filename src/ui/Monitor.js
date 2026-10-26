// Monitoring panel ("MMDA Metrobase"): queue bars per road, a throughput sparkline, a timeline of
// which road had the green at each signal, pedestrians waiting, emergency ETAs and live event
// counters. History is sampled from the simulation here, on the UI side.

const SPARK_EVERY = 5; // s between throughput samples
const SPARK_N = 36; // 3 minutes of samples
const TL_SPAN = 120; // s of phase history shown
const TL_EVERY = 1; // s between phase samples
const HUES = ['#22c55e', '#38bdf8', '#f59e0b', '#e879f9', '#f87171', '#a3e635'];

export class Monitor {
  constructor(root) {
    this.root = root;
    this.reset();
  }

  reset() {
    this.spark = [];
    this.sparkT = 0;
    this.lastProcessed = null;
    this.timeline = new Map();
    this.tlT = 0;
  }

  /** Sample history (call with simulated seconds since the last call). */
  sample(sim, dt) {
    this.sparkT += dt;
    if (this.lastProcessed === null) this.lastProcessed = sim.stats.processed;
    if (this.sparkT >= SPARK_EVERY) {
      const n = sim.stats.processed - this.lastProcessed;
      this.lastProcessed = sim.stats.processed;
      this.spark.push((n / this.sparkT) * 60);
      if (this.spark.length > SPARK_N) this.spark.shift();
      this.sparkT = 0;
    }
    this.tlT += dt;
    if (this.tlT >= TL_EVERY) {
      this.tlT = 0;
      for (const [id, m] of sim.lights.managers) {
        let row = this.timeline.get(id);
        if (!row) this.timeline.set(id, (row = []));
        const greens = m.groups.filter((g) => m.signalForGroup(g) === 'green');
        row.push(m.flashing ? '*' : greens.join('+') || (m.state === 'YELLOW' ? '~' : '-'));
        if (row.length > TL_SPAN / TL_EVERY) row.shift();
      }
    }
  }

  render(sim) {
    const net = sim.network;
    const m = sim.metrics;
    const roads = [];
    for (const p of m.perIntersection || []) {
      const I = net.byId.get(p.id);
      for (const a of p.approaches) {
        if (I.kind === 'uturn') continue;
        roads.push({ id: p.id, label: net.armLabel(I, a.arm), queue: a.queue, signal: a.signal, wait: a.headWait, blocked: a.headBlocked });
      }
    }
    roads.sort((a, b) => b.queue - a.queue);
    const maxQ = Math.max(8, ...roads.map((r) => r.queue));
    const multi = sim.lights.managers.size > 1;
    const bars = roads
      .slice(0, 10)
      .map(
        (r) => `<div class="mon-q ${r.blocked ? 'bad' : ''}"><span class="mon-name"><i class="dot ${r.signal}"></i>${r.label}${multi ? ` <small>${r.id}</small>` : ''}</span><span class="mon-bar"><i style="width:${Math.round((100 * r.queue) / maxQ)}%"></i></span><b>${r.queue}</b></div>`,
      )
      .join('');
    // Throughput sparkline
    const w = 200;
    const h = 38;
    const top = Math.max(10, ...this.spark);
    const pts = this.spark.map((v, i) => `${((i / (SPARK_N - 1)) * w).toFixed(1)},${(h - (v / top) * (h - 4) - 2).toFixed(1)}`).join(' ');
    const now = this.spark.length ? this.spark[this.spark.length - 1] : 0;
    const spark = `<svg class="mon-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="2"/></svg>`;
    // Phase timeline per signal
    const tl = [...this.timeline]
      .map(([id, row]) => {
        const mgr = sim.lights.manager(id);
        const colour = (g) => {
          if (g === '-') return '#7f1d1d';
          if (g === '~') return '#a16207';
          if (g === '*') return '#facc15';
          const first = g.split('+')[0];
          return HUES[mgr.groups.indexOf(first) % HUES.length];
        };
        const cells = row.map((g) => `<i style="background:${colour(g)}${g.includes('+') ? ';box-shadow:inset 0 -3px 0 #fff8' : ''}"></i>`).join('');
        const legend = mgr.groups.map((g, k) => `<span><i style="background:${HUES[k % HUES.length]}"></i>${mgr.labelOf(g)}</span>`).join('');
        return `<div class="mon-tl"><div class="mon-tl-h">${multi ? `<b>${id}</b>` : ''}<div class="mon-legend">${legend}</div></div><div class="mon-tl-row">${cells}</div></div>`;
      })
      .join('');
    // Emergencies and events
    const em = sim.priority
      .map((p) => {
        const v = sim.vehicles.find((x) => x.id === p.vehicleId);
        const eta = v && v.v > 0.5 ? `${Math.round(p.dist / v.v)}s` : 'stopped';
        return `<div class="mon-row"><span>🚨 ${p.label} · ${net.armLabel(net.byId.get(p.intersectionId), p.arm)}</span><b>${Math.max(0, p.dist).toFixed(0)} m · ${eta}</b></div>`;
      })
      .join('');
    const st = sim.stats;
    this.root.innerHTML = `
      <div class="mon-head"><b>📡 MONITOR</b><span class="rec">● REC</span><span class="mon-clock">${sim.env.clock()}</span></div>
      <h5>Queues per road</h5>${bars || '<p class="muted">No queues</p>'}
      <h5>Throughput <small>${now.toFixed(0)} veh/min</small></h5>${spark}
      <h5>Green timeline <small>last ${TL_SPAN / 60} min</small></h5>${tl}
      <h5>Now</h5>
      <div class="mon-row"><span>🚶 Waiting to cross</span><b>${m.pedsWaiting ?? 0}${m.pedMaxWait > 1 ? ` · max ${m.pedMaxWait.toFixed(0)}s` : ''}</b></div>
      <div class="mon-row"><span>↪ Right turn on red</span><b>${st.rightOnRed || 0}</b></div>
      <div class="mon-row"><span>🚏 Corner stops</span><b>${st.cornerStops || 0}</b></div>
      <div class="mon-row"><span>👆 Waved through</span><b>${st.passes || 0}</b></div>
      <div class="mon-row"><span>⚠ Counterflow</span><b>${st.counterflows || 0}</b></div>
      <div class="mon-row"><span>🚨 HULI!</span><b>${st.caught || 0}</b></div>
      <div class="mon-row"><span>🔴 Beat the red</span><b>${st.redRuns || 0}</b></div>
      <div class="mon-row"><span>📣 Horns (10 s)</span><b>${m.hornRate}</b></div>
      ${em}`;
  }
}
