// 雲端資料夾同步：使用者選一個自己的同步資料夾（Google Drive、OneDrive、Dropbox…），
// 每台電腦把存檔寫成 <資料夾>/kalos-amie/save.<裝置>.json，並讀取其他電腦的檔案合併進來。
// 不用帳號、不存 token。
//
// 為什麼不能「比時間、整份二選一」：A 電腦抓了一隻、B 電腦也抓了一隻，二選一就會吃掉一隻。
// 所以逐個欄位合併：
//   寶可夢     依 uid 取聯集；兩邊都有：取好感＋成長比較多的那份，暱稱用比較新改的
//   圖鑑       每個計數取最大、時間取最早；形態也一樣
//   感情、統計  取最大（統計不能相加，不然每次同步都會重複累加）；競爭心也取最大
//   記憶       同一隻寶可夢兩邊記得的事取聯集（依時間排序，保留上限內最新的）
//   旅行       同一隻的旅行取出發時間比較晚的；結算過的（tripsDone）不會再結算；明信片取聯集
//              禮物只在結算的那台電腦加進背包，另一台透過背包的 ledger 收到
//   獎章       聯集（時間取最早）
//   蛋         依 uid 取聯集，但已經孵化的（hatchedEggs）不會再出現
//   背包       每台電腦各自記「自己造成的變化量」（ledger），總數＝起點＋所有電腦的變化量。
//              這樣合併幾次、誰先誰後，結果都一樣，也不會把同一筆重複算進去
//   設定、同步資訊、夥伴在桌面上的位置、正在進行的專注、天氣：每台電腦各自保留，不合併

import { mergeMemory } from './memory.js';
import { mergeTrip, mergePostcards, mergeTripsDone } from './trips.js';

export const SYNC_DIR = 'kalos-amie';
export const DEVICE_RE = /^[a-z0-9]{6,32}$/;
export const fileNameFor = deviceId => `save.${deviceId}.json`;

// ---------- 背包：攤平成 'balls.poke'、'puffs.sweet-basic'、'berries.pecha' ----------
const BAG_PARTS = ['balls', 'puffs', 'berries'];
export function flattenBag(bag) {
  const out = {};
  for (const part of BAG_PARTS) for (const [k, v] of Object.entries(bag[part] ?? {})) out[`${part}.${k}`] = v;
  return out;
}
function writeFlat(bag, flat) {
  for (const [key, v] of Object.entries(flat)) {
    const [part, k] = key.split(/\.(.*)/s);
    if (BAG_PARTS.includes(part) && bag[part] && k in bag[part]) bag[part][k] = Math.max(0, Math.min(999, Math.round(v)));
  }
}
const addInto = (acc, d) => { for (const [k, v] of Object.entries(d)) acc[k] = (acc[k] ?? 0) + v; return acc; };

// 開始同步（第一台電腦）：現在的背包就是起點
export function startSync(state, { folder, deviceId }) {
  state.sync = {
    folder, deviceId, rev: 0, lastSyncedRev: 0,
    origin: flattenBag(state.bag),
    ledger: { [deviceId]: { rev: 0, delta: {} } },
    lastBag: flattenBag(state.bag),
  };
  return state;
}

// 加入已經有別台電腦在用的資料夾。
// mode 'adopt'：用資料夾裡的存檔（這台原本的進度不要了）；'merge'：兩邊合在一起（這台的背包全部加上去）
export function joinSync(state, remote, { folder, deviceId, mode }) {
  const base = mode === 'adopt' ? structuredClone(remote) : state;
  const out = mode === 'adopt' ? base : mergeShared(state, remote);
  if (mode === 'adopt') {
    out.settings = state.settings; // 設定跟位置是這台電腦自己的
    out.weather = state.weather;
    out.focus.active = state.focus.active;
    for (const m of out.mons) { m.pos = null; m.out = false; }
    const outCount = Math.min(3, out.mons.length);
    out.mons.slice(0, outCount).forEach(m => { m.out = true; });
  }
  const ledger = structuredClone(remote.sync.ledger ?? {});
  ledger[deviceId] = { rev: 0, delta: mode === 'merge' ? flattenBag(state.bag) : {} };
  out.sync = { folder, deviceId, rev: 0, lastSyncedRev: 0, origin: { ...remote.sync.origin }, ledger, lastBag: {} };
  applyLedger(out);
  return out;
}

// 同步前：把這台電腦上次同步之後造成的背包變化記進自己的 ledger
export function recordLocalDelta(state) {
  const sync = state.sync;
  const now = flattenBag(state.bag);
  const mine = (sync.ledger[sync.deviceId] ??= { rev: 0, delta: {} });
  for (const [k, v] of Object.entries(now)) {
    const d = v - (sync.lastBag[k] ?? v);
    if (d) mine.delta[k] = (mine.delta[k] ?? 0) + d;
  }
  mine.rev++;
  sync.rev = mine.rev;
  sync.lastBag = now;
  return state;
}

// 背包＝起點＋所有電腦的變化量
export function applyLedger(state) {
  const sync = state.sync;
  const total = { ...sync.origin };
  for (const { delta } of Object.values(sync.ledger)) addInto(total, delta);
  writeFlat(state.bag, total);
  sync.lastBag = flattenBag(state.bag);
  return state;
}

// ---------- 合併共用的部分（兩邊對調結果一樣；同一份合併兩次跟一次一樣） ----------
const byUid = list => new Map(list.map(x => [x.uid, x]));
const minTime = (a, b) => (a == null ? b ?? null : b == null ? a : Math.min(a, b));
const maxDay = (a, b) => (!a ? b ?? null : !b ? a : a > b ? a : b);
const score = m => (m.affection ?? 0) + (m.xp ?? 0);

function mergeMon(a, b) {
  // 兩邊都有：取「好感＋成長」比較多的那份（進化、特訓也跟著），暱稱用比較新改的
  const [win, lose] = score(a) > score(b) || (score(a) === score(b) && JSON.stringify(a) >= JSON.stringify(b)) ? [a, b] : [b, a];
  const m = structuredClone(win);
  const nickFrom = (lose.nicknameAt ?? 0) > (win.nicknameAt ?? 0) ? lose : win;
  m.nickname = nickFrom.nickname;
  m.nicknameAt = nickFrom.nicknameAt ?? null;
  m.tasteKnown = a.tasteKnown || b.tasteKnown;
  m.memory = mergeMemory(a.memory, b.memory); // 兩台電腦各自記得的事都留著
  m.trip = mergeTrip(a.trip, b.trip, new Set()); // 已經結算過的在 mergeShared 裡拿掉
  return m;
}

function mergeDexEntry(a, b) {
  if (!a || !b) return mergeDexEntry(a ?? b, a ?? b); // 只有一邊有：也整理成同樣的格式
  const e = {
    seen: Math.max(a.seen ?? 0, b.seen ?? 0),
    caught: Math.max(a.caught ?? 0, b.caught ?? 0),
    shiny: Math.max(a.shiny ?? 0, b.shiny ?? 0),
    firstSeenAt: minTime(a.firstSeenAt, b.firstSeenAt),
    firstCaughtAt: minTime(a.firstCaughtAt, b.firstCaughtAt),
  };
  const keys = new Set([...Object.keys(a.forms ?? {}), ...Object.keys(b.forms ?? {})]);
  if (keys.size) {
    e.forms = {};
    for (const k of [...keys].sort()) {
      const fa = a.forms?.[k] ?? { seen: 0, caught: 0 }, fb = b.forms?.[k] ?? { seen: 0, caught: 0 };
      e.forms[k] = { seen: Math.max(fa.seen, fb.seen), caught: Math.max(fa.caught, fb.caught) };
    }
  }
  return e;
}

const maxMap = (a = {}, b = {}) => {
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  return out;
};
const minMap = (a = {}, b = {}) => {
  const out = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) out[k] = minTime(a[k], b[k]);
  return out;
};

// local 是這台電腦的存檔（保留它自己的設定、位置…），remote 是別台的
export function mergeShared(local, remote) {
  const out = structuredClone(local);
  // 寶可夢：聯集；排序固定（依收服時間、uid），兩邊對調結果才一樣
  const la = byUid(local.mons), rb = byUid(remote.mons);
  const mons = [];
  for (const uid of new Set([...la.keys(), ...rb.keys()])) {
    const a = la.get(uid), b = rb.get(uid);
    const m = a && b ? mergeMon(a, b) : structuredClone(a ?? b);
    // 這台電腦自己的：在不在桌面上、位置
    m.out = a ? a.out : false;
    m.pos = a ? a.pos ?? null : null;
    mons.push(m);
  }
  mons.sort((x, y) => (x.caughtAt - y.caughtAt) || (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
  out.mons = mons;
  // 圖鑑
  out.dex = {};
  for (const id of [...new Set([...Object.keys(local.dex), ...Object.keys(remote.dex)])].sort((a, b) => a - b)) out.dex[id] = mergeDexEntry(local.dex[id], remote.dex[id]);
  out.bonds = maxMap(local.bonds, remote.bonds);
  out.rivalries = maxMap(local.rivalries, remote.rivalries);
  out.stats = maxMap(local.stats, remote.stats);
  out.achievements = minMap(local.achievements, remote.achievements);
  // 旅行：結算過的（任何一台）就不會再結算；明信片取聯集；去過的地點取最早
  out.tripsDone = mergeTripsDone(local.tripsDone, remote.tripsDone);
  const tripsDone = new Set(out.tripsDone);
  for (const m of out.mons) if (m.trip && tripsDone.has(m.trip.id)) m.trip = null;
  out.postcards = mergePostcards(local.postcards, remote.postcards);
  out.placesVisited = minMap(local.placesVisited, remote.placesVisited);
  out.achievementRewards = { fancy: local.achievementRewards.fancy || remote.achievementRewards.fancy, pokeBall: local.achievementRewards.pokeBall || remote.achievementRewards.pokeBall };
  out.pendingVivillon = (local.pendingVivillon.length >= remote.pendingVivillon.length ? local : remote).pendingVivillon.slice();
  // 蛋：聯集，已經孵化的不要
  out.hatchedEggs = [...new Set([...(local.hatchedEggs ?? []), ...(remote.hatchedEggs ?? [])])].sort().slice(-200);
  const done = new Set(out.hatchedEggs);
  const eggs = new Map();
  for (const e of [...local.eggs, ...remote.eggs]) {
    if (done.has(e.uid)) continue;
    const prev = eggs.get(e.uid);
    eggs.set(e.uid, prev && prev.steps >= e.steps ? prev : structuredClone(e));
  }
  out.eggs = [...eggs.values()].sort((a, b) => (a.receivedAt - b.receivedAt) || (a.uid < b.uid ? -1 : 1)).slice(0, 3);
  out.eggDay = maxDay(local.eggDay, remote.eggDay);
  // 旗標與其他
  out.starterChosen = local.starterChosen || remote.starterChosen;
  out.shinyCharm = local.shinyCharm || remote.shinyCharm;
  out.bag.items = Object.fromEntries(Object.keys({ ...local.bag.items, ...remote.bag.items }).sort().map(k => [k, Boolean(local.bag.items[k] || remote.bag.items[k])]));
  out.lastDailyGift = maxDay(local.lastDailyGift, remote.lastDailyGift);
  out.createdAt = minTime(local.createdAt, remote.createdAt);
  out.zygardeCells = Math.max(local.zygardeCells, remote.zygardeCells);
  // 連鎖：用比較晚玩的那台；一樣晚就固定取比較長的（兩邊對調結果才一樣）
  const chainKey = s => [s.lastSeenAt ?? 0, s.chain.count, s.chain.species ?? 0];
  const ka = chainKey(local), kb = chainKey(remote);
  const remoteWins = kb[0] !== ka[0] ? kb[0] > ka[0] : kb[1] !== ka[1] ? kb[1] > ka[1] : kb[2] > ka[2];
  out.chain = structuredClone(remoteWins ? remote.chain : local.chain);
  out.focus = {
    ...local.focus,
    sessions: Math.max(local.focus.sessions, remote.focus.sessions),
    totalMinutes: Math.max(local.focus.totalMinutes, remote.focus.totalMinutes),
    streakDays: (local.focus.lastDay ?? '') >= (remote.focus.lastDay ?? '') ? local.focus.streakDays : remote.focus.streakDays,
    lastDay: maxDay(local.focus.lastDay, remote.focus.lastDay),
  };
  if (local.focus.lastDay === remote.focus.lastDay) out.focus.streakDays = Math.max(local.focus.streakDays, remote.focus.streakDays);
  const mgL = local.minigames, mgR = remote.minigames;
  out.minigames = mgL.day === mgR.day
    ? { day: mgL.day, baked: Math.max(mgL.baked, mgR.baked), deluxe: Math.max(mgL.deluxe, mgR.deluxe) }
    : structuredClone((mgL.day ?? '') > (mgR.day ?? '') ? mgL : mgR);
  // 背包的 ledger：每台電腦的那一筆取 rev 比較新的
  if (local.sync && remote.sync?.ledger) {
    const ledger = structuredClone(local.sync.ledger);
    for (const [dev, entry] of Object.entries(remote.sync.ledger)) {
      if (!ledger[dev] || entry.rev > ledger[dev].rev) ledger[dev] = structuredClone(entry);
    }
    out.sync.ledger = ledger;
  }
  return out;
}

// 一次完整的同步：記下自己的變化 → 合併每一台別的電腦 → 重新算背包
export function syncStep(local, remotes) {
  let s = recordLocalDelta(structuredClone(local));
  for (const r of remotes) {
    if (!r?.sync?.deviceId || r.sync.deviceId === s.sync.deviceId) continue;
    s = mergeShared(s, r);
  }
  applyLedger(s);
  s.sync.lastSyncedRev = s.sync.rev;
  return s;
}
