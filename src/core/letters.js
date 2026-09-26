// 寶可夢寫信給你。全部在本機用範本組出來，不連網、不用 AI。
//
// 一封信＝開頭 × 為什麼寫信 × 最近發生的事（從記憶挑 1–2 件真的發生過的）× 夥伴 × 心情 × 結尾。
// 每一段都有好幾種寫法；最近 5 封用過的開頭、結尾不再用。語氣看個性：外向的熱情、膽小的害羞、貪吃的一定提到吃的。
// 信裡提到的每件事都記在 refs（對到記憶裡的事件），測試會檢查「不能編造沒發生的事」。
// 這裡不用內建亂數，也不碰畫面。
import { summary, recall } from './memory.js';
import { levels, moodOf, traitsOf, normalizeMind } from './mind.js';

const DAY = 24 * 3_600_000;
export const PER_DAY = 2;
export const INBOX_KEPT = 30;
export const DELETED_KEPT = 100; // 記住刪掉哪些信（同步時才不會從另一台電腦跑回來）
const RECENT_KEPT = 5;

export const KINDS = {
  away: { zh: '你不在的時候' },
  trip: { zh: '旅行回來' },
  birthday: { zh: '生日快樂' },
  hearts: { zh: '最喜歡你' },
  story: { zh: '故事' }, // 主線故事裡的人寄來的（core/story.js）；uid 是空的、from 是登場人物
  weekly: { zh: '這週我們一起' }, // 每週日的信（core/together.js），不佔每天 2 封的額度
};

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
// 挑一個沒在最近用過的（全部都用過了就隨便挑）
function pickFresh(list, recent, rng) {
  const fresh = list.map((_, i) => i).filter(i => !recent.includes(i));
  const pool = fresh.length ? fresh : list.map((_, i) => i);
  return pool[Math.floor(rng() * pool.length)];
}

// ---------- 範本 ----------
// 語氣：warm（外向，很多驚嘆號）、shy（膽小，很多刪節號）、plain
export const OPENINGS = {
  warm: ['嗨嗨！是我！', '你好你好！', '嘿！有收到嗎？', '哇，終於可以寫信給你了！', '你看你看，我會寫信了！', '今天也要打起精神喔！'],
  shy: ['那個……你好。', '嗯……我想寫信給你。', '……可以打擾你一下嗎？', '有點不好意思……', '偷偷寫信給你。', '……是我。'],
  plain: ['你好。', '給你的一封信。', '今天想跟你說說話。', '突然想寫信給你。', '有件事想告訴你。', '寫信給你。'],
};
export const CLOSINGS = {
  warm: ['明天也要一起玩喔！', '最喜歡你了！', '快點回來摸摸我！', '下次見！要想我喔！', '今天也謝謝你！'],
  shy: ['……那就先這樣。', '有空的話，來看看我。', '……謝謝你。', '晚安……', '不要忘記我喔……'],
  plain: ['就寫到這裡。', '下次再寫信給你。', '保重身體。', '那麼，下次見。', '謝謝你看完。'],
};

// 為什麼寫這封信（每種 3 種寫法）
const KIND_LINES = {
  away: [f => `你不在的這${f.hours}個小時，我一直在桌面上等你。`, f => `你去哪裡了？我等了${f.hours}個小時。`, f => `整整${f.hours}個小時沒看到你，好久好久。`],
  trip: [f => `我去了${f.place}，回來以後一直想告訴你。`, f => `${f.place}好好玩，可是我還是最想回來找你。`, f => `還記得我去${f.place}嗎？我把那裡的事寫下來了。`],
  birthday: [() => '今天是你的生日！生日快樂！', () => '聽說今天是特別的日子，生日快樂！', () => '祝你生日快樂！我準備了這封信當禮物。'],
  hearts: [() => '我發現我真的好喜歡你。', () => '跟你在一起的每一天都好開心。', () => '想跟你說，謝謝你一直照顧我。'],
};

// 記憶裡的事（每種 3 種寫法）；需要的欄位不在就不用那一句
const EVENT_LINES = {
  fed: [e => `你餵我的${e.data.puffZh}好好吃。`, e => `上次那個${e.data.puffZh}，我到現在還記得味道。`, e => `謝謝你請我吃${e.data.puffZh}。`],
  stroked: [() => '你摸我頭的時候，我好開心。', () => '被你摸摸是我最喜歡的事。', () => '還想要你再摸摸我。'],
  'played-with': [e => `我跟${e.data.name}一起玩了。`, e => `${e.data.name}陪我玩了好久。`, e => `今天和${e.data.name}玩得好開心。`],
  won: [e => `我切磋贏了${e.data.name}喔！`, e => `跟${e.data.name}切磋，我贏了！`, e => `${e.data.name}輸給我了，嘿嘿。`],
  lost: [e => `${e.data.name}又贏了我，下次一定要贏回來。`, e => `切磋輸給了${e.data.name}，好不甘心。`, e => `我要多練習，才能打贏${e.data.name}。`],
  tripped: [() => '我跌倒了一次，不過不痛。', () => '走路的時候摔了一跤，有點丟臉。', () => '跌倒的時候，好希望你在旁邊。'],
  'caught-new': [e => `新朋友${e.data.name}來了，好熱鬧。`, e => `${e.data.name}加入我們了！`, e => `我多了一個朋友，叫${e.data.name}。`],
  'user-away': [e => `上次等你等了${e.data.hours}個小時。`, e => `你離開的那${e.data.hours}個小時，我好想你。`, e => `我記得有一次你離開了${e.data.hours}個小時。`],
  'user-back': [() => '你回來的時候，我開心得跳起來。', () => '看到你回來，我就放心了。', () => '你回來了真好。'],
  trip: [e => `${e.data.name}的風景好漂亮。`, e => `我在${e.data.name}看到好多沒看過的東西。`, e => `下次也想帶你去${e.data.name}。`],
  'cursor-surprised': [() => '坐在箭頭旁邊的時候，它突然跑掉，嚇了我一跳！', () => '那個箭頭好調皮，一直跑來跑去。', () => '下次我一定要抓到那個箭頭。'],
  'saw-peeker': [e => `我看到${e.data.name}從螢幕邊邊偷看。`, e => `有一隻${e.data.name}在外面探頭探腦。`, e => `外面好像有${e.data.name}，好想跟牠玩。`],
};
const NEEDS_FIELD = { fed: 'puffZh', 'played-with': 'name', won: 'name', lost: 'name', 'caught-new': 'name', 'user-away': 'hours', trip: 'name', 'saw-peeker': 'name' };

// 心情（每種 3 種寫法）
const MOOD_LINES = {
  happy: ['我現在心情很好。', '最近每天都好開心。', '今天的我充滿精神！'],
  calm: ['最近過得很平靜。', '我在桌面上慢慢地過日子。', '日子很普通，但我很喜歡。'],
  lonely: ['有時候會覺得有點寂寞。', '好想有人陪我玩。', '一個人的時候，會想起你。'],
  bored: ['最近有點無聊。', '好想找點好玩的事做。', '每天都差不多，想要一點新鮮事。'],
  sleepy: ['我現在好睏……', '寫著寫著就想睡了。', '眼睛快要閉起來了……'],
  grumpy: ['老實說，我現在有點不高興。', '今天有點鬧彆扭。', '心情不太好，你來安慰我好不好。'],
};
const FOOD_LINES = ['對了，下次可以再給我泡芙嗎？', '寫到這裡，肚子又餓了。', '好想吃甜甜的泡芙喔。'];

export function toneOf(traits) {
  if (traits.timid >= 0.6) return 'shy';
  if (traits.outgoing >= 0.65) return 'warm';
  return 'plain';
}

// ---------- 寫一封信 ----------
// ctx：{ name, speciesZh, friend: { name } | null, rival: { name } | null, place, hours, now }
// recent：{ open: [...], close: [...] }（最近用過的開頭、結尾）
export function writeLetter(mon, kind, rng, ctx = {}, recent = { open: [], close: [] }) {
  const mind = normalizeMind(mon.mind);
  const traits = traitsOf(mon.nature);
  const tone = toneOf(traits);
  const now = ctx.now ?? 0;
  const parts = [];
  const refs = [];
  const openIdx = pickFresh(OPENINGS[tone], recent.open ?? [], rng);
  parts.push(OPENINGS[tone][openIdx]);
  if (ctx.holiday) parts.push(ctx.holiday); // 節日那天多一句（core/calendar.js 的 letter）
  // 為什麼寫信：需要的資料不在就換成一般的寫法
  const kf = { hours: ctx.hours, place: ctx.place };
  const kindOk = kind === 'away' ? Number.isFinite(kf.hours) : kind === 'trip' ? Boolean(kf.place) : true;
  if (KIND_LINES[kind] && kindOk) parts.push(pick(KIND_LINES[kind], rng)(kf));
  // 最近發生的事：記憶裡最重要的 1–2 件（不重複提同一種）
  const mem = summary(mon.memory ?? [], now, 6).map(s => (mon.memory ?? []).find(e => e.k === s.k && e.at === s.at)).filter(Boolean);
  const used = new Set();
  for (const e of mem) {
    if (refs.length >= 2) break;
    if (used.has(e.k) || !EVENT_LINES[e.k]) continue;
    const need = NEEDS_FIELD[e.k];
    if (need && (e.data?.[need] == null || e.data[need] === '')) continue;
    if ((kind === 'away' && e.k === 'user-away') || (kind === 'trip' && e.k === 'trip')) continue; // 已經在上面講過了
    used.add(e.k);
    parts.push(pick(EVENT_LINES[e.k], rng)(e));
    refs.push({ k: e.k, at: e.at });
  }
  // 夥伴：競爭對手或好朋友（有的話）
  if (ctx.rival?.name && !used.has('lost') && !used.has('won') && rng() < 0.6) parts.push(`${ctx.rival.name}是我的對手，我不會輸的！`);
  else if (ctx.friend?.name && rng() < 0.6) parts.push(pick([`我跟${ctx.friend.name}感情最好了。`, `${ctx.friend.name}常常陪我。`, `你也要對${ctx.friend.name}好喔。`], rng));
  // 心情
  const lost = recall(mon.memory ?? [], { k: 'lost', since: now - 10 * 60_000 }).length > 0;
  parts.push(pick(MOOD_LINES[moodOf(levels(mind, mon), { lostRecently: lost })], rng));
  if (traits.greedy >= 0.6) parts.push(pick(FOOD_LINES, rng)); // 貪吃的一定會提到吃的
  const closeIdx = pickFresh(CLOSINGS[tone], recent.close ?? [], rng);
  // 排版：開頭一行、中間一段、結尾一行
  const head = ctx.holiday ? `${parts[0]}${parts[1]}` : parts[0];
  let text = [head, parts.slice(ctx.holiday ? 2 : 1).join(''), CLOSINGS[tone][closeIdx]].join('\n\n');
  // 保險：萬一有東西沒代入成功，就只留一定安全的部分
  if (/undefined|null|NaN|[{}]/.test(text)) text = [OPENINGS[tone][openIdx], MOOD_LINES.calm[0], CLOSINGS[tone][closeIdx]].join('\n\n');
  return { text, refs, tone, openIdx, closeIdx };
}

// ---------- 信箱 ----------
// state.letters = { inbox: [{ id, uid, name, species, kind, at, text, refs, opened }], pending: [{ key, kind, uid, due, data }],
//                   day, sent（今天寄了幾封）, recent: { open, close }, birthdayYear }
export function defaultLetters() {
  return { inbox: [], pending: [], deleted: [], day: null, sent: 0, recent: { open: [], close: [] }, birthdayYear: null };
}

export function normalizeLetters(raw) {
  const d = defaultLetters();
  if (!raw || typeof raw !== 'object') return d;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  d.inbox = (Array.isArray(raw.inbox) ? raw.inbox : [])
    .filter(l => l && typeof l.id === 'string' && KINDS[l.kind] && Number.isFinite(l.at) && typeof l.text === 'string')
    .map(l => ({
      id: l.id.slice(0, 60), uid: str(l.uid, 40), name: str(l.name, 12), species: Number.isInteger(l.species) ? l.species : 0,
      kind: l.kind, at: l.at, text: l.text.slice(0, 600), opened: Boolean(l.opened), ...(typeof l.from === 'string' ? { from: l.from.slice(0, 20) } : {}),
      refs: (Array.isArray(l.refs) ? l.refs : []).filter(r => r && typeof r.k === 'string' && Number.isFinite(r.at)).slice(0, 3).map(r => ({ k: r.k.slice(0, 24), at: r.at })),
    }))
    .sort((a, b) => a.at - b.at)
    .slice(-INBOX_KEPT);
  d.pending = (Array.isArray(raw.pending) ? raw.pending : [])
    .filter(p => p && KINDS[p.kind] && typeof p.uid === 'string' && Number.isFinite(p.due) && typeof p.key === 'string')
    .map(p => ({ key: p.key.slice(0, 80), kind: p.kind, uid: p.uid.slice(0, 40), due: p.due, data: p.data && typeof p.data === 'object' ? { place: str(p.data.place, 20) || undefined, hours: Number.isFinite(p.data.hours) ? p.data.hours : undefined } : {} }))
    .slice(0, 10);
  d.day = typeof raw.day === 'string' ? raw.day.slice(0, 10) : null;
  d.sent = Number.isInteger(raw.sent) ? Math.max(0, Math.min(PER_DAY, raw.sent)) : 0;
  const idx = a => (Array.isArray(a) ? a : []).filter(Number.isInteger).slice(-RECENT_KEPT);
  d.recent = { open: idx(raw.recent?.open), close: idx(raw.recent?.close) };
  d.birthdayYear = Number.isInteger(raw.birthdayYear) ? raw.birthdayYear : null;
  d.deleted = (Array.isArray(raw.deleted) ? raw.deleted : []).filter(id => typeof id === 'string').map(id => id.slice(0, 80)).slice(-DELETED_KEPT);
  const gone = new Set(d.deleted);
  d.inbox = d.inbox.filter(l => !gone.has(l.id));
  return d;
}

// 排一封信（同一個 key 不會排兩次）
export function queue(letters, { kind, uid, due, data = {}, key }) {
  if (letters.pending.some(p => p.key === key) || letters.inbox.some(l => l.id === key) || letters.deleted?.includes(key)) return false;
  letters.pending.push({ key, kind, uid, due, data });
  letters.pending.sort((a, b) => a.due - b.due || (a.key < b.key ? -1 : 1));
  letters.pending = letters.pending.slice(0, 10);
  return true;
}

// 明天早上 9 點（旅行回來「隔天」的信）
export function nextMorning(now) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export const localDay = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 生日（'MM-DD'）是今天嗎
export const isBirthday = (birthday, now) => typeof birthday === 'string' && /^\d{2}-\d{2}$/.test(birthday) && localDay(now).slice(5) === birthday;

// 同步：信件、待寄的信取聯集；打開過的算打開過；今天寄了幾封取最大
export function mergeLetters(a, b) {
  const out = defaultLetters();
  const inbox = new Map();
  for (const l of [...(a?.inbox ?? []), ...(b?.inbox ?? [])]) {
    const prev = inbox.get(l.id);
    inbox.set(l.id, prev ? { ...prev, opened: prev.opened || l.opened } : structuredClone(l));
  }
  // 刪掉的信：兩邊的聯集（另一台電腦還留著也不會再跑回來）
  out.deleted = [...new Set([...(a?.deleted ?? []), ...(b?.deleted ?? [])])].slice(-DELETED_KEPT);
  const gone = new Set(out.deleted);
  out.inbox = [...inbox.values()].filter(l => !gone.has(l.id)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(-INBOX_KEPT);
  const delivered = new Set([...out.inbox.map(l => l.id), ...gone]);
  const pend = new Map();
  for (const p of [...(a?.pending ?? []), ...(b?.pending ?? [])]) if (!delivered.has(p.key) && !pend.has(p.key)) pend.set(p.key, structuredClone(p));
  out.pending = [...pend.values()].sort((x, y) => x.due - y.due || (x.key < y.key ? -1 : 1)).slice(0, 10);
  const days = [a?.day, b?.day].filter(Boolean).sort();
  out.day = days.at(-1) ?? null;
  out.sent = Math.max(a?.day === out.day ? a.sent : 0, b?.day === out.day ? b.sent : 0);
  out.recent = structuredClone(a?.recent ?? out.recent);
  out.birthdayYear = Math.max(a?.birthdayYear ?? -1, b?.birthdayYear ?? -1);
  if (out.birthdayYear < 0) out.birthdayYear = null;
  return out;
}

export { DAY };
