// 孵蛋：感情很好（最好的朋友）的兩隻夥伴都在桌面上時，每天有一次機會找到蛋。
// 蛋靠「步數」孵化：游標移動的距離＋在電腦前操作的時間（不讀鍵盤，只看閒置時間）。
import { EGG_DATA } from './eggdata.js';
import { FORMS, inheritForm } from './forms.js';

export const EGG_CHANCE = 0.5; // 每天找到蛋的機率（猜的，可調整）
export const PX_PER_STEP = 1000; // 游標移動 1000 CSS 像素 = 1 步
export const SECONDS_PER_STEP = 10; // 在電腦前 10 秒 = 1 步
// 一個孵化週期幾步。一般使用一天大約 2000–3000 步，這樣 20 週期（大部分的寶可夢）要 1–2 天、40 週期（黏黏寶）2–3 天。猜的，可調整
export const STEPS_PER_CYCLE = 120;
export const HATCH_AFFECTION = 30; // 剛孵出來就有一點好感（猜的）

export const canBreed = species => Boolean(EGG_DATA[species]) && !EGG_DATA[species].groups.includes('no-eggs');
export const eggNeed = species => (EGG_DATA[species]?.cycles ?? 20) * STEPS_PER_CYCLE;
export const stepsFrom = (px, activeSeconds) => Math.max(0, px) / PX_PER_STEP + Math.max(0, activeSeconds) / SECONDS_PER_STEP;

// 進化線最前面的那一隻（火狐狸 ← 長尾火狐 ← 妖火紅狐）
export function baseForm(dex, species) {
  let s = species;
  for (let i = 0; i < 5; i++) {
    const from = dex.get(s)?.evolvesFrom;
    if (!from || !dex.has(from)) break;
    s = from;
  }
  return s;
}

// 兩隻父母會生出什麼：其中一隻（會生蛋的）的最初型態，花色／花紋跟著牠；多麗米亞的造型不會遺傳
export function eggFrom(dex, parents, rng) {
  const ok = parents.filter(m => canBreed(m.species));
  if (!ok.length) return null;
  const p = ok[Math.floor(rng() * ok.length)];
  const species = baseForm(dex, p.species);
  const form = FORMS[p.species]?.family === 'furfrou' ? null : inheritForm(p.species, species, p.form);
  return { species, form, parent: p.uid };
}
