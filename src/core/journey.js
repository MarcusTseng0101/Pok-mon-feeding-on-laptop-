// 卡洛斯旅行（手機遊戲）的規則：路線、對戰、捕獲、走路、離開再回來。純函式，時間和亂數從參數來。
// 畫面在 src/journey/，Android 外殼在 android/。桌面版的規則（encounter／capture／battle／moves／evolution）直接拿來用。
//
// 設計原則（docs/JOURNEY.md，test/journey-sim.test.js 會檢查）：
// 1. 不懲罰離開：沒有體力、連續登入、每日任務、會壞掉的東西；離開再久回來只會多東西
// 2. 每一段都有結尾：一條路線幾個格子走完就到下一個地方，隨時可以存檔關掉
// 3. 真的對戰：屬性相剋、換人、補血、等級；輸了回到上一個城鎮（夥伴、道具、徽章都不會少）
// 4. 跟生活一起：現實的時段和星期影響遇到誰；你真的走的路讓帶頭的夥伴成長、更喜歡你
import { activeModifiers, speciesWeights, rollForm } from './encounter.js';
import { catchProbability, rollCatch, fleeChance, ringBonus, BALLS } from './capture.js';
import { fighter, attack, pickFoeMove, gradeOf, HP } from './battle.js';
import { MOVES, battleMovesFor } from './moves.js';
import { checkEvolution } from './evolution.js';
import { shinyChance, advanceChain, breakChain } from './shiny.js';
import { addAffection, hearts } from './amie.js';
import { SPOTS } from './dex.js';

export const VERSION = 1;
export const STARTERS = [650, 653, 656];
export const START_LEVEL = 5;
export const PARTY_MAX = 6;
export const XP_PER_LEVEL = 8; // 跟桌面一樣（core/evolution.js）：原作的進化等級 × 8 就是要的成長
export const MAX_LEVEL = 100;
export const levelOf = mon => Math.max(1, Math.min(MAX_LEVEL, Math.floor(mon.xp / XP_PER_LEVEL)));
export const xpForLevel = lv => lv * XP_PER_LEVEL;

// ---------- 地圖 ----------
// kind：town（寶可夢中心，進來就補滿血）／route（走 nodes 格才到下一個地方）
// pool：會遇到的寶可夢（只有卡洛斯新登場的 72 種）；lv：野生的等級範圍
// trainers：固定在某一格的訓練家，打贏一次就不會再擋路（重走這條路只剩野生和撿東西）
// 物種和等級參考原作 X・Y 的同一段路，原作在這裡出現、但不是卡洛斯新登場的換成相近的 // 猜的，可調整
export const AREAS = [
  { id: 'aquacorde', zh: '亞連鎮', kind: 'town', line: '河邊的小鎮。你的旅行從這裡開始。' },
  {
    id: 'route2', zh: '2 號道路', kind: 'route', nodes: 5, lv: [3, 4], pool: [659, 661, 664],
    trainers: [{ at: 3, zh: '短褲小子 阿哲', team: [[659, 4]] }],
  },
  {
    id: 'forest', zh: '白檀森林', kind: 'route', nodes: 6, lv: [3, 5], pool: [664, 665, 661, 659],
    trainers: [{ at: 2, zh: '捕蟲少年 小嵐', team: [[664, 4], [665, 5]] }, { at: 5, zh: '迷你裙 小雅', team: [[661, 5]] }],
  },
  {
    id: 'route3', zh: '3 號道路', kind: 'route', nodes: 6, lv: [5, 7], pool: [674, 659, 661, 669, 664],
    trainers: [{ at: 3, zh: '少年 凱文', team: [[674, 6], [661, 6]] }, { at: 6, zh: '雙胞胎 小米和小麥', team: [[669, 7], [659, 7]] }],
  },
  {
    id: 'santalune', zh: '白檀市', kind: 'town', line: '花朵盛開的城市，紫羅蘭的道館在廣場旁邊。',
    gym: { leader: 'viola', zh: '道館館主 紫羅蘭', badge: 'bug', team: [[665, 10], [666, 12]] },
  },
];
export const AREA_BY_ID = Object.fromEntries(AREAS.map(a => [a.id, a]));
const areaIndex = id => AREAS.findIndex(a => a.id === id);

// 徽章（跟桌面故事的名字一樣，core/story.js 的 BADGES）
export const BADGE_ZH = { bug: '甲蟲徽章', cliff: '岩壁徽章', rumble: '格鬥徽章', plant: '綠植徽章', voltage: '電壓徽章', fairy: '妖精徽章', psychic: '精神徽章', iceberg: '冰山徽章' };

export const GYM_LINES = {
  viola: {
    intro: ['我是紫羅蘭，平常是攝影師，順便當道館館主。', '旅行到這裡的人，臉上都有很好的表情。讓我在對戰裡拍下來吧！'],
    win: ['喀嚓！就是這個表情。你們贏得很漂亮。', '這是甲蟲徽章。往下走，還有更多風景等你們。'],
    lose: ['今天的光線不太對吧？休息一下，準備好了再來。'],
  },
};

// ---------- 道具 ----------
export const ITEMS = {
  poke: { zh: '精靈球', ball: 'poke' },
  great: { zh: '超級球', ball: 'great' },
  ultra: { zh: '高級球', ball: 'ultra' },
  potion: { zh: '傷藥', heal: 40 },
  superpotion: { zh: '好傷藥', heal: 80 },
  oran: { zh: '橙橙果', heal: 25 },
};
const FIND_TABLE = [{ id: 'poke', w: 5 }, { id: 'potion', w: 4 }, { id: 'oran', w: 3 }, { id: 'great', w: 1 }]; // 路上撿到的 // 猜的，可調整
const GIFT_TABLE = [{ id: 'poke', w: 4 }, { id: 'oran', w: 4 }, { id: 'potion', w: 3 }, { id: 'great', w: 2 }, { id: 'superpotion', w: 1 }];

// ---------- 存檔 ----------
export function newJourney(now, seed = 1) {
  return {
    v: VERSION, createdAt: now, lastSeen: now, seed,
    party: [], box: [], nextUid: 1,
    bag: { poke: 5, potion: 2 },
    dex: {}, // { [species]: { seen, caught } }
    at: 'aquacorde', node: 0, // 在哪裡、這條路走到第幾格（0＝剛進來）
    lastTown: 'aquacorde',
    beaten: [], // 打贏過的訓練家／道館：'route2#3'、'gym:santalune'
    badges: [],
    chain: { species: null, count: 0 },
    steps: { raw: null, total: 0, credited: 0, day: null, today: 0 },
    stats: { battles: 0, wins: 0, caught: 0, sessions: 0 },
  };
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
function normMon(m) {
  if (!m || !Number.isFinite(m.species)) return null;
  return {
    uid: num(m.uid), species: m.species, nature: typeof m.nature === 'string' ? m.nature : 'hardy',
    xp: Math.max(0, num(m.xp, xpForLevel(START_LEVEL))), affection: Math.max(0, Math.min(255, num(m.affection))),
    hp: Math.max(0, Math.min(HP, num(m.hp, HP))), shiny: Boolean(m.shiny), form: m.form ?? null,
    nick: typeof m.nick === 'string' ? m.nick.slice(0, 12) : null, caughtAt: num(m.caughtAt), caughtIn: m.caughtIn ?? null,
  };
}

// 讀進來的存檔：缺的欄位補預設，壞掉的寶可夢丟掉（不會因為一個欄位就整個存檔讀不了）
export function normalizeJourney(raw, now) {
  const d = newJourney(now, num(raw?.seed, 1));
  if (!raw || typeof raw !== 'object') return d;
  const mons = list => (Array.isArray(list) ? list.map(normMon).filter(Boolean) : []);
  const party = mons(raw.party).slice(0, PARTY_MAX);
  const box = [...mons(raw.party).slice(PARTY_MAX), ...mons(raw.box)];
  return {
    ...d,
    createdAt: num(raw.createdAt, now), lastSeen: num(raw.lastSeen, now),
    party, box,
    nextUid: Math.max(num(raw.nextUid, 1), ...[...party, ...box].map(m => m.uid + 1)),
    bag: Object.fromEntries(Object.entries(raw.bag ?? {}).filter(([k, n]) => ITEMS[k] && Number.isFinite(n) && n > 0).map(([k, n]) => [k, Math.floor(n)])),
    dex: raw.dex && typeof raw.dex === 'object' ? raw.dex : {},
    at: AREA_BY_ID[raw.at] ? raw.at : d.at,
    node: AREA_BY_ID[raw.at]?.kind === 'route' ? Math.max(0, Math.min(AREA_BY_ID[raw.at].nodes, num(raw.node))) : 0,
    lastTown: AREA_BY_ID[raw.lastTown]?.kind === 'town' ? raw.lastTown : d.lastTown,
    beaten: Array.isArray(raw.beaten) ? raw.beaten.filter(x => typeof x === 'string') : [],
    badges: Array.isArray(raw.badges) ? raw.badges.filter(b => BADGE_ZH[b]) : [],
    chain: raw.chain?.species ? { species: raw.chain.species, count: num(raw.chain.count) } : d.chain,
    steps: { ...d.steps, ...(raw.steps ?? {}) },
    stats: { ...d.stats, ...(raw.stats ?? {}) },
  };
}

// ---------- 寶可夢 ----------
export function makeMon(state, species, { lv = START_LEVEL, nature = 'hardy', shiny = false, form = null, now = 0, area = null } = {}) {
  return { uid: state.nextUid++, species, nature, xp: xpForLevel(lv), affection: 0, hp: HP, shiny, form, nick: null, caughtAt: now, caughtIn: area };
}

const markDex = (state, species, key) => {
  const d = (state.dex[species] ??= { seen: 0, caught: 0 });
  d[key]++;
};

function receive(state, mon) {
  if (state.party.length < PARTY_MAX) state.party.push(mon);
  else state.box.push(mon);
  markDex(state, mon.species, 'caught');
}

export function chooseStarter(state, species, dex, now, rng) {
  if (state.party.length || !STARTERS.includes(species)) return null;
  const mon = makeMon(state, species, { nature: rng.pick(dex.natures).slug, now, area: 'aquacorde' });
  mon.affection = 30; // 剛認識就有一點好感 // 猜的，可調整
  markDex(state, species, 'seen');
  receive(state, mon);
  return mon;
}

export const lead = state => state.party.find(m => m.hp > 0) ?? null;
export const canFight = state => state.party.some(m => m.hp > 0);
export const healAll = state => { for (const m of state.party) m.hp = HP; };

// ---------- 地圖上移動 ----------
export const here = state => AREA_BY_ID[state.at];
export const nextArea = state => AREAS[areaIndex(state.at) + 1] ?? null;
export const prevArea = state => AREAS[areaIndex(state.at) - 1] ?? null;
// 前面的路有沒有被擋住：要打贏這個城鎮的道館才能繼續（還沒做的地方 nextArea 是 null）
export function blockedBy(state) {
  const a = here(state);
  if (a.gym && !state.beaten.includes(`gym:${a.id}`)) return 'gym';
  if (a.kind === 'route' && state.node < a.nodes) return 'route';
  return null;
}

// 到一個地方：城鎮會補血、記成「上次的城鎮」（輸了回來這裡）
export function enter(state, id, { fromEnd = false } = {}) {
  const a = AREA_BY_ID[id];
  if (!a) return null;
  state.at = id;
  state.node = a.kind === 'route' && fromEnd ? a.nodes : 0;
  if (a.kind === 'town') { state.lastTown = id; healAll(state); }
  return a;
}

export function goForward(state) {
  const n = nextArea(state);
  if (!n || blockedBy(state)) return null;
  return enter(state, n.id);
}
export function goBack(state) {
  const p = prevArea(state);
  if (!p) return null;
  return enter(state, p.id, { fromEnd: true });
}

// 現實的時段、星期 → 桌面上用的同一套「氣息」（encounter.js）
export const lifeCtx = (now, { weather = null } = {}) => {
  const d = new Date(now);
  return { hour: d.getHours(), weekday: d.getDay(), weather };
};

// 這條路上的野生寶可夢：只從 pool 裡挑，權重照桌面的規則（時段、星期、天氣、連鎖）
function rollWild(state, area, dex, rng, ctx) {
  const local = { ...dex, ids: area.pool };
  const weights = speciesWeights(ctx, { mons: state.party, dex: state.dex, chain: state.chain }, local);
  const species = rng.weighted(weights)?.id ?? rng.pick(area.pool);
  const lv = rng.int(area.lv[0], area.lv[1]);
  return {
    species, lv, hp: HP, nature: rng.pick(dex.natures).slug,
    shiny: rng.chance(shinyChance({ chain: state.chain }, species, {})),
    form: rollForm(species, ctx, rng), spot: SPOTS[dex.habitat(species)]?.zh ?? '草叢',
  };
}

export const moods = (ctx, dex) => activeModifiers(ctx, dex).map(m => m.zh);

// 往前走一格。回傳這一格發生的事：
// { kind: 'wild', wild } ｜ { kind: 'trainer', trainer } ｜ { kind: 'item', item } ｜ { kind: 'quiet' }
// 走到底以後再走＝在這條路上閒逛（wander: true）：格子不再增加，只會遇到野生的、撿到東西（想抓寶可夢、練等級的時候）
export function step(state, dex, rng, ctx) {
  const a = here(state);
  if (a.kind !== 'route' || !canFight(state)) return null;
  const wander = state.node >= a.nodes;
  if (!wander) state.node++;
  const t = wander ? null : a.trainers?.find(x => x.at === state.node && !state.beaten.includes(`${a.id}#${x.at}`));
  if (t) return { kind: 'trainer', trainer: { id: `${a.id}#${t.at}`, zh: t.zh, team: t.team } };
  const r = rng();
  if (r < 0.62) { const wild = rollWild(state, a, dex, rng, ctx); markDex(state, wild.species, 'seen'); return { kind: 'wild', wild, wander }; } // 猜的，可調整
  if (r < 0.82) { const item = rng.weighted(FIND_TABLE).id; addItem(state, item); return { kind: 'item', item, wander }; }
  return { kind: 'quiet', wander };
}

export function addItem(state, id, n = 1) {
  if (!ITEMS[id]) return;
  state.bag[id] = (state.bag[id] ?? 0) + n;
}
function takeItem(state, id) {
  if (!(state.bag[id] > 0)) return false;
  state.bag[id]--;
  if (!state.bag[id]) delete state.bag[id];
  return true;
}

// ---------- 對戰 ----------
// 等級讓攻擊和耐打一起變強；只看比例，所以同等級打起來跟桌面的故事對戰一樣 // 猜的，可調整
export const levelScale = lv => 0.6 + lv * 0.04;
// 對手的強度：桌面的故事對戰是一場定勝負，這裡血會一路帶著走，所以路上的野生和訓練家比道館弱很多（原作也是這樣）
// atk 乘在攻擊上、bulk 乘在耐打上 // 猜的，可調整（test/journey-sim.test.js 會檢查難度在範圍內）
export const FOE_POWER = { wild: { atk: 0.45, bulk: 0.7 }, trainer: { atk: 0.55, bulk: 0.8 }, gym: { atk: 0.8, bulk: 1 } };

function toFighter(dex, mon, side, kind = 'wild') {
  const s = dex.get(mon.species);
  const f = fighter({ uid: mon.uid ?? null, species: mon.species, types: s.types, side, hearts: side === 'you' ? hearts(mon.affection) : 0, grade: gradeOf(dex, mon.species) });
  const k = levelScale(levelOf(mon));
  const p = side === 'foe' ? FOE_POWER[kind] : { atk: 1, bulk: 1 };
  f.atk *= k * p.atk;
  f.bulk *= k * p.bulk;
  f.hp = mon.hp;
  f.lv = levelOf(mon);
  f.moves = battleMovesFor(dex, mon.species, side === 'you' ? mon : null).map(id => ({ id, ...MOVES[id] }));
  return f;
}

const foeMon = ([species, lv], extra = {}) => ({ species, xp: xpForLevel(lv), hp: HP, affection: 0, ...extra });

// kind：wild／trainer／gym；foes：[{ species, xp, hp, ... }]
export function startBattle(state, kind, foes, meta = {}) {
  const me = lead(state);
  if (!me) return null;
  state.stats.battles++;
  return { kind, foes, foeIdx: 0, active: me.uid, over: null, throws: 0, ...meta };
}
export const wildBattle = (state, wild) => startBattle(state, 'wild', [{ ...wild, xp: xpForLevel(wild.lv), affection: 0 }]);
export const trainerBattle = (state, t) => startBattle(state, 'trainer', t.team.map(x => foeMon(x)), { id: t.id, zh: t.zh });
export function gymBattle(state) {
  const g = here(state).gym;
  return g ? startBattle(state, 'gym', g.team.map(x => foeMon(x)), { id: `gym:${state.at}`, zh: g.zh, leader: g.leader, badge: g.badge }) : null;
}

export const activeMon = (state, b) => state.party.find(m => m.uid === b.active) ?? null;
export const foeOf = b => b.foes[b.foeIdx];
export function battleView(state, b, dex) {
  const me = activeMon(state, b);
  return { me: toFighter(dex, me, 'you'), foe: toFighter(dex, foeOf(b), 'foe', b.kind) };
}

// 打贏一隻拿到的成長：對手等級越高、自己越低拿越多 // 猜的，可調整
export const xpGain = (foeLv, myLv, kind) => Math.max(1, Math.round((4 * foeLv / myLv) * (kind === 'wild' ? 1 : 1.5)));

// 對手出手（你出招、換人、用道具、丟球沒抓到之後）
function foeTurn(state, b, dex, rng, events) {
  const me = activeMon(state, b);
  const v = battleView(state, b, dex);
  const move = pickFoeMove(v.foe, v.me, v.foe.moves, rng);
  const r = attack(v.foe, v.me, move, rng);
  me.hp = v.me.hp;
  events.push({ who: 'foe', move, ...r });
  if (me.hp <= 0) {
    events.push({ who: 'me', kind: 'faint', uid: me.uid });
    const next = lead(state);
    if (!next) lose(state, b, events);
    else b.needSwitch = true; // 畫面讓你選下一隻（不選就用 lead）
  }
}

function lose(state, b, events) {
  b.over = 'lose';
  events.push({ kind: 'lose', town: state.lastTown });
  enter(state, state.lastTown); // 回到上次的城鎮、補滿血；夥伴、道具、徽章都不會少，只是那條路要從頭走（打贏的訓練家不會再擋）
}

function foeFainted(state, b, dex, events) {
  const me = activeMon(state, b);
  const foe = foeOf(b);
  const before = levelOf(me);
  const gain = xpGain(levelOf(foe), before, b.kind);
  me.xp += gain;
  addAffection(me, b.kind === 'wild' ? 1 : 2);
  events.push({ who: 'foe', kind: 'faint' }, { kind: 'xp', uid: me.uid, gain, lv: levelOf(me), up: levelOf(me) > before });
  if (b.foeIdx + 1 < b.foes.length) {
    b.foeIdx++;
    events.push({ kind: 'next', species: foeOf(b).species });
    return;
  }
  b.over = 'win';
  state.stats.wins++;
  if (b.id) state.beaten.push(b.id);
  if (b.kind === 'gym' && !state.badges.includes(b.badge)) { state.badges.push(b.badge); events.push({ kind: 'badge', badge: b.badge }); }
  if (b.kind === 'wild') breakChain(state, foe.species);
  events.push({ kind: 'win' });
}

// 出招。moveId 要是這隻會的招式
export function useMove(state, b, moveId, dex, rng) {
  if (b.over || b.needSwitch) return [];
  const events = [];
  const v = battleView(state, b, dex);
  const move = v.me.moves.find(m => m.id === moveId) ?? v.me.moves[0];
  const r = attack(v.me, v.foe, move, rng);
  foeOf(b).hp = v.foe.hp;
  events.push({ who: 'me', move, ...r });
  if (v.foe.hp <= 0) foeFainted(state, b, dex, events);
  else foeTurn(state, b, dex, rng, events);
  return events;
}

// 換人：自己選的話對手會趁機打一下；倒下後換上來的不會
export function switchTo(state, b, uid, dex, rng) {
  const m = state.party.find(x => x.uid === uid);
  if (b.over || !m || m.hp <= 0 || m.uid === b.active) return [];
  const forced = b.needSwitch;
  b.active = uid;
  b.needSwitch = false;
  const events = [{ who: 'me', kind: 'switch', uid }];
  if (!forced) foeTurn(state, b, dex, rng, events);
  return events;
}

export function useItem(state, b, itemId, uid, dex, rng) {
  const it = ITEMS[itemId];
  const m = state.party.find(x => x.uid === uid);
  if (!it?.heal || !m || m.hp <= 0 || m.hp >= HP || !takeItem(state, itemId)) return [];
  const before = m.hp;
  m.hp = Math.min(HP, m.hp + it.heal);
  const events = [{ who: 'me', kind: 'heal', uid, item: itemId, gain: m.hp - before }];
  if (b && !b.over) foeTurn(state, b, dex, rng, events);
  return events;
}

// 野生的血越少越好抓：滿血跟桌面一樣，快倒下時 3 倍（原作 (3M−2H)/3M 的精神）
export const hpCatchMult = hpFrac => 3 - 2 * Math.max(0, Math.min(1, hpFrac));

// 丟球。ring：投出去那一刻目標圈的大小（1 → 0.3，越小越好）
export function throwBall(state, b, itemId, ring, dex, rng, now = 0) {
  if (b.over || b.kind !== 'wild' || b.needSwitch || !ITEMS[itemId]?.ball || !takeItem(state, itemId)) return [];
  const foe = foeOf(b);
  const s = dex.get(foe.species);
  const bonus = ringBonus(ring);
  const rate = Math.min(255, s.captureRate * hpCatchMult(foe.hp / HP));
  const p = catchProbability(rate, { ball: ITEMS[itemId].ball, ringMult: bonus.mult });
  const r = rollCatch(p, rng);
  b.throws++;
  const events = [{ who: 'me', kind: 'throw', item: itemId, bonus: bonus.zh, ...r }];
  if (r.caught) {
    const mon = makeMon(state, foe.species, { lv: levelOf(foe), nature: foe.nature, shiny: foe.shiny, form: foe.form, now, area: state.at });
    mon.hp = foe.hp;
    receive(state, mon);
    advanceChain(state, foe.species);
    state.stats.caught++;
    b.over = 'caught';
    events.push({ kind: 'caught', uid: mon.uid, toBox: !state.party.includes(mon) });
    return events;
  }
  if (rng() < fleeChance(s, { failedThrows: b.throws }) * (foe.hp / HP)) { // 打到快倒下的比較跑不動
    b.over = 'fled';
    breakChain(state, foe.species);
    events.push({ kind: 'fled' });
    return events;
  }
  foeTurn(state, b, dex, rng, events);
  return events;
}

// 逃走：野生的一定逃得掉（不懲罰）；訓練家不能逃
export function run(state, b) {
  if (b.over || b.kind !== 'wild') return [];
  b.over = 'ran';
  return [{ kind: 'ran' }];
}

// 對戰結束後：有沒有誰可以進化（時段、隊伍裡的屬性照桌面的規則）
export function evolutions(state, dex, ctx) {
  const outTypes = new Set(state.party.flatMap(m => dex.get(m.species).types));
  return state.party.map(m => ({ m, r: checkEvolution(m, dex, { hour: ctx.hour, outTypes, heldUpsideDown: ctx.upsideDown }) }))
    .filter(x => x.r?.ready).map(x => ({ uid: x.m.uid, from: x.m.species, to: x.r.evo.to }));
}
export function evolve(state, uid, to, dex) {
  const m = [...state.party, ...state.box].find(x => x.uid === uid);
  if (!m || !dex.has(to)) return null;
  const from = m.species;
  m.species = to;
  markDex(state, to, 'seen');
  markDex(state, to, 'caught');
  return { uid, from, to };
}

// ---------- 走路（手機的計步器） ----------
// raw：手機開機以來的總步數（Android TYPE_STEP_COUNTER）。重開機會歸零，所以變小就當作從 0 開始算
export const STEPS_PER_XP = 400; // 走 400 步，帶頭的夥伴成長 1 // 猜的，可調整
export const STEPS_PER_HEART = 150; // 走 150 步，好感 +1 // 猜的，可調整
export const DAY_CAP = 30000; // 一天最多算這麼多步（計步器亂跳時不會一次暴衝） // 猜的，可調整

const dayKey = now => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function addSteps(state, raw, now) {
  if (!Number.isFinite(raw) || raw < 0) return null;
  const s = state.steps;
  const prev = s.raw;
  s.raw = raw;
  if (prev === null) return { walked: 0 }; // 第一次讀到：只記下來
  let walked = raw >= prev ? raw - prev : raw;
  const key = dayKey(now);
  if (s.day !== key) { s.day = key; s.today = 0; }
  walked = Math.max(0, Math.min(walked, DAY_CAP - s.today));
  s.today += walked;
  s.total += walked;
  const m = state.party[0];
  if (!m || !walked) return { walked };
  const before = { xp: Math.floor(s.credited / STEPS_PER_XP), heart: Math.floor(s.credited / STEPS_PER_HEART) };
  s.credited += walked;
  const xp = Math.floor(s.credited / STEPS_PER_XP) - before.xp;
  const love = Math.floor(s.credited / STEPS_PER_HEART) - before.heart;
  const lvBefore = levelOf(m);
  m.xp += xp;
  addAffection(m, love);
  return { walked, uid: m.uid, xp, love, up: levelOf(m) > lvBefore };
}

// ---------- 離開再回來 ----------
// 離開越久，帶頭的夥伴在附近找到越多東西（最多算 7 天）。絕對不會因為離開而少任何東西
export const GIFT_EVERY_H = 8; // 每 8 小時找到一個 // 猜的，可調整
export const GIFT_MAX = 21;
export function welcomeBack(state, now, rng) {
  const away = now - state.lastSeen;
  state.lastSeen = Math.max(state.lastSeen, now);
  state.stats.sessions++;
  if (!state.party.length || away < GIFT_EVERY_H * 3_600_000) return { away, gifts: [] };
  const n = Math.min(GIFT_MAX, Math.floor(away / (GIFT_EVERY_H * 3_600_000)));
  const gifts = [];
  for (let i = 0; i < n; i++) { const id = rng.weighted(GIFT_TABLE).id; addItem(state, id); gifts.push(id); }
  return { away, gifts, finder: state.party[0].uid };
}
export const touch = (state, now) => { state.lastSeen = Math.max(state.lastSeen, now); };

export { BALLS };
