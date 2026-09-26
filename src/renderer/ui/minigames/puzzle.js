// 拼圖：把夥伴的樣子切成 3×3，打亂。點一片、再點另一片就會交換，拼回原樣就完成。
// 圖片一定要等真的載好才切（不能拿替代圖來切，不然拼的是一團色塊）。
import { makeCanvas } from '../../gfx/pixel.js';
import { spriteKey } from '../../../core/forms.js';
import { shufflePuzzle, puzzleSolved, PUZZLE_SIZE, PUZZLE_ENJOYMENT } from '../../../core/minigames.js';

const BOARD = 240; // CSS 像素

export const puzzleGame = {
  title: '拼圖',
  desc: '把夥伴的樣子拼回來。點一片、再點另一片就會交換位置。拼完牠會很開心（滿足感 +20）。',
  desktop: false,
  needsPet: true,
  start(host) {
    const mon = host.game.mon(host.active.uid);
    const body = host.body;
    const n = PUZZLE_SIZE;
    let tiles = null, sel = null, moves = 0, t = 0, done = false, alive = true;
    body.innerHTML = '<div class="puzzle"><p class="hint">圖片準備中…</p></div>';

    // 先把圖片載好：載不到就不玩（不切替代圖）
    const key = spriteKey(mon.species, mon.form);
    host.ui.sprites.get(key, mon.shiny).then(asset => {
      if (!alive) return;
      if (!asset || asset.fallback) {
        host.finish({ lines: ['牠的圖片還沒下載下來，連上網路之後再來玩吧'], again: false });
        return;
      }
      // 把圖放大置中到正方形，再切成 n×n
      const side = Math.max(asset.w, asset.h) + 4;
      const src = makeCanvas(side, side);
      const sctx = src.getContext('2d');
      sctx.fillStyle = '#fff6ea';
      sctx.fillRect(0, 0, side, side);
      sctx.drawImage(asset.canvas, Math.floor((side - asset.w) / 2), Math.floor((side - asset.h) / 2));
      tiles = shufflePuzzle(host.director.rng);
      body.innerHTML = `<div class="puzzle"><p class="hint">點一片、再點另一片交換位置。</p>
        <div class="board" style="width:${BOARD}px;height:${BOARD}px;grid-template-columns:repeat(${n},${BOARD / n}px);grid-template-rows:repeat(${n},${BOARD / n}px)"></div>
        <p class="moves"></p></div>`;
      const board = body.querySelector('.board');
      const cell = BOARD / n;
      for (let i = 0; i < n * n; i++) {
        const c = makeCanvas(side / n, side / n);
        c.className = 'px';
        c.style.width = c.style.height = '100%';
        const b = document.createElement('button');
        b.className = 'tile';
        b.dataset.i = i;
        b.append(c);
        board.append(b);
      }
      const paint = () => {
        board.querySelectorAll('.tile').forEach((b, i) => {
          const piece = tiles[i];
          const c = b.firstChild, x = (piece % n) * (side / n), y = Math.floor(piece / n) * (side / n);
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(src, x, y, side / n, side / n, 0, 0, c.width, c.height);
          b.classList.toggle('sel', sel === i);
          b.classList.toggle('ok', piece === i);
        });
        body.querySelector('.moves').textContent = `交換了 ${moves} 次`;
      };
      board.onclick = e => {
        const b = e.target.closest('.tile');
        if (!b || done) return;
        const i = Number(b.dataset.i);
        if (sel === null) { sel = i; host.ui.audio.sfx('click'); }
        else if (sel === i) sel = null;
        else {
          [tiles[sel], tiles[i]] = [tiles[i], tiles[sel]];
          sel = null;
          moves++;
          host.ui.audio.sfx('grab');
          if (puzzleSolved(tiles)) {
            done = true;
            paint();
            host.game.puzzleDone(mon.uid);
            host.ui.audio.sfx('sparkle');
            setTimeoutFree(() => host.finish({ lines: [`拼好了！交換了 ${moves} 次、花了 ${Math.round(t)} 秒`, `${host.game.displayName(mon)}看起來很開心（滿足感 +${PUZZLE_ENJOYMENT}）`] }));
            return;
          }
        }
        paint();
      };
      paint();
    });

    // 拼好後停一下讓人看到完成的樣子，再顯示結果（用遊戲時間，不用 setTimeout）
    let pending = null;
    const setTimeoutFree = fn => { pending = { at: t + 0.8, fn }; };

    return {
      update(dt) {
        t += dt;
        if (pending && t >= pending.at) { const p = pending; pending = null; p.fn(); }
      },
      destroy() { alive = false; },
      get tiles() { return tiles; },
    };
  },
};
