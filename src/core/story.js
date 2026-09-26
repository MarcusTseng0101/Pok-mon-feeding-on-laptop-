// 主線故事：X・Y 的主線節點，改成發生在你的桌面上。
// 完全照真實時間：從序章那天算起，第 N 天發生第 N 天的事（不用達成條件）。
// 錯過的（電腦沒開）會在下次打開時一件一件補上，兩件之間至少隔 GAP_MS。
// 對話都是重新寫的，沒有照抄遊戲台詞。
//
// 事件的種類：
//   call       全息投影通訊器打來（左下角的藍色投影）
//   broadcast  全息投影廣播：桌面中間變暗，投影在正中間
//   letter     寄到信箱的信
//   visit      有人站在秘密基地旁邊，點他才開始對話

export const DAY = 86_400_000;
export const GAP_MS = 10 * 60_000; // 補上錯過的事件時，兩件之間至少隔 10 分鐘
export const LOG_KEPT = 80;

// 登場人物：sprites＝Pokémon Showdown 訓練家圖的檔名（依序試，都失敗就用剪影）；color＝投影和剪影的顏色
export const CAST = {
  sycamore: { zh: '布拉塔諾博士', sprites: ['sycamore'], color: '#4a8ad8' },
  shauna: { zh: '莎娜', sprites: ['shauna'], color: '#ff7eb0' },
  tierno: { zh: '蒂艾爾諾', sprites: ['tierno'], color: '#f0a030' },
  trevor: { zh: '特雷維', sprites: ['trevor'], color: '#5ab04a' },
  lysandre: { zh: '弗拉達利', sprites: ['lysandre', 'lysandre-masters'], color: '#e8402a' },
  az: { zh: 'AZ', sprites: ['az'], color: '#8a7aa8' },
};

// 版本：序章的問題決定（哲爾尼亞斯／伊裴爾塔爾）
export const VERSIONS = { x: { zh: 'X', legend: 716 }, y: { zh: 'Y', legend: 717 } };

// 事件（依 day 排序）。lines：[說話的人, 台詞]；choice：最後問一個問題
export const EVENTS = [
  {
    id: 'prologue', day: 0, kind: 'call', title: '序章：全息投影通訊器',
    lines: [
      ['sycamore', '喂？聽得到嗎？太好了，全息投影通訊器接通了！'],
      ['sycamore', '我是卡洛斯地區的寶可夢博士，布拉塔諾。聽說有一群寶可夢住在你的桌面上──這可是前所未見的研究題目！'],
      ['sycamore', '寶可夢和人一起生活久了，會發生一種很特別的變化。我一直在研究它……不過那個以後再說。'],
      ['sycamore', '先問你一個問題，就當作是研究紀錄吧。'],
    ],
    choice: {
      key: 'version',
      ask: ['sycamore', '如果你能得到一種永遠不會消失的力量，你會想要──'],
      options: [
        { value: 'x', text: '讓生命誕生、延續下去的力量', reply: '給予生命的力量啊……很像你會說的話。' },
        { value: 'y', text: '讓一切結束、重新開始的力量', reply: '結束也是開始的一部分。很有意思的回答！' },
      ],
    },
    after: [['sycamore', '對了，我有幾個學生也在旅行，改天介紹給你認識。桌面上的研究就拜託你了！']],
  },
  {
    id: 'friends', day: 1, kind: 'call', title: '新朋友',
    lines: [
      ['shauna', '哈囉～！博士說有人在桌面上養寶可夢，就是你對吧！我是莎娜！'],
      ['tierno', '我是蒂艾爾諾！你的寶可夢會跳舞嗎？放音樂的時候我的都會跟著扭喔！'],
      ['trevor', '我、我是特雷維……我在做圖鑑。你那邊如果看到沒見過的寶可夢，可以告訴我嗎？'],
      ['shauna', '我們接下來要去挑戰道館！等你的夥伴準備好了，也一起來嘛～'],
    ],
  },
  {
    id: 'lysandre-broadcast-1', day: 5, kind: 'broadcast', title: '奇怪的廣播',
    lines: [
      ['lysandre', '卡洛斯的各位，午安。我是弗拉達利。'],
      ['lysandre', '這個世界很美。美到讓人不忍心看它被弄髒。'],
      ['lysandre', '人越來越多，能分的東西卻越來越少。總有一天，得有人做出選擇。'],
      ['lysandre', '……不小心說太多了。祝你和你的寶可夢，今天也過得美好。'],
    ],
  },
  {
    id: 'az-visit', day: 9, kind: 'visit', title: '高大的旅人',
    lines: [
      ['az', '……這個地方，有花的味道。'],
      ['az', '很久以前，我也有一個像這樣的地方。還有一個……很小的朋友。'],
      ['az', '你的寶可夢在你身邊笑得很開心。要好好珍惜。'],
      ['az', '如果你看到一朵不會凋謝的花……不，沒什麼。打擾了。'],
    ],
  },
  {
    id: 'lysandre-letter', day: 11, kind: 'letter', title: '弗拉達利的信', from: 'lysandre',
    text: [
      '致 桌面上的訓練家：',
      '',
      '前幾天的廣播，聽說讓一些人感到不安，在此向你致歉。',
      '我想你應該懂：真正美好的東西，數量總是有限的。花園裡的雜草長得太多，最漂亮的花也會枯萎。',
      '所以，園丁總得有一天拿起剪刀。',
      '',
      '祝你的夥伴們一切安好。',
    ].join('\n'),
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map(e => [e.id, e]));

// ---------- 存檔 ----------
export function defaultStory() {
  return { startedAt: null, version: null, done: [], log: [], lastAt: 0 };
}

export function normalizeStory(raw) {
  const d = defaultStory();
  if (!raw || typeof raw !== 'object') return d;
  d.startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : null;
  d.version = raw.version === 'x' || raw.version === 'y' ? raw.version : null;
  d.done = [...new Set((Array.isArray(raw.done) ? raw.done : []).filter(id => typeof id === 'string' && EVENT_BY_ID[id]))];
  d.log = (Array.isArray(raw.log) ? raw.log : [])
    .filter(e => e && typeof e.id === 'string' && EVENT_BY_ID[e.id] && Number.isFinite(e.at))
    .map(e => ({ id: e.id, at: e.at }))
    .sort((a, b) => a.at - b.at)
    .slice(-LOG_KEPT);
  d.lastAt = Number.isFinite(raw.lastAt) ? raw.lastAt : 0;
  return d;
}

// 同步：開始的時間取早的；做過的取聯集；版本取先做序章的那一邊
export function mergeStory(a, b) {
  const A = normalizeStory(a), B = normalizeStory(b);
  const out = defaultStory();
  const starts = [A.startedAt, B.startedAt].filter(v => v !== null);
  out.startedAt = starts.length ? Math.min(...starts) : null;
  const pro = s => s.log.find(e => e.id === 'prologue')?.at ?? Infinity;
  out.version = (pro(A) <= pro(B) ? A.version ?? B.version : B.version ?? A.version) ?? null;
  out.done = EVENTS.map(e => e.id).filter(id => A.done.includes(id) || B.done.includes(id));
  const log = new Map();
  for (const e of [...A.log, ...B.log]) if (!log.has(e.id) || log.get(e.id).at > e.at) log.set(e.id, { ...e });
  out.log = [...log.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(-LOG_KEPT);
  out.lastAt = Math.max(A.lastAt, B.lastAt);
  return out;
}

// ---------- 時間 ----------
// 從序章那天算起的第幾天（照當地的日曆日，不是 24 小時）
export function storyDay(story, now) {
  if (story.startedAt === null) return 0;
  const a = new Date(story.startedAt), b = new Date(now);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()), db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((db - da) / DAY));
}

// 下一件該發生的事；還沒到、或跟上一件隔不到 GAP_MS 就回傳 null。force：開發用，不看日子
export function nextDue(story, now, { force = false } = {}) {
  const next = EVENTS.find(e => !story.done.includes(e.id));
  if (!next) return null;
  if (force) return next;
  if (story.startedAt === null) return next.id === 'prologue' ? next : null;
  if (storyDay(story, now) < next.day) return null;
  if (now - story.lastAt < GAP_MS) return null;
  return next;
}

// 下一件事還要幾天（故事頁用；不劇透是什麼事）
export function daysUntilNext(story, now) {
  const next = EVENTS.find(e => !story.done.includes(e.id));
  if (!next) return null;
  return Math.max(0, next.day - storyDay(story, now));
}

export function markDone(story, id, now, { choice } = {}) {
  if (!EVENT_BY_ID[id] || story.done.includes(id)) return false;
  if (story.startedAt === null) story.startedAt = now;
  story.done.push(id);
  story.log = [...story.log, { id, at: now }].slice(-LOG_KEPT);
  story.lastAt = now;
  if (id === 'prologue' && (choice === 'x' || choice === 'y')) story.version = choice;
  return true;
}
