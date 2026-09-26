// 共生：你好好生活，就是在養牠們。
//
// 「你的生活怎麼影響牠們」只在這裡決定：輸入訊號和時間，輸出事件；畫面（director.js）只負責演出事件，
// 真正加在寶可夢身上的數值由 Game.lifeTick() 透過既有的 amie／mindDelta 加上去，renderer 不改數值。
//
// 四件事：
//   休息的果實：連續用電腦 90 分鐘（中間離開不到 3 分鐘都算連續） → 夥伴把一顆樹果放在游標附近，坐在旁邊等（不出聲、不跳通知）。
//               你真的離開一下（閒置 3 分鐘）→ 牠們分著吃掉。沒離開就一直放著，不催、不變多。
//   桌面的生氣：今天做到的好事（LINKS）有幾件 → 桌面下緣的花草 0～3 級；隔天留下一朵小花，最多 7 朵
//   一起累：前一天最後一次用電腦過了 01:00 → 隔天早上夥伴走慢一點、打哈欠，到中午恢復。只影響演出（見 F1）
//   你出現了：每天第一次看到你 → 夥伴的成長加一點點（不用點任何東西）
//
// 從你的行為來的效果只加不減：熬夜不扣任何數值、不寫進記憶、沒有責怪的文字。
// 這裡不用內建亂數、不讀時鐘：時間一律由參數 now 提供（測試要能重現）。
import { routineDay, minuteOf, lateAfter, LATE_FALLBACK } from './routine.js';

export const FRUIT_AFTER = 90 * 60; // 連續操作幾秒給果實（猜的，可調整）
export const BREAK_IDLE = 180; // 閒置幾秒算「離開了一下」（猜的，可調整）
export const FRUITS_PER_DAY = 4; // 一天最多幾顆（猜的，可調整）
// 一顆果實大約是一個普通泡芙的一半（泡芙：飽足 40、好感 3、成長 4），整群分著吃，每隻都拿到這麼多（猜的，可調整）
export const FRUIT_GAIN = { fullness: 20, enjoyment: 10, affection: 1.5, xp: 2 };
export const PRESENCE_XP = 2; // 每天第一次看到你（猜的，可調整）
export const TIRED_UNTIL = 12 * 60 - 5 * 60; // 作息日的第幾分鐘以前還在累（12:00）
export const FLOWERS_KEPT = 7;
export const FRUIT_BERRIES = ['pecha', 'chesto', 'aspear', 'rawst', 'cheri']; // 畫面上的樣子（用現有的 art.berries），跟數值無關

// 今天做到的好事：每一列一件，做到幾件，花草就長到幾級。
// 要加新的連結（例如「你喝水了」）：加一列，再讓 Game 在那件事發生時呼叫 mark(sym, now, id)。
export const LINKS = [
  { id: 'rest', zh: '有休息' },
  { id: 'focus', zh: '完成一次專注' },
  { id: 'sleep', zh: '昨天準時睡' },
];
export const MAX_BLOOM = LINKS.length;

// ---------- 存檔 ----------
// days：{ 作息日: { fruits, rest, focus, sleep, seen } }；fruit：畫面上等著被吃的那一顆（同時只有一顆）
// flowers：過去每天留下的小花 [{ day, level }]；tiredDay：哪一個作息日的早上在累
export function defaultSymbiosis() {
  return { days: {}, fruit: null, flowers: [], tiredDay: null };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_KEPT = 14;
const bool = v => v === true;
function normalizeDay(d) {
  return {
    fruits: Math.max(0, Math.min(FRUITS_PER_DAY, Math.floor(Number(d?.fruits) || 0))),
    rest: bool(d?.rest), focus: bool(d?.focus), sleep: bool(d?.sleep), seen: bool(d?.seen),
  };
}
export function normalizeSymbiosis(raw) {
  const s = defaultSymbiosis();
  if (!raw || typeof raw !== 'object') return s;
  for (const [k, d] of Object.entries(raw.days ?? {})) if (DAY_RE.test(k) && d && typeof d === 'object') s.days[k] = normalizeDay(d);
  prune(s);
  const f = raw.fruit;
  if (f && Number.isFinite(f.at)) s.fruit = { at: f.at, berry: FRUIT_BERRIES.includes(f.berry) ? f.berry : FRUIT_BERRIES[0] };
  s.flowers = (Array.isArray(raw.flowers) ? raw.flowers : [])
    .filter(f => f && DAY_RE.test(f.day) && Number.isFinite(f.level))
    .map(f => ({ day: f.day, level: Math.max(1, Math.min(MAX_BLOOM, Math.round(f.level))) }));
  s.flowers = dedupeFlowers(s.flowers);
  s.tiredDay = typeof raw.tiredDay === 'string' && DAY_RE.test(raw.tiredDay) ? raw.tiredDay : null;
  return s;
}
function prune(s) {
  const keys = Object.keys(s.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAYS_KEPT))) delete s.days[k];
}
function dedupeFlowers(list) {
  const by = new Map();
  for (const f of list) if (!by.has(f.day) || by.get(f.day).level < f.level) by.set(f.day, f);
  return [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-FLOWERS_KEPT);
}

// 同步：兩台電腦同一次離開都會算到，所以同一天取最大值，不要相加（F6）
export function mergeSymbiosis(a, b) {
  const A = normalizeSymbiosis(a), B = normalizeSymbiosis(b), out = defaultSymbiosis();
  for (const k of new Set([...Object.keys(A.days), ...Object.keys(B.days)])) {
    const x = A.days[k] ?? normalizeDay(null), y = B.days[k] ?? normalizeDay(null);
    out.days[k] = { fruits: Math.max(x.fruits, y.fruits), rest: x.rest || y.rest, focus: x.focus || y.focus, sleep: x.sleep || y.sleep, seen: x.seen || y.seen };
  }
  prune(out);
  out.fruit = A.fruit ?? null; // 畫面上的果實是這台電腦自己的
  out.flowers = dedupeFlowers([...A.flowers, ...B.flowers]);
  out.tiredDay = [A.tiredDay, B.tiredDay].filter(Boolean).sort().pop() ?? null;
  return out;
}

// ---------- 查詢 ----------
const dayRec = (s, day) => (s.days[day] ??= normalizeDay(null));
export const bloomOf = rec => (rec ? LINKS.filter(l => rec[l.id]).length : 0);
export const bloomToday = (s, now) => bloomOf(s.days[routineDay(now)]);
export const fruitsToday = (s, now) => s.days[routineDay(now)]?.fruits ?? 0;
// 現在夥伴是不是還在累（只影響走路和打哈欠）
export const isTired = (s, now) => s.tiredDay === routineDay(now) && minuteOf(now) < TIRED_UNTIL;
// 桌面上的小花：今天以前的（今天的長在花草裡）
export const pastFlowers = (s, now) => s.flowers.filter(f => f.day < routineDay(now));

// 標記今天做到了一件好事（LINKS 的 id）。花草長了就回傳新的等級，否則 null
export function mark(s, now, id) {
  if (!LINKS.some(l => l.id === id)) return null;
  const day = routineDay(now), rec = dayRec(s, day);
  if (rec[id]) return null;
  const before = bloomOf(rec);
  rec[id] = true;
  keepFlower(s, day, bloomOf(rec));
  prune(s);
  const after = bloomOf(rec);
  return after > before ? after : null;
}
// 今天的花草等級同時記成「今天的小花」：隔天自然就留下來了（不用等換日的那一刻）
function keepFlower(s, day, level) {
  if (level < 1) return;
  s.flowers = dedupeFlowers([...s.flowers, { day, level }]);
}

// ---------- 每分鐘 ----------
// 「連續用電腦」自己算：系統的 activeSeconds 停 30 秒就歸零（看一段文章就沒了），
// 這裡只有真的離開 BREAK_IDLE 秒才重新算。電腦睡著、app 關掉（兩次 tick 隔超過 10 分鐘）也重新算。
// 這個不存檔（normalize 會丟掉），重開 app 從頭算，不會一打開就有果實。
const STALE_MS = 10 * 60_000;

// sig：{ idleSeconds（現在閒置幾秒：你在不在）, longestIdle（上一次 tick 以來最長的閒置秒數，畫面負責記：有沒有離開過）,
//        pets（桌面上有沒有夥伴）, busy（專注中：不放果實）}；routine：state.routine（看昨天幾點睡）
// 回傳事件（畫面照著演，Game 照著加數值）：
//   { type: 'presence' }                 今天第一次看到你
//   { type: 'tired' }                    昨天熬夜了，今天早上一起累
//   { type: 'bloom', level }             花草長了
//   { type: 'fruitOffered', berry }      放一顆果實在游標附近
//   { type: 'fruitEaten', berry }        你離開了一下，牠們把果實吃掉了
export function tick(s, now, sig = {}, routine = null, rng = null) {
  const out = [];
  const idle = Number(sig.idleSeconds) || 0, active = idle < 60, pets = sig.pets !== false, busy = Boolean(sig.busy);
  const away = Math.max(idle, Number(sig.longestIdle) || 0); // 這段時間離開最久的一次
  const day = routineDay(now), rec = dayRec(s, day);

  if (s.lastTickAt == null || now - s.lastTickAt > STALE_MS || now < s.lastTickAt) s.streakFrom = null;
  s.lastTickAt = now;
  if (away >= BREAK_IDLE) s.streakFrom = null;
  else if (active && s.streakFrom == null) s.streakFrom = now;
  const streak = s.streakFrom == null ? 0 : (now - s.streakFrom) / 1000;

  if (active && !rec.seen) {
    rec.seen = true;
    out.push({ type: 'presence' });
    // 昨天（作息日）最後一次用電腦是幾點：過了 01:00 → 今天早上一起累；沒有晚於平常 → 準時睡
    const y = routine?.days?.[routineDay(now - 86_400_000)];
    if (y) {
      if (y.last >= LATE_FALLBACK && minuteOf(now) < TIRED_UNTIL) { s.tiredDay = day; out.push({ type: 'tired' }); }
      if (y.last < lateAfter(routine, now)) {
        const lv = mark(s, now, 'sleep');
        if (lv) out.push({ type: 'bloom', level: lv });
      }
    }
  }

  if (s.fruit && pets && away >= BREAK_IDLE) {
    const berry = s.fruit.berry;
    s.fruit = null;
    rec.fruits = Math.min(FRUITS_PER_DAY, rec.fruits + 1);
    out.push({ type: 'fruitEaten', berry });
    const lv = mark(s, now, 'rest');
    if (lv) out.push({ type: 'bloom', level: lv });
  } else if (!s.fruit && pets && !busy && active && streak >= FRUIT_AFTER && rec.fruits < FRUITS_PER_DAY) {
    const berry = rng ? rng.pick(FRUIT_BERRIES) : FRUIT_BERRIES[rec.fruits % FRUIT_BERRIES.length];
    s.fruit = { at: now, berry };
    out.push({ type: 'fruitOffered', berry });
  }
  prune(s);
  return out;
}
