// Top-level UI/game state shared by the game shell, HUD and menus.

export const SCREEN = Object.freeze({
  MENU: 'menu',
  BRIEFING: 'briefing',
  PLAYING: 'playing',
  RESULTS: 'results',
});

export class GameState {
  constructor(settings) {
    this.screen = SCREEN.MENU;
    this.paused = false;
    this.speed = settings?.speed || 1;
    this.debug = !!settings?.debug;
    this.showMetrics = settings?.showMetrics !== false;
  }
}

export const MODE_LABEL = {
  career: 'Career',
  tutorial: 'Tutorial',
  endless: 'Endless',
  challenge: 'Challenge',
  pinoy: 'Pinoy Roads',
};
