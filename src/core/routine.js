// 學會你的作息：只用「有人在操作電腦」「好像在打字」「專注了多久」這幾個訊號，記住你的節奏。
// 只存統計（每個作息日 4 個數字），不存每一次開電腦的時間。
//
// 作息日：每天從當地 05:00 開始算（猜的，可調整），所以 00:30 還算「昨天晚上」。
// 所有「幾點」都換成「作息日的第幾分鐘」（05:00 → 0、23:30 → 1110、01:00 → 1200）再比較，跨過午夜也不會算錯。
//
// 三個反應（畫面在 director.js，都要經過打擾額度）：
//   早安：距離上一次有人操作電腦超過 4 小時，而且現在是早上（05:00～12:00）→ 一個作息日一次
//   晚睡：比平常最後一次操作的時間晚 45 分鐘以上（資料不夠 7 天時：01:00 以後）→ 一晚一次
//   專注兩小時：今天完成的專注加起來第一次超過 120 分鐘 → 一天一次（等番茄鐘結束才慶祝）

export const DAY_START = 5 * 60; // 05:00（猜的，可調整）
export const DAYS_KEPT = 28;
export const MIN_DAYS = 7; // 滿幾天才有「平常」（猜的，可調整）
export const GREET_GAP = 4 * 3_600_000; // 離開多久算「早上第一次」（猜的，可調整）
export const GREET_UNTIL = 12 * 60 - DAY_START; // 12:00 以前才算早上
export const LATE_MARGIN = 45; // 比平常晚多少分鐘算晚睡（猜的，可調整）
export const LATE_FALLBACK = 25 * 60 - DAY_START; // 資料不夠時：01:00 以後
export const LATE_EARLIEST = 22 * 60 - DAY_START; // 平常很早就不用電腦的人，也要 22:00 以後才算「晚睡」
export const FOCUS_GOAL = 120;

// 當地時間的「作息日」（'YYYY-MM-DD'，05:00 才換日）和作息日的第幾分鐘
export function routineDay(t) {
  const d = new Date(t - DAY_START * 60_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function minuteOf(t) {
  const d = new Date(t);
  return (d.getHours() * 60 + d.getMinutes() - DAY_START + 1440) % 1440;
}
export const clockOf = minute => { const m = (minute + DAY_START) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---------- 存檔 ----------
// days：{ 作息日: { first, last, typing, focus } }（分鐘）；greeted／bedtime／focusDone：那個反應最後一次是哪個作息日
export function defaultRoutine() {
  return { days: {}, lastActiveAt: null, greeted: null, bedtime: null, focusDone: null };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const clampMin = v => (Number.isFinite(v) ? Math.max(0, Math.min(1439, Math.round(v))) : null);
export function normalizeRoutine(raw) {
  const r = defaultRoutine();
  if (!raw || typeof raw !== 'object') return r;
  for (const [k, d] of Object.entries(raw.days ?? {})) {
    if (!DAY_RE.test(k) || !d) continue;
    const first = clampMin(d.first), last = clampMin(d.last);
    if (first === null || last === null) continue;
    r.days[k] = { first: Math.min(first, last), last: Math.max(first, last), typing: Math.max(0, Math.min(1440, Number(d.typing) || 0)), focus: Math.max(0, Math.min(1440, Number(d.focus) || 0)) };
  }
  prune(r);
  r.lastActiveAt = Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : null;
  for (const k of ['greeted', 'bedtime', 'focusDone']) r[k] = typeof raw[k] === 'string' && DAY_RE.test(raw[k]) ? raw[k] : null;
  return r;
}

function prune(r) {
  const keys = Object.keys(r.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAYS_KEPT))) delete r.days[k];
}

// 同步：同一天兩台電腦都有紀錄 → 最早的第一次、最晚的最後一次、時間加起來
export function mergeRoutine(a, b) {
  const A = normalizeRoutine(a), B = normalizeRoutine(b), out = defaultRoutine();
  for (const k of new Set([...Object.keys(A.days), ...Object.keys(B.days)])) {
    const x = A.days[k], y = B.days[k];
    out.days[k] = x && y ? { first: Math.min(x.first, y.first), last: Math.max(x.last, y.last), typing: Math.min(1440, x.typing + y.typing), focus: Math.min(1440, x.focus + y.focus) } : { ...(x ?? y) };
  }
  prune(out);
  out.lastActiveAt = Math.max(A.lastActiveAt ?? -Infinity, B.lastActiveAt ?? -Infinity);
  if (!Number.isFinite(out.lastActiveAt)) out.lastActiveAt = null;
  for (const k of ['greeted', 'bedtime', 'focusDone']) out[k] = [A[k], B[k]].filter(Boolean).sort().pop() ?? null;
  return out;
}

// ---------- 平常的樣子 ----------
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// 平常第一次、最後一次操作電腦（作息日的第幾分鐘，中位數：一個熬夜的日子不會把「平常」拉走）。
// 不算今天；不夠 MIN_DAYS 天就回傳 null
export function usual(r, now) {
  const today = routineDay(now);
  const days = Object.entries(r.days).filter(([k]) => k !== today).map(([, d]) => d);
  if (days.length < MIN_DAYS) return null;
  return { first: Math.round(median(days.map(d => d.first))), last: Math.round(median(days.map(d => d.last))), days: days.length };
}

// ---------- 記錄 ----------
// 每分鐘一次：有人在操作電腦（active）、好像在打字（typing）。回傳這一次該有的反應 ['greet'、'bedtime']
export function tick(r, now, { active = false, typing = false } = {}) {
  const out = [];
  if (!active) return out;
  const day = routineDay(now), minute = minuteOf(now);
  // 早安：先看離開了多久（在更新 lastActiveAt 之前）
  const away = r.lastActiveAt === null ? Infinity : now - r.lastActiveAt;
  if (r.greeted !== day && away >= GREET_GAP && minute < GREET_UNTIL) { r.greeted = day; out.push('greet'); }
  const d = (r.days[day] ??= { first: minute, last: minute, typing: 0, focus: 0 });
  d.first = Math.min(d.first, minute);
  d.last = Math.max(d.last, minute);
  if (typing) d.typing = Math.min(1440, d.typing + 1);
  r.lastActiveAt = now;
  prune(r);
  if (r.bedtime !== day && minute >= lateAfter(r, now)) { r.bedtime = day; out.push('bedtime'); }
  return out;
}

// 幾點（作息日的第幾分鐘）以後算晚睡
export function lateAfter(r, now) {
  const u = usual(r, now);
  return u ? Math.max(LATE_EARLIEST, u.last + LATE_MARGIN) : LATE_FALLBACK;
}

// 完成一段專注：記下分鐘數；今天第一次超過兩小時就回傳 true（要慶祝）
export function addFocus(r, now, minutes) {
  const day = routineDay(now);
  const d = (r.days[day] ??= { first: minuteOf(now), last: minuteOf(now), typing: 0, focus: 0 });
  d.focus = Math.min(1440, d.focus + Math.max(0, minutes));
  prune(r);
  if (d.focus >= FOCUS_GOAL && r.focusDone !== day) { r.focusDone = day; return true; }
  return false;
}

export const focusToday = (r, now) => r.days[routineDay(now)]?.focus ?? 0;
