// 手機打卡：你照顧自己的那一刻，牠也跟著做（Finch 的「照顧自己＝照顧牠」）。
//
// 「手機上你做的事怎麼影響牠們」只在這裡決定：手機送來 { kind, id, at }，這裡決定算不算、算到哪一天、回什麼話；
// 真正加在寶可夢身上的數值由 Game.checkin() 透過既有的 amie／mindDelta 加上去。main/phone.js、手機頁面、renderer 都不改數值。
//
// 要加一種新的打卡（例如「伸展」）：在 CHECKINS 加一列，再在 renderer/gfx/traces.js 加一個痕跡的圖。
// 手機上的按鈕由這張表自動產生（core/phonedata.js），伺服器也照這張表檢查（validAction）。
//
// 只加不減（F16）：沒打卡不扣任何東西、沒有連續天數、牠們從不向你要求打卡。
// 這裡不用內建亂數、不讀時鐘：時間一律由參數 now 提供。
import { routineDay } from './routine.js';

// id：送過來的種類；zh：手機上的按鈕；doing：「你＿＿的時候」；act：「牠也＿＿」；perDay：一天最多算幾次（猜的，可調整）
// trace：回家後桌面上的痕跡（renderer/gfx/traces.js）；link：算進今天做到的好事（core/symbiosis.js 的 LINKS），null＝不算
// anim：手機上牠的小動作（phone.css 的 .do-<anim>）
export const CHECKINS = [
  { id: 'meal', zh: '我吃飯了', doing: '去吃飯', act: '吃了一顆樹果', perDay: 3, trace: 'bowl', link: 'meal', anim: 'munch' },
  { id: 'water', zh: '我喝水了', doing: '喝水', act: '喝了一口水', perDay: 8, trace: 'cup', link: 'water', anim: 'munch' },
  { id: 'walk', zh: '出門走走', doing: '出門走走', act: '在家裡繞了一圈', perDay: 3, trace: 'leaf', link: 'walk', anim: 'hop' },
  { id: 'sleep', zh: '我要去睡了', doing: '去睡', act: '窩進基地睡了', perDay: 1, trace: 'pillow', link: 'sleep', anim: 'doze' },
  { id: 'study', zh: '我在讀書', doing: '讀書', act: '翻開了一本書', perDay: 4, trace: 'book', link: 'focus', anim: 'nod' },
];
export const VISIT = 'visit'; // 你打開手機頁面：想念（不是打卡，不留痕跡）

// 一次打卡的量＝一個普通泡芙（飽足 40、好感 3、成長 4）的 25%，只給做這件事的那一隻（猜的，可調整）
export const GAIN = { fullness: 10, enjoyment: 5, affection: 0.75, xp: 1 };
export const VISIT_GAP = 2 * 3_600_000; // 打開手機頁面幾小時算一次想念（猜的，可調整）
export const VISIT_AFFECTION = 0.2; // 想念一次的好感（猜的，可調整）
export const MAX_SKEW = 24 * 3_600_000; // 手機的時間最多相信到多久以前（F19）
export const TRACES_SHOWN = 3; // 桌面上同時最多幾個痕跡（F21）
export const TRACE_HOURS = 12; // 重開 app 時，多久以內的打卡還留著痕跡（猜的，可調整）
const DAYS_KEPT = 14;

const kindOf = id => CHECKINS.find(c => c.id === id) ?? null;
export { kindOf };

// ---------- 伺服器收到的東西（F15） ----------
// body 只能有 kind、id、at 三個欄位：kind 在表裡（或 visit）、id 是 32 個十六進位字元、at 是數字。其他一律不收
const ID_RE = /^[0-9a-f]{32}$/;
export function validAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some(k => k !== 'kind' && k !== 'id' && k !== 'at')) return null;
  const { kind, id, at } = body;
  if (typeof kind !== 'string' || (kind !== VISIT && !kindOf(kind))) return null;
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { kind, id, at };
}

// 手機的時間不可信（F19）：在「電腦現在往前 24 小時」到「電腦現在」之間才相信，超出範圍就用電腦現在的時間（照樣收）
export function clampAt(at, now) {
  return Number.isFinite(at) && at <= now && at >= now - MAX_SKEW ? at : now;
}

// ---------- 存檔 ----------
// days：{ 作息日: { 打卡 id: { kind, at, uid, gain } } }（id 去重，F18）；lastVisit：上一次算想念的時間；
// missed：最近一次想念的是哪一隻（下一次你回到電腦，牠第一個發現你；用過就清掉）
export function defaultCheckins() {
  return { days: {}, lastVisit: null, missed: null };
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[a-z]{1,16}$/; // 另一台電腦可能有這台還不認識的新種類：留著，不要丟掉
function normalizeRec(r) {
  if (!r || typeof r !== 'object' || !KIND_RE.test(r.kind ?? '') || !Number.isFinite(r.at)) return null;
  return { kind: r.kind, at: r.at, uid: typeof r.uid === 'string' ? r.uid.slice(0, 64) : null, gain: r.gain === true };
}
export function normalizeCheckins(raw) {
  const c = defaultCheckins();
  if (!raw || typeof raw !== 'object') return c;
  for (const [day, recs] of Object.entries(raw.days ?? {})) {
    if (!DAY_RE.test(day) || !recs || typeof recs !== 'object') continue;
    for (const [id, r] of Object.entries(recs)) {
      const n = ID_RE.test(id) ? normalizeRec(r) : null;
      if (n) (c.days[day] ??= {})[id] = n;
    }
  }
  prune(c);
  c.lastVisit = Number.isFinite(raw.lastVisit) ? raw.lastVisit : null;
  c.missed = raw.missed && typeof raw.missed.uid === 'string' && Number.isFinite(raw.missed.at) ? { uid: raw.missed.uid, at: raw.missed.at } : null;
  return c;
}
function prune(c) {
  const keys = Object.keys(c.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAYS_KEPT))) delete c.days[k];
}

// 同步（F18）：同一天取 id 的聯集，不相加；同一個 id 兩邊都有就留比較早的那筆
export function mergeCheckins(a, b) {
  const A = normalizeCheckins(a), B = normalizeCheckins(b), out = defaultCheckins();
  for (const src of [A, B]) {
    for (const [day, recs] of Object.entries(src.days)) {
      for (const [id, r] of Object.entries(recs)) {
        const have = out.days[day]?.[id];
        if (!have || r.at < have.at) (out.days[day] ??= {})[id] = { ...r };
      }
    }
  }
  prune(out);
  out.lastVisit = Math.max(A.lastVisit ?? -Infinity, B.lastVisit ?? -Infinity);
  if (!Number.isFinite(out.lastVisit)) out.lastVisit = null;
  out.missed = A.missed; // 誰第一個發現你：這台電腦自己的演出
  return out;
}

// ---------- 打卡 ----------
function find(c, id) {
  for (const [day, recs] of Object.entries(c.days)) if (recs[id]) return { day, rec: recs[id] };
  return null;
}
// 這一天這一種已經算過幾次：用不重複的 id 數算，不用計數器（F18）
export const countOn = (c, day, kind) => Object.values(c.days[day] ?? {}).filter(r => r.kind === kind).length;

// action：validAction 過的 { kind, id, at }；uid：做這件事的那一隻（Game 挑）。
// 回傳 { dup, day, id, rec }：dup＝同一個 id 之前收過（冪等：回一樣的東西，不再加數值）；rec.gain＝這次有沒有加數值（超過每天上限就不加，但照樣記下來、照樣有回應）
export function apply(c, action, now, uid = null) {
  const def = kindOf(action?.kind);
  if (!def) return null;
  const seen = find(c, action.id);
  if (seen) return { dup: true, day: seen.day, id: action.id, rec: { ...seen.rec } };
  const at = clampAt(action.at, now), day = routineDay(at);
  const rec = { kind: def.id, at, uid, gain: countOn(c, day, def.id) < def.perDay };
  (c.days[day] ??= {})[action.id] = rec;
  prune(c);
  return { dup: false, day, id: action.id, rec: { ...rec } };
}

// 打開手機頁面＝想念：每 VISIT_GAP 最多算一次。回傳 { gain }
export function visit(c, now, uid = null) {
  if (c.lastVisit != null && now - c.lastVisit < VISIT_GAP && now >= c.lastVisit) return { gain: false };
  c.lastVisit = now;
  if (uid) c.missed = { uid, at: now };
  return { gain: Boolean(uid) };
}

// 最近的打卡（桌面上的痕跡用）：hours 小時以內，由新到舊，最多 n 筆 → [{ id, kind, at, uid }]
export function recent(c, now, { hours = TRACE_HOURS, n = TRACES_SHOWN } = {}) {
  const out = [];
  for (const recs of Object.values(c.days)) for (const [id, r] of Object.entries(recs)) if (r.at <= now && now - r.at <= hours * 3_600_000 && kindOf(r.kind)) out.push({ id, ...r });
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, n);
}

// ---------- 文字（F17：一定寫出哪一隻、做了什麼；F16：不責怪、不催） ----------
const hhmm = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 手機上的當下回應：「咕咕鴿也喝了一口水」
export const replyLine = (kind, name) => `${name}也${kindOf(kind)?.act ?? '陪著你'}`;
// 桌面痕跡的文字：「12:40 你去吃飯的時候，咕咕鴿也吃了一顆樹果」
export const traceLine = (rec, name) => `${hhmm(rec.at)} 你${kindOf(rec.kind)?.doing ?? '忙'}的時候，${name}也${kindOf(rec.kind)?.act ?? '陪著你'}`;
// 打開手機頁面：「咕咕鴿好像感覺到你在看牠」
export const visitLine = name => `${name}好像感覺到你在看牠`;

// 手機頁面上的按鈕（core/phonedata.js 放進摘要）
export const buttons = () => CHECKINS.map(c => ({ id: c.id, zh: c.zh }));
