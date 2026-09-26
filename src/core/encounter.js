// 遭遇：野生寶可夢會從桌面上的「氣息點」冒出來（草叢、水窪、天空的影子……）。
// 出現哪一隻取決於現實的時間、你的電腦狀態，以及你放在桌面上的泡芙誘餌。
// 流程：planSpawn() 決定這次是誰、從哪種氣息點出來 → 畫面生成氣息點 → 點擊後遭遇。

import { hearts } from './amie.js';
import { shinyChance, chainSpawnMult } from './shiny.js';
import { FORMS, canonicalForm } from './forms.js';
import { vivillonForTimeZone } from './vivillon.js';
import { WEATHER_MODS, weatherMultiplier } from './weather.js';

export const FLAVOR_TYPES = {
  sweet: ['fairy', 'normal'],
  mint: ['grass', 'water', 'ice'],
  citrus: ['electric', 'bug', 'flying'],
  mocha: ['dark', 'ghost', 'psychic', 'rock', 'steel', 'ground'],
  spice: ['fire', 'fighting', 'dragon', 'poison'],
};

const SPECIAL_IDS = new Set([700, 716, 717, 718, 719, 720, 721]);
const STAGE_MULT = [0, 1, 0.3, 0.06];

// 各時段：清晨 5–10、白天 10–17、黃昏 17–19、夜晚 19–5
export function timeOfDay(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

const SPOT_BIAS = {
  morning: { grass: 1, puddle: 1, sky: 1.3, rock: 1, dusk: 0.2 },
  day: { grass: 1, puddle: 1, sky: 1, rock: 1, dusk: 0.2 },
  dusk: { grass: 1, puddle: 1, sky: 1, rock: 1, dusk: 1 },
  night: { grass: 0.8, puddle: 1, sky: 0.7, rock: 1, dusk: 2 },
};

// ctx: { hour, weekday(0=日), cpuHot, justPluggedIn, returnedFromIdle, lure: flavor|null, lureTier, weather: 'rain'|'sun'|…|null }
// 回傳目前生效的「氣息」，UI 會把 zh 列出來讓玩家知道現在容易遇到什麼。
export function activeModifiers(ctx, dex) {
  const mods = [];
  const byType = (types, mult) => id => (dex.get(id).types.some(t => types.includes(t)) ? mult : 1);
  const tod = timeOfDay(ctx.hour);
  if (tod === 'night') mods.push({ id: 'night', zh: '夜晚：幽靈、惡屬性的寶可夢活躍起來了', mult: id => byType(['ghost', 'dark'], 2.5)(id) * ([714, 715, 698].includes(id) ? 2 : 1) });
  if (tod === 'morning') mods.push({ id: 'morning', zh: '清晨：草、蟲、飛行屬性的寶可夢醒來了', mult: byType(['grass', 'bug', 'flying'], 1.6) });
  if (tod === 'day') mods.push({ id: 'day', zh: '白天：一般、格鬥、電屬性的寶可夢到處跑', mult: byType(['normal', 'fighting', 'electric'], 1.4) });
  if (tod === 'dusk') mods.push({ id: 'dusk', zh: '黃昏：超能力、妖精屬性的寶可夢出來散步', mult: byType(['psychic', 'fairy'], 1.8) });
  if (ctx.weekday === 0 || ctx.weekday === 6) mods.push({ id: 'weekend', zh: '週末：妖精屬性的寶可夢出來玩了', mult: byType(['fairy'], 2) });
  if (ctx.cpuHot) mods.push({ id: 'cpuHot', zh: '電腦好燙：火屬性的寶可夢被熱氣吸引過來', mult: byType(['fire'], 3) });
  if (ctx.justPluggedIn) mods.push({ id: 'plugged', zh: '剛接上電源：電屬性的寶可夢聚集過來', mult: byType(['electric'], 4) });
  if (ctx.returnedFromIdle) mods.push({ id: 'welcome', zh: '你回來了：好奇的超能力寶可夢在偷看', mult: byType(['psychic'], 3) });
  if (WEATHER_MODS[ctx.weather]) mods.push({ id: `weather-${ctx.weather}`, zh: WEATHER_MODS[ctx.weather].zh, mult: id => weatherMultiplier(ctx.weather, dex.get(id).types, id) });
  if (ctx.lure) mods.push({ id: 'lure', zh: `泡芙誘餌：喜歡這個香味的寶可夢會靠近（${FLAVOR_TYPES[ctx.lure].map(t => dex.typeName(t)).join('、')}）`, mult: byType(FLAVOR_TYPES[ctx.lure], 3) });
  return mods;
}

export function speciesWeights(ctx, state, dex) {
  const mods = activeModifiers(ctx, dex);
  const bias = SPOT_BIAS[timeOfDay(ctx.hour)];
  const bestAffection = Math.max(0, ...state.mons.map(m => m.affection));
  return dex.ids
    .filter(id => !SPECIAL_IDS.has(id) || (id === 700 && hearts(bestAffection) >= 5))
    .map(id => {
      const s = dex.get(id);
      let w = Math.pow(s.captureRate, 0.7) * STAGE_MULT[Math.min(3, dex.stage(id))];
      w *= bias[dex.habitat(id)] ?? 1;
      for (const m of mods) w *= m.mult(id);
      w *= chainSpawnMult(state, id);
      return { id, w };
    });
}

const caughtCount = state => Object.values(state.dex).filter(d => d.caught > 0).length;
const hasCaught = (state, id) => (state.dex[id]?.caught ?? 0) > 0;

// 傳說與幻之寶可夢：各有自己的出現條件，條件成立時每次生成有小機率改成牠。
export function rollSpecial(ctx, state, rng) {
  const n = caughtCount(state);
  const again = id => (hasCaught(state, id) ? 0.25 : 1); // 已經抓過的，再遇到的機會變低
  if (state.zygardeCells >= 10 && !hasCaught(state, 718)) return 718;
  const tod = ctx.hour;
  const rolls = [
    { id: 716, ok: n >= 30 && tod >= 5 && tod < 8, p: 0.04 }, // 清晨的七色光：哲爾尼亞斯
    { id: 717, ok: n >= 30 && tod >= 0 && tod < 4, p: 0.04 }, // 深夜：伊裴爾塔爾
    { id: 719, ok: n >= 45 && hasCaught(state, 703), p: 0.05 }, // 抓過小碎鑽：蒂安希
    { id: 720, ok: n >= 50, p: 0.03 }, // 胡帕的圓環
    { id: 721, ok: n >= 50 && ctx.cpuHot, p: 0.06 }, // 電腦很燙的蒸氣：波爾凱尼恩
  ];
  for (const r of rolls) if (r.ok && rng.chance(r.p * again(r.id))) return r.id;
  return null;
}

const SPECIAL_SPOT = { 716: 'rock', 717: 'sky', 718: 'rock', 719: 'rock', 720: 'ring', 721: 'puddle' };

// 野生寶可夢的形態：花蓓蓓一族隨機花色；粉蝶蟲一族依玩家所在地區決定花紋（跟原作一樣一個地區一種）
const FLABEBE_WEIGHTS = { red: 1, yellow: 1, orange: 1, blue: 1, white: 1 }; // 猜的，可調整：原作各顏色出現的地點不同，這裡平均
export function rollForm(speciesId, ctx, rng) {
  const family = FORMS[speciesId]?.family;
  if (family === 'flabebe') return canonicalForm(speciesId, rng.weighted(Object.entries(FLABEBE_WEIGHTS).map(([f, w]) => ({ f, w }))).f);
  if (family === 'vivillon') return canonicalForm(speciesId, ctx.vivillon ?? vivillonForTimeZone(ctx.timeZone));
  return null; // 野生的多麗米亞都是原本的樣子
}

// 決定下一次生成：{ spot, speciesId, form, shiny, nature, special }
export function planSpawn(ctx, state, dex, rng) {
  const special = rollSpecial(ctx, state, rng);
  const speciesId = special ?? rng.weighted(speciesWeights(ctx, state, dex)).id;
  return {
    speciesId,
    form: rollForm(speciesId, ctx, rng),
    spot: SPECIAL_SPOT[speciesId] ?? dex.habitat(speciesId),
    shiny: rng.chance(shinyChance(state, speciesId, ctx)),
    nature: rng.pick(dex.natures).slug,
    special: special !== null,
  };
}

// 基格爾德核心：抓到 20 種之後，每次生成有機會在桌面上掉一顆，集滿 10 顆會引來基格爾德。
export function shouldDropCell(state, rng) {
  return caughtCount(state) >= 20 && state.zygardeCells < 10 && !hasCaught(state, 718) && rng.chance(0.12);
}

// 兩次生成之間的間隔（毫秒）
export const RATES = {
  low: { zh: '少', min: 15, max: 30 },
  normal: { zh: '普通', min: 6, max: 14 },
  high: { zh: '多', min: 2, max: 5 },
};
export function nextSpawnDelay(rate, ctx, rng, { dev = false } = {}) {
  if (dev) return rng.range(8, 15) * 1000;
  const r = RATES[rate] ?? RATES.normal;
  let minutes = rng.range(r.min, r.max);
  if (ctx.lure) minutes *= 0.4;
  if (ctx.returnedFromIdle) minutes = Math.min(minutes, rng.range(0.3, 0.7));
  return minutes * 60 * 1000;
}

// ---------- 探頭：野生寶可夢從螢幕邊緣只露出半個身體，慢慢靠近牠才會進來 ----------
// 跟一般氣息點共用同一個出現時間（nextSpawnAt），不會讓野生寶可夢變多。
// 每 3 次出現最多 1 次用探頭的方式：前 2 次都不是探頭，才有機會。
export const PEEK_CHANCE = 0.5; // 猜的，可以調
export function shouldPeek(recent, plan, rng) {
  if (plan.special) return false; // 傳說、幻之寶可夢維持原本的出場方式
  if (recent.slice(-2).includes('peek')) return false;
  return rng() < PEEK_CHANCE;
}
