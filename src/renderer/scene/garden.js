// 桌面的生氣（規則在 core/symbiosis.js）：今天做到的好事越多，螢幕下緣的花草長得越多（0～3 級）；
// 過去幾天留下的小花排在下緣中間，像一週的足跡。只是畫面：不能點、不擋滑鼠、不出聲。
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';

const PER_LEVEL = 14; // 每一級多長幾叢草（猜的，可調整）
const ZOOM = 2; // 比其他小東西大一倍：花草是整片的背景，太小就看不出來
const GROW_PER_SEC = 0.6; // 長出來的速度（級／秒）

// 固定的「亂數」：同一個位置每次都長一樣的東西，畫面不會閃
const hash = i => { let x = (i + 1) * 2654435761; x ^= x >>> 13; x = Math.imul(x, 1597334677); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export class Garden {
  // view()：{ bloom, flowers }（Game.symbiosisView()）
  constructor(stage, view) {
    this.stage = stage;
    this.view = view;
    this.shown = null; // 畫面上現在長到幾級（慢慢追上 bloom）
  }

  update(dt) {
    const v = this.view?.();
    const target = v?.bloom ?? 0;
    if (this.shown === null) this.shown = target; // 一打開就是今天的樣子，不用重新長一次
    this.shown += Math.sign(target - this.shown) * Math.min(Math.abs(target - this.shown), GROW_PER_SEC * dt);
  }

  // 第 i 叢長在哪、是什麼（草或花）
  tuft(i) {
    const st = this.stage;
    // 黃金比例的間隔：不管長到第幾叢都平均散開（第 1 級也不會都擠在左邊），再加一點點亂
    const u = (i * 0.6180339887 + 0.05 + (hash(i) - 0.5) * 0.02) % 1;
    const x = (0.02 + u * 0.96) * st.W;
    const level = Math.floor(i / PER_LEVEL) + 1;
    const flower = level >= 2 && hash(i + 99) < (level === 2 ? 0.35 : 0.7);
    const img = flower ? art.flowers[Math.floor(hash(i + 7) * art.flowers.length)] : art.tufts[Math.floor(hash(i + 3) * art.tufts.length)];
    return { x, y: st.H, img, level };
  }

  draw(ctx) {
    const st = this.stage, S = st.S * ZOOM;
    const shown = this.shown ?? 0;
    const count = Math.ceil(shown * PER_LEVEL);
    for (let i = 0; i < count; i++) {
      const t = this.tuft(i);
      const alpha = Math.max(0, Math.min(1, shown * PER_LEVEL - i));
      blit(ctx, t.img, Math.round(t.x - (t.img.width * S) / 2), Math.round(t.y - t.img.height * S), S, { alpha });
    }
    // 過去幾天的小花：下緣中間，由舊到新排好
    const flowers = this.view?.()?.flowers ?? [];
    const gap = 6 * S, x0 = st.W / 2 - ((flowers.length - 1) * gap) / 2;
    flowers.forEach((f, i) => {
      const img = art.dayFlowers[Math.max(0, Math.min(2, f.level - 1))];
      blit(ctx, img, Math.round(x0 + i * gap - (img.width * S) / 2), st.H - img.height * S, S);
    });
  }

  // 測試用：畫面上現在有幾叢、幾朵小花
  stats() {
    const count = Math.ceil((this.shown ?? 0) * PER_LEVEL);
    let flowers = 0;
    for (let i = 0; i < count; i++) if (art.flowers.includes(this.tuft(i).img)) flowers++;
    return { shown: this.shown, tufts: count, flowers, days: (this.view?.()?.flowers ?? []).length };
  }
}
