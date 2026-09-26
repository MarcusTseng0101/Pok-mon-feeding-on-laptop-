// 每天一下的心情回報：選單點一個表情（很累／很開心／壓力大），不用打字。
// 效果只維持到那個作息日結束（05:00 換日，跟 core/routine.js 一樣）。一天只問一次，跳過就不再問。
// 只存最近 60 天的「哪一天、哪一個」，給每週的信用。
import { routineDay } from './routine.js';

export const MOODS = {
  tired: { zh: '很累', emoji: '😪', reply: '好，今天大家安靜地陪你' },
  happy: { zh: '很開心', emoji: '😊', reply: '太好了！大家也跟著開心起來' },
  stressed: { zh: '壓力大', emoji: '😣', reply: '辛苦了。有一隻會安靜地坐在你旁邊' },
};
export const MOOD_IDS = Object.keys(MOODS);
export const KEPT = 60;

export function defaultMood() { return { log: [], skipped: null }; }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function normalizeMood(raw) {
  const d = defaultMood();
  if (!raw || typeof raw !== 'object') return d;
  const byDay = new Map();
  for (const e of Array.isArray(raw.log) ? raw.log : []) if (e && DAY_RE.test(e.day) && MOODS[e.mood]) byDay.set(e.day, e.mood);
  d.log = [...byDay].map(([day, mood]) => ({ day, mood })).sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-KEPT);
  d.skipped = typeof raw.skipped === 'string' && DAY_RE.test(raw.skipped) ? raw.skipped : null;
  return d;
}

// 同步：同一天兩台電腦都選了 → 用 b（比較新的那邊由呼叫的人決定順序）
export function mergeMood(a, b) {
  const A = normalizeMood(a), B = normalizeMood(b);
  const m = normalizeMood({ log: [...A.log, ...B.log] });
  m.skipped = [A.skipped, B.skipped].filter(Boolean).sort().pop() ?? null;
  return m;
}

export function setMood(mood, id, now) {
  if (!MOODS[id]) return false;
  const day = routineDay(now);
  mood.log = [...mood.log.filter(e => e.day !== day), { day, mood: id }].slice(-KEPT);
  return true;
}
export const moodToday = (mood, now) => mood.log.find(e => e.day === routineDay(now))?.mood ?? null;
export function skipMood(mood, now) { mood.skipped = routineDay(now); }
// 今天要不要在選單最上面問
export const shouldAsk = (mood, now) => !moodToday(mood, now) && mood.skipped !== routineDay(now);

// 這幾個作息日的心情各幾天（每週的信用）
export function countMoods(mood, days) {
  const set = new Set(days), out = { tired: 0, happy: 0, stressed: 0 };
  for (const e of mood.log) if (set.has(e.day)) out[e.mood]++;
  return out;
}
