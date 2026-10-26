// Headless simulation benchmark: ms per fixed step on the heaviest scenarios.
// Usage: node scripts/bench.mjs [seconds=120]   (add --cpu-prof before the script for a profile)

import { LevelManager } from '../src/game/LevelManager.js';
import { SIM_DT } from '../src/data/config.js';

const seconds = Number(process.argv.find((a) => /^\d+$/.test(a))) || 120;
// --prefetch: build footprints between steps, as the game does once per frame
const prefetch = process.argv.includes('--prefetch');
const lm = new LevelManager();
const cases = [
  ['endless · single', lm.get('endless', 'single')],
  ['endless · metro', lm.get('endless', 'metro')],
  ['chill · metro', lm.get('chill', 'metro')],
  ...lm.endlessMaps()
    .filter((m) => m !== 'single' && m !== 'metro')
    .slice(0, 4)
    .map((m) => [`endless · ${m}`, lm.get('endless', m)]),
];

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
let total = 0;
for (const [name, level] of cases) {
  const t0 = performance.now();
  const sim = lm.createSim(level, 4242);
  const build = performance.now() - t0;
  const steps = Math.round(seconds / SIM_DT);
  const times = new Float64Array(steps);
  let maxVeh = 0;
  let pfMax = 0;
  for (let i = 0; i < steps; i++) {
    if (prefetch) {
      const p = performance.now();
      sim.prefetch();
      pfMax = Math.max(pfMax, performance.now() - p);
    }
    const a = performance.now();
    sim.step(SIM_DT);
    times[i] = performance.now() - a;
    if (sim.vehicles.length > maxVeh) maxVeh = sim.vehicles.length;
  }
  const sorted = Array.from(times).sort((x, y) => x - y);
  const sum = sorted.reduce((x, y) => x + y, 0);
  total += sum;
  console.log(
    `${name.padEnd(26)} build ${build.toFixed(0).padStart(5)}ms  avg ${(sum / steps).toFixed(3)}ms  p95 ${pct(sorted, 0.95).toFixed(3)}ms  p99 ${pct(sorted, 0.99).toFixed(3)}ms  max ${sorted[steps - 1].toFixed(1)}ms  veh ${maxVeh}  processed ${sim.stats.processed}${prefetch ? `  prefetch max ${pfMax.toFixed(1)}ms` : ''}`,
  );
}
console.log(`total sim time ${(total / 1000).toFixed(2)}s`);
