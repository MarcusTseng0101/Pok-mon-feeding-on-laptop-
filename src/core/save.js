// 存檔格式。整份存成一個 JSON（main process 負責寫入 userData/save.json）。
// 改格式時把 SAVE_VERSION +1，並在 migrate() 補上舊版 → 新版的轉換。

import { FLAVORS, TIER_ORDER, puffKey } from './amie.js';

export const SAVE_VERSION = 1;
export const MAX_OUT = 6;

export const DEFAULT_SETTINGS = {
  musicVolume: 0.45,
  sfxVolume: 0.7,
  muted: false,
  encounterRate: 'normal',
  showLauncher: true,
  quiet: false, // 勿擾：收起所有寶可夢、暫停遭遇
};

export function emptyPuffs() {
  const puffs = {};
  for (const f of FLAVORS) for (const t of TIER_ORDER) puffs[puffKey(f, t)] = 0;
  return puffs;
}

export function defaultSave(now) {
  const puffs = emptyPuffs();
  for (const f of FLAVORS) puffs[puffKey(f, 'basic')] = 2;
  puffs[puffKey('sweet', 'frosted')] = 1;
  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeenAt: now,
    lastDailyGift: null,
    starterChosen: false,
    settings: { ...DEFAULT_SETTINGS },
    bag: { balls: { poke: 15, great: 3, ultra: 1 }, puffs },
    dex: {}, // [speciesId]: { seen, caught, firstSeenAt, firstCaughtAt }
    mons: [],
    zygardeCells: 0,
    regenMinutes: 0,
    nextPartnerGiftAt: now + 30 * 60 * 1000,
    stats: { encounters: 0, throws: 0, catches: 0, puffsFed: 0, strokes: 0, evolutions: 0 },
  };
}

const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

export function normalizeMon(m, dex) {
  if (!m || !dex.has(m.species)) return null;
  return {
    uid: String(m.uid),
    species: m.species,
    nickname: typeof m.nickname === 'string' && m.nickname.trim() ? m.nickname.slice(0, 12) : null,
    nature: dex.nature(m.nature) ? m.nature : 'hardy',
    shiny: Boolean(m.shiny),
    ball: ['poke', 'great', 'ultra'].includes(m.ball) ? m.ball : 'poke',
    caughtAt: num(m.caughtAt, Date.now()),
    affection: num(m.affection, 0, 0, 255),
    fullness: num(m.fullness, 0, 0, 255),
    enjoyment: num(m.enjoyment, 0, 0, 255),
    xp: num(m.xp, 0, 0),
    out: Boolean(m.out),
    tasteKnown: Boolean(m.tasteKnown),
  };
}

// 讀進來的存檔可能是舊版、損壞或被手動改過；一律補齊欄位、夾住數值範圍。
export function migrate(raw, dex, now) {
  const base = defaultSave(now);
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...raw };
  s.version = SAVE_VERSION;
  s.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  s.bag = {
    balls: { ...base.bag.balls, ...(raw.bag?.balls ?? {}) },
    puffs: { ...emptyPuffs(), ...(raw.bag?.puffs ?? {}) },
  };
  for (const k of Object.keys(s.bag.balls)) s.bag.balls[k] = num(s.bag.balls[k], 0, 0, 999);
  for (const k of Object.keys(s.bag.puffs)) s.bag.puffs[k] = num(s.bag.puffs[k], 0, 0, 999);
  s.mons = (Array.isArray(raw.mons) ? raw.mons : []).map(m => normalizeMon(m, dex)).filter(Boolean);
  let out = 0;
  for (const m of s.mons) if (m.out && ++out > MAX_OUT) m.out = false;
  s.dex = {};
  for (const [id, d] of Object.entries(raw.dex ?? {})) {
    if (dex.has(Number(id))) s.dex[id] = { seen: num(d.seen, 0, 0), caught: num(d.caught, 0, 0), firstSeenAt: d.firstSeenAt ?? null, firstCaughtAt: d.firstCaughtAt ?? null };
  }
  s.stats = { ...base.stats, ...(raw.stats ?? {}) };
  s.zygardeCells = num(raw.zygardeCells, 0, 0, 10);
  s.starterChosen = Boolean(raw.starterChosen) || s.mons.length > 0;
  return s;
}
