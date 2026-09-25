// 超級特訓：先選要練哪一項能力，20 秒內點破那個顏色的氣球。
// 每破一個加 4 點（單項最多 252、全部加起來最多 510，跟原作的努力值一樣）。點錯顏色會停頓一下。
// 練出來的成果只影響一件事：切磋時比較容易打中對方（最多 +15%）。
import * as art from '../../gfx/art.js';
import { TRAINING_STATS, TRAINING_MAX, TRAINING_TOTAL } from '../../../core/save.js';
import { TRAINING_SECONDS, TRAINING_STAT_ZH, TRAINING_PER_POP, trainingTotal } from '../../../core/minigames.js';

const W = 160, H = 110, SCALE = 2;
const WRONG_PAUSE = 0.8;
const BS = 2; // 氣球畫成 2 倍大

export const trainingGame = {
  title: '超級特訓',
  desc: '選一項能力，20 秒內點破那個顏色的氣球。練得越多，切磋時越容易打中對方。',
  desktop: false,
  needsPet: true,
  blocked(game, uid) {
    return trainingTotal(game.mon(uid)?.training) >= TRAINING_TOTAL ? '牠已經練到極限了（510）' : null;
  },
  start(host) {
    const mon = host.game.mon(host.active.uid);
    const body = host.body;
    let stat = null, time = TRAINING_SECONDS, pops = 0, wrong = 0, pause = 0, spawnT = 0;
    const balloons = [];
    let canvas, ctx;
    const rng = host.director.rng;

    body.innerHTML = `<div class="training"><p class="hint">要練哪一項？（全部 ${trainingTotal(mon.training)}／${TRAINING_TOTAL}）</p>
      <div class="stats">${TRAINING_STATS.map(s => `<button data-stat="${s}" ${mon.training[s] >= TRAINING_MAX ? 'disabled' : ''} style="border-color:${art.STAT_COLORS[s]}">
        ${TRAINING_STAT_ZH[s]}<small>${mon.training[s]}／${TRAINING_MAX}</small></button>`).join('')}</div></div>`;
    body.onclick = e => {
      const b = e.target.closest('[data-stat]');
      if (!b || b.disabled) return;
      stat = b.dataset.stat;
      host.ui.audio.sfx('click');
      begin();
    };

    function begin() {
      body.onclick = null;
      body.innerHTML = `<div class="training"><p class="hint">點破<b style="color:${art.STAT_COLORS[stat]}">${TRAINING_STAT_ZH[stat]}</b>顏色的氣球！</p><canvas class="px board"></canvas></div>`;
      canvas = body.querySelector('canvas');
      canvas.width = W; canvas.height = H;
      canvas.style.width = `${W * SCALE}px`; canvas.style.height = `${H * SCALE}px`;
      ctx = canvas.getContext('2d');
      canvas.onpointerdown = e => {
        if (pause > 0 || time <= 0) return;
        const r = canvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
        for (let i = balloons.length - 1; i >= 0; i--) {
          const b = balloons[i];
          if (x < b.x - 2 || x > b.x + 8 * BS + 2 || y < b.y - 2 || y > b.y + 8 * BS + 2) continue; // 點到氣球本體（不含繩子）
          balloons.splice(i, 1);
          if (b.stat === stat) { pops++; host.ui.audio.sfx('click'); }
          else { wrong++; pause = WRONG_PAUSE; host.ui.audio.sfx('close'); }
          return;
        }
      };
    }

    const ctl = {
      get balloons() { return balloons; }, // 測試用
      get stat() { return stat; },
      update(dt) {
        if (!stat) return;
        time -= dt;
        pause = Math.max(0, pause - dt);
        spawnT -= dt;
        if (spawnT <= 0 && time > 0) {
          spawnT = 0.35 + rng() * 0.3;
          // 四成是要練的那個顏色
          const s = rng() < 0.4 ? stat : TRAINING_STATS[Math.floor(rng() * TRAINING_STATS.length)];
          balloons.push({ stat: s, x: 4 + rng() * (W - 8 - 8 * BS), y: H + 2, vy: 16 + rng() * 14, wob: rng() * 6 });
        }
        for (const b of balloons) { b.y -= b.vy * dt; b.wob += dt * 3; }
        for (let i = balloons.length - 1; i >= 0; i--) if (balloons[i].y < -11 * BS) balloons.splice(i, 1);
        host.setStatus(`剩 ${Math.max(0, Math.ceil(time))} 秒・破了 ${pops} 個`);
        this.draw2();
        if (time <= 0) this.end();
      },
      draw2() {
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = pause > 0 ? '#f0d8d8' : '#dff0ff';
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;
        for (const b of balloons) { const img = art.balloons[b.stat]; ctx.drawImage(img, Math.round(b.x + Math.sin(b.wob) * 1.5), Math.round(b.y), img.width * BS, img.height * BS); }
      },
      end() {
        if (ctl.ended) return;
        ctl.ended = true;
        const r = host.game.train(mon.uid, stat, pops);
        host.finish({
          lines: [
            `破了 ${pops} 個${TRAINING_STAT_ZH[stat]}氣球${wrong ? `（點錯 ${wrong} 個）` : ''}`,
            r.gained ? `${TRAINING_STAT_ZH[stat]} +${r.gained}（現在 ${r.value}／${TRAINING_MAX}）` : '已經練不上去了…',
            r.gained < pops * TRAINING_PER_POP ? '（碰到上限了：單項 252、全部 510）' : '',
            `全部 ${trainingTotal(mon.training)}／${TRAINING_TOTAL}・切磋時會比較容易打中`,
          ],
        });
      },
    };
    return ctl;
  },
};
