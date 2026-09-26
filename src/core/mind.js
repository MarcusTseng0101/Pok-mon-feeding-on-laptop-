// 心智：每一隻寶可夢的需求、個性、心情，以及「為什麼想做這件事」。
//
// 心智不選行為。Pet.decide() 仍然是唯一的決策點：它把每個選項歸到一個類別，
// 權重乘上 weights() 給的倍率，抽出來以後再用 reason() 問「理由」。
// 這樣理由一定跟實際做的事對得上，也不會有兩套系統搶同一隻寶可夢。
//
// 需求的數值是「滿足程度」0–100（100＝完全滿足，越低越想要）：
//   food、fun 由原本的飽足感、滿足感換算，不另外存（不然兩個數字會互相矛盾）
//   energy、social、curiosity、comfort 存在 mon.mind
// 這裡不用內建亂數：隨機數一律由參數 rng 提供（測試要能重現）。

export const NEEDS = ['food', 'energy', 'social', 'fun', 'curiosity', 'comfort'];
export const NEED_ZH = { food: '肚子', energy: '體力', social: '想找人玩', fun: '開心', curiosity: '好奇心', comfort: '舒適' };
export const CATEGORIES = ['rest', 'explore', 'play', 'social', 'habit', 'train', 'need', 'cursor', 'trip', 'base'];
export const CATEGORY_ZH = { rest: '休息', explore: '探索', play: '玩耍', social: '找朋友', habit: '習性', train: '練習', need: '找吃的', cursor: '跟滑鼠玩', trip: '出門旅行', base: '回基地' };
export const MOOD_ZH = { happy: '開心', calm: '平靜', lonely: '寂寞', bored: '無聊', sleepy: '想睡', grumpy: '不太高興' };

export const MULT_MIN = 0.25;
export const MULT_MAX = 4;
const BORED_AFTER = 3; // 同一類別連續幾次以後會膩
const BORED_MULT = 0.3;
const THOUGHTS_KEPT = 5;
const RECENT_KEPT = 6;

// 每分鐘下降多少（猜的，可以調）：體力大約 80 分鐘用完、好奇心 40 分鐘、想找人玩 50 分鐘
const DECAY_PER_MIN = { energy: 1.2, social: 2, curiosity: 2.5, comfort: 1 };
const SLEEP_RECOVER_PER_MIN = 8; // 睡覺時體力每分鐘恢復

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;

// ---------- 個性：由性格推出，固定不變 ----------
// [外向, 好奇, 貪吃, 愛睡, 膽小]，0–1（照性格的名字猜的）
const T = (outgoing, curious, greedy, sleepy, timid) => ({ outgoing, curious, greedy, sleepy, timid });
export const NATURE_TRAITS = {
  hardy: T(0.6, 0.5, 0.5, 0.3, 0.2), // 勤奮
  lonely: T(0.8, 0.4, 0.5, 0.4, 0.5), // 怕寂寞
  brave: T(0.7, 0.6, 0.5, 0.3, 0.05), // 勇敢
  adamant: T(0.4, 0.3, 0.6, 0.3, 0.1), // 固執
  naughty: T(0.7, 0.8, 0.6, 0.2, 0.2), // 頑皮
  bold: T(0.7, 0.6, 0.5, 0.3, 0.05), // 大膽
  docile: T(0.5, 0.5, 0.5, 0.5, 0.4), // 坦率
  relaxed: T(0.4, 0.3, 0.6, 0.8, 0.3), // 悠閒
  impish: T(0.7, 0.8, 0.5, 0.3, 0.2), // 淘氣
  lax: T(0.5, 0.4, 0.7, 0.8, 0.2), // 樂天
  timid: T(0.2, 0.4, 0.4, 0.5, 0.9), // 膽小
  hasty: T(0.7, 0.8, 0.5, 0.1, 0.3), // 急躁
  serious: T(0.4, 0.5, 0.4, 0.3, 0.3), // 認真
  jolly: T(0.9, 0.7, 0.6, 0.3, 0.1), // 爽朗
  naive: T(0.8, 0.9, 0.6, 0.4, 0.2), // 天真
  modest: T(0.3, 0.6, 0.4, 0.4, 0.5), // 內斂
  mild: T(0.4, 0.4, 0.5, 0.7, 0.4), // 慢吞吞
  quiet: T(0.2, 0.5, 0.4, 0.5, 0.4), // 冷靜
  bashful: T(0.2, 0.4, 0.5, 0.5, 0.8), // 害羞
  rash: T(0.6, 0.7, 0.7, 0.3, 0.2), // 馬虎
  calm: T(0.4, 0.4, 0.5, 0.6, 0.3), // 溫和
  gentle: T(0.6, 0.4, 0.5, 0.5, 0.4), // 溫順
  sassy: T(0.6, 0.5, 0.6, 0.3, 0.1), // 自大
  careful: T(0.3, 0.5, 0.4, 0.4, 0.6), // 慎重
  quirky: T(0.6, 0.9, 0.5, 0.4, 0.3), // 浮躁
};
export const traitsOf = nature => NATURE_TRAITS[nature] ?? NATURE_TRAITS.hardy;

// ---------- 狀態 ----------
export function createMind(rng) {
  const start = () => Math.round(45 + rng() * 45); // 一開始有高有低，看起來才像有自己的狀態
  return { energy: start(), social: start(), curiosity: start(), comfort: start(), recent: [], thoughts: [] };
}

export function normalizeMind(m, rng = () => 0.5) {
  if (!m || typeof m !== 'object') return createMind(rng);
  const num = (v, d) => (Number.isFinite(v) ? clamp(v, 0, 100) : d);
  return {
    energy: num(m.energy, 70),
    social: num(m.social, 70),
    curiosity: num(m.curiosity, 70),
    comfort: num(m.comfort, 70),
    recent: (Array.isArray(m.recent) ? m.recent : []).filter(c => CATEGORIES.includes(c)).slice(-RECENT_KEPT),
    thoughts: (Array.isArray(m.thoughts) ? m.thoughts : [])
      .filter(t => t && typeof t.text === 'string' && typeof t.key === 'string')
      .slice(-THOUGHTS_KEPT)
      .map(t => ({ key: t.key.slice(0, 40), text: t.text.slice(0, 80), at: Number.isFinite(t.at) ? t.at : 0 })),
  };
}

// 全部六個需求（food、fun 從 mon 換算）
export function levels(mind, mon) {
  return {
    food: clamp(((mon?.fullness ?? 150) / 150) * 100, 0, 100), // 150 以上就不餓
    fun: clamp(((mon?.enjoyment ?? 150) / 200) * 100, 0, 100),
    energy: mind.energy,
    social: mind.social,
    curiosity: mind.curiosity,
    comfort: mind.comfort,
  };
}

// 隨時間變化。activity：'sleep'（睡覺中）、'rest'（坐著、發呆）或其他
export function tickNeeds(mind, seconds, { activity = null, night = false } = {}) {
  const min = seconds / 60;
  if (activity === 'sleep') mind.energy = clamp(mind.energy + SLEEP_RECOVER_PER_MIN * min, 0, 100);
  else mind.energy = clamp(mind.energy - DECAY_PER_MIN.energy * min, 0, 100);
  if (activity === 'sleep' || activity === 'rest') mind.comfort = clamp(mind.comfort + 3 * min, 0, 100);
  else mind.comfort = clamp(mind.comfort - DECAY_PER_MIN.comfort * (night ? 2 : 1) * min, 0, 100);
  mind.social = clamp(mind.social - DECAY_PER_MIN.social * min, 0, 100);
  mind.curiosity = clamp(mind.curiosity - DECAY_PER_MIN.curiosity * min, 0, 100);
  for (const k of ['energy', 'social', 'curiosity', 'comfort']) mind[k] = round1(mind[k]);
  return mind;
}

// 做了這個類別的事：對應的需求被滿足。回傳要加到 mon 上的變化（飽足感、滿足感）
export function satisfy(mind, category, { name = null, food = 100 } = {}) {
  const add = (k, v) => { mind[k] = round1(clamp(mind[k] + v, 0, 100)); };
  const mon = {};
  switch (category) {
    case 'rest':
      add('energy', name === 'nap' || name === 'sleep' ? 25 : 10);
      add('comfort', 15);
      break;
    case 'explore': add('curiosity', 30); add('energy', -2); break;
    case 'play': mon.enjoyment = 5; add('energy', -4); add('curiosity', 5); break;
    case 'social': add('social', 30); mon.enjoyment = 3; break;
    case 'habit': add('curiosity', 12); mon.enjoyment = 3; break;
    case 'train': mon.enjoyment = 4; add('energy', -6); break;
    case 'trip': add('curiosity', 60); break;
    case 'base': add('comfort', 30); add('energy', name === 'goBed' || name === 'homeNight' ? 30 : 5); break;
    case 'cursor': mon.enjoyment = 4; add('curiosity', 10); add('energy', -3); break;
    // 自己找到一點小樹果吃：只夠不餓，吃不飽（餵泡芙還是你的事）
    case 'need': if (food < 100) mon.fullness = 22; break;
    default: break;
  }
  mind.recent = [...mind.recent, category].slice(-RECENT_KEPT);
  return mon;
}

// 被別人拉去一起玩（不是自己決定的）也算滿足了想找人玩
export function socialized(mind, amount = 15) {
  mind.social = round1(clamp(mind.social + amount, 0, 100));
}

// 同一類別最近連續做了幾次
export function streakOf(mind) {
  const r = mind.recent;
  if (!r.length) return { cat: null, n: 0 };
  let n = 0;
  for (let i = r.length - 1; i >= 0 && r[i] === r.at(-1); i--) n++;
  return { cat: r.at(-1), n };
}

// ---------- 心情 ----------
export function moodOf(lv, { lostRecently = false } = {}) {
  if (lv.energy < 25) return 'sleepy';
  if (lv.food < 20 || lostRecently) return 'grumpy';
  if (lv.social < 25) return 'lonely';
  if (lv.fun < 25 || lv.curiosity < 20) return 'bored';
  const avg = NEEDS.reduce((s, k) => s + lv[k], 0) / NEEDS.length;
  return avg >= 65 ? 'happy' : 'calm';
}

// ---------- 每個類別的倍率 ----------
const def = v => (100 - v) / 100; // 缺多少 0–1
export function weights(mind, lv, traits, ctx = {}) {
  const tr = traits;
  const urge = {
    rest: Math.max(def(lv.energy), def(lv.comfort) * 0.7) * (0.8 + tr.sleepy * 0.5),
    explore: def(lv.curiosity) * (0.6 + tr.curious * 0.8),
    play: def(lv.fun) * 0.8 + (lv.energy > 60 ? 0.15 : 0),
    social: def(lv.social) * (0.4 + tr.outgoing * 0.9),
    habit: (def(lv.fun) + def(lv.curiosity)) * 0.4 + 0.1,
    train: def(lv.fun) * 0.4 + (lv.energy > 50 ? 0.15 : 0) + (ctx.rival ? 0.3 : 0),
    need: lv.food < 70 ? def(lv.food) * (0.8 + tr.greedy * 0.8) : 0,
    // 跟你的游標玩：好奇、外向的比較愛玩，膽小的會躲；你不在電腦前就不玩
    // 回秘密基地：累了、想找個舒服的地方
    base: Math.max(def(lv.energy), def(lv.comfort)) * (0.6 + tr.sleepy * 0.5) + 0.1,
    // 出門旅行：越好奇、越無聊越想去；不能出發的時候（已經有別隻在外面…）就不會想
    trip: ctx.canTrip ? (def(lv.curiosity) * 0.7 + def(lv.fun) * 0.3) * (0.4 + tr.curious) : 0,
    cursor: ctx.userActive ? ((def(lv.fun) * 0.6 + def(lv.curiosity) * 0.4) * (0.6 + tr.curious * 0.5 + tr.outgoing * 0.4) + 0.15) * (1 - tr.timid * 0.7) : 0,
  };
  const out = {};
  const { cat: sCat, n } = streakOf(mind);
  for (const c of CATEGORIES) {
    let m = 0.4 + urge[c] * 3; // 缺越多越想做
    if (c === 'need' && lv.food >= 70) m = MULT_MIN; // 不餓就不會去找吃的
    if (c === 'cursor' && !ctx.userActive) m = MULT_MIN;
    if (c === 'trip' && !ctx.canTrip) m = MULT_MIN;
    if (c === 'rest' && ctx.bedFree && lv.energy < 30) m *= 0.4; // 有床可以睡，就不想在地上打瞌睡
    if (c === sCat && n >= BORED_AFTER) m *= BORED_MULT; // 做膩了
    out[c] = clamp(m, MULT_MIN, MULT_MAX);
  }
  return out;
}

// ---------- 理由 ----------
// 每個類別有幾種情況，每種情況有好幾句。{name}＝對方的名字。
// 理由的 key 是「類別.情況」；cites 說明這句提到的是需求、關係或記憶（測試會檢查）
export const REASONS = {
  rest: {
    energy: ['好睏…先休息一下', '走累了，坐下來喘口氣', '眼皮好重，瞇一下就好', '今天動太多了，要充電'],
    comfort: ['找個舒服的姿勢待著', '想安安靜靜地待一下', '這裡涼涼的，好舒服'],
    calm: ['沒什麼事，發呆也不錯', '看看桌面，放空一下', '慢慢來，不急'],
  },
  explore: {
    peeker: ['外面好像有誰在看？', '螢幕邊邊有東西！', '剛剛好像有誰探頭進來'],
    curiosity: ['好奇那邊有什麼', '那邊好像有東西，去看看！', '想到處走走，一直待著好悶', '剛剛好像聽到什麼聲音'],
    calm: ['隨便走走', '散個步', '換個地方待待看'],
  },
  play: {
    fun: ['好無聊，動一動！', '想找點好玩的事', '沒事做，來轉個圈'],
    happy: ['心情好好，想跳一跳', '精神很好，跑起來！', '今天感覺很棒'],
    memory: ['剛剛吃了好吃的，好有精神！', '剛剛被摸摸，好開心', '被摸摸以後精神好好'],
  },
  social: {
    friend: ['想找好朋友{name}玩', '{name}在那邊！過去找牠', '跟{name}在一起最開心'],
    lonely: ['一個人好無聊，去找{name}', '好想有人陪，{name}在嗎？', '有點寂寞，去黏{name}'],
    rival: ['上次輸給{name}，這次不會輸', '{name}又在得意了，去挑戰牠', '要讓{name}知道誰比較厲害'],
    memory: ['上次跟{name}玩得好開心，再玩一次', '還記得跟{name}一起玩，想再玩', '{name}上次陪我，這次換我找牠'],
    calm: ['去看看{name}在做什麼', '跟{name}打個招呼', '順路去找{name}'],
  },
  habit: {
    self: ['這是我的習慣', '每天都要做這個', '身體自己就動起來了'],
    curiosity: ['想起來一件想做的事', '突然想試試看', '好久沒做這個了'],
  },
  train: {
    drive: ['想變得更強！', '來練習一下招式', '要多練習才會進步'],
    rival: ['上次輸給{name}，要多練習', '下次一定要贏{name}', '為了打贏{name}，練習！'],
  },
  cursor: {
    fun: ['那個箭頭在動！抓住它！', '好無聊…跟箭頭玩！', '箭頭跑來跑去，好好玩'],
    curiosity: ['那個尖尖的是什麼？', '箭頭又出現了，去看看', '想知道箭頭會跑去哪裡'],
    calm: ['你在忙嗎？我陪你', '靠過去看看你在做什麼', '在你旁邊待一下'],
    memory: ['上次坐在箭頭旁邊被嚇到…這次要小心', '箭頭上次突然跑掉，這次要抓住', '記得箭頭會突然動，好刺激'],
  },
  base: {
    energy: ['好累，回床上睡覺', '想念基地的床', '回家睡一下'],
    comfort: ['回基地待著最安心', '想回家坐坐', '基地最舒服了'],
    night: ['晚上了，回基地睡覺', '大家一起回家睡', '天黑了，回家'],
    calm: ['回基地看看', '去院子裡走走', '看看家裡有沒有什麼新東西'],
  },
  trip: {
    curiosity: ['想去遠一點的地方看看', '好想知道螢幕外面有什麼', '出發去冒險！'],
    bored: ['桌面待膩了，出去走走', '每天都一樣，想去旅行', '出去玩一下再回來'],
    memory: ['上次有誰從外面探頭，外面一定很好玩', '想去看看探頭的那隻是從哪裡來的', '外面好像有好多寶可夢，去找牠們'],
  },
  need: {
    food: ['肚子咕嚕叫，找找有沒有樹果', '好餓…附近應該有吃的', '想吃東西，去找找看', '肚子餓扁了'],
  },
};
const CITES = { night: null, bored: 'need', peeker: 'memory', energy: 'need', comfort: 'need', curiosity: 'need', fun: 'need', food: 'need', lonely: 'need', friend: 'relation', rival: 'relation', memory: 'memory' };
export const citesOf = key => CITES[key.split('.')[1]] ?? null;

// 需求低於大約 60 就會在理由裡說出來（門檻是猜的，可以調）
// ctx：{ other: { name, bond, rivalry }（有對象時）, recentFed, recentStroke, playedWithOther }
export function reason(category, lv, rng, ctx = {}) {
  const other = ctx.other;
  let sub;
  switch (category) {
    case 'rest': sub = lv.energy < 60 ? 'energy' : lv.comfort < 60 ? 'comfort' : 'calm'; break;
    case 'explore': sub = lv.curiosity < 65 ? 'curiosity' : 'calm'; break;
    case 'play': sub = ctx.recentFed || ctx.recentStroke ? 'memory' : lv.fun < 55 ? 'fun' : 'happy'; break;
    case 'social':
      if (!other) { sub = null; break; }
      sub = other.rivalry >= 2 && other.rivalry * 20 > other.bond ? 'rival'
        : ctx.playedWithOther ? 'memory'
        : other.bond >= 60 ? 'friend'
        : lv.social < 50 ? 'lonely' : 'calm';
      break;
    case 'habit': sub = lv.curiosity < 55 ? 'curiosity' : 'self'; break;
    case 'train': sub = other && other.rivalry >= 1 ? 'rival' : 'drive'; break;
    case 'need': sub = 'food'; break;
    case 'base': sub = ctx.night ? 'night' : lv.energy < 50 ? 'energy' : lv.comfort < 70 ? 'comfort' : 'calm'; break;
    case 'trip': sub = ctx.sawPeeker ? 'memory' : lv.curiosity < 55 ? 'curiosity' : 'bored'; break;
    case 'cursor': sub = ctx.cursorSurprised ? 'memory' : lv.fun < 55 ? 'fun' : lv.curiosity < 65 ? 'curiosity' : 'calm'; break;
    default: sub = null;
  }
  if (category === 'social' && !sub) {
    // 一群一起玩（還不知道對象是誰）
    const list = lv.social < 50 ? ['一個人好無聊，想大家一起玩', '好想有人陪'] : ['想跟大家一起玩', '大家來玩吧！'];
    return { key: lv.social < 50 ? 'social.lonely' : 'social.group', text: list[Math.floor(rng() * list.length)] };
  }
  if (category === 'play' && sub === 'memory') {
    const list = ctx.recentFed ? REASONS.play.memory.slice(0, 1) : REASONS.play.memory.slice(1);
    return { key: 'play.memory', text: list[Math.floor(rng() * list.length)] };
  }
  const list = REASONS[category]?.[sub];
  if (!list) return { key: `${category}.none`, text: '想做就做' };
  const text = list[Math.floor(rng() * list.length)].replaceAll('{name}', other?.name ?? '大家');
  return { key: `${category}.${sub}`, text };
}

// 記下這次的想法（夥伴資料頁顯示最近 5 個）
export function think(mind, thought, now) {
  mind.thoughts = [...mind.thoughts, { key: thought.key, text: thought.text, at: now }].slice(-THOUGHTS_KEPT);
}
