// 牠們自己的生活：跟你過一樣的日子（喝水、看書、吃東西、打盹、睡覺、玩、散步）。
//
// 「牠在某個時間在做什麼」是時間的純函式：activityAt(pet, t, ctx) 只看這隻的 uid（當種子）、性格、時間 t、你的作息和你確認過的事（ctx）。
// 不是一步一步模擬出來的，所以手機和電腦在同一個時間一定算出一樣的答案（F20）；你不在的時候牠們也照樣過（動物森友會）。
// 時間切成 10 分鐘一格，每一格用 hash(種子, 格子) 抽，不用 createRng 串流（串流的結果取決於之前抽過幾次）。
//
// 跟你的作息一樣（F34）：你平常睡的時候牠們在睡、午餐晚餐時間牠們在吃、大約每 90 分鐘喝一次水、下午比較常看書打盹。
// 只加不減（F16）：你晚睡、沒打開手機，牠們都照樣過得好，沒有「肚子餓」「好寂寞」這種事。
// 這裡不用內建亂數、不讀時鐘：時間一律由參數提供（本地時間用 new Date(t)，跟 routine.js 一樣）。
import { usual, DAY_START } from './routine.js';
import { traitsOf } from './mind.js';

export const SLOT = 10 * 60_000; // 一格幾毫秒（猜的，可調整）
export const ACTS = ['sleep', 'nap', 'drink', 'eat', 'read', 'play', 'wander'];
export const ACT_ZH = { sleep: '在睡覺', nap: '在打盹', drink: '在喝水', eat: '在吃東西', read: '在看書', play: '在玩', wander: '在散步' };
// 手機摘要裡一格一個字（24 小時 144 個字）
export const CODE = { sleep: 's', nap: 'n', drink: 'd', eat: 'e', read: 'r', play: 'p', wander: 'w' };
export const actOfCode = c => ACTS.find(a => CODE[a] === c) ?? null;

// 你的作息還不夠 7 天時的預設（猜的，可調整）：23:30 睡、07:30 起來
const SLEEP_FROM = 23 * 60 + 30, SLEEP_TO = 7 * 60 + 30;
const BED_AFTER = 20; // 你平常最後一次用電腦之後幾分鐘，牠們就睡了（猜的）
const WAKE_BEFORE = 10; // 你平常第一次用電腦之前幾分鐘，牠們就醒了（猜的）
// 吃飯的時間（猜的，可調整；作息只記得你什麼時候用電腦，不知道你幾點吃飯）
const MEALS = [[12 * 60, 13 * 60], [18 * 60 + 30, 19 * 60 + 30]];
const DRINK_EVERY = 9; // 醒著的時候每幾格喝一次水（9 格＝90 分鐘，猜的）

// ---------- 你的作息 → 牠們的一天 ----------
// 回傳 { sleepFrom, sleepTo }（當地時間的第幾分鐘，00:00＝0）；有跟你一起做的事時再加 together
// together：[{ uid, act, from, until }]（core/checkin.js 的 spans）：那段時間那一隻在做跟你一樣的事
export function lifeCtx(routine, now, together = []) {
  const u = routine ? usual(routine, now) : null;
  const tg = together?.length ? { together } : {};
  if (!u) return { sleepFrom: SLEEP_FROM, sleepTo: SLEEP_TO, ...tg };
  const clock = m => (((m + DAY_START) % 1440) + 1440) % 1440;
  const from = clock(u.last + BED_AFTER), to = clock(u.first - WAKE_BEFORE);
  const len = (to - from + 1440) % 1440;
  // 太短或太長（資料怪怪的）就用預設
  if (len < 4 * 60 || len > 13 * 60) return { sleepFrom: SLEEP_FROM, sleepTo: SLEEP_TO, ...tg };
  return { sleepFrom: from, sleepTo: to, ...tg };
}

const inRange = (m, a, b) => (a <= b ? m >= a && m < b : m >= a || m < b); // 可以跨過午夜
const clockMinute = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };

// ---------- 雜湊（不是亂數串流） ----------
export function seedOf(uid) {
  let h = 2166136261;
  for (const ch of String(uid)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash01(seed, n, salt = 0) {
  let x = (seed ^ Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---------- 牠在 t 這一格在做什麼 ----------
// pet：{ uid, nature }；ctx：lifeCtx() 的結果
export function activityAt(pet, t, ctx) {
  const slot = Math.floor(t / SLOT), start = slot * SLOT;
  const seed = seedOf(pet.uid);
  // 跟你一起做的事最優先（你半夜喝水，牠也醒來一起喝）：這一格跟那段時間有重疊就算，同一格有好幾件取最晚開始的
  let mine = null;
  for (const g of ctx.together ?? []) if (g.uid === pet.uid && g.from < start + SLOT && g.until > start && (!mine || g.from > mine.from)) mine = g;
  if (mine) return mine.act;
  const m = clockMinute(start + SLOT / 2); // 這一格中間是幾點
  if (inRange(m, ctx.sleepFrom, ctx.sleepTo)) return 'sleep';
  // 醒著：大約每 90 分鐘喝一次水（每隻錯開）
  if ((slot + (seed % DRINK_EVERY)) % DRINK_EVERY === 0) return 'drink';
  const tr = traitsOf(pet.nature);
  const w = {
    nap: 0.8 * (0.5 + tr.sleepy),
    drink: 0.2,
    eat: 0.3 * (0.5 + tr.greedy),
    read: 1.2 * (0.6 + (1 - tr.outgoing) * 0.6 + tr.curious * 0.4),
    play: 1.6 * (0.4 + tr.outgoing),
    wander: 1.6 * (0.6 + tr.curious * 0.6),
  };
  if (MEALS.some(([a, b]) => inRange(m, a, b))) w.eat += 10; // 吃飯時間：大家都在吃
  if (m >= 13 * 60 && m < 17 * 60) { w.read *= 2; w.nap *= 2; } // 下午：看書、打盹
  // 快睡了（睡前 90 分鐘）：安靜一點
  if (inRange(m, (ctx.sleepFrom - 90 + 1440) % 1440, ctx.sleepFrom)) { w.play *= 0.4; w.read *= 1.5; w.nap *= 1.5; }
  let r = hash01(seed, slot) * Object.values(w).reduce((s, v) => s + v, 0);
  for (const [a, v] of Object.entries(w)) { r -= v; if (r < 0) return a; }
  return 'wander';
}

// 從 from 開始 n 格，一格一個字（手機摘要用；手機照時間查表，跟電腦算的一樣）
export function timeline(pet, from, n, ctx) {
  const start = Math.floor(from / SLOT) * SLOT;
  let s = '';
  for (let i = 0; i < n; i++) s += CODE[activityAt(pet, start + i * SLOT, ctx)];
  return { from: start, slot: SLOT, acts: s };
}

// 「咕咕鴿在喝水」
export const lifeLine = (act, name) => `${name}${ACT_ZH[act] ?? '在發呆'}`;
