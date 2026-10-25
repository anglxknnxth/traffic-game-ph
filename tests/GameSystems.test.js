import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameLoop } from '../src/game/GameLoop.js';
import { validateSave, DEFAULT_SAVE } from '../src/utils/storage.js';
import { SIM_DT } from '../src/data/config.js';
import { CAREER_COUNT, PINOY_COUNT, PINOY_LEVELS } from '../src/data/levels.js';

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

  it('moves progress from old career levels 11–16 to Pinoy Roads', () => {
    const s = validateSave({ unlockedLevel: 14, bestScores: { 3: 900, 11: 1500, 13: 2100 }, bestStars: { 3: 2, 11: 3, 13: 1 } });
    expect(s.unlockedLevel).toBe(CAREER_COUNT);
    expect(s.bestScores).toEqual({ 3: 900 });
    expect(s.bestStars).toEqual({ 3: 2 });
    expect(s.pinoyBest).toEqual({ poblacion: 1500, espana: 2100 });
    expect(s.pinoyStars).toEqual({ poblacion: 3, espana: 1 });
    // cleared España (3rd) unlocks the 4th
    expect(s.pinoyUnlocked).toBe(4);
  });

  it('sanitises Pinoy Roads and per-map Endless fields', () => {
    const s = validateSave({ pinoyUnlocked: 99, pinoyBest: { taft: 5, edsa: -1 }, pinoyStars: { taft: 9 }, endlessBestByMap: { edsa: 3000, x: 'y' } });
    expect(s.pinoyUnlocked).toBe(PINOY_COUNT);
    expect(s.pinoyBest).toEqual({ taft: 5 });
    expect(s.pinoyStars).toEqual({ taft: 3 });
    expect(s.endlessBestByMap).toEqual({ edsa: 3000 });
    expect(PINOY_LEVELS.every((l) => l.mode === 'pinoy' && typeof l.id === 'string' && l.map)).toBe(true);
  });
});
