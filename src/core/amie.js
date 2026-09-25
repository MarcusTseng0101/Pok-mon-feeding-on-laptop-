// 寶可夢交流的數值：好感度（affection）、飽足感（fullness）、滿足感（enjoyment）、成長（xp）。
// 三個條都是 0–255，跟 X/Y 的寶可夢交流一樣；好感度換算成 0–5 顆心。
// 下面的數字是依「每天摸一摸、餵幾次，三到五天滿好感」估的，不是原作數值。

export const MAX = 255;
export const HEART_THRESHOLDS = [1, 50, 100, 150, 255];

export const FLAVORS = ['sweet', 'mint', 'citrus', 'mocha', 'spice'];
export const FLAVOR_ZH = { sweet: '甜甜', mint: '薄荷', citrus: '柑橘', mocha: '摩卡', spice: '辛辣' };
// 泡芙口味對應性格喜好的五種味道（辣、酸、甜、澀、苦）
export const FLAVOR_TASTE = { sweet: 'sweet', mint: 'dry', citrus: 'sour', mocha: 'bitter', spice: 'spicy' };
export const TASTE_ZH = { sweet: '甜', dry: '澀', sour: '酸', bitter: '苦', spicy: '辣' };

export const TIERS = {
  basic: { zh: '', fullness: 40, affection: 3, xp: 4 },
  frosted: { zh: '糖霜', fullness: 50, affection: 5, xp: 6 },
  fancy: { zh: '精緻', fullness: 60, affection: 9, xp: 9 },
  deluxe: { zh: '豪華', fullness: 70, affection: 16, xp: 14 },
};
export const TIER_ORDER = ['basic', 'frosted', 'fancy', 'deluxe'];

export const puffKey = (flavor, tier) => `${flavor}-${tier}`;
export const parsePuffKey = key => {
  const [flavor, tier] = key.split('-');
  return { flavor, tier };
};
export const puffName = key => {
  const { flavor, tier } = parsePuffKey(key);
  return `${TIERS[tier].zh}${FLAVOR_ZH[flavor]}泡芙`;
};

export const FULL_REFUSE = 215; // 超過就吃不下了
const STROKE_ENJOY = 5;
const STROKE_AFFECTION = 0.5;
const DECAY_FULLNESS_MIN = 2; // 每 2 分鐘 −1
const DECAY_ENJOY_MIN = 1; // 每 1 分鐘 −1

const clamp = v => Math.max(0, Math.min(MAX, v));

export function hearts(affection) {
  return HEART_THRESHOLDS.filter(t => affection >= t).length;
}

export function tasteReaction(nature, flavor) {
  const taste = FLAVOR_TASTE[flavor];
  if (!nature?.likes) return 'neutral';
  if (nature.likes === taste) return 'liked';
  if (nature.hates === taste) return 'disliked';
  return 'neutral';
}

// 經過 minutes 分鐘，飽足感與滿足感慢慢下降；好感度不會下降。
export function applyDecay(mon, minutes) {
  if (minutes <= 0) return;
  mon.fullness = clamp(mon.fullness - minutes / DECAY_FULLNESS_MIN);
  mon.enjoyment = clamp(mon.enjoyment - minutes / DECAY_ENJOY_MIN);
}

// 摸一下（游標在寶可夢身上來回滑過一次）。滿足感滿了之後，好感度不再因為摸而增加。
export function stroke(mon) {
  const before = mon.enjoyment;
  mon.enjoyment = clamp(mon.enjoyment + STROKE_ENJOY);
  let affectionGain = 0;
  if (before < MAX) {
    affectionGain = addAffection(mon, STROKE_AFFECTION);
    mon.xp += STROKE_AFFECTION;
  }
  return { affectionGain, enjoymentFull: mon.enjoyment >= MAX };
}

export function addAffection(mon, amount) {
  const before = mon.affection;
  mon.affection = clamp(mon.affection + amount);
  return mon.affection - before;
}

export function feed(mon, puff, nature) {
  const { flavor, tier } = parsePuffKey(puff);
  const t = TIERS[tier];
  if (!t || !FLAVOR_TASTE[flavor]) return { ok: false, reason: 'unknown-puff' };
  if (mon.fullness >= FULL_REFUSE) return { ok: false, reason: 'full' };
  const reaction = tasteReaction(nature, flavor);
  const mult = reaction === 'liked' ? 1.5 : reaction === 'disliked' ? 0.5 : 1;
  mon.fullness = clamp(mon.fullness + t.fullness);
  if (reaction === 'liked') mon.enjoyment = clamp(mon.enjoyment + 20);
  const affectionGain = addAffection(mon, t.affection * mult);
  const xpGain = t.xp * mult;
  mon.xp += xpGain;
  if (reaction !== 'neutral') mon.tasteKnown = true; // 吃過喜歡或討厭的口味，就會知道牠的喜好
  return { ok: true, reaction, affectionGain, xpGain };
}

// 待在桌面上陪伴的時間：每 20 分鐘 +1 好感，每 10 分鐘 +1 成長
export function together(mon, minutes) {
  addAffection(mon, minutes / 20);
  mon.xp += minutes / 10;
}
