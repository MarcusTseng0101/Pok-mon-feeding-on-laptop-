// 你和大家一起的事：第一次見面、里程碑、每週的信。
// 夥伴自己的記憶（core/memory.js）三天就淡掉、放生了也跟著不見，所以這裡另外存一份「你和大家」的紀錄：
// 永久保存、有上限、兩台電腦同步取聯集。
import { routineDay } from './routine.js';
import { daysBetween } from './calendar.js';
import { countMoods, MOODS } from './mood.js';

export const MILESTONES = {
  'met-7': { zh: '認識滿一週', line: '我們認識一個禮拜了！' },
  'met-30': { zh: '認識滿一個月', line: '我們認識一個月了！' },
  'met-100': { zh: '認識滿 100 天', line: '我們認識 100 天了！' },
  'met-365': { zh: '認識滿一年', line: '我們認識一整年了！' },
  'late-night': { zh: '第一次一起熬夜', line: '第一次陪你熬夜到這麼晚。' },
  'focus-3h': { zh: '第一次一天專注滿 3 小時', line: '今天你專注了 3 個小時，好厲害！' },
  'first-holiday': { zh: '第一次一起過節', line: '第一次跟你一起過節！' },
};
const MET_DAYS = { 'met-7': 7, 'met-30': 30, 'met-100': 100, 'met-365': 365 };
export const KEPT = 50;

export function defaultTogether() { return { firstMet: null, milestones: [], weeklyDay: null, holidayDay: null }; }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// fallback：舊存檔沒有 firstMet 時，用最早來的夥伴的時間推回來
export function normalizeTogether(raw, fallbackFirstMet = null) {
  const d = defaultTogether();
  const r = raw && typeof raw === 'object' ? raw : {};
  d.firstMet = Number.isFinite(r.firstMet) ? r.firstMet : Number.isFinite(fallbackFirstMet) ? fallbackFirstMet : null;
  const seen = new Map();
  for (const m of Array.isArray(r.milestones) ? r.milestones : []) {
    if (!m || !MILESTONES[m.id] || !Number.isFinite(m.at)) continue;
    if (!seen.has(m.id) || seen.get(m.id) > m.at) seen.set(m.id, m.at);
  }
  d.milestones = [...seen].map(([id, at]) => ({ id, at })).sort((a, b) => a.at - b.at).slice(-KEPT);
  for (const k of ['weeklyDay', 'holidayDay']) d[k] = typeof r[k] === 'string' && DAY_RE.test(r[k]) ? r[k] : null;
  return d;
}

export function mergeTogether(a, b) {
  const A = normalizeTogether(a), B = normalizeTogether(b);
  const out = normalizeTogether({ milestones: [...A.milestones, ...B.milestones] });
  const f = [A.firstMet, B.firstMet].filter(Number.isFinite);
  out.firstMet = f.length ? Math.min(...f) : null;
  for (const k of ['weeklyDay', 'holidayDay']) out[k] = [A[k], B[k]].filter(Boolean).sort().pop() ?? null;
  return out;
}

// 認識第幾天（第一次見面那天是第 0 天，照當地日曆）
export const daysTogether = (t, now) => (Number.isFinite(t.firstMet) ? daysBetween(t.firstMet, now) : 0);
export const has = (t, id) => t.milestones.some(m => m.id === id);

// 看看有沒有新的里程碑。ctx：{ lateNight, focusToday（分鐘）, holiday（今天有節日而且夥伴在桌面上）}
// 回傳新達成的 id（已經記進去了）
export function check(t, now, ctx = {}) {
  const got = [];
  const add = id => { if (!has(t, id)) { t.milestones = [...t.milestones, { id, at: now }].slice(-KEPT); got.push(id); } };
  const days = daysTogether(t, now);
  for (const [id, n] of Object.entries(MET_DAYS)) if (Number.isFinite(t.firstMet) && days >= n) add(id);
  if (ctx.lateNight) add('late-night');
  if ((ctx.focusToday ?? 0) >= 180) add('focus-3h');
  if (ctx.holiday) add('first-holiday');
  return got;
}

// ---------- 每週的信 ----------
// 週日早上 9 點以後，寫「這週我們一起……」。內容只能是真的發生過的事：
// 這週（前 7 個作息日，不含今天）開了幾天電腦、專注幾分鐘、心情、這週的里程碑
export function weekDays(now) {
  const out = [];
  for (let i = 7; i >= 1; i--) out.push(routineDay(now - i * 86_400_000));
  return out;
}
export function weeklySummary(state, now) {
  const days = weekDays(now);
  const set = new Set(days);
  const rdays = Object.entries(state.routine?.days ?? {}).filter(([k]) => set.has(k)).map(([, d]) => d);
  const from = new Date(now - 7 * 86_400_000).getTime();
  return {
    days: rdays.length,
    focus: rdays.reduce((s, d) => s + (d.focus ?? 0), 0),
    moods: countMoods(state.mood ?? { log: [] }, days),
    milestones: (state.together?.milestones ?? []).filter(m => m.at >= from && m.at < now).map(m => m.id),
  };
}
// 現在該寄這週的信嗎（週日 09:00 以後、這週還沒寄、這週至少開過一天電腦）
export function weeklyDue(state, now) {
  const d = new Date(now);
  if (d.getDay() !== 0 || d.getHours() < 9) return false;
  if (state.together?.weeklyDay === routineDay(now)) return false;
  return weeklySummary(state, now).days > 0;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
// 寫信：tone 跟夥伴平常寫信的語氣一樣（core/letters.js 的 toneOf）；refs 記下信裡每一個數字對到哪個統計
export function writeWeekly(summary, rng, { tone = 'plain', name = '' } = {}) {
  const refs = [];
  const open = { warm: '這禮拜也好開心！', shy: '……這禮拜，謝謝你。', plain: '這週過得怎麼樣？' }[tone] ?? '這週過得怎麼樣？';
  const parts = [];
  parts.push(`這週我們一起過了 ${summary.days} 天。`);
  refs.push({ k: 'days', v: summary.days });
  if (summary.focus > 0) {
    const h = Math.floor(summary.focus / 60), m = summary.focus % 60;
    parts.push(`你專注了 ${h ? `${h} 小時` : ''}${m || !h ? `${m} 分鐘` : ''}，${pick(['我都在旁邊看著喔。', '我們都好佩服你。', '辛苦了。'], rng)}`);
    refs.push({ k: 'focus', v: summary.focus });
  }
  const moods = Object.entries(summary.moods).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (moods.length) {
    const [top, n] = moods[0];
    const line = { tired: `有 ${n} 天你說很累，希望你有好好休息。`, happy: `有 ${n} 天你說很開心，我們也跟著開心。`, stressed: `有 ${n} 天你說壓力很大，下週我們也會陪著你。` }[top];
    parts.push(line);
    refs.push({ k: `mood:${top}`, v: n });
  }
  for (const id of summary.milestones.slice(0, 2)) { parts.push(MILESTONES[id].line); refs.push({ k: `milestone:${id}`, v: 1 }); }
  const close = { warm: '下週也要一起過喔！', shy: '……下週也請多指教。', plain: '下週見。' }[tone] ?? '下週見。';
  const text = [open, parts.join(''), close].join('\n\n');
  return { text, refs, moodZh: moods.length ? MOODS[moods[0][0]].zh : null, name };
}
