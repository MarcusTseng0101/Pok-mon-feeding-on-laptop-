// 記憶：每一隻寶可夢記得發生過的事（被餵、被摸、跟誰玩、輸給誰…）。
// 用在想法的理由、之後的信件和旅行日記。每隻最多 MAX_EVENTS 則，越舊、越不重要的越先忘記。
// 這裡不用內建亂數，也不碰畫面。

export const MAX_EVENTS = 40;
const HALF_LIFE_H = 72; // 重要度三天減半（猜的，可以調）

// 每一種事件的重要度（1–5）與描述（給摘要、信件用）
export const EVENT_KINDS = {
  fed: { w: 2, zh: e => `你餵了我${e.data?.puffZh ?? '泡芙'}` },
  stroked: { w: 1, zh: () => '你摸了摸我' },
  'played-with': { w: 2, zh: e => `跟${e.data?.name ?? '朋友'}一起玩` },
  won: { w: 3, zh: e => `切磋贏了${e.data?.name ?? '對手'}` },
  lost: { w: 3, zh: e => `切磋輸給了${e.data?.name ?? '對手'}` },
  tripped: { w: 1, zh: () => '跌倒了' },
  'caught-new': { w: 3, zh: e => `新朋友${e.data?.name ?? ''}來了` },
  'user-away': { w: 4, zh: e => `等你等了${e.data?.hours ?? '好幾'}個小時` },
  'user-back': { w: 2, zh: () => '你回來了' },
};

const clampText = v => (typeof v === 'string' ? v.slice(0, 24) : undefined);

// 事件：{ k, at, with?, data? }；with 是對方的 uid
export function normalizeMemory(list) {
  return (Array.isArray(list) ? list : [])
    .filter(e => e && EVENT_KINDS[e.k] && Number.isFinite(e.at))
    .map(e => {
      const out = { k: e.k, at: e.at };
      if (typeof e.with === 'string') out.with = e.with.slice(0, 40);
      if (e.data && typeof e.data === 'object') {
        const d = {};
        for (const key of ['name', 'puffZh']) { const v = clampText(e.data[key]); if (v) d[key] = v; }
        if (Number.isFinite(e.data.hours)) d.hours = Math.max(0, Math.round(e.data.hours));
        if (Object.keys(d).length) out.data = d;
      }
      return out;
    })
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_EVENTS);
}

export function score(e, now) {
  const ageH = Math.max(0, now - e.at) / 3_600_000;
  return EVENT_KINDS[e.k].w * Math.pow(0.5, ageH / HALF_LIFE_H);
}

// 同一件事短時間內重複（例如連續摸 10 下）只記一次
const MERGE_WINDOW = 10 * 60 * 1000;

export function remember(list, event, now) {
  if (!EVENT_KINDS[event.k]) return list;
  const e = { ...event, at: now };
  const last = [...list].reverse().find(x => x.k === e.k && x.with === e.with);
  if (last && now - last.at < MERGE_WINDOW) {
    last.at = now;
    if (e.data) last.data = e.data;
    return list;
  }
  list.push(e);
  if (list.length > MAX_EVENTS) {
    // 忘掉分數最低的（越舊、越不重要）
    let worst = 0;
    for (let i = 1; i < list.length; i++) if (score(list[i], now) < score(list[worst], now)) worst = i;
    list.splice(worst, 1);
  }
  return list;
}

// filter：{ k, with, since }（都可以不給）
export function recall(list, { k, with: w, since = -Infinity } = {}) {
  return list.filter(e => (!k || (Array.isArray(k) ? k.includes(e.k) : e.k === k)) && (!w || e.with === w) && e.at >= since);
}

// 最重要的幾件事，用一句話描述（信件、日記用）
export function summary(list, now, n = 5) {
  return [...list]
    .sort((a, b) => score(b, now) - score(a, now) || b.at - a.at)
    .slice(0, n)
    .map(e => ({ k: e.k, at: e.at, text: EVENT_KINDS[e.k].zh(e) }));
}

// 同步：兩邊的記憶取聯集（同一件事＝同樣的 k、at、with）
export function mergeMemory(a = [], b = []) {
  const key = e => `${e.k}|${e.at}|${e.with ?? ''}`;
  const map = new Map();
  for (const e of [...a, ...b]) if (!map.has(key(e))) map.set(key(e), e);
  return normalizeMemory([...map.values()].sort((x, y) => x.at - y.at || (key(x) < key(y) ? -1 : 1)));
}
