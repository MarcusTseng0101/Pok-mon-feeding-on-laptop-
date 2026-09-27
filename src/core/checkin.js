// 拍照，一起做：你在手機上拍下你正在做的事、按確認，牠就在同一刻跟你做一樣的事（Finch 的「照顧自己＝照顧牠」、body doubling）。
//
// 照片只在手機上（src/phone/snap.js 猜、你確認）；電腦只收到 { kind, id, at }——幾點、做什麼、一個不重複的 id。
// 「確認了的事怎麼影響牠們」只在這裡決定：記下「誰、從幾點到幾點、一起做什麼」（together），
// core/life.js 在那段時間把那隻的生活換成一樣的事（ctx.together），所以你回家看到「牠那時候在做什麼」，就是跟你一起做的那件事。
// main/phone.js、手機頁面、renderer 都不改數值。
//
// 要加一種新的事（例如「伸展」）：在 SNAPS 加一列、src/phone/snap.js 的對照表加物件、renderer/gfx/traces.js 加一個痕跡的圖。
//
// 只加不減（F16）：沒拍照不扣任何東西、沒有連續天數、牠們從不向你要求拍照。
// 這裡不用內建亂數、不讀時鐘：時間一律由參數 now 提供。
import { routineDay } from './routine.js';

// id：送過來的種類（跟 src/phone/snap.js 一樣）；zh：手機上的選項；doing：「你＿＿的時候」；act：「咕咕鴿＿＿」
// life：那段時間牠的生活（core/life.js 的 ACTS）；minutes：一起做多久（猜的，可調整）
// trace：回家後桌面上的痕跡（renderer/gfx/traces.js）；link：算進今天做到的好事（core/symbiosis.js 的 LINKS）
export const SNAPS = [
  { id: 'drink', zh: '喝水', doing: '喝水', act: '也一起喝了', life: 'drink', minutes: 10, trace: 'cup', link: 'water' },
  { id: 'read', zh: '讀書', doing: '讀書', act: '也一起讀了', life: 'read', minutes: 50, trace: 'book', link: 'focus' },
  { id: 'eat', zh: '吃飯', doing: '吃飯', act: '也一起吃了', life: 'eat', minutes: 10, trace: 'bowl', link: 'meal' },
  { id: 'rest', zh: '休息', doing: '休息', act: '也一起休息了', life: 'nap', minutes: 10, trace: 'pillow', link: 'rest' },
];
export const DONE = 'done'; // 「讀完了」：提早結束正在一起做的事（不留痕跡）

export const MAX_SKEW = 24 * 3_600_000; // 手機的時間最多相信到多久以前（F19）
export const TRACES_SHOWN = 3; // 桌面上同時最多幾個痕跡（F21）
export const TRACE_HOURS = 12; // 多久以內的事還留著痕跡（猜的，可調整）
const DAYS_KEPT = 14;

export const kindOf = id => SNAPS.find(c => c.id === id) ?? null;

// ---------- 伺服器收到的東西（F15） ----------
// body 只能有 kind、id、at 三個欄位：kind 在表裡（或 done）、id 是 32 個十六進位字元、at 是數字。其他一律不收
const ID_RE = /^[0-9a-f]{32}$/;
export function validAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.some(k => k !== 'kind' && k !== 'id' && k !== 'at')) return null;
  const { kind, id, at } = body;
  if (typeof kind !== 'string' || (kind !== DONE && !kindOf(kind))) return null;
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { kind, id, at };
}

// 手機的時間不可信（F19）：在「電腦現在往前 24 小時」到「電腦現在」之間才相信，超出範圍就用電腦現在的時間（照樣收）
export function clampAt(at, now) {
  return Number.isFinite(at) && at <= now && at >= now - MAX_SKEW ? at : now;
}

// ---------- 存檔 ----------
// days：{ 作息日: { id: { kind, at, until, uid } } }（id 去重，F18）。done 也記下來（until＝at），重送才不會又結束一次
export function defaultCheckins() {
  return { days: {} };
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[a-z]{1,16}$/; // 另一台電腦可能有這台還不認識的新種類：留著，不要丟掉
function normalizeRec(r) {
  if (!r || typeof r !== 'object' || !KIND_RE.test(r.kind ?? '') || !Number.isFinite(r.at)) return null;
  const until = Number.isFinite(r.until) && r.until >= r.at ? r.until : r.at;
  return { kind: r.kind, at: r.at, until, uid: typeof r.uid === 'string' ? r.uid.slice(0, 64) : null };
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
  return c;
}
function prune(c) {
  const keys = Object.keys(c.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAYS_KEPT))) delete c.days[k];
}

// 同步（F18）：取 id 的聯集，不相加；同一個 id 兩邊都有：留比較早的開始、比較早的結束（另一台按了「讀完了」）
export function mergeCheckins(a, b) {
  const A = normalizeCheckins(a), B = normalizeCheckins(b), out = defaultCheckins();
  for (const src of [A, B]) {
    for (const [day, recs] of Object.entries(src.days)) {
      for (const [id, r] of Object.entries(recs)) {
        const have = out.days[day]?.[id];
        (out.days[day] ??= {})[id] = have ? { ...(r.at < have.at ? r : have), until: Math.min(r.until, have.until) } : { ...r };
      }
    }
  }
  prune(out);
  return out;
}

// ---------- 一起做 ----------
function find(c, id) {
  for (const [day, recs] of Object.entries(c.days)) if (recs[id]) return { day, rec: recs[id] };
  return null;
}
const all = c => Object.values(c.days ?? {}).flatMap(recs => Object.entries(recs).map(([id, r]) => ({ id, ...r })));

// action：validAction 過的 { kind, id, at }；uid：跟你一起做的那一隻（Game 挑）。
// 回傳 { dup, day, id, rec }：dup＝同一個 id 之前收過（冪等：回一樣的東西，不再改任何東西）
export function apply(c, action, now, uid = null) {
  if (!action || (action.kind !== DONE && !kindOf(action.kind))) return null;
  const seen = find(c, action.id);
  if (seen) return { dup: true, day: seen.day, id: action.id, rec: { ...seen.rec } };
  const at = clampAt(action.at, now), day = routineDay(at);
  let rec;
  if (action.kind === DONE) {
    // 提早結束：正在一起做的那件事（最近開始、還沒結束的）結束在這一刻
    const cur = all(c).filter(r => r.kind !== DONE && r.at <= at && at < r.until).sort((a, b) => b.at - a.at)[0];
    if (cur) find(c, cur.id).rec.until = at;
    rec = { kind: DONE, at, until: at, uid: cur?.uid ?? null };
  } else {
    // 開始新的一件：之前還沒結束的就停在這一刻（一次只一起做一件事）
    for (const r of all(c)) if (r.kind !== DONE && r.at <= at && at < r.until) find(c, r.id).rec.until = at;
    rec = { kind: action.kind, at, until: at + kindOf(action.kind).minutes * 60_000, uid };
  }
  (c.days[day] ??= {})[action.id] = rec;
  prune(c);
  return { dup: false, day, id: action.id, rec: { ...rec } };
}

// core/life.js 的 ctx.together：[{ uid, act, from, until }]
export function spans(c) {
  return all(c).filter(r => r.uid && kindOf(r.kind) && r.until > r.at).map(r => ({ uid: r.uid, act: kindOf(r.kind).life, from: r.at, until: r.until }));
}

// 最近一起做過的事（桌面上的痕跡用）：hours 小時以內、已經開始的，由新到舊，最多 n 筆 → [{ id, kind, at, until, uid }]
export function recent(c, now, { hours = TRACE_HOURS, n = TRACES_SHOWN } = {}) {
  return all(c).filter(r => kindOf(r.kind) && r.at <= now && now - r.at <= hours * 3_600_000)
    .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1)).slice(0, n);
}

// ---------- 文字（F17：一定寫出哪一隻、做了什麼；F16：不責怪、不催） ----------
const hhmm = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 手機上的當下回應：「咕咕鴿跟你一起喝水」
export const replyLine = (kind, name) => (kindOf(kind) ? `${name}跟你一起${kindOf(kind).zh}` : `${name}伸了個懶腰`);
// 桌面痕跡的文字：「12:40 你喝水的時候，咕咕鴿也一起喝了」
export const traceLine = (rec, name) => `${hhmm(rec.at)} 你${kindOf(rec.kind)?.doing ?? '忙'}的時候，${name}${kindOf(rec.kind)?.act ?? '陪著你'}`;
