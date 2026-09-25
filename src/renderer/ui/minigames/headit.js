// 頭球：球從上面掉下來，在球碰到夥伴頭頂的那一刻（圈圈亮起來時）點一下，夥伴就會把球頂上去。
// 太早點、太晚點、或是沒點，球就掉下去了。連續頂到越多次，好感加越多（最多 +15）。
import * as art from '../../gfx/art.js';
import { blit } from '../../gfx/pixel.js';
import { pixelCircle } from '../../scene/fx.js';
import { headItAffection, HEADIT_MAX_AFFECTION } from '../../../core/minigames.js';
import { RUN_SPEED } from '../../scene/behaviors.js';

const MAX_SECONDS = 45;
const MAX_STREAK = 20;
const G = 700; // 重力（美術像素／秒²）
const BALL = 2; // 球畫成 2 倍大，比較看得清楚

export const headItGame = {
  title: '頭球',
  desc: '球掉到夥伴頭上、圈圈亮起來的那一刻點一下，牠就會把球頂回去。連續頂越多次好感加越多。',
  desktop: true,
  needsPet: true,
  start(host) {
    const st = host.stage, S = st.S, pet = host.active.pet;
    pet.set('minigame', 999);
    pet.partner = null;
    const head = () => pet.head();
    const ball = { x: pet.x, y: head().y - 140 * S, vx: 0, vy: 0 };
    let streak = 0, time = MAX_SECONDS, over = 0, missedWhy = '';
    host.setStatus('球掉到頭上、圈圈亮起來時點一下！');

    const ballBottom = () => ball.y;
    const zone = () => { const hd = head(); return { top: hd.y - 30 * S, bottom: hd.y + 6 * S }; };
    const inZone = () => { const z = zone(); return ball.vy > 0 && ballBottom() >= z.top && ballBottom() <= z.bottom && Math.abs(ball.x - pet.x) < 30 * S; };

    function miss(why) {
      if (over) return;
      over = 0.001;
      missedWhy = why;
      ball.vx = (ball.x < pet.x ? -1 : 1) * 120 * S;
      ball.vy = -150 * S;
      pet.showEmote('?', 1);
      st.audio.sfx('close');
    }

    return {
      get hot() { return !over && inZone(); }, // 測試用
      get streak() { return streak; },
      update(dt) {
        time -= dt;
        // 夥伴跑到球的下面
        if (!over) pet.moveTo(Math.max(pet.bounds().x0, Math.min(pet.bounds().x1, ball.x)), pet.gy, RUN_SPEED * 1.2 * S, dt);
        ball.vy += G * S * dt;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        const b = pet.bounds();
        if (ball.x < b.x0 || ball.x > b.x1) { ball.vx *= -1; ball.x = Math.max(b.x0, Math.min(b.x1, ball.x)); }
        if (!over && ball.vy > 0 && ballBottom() > zone().bottom + 4 * S) miss('球掉下去了');
        if (over) {
          over += dt;
          if (ball.y > pet.gy) { ball.y = pet.gy; ball.vy *= -0.4; ball.vx *= 0.7; }
          if (over > 1.2) this.end();
          return;
        }
        host.setStatus(`連續 ${streak} 次・剩 ${Math.max(0, Math.ceil(time))} 秒`);
        if (time <= 0 || streak >= MAX_STREAK) this.end();
      },
      click() {
        if (over) return;
        if (!inZone()) { miss(ball.vy < 0 || ballBottom() < zone().top ? '太早了' : '太晚了'); return; }
        streak++;
        pet.hopT = 0.3;
        pet.squashT = 0.15;
        // 越頂越快，也會往旁邊飄一點，夥伴要跑過去接
        ball.vy = -(430 + Math.min(streak, 12) * 14) * S;
        ball.vx = (Math.random() - 0.5) * (40 + streak * 12) * S;
        st.fx.sparkles(ball.x, ball.y, S, 3, 6);
        st.audio.sfx(streak % 5 === 0 ? 'sparkle' : 'land');
        if (streak % 5 === 0) pet.showEmote('♪', 0.8);
      },
      draw(ctx) {
        const hd = head(), z = zone(), hot = inZone();
        // 頭頂的目標圈（深色外框＋內圈，任何桌布上都看得到）：球進入範圍時變成黃色
        const cy = (z.top + z.bottom) / 2;
        pixelCircle(ctx, hd.x, cy, 18 * S, S, '#2a2030', 1);
        pixelCircle(ctx, hd.x, cy, 17 * S, S, hot ? '#ffe066' : '#ff9ec7', hot ? 2 : 1);
        const img = art.playBall;
        blit(ctx, img, ball.x - (img.width * BALL * S) / 2, ball.y - img.height * BALL * S, BALL * S);
      },
      end() {
        const r = host.game.headIt(pet.uid, streak);
        pet.set(streak >= 5 ? 'happy' : 'idle', 1);
        if (streak >= 5) pet.showEmote('♥', 1.5);
        host.finish({
          lines: [
            `連續頂了 <b>${streak}</b> 次！`,
            missedWhy ? `（${missedWhy}）` : '',
            r?.affection ? `好感 +${r.affection}${headItAffection(streak) >= HEADIT_MAX_AFFECTION ? '（最多就是 +15）' : ''}` : '下次一起加油吧',
          ],
        });
      },
    };
  },
};
