// 捕獲：沒有對戰、不會削血，所以用「捕獲率 × 球 × 投擲時機 × 泡芙」取代原作的 HP 公式。
// 原作滿血時傳說寶可夢幾乎抓不到；這裡讓最難的也有約一成機會（高級球 + 完美時機 + 喜歡的泡芙）。

export const BALLS = {
  poke: { zh: '精靈球', mult: 1 },
  great: { zh: '超級球', mult: 1.5 },
  ultra: { zh: '高級球', mult: 2 },
};
export const BALL_ORDER = ['poke', 'great', 'ultra'];

// 目標圈會在 1 → RING_MIN 之間縮放；在圈越小時丟出，加成越高
export const RING_MIN = 0.3;
export function ringBonus(ring) {
  if (ring <= 0.45) return { label: 'Excellent!', zh: '超棒！', mult: 1.7 };
  if (ring <= 0.65) return { label: 'Great!', zh: '很好！', mult: 1.35 };
  if (ring <= 0.85) return { label: 'Nice!', zh: '不錯！', mult: 1.1 };
  return { label: null, zh: null, mult: 1 };
}

export const PUFF_BONUS = { none: 1, neutral: 1.4, disliked: 1.15, liked: 1.8 };

export function catchProbability(captureRate, { ball = 'poke', ringMult = 1, puff = 'none' } = {}) {
  const base = Math.pow(captureRate / 255, 0.75) * 0.85;
  const p = base * BALLS[ball].mult * ringMult * PUFF_BONUS[puff];
  return Math.max(0.02, Math.min(0.97, p));
}

// 球會搖三下；每一下都用 p^(1/3) 判定，三下都過才算抓到，所以總機率仍是 p。
// 回傳搖了幾下（0–3），讓畫面照著演。
export function rollCatch(p, rng) {
  const perShake = Math.pow(p, 1 / 3);
  let shakes = 0;
  while (shakes < 3 && rng() < perShake) shakes++;
  return { shakes, caught: shakes === 3 };
}

// 沒抓到時逃跑的機率：越容易抓的越不怕人；給過泡芙會更安心。傳說／幻之寶可夢很少逃跑。
export function fleeChance(species, { puffed = false, failedThrows = 1 } = {}) {
  if (species.legendary || species.mythical) return 0.04;
  const base = 0.08 + (1 - species.captureRate / 255) * 0.18 + (failedThrows - 1) * 0.05;
  return Math.min(0.6, puffed ? base * 0.4 : base);
}
