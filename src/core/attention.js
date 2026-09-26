// 打擾額度：寶可夢「主動找你」（跳通知、放音樂、跑到游標旁邊、故事的電話…）有上限，
// 預設滾動的 60 分鐘內最多 1 次。陪伴感有一半來自「知道什麼時候不要吵你」。
//
// 規則：
// - 你剛做了什麼（點、拖、餵）的反應不算主動，不經過這裡。
// - 專注中、勿擾中、玩小遊戲中：額度是 0，主動的事全部排隊。
// - 被擋下的事不會直接丟掉：排進佇列，額度空出來時照優先順序放行。
//   expiresAt 到了還沒輪到就丟掉（打字時跑過來這種順手的反應）；故事、里程碑、生日用 Infinity，一定會發生。
// 這裡只有資料和純函式；佇列裡的 run（真的去演出的函式）由畫面放進來，這裡不會呼叫它。

export const WINDOW = 60 * 60_000;
export const LIMITS = { 0: 0, 1: 1, 2: 2, unlimited: Infinity }; // 設定的選項（每小時幾次）
export const DEFAULT_LIMIT = 1; // 猜的，可調整
export const LIMIT_ZH = { 0: '完全不主動打擾', 1: '每小時最多 1 次', 2: '每小時最多 2 次', unlimited: '不限制' };

// 優先順序：數字越大越先放行
export const PRIORITY = { story: 50, milestone: 40, greet: 30, celebrate: 30, gift: 20, bedtime: 20, ambient: 10 };

// 存檔的部分：只有放行過的時間（最近 24 小時）。佇列只在記憶體裡（裡面有函式，而且故事之類的沒做完，重開 app 會自己再來）
export function defaultAttention() { return { granted: [] }; }
export function normalizeAttention(raw) {
  const g = Array.isArray(raw?.granted) ? raw.granted.filter(Number.isFinite) : [];
  return { granted: g.sort((a, b) => a - b).slice(-50) };
}

export const limitOf = setting => (setting in LIMITS ? LIMITS[setting] : DEFAULT_LIMIT);

// 一級一級往下降（心情是「很累」的那天用）：不限制 → 2 → 1 → 0
export function lowerLimit(limit) {
  return limit === Infinity ? 2 : Math.max(0, limit - 1);
}

// 最近 60 分鐘放行了幾次
export const usedInWindow = (att, now) => att.granted.filter(t => t > now - WINDOW && t <= now).length;

// 現在可以主動打擾嗎。blocked：專注、勿擾、小遊戲
export function canInterrupt(att, now, { limit = DEFAULT_LIMIT, blocked = false } = {}) {
  return !blocked && usedInWindow(att, now) < limit;
}

// 下一次額度空出來的時間（沒有擋住就是現在）
export function nextFreeAt(att, now, { limit = DEFAULT_LIMIT } = {}) {
  if (limit === 0) return Infinity;
  const recent = att.granted.filter(t => t > now - WINDOW && t <= now);
  if (recent.length < limit) return now;
  return recent[recent.length - limit] + WINDOW;
}

function grant(att, now) {
  att.granted = [...att.granted.filter(t => t > now - 24 * 3_600_000), now].slice(-50);
}

// 申請一次主動打擾。ev：{ id, kind, priority, expiresAt }（id 一樣的只排一次）
// 回傳 { granted: true } 或 { granted: false, retryAt }；沒放行的排進 queue
export function request(att, queue, ev, now, opts = {}) {
  prune(queue, now);
  // 佇列裡有更優先的在等：先讓它
  const waiting = queue.some(q => q.id !== ev.id && (q.priority ?? 0) > (ev.priority ?? 0));
  if (!waiting && canInterrupt(att, now, opts)) {
    grant(att, now);
    const i = queue.findIndex(q => q.id === ev.id);
    if (i >= 0) queue.splice(i, 1);
    return { granted: true };
  }
  const i = queue.findIndex(q => q.id === ev.id);
  const entry = { priority: 0, expiresAt: Infinity, ...ev, at: now };
  if (i >= 0) queue[i] = { ...queue[i], ...entry, at: queue[i].at };
  else queue.push(entry);
  return { granted: false, retryAt: opts.blocked ? null : nextFreeAt(att, now, opts) };
}

// 丟掉過期的
export function prune(queue, now) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].expiresAt <= now) queue.splice(i, 1);
}

// 額度空出來了：放行佇列裡最優先的一件（一樣優先就先來的先走），回傳它；沒有就回傳 null
export function drain(att, queue, now, opts = {}) {
  prune(queue, now);
  if (!queue.length || !canInterrupt(att, now, opts)) return null;
  let best = 0;
  for (let i = 1; i < queue.length; i++) {
    const a = queue[i], b = queue[best];
    if ((a.priority ?? 0) > (b.priority ?? 0) || ((a.priority ?? 0) === (b.priority ?? 0) && a.at < b.at)) best = i;
  }
  const [ev] = queue.splice(best, 1);
  grant(att, now);
  return ev;
}

// 同步：兩台電腦放行的時間合在一起（一台剛打擾過你，另一台也要知道）
export function mergeAttention(a, b) {
  const all = [...normalizeAttention(a).granted, ...normalizeAttention(b).granted];
  return { granted: [...new Set(all)].sort((x, y) => x - y).slice(-50) };
}
