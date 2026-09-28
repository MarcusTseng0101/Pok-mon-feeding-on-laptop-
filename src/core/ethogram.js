// 物種生活表（ethogram）：72 隻卡洛斯寶可夢各自怎麼過日子，以及「下一件事做什麼、做多久」。
// 這是唯一決定下一件事的地方（renderer 的 Pet.decide() 只負責照著做）；renderer 裡不准再有物種或行為的權重表
// （test/ethogram.test.js 用 grep 檢查）。純邏輯：不准 Math.random、Date.now、DOM，亂數和時間從參數來。
//
// 做法是動物行為學的「時間分配（activity budget）＋一段一段的行為（bout）」：
//   - 每一種照最像的真實動物給一份時間分配（TEMPLATES：休息、探索、找吃的、玩、社交、理毛，另外撥一點給習性）
//   - 晝行／夜行／晨昏：不是牠的時段，醒著做事的時間乘上 OFF_PHASE（休息變多）
//   - 屬性對環境的反應（TYPE_ENV）：下雨、下雪、插電、早上、午後…
//   - 挑類別的機率 ∝ 時間分配 ÷ 這一類平均一段多長，這樣「花的時間」才會照表，不是「次數」照表
//   - 心智（core/mind.js）的需求倍率乘上去，不取代：餓了還是會比較想找吃的
//   - 每一段多長：多數短、少數很長（指數分布，夾在上下限之間），休息可以很長
// 每一隻怎麼判斷的寫在 why：look（外型）、type（屬性）、dex（圖鑑＋52poke 百科，出處在 src）。
// 百科內容是 CC BY-NC-SA，這裡只放我們自己寫的一兩句話＋出處網址，不放原文。

export const CLASSES = ['rest', 'explore', 'forage', 'play', 'social', 'groom', 'habit'];

// 時間分配模板（百分比；全部是猜的，可調整；依據見規格 §5.1）
export const TEMPLATES = {
  R: { like: '松鼠、倉鼠、兔', rest: 40, explore: 20, forage: 20, play: 8, social: 6, groom: 6 },
  F: { like: '家貓、狐', rest: 55, explore: 15, forage: 8, play: 7, social: 5, groom: 10 },
  D: { like: '狗', rest: 45, explore: 15, forage: 8, play: 12, social: 15, groom: 5 },
  P: { like: '獅、熊', rest: 65, explore: 10, forage: 8, play: 2, social: 8, groom: 7 },
  G: { like: '羊、鹿', rest: 35, explore: 10, forage: 35, play: 3, social: 12, groom: 5 },
  B: { like: '麻雀、鷹', rest: 35, explore: 20, forage: 20, play: 3, social: 7, groom: 15 },
  A: { like: '蛙、蜥、蛞蝓', rest: 55, explore: 10, forage: 15, play: 5, social: 5, groom: 10 },
  S: { like: '花、蛹、礦物', rest: 65, explore: 5, forage: 20, play: 2, social: 8, groom: 0 },
  N: { like: '蝙蝠、夜行鬼', rest: 35, restOff: 70, explore: 30, forage: 10, play: 15, social: 10, groom: 0 }, // 晝夜顛倒：牠的時段休息 35、不是牠的時段 70
  W: { like: '藤壺、蝦、海馬', rest: 45, explore: 15, forage: 25, play: 0, social: 10, groom: 5 },
  H: { like: '靈長類', rest: 45, explore: 15, forage: 10, play: 12, social: 13, groom: 5 },
  L: { like: '（傳說）', rest: 70, explore: 20, forage: 0, play: 0, social: 0, groom: 0 }, // 圖鑑：長眠、守護；探索＝巡視
};
const HABIT_SHARE = 8; // 習性占幾 %，從「玩」和「探索」各撥一半（猜的，可調整；規格說 5–10）
const OFF_PHASE = 0.4; // 不是牠的時段，醒著做事的時間乘上多少（猜的，可調整）
// 理毛：桌面上還沒有真的理毛動作（要等像素木偶的參數姿勢，PR-N3／N4），只有伸懶腰、抖一抖兩個 1–2 秒的小動作。
// 拿它們去填 6–15% 的時間，會變成每分鐘伸懶腰好幾次（太忙、太假，規格 F5；soul.cjs 也量到「休息」占了一半的決策）。
// 所以先把理毛的時間算進休息，伸懶腰、抖一抖當休息裡偶爾做的小動作；有真的理毛動作以後改成 true
export const GROOM_ACTS = false;

// 這個小時是不是牠的活動時段（晝＝7–18 點、夜＝19–5 點、晨昏＝5–9 點和 16–20 點；猜的，可調整）
export function activeAt(diel, hour) {
  const h = ((hour % 24) + 24) % 24;
  if (diel === 'day') return h >= 7 && h < 19;
  if (diel === 'night') return h >= 19 || h < 6;
  if (diel === 'crep') return (h >= 5 && h < 9) || (h >= 16 && h < 21);
  return true;
}

// 屬性 → 對環境的反應（規格 §5.0.1）。每一條：什麼時候 → 類別倍率、選項倍率（opt）。全部是猜的，可調整。
// 條件：day（7–17 點）、night（20–5 點）、morning（6–10 點）、afternoon（13–16 點）、rain、snow、plugged（剛插電）
export const TYPE_ENV = {
  grass: [['day', { opt: { sunbathe: 2 } }], ['rain', { play: 1.3, explore: 1.2 }], ['snow', { rest: 1.4 }], ['night', { rest: 1.2 }]], // 晴天曬太陽、雨裡開心、冷了縮起來、較早睡
  fire: [['day', { opt: { sunbathe: 1.5 } }], ['rain', { rest: 1.5, explore: 0.5, play: 0.6 }], ['snow', { social: 1.4 }]], // 躲雨；冷了靠近別隻取暖
  water: [['rain', { play: 1.6, explore: 1.3, opt: { splash: 2 } }]], // 下雨出來玩
  electric: [['plugged', { opt: { spark: 3 } }], ['day', { opt: { sunbathe: 1.5 } }], ['rain', { rest: 1.2 }]], // 往電源那邊靠；傘蜥類曬太陽發電；下雨不安
  ice: [['afternoon', { rest: 1.3, explore: 0.7, opt: { chill: 1.5 } }], ['snow', { play: 1.5, explore: 1.3 }], ['night', { explore: 1.2 }]], // 午後怕熱；下雪開心
  rock: [[null, { explore: 0.8 }], ['rain', { rest: 1.3 }]], // 喜歡坐著不動；下雨躲
  ground: [[null, { explore: 0.8, opt: { dig: 1.3 } }], ['rain', { rest: 1.3 }]],
  flying: [[null, { opt: { perch: 2 } }], ['rain', { rest: 1.3, explore: 0.7, opt: { perch: 0.3 } }]], // 待在高處（視窗頂）；下雨躲在視窗下
  bug: [[null, { forage: 1.3 }], ['rain', { rest: 1.3 }], ['snow', { rest: 1.5, explore: 0.5 }], ['night', { rest: 1.3 }]], // 覓食時間長；雨、冷、晚上不動
  fighting: [['morning', { play: 1.5, opt: { train: 2 } }]], // 早上練習
  psychic: [[null, { rest: 1.1 }]], // 長時間靜止凝視
  ghost: [['day', { rest: 1.3 }], ['night', { play: 1.5, explore: 1.3, opt: { fade: 1.5 } }]], // 白天懶、晚上活躍
  dark: [['night', { explore: 1.3 }]],
  fairy: [[null, { opt: { twirl: 1.2, sniff: 1.3 } }]], // 喜歡甜的
  dragon: [['snow', { rest: 1.3 }]], // 怕冷（黏黏寶系列例外：見 WET_DRAGONS）
  steel: [['rain', { rest: 1.2 }]], // 不喜歡生鏽
  poison: [],
  normal: [],
};
const WET_DRAGONS = new Set([704, 705, 706]); // 黏黏寶系列喜歡濕：下雨出來（圖鑑、百科）

// 外型（PokeAPI 的體型分類）→ 同一類裡比較常做哪個動作（選項倍率；全部是猜的，可調整）
// 依據是身體做得到什麼、最像的真實動物平常怎麼動：四腳的常聞、常伸懶腰；兩腳的常走動；
// 有翅膀的常展翅、抖羽毛、站著看；爬的、一團的走得少、常待著；球形的會滾；觸手的浮著張望、不會坐
export const BODY = {
  upright: { walk: 1.2, run: 1.2, dance: 1.5 },
  humanoid: { walk: 1.3, run: 1.5, dance: 1.5, sit: 1.2, roll: 0.5, look: 0.8 },
  quadruped: { look: 1.4, stretch: 1.5, roll: 1.5, sit: 0.8, dance: 0.5 },
  wings: { stretch: 2, shiver: 1.5, look: 1.3, walk: 0.6, roll: 0.3 },
  'bug-wings': { stretch: 1.5, walk: 0.6, roll: 0.3 },
  armor: { walk: 0.7, run: 0.4, roll: 0.5, idle: 1.3 },
  squiggle: { walk: 0.7, run: 0.4, roll: 0.5, idle: 1.3 },
  blob: { walk: 0.6, run: 0.4, roll: 0.6, idle: 1.3, sit: 1.5 },
  ball: { roll: 2, walk: 0.7 },
  arms: { walk: 0.7, twirl: 1.3, idle: 1.2 },
  heads: { look: 1.5 },
  legs: { run: 1.2, roll: 0.5 },
  tentacles: { look: 1.5, idle: 1.5, sit: 0.3, walk: 0.8 },
};

function envOn(cond, env) {
  const h = env.hour ?? 12;
  switch (cond) {
    case null: return true;
    case 'day': return h >= 7 && h < 17;
    case 'night': return h >= 20 || h < 6;
    case 'morning': return h >= 6 && h < 11;
    case 'afternoon': return h >= 13 && h < 17;
    case 'rain': return env.weather === 'rain' || env.weather === 'storm';
    case 'snow': return env.weather === 'snow';
    case 'plugged': return Boolean(env.plugged);
    default: return false;
  }
}

// 這個環境下，這隻的類別倍率和選項倍率
function envMults(id, types = [], env = {}) {
  const cls = {}, opt = {};
  // 黏黏寶系列：龍屬性的「怕冷」不套，改成下雨出來
  const rules = types.flatMap(t => (t === 'dragon' && WET_DRAGONS.has(id) ? [] : TYPE_ENV[t] ?? []));
  if (WET_DRAGONS.has(id)) rules.push(['rain', { explore: 1.4, play: 1.2 }]);
  for (const [cond, eff] of rules) {
    if (!envOn(cond, env)) continue;
    for (const [k, v] of Object.entries(eff)) {
      if (k === 'opt') for (const [o, m] of Object.entries(v)) opt[o] = (opt[o] ?? 1) * m;
      else cls[k] = (cls[k] ?? 1) * v;
    }
  }
  return { cls, opt };
}

// 這隻這個時段的時間分配（比例，加起來是 1）。env：{ hour, weather, plugged }；types：屬性（從 data/kalos.json 來）
export function budgetAt(id, hour, env = {}, types = []) {
  const sp = SPECIES[id];
  if (!sp) return Object.fromEntries(CLASSES.map(c => [c, c === 'rest' ? 1 : 0]));
  const t = TEMPLATES[sp.tpl];
  const on = activeAt(sp.diel, hour);
  const b = {};
  for (const c of CLASSES) b[c] = t[c] ?? 0;
  if (t.restOff != null && !on) b.rest = t.restOff; // 晝夜顛倒的模板自己有兩組休息
  // 這一隻特別：直接指定（set）或加減（add）某一類；其他類照比例縮放，總和維持 100
  const fixed = new Set();
  for (const [k, v] of Object.entries(sp.set ?? {})) { b[k] = v; fixed.add(k); }
  for (const [k, v] of Object.entries(sp.add ?? {})) { b[k] = Math.max(0, b[k] + v); fixed.add(k); }
  if (fixed.size) {
    const keep = [...fixed].reduce((s, k) => s + b[k], 0);
    const rest = CLASSES.filter(c => !fixed.has(c)).reduce((s, c) => s + b[c], 0);
    if (rest > 0) for (const c of CLASSES) if (!fixed.has(c)) b[c] *= Math.max(0, 100 - keep) / rest;
  }
  // 習性：從「玩」和「探索」各撥一半（不夠撥就從另一邊補）
  if (sp.habits.length) {
    let need = HABIT_SHARE, half = need / 2;
    const fromPlay = Math.min(b.play, half); b.play -= fromPlay; need -= fromPlay;
    const fromExp = Math.min(b.explore, need); b.explore -= fromExp; need -= fromExp;
    const more = Math.min(b.play, need); b.play -= more; need -= more;
    b.habit = HABIT_SHARE - need;
  }
  if (!GROOM_ACTS) { b.rest += b.groom; b.groom = 0; }
  // 不是牠的時段：醒著做事的時間變少（晝夜顛倒的模板已經算過了）
  if (!on && t.restOff == null) for (const c of CLASSES) if (c !== 'rest') b[c] *= OFF_PHASE;
  const { cls } = envMults(id, types, { ...env, hour });
  for (const [k, m] of Object.entries(cls)) b[k] *= m;
  const sum = CLASSES.reduce((s, c) => s + b[c], 0);
  for (const c of CLASSES) b[c] = sum > 0 ? b[c] / sum : 0;
  return b;
}

// ---------- 行為：屬於哪一類、多常、一段多長 ----------
// dur：固定秒數，或 [最短, 中位數, 最長]（多數短、少數很長；全部是猜的，可調整）
// w：同一類裡面的相對權重；when(ctx)：這個選項現在能不能做、權重多少（ctx 見 nextBout）
const night = c => { const h = c.hour ?? 12; return h >= 20 || h < 6; };
const day = c => { const h = c.hour ?? 12; return h >= 7 && h < 17; };
const has = (c, ...ts) => (c.types ?? []).some(t => ts.includes(t));
export const ACTS = {
  // 休息：大宗，而且一段可以很長（真實動物一次休息幾分鐘到幾小時；桌面上取短一點，猜的，可調整）
  idle: { cls: 'rest', w: 14, dur: [4, 12, 90] },
  sit: { cls: 'rest', w: 10, dur: [6, 20, 120] },
  nap: { cls: 'rest', w: c => (activeAt(SPECIES[c.id]?.diel, c.hour ?? 12) ? 1 : 8), dur: [10, 30, 180] }, // 不是牠的時段比較會打瞌睡
  sunbathe: { cls: 'rest', w: c => (has(c, 'grass', 'fire') && day(c) ? 6 : 0), dur: [8, 15, 60] },
  chill: { cls: 'rest', w: c => (has(c, 'ice') ? 4 : 0), dur: 2.5 },
  // 探索
  walk: { cls: 'explore', w: 30, dur: [1.5, 3.5, 8] }, // 走路多長由距離決定，這裡只是估計（算時間分配用）
  look: { cls: 'explore', w: 10, dur: [1.6, 2, 3] },
  dig: { cls: 'explore', w: c => (!c.floats && (has(c, 'ground') || c.digger) ? 4 : 0), dur: 3 },
  slime: { cls: 'explore', w: c => (has(c, 'dragon') && !c.floats ? 4 : 0), dur: 8 },
  soar: { cls: 'explore', w: c => (c.floats ? (night(c) && SPECIES[c.id]?.diel === 'night' ? 6 : 3) : 0), dur: [2.8, 3.3, 4] },
  // 跳上視窗的頂邊（有視窗、跳得到的時候，scene/perching.js 才會列出來）：動物有高處就會上去看看；會飄的比較容易上去。
  // 權重是對著 main 量出來的：物種表讓大家多休息、少走動以後，要讓「自己跳上視窗」跟以前一樣常見（10 分鐘 6 隻約 4 次；猜的，可調整）
  perch: { cls: 'explore', w: c => (c.floats ? 24 : 16), dur: [2, 3, 5] },
  // 找吃的：肚子不餓也會找（真實動物的時間分配本來就有覓食），餓了更想找
  hungry: { cls: 'forage', w: c => ((c.fullness ?? 100) < 100 ? 5 : 2), dur: [4, 5, 7] },
  forage: { cls: 'forage', w: c => (!c.floats && has(c, 'bug', 'normal', 'ground', 'grass') ? 4 : 0), dur: [2.5, 3, 4] },
  beg: { cls: 'forage', w: c => ((c.fullness ?? 100) < 30 ? 4 : 0), dur: 2 },
  sniff: { cls: 'forage', w: c => (c.lure ? ((c.fullness ?? 100) < 80 ? 12 : 4) : 0), dur: 4 },
  // 玩
  run: { cls: 'play', w: c => ((c.enjoyment ?? 0) > 120 || (c.hearts ?? 0) >= 2 ? 4 : 1), dur: [2.5, 3.2, 4.5] },
  spin: { cls: 'play', w: c => ((c.hearts ?? 0) >= 2 ? 3 : 0), dur: 0.9 },
  dance: { cls: 'play', w: c => (c.music && (c.hearts ?? 0) >= 1 ? 4 : 0), dur: [3, 4, 6] },
  roll: { cls: 'play', w: c => (!c.floats && (c.hearts ?? 0) >= 1 ? 3 : 0), dur: 1 },
  follow: { cls: 'play', w: c => ((c.hearts ?? 0) >= 3 && c.pointer && c.userActive ? 9 : 0), dur: [3, 4.5, 7] },
  splash: { cls: 'play', w: c => (has(c, 'water') ? 4 : 0), dur: 1.2 },
  ember: { cls: 'play', w: c => (has(c, 'fire') ? 3 : 0), dur: 1.3 },
  spark: { cls: 'play', w: c => (has(c, 'electric') ? (c.plugged ? 12 : 4) : 0), dur: 1.4 },
  bubbles: { cls: 'play', w: c => (has(c, 'poison') ? 4 : 0), dur: 2.5 },
  fade: { cls: 'play', w: c => (has(c, 'ghost') ? (night(c) ? 7 : 3) : 0), dur: 3 },
  teleport: { cls: 'play', w: c => (has(c, 'psychic') ? 3 : 0), dur: 0.9 },
  shine: { cls: 'play', w: c => (has(c, 'steel', 'rock') ? 3 : 0), dur: 1.6 },
  train: { cls: 'play', w: c => (has(c, 'fighting') ? 6 : 0), dur: 2.1 },
  twirl: { cls: 'play', w: c => (has(c, 'fairy') ? 4 : 0), dur: 1.2 },
  // 社交
  play: { cls: 'social', w: c => ((c.others ?? 0) > 0 && (c.hearts ?? 0) >= 1 ? 6 : 0), dur: [4, 5, 6] }, // 找一隻追著玩
  // 理毛、整理身體：伸懶腰（動物伸懶腰會停在最伸展的姿勢一下）、抖一抖（見上面 GROOM_ACTS：現在算在休息裡）
  stretch: { cls: GROOM_ACTS ? 'groom' : 'rest', w: 4, dur: [1.2, 2.5, 4] },
  shiver: { cls: GROOM_ACTS ? 'groom' : 'rest', w: 1, dur: 0.6 },
};
// 其他地方來的選項（social.js、habits.js、moves.js…）沒有列在 ACTS：用心智類別決定屬於哪一類、用這裡的長度估計
// 休息的地點：動物大多回窩（巢、洞）休息，不是走到哪睡到哪。回秘密基地休息（心智類別 base）在「休息」裡的權重乘上多少（猜的，可調整）
const DEN = 3;
const CAT_CLASS = { rest: 'rest', base: 'rest', explore: 'explore', need: 'forage', play: 'play', cursor: 'play', train: 'play', social: 'social', habit: 'habit', trip: 'explore' };
const CLASS_DUR = { rest: [2, 6, 40], explore: [1.5, 4, 10], forage: [2, 4, 8], play: [1, 2.5, 6], social: [2, 4, 8], groom: [0.6, 1.2, 2], habit: [2, 4, 8] };

export function classOf(name, cat) { return ACTS[name]?.cls ?? CAT_CLASS[cat] ?? 'rest'; }

// 這個選項在這個情況下的權重（renderer 的 decide()、soloOptions() 從這裡拿，不自己寫數字）
export function actWeight(name, ctx = {}) {
  const a = ACTS[name];
  if (!a) return 0;
  const w = typeof a.w === 'function' ? a.w(ctx) : a.w;
  const { opt } = envMults(ctx.id, ctx.types, ctx);
  const body = BODY[SPECIES[ctx.id]?.body] ?? {};
  return w * (opt[name] ?? 1) * (body[name] ?? 1);
}

// 一段多長：u 是 0–1 的亂數。指數分布（中位數＝med），夾在 [lo, hi]
function durAt(d, u) {
  if (typeof d === 'number') return d;
  const [lo, med, hi] = d;
  const x = -Math.log(1 - Math.min(u, 0.999999)) * (med / Math.LN2);
  return Math.max(lo, Math.min(hi, x));
}
const meanCache = new Map();
function meanDur(d) {
  if (typeof d === 'number') return d;
  const k = d.join();
  if (!meanCache.has(k)) { let s = 0; const n = 400; for (let i = 0; i < n; i++) s += durAt(d, (i + 0.5) / n); meanCache.set(k, s / n); }
  return meanCache.get(k);
}
const durOf = (name, cls) => ACTS[name]?.dur ?? CLASS_DUR[cls];

// 下一段做什麼、做多久。
// ctx：{ hour, weather, plugged, types, mind: { 心智類別: 倍率 }, offers: [{ name, w, cat }] }
//   offers 是 renderer 現在「做得到」的選項（w 是同一類裡的相對權重：ACTS 的來自 actWeight，其他檔案的照它們自己的）
// rng：0–1 的亂數（從參數來；不准用 Math.random）
// 回傳 { kind: 類別, name: 選項名稱, dur: 秒 }；沒有任何選項時回傳 null
export function nextBout(id, ctx, rng) {
  const offers = (ctx.offers ?? []).filter(o => o.w > 0);
  if (!offers.length) return null;
  const mind = ctx.mind ?? {};
  const budget = budgetAt(id, ctx.hour ?? 12, ctx, ctx.types);
  const groups = new Map();
  const favor = SPECIES[id]?.favor ?? {};
  for (const o of offers) {
    const cls = classOf(o.name, o.cat);
    const m = mind[o.cat] ?? 1;
    const pick = o.w * m * (favor[o.name] ?? 1) * (o.cat === 'base' ? DEN : 1); // 同一類裡挑哪個：權重 × 心智 × 招牌動作 × 回窩休息
    if (!groups.has(cls)) groups.set(cls, { list: [], w: 0, wm: 0, pw: 0, pwd: 0 });
    const g = groups.get(cls);
    g.list.push({ o, wm: pick });
    g.w += o.w; g.wm += o.w * m; g.pw += pick; g.pwd += pick * meanDur(durOf(o.name, cls));
  }
  // 挑類別：時間分配 × 需求（這一類選項的平均心智倍率）÷ 這一類平均一段多長（招牌動作只影響類別裡挑哪個，不影響時間分配）
  const cls = [];
  for (const [c, g] of groups) {
    const need = g.wm / g.w, mean = g.pwd / g.pw;
    cls.push([c, (budget[c] ?? 0) * need / mean]);
  }
  let total = cls.reduce((s, [, w]) => s + w, 0);
  let pickCls;
  if (total > 0) {
    let r = rng() * total;
    pickCls = (cls.find(([, w]) => (r -= w) < 0) ?? cls[cls.length - 1])[0];
  } else {
    // 這隻的時間分配裡，現在做得到的類別都是 0（例如傳說寶可夢只剩玩的選項）：照選項本身的權重挑
    pickCls = null;
  }
  const pool = pickCls ? groups.get(pickCls).list : [...groups.values()].flatMap(g => g.list);
  total = pool.reduce((s, x) => s + x.wm, 0);
  let r = rng() * total;
  const hit = (pool.find(x => (r -= x.wm) < 0) ?? pool[pool.length - 1]).o;
  const kind = classOf(hit.name, hit.cat);
  return { kind, name: hit.name, dur: durAt(durOf(hit.name, kind), rng()) };
}

// 專注番茄鐘進行中：只做安靜的事（優先規則；權重和長度也在這裡，renderer 不自己寫）
export const FOCUS_ACTS = {
  idle: { w: 10, dur: [4, 6, 10] },
  sit: { w: 14, dur: [8, 13, 20] },
  nap: { w: 10, dur: [10, 18, 30] },
  look: { w: 3, dur: [2, 2.5, 3] },
};
export function focusBout(rng) {
  const list = Object.entries(FOCUS_ACTS);
  let r = rng() * list.reduce((s, [, a]) => s + a.w, 0);
  const [name, a] = list.find(([, x]) => (r -= x.w) < 0) ?? list[0];
  return { kind: 'rest', name, dur: durAt(a.dur, rng()) };
}

// 範圍外（規格 §11）：「牠跟你住久了，習慣跟著你的作息變」。這次只留介面，回傳原表
export function learn(id, events) { void events; return SPECIES[id]; }

const SRC = name => `https://wiki.52poke.com/zh-hant/${name}`;
const FAVOR = 2; // 招牌動作：表裡寫「最常」「常常」「一直」「很久」的那個動作，同一類裡的權重乘上多少（猜的，可調整）

// ---------- 72 隻（規格 §5.2；使用者可以逐行改）----------
// body：PokeAPI 的體型分類；diel：day 晝行／night 夜行／crep 晨昏／any 不定；tpl：時間分配模板；
// set：這一隻直接指定的百分比；add：加減；habits：scene/habits.js 的習性（HABITS_BY_SPECIES，測試會對）；
// favor：招牌動作（why.dex 裡寫「最常」「常常」「一直」的那個）
// 全部的百分比、作息都是猜的，可調整。
export const SPECIES = {
  650: { name: '哈力栗', body: 'upright', diel: 'day', traits: '好奇、貪吃', tpl: 'R', sleep: '縮成一顆', habits: ['hunker', 'ram'],
    why: { look: '兩腳直立、小；頭背木殼、頭刺 → 小碎步', type: '草：晴天曬', dex: '殼硬到卡車撞也不痛；刺平常軟、用力才變硬 → 什麼都敢湊過去撞一下看看；被嚇時刺豎起、縮頭（hunker）；ram；百科：原型犰狳＋刺蝟；吃大量樹果殼才長得結實 → 對樹果特別積極' }, src: SRC('哈力栗') },
  651: { name: '胖胖哈力', body: 'upright', diel: 'day', traits: '溫柔', tpl: 'R', sleep: '蹲著', habits: ['ram', 'hunker'],
    why: { look: '兩腳、圓胖 → 慢步、搖晃', type: '草', dex: '互相衝撞鍛鍊下半身；很溫柔，不會主動挑起爭鬥 → 跟同伴輕輕對撞（ram），不打架；被嚇時縮起來用殼擋（hunker）；原地深蹲；百科：原型犰狳、穿山甲；殼很重所以腰腿有力、痛覺遲鈍 → 撞得很大力也不在意；會縮成球' }, src: SRC('胖胖哈力') },
  652: { name: '布里卡隆', body: 'upright', diel: 'day', traits: '保護者', tpl: 'P', sleep: '抱胸坐', habits: ['guard', 'ram'],
    why: { look: '兩腳、大、粗手臂 → 大步、穩', type: '草格鬥：早上練拳', dex: '用身體保護同伴；拳頭護臉的防禦姿勢連炸彈都擋得住 → 站到同伴和游標之間（guard）；有夥伴被招式打到時，舉拳護臉衝過去；用身體撞開擋路的東西（ram）；百科：原型栗子殼＋犰狳＋騎士；平常溫和不愛爭鬥 → 沒事的時候很安靜' }, src: SRC('布里卡隆') },
  653: { name: '火狐狸', body: 'quadruped', diel: 'crep', traits: '警覺', tpl: 'F', sleep: '捲一圈、尾巴蓋鼻子', habits: ['twig', 'earpuff'], favor: { twig: FAVOR },
    why: { look: '四腳、大耳 → 小跑、停下嗅', type: '火：躲雨、找暖處', dex: '走路時咬著樹枝當零食；耳朵噴熱氣威嚇 → 走路常叼著樹枝（twig）；被靠太近時耳朵噴氣（earpuff）；百科：原型耳廓狐；容易亢奮、體溫太高時用耳朵散熱冷靜下來 → 玩得太興奮就停下來、耳朵噴氣散熱（earpuff 改成散熱）' }, src: SRC('火狐狸') },
  654: { name: '長尾火狐', body: 'upright', diel: 'crep', traits: '驕傲', tpl: 'F', sleep: '坐著抱樹枝', habits: ['signal', 'twig'],
    why: { look: '兩腳、尾巴插樹枝 → 優雅走', type: '火', dex: '從尾巴抽樹枝時摩擦點火，用火焰向同伴打信號 → 看到同伴時揮火枝打招呼（signal）；twig；百科：樹枝插在尾巴上有安心作用；遇到危險時轉著樹枝畫圈 → 被嚇時轉樹枝畫圈' }, src: SRC('長尾火狐') },
  655: { name: '妖火紅狐', body: 'upright', diel: 'night', traits: '沉靜', tpl: 'F', sleep: '站著閉眼', habits: ['vortex', 'signal'], favor: { vortex: FAVOR },
    why: { look: '兩腳、高、長袖 → 慢、飄逸', type: '火超能：長時間凝視', dex: '凝視樹枝尖端的火焰進入專注狀態，能預見未來 → 常常靜靜站著看火（vortex）；你在專注模式時牠也一起專注；signal；百科：用杖尖的火在地上燒出痕跡，以前的人拿來占卜 → 占卜完在地上留下一小塊很快消失的焦痕' }, src: SRC('妖火紅狐') },
  656: { name: '呱呱泡蛙', body: 'quadruped', diel: 'crep', traits: '悠哉但警覺', tpl: 'A', sleep: '趴平', habits: ['frubbles'], favor: { look: FAVOR },
    why: { look: '四腳蛙、泡泡圍脖 → 跳一下停很久', type: '水：下雨出來玩', dex: '用泡泡包住皮膚保護；看起來無憂無慮，其實一直留意周圍 → 坐著時眼睛一直掃視；不時補泡泡（frubbles）；突然一跳；百科：原型樹蛙、雨蛙，動作參考忍者；悠哉是騙敵人的演技；會從對手頭上丟泡泡戲弄 → 偶爾在夥伴頭上丟泡泡惡作劇' }, src: SRC('呱呱泡蛙') },
  657: { name: '呱頭蛙', body: 'humanoid', diel: 'night', traits: '敏捷', tpl: 'A', sleep: '蹲在高處', habits: ['leap', 'frubbles'], favor: { leap: FAVOR },
    why: { look: '人形、細長 → 敏捷跳、會爬', type: '水', dex: '一分鐘爬上 600 公尺高塔；能用泡泡包石子精準打中空罐 → 最常爬上視窗頂（leap）；朝遠處丟小石子玩；frubbles；百科：指尖能貼在垂直的牆上 → 會貼著視窗的側邊往上爬' }, src: SRC('呱頭蛙') },
  658: { name: '甲賀忍蛙', body: 'humanoid', diel: 'night', traits: '冷靜、愛戲弄', tpl: 'H', sleep: '蹲在高處', habits: ['ninja', 'shuriken'],
    why: { look: '人形 → 低姿快步、瞬間移位', type: '水惡：晚上活躍', dex: '像忍者神出鬼沒，用快速動作戲弄對手 → 消失再從別處出現（ninja）；繞著游標跑來跑去戲弄；練水手裏劍（shuriken）；百科：用捲在脖子上的舌頭感知空氣流動 → 游標從旁邊掠過時，舌頭圍巾先動一下' }, src: SRC('甲賀忍蛙') },
  659: { name: '掘掘兔', body: 'upright', diel: 'night', traits: '膽小、勤勞', tpl: 'R', sleep: '趴著、耳朵垂', habits: ['alert'], favor: { alert: FAVOR },
    why: { look: '直立兔、大耳 → 兔跳', type: '一般', dex: '對危險很敏感，聽到鳥拍翅膀馬上挖洞躲；用耳朵挖洞，一晚挖 10 公尺 → 常站起來警戒（alert）；有鳥型夥伴飛過就鑽地躲；晚上挖洞；百科：原型穴兔' }, src: SRC('掘掘兔') },
  660: { name: '掘地兔', body: 'upright', diel: 'day', traits: '懶', tpl: 'P', sleep: '仰躺', habits: ['shed', 'alert'], favor: { shed: FAVOR },
    why: { look: '直立、胖、大耳 → 慢走', type: '一般地面：不上視窗', dex: '挖得動岩盤；挖完就懶洋洋躺著；肚子的毛很保暖 → 挖一陣（shed）然後攤著很久；冷天小隻的會靠過來取暖；alert；百科：原型穴兔＋建築工人' }, src: SRC('掘地兔') },
  661: { name: '小箭雀', body: 'wings', diel: 'day', traits: '親人但有地盤', tpl: 'B', sleep: '縮成球（冷的地方的人會跟牠一起睡）', habits: ['peck', 'heatup'],
    why: { look: '小鳥 → 蹦跳＋短飛', type: '一般飛：待高處', dex: '很親人；興奮時體溫升到 2 倍；婉轉的叫聲其實是威嚇，會一直啄闖進地盤的 → 常靠近你；叫；啄靠近的野生寶可夢（peck）；被摸太久會發熱（heatup）；百科：原型日本歌鴝；用叫聲和揮動尾羽跟同伴打信號；身體一直很溫暖 → 翹尾巴打招呼；冷天會靠在你旁邊（游標附近）' }, src: SRC('小箭雀') },
  662: { name: '火箭雀', body: 'wings', diel: 'day', traits: '好戰', tpl: 'B', sleep: '單腳站', habits: ['shoo', 'peck'],
    why: { look: '鳥 → 起飛很快', type: '火飛：躲雨', dex: '地盤意識強，同種也會為覓食地打架；向草叢撒火花把蟲驚出來吃 → 趕走其他鳥（shoo）；對地面撒火花、啄（peck）；百科：原型伯勞等；肚子的火袋點火要花時間，起飛後很快 → 起飛前有一段預備' }, src: SRC('火箭雀') },
  663: { name: '烈箭鷹', body: 'wings', diel: 'day', traits: '孤高', tpl: 'B', add: { rest: 15 }, sleep: '站在高處', habits: ['dive', 'shoo'], favor: { look: FAVOR },
    why: { look: '大鳥 → 很少走路，滑翔、直線衝', type: '火飛', dex: '以時速 500 公里直線衝向獵物，再用腳踢 → 站在最高處很久、盯著下面，然後直線俯衝（dive）；shoo；張翅；百科：原型游隼；能抓著 100 公斤的獵物飛' }, src: SRC('烈箭鷹') },
  664: { name: '粉蝶蟲', body: 'armor', diel: 'day', traits: '膽小', tpl: 'S', set: { forage: 45 }, sleep: '縮', habits: ['powder'],
    why: { look: '甲殼型小蟲 → 蠕動', type: '蟲：覓食時間長', dex: '被鳥攻擊時噴會麻痺的黑粉；粉能調節體溫 → 大部分時間在啃；鳥型夥伴靠近時噴粉（powder）；百科：吃的植物隨棲息地而不同' }, src: SRC('粉蝶蟲') },
  665: { name: '粉蝶蛹', body: 'blob', diel: 'any', traits: '隨興', tpl: 'S', add: { explore: 15 }, sleep: '不動', habits: ['harden', 'powder'],
    why: { look: '一團 → 慢慢挪動，到處漫步（百科：沒有固定住處，隨心所欲地在山野漫步）', type: '蟲', dex: '躲在樹叢陰影，被攻擊時豎起體毛威嚇、噴粉 → 待在陰影裡；有東西靠近就豎毛（harden）、powder' }, src: SRC('粉蝶蛹') },
  666: { name: '彩粉蝶', body: 'bug-wings', diel: 'day', traits: '優雅', tpl: 'B', sleep: '翅膀合起', habits: ['scales'],
    why: { look: '蟲翅 → 忽上忽下地飛', type: '蟲飛', dex: '撒下色彩繽紛的鱗粉；翅膀花紋隨棲息地而不同 → 停在高處慢慢開合翅膀（scales，真蝴蝶曬太陽）；飛過時撒粉；去花園；百科：原型蝴蝶；花紋隨棲息地（遊戲裡已經照時區決定）' }, src: SRC('彩粉蝶') },
  667: { name: '小獅獅', body: 'quadruped', diel: 'day', traits: '衝動、好奇', tpl: 'D', add: { play: 8 }, sleep: '側躺', habits: ['inspect', 'mane'],
    why: { look: '四腳幼獅 → 小跑、撲', type: '火一般', dex: '好奇心旺盛、血氣方剛，生氣時鬃毛變熱；長大後離開群體獨立 → 到處嗅（inspect）；跟比自己大的夥伴挑釁；鬃毛發熱（mane）；百科：原型幼獅；由雌性火炎獅教狩獵 → 有火炎獅時跟在旁邊學' }, src: SRC('小獅獅') },
  668: { name: '火炎獅', body: 'quadruped', diel: 'crep', traits: '首領', tpl: 'P', sleep: '側躺攤開', habits: ['roar', 'inspect'],
    why: { look: '四腳、大 → 慢步', type: '火一般', dex: '雄性平常很懶，強敵來時拼命保護同伴；鬃毛最大的是首領 → 大部分時間躺著；夥伴被招式打到或被野生寶可夢靠近，立刻起身吼（roar）擋在前面；inspect；百科：原型獅子：雄獅大部分時間在休息，有外敵才保護族群（百科直接這樣寫）' }, src: SRC('火炎獅') },
  669: { name: '花蓓蓓', body: 'arms', diel: 'day', traits: '悠哉', tpl: 'S', sleep: '窩在花裡', habits: ['pollen'],
    why: { look: '只有手、抱花、極小 → 隨風飄', type: '妖精：往花去', dex: '找到喜歡的花就一輩子住在上面；乘著風悠哉地飄 → 游標快速掠過時被「風」吹著飄一段；停在花園的花上；撒花粉（pollen）；百科：原型蒲公英種子（乘風移動）；黃昏會去找開著跟自己一樣的花的地方睡 → 黃昏往花園去睡' }, src: SRC('花蓓蓓') },
  670: { name: '花葉蒂', body: 'arms', diel: 'day', traits: '園丁', tpl: 'S', sleep: '抱著花', habits: ['tend', 'pollen'],
    why: { look: '只有手、抱花 → 飄', type: '妖精', dex: '照顧快枯萎的花；花壇開花時跳優雅的舞；絕不原諒破壞花壇的 → 去花園照顧花（tend）；花園新開花時跳舞；pollen；百科：會把枯萎的花帶回自己的地盤照料 → tend 時會先去「撿」一下再回來' }, src: SRC('花葉蒂') },
  671: { name: '花潔夫人', body: 'arms', diel: 'day', traits: '優雅', tpl: 'S', sleep: '站著', habits: ['garden', 'tend'], favor: { garden: FAVOR },
    why: { look: '只有手、沒有腳（莖葉撐著） → 緩緩滑行', type: '妖精', dex: '活好幾百年、一生守護庭園；從花的能量曬太陽得到力量 → 在花園旁站很久（garden）；tend；百科：原型穿晚禮服的貴婦、風信子' }, src: SRC('花潔夫人') },
  672: { name: '坐騎小羊', body: 'quadruped', diel: 'day', traits: '溫順', tpl: 'G', sleep: '趴', habits: ['graze'], favor: { follow: FAVOR },
    why: { look: '四腳 → 走、低頭', type: '草：晴天曬太陽就不用吃', dex: '背上的葉子能製造能量；性情溫和，最早跟人一起生活的寶可夢之一 → 晴天「找吃的」換成曬背（graze 改演法）；常待在你附近；百科：原型山羊；以前山區居民騎著牠走山路' }, src: SRC('坐騎小羊') },
  673: { name: '坐騎山羊', body: 'quadruped', diel: 'day', traits: '穩重', tpl: 'G', sleep: '趴著反芻', habits: ['ram', 'graze'],
    why: { look: '四腳、大、角 → 穩步', type: '草', dex: '首領由犄角互撞決定；從握角的力道感知訓練家的心情 → 跟同種頂角（ram）；游標停在角上時會靠過來；graze' }, src: SRC('坐騎山羊') },
  674: { name: '頑皮熊貓', body: 'upright', diel: 'day', traits: '逞強', tpl: 'H', sleep: '大字躺', habits: ['glare'],
    why: { look: '兩腳 → 搖搖晃晃', type: '格鬥：早上練', dex: '一直瞪著對手，一放鬆就不小心露出笑臉；把流氓熊貓當老大模仿、跟在後面 → 瞪你（glare），瞪一下就破功笑；有流氓熊貓時跟在後面學牠的動作；百科：被摸頭就放鬆、忍不住笑出來 → 撫摸頭部時 glare 破功' }, src: SRC('頑皮熊貓') },
  675: { name: '流氓熊貓', body: 'humanoid', diel: 'day', traits: '老大', tpl: 'P', sleep: '靠著坐', habits: ['leafsense', 'glare'],
    why: { look: '人形、大 → 大搖大擺', type: '格鬥惡', dex: '從竹葉的擺動察覺敵人；粗暴但很重感情 → 嘴上的葉子一動就轉頭（leafsense）；照顧頑皮熊貓；glare；百科：不容許欺負弱小 → 小隻夥伴被打到時出頭' }, src: SRC('流氓熊貓') },
  676: { name: '多麗米亞', body: 'quadruped', diel: 'day', traits: '忠誠', tpl: 'D', sleep: '捲著', habits: ['groom'],
    why: { look: '四腳犬 → 昂首小跑', type: '一般', dex: '只讓信任的人修剪毛；以前是國王的護衛 → 理毛（groom）；跟著你走；在大家周圍巡一圈；百科：原型貴賓犬＋羊駝' }, src: SRC('多麗米亞') },
  677: { name: '妙喵', body: 'upright', diel: 'crep', traits: '冷淡', tpl: 'F', sleep: '捲成團', habits: ['psyburst'], favor: { look: FAVOR },
    why: { look: '直立小貓 → 貓步、安靜', type: '超能', dex: '面無表情是在拼命忍住外洩的精神力量；控制不了 → 常常呆望；偶爾力量外洩，身邊小東西浮起來（psyburst）；洗臉；百科：原型俄羅斯藍貓、折耳貓' }, src: SRC('妙喵') },
  678: { name: '超能妙喵', body: 'upright', diel: 'crep', traits: '護主', tpl: 'F', sleep: '捲成團', habits: ['protect', 'psyburst'],
    why: { look: '直立貓 → 貓步', type: '超能', dex: '防衛本能強，保護夥伴時才全力；平時把耳朵內側的眼紋藏起來 → 夥伴被打到時張開耳朵（protect）；psyburst；洗臉；百科：原型折耳貓，尾巴參考貓又' }, src: SRC('超能妙喵') },
  679: { name: '獨劍鞘', body: 'blob', diel: 'night', traits: '陰沉', tpl: 'N', sleep: '插在地上', habits: ['sway', 'drain'],
    why: { look: '一團（劍） → 浮著、慢', type: '鋼鬼：晚上', dex: '護手上的眼睛才是本體；用舊布吸人的精氣；誰抓劍柄就纏上去 → 慢慢漂近；布條往游標伸（drain）；被拎起來時布纏住滑鼠；sway；百科：平時把劍身收在鞘裡，戰鬥才露出來 → 休息時收鞘、出招時拔出' }, src: SRC('獨劍鞘') },
  680: { name: '雙劍鞘', body: 'heads', diel: 'night', traits: '雙子', tpl: 'N', sleep: '交叉', habits: ['swordplay', 'sway'],
    why: { look: '兩頭（雙劍） → 浮', type: '鋼鬼', dex: '兩把劍高速交替攻防；互相摩擦劍刃發出聲音威嚇 → 兩把互相比劃（swordplay）；摩擦發聲；sway；百科：兩把劍用心靈感應對話' }, src: SRC('雙劍鞘') },
  681: { name: '堅盾劍怪', body: 'blob', diel: 'night', traits: '高傲', tpl: 'N', sleep: '盾形態', habits: ['stance', 'swordplay'],
    why: { look: '一團（盾劍） → 浮、威嚴', type: '鋼鬼', dex: '能看出誰有領導資質；防禦狀態用靈力屏障 → 盾／劍姿勢切換（stance）；偶爾長時間盯著你看；swordplay' }, src: SRC('堅盾劍怪') },
  682: { name: '粉香香', body: 'arms', diel: 'day', traits: '愛香', tpl: 'S', sleep: '浮著', habits: ['perfume'],
    why: { look: '只有手、小 → 輕飄', type: '妖精', dex: '香氣會隨吃的東西改變 → 吃完泡芙以後散發的香氣顏色跟泡芙口味有關（perfume）；百科：原型草鴞之類的貓頭鷹，懸停時的搖晃像嬰兒床的吊飾 → 飄著時左右輕輕晃' }, src: SRC('粉香香') },
  683: { name: '芳香精', body: 'humanoid', diel: 'day', traits: '優雅', tpl: 'H', sleep: '站著', habits: ['aroma', 'perfume'],
    why: { look: '人形 → 慢走', type: '妖精', dex: '香氣強到同伴嗅覺失靈；對夥伴香、對敵人臭 → 在夥伴旁散香（aroma）；野生寶可夢出現時散臭味；perfume；百科：原型角鴞；動作像佛朗明哥、康康舞者 → 散香時擺舞姿' }, src: SRC('芳香精') },
  684: { name: '綿綿泡芙', body: 'legs', diel: 'day', traits: '嗜甜', tpl: 'R', sleep: '縮成一團', habits: ['string', 'perfume'],
    why: { look: '只有腳 → 彈跳', type: '妖精：喜歡甜', dex: '每天吃掉跟體重一樣的砂糖，不夠就鬧脾氣；吐甜甜的黏絲 → 肚子餓時鬧脾氣跺腳；吐絲（string）；perfume；百科：原型棉花糖＋比熊犬（嗅覺靈敏） → 聞到甜味就轉頭' }, src: SRC('綿綿泡芙') },
  685: { name: '胖甜妮', body: 'humanoid', diel: 'day', traits: '貪吃', tpl: 'R', sleep: '攤平', habits: ['bounce', 'sweettooth'],
    why: { look: '人形 → 彈跳', type: '妖精', dex: '嗅覺是人的一億倍，能從氣味嗅出人的身心狀態 → 到處嗅（sweettooth）；你熬夜或說累的時候靠過來聞一聞；bounce；百科：原型狗＋甜點，會伸舌頭' }, src: SRC('胖甜妮') },
  686: { name: '好啦魷', body: 'tentacles', diel: 'night', traits: '好奇', tpl: 'N', sleep: '倒過來浮', habits: ['flash'],
    why: { look: '觸手 → 旋轉著漂浮', type: '惡超能：晚上', dex: '旋轉著閃爍發光體跟同伴交流；閃光讓敵人失去戰意再逃 → 旋轉閃光（flash）；兩隻以上時互相閃光「聊天」；被嚇時閃一下就逃；百科：原型螢火魷；倒立會讓血液流通、頭腦清楚 → 常常倒立；會對發光的東西（招式特效）轉頭' }, src: SRC('好啦魷') },
  687: { name: '烏賊王', body: 'blob', diel: 'night', traits: '陰險', tpl: 'N', sleep: '站著', habits: ['hypno', 'flash'],
    why: { look: '一團 → 慢慢滑', type: '惡超能', dex: '讓身上的花紋發光，把獵物引過來；強力催眠 → 花紋發光，想把游標引過來（hypno）；flash；百科：原型會把身體翻過來的吸血魷' }, src: SRC('烏賊王') },
  688: { name: '龜腳腳', body: 'heads', diel: 'day', traits: '吵', tpl: 'W', sleep: '縮', habits: ['bicker'],
    why: { look: '兩頭 → 身體一伸一縮拖著石頭跳', type: '岩水', dex: '兩隻住在同一塊石頭上；吵架時一隻搬到別塊；漲潮時合作找食物 → 兩個頭吵架（bicker），吵完一個轉開；張手濾食；百科：原型龜足（佛手貝）；本體其實只有「手」' }, src: SRC('龜腳腳') },
  689: { name: '龜足巨鎧', body: 'heads', diel: 'day', traits: '群', tpl: 'W', sleep: '蹲', habits: ['lookout', 'bicker'], favor: { lookout: FAVOR },
    why: { look: '多頭 → 橫著走', type: '岩水', dex: '用手掌上的眼睛觀察四面；手腳各有意志，平常聽頭的 → 手掌轉來轉去張望（lookout）；偶爾一隻手不聽話自己動；bicker；百科：原型鵝頸藤壺' }, src: SRC('龜足巨鎧') },
  690: { name: '垃垃藻', body: 'blob', diel: 'night', traits: '擬態', tpl: 'W', set: { rest: 55 }, sleep: '不動', habits: ['camo'],
    why: { look: '一團（海藻） → 隨波晃，不擅長游', type: '毒水', dex: '裝成腐爛的海藻，混在藻屑裡一動也不動 → 很長時間完全不動（camo）；百科：原型草海龍；被暴風雨捲走就回不了家 → 下大雨時抓住東西不動' }, src: SRC('垃垃藻') },
  691: { name: '毒藻龍', body: 'blob', diel: 'night', traits: '兇', tpl: 'W', sleep: '不動', habits: ['sunhat', 'camo'],
    why: { look: '一團、大 → 慢', type: '毒龍', dex: '把頭上像帽子的部分露出水面曬太陽製造龍之能量；混在藻裡等獵物；性情兇暴 → 晴天把頭抬起來曬（sunhat）；有東西太靠近就噴毒；camo；百科：原型葉海龍' }, src: SRC('毒藻龍') },
  692: { name: '鐵臂槍蝦', body: 'armor', diel: 'night', traits: '衝動', tpl: 'W', sleep: '縮', habits: ['watershot'],
    why: { look: '甲殼 → 用右鉗噴水前進，走不直', type: '水', dex: '靠右鉗噴水移動，平衡不好，不擅長直線；鉗子脫落時會偷偷生活 → 移動路線歪歪斜斜；射水（watershot）；百科：原型槍蝦' }, src: SRC('鐵臂槍蝦') },
  693: { name: '鋼炮臂蝦', body: 'squiggle', diel: 'night', traits: '地盤、兇', tpl: 'W', sleep: '縮', habits: ['cannon'],
    why: { look: '蠕蟲形 → 橫著走', type: '水', dex: '用大鉗子上的觸角探測獵物位置，再發射水砲 → 觸角先探一探、再瞄準（cannon）；百科：原型槍蝦；地盤意識強，連同伴都會攻擊；用鉗子後面的噴管推進 → 別隻靠太近就不高興' }, src: SRC('鋼炮臂蝦') },
  694: { name: '傘電蜥', body: 'upright', diel: 'day', traits: '愛曬太陽', tpl: 'A', sleep: '趴', habits: ['solar'],
    why: { look: '直立小蜥 → 衝刺—停', type: '電一般：晴天曬', dex: '張開頭部褶邊曬太陽發電；發電被打擾會有壓力、變虛弱；住在沙漠 → 白天張開褶邊曬（solar）；游標在旁邊晃會不高興、走開；百科：原型傘蜥（據說用頸傘調節體溫）' }, src: SRC('傘電蜥') },
  695: { name: '光電傘蜥', body: 'upright', diel: 'day', traits: '敏捷', tpl: 'A', sleep: '趴', habits: ['solar'],
    why: { look: '直立蜥 → 兩腳全速衝刺', type: '電一般', dex: '展開頸傘曬太陽能供一座城市的電；用電刺激腿部肌肉，5 秒跑 100 碼 → solar；偶爾全速衝過整個螢幕；百科：原型傘蜥；腳快到能在水上跑' }, src: SRC('光電傘蜥') },
  696: { name: '寶寶暴龍', body: 'upright', diel: 'day', traits: '任性', tpl: 'H', sleep: '趴', habits: ['tantrum', 'chomp'],
    why: { look: '直立恐龍 → 重步', type: '岩龍', dex: '任性又愛撒嬌，只是玩鬧也會讓人受傷；大顎什麼都咬得碎 → 撒嬌蹭你；什麼都去咬一下（chomp）；不順心就鬧（tantrum）；百科：原型幼年霸王龍' }, src: SRC('寶寶暴龍') },
  697: { name: '怪顎龍', body: 'upright', diel: 'day', traits: '霸王', tpl: 'P', sleep: '趴', habits: ['stomp', 'chomp'],
    why: { look: '直立、大 → 重步、慢', type: '岩龍', dex: '古代世界的王者，威風堂堂 → 站在中間巡視；跺腳（stomp）；chomp；百科：原型霸王龍（有羽毛的說法）；冰雪龍的天敵' }, src: SRC('怪顎龍') },
  698: { name: '冰雪龍', body: 'quadruped', diel: 'night', traits: '溫和', tpl: 'G', sleep: '蜷著', habits: ['aurora'],
    why: { look: '四腳、長頸 → 慢、優雅', type: '岩冰：午後怕熱', dex: '鳴叫時夜空會出現極光；以前群居在寒冷地區；現代太熱 → 晚上抬頭鳴叫出極光（aurora）；白天熱的時候躲陰影、動作慢；百科：原型阿馬加龍幼體；性格慢吞吞' }, src: SRC('冰雪龍') },
  699: { name: '冰雪巨龍', body: 'quadruped', diel: 'night', traits: '溫和', tpl: 'G', sleep: '蜷著', habits: ['aurora', 'diamonddust'],
    why: { look: '四腳、大 → 很慢', type: '岩冰', dex: '平常非常穩重溫和；被激怒時噴冰氣把周圍冰封 → aurora；被連續打擾才 diamonddust；百科：原型阿馬加龍；被激怒時先用冰牆擋' }, src: SRC('冰雪巨龍') },
  700: { name: '仙子伊布', body: 'quadruped', diel: 'day', traits: '親人', tpl: 'D', sleep: '捲著', habits: ['ribbon'],
    why: { look: '四腳 → 輕快', type: '妖精', dex: '用緞帶觸角纏住訓練家的手臂來感知心情；放出消除敵意的波動平息紛爭 → 緞帶纏游標（ribbon）；有夥伴在吵（bicker、tantrum）時過去勸；百科：搖著觸角跳輕快的舞；吵架時用緞帶捲住兩邊讓現場平靜' }, src: SRC('仙子伊布') },
  701: { name: '摔角鷹人', body: 'humanoid', diel: 'day', traits: '獨來獨往、出招時愛表現', tpl: 'H', add: { social: -8 }, sleep: '站著', habits: ['flashypose'],
    why: { look: '人形（有翅） → 跳、大步', type: '格鬥飛：早上練、待高處', dex: '使出絕招前一定先擺華麗姿勢；輕盈地跳到死角 → 擺姿勢（flashypose）；從視窗頂跳下來；百科：原型墨西哥摔角、鳳尾綠咬鵑；不成群、平常靜靜地生活，只有出招前愛擺姿勢 → 平常安靜獨處' }, src: SRC('摔角鷹人') },
  702: { name: '咚咚鼠', body: 'upright', diel: 'crep', traits: '膽小', tpl: 'R', sleep: '捲', habits: ['leech', 'outlet'],
    why: { look: '直立小鼠 → 碎步、竄', type: '電妖精：插電時往電源靠', dex: '從插座和其他電屬性寶可夢那裡偷電；用鬍鬚跟同伴分享哪裡有食物和電 → 插上電源時跑去「偷電」（outlet）；貼著電屬性夥伴（leech）；鬍鬚朝同伴；百科：原型睡鼠；電力變少時會縮起來睡 → 沒插電時睡得多' }, src: SRC('咚咚鼠') },
  703: { name: '小碎鑽', body: 'ball', diel: 'any', traits: '愛睡', tpl: 'S', set: { rest: 80 }, sleep: '不動', habits: ['gemnap'],
    why: { look: '球 → 幾乎不動', type: '岩妖精', dex: '在地底深處睡；群體會用鬍子互相打磨寶石 → 睡很多（gemnap）；有兩隻時互相磨；百科：從出生起在地底睡了數億年' }, src: SRC('小碎鑽') },
  704: { name: '黏黏寶', body: 'squiggle', diel: 'night', traits: '膽小', tpl: 'A', sleep: '攤平', habits: ['hide'],
    why: { look: '蠕蟲形 → 蠕動、很慢', type: '龍：雨天出來', dex: '皮膚乾了就不能呼吸，總是靜靜待在陰影下；觸角很敏感，一感覺到敵人就躲 → 找視窗下的陰影待著；觸角先探一探再動；被嚇就躲（hide）；百科：原型蛞蝓；待在濕度高的陰影；觸角感知空氣流動' }, src: SRC('黏黏寶') },
  705: { name: '黏美兒', body: 'squiggle', diel: 'night', traits: '單純', tpl: 'A', sleep: '攤平', habits: ['hide', 'sweettooth'],
    why: { look: '蠕蟲形 → 慢吞吞爬', type: '龍', dex: '腦子裡只想著吃和逃；分不太清楚獵物和同伴 → 找吃的（sweettooth）；逃（hide）；百科：原型蝸牛、蛞蝓；眼睛退化看不見，靠觸角感知聲音和氣味 → 移動前觸角一定先探' }, src: SRC('黏美兒') },
  706: { name: '黏美龍', body: 'upright', diel: 'day', traits: '黏人', tpl: 'H', sleep: '坐著', habits: ['hug'],
    why: { look: '直立、大 → 慢', type: '龍', dex: '非常親人，沒人理就寂寞到流著黏黏的眼淚叫；親密了會黏黏地抱上來 → 你很久沒理牠會難過；抱抱（hug）；有時聽不懂指令、呆住；百科：原型蛞蝓＋蜥腳類恐龍；熱愛雨水，下雨時在外面散步；會為了保護其他寶可夢努力 → 雨天出來散步' }, src: SRC('黏美龍') },
  707: { name: '鑰圈兒', body: 'ball', diel: 'day', traits: '收集癖', tpl: 'N', sleep: '掛著', habits: ['jingle', 'keyhunt'],
    why: { look: '球 → 飄、叮噹響', type: '鋼妖精', dex: '收集鑰匙成癡，會偷偷溜進別人家偷鑰匙 → 叮噹搖（jingle）；在桌面上到處翻找（keyhunt）★ 把找到的東西帶回基地；百科：被攻擊時搖響鑰匙威嚇' }, src: SRC('鑰圈兒') },
  708: { name: '小木靈', body: 'arms', diel: 'night', traits: '寂寞', tpl: 'N', sleep: '靠著樹', habits: ['callaway'],
    why: { look: '只有手（樹樁） → 飄', type: '鬼草', dex: '用小孩的聲音把大人引到森林深處，因為想要有夥伴 → 寂寞的時候叫你過去（callaway）；百科：住在人不靠近的森林，徘徊著找夥伴' }, src: SRC('小木靈') },
  709: { name: '朽木妖', body: 'tentacles', diel: 'night', traits: '守林', tpl: 'S', sleep: '站著', habits: ['roots', 'callaway'], favor: { roots: FAVOR },
    why: { look: '觸手（樹） → 很慢', type: '鬼草', dex: '用腳尖的根操縱其他樹；對住在森林裡的寶可夢很溫柔 → 紮根不動很久（roots）；小隻的夥伴靠近時很溫柔；callaway；百科：別的寶可夢把牠頭上的葉子當住處也不在意 ★ 讓小隻夥伴停在頭上' }, src: SRC('朽木妖') },
  710: { name: '南瓜精', body: 'ball', diel: 'crep', traits: '害羞', tpl: 'N', sleep: '坐著', habits: ['lantern', 'hypno'],
    why: { look: '球 → 小跳', type: '鬼草', dex: '太陽下山時變得躁動活潑；南瓜洞裡的光能催眠 → 黃昏開始活躍、提燈（lantern）；hypno；百科：原型南瓜燈；黃昏開始活動' }, src: SRC('南瓜精') },
  711: { name: '南瓜怪人', body: 'blob', diel: 'night', traits: '陰森', tpl: 'N', sleep: '浮著', habits: ['lantern', 'knock'],
    why: { look: '一團 → 飄', type: '鬼草', dex: '朔月夜去敲人家的門；深夜身體發出怪聲 → 晚上敲視窗邊（knock）；lantern；百科：朔月夜在街上遊蕩唱歌' }, src: SRC('南瓜怪人') },
  712: { name: '冰寶', body: 'quadruped', diel: 'day', traits: '黏家人', tpl: 'A', sleep: '趴', habits: ['ride'],
    why: { look: '四腳（冰塊） → 慢慢滑', type: '冰：午後怕熱', dex: '把腳凍在冰岩怪背上固定；用冷氣修補裂縫 → 有冰岩怪時爬上牠的背（ride）；百科：偶爾坐在冰岩怪背上渡海搬家' }, src: SRC('冰寶') },
  713: { name: '冰岩怪', body: 'quadruped', diel: 'day', traits: '沉穩', tpl: 'S', sleep: '趴', habits: ['mend'],
    why: { look: '四腳、巨大 → 極慢、直直走', type: '冰', dex: '白天活動時身體裂縫變大，一晚就長好；背上馱著冰寶 → 白天走動，晚上靜靜修補（mend）；讓冰寶騎；百科：原型冰山、浮冰；為了避免爭鬥會讓別人先過 → 路上遇到別隻就停下讓路' }, src: SRC('冰岩怪') },
  714: { name: '嗡蝠', body: 'wings', diel: 'night', traits: '美食家', tpl: 'N', sleep: '倒掛', habits: ['ultrasound'],
    why: { look: '有翅 → 撲翅', type: '飛龍：晚上', dex: '太陽下山時離開洞窟飛，用超音波挑熟透的水果 → 白天倒掛在視窗頂睡；黃昏出來；對樹果發超音波再吃（ultrasound）；百科：原型果蝠；有時會把蟲誤認成食物 → 偶爾對蟲屬性夥伴發超音波' }, src: SRC('嗡蝠') },
  715: { name: '音波龍', body: 'wings', diel: 'night', traits: '兇→親人', tpl: 'N', sleep: '倒掛', habits: ['ultrasound'],
    why: { look: '有翅、大 → 滑翔', type: '飛龍', dex: '性情粗暴，給牠熟透的水果就變親人 → 晚上巡飛；餵樹果以後會靠近你；ultrasound；百科：在沒有月光的黑夜飛' }, src: SRC('音波龍') },
  716: { name: '哲爾尼亞斯', body: 'quadruped', diel: 'day', traits: '神聖', tpl: 'L', sleep: '樹', habits: ['rainbow'],
    why: { look: '四腳（鹿） → 緩步', type: '妖精', dex: '角閃耀七色時是在分享永恆的生命；以樹的姿態沉睡了一千年 → 角發光（rainbow）；睡覺時變成樹的樣子；百科：原型鹿（換角象徵生命循環）' }, src: SRC('哲爾尼亞斯') },
  717: { name: '伊裴爾塔爾', body: 'wings', diel: 'night', traits: '可怕', tpl: 'L', sleep: '繭', habits: ['darkwings'],
    why: { look: '有翅、巨大 → 盤旋', type: '惡飛', dex: '展開翅膀發紅光吸取生命；生命盡頭變回繭 → 展翅（darkwings）；睡覺＝變成繭；百科：原型猛禽、食腐鳥' }, src: SRC('伊裴爾塔爾') },
  718: { name: '基格爾德', body: 'squiggle', diel: 'any', traits: '監視者', tpl: 'L', sleep: '盤起來', habits: ['cells'],
    why: { look: '蠕蟲形 → 滑行', type: '龍地面', dex: '監視著生態系統 → 在大家外圍慢慢繞、盯著大家（cells）；百科：50% 形態住在洞窟深處監察生態' }, src: SRC('基格爾德') },
  719: { name: '蒂安希', body: 'arms', diel: 'day', traits: '公主', tpl: 'L', sleep: '浮著', habits: ['diamonds'],
    why: { look: '只有手 → 飄', type: '岩妖精', dex: '能在雙手之間壓縮碳，瞬間做出大量鑽石 → 雙手之間做鑽石（diamonds）；百科：小碎鑽的突變體' }, src: SRC('蒂安希') },
  720: { name: '胡帕', body: 'arms', diel: 'day', traits: '調皮', tpl: 'L', add: { play: 20 }, sleep: '浮著', habits: ['portal'],
    why: { look: '只有手 → 飄', type: '超能鬼', dex: '愛惡作劇，把喜歡的東西用圓環傳到秘密的地方 → portal ★ 把桌面上的樹果、信用圓環藏起來再還你；百科：原型神燈精靈；會鑽進圓環瞬間移動 → 移動時用圓環瞬移（不需要 ★）' }, src: SRC('胡帕') },
  721: { name: '波爾凱尼恩', body: 'quadruped', diel: 'any', traits: '孤僻', tpl: 'L', sleep: '趴', habits: ['steam'],
    why: { look: '四腳 → 重步', type: '火水', dex: '噴出蒸氣消失在濃霧裡；住在人跡罕至的山裡 → 噴蒸氣（steam）；夥伴多的時候待在角落；百科：原型獅子；兩隻手臂平時合起來像拱門' }, src: SRC('波爾凱尼恩') },
};
