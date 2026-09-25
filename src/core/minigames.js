// 寶可夢交流的小遊戲：計分與獎勵的規則（畫面在 renderer/ui/minigames）。
// 這裡只放純函式，不碰 DOM，node --test 可以直接測。
//
// 經濟平衡：原本拿泡芙的方式是每日禮物（3 個）＋夥伴撿到（大約每小時 1 個）。
// 做泡芙不能比這個更划算，所以每天最多做 DAILY_BAKES 個，豪華泡芙每天最多 1 個。

import { BERRIES } from './amie.js';

// ---------- 摘樹果 ----------
export const BERRY_GAME_SECONDS = 30;
// 五種樹果掉下來的機率（猜的，可調整：平均）
export const BERRY_WEIGHTS = Object.fromEntries(Object.keys(BERRIES).map(b => [b, 1]));
export const MAX_BERRIES_PER_GAME = 15; // 一場最多帶回幾顆

export function rollBerry(rng) {
  return rng.weighted(Object.entries(BERRY_WEIGHTS).map(([b, w]) => ({ b, w }))).b;
}

// ---------- 做泡芙 ----------
export const BERRIES_PER_PUFF = 3;
export const DAILY_BAKES = 5; // 猜的，可調整
export const DAILY_DELUXE = 1;

// 口味：用最多的那種樹果；一樣多就用先放進去的
export function puffFlavor(berries) {
  const count = new Map();
  for (const b of berries) count.set(b, (count.get(b) ?? 0) + 1);
  let best = berries[0];
  for (const b of berries) if (count.get(b) > count.get(best)) best = b;
  return BERRIES[best];
}

const clamp01 = v => Math.max(0, Math.min(1, v));

// 攪拌：samples 是每 0.1 秒量一次的角速度（弧度／秒，正負表示方向）。
// 要轉夠圈數（3 圈），而且速度穩定（變異係數小）。滿分 40
export const STIR_MAX = 40;
export function stirScore(samples) {
  if (samples.length < 5) return 0;
  const speeds = samples.map(Math.abs);
  const turns = speeds.reduce((a, b) => a + b, 0) * 0.1 / (2 * Math.PI);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  if (mean < 1e-6) return 0;
  const sd = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / speeds.length);
  const steady = 1 - clamp01((sd / mean - 0.15) / 0.6); // 變異係數 0.15 以下算完全穩定（猜的）
  // 一直換方向不算攪拌
  const flips = samples.slice(1).filter((s, i) => Math.sign(s) && Math.sign(samples[i]) && Math.sign(s) !== Math.sign(samples[i])).length;
  const oneWay = 1 - clamp01(flips / 6);
  return Math.round(STIR_MAX * clamp01(turns / 3) * steady * oneWay);
}

// 烘烤：在指示條走到中間的時候按下。error 是離正中間幾秒。滿分 35
export const BAKE_MAX = 35;
export const bakeScore = error => Math.round(BAKE_MAX * clamp01(1 - Math.abs(error) / 0.8));

// 裝飾：在泡芙上點最多 5 個點，點得分散比較漂亮。points 是 0–1 的座標。滿分 25
export const DECO_MAX = 25;
export const DECO_POINTS = 5;
export function decoScore(points) {
  const p = points.slice(0, DECO_POINTS);
  if (!p.length) return 0;
  let minGap = 1;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) minGap = Math.min(minGap, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
  const spread = p.length === 1 ? 1 : clamp01(minGap / 0.2);
  return Math.round(DECO_MAX * (p.length / DECO_POINTS) * spread);
}

// 總分 → 泡芙等級（分界是猜的，可調整）
export const TIER_CUTS = [[90, 'deluxe'], [70, 'fancy'], [40, 'frosted'], [0, 'basic']];
export function bakeTier(score) {
  return TIER_CUTS.find(([at]) => score >= at)[1];
}

// 每天的上限：超過豪華泡芙的上限就降一級
export function cappedTier(tier, today) {
  if (tier === 'deluxe' && today.deluxe >= DAILY_DELUXE) return 'fancy';
  return tier;
}

// ---------- 頭球 ----------
export const HEADIT_MAX_AFFECTION = 15;
export const headItAffection = streak => Math.min(HEADIT_MAX_AFFECTION, Math.max(0, Math.floor(streak)));

// ---------- 拼圖 ----------
export const PUZZLE_SIZE = 3;
export const PUZZLE_ENJOYMENT = 20;

// 打亂（一定跟原本不一樣）；tiles[i] = 第 i 格放的是哪一片
export function shufflePuzzle(rng, n = PUZZLE_SIZE * PUZZLE_SIZE) {
  const tiles = [...Array(n).keys()];
  do {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
  } while (tiles.every((t, i) => t === i));
  return tiles;
}
export const puzzleSolved = tiles => tiles.every((t, i) => t === i);

// ---------- 超級特訓 ----------
export const TRAINING_SECONDS = 20;
export const TRAINING_PER_POP = 4; // 打破一個氣球加多少（猜的，可調整）
export const TRAINING_STAT_ZH = { hp: 'HP', atk: '攻擊', def: '防禦', spa: '特攻', spd: '特防', spe: '速度' };

// 切磋時訓練差距對命中的影響：最多 ±15%（猜的，可調整）。
// 不能超過 ±15%，不然剛抓到的寶可夢永遠打不贏已經特訓過的。
export const DUEL_EDGE_MAX = 0.15;
export const trainingTotal = t => Object.values(t ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
export function duelEdge(attacker, defender) {
  const diff = (trainingTotal(attacker) - trainingTotal(defender)) / 510;
  return 1 + DUEL_EDGE_MAX * Math.max(-1, Math.min(1, diff));
}
// 切磋時招式打中的機率：基本 80%，依訓練差距 ±15%
export const DUEL_BASE_HIT = 0.8;
export const duelHitChance = (attacker, defender) => Math.min(0.98, DUEL_BASE_HIT * duelEdge(attacker, defender));

// 每日計數：換日就歸零
export function todayCounters(state, day) {
  const m = state.minigames;
  if (m.day !== day) Object.assign(m, { day, baked: 0, deluxe: 0 });
  return m;
}

