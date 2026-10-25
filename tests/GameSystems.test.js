import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop } from '../src/game/GameLoop.js';
import { validateSave, DEFAULT_SAVE } from '../src/utils/storage.js';
import { SIM_DT } from '../src/data/config.js';
import { CAREER_COUNT } from '../src/data/levels.js';

describe('GameLoop', () => {
  let frames;
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
    vi.stubGlobal('performance', { now: () => 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const tick = (t) => {
    const cb = frames.shift();
    cb(t);
  };

  it('runs fixed steps and scales them with speed', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++, () => {});
    loop.start();
    tick(1000 / 60);
    expect(steps).toBe(1);
    loop.speed = 3;
    tick((2 * 1000) / 60);
    expect(steps).toBe(4);
  });

  it('pausing freezes the simulation; resuming continues without a time jump', () => {
    let steps = 0;
    let renders = 0;
    const loop = new GameLoop(() => steps++, () => renders++);
    loop.start();
    tick(100);
    const before = steps;
    loop.setPaused(true);
    tick(200);
    tick(5000);
    expect(steps).toBe(before);
    expect(renders).toBe(3);
    loop.setPaused(false);
    tick(5000 + 1000 / 60);
    expect(steps - before).toBe(1);
  });

  it('clamps huge frame gaps (inactive tab) to a bounded number of steps', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++, () => {});
    loop.start();
    tick(60000);
    expect(steps).toBeLessThanOrEqual(Math.ceil(0.25 / SIM_DT));
  });
});

describe('Save data validation', () => {
  it('returns defaults for garbage', () => {
    expect(validateSave(null)).toEqual(JSON.parse(JSON.stringify(DEFAULT_SAVE)));
    expect(validateSave('nope').unlockedLevel).toBe(1);
  });

  it('sanitises corrupted fields', () => {
    const s = validateSave({
      unlockedLevel: 99,
      bestScores: { 1: 500, 2: -4, 3: 'x' },
      bestStars: { 1: 7 },
      challengesCompleted: ['c1', 'c1', 5, 'c3'],
      settings: { volume: 4, muted: 'yes', speed: 9, showMetrics: false },
      tutorialDone: 1,
    });
    expect(s.unlockedLevel).toBe(CAREER_COUNT);
    expect(s.bestScores).toEqual({ 1: 500 });
    expect(s.bestStars).toEqual({ 1: 3 });
    expect(s.challengesCompleted).toEqual(['c1', 'c3']);
    expect(s.settings.volume).toBe(1);
    expect(s.settings.muted).toBe(false);
    expect(s.settings.speed).toBe(1);
    expect(s.settings.showMetrics).toBe(false);
    expect(s.tutorialDone).toBe(false);
  });
});
