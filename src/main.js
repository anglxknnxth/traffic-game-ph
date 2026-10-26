import './styles.css';
import { Game } from './game/Game.js';

const root = document.getElementById('app');
const game = new Game(root);
game.start();

// Exposed for debugging in the browser console.
window.__tcp = game;

// Optional deep link for quick testing: ?play=career:7 | ?play=challenge:c1 | ?play=pinoy:taft | ?play=endless:edsa
const play = new URLSearchParams(location.search).get('play');
if (play) {
  const [mode, id] = play.split(':');
  if (['career', 'challenge', 'endless', 'tutorial', 'pinoy', 'chill', 'growing', 'daily'].includes(mode)) game.startSession(mode, id || (mode === 'pinoy' ? 'poblacion' : 1));
  // Dev server only: &ff=60 fast-forwards the simulation, &zoom=2&x=0&y=-80 frames the camera.
  if (import.meta.env.DEV && game.session) {
    const q = new URLSearchParams(location.search);
    // &enf=A stations an enforcer at A; &cone=A:N cones off a contraflow lane beside A's North road.
    const sim = game.session.sim;
    if (q.get('enf')) for (const id of q.get('enf').split(',')) sim.enforcement.toggle(id);
    // &marshal=B stations a traffic marshal at B (he takes over its lights).
    if (q.get('marshal')) for (const id of q.get('marshal').split(',')) sim.enforcement.toggleMarshal(id);
    if (q.get('cone')) {
      // &cone=A:S:40 starts the cones 40 m along the lane (default: 80 m before the junction)
      const [cid, arm, from] = q.get('cone').split(':');
      const lane = sim.network.byId.get(cid)?.approachLanes[arm]?.[0];
      if (lane) sim.counterflow.openZone(lane, from ? { from: Number(from) } : {});
    }
    if (q.get('enf') || q.get('cone')) {
      game.hud.buildPanels(sim);
      game.hud.syncControls();
    }
    const ff = Number(q.get('ff')) || 0;
    for (let i = 0; i < ff * 60; i++) game.update(1 / 60);
    if (q.get('zoom')) {
      game.camera.zoomAt(Number(q.get('zoom')));
      const c = game.camera;
      c.update(10); // finish the eased zoom right away
      c.update(10);
      if (q.get('x') !== null || q.get('y') !== null) c.panBy((c.centerX - Number(q.get('x') ?? c.centerX)) * c.scale, (c.centerY - Number(q.get('y') ?? c.centerY)) * c.scale);
    }
  }
}
