// 存檔格式。整份存成一個 JSON（main process 負責寫入 userData/save.json）。
// 改格式時把 SAVE_VERSION +1，並在 migrate() 補上舊版 → 新版的轉換。

import { FLAVORS, TIER_ORDER, BERRIES, puffKey } from './amie.js';
import { canonicalForm, formsOf } from './forms.js';

export const SAVE_VERSION = 2; // v2：形態、樹果、蛋、成就、專注、天氣、同步
export const MAX_OUT = 6;
export const MAX_EGGS = 3;
export const TRAINING_STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const TRAINING_MAX = 252; // 單一能力上限（同原作努力值）
export const TRAINING_TOTAL = 510; // 六項加起來的上限
export const ITEMS = ['diancite'];

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
    bag: { balls: { poke: 15, great: 3, ultra: 1 }, puffs, berries: emptyBerries(), items: emptyItems() },
    dex: {}, // [speciesId]: { seen, caught, shiny, firstSeenAt, firstCaughtAt, forms?: { [形態]: { seen, caught } } }
    mons: [],
    zygardeCells: 0,
    shinyCharm: false,
    chain: { species: null, count: 0 }, // 同種連鎖捕獲
    bonds: {}, // 夥伴之間的感情 { 'uidA|uidB': 0–255 }
    regenMinutes: 0,
    nextPartnerGiftAt: now + 30 * 60 * 1000,
    eggs: [], // [{ uid, species, form, shiny, steps, need, receivedAt }]
    achievements: {}, // { [id]: 解鎖時間 }
    focus: { sessions: 0, totalMinutes: 0, streakDays: 0, lastDay: null }, // 番茄鐘
    weather: null, // { city, lat, lon, enabled }
    sync: null, // { folder, deviceId, rev, lastSyncedRev }
    stats: {
      encounters: 0, throws: 0, catches: 0, puffsFed: 0, strokes: 0, evolutions: 0, shinies: 0,
      berriesPicked: 0, puffsBaked: 0, eggsHatched: 0, focusSessions: 0, perches: 0,
    },
  };
}

export function emptyBerries() {
  return Object.fromEntries(Object.keys(BERRIES).map(b => [b, 0]));
}

export function emptyItems() {
  return Object.fromEntries(ITEMS.map(i => [i, false]));
}

const num = (v, d, lo = -Infinity, hi = Infinity) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 超級特訓：每項 0–252，依順序分配，總和超過 510 的部分砍掉
export function normalizeTraining(t) {
  const out = {};
  let left = TRAINING_TOTAL;
  for (const k of TRAINING_STATS) {
    const v = Math.min(Math.floor(num(t?.[k], 0, 0, TRAINING_MAX)), left);
    out[k] = v;
    left -= v;
  }
  return out;
}

function normalizeEgg(e, dex) {
  if (!e || !dex.has(e.species) || !Number.isFinite(e.need)) return null;
  const need = Math.round(num(e.need, 1, 1, 1e7));
  return {
    uid: String(e.uid ?? ''),
    species: e.species,
    form: canonicalForm(e.species, e.form),
    shiny: Boolean(e.shiny),
    steps: num(e.steps, 0, 0, need),
    need,
    receivedAt: num(e.receivedAt, Date.now()),
  };
}

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
    form: canonicalForm(m.species, m.form), // null＝預設形態
    trimAt: Number.isFinite(m.trimAt) ? m.trimAt : null, // 多麗米亞剪毛的時間
    training: normalizeTraining(m.training),
    // 在桌面上的位置（螢幕比例 0–1），由畫面寫入；沒有就讓畫面自己挑位置
    pos: m.pos && Number.isFinite(m.pos.x) && Number.isFinite(m.pos.y) ? { x: num(m.pos.x, 0.5, 0, 1), y: num(m.pos.y, 0.8, 0, 1) } : null,
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
    berries: emptyBerries(),
    items: emptyItems(),
  };
  for (const b of Object.keys(s.bag.berries)) s.bag.berries[b] = num(raw.bag?.berries?.[b], 0, 0, 999);
  for (const i of ITEMS) s.bag.items[i] = Boolean(raw.bag?.items?.[i]);
  for (const k of Object.keys(s.bag.balls)) s.bag.balls[k] = num(s.bag.balls[k], 0, 0, 999);
  for (const k of Object.keys(s.bag.puffs)) s.bag.puffs[k] = num(s.bag.puffs[k], 0, 0, 999);
  s.mons = (Array.isArray(raw.mons) ? raw.mons : []).map(m => normalizeMon(m, dex)).filter(Boolean);
  let out = 0;
  for (const m of s.mons) if (m.out && ++out > MAX_OUT) m.out = false;
  s.dex = {};
  for (const [id, d] of Object.entries(raw.dex ?? {})) {
    if (!dex.has(Number(id))) continue;
    s.dex[id] = { seen: num(d.seen, 0, 0), caught: num(d.caught, 0, 0), shiny: num(d.shiny, 0, 0), firstSeenAt: d.firstSeenAt ?? null, firstCaughtAt: d.firstCaughtAt ?? null };
    // 每種形態分開記（花蓓蓓的花色、彩粉蝶的花紋…）；預設形態也記，key 用形態名稱
    const forms = {};
    for (const [f, c] of Object.entries(d.forms ?? {})) {
      if (!formsOf(Number(id)).includes(f)) continue;
      forms[f] = { seen: num(c?.seen, 0, 0), caught: num(c?.caught, 0, 0) };
    }
    if (Object.keys(forms).length) s.dex[id].forms = forms;
  }
  s.stats = { ...base.stats };
  for (const [k, v] of Object.entries(raw.stats ?? {})) s.stats[k] = num(v, 0, 0);
  s.eggs = (Array.isArray(raw.eggs) ? raw.eggs : []).map(e => normalizeEgg(e, dex)).filter(Boolean).slice(0, MAX_EGGS);
  s.achievements = {};
  for (const [id, at] of Object.entries(raw.achievements ?? {})) if (/^[a-z0-9-]{1,40}$/.test(id) && Number.isFinite(at)) s.achievements[id] = at;
  const f = raw.focus ?? {};
  s.focus = {
    sessions: num(f.sessions, 0, 0),
    totalMinutes: num(f.totalMinutes, 0, 0),
    streakDays: num(f.streakDays, 0, 0),
    lastDay: typeof f.lastDay === 'string' && DAY_RE.test(f.lastDay) ? f.lastDay : null,
  };
  const w = raw.weather;
  s.weather = w && Number.isFinite(w.lat) && Number.isFinite(w.lon) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180
    ? { city: str(w.city, 40) ?? '', lat: w.lat, lon: w.lon, enabled: Boolean(w.enabled) }
    : null;
  const y = raw.sync;
  s.sync = y && str(y.folder, 500) && str(y.deviceId, 40)
    ? { folder: y.folder.slice(0, 500), deviceId: y.deviceId.slice(0, 40), rev: Math.floor(num(y.rev, 0, 0)), lastSyncedRev: Math.floor(num(y.lastSyncedRev, 0, 0)) }
    : null;
  s.zygardeCells = num(raw.zygardeCells, 0, 0, 10);
  s.shinyCharm = Boolean(raw.shinyCharm);
  s.chain = dex.has(raw.chain?.species) ? { species: raw.chain.species, count: num(raw.chain.count, 0, 0, 999) } : { species: null, count: 0 };
  const uids = new Set(s.mons.map(m => m.uid));
  s.bonds = {};
  for (const [k, v] of Object.entries(raw.bonds ?? {})) {
    const [a, b] = k.split('|');
    if (uids.has(a) && uids.has(b) && a !== b) s.bonds[a < b ? `${a}|${b}` : `${b}|${a}`] = num(v, 0, 0, 255);
  }
  s.starterChosen = Boolean(raw.starterChosen) || s.mons.length > 0;
  return s;
}
