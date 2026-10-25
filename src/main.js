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
  if (['career', 'challenge', 'endless', 'tutorial', 'pinoy'].includes(mode)) game.startSession(mode, id || (mode === 'pinoy' ? 'poblacion' : 1));
  // Dev server only: &ff=60 fast-forwards the simulation, &zoom=2&x=0&y=-80 frames the camera.
  if (import.meta.env.DEV && game.session) {
    const q = new URLSearchParams(location.search);
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
