// 做泡芙：選 3 顆樹果 → 攪拌（按住滑鼠在碗裡畫圈，速度要穩）→ 烘烤（指針走到最右邊時取出）
// → 裝飾（在泡芙上點 5 個點，分散一點比較漂亮）。三段加起來 0–100 分決定泡芙等級。
import * as art from '../../gfx/art.js';
import { makeCanvas } from '../../gfx/pixel.js';
import { BERRIES, BERRY_ZH, FLAVOR_ZH, puffName } from '../../../core/amie.js';
import * as mg from '../../../core/minigames.js';

const STIR_SECONDS = 5;
const BAKE_PERIOD = 2; // 指針來回一次幾秒
const W = 150, H = 100; // 畫布的美術像素；畫到畫面上 ×2
const SCALE = 2;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const bakeGame = {
  title: '做泡芙',
  desc: '用 3 顆樹果做一個泡芙：攪拌、烘烤、裝飾，做得越好泡芙等級越高。每天最多做 5 個，豪華泡芙每天只能做 1 個。',
  desktop: false,
  needsPet: false,
  blocked(game) {
    if (game.bakesLeft() <= 0) return '今天已經做了 5 個泡芙了，明天再來吧';
    const n = Object.values(game.state.bag.berries).reduce((a, b) => a + b, 0);
    if (n < mg.BERRIES_PER_PUFF) return `樹果不夠（要 ${mg.BERRIES_PER_PUFF} 顆，你有 ${n} 顆），先去摘樹果吧`;
    return null;
  },
  start(host) {
    const game = host.game, body = host.body;
    const picked = [];
    const score = { stir: 0, bake: 0, deco: 0 };
    let step = 'pick';
    let canvas, ctx, t = 0;
    // 攪拌
    const stir = { down: false, angle: null, turned: 0, samples: [], acc: 0, time: 0 };
    // 裝飾
    const dots = [];

    const flavor = () => (picked.length ? mg.puffFlavor(picked) : null);
    const puffImg = () => art.puff(`${flavor() ?? 'sweet'}-basic`);

    function renderPick() {
      const bag = game.state.bag.berries;
      body.innerHTML = `<div class="bake">
        <p class="hint">選 3 顆樹果（最多的那種決定口味）。今天還可以做 ${game.bakesLeft()} 個。</p>
        <div class="berries">${Object.keys(BERRIES).map(b => {
          const left = bag[b] - picked.filter(p => p === b).length;
          return `<button data-berry="${b}" ${left <= 0 || picked.length >= 3 ? 'disabled' : ''}><span class="icon" data-icon="${b}"></span>${BERRY_ZH[b]}<small>×${left}</small></button>`;
        }).join('')}</div>
        <div class="slots">${[0, 1, 2].map(i => `<button data-slot="${i}" class="slot">${picked[i] ? `<span class="icon" data-icon="${picked[i]}"></span>` : '＋'}</button>`).join('')}</div>
        <p>${picked.length ? `會做出：<b>${FLAVOR_ZH[flavor()]}泡芙</b>` : '&nbsp;'}</p>
        <div class="btns"><button class="primary" data-go ${picked.length === 3 ? '' : 'disabled'}>開始做！</button></div></div>`;
      body.querySelectorAll('[data-icon]').forEach(el => el.append(icon(art.berries[el.dataset.icon], 2)));
      body.onclick = e => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.dataset.berry && picked.length < 3) picked.push(b.dataset.berry);
        else if (b.dataset.slot && picked[b.dataset.slot]) picked.splice(Number(b.dataset.slot), 1);
        else if ('go' in b.dataset) { startStir(); return; }
        host.ui.audio.sfx('click');
        renderPick();
      };
    }

    function stage(title, hint, button = '') {
      body.onclick = null;
      body.innerHTML = `<div class="bake"><h4>${title}</h4><p class="hint">${hint}</p><canvas class="px board"></canvas>
        <div class="meter"><i></i></div><div class="btns">${button}</div></div>`;
      canvas = body.querySelector('canvas');
      canvas.width = W; canvas.height = H;
      canvas.style.width = `${W * SCALE}px`; canvas.style.height = `${H * SCALE}px`;
      ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
    }
    const meter = k => { const i = body.querySelector('.meter i'); if (i) i.style.width = `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`; };
    const local = e => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };

    function startStir() {
      step = 'stir';
      stage('① 攪拌', `按住滑鼠，在碗裡順著同一個方向畫圈 ${STIR_SECONDS} 秒。速度穩定最重要。`);
      canvas.onpointerdown = e => { stir.down = true; stir.angle = null; canvas.setPointerCapture(e.pointerId); };
      canvas.onpointerup = () => { stir.down = false; };
      canvas.onpointermove = e => {
        if (!stir.down) return;
        const p = local(e);
        const a = Math.atan2(p.y - H / 2, p.x - W / 2);
        if (stir.angle !== null) {
          let d = a - stir.angle;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          stir.acc += d;
          stir.turned += d;
        }
        stir.angle = a;
      };
    }

    function startBake() {
      step = 'bake';
      t = 0;
      stage('② 烘烤', '指針走到最右邊（金色的地方）時按「取出！」。', '<button class="primary" data-take>取出！</button>');
      body.querySelector('[data-take]').onclick = () => {
        // 離「走到最右邊的那一刻」幾秒
        const phase = (t % BAKE_PERIOD) / BAKE_PERIOD;
        const error = Math.abs(phase - 0.5) * BAKE_PERIOD;
        score.bake = mg.bakeScore(error);
        host.ui.audio.sfx(score.bake > 25 ? 'sparkle' : 'click');
        startDeco();
      };
    }

    function startDeco() {
      step = 'deco';
      stage('③ 裝飾', `在泡芙上點 ${mg.DECO_POINTS} 個地方放上糖珠，分散一點比較漂亮。`, '<button class="primary" data-done>完成！</button>');
      canvas.onpointerdown = e => {
        if (dots.length >= mg.DECO_POINTS) return;
        const p = local(e);
        // 只算點在泡芙上的（泡芙畫在中間 72×72）
        const x = (p.x - (W / 2 - 36)) / 72, y = (p.y - (H / 2 - 36)) / 72;
        if (x < 0 || y < 0 || x > 1 || y > 1) return;
        dots.push({ x, y, c: ['#ff5d8f', '#ffe066', '#5ab8ff', '#ffffff', '#6fdc6f'][dots.length] });
        host.ui.audio.sfx('click');
      };
      body.querySelector('[data-done]').onclick = finish;
    }

    function finish() {
      score.deco = mg.decoScore(dots);
      const total = score.stir + score.bake + score.deco;
      const r = game.bakePuff(picked, total);
      if (!r.ok) { host.finish({ lines: ['泡芙沒做成…（樹果不夠或今天已經做滿了）'], again: false }); return; }
      host.ui.audio.sfx('sparkle');
      host.finish({
        again: game.bakesLeft() > 0,
        lines: [
          `攪拌 ${score.stir}／${mg.STIR_MAX}・烘烤 ${score.bake}／${mg.BAKE_MAX}・裝飾 ${score.deco}／${mg.DECO_MAX}`,
          `總分 <b>${total}</b>`,
          `做出了 <b>${esc(puffName(r.puff))}</b>！`,
          r.capped ? '（今天已經做過豪華泡芙了，所以這個是精緻泡芙）' : '',
          `今天還可以做 ${game.bakesLeft()} 個`,
        ],
      });
      const img = host.body.querySelector('.result');
      img?.prepend(icon(art.puff(r.puff), 4));
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      if (step === 'stir') {
        // 碗
        ctx.fillStyle = '#e8e0f0'; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 44, 40, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c8b8e0'; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 38, 34, 0, 0, Math.PI * 2); ctx.fill();
        const c = art.FLAVOR_COLORS[flavor()].F;
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 32, 28, 0, 0, Math.PI * 2); ctx.fill();
        // 攪拌的漩渦
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, 8 + i * 8, stir.turned + i, stir.turned + i + 2);
          ctx.stroke();
        }
        meter(stir.time / STIR_SECONDS);
      } else if (step === 'bake') {
        // 烤箱與指針
        ctx.fillStyle = '#5a4a6a'; ctx.fillRect(20, 10, W - 40, 56);
        ctx.fillStyle = '#ffb13a'; ctx.fillRect(26, 16, W - 52, 44);
        const img = puffImg();
        ctx.drawImage(img, W / 2 - img.width, 22, img.width * 2, img.height * 2);
        ctx.fillStyle = '#d8d0e0'; ctx.fillRect(20, 76, W - 40, 10);
        ctx.fillStyle = '#ffd84a'; ctx.fillRect(W - 20 - 22, 76, 22, 10); // 最右邊是金色
        const phase = (t % BAKE_PERIOD) / BAKE_PERIOD;
        const pos = 1 - Math.abs(2 * phase - 1);
        ctx.fillStyle = '#2a2030'; ctx.fillRect(20 + pos * (W - 44), 72, 4, 18);
        meter(pos);
      } else if (step === 'deco') {
        const img = puffImg();
        ctx.drawImage(img, W / 2 - 36, H / 2 - 36, 72, 72);
        for (const d of dots) {
          ctx.fillStyle = '#2a2030'; ctx.fillRect(W / 2 - 36 + d.x * 72 - 3, H / 2 - 36 + d.y * 72 - 3, 6, 6);
          ctx.fillStyle = d.c; ctx.fillRect(W / 2 - 36 + d.x * 72 - 2, H / 2 - 36 + d.y * 72 - 2, 4, 4);
        }
        meter(dots.length / mg.DECO_POINTS);
      }
    }

    renderPick();
    return {
      update(dt) {
        t += dt;
        if (step === 'stir') {
          // 每 0.1 秒記一次角速度（只在按住時計時）
          if (stir.down) {
            stir.time += dt;
            stir.sampleT = (stir.sampleT ?? 0) + dt;
            if (stir.sampleT >= 0.1) { stir.samples.push(stir.acc / stir.sampleT); stir.acc = 0; stir.sampleT = 0; }
          }
          if (stir.time >= STIR_SECONDS) {
            score.stir = mg.stirScore(stir.samples);
            host.ui.audio.sfx(score.stir > 28 ? 'sparkle' : 'click');
            startBake();
          }
        }
        draw();
      },
    };
  },
};

function icon(src, scale) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  c.className = 'px';
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  return c;
}
export { icon };
