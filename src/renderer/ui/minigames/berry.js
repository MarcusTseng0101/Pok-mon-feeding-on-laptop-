// 摘樹果：桌面上長出一棵樹，夥伴跑過去用頭撞樹，樹果掉下來，在 30 秒內點掉下來的樹果接住。
import * as art from '../../gfx/art.js';
import { blit } from '../../gfx/pixel.js';
import { BERRY_ZH } from '../../../core/amie.js';
import { rollBerry, BERRY_GAME_SECONDS, MAX_BERRIES_PER_GAME } from '../../../core/minigames.js';
import { WALK_SPEED } from '../../scene/behaviors.js';

const SHAKE_EVERY = 2.2; // 秒
const TREE = 2; // 樹畫成 2 倍大（比寶可夢高，看起來才像一棵樹）
const GROUND_LINGER = 1.4; // 掉到地上後還能撿多久

export const berryGame = {
  title: '摘樹果',
  desc: '夥伴會去撞樹果樹，在樹果掉到地上之前點它接住。30 秒內最多帶回 15 顆，做泡芙要用。',
  desktop: true,
  needsPet: true,
  start(host) {
    const st = host.stage, S = st.S, pet = host.active.pet;
    const rng = host.director.rng;
    // 樹種在夥伴旁邊比較空的那一側
    const b = pet.bounds();
    const side = pet.x < st.W / 2 ? 1 : -1;
    const treeX = Math.max(b.x0 + 50 * TREE * S, Math.min(b.x1 - 50 * TREE * S, pet.x + side * 170 * S));
    const treeY = Math.max(64 * TREE * S, Math.min(st.H - 6 * S, pet.gy)); // 樹根的位置
    const standX = treeX - side * (8 * TREE + pet.asset.w * 0.45) * S; // 夥伴站在樹幹旁邊，不要擋住樹幹
    const berries = [];
    const caught = {};
    let caughtN = 0, missed = 0, shake = 0, nextShake = 1.2, time = BERRY_GAME_SECONDS;
    pet.set('minigame', 999);
    pet.partner = null;
    host.setStatus(`剩 ${time} 秒・接到 0 顆`);

    const canopy = () => ({ x: treeX + (rng() - 0.5) * 34 * TREE * S, y: treeY - (38 + rng() * 14) * TREE * S });

    return {
      get berries() { return berries; }, // 測試用
      update(dt) {
        time -= dt;
        // 夥伴走到樹旁邊，每隔一段時間撞一下樹
        const arrived = pet.moveTo(standX, treeY + 4 * S, WALK_SPEED * 1.4 * S, dt);
        if (arrived) pet.facing = side;
        nextShake -= dt;
        if (arrived && nextShake <= 0 && time > 1.5) {
          nextShake = SHAKE_EVERY * (0.8 + rng() * 0.4);
          shake = 1;
          pet.hopT = 0.3;
          pet.squashT = 0.15;
          st.audio.sfx('land');
          const n = 2 + Math.floor(rng() * 3);
          for (let i = 0; i < n; i++) {
            const p = canopy();
            berries.push({ kind: rollBerry(rng), x: p.x, y: p.y, vy: -rng() * 60 * S, vx: (rng() - 0.5) * 50 * S, ground: treeY + (rng() * 30 - 8) * S, landed: 0, delay: i * 0.12 });
          }
        }
        shake = Math.max(0, shake - dt * 1.8);
        for (const br of berries) {
          if (br.delay > 0) { br.delay -= dt; continue; }
          if (br.landed) { br.landed += dt; continue; }
          br.vy += 900 * S * dt;
          br.x += br.vx * dt;
          br.y += br.vy * dt;
          if (br.y >= br.ground) { br.y = br.ground; br.landed = 0.001; }
        }
        for (let i = berries.length - 1; i >= 0; i--) {
          if (berries[i].landed > GROUND_LINGER) { berries.splice(i, 1); missed++; }
        }
        host.setStatus(`剩 ${Math.max(0, Math.ceil(time))} 秒・接到 ${caughtN} 顆`);
        if (time <= 0 || caughtN >= MAX_BERRIES_PER_GAME) this.end();
      },
      click(x, y) {
        // 從最上面（最後畫的）開始找，點得寬鬆一點
        for (let i = berries.length - 1; i >= 0; i--) {
          const br = berries[i];
          if (br.delay > 0 || Math.hypot(x - br.x, y - (br.y - 4 * S)) > 12 * S) continue;
          berries.splice(i, 1);
          caught[br.kind] = (caught[br.kind] ?? 0) + 1;
          caughtN++;
          st.fx.sparkles(br.x, br.y - 4 * S, S, 3, 8);
          st.audio.sfx('click');
          if (!br.landed) pet.showEmote('♪', 0.6);
          return;
        }
      },
      drawUnder(ctx) {
        const img = art.berryTree(shake);
        blit(ctx, img, treeX - (img.width * TREE * S) / 2, treeY - img.height * TREE * S, TREE * S);
      },
      draw(ctx) {
        for (const br of berries) {
          if (br.delay > 0) continue;
          const img = art.berries[br.kind];
          const alpha = br.landed ? Math.max(0, 1 - br.landed / GROUND_LINGER) * 0.6 + 0.4 : 1;
          blit(ctx, img, br.x - (img.width * S) / 2, br.y - img.height * S, S, { alpha });
        }
      },
      end() {
        const got = host.game.addBerries(caught);
        const list = Object.entries(caught).map(([k, n]) => `${BERRY_ZH[k]} ×${n}`).join('、');
        pet.set('happy', 1);
        pet.showEmote(got >= 8 ? '♥' : '♪', 1.5);
        host.finish({ lines: [got ? `接到了 ${got} 顆樹果！` : '一顆都沒接到…', list || '', missed ? `掉到地上沒撿到：${missed} 顆` : '一顆都沒漏掉！', '樹果可以在「做泡芙」裡用'] });
      },
    };
  },
};
