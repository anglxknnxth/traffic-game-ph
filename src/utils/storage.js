// Validated localStorage persistence with an in-memory fallback.

import { CAREER_COUNT, PINOY_COUNT, PINOY_LEVELS, LEGACY_CAREER_TO_PINOY } from '../data/levels.js';

const KEY = 'tcp.save.v1';

export const DEFAULT_SAVE = Object.freeze({
  unlockedLevel: 1,
  bestScores: {},
  bestStars: {},
  endlessBest: 0,
  endlessBestTime: 0,
  challengesCompleted: [],
  challengeBest: {},
  pinoyUnlocked: 1, // Pinoy Roads levels unlocked, in list order
  pinoyBest: {},
  pinoyStars: {},
  endlessBestByMap: {},
  tutorialDone: false,
  settings: {
    volume: 0.8,
    music: 0.5,
    musicOn: true,
    muted: false,
    speed: 1,
    debug: false,
    showMetrics: true,
    rain: true, // rain showers in every mode
    people: true, // pedestrians in every mode
    chillMaxTraffic: 0, // cap on the Chill Endless demand ramp (1–3x); 0 = no limit
    fpsCap: 0, // frame-rate cap: 0 = every display frame, or 72 / 60
  },
});

let memoryStore = null;

function getStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__tcp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function sanitizeScoreMap(raw, maxValue) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === 'string' && k.length < 32 && isNum(v) && v >= 0) out[k] = Math.min(v, maxValue);
    }
  }
  return out;
}

export function validateSave(raw) {
  const d = structuredCloneSafe(DEFAULT_SAVE);
  if (!raw || typeof raw !== 'object') return d;
  if (isNum(raw.unlockedLevel)) d.unlockedLevel = Math.min(CAREER_COUNT, Math.max(1, Math.floor(raw.unlockedLevel)));
  d.bestScores = sanitizeScoreMap(raw.bestScores, 1e7);
  d.bestStars = sanitizeScoreMap(raw.bestStars, 3);
  d.challengeBest = sanitizeScoreMap(raw.challengeBest, 1e7);
  d.pinoyBest = sanitizeScoreMap(raw.pinoyBest, 1e7);
  d.pinoyStars = sanitizeScoreMap(raw.pinoyStars, 3);
  d.endlessBestByMap = sanitizeScoreMap(raw.endlessBestByMap, 1e7);
  if (isNum(raw.pinoyUnlocked)) d.pinoyUnlocked = Math.floor(raw.pinoyUnlocked);
  // Career levels 11–16 became Pinoy Roads levels: carry their progress over.
  for (const [old, id] of Object.entries(LEGACY_CAREER_TO_PINOY)) {
    if (old in d.bestScores) d.pinoyBest[id] = Math.max(d.pinoyBest[id] || 0, d.bestScores[old]);
    if (old in d.bestStars) d.pinoyStars[id] = Math.max(d.pinoyStars[id] || 0, d.bestStars[old]);
    delete d.bestScores[old];
    delete d.bestStars[old];
  }
  if (isNum(raw.unlockedLevel) && raw.unlockedLevel > CAREER_COUNT) d.pinoyUnlocked = Math.max(d.pinoyUnlocked, Math.floor(raw.unlockedLevel) - CAREER_COUNT);
  for (const id of Object.keys(d.pinoyStars)) {
    const i = PINOY_LEVELS.findIndex((l) => l.id === id);
    if (i >= 0 && d.pinoyStars[id] > 0) d.pinoyUnlocked = Math.max(d.pinoyUnlocked, i + 2);
  }
  d.pinoyUnlocked = Math.min(PINOY_COUNT, Math.max(1, d.pinoyUnlocked));
  if (isNum(raw.endlessBest) && raw.endlessBest >= 0) d.endlessBest = Math.floor(raw.endlessBest);
  if (isNum(raw.endlessBestTime) && raw.endlessBestTime >= 0) d.endlessBestTime = raw.endlessBestTime;
  if (Array.isArray(raw.challengesCompleted)) {
    d.challengesCompleted = [...new Set(raw.challengesCompleted.filter((x) => typeof x === 'string' && x.length < 16))];
  }
  d.tutorialDone = raw.tutorialDone === true;
  const s = raw.settings;
  if (s && typeof s === 'object') {
    if (isNum(s.volume)) d.settings.volume = Math.min(1, Math.max(0, s.volume));
    if (isNum(s.music)) d.settings.music = Math.min(1, Math.max(0, s.music));
    if (typeof s.musicOn === 'boolean') d.settings.musicOn = s.musicOn;
    if (typeof s.muted === 'boolean') d.settings.muted = s.muted;
    if ([1, 2, 3].includes(s.speed)) d.settings.speed = s.speed;
    if ([0, 60, 72].includes(s.fpsCap)) d.settings.fpsCap = s.fpsCap;
    if (typeof s.debug === 'boolean') d.settings.debug = s.debug;
    if (typeof s.showMetrics === 'boolean') d.settings.showMetrics = s.showMetrics;
    if (typeof s.rain === 'boolean') d.settings.rain = s.rain;
    if (typeof s.people === 'boolean') d.settings.people = s.people;
    if (isNum(s.chillMaxTraffic) && (s.chillMaxTraffic === 0 || (s.chillMaxTraffic >= 1 && s.chillMaxTraffic <= 3))) d.settings.chillMaxTraffic = s.chillMaxTraffic;
  }
  return d;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function loadSave() {
  const storage = getStorage();
  if (!storage) return validateSave(memoryStore);
  try {
    const text = storage.getItem(KEY);
    if (!text) return validateSave(null);
    return validateSave(JSON.parse(text));
  } catch {
    return validateSave(null);
  }
}

export function writeSave(data) {
  const clean = validateSave(data);
  const storage = getStorage();
  if (!storage) {
    memoryStore = clean;
    return false;
  }
  try {
    storage.setItem(KEY, JSON.stringify(clean));
    return true;
  } catch {
    memoryStore = clean;
    return false;
  }
}

export function clearSave() {
  memoryStore = null;
  const storage = getStorage();
  try {
    storage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return validateSave(null);
}
