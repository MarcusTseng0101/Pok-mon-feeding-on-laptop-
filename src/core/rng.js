// 可指定種子的亂數（mulberry32），測試時才能重現結果。
export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // 含兩端
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.chance = p => rng() < p;
  // items: [{ w, ... }]，權重 0 的不會被選到
  rng.weighted = items => {
    const total = items.reduce((s, it) => s + it.w, 0);
    if (total <= 0) return null;
    let r = rng() * total;
    for (const it of items) {
      if ((r -= it.w) < 0) return it;
    }
    return items.findLast(it => it.w > 0);
  };
  return rng;
}
