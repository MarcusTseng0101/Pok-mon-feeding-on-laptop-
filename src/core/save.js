// 存檔格式。整份存成一個 JSON（main process 負責寫入 userData/save.json）。
// 改格式時把 SAVE_VERSION +1，並在 migrate() 補上舊版 → 新版的轉換。

import { FLAVORS, TIER_ORDER, BERRIES, puffKey } from './amie.js';
import { canonicalForm, formsOf } from './forms.js';
import { normalizeMind } from './mind.js';
import { normalizeMemory } from './memory.js';
import { normalizeLetters, defaultLetters } from './letters.js';
import { normalizeStory, defaultStory } from './story.js';
import { ITEM_IDS } from './items.js';
import { defaultAttention, normalizeAttention, LIMITS, DEFAULT_LIMIT } from './attention.js';
import { defaultRoutine, normalizeRoutine } from './routine.js';
import { defaultTogether, normalizeTogether } from './together.js';
import { defaultMood, normalizeMood } from './mood.js';
import { normalizeBase, defaultBase, emptyMaterials, MATERIALS } from './base.js';
import { normalizeTrip, normalizePostcard, PLACES, POSTCARDS_KEPT, TRIPS_DONE_KEPT } from './trips.js';

// 舊存檔沒有心智：用 uid 產生固定的起始值（每次讀進來都一樣）
function seededRng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export const SAVE_VERSION = 2; // v2：形態、樹果、蛋、成就、專注、天氣、同步
export const MAX_OUT = 6;
export const MAX_EGGS = 3;
export const TRAINING_STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const TRAINING_MAX = 252; // 單一能力上限（同原作努力值）
export const TRAINING_TOTAL = 510; // 六項加起來的上限
export const ITEMS = ITEM_IDS; // 重要物品（core/items.js）

export const DEFAULT_SETTINGS = {
  musicVolume: 0.45,
  sfxVolume: 0.7,
  muted: false,
  encounterRate: 'normal',
  showLauncher: true,
  quiet: false, // 勿擾：收起所有寶可夢、暫停遭遇
  focusMinutes: 25, // 番茄鐘長度（15–60）
  birthday: null, // 你的生日 'MM-DD'（不填也可以；那天夥伴會寫信給你）
  calmFx: false, // 減少閃光和畫面震動（招式的演出）
  phone: false, // 手機頁面（src/main/phone.js）：預設關閉
  interruptions: String(DEFAULT_LIMIT), // 寶可夢每小時最多主動打擾你幾次（core/attention.js）：'0'／'1'／'2'／'unlimited'
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
    bag: { balls: { poke: 15, great: 3, ultra: 1 }, puffs, berries: emptyBerries(), items: emptyItems(), materials: emptyMaterials() },
    dex: {}, // [speciesId]: { seen, caught, shiny, firstSeenAt, firstCaughtAt, forms?: { [形態]: { seen, caught } } }
    mons: [],
    zygardeCells: 0,
    shinyCharm: false,
    chain: { species: null, count: 0 }, // 同種連鎖捕獲
    bonds: {}, // 夥伴之間的感情 { 'uidA|uidB': 0–255 }
    rivalries: {}, // 夥伴之間的競爭心（切磋輸贏的次數）{ 'uidA|uidB': 0–99 }
    regenMinutes: 0,
    nextPartnerGiftAt: now + 30 * 60 * 1000,
    eggs: [], // [{ uid, species, form, shiny, steps, need, receivedAt }]
    eggDay: null, // 今天找過蛋了沒（每天一次機會）
    achievements: {}, // { [id]: 解鎖時間 }
    achievementRewards: { fancy: false, pokeBall: false }, // 彩粉蝶花紋獎勵給過了沒
    pendingVivillon: [], // 下一隻野生粉蝶蟲一族的特別花紋（'fancy'、'poke-ball'），抓到就用掉
    focus: { sessions: 0, totalMinutes: 0, streakDays: 0, lastDay: null, active: null }, // 番茄鐘；active＝{ startedAt, minutes }
    weather: null, // { city, lat, lon, enabled }
    sync: null, // { folder, deviceId, rev, lastSyncedRev, origin, lastBag, ledger }（見 core/sync.js）
    hatchedEggs: [], // 已經孵化的蛋（同步時用：別台電腦的存檔裡還有這顆蛋也不會再出現）
    postcards: [], // 旅行帶回來的明信片 [{ id, place, seed, at, uid, name, diary }]
    tripsDone: [], // 已經結算的旅行 id（同步時用：不會在另一台電腦再結算一次）
    placesVisited: {}, // { [地點]: 第一次去的時間 }
    letters: defaultLetters(), // 夥伴寫給你的信（core/letters.js）
    story: defaultStory(), // 主線故事（core/story.js）
    attention: defaultAttention(), // 打擾額度：最近放行主動打擾的時間（core/attention.js）
    routine: defaultRoutine(), // 你的作息：最近 28 天每天的第一次／最後一次操作、打字、專注分鐘（core/routine.js）
    together: defaultTogether(), // 你和大家：第一次見面、里程碑、每週的信（core/together.js）
    mood: defaultMood(), // 每天的心情（core/mood.js）
    base: defaultBase(now), // 秘密基地（core/base.js）：一開始有帳篷＋一張小床
    minigames: { day: null, baked: 0, deluxe: 0 }, // 今天做了幾個泡芙（每天有上限）
    stats: {
      encounters: 0, throws: 0, catches: 0, puffsFed: 0, strokes: 0, evolutions: 0, shinies: 0,
      berriesPicked: 0, puffsBaked: 0, eggsHatched: 0, focusSessions: 0, perches: 0, trips: 0,
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
    nicknameAt: Number.isFinite(m.nicknameAt) ? m.nicknameAt : null, // 暱稱最後改的時間（同步時用新的）
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
    mind: normalizeMind(m.mind, seededRng(String(m.uid))), // 需求、最近的想法（core/mind.js）
    memory: normalizeMemory(m.memory), // 記得的事（core/memory.js）
    trip: normalizeTrip(m.trip), // 旅行中（core/trips.js）；null＝在家
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
    materials: emptyMaterials(), // 蓋秘密基地的材料（旅行帶回來的）
  };
  for (const b of Object.keys(s.bag.berries)) s.bag.berries[b] = num(raw.bag?.berries?.[b], 0, 0, 999);
  for (const i of ITEMS) s.bag.items[i] = Boolean(raw.bag?.items?.[i]);
  for (const k of Object.keys(MATERIALS)) s.bag.materials[k] = num(raw.bag?.materials?.[k], 0, 0, 999);
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
  s.postcards = (Array.isArray(raw.postcards) ? raw.postcards : []).map(normalizePostcard).filter(Boolean).slice(-POSTCARDS_KEPT);
  s.tripsDone = (Array.isArray(raw.tripsDone) ? raw.tripsDone : []).filter(id => typeof id === 'string' && id.length <= 60).slice(-TRIPS_DONE_KEPT);
  s.base = normalizeBase(raw.base, now);
  s.letters = normalizeLetters(raw.letters);
  s.story = normalizeStory(raw.story);
  s.attention = normalizeAttention(raw.attention);
  s.routine = normalizeRoutine(raw.routine);
  // 舊存檔沒有「第一次見面」：用最早來的夥伴推回來（都沒有就用建立存檔的時間）
  const earliest = s.mons.map(m => m.caughtAt).filter(Number.isFinite).sort((a, b) => a - b)[0];
  s.together = normalizeTogether(raw.together, s.starterChosen ? earliest ?? s.createdAt : null);
  s.mood = normalizeMood(raw.mood);
  if (!(s.settings.interruptions in LIMITS)) s.settings.interruptions = String(DEFAULT_LIMIT);
  s.settings.birthday = typeof s.settings.birthday === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s.settings.birthday) ? s.settings.birthday : null;
  s.placesVisited = Object.fromEntries(Object.entries(raw.placesVisited && typeof raw.placesVisited === 'object' ? raw.placesVisited : {}).filter(([k, v]) => PLACES[k] && Number.isFinite(v)));
  s.hatchedEggs = (Array.isArray(raw.hatchedEggs) ? raw.hatchedEggs : []).filter(u => typeof u === 'string' && u.length <= 40).slice(-200);
  s.eggDay = typeof raw.eggDay === 'string' && DAY_RE.test(raw.eggDay) ? raw.eggDay : null;
  s.achievements = {};
  for (const [id, at] of Object.entries(raw.achievements ?? {})) if (/^[a-z0-9-]{1,40}$/.test(id) && Number.isFinite(at)) s.achievements[id] = at;
  const f = raw.focus ?? {};
  s.focus = {
    sessions: num(f.sessions, 0, 0),
    totalMinutes: num(f.totalMinutes, 0, 0),
    streakDays: num(f.streakDays, 0, 0),
    lastDay: typeof f.lastDay === 'string' && DAY_RE.test(f.lastDay) ? f.lastDay : null,
    active: f.active && Number.isFinite(f.active.startedAt) && Number.isFinite(f.active.minutes)
      ? { startedAt: f.active.startedAt, minutes: Math.round(num(f.active.minutes, 25, 15, 60)) }
      : null,
  };
  s.settings.focusMinutes = Math.round(num(s.settings.focusMinutes, 25, 15, 60));
  s.settings.calmFx = s.settings.calmFx === true;
  const w = raw.weather;
  s.weather = w && Number.isFinite(w.lat) && Number.isFinite(w.lon) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180
    ? { city: str(w.city, 40) ?? '', lat: w.lat, lon: w.lon, enabled: Boolean(w.enabled) }
    : null;
  s.achievementRewards = { fancy: Boolean(raw.achievementRewards?.fancy), pokeBall: Boolean(raw.achievementRewards?.pokeBall) };
  s.pendingVivillon = (Array.isArray(raw.pendingVivillon) ? raw.pendingVivillon : []).filter(f => f === 'fancy' || f === 'poke-ball').slice(0, 2);
  const mg = raw.minigames ?? {};
  s.minigames = {
    day: typeof mg.day === 'string' && DAY_RE.test(mg.day) ? mg.day : null,
    baked: Math.floor(num(mg.baked, 0, 0, 99)),
    deluxe: Math.floor(num(mg.deluxe, 0, 0, 99)),
  };
  const y = raw.sync;
  const flat = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => /^(balls|puffs|berries|materials)\.[a-z-]{1,24}$/.test(k) && Number.isFinite(v)).map(([k, v]) => [k, Math.round(v)]));
  s.sync = y && str(y.folder, 500) && typeof y.deviceId === 'string' && /^[a-z0-9]{6,32}$/.test(y.deviceId)
    ? {
      folder: y.folder.slice(0, 500),
      deviceId: y.deviceId,
      rev: Math.floor(num(y.rev, 0, 0)),
      lastSyncedRev: Math.floor(num(y.lastSyncedRev, 0, 0)),
      origin: flat(y.origin), // 背包的起點（開始同步時）
      lastBag: flat(y.lastBag), // 上次同步後這台電腦的背包
      // 每台電腦自己造成的背包變化量（見 core/sync.js）
      ledger: Object.fromEntries(Object.entries(y.ledger && typeof y.ledger === 'object' ? y.ledger : {})
        .filter(([dev, e]) => /^[a-z0-9]{6,32}$/.test(dev) && e && typeof e === 'object')
        .map(([dev, e]) => [dev, { rev: Math.floor(num(e.rev, 0, 0)), delta: flat(e.delta) }])),
    }
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
  s.rivalries = {};
  for (const [k, v] of Object.entries(raw.rivalries ?? {})) {
    const [a, b] = k.split('|');
    if (uids.has(a) && uids.has(b) && a !== b) s.rivalries[a < b ? `${a}|${b}` : `${b}|${a}`] = num(v, 0, 0, 99);
  }
  s.starterChosen = Boolean(raw.starterChosen) || s.mons.length > 0;
  return s;
}
