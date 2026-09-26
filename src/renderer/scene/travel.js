// 出門旅行的演出：走到螢幕邊緣、揮揮手、走出去；回來時從另一邊走進來，頭上頂著明信片。
// 規則（能不能出發、帶什麼回來）在 core/trips.js；這裡只負責畫面。
import { WALK_SPEED } from './behaviors.js';
import * as cards from '../gfx/postcards.js';
import { blit } from '../gfx/pixel.js';

// 開始出門：先放下手邊的事（一起玩的、一群玩的會正常結束）
export function startDepart(pet) {
  const st = pet.stage, S = pet.S;
  if (pet.partner?.partner === pet) pet.partner.partner = null;
  pet.partner = null;
  pet.group = null; // 一群一起玩的遊戲會發現牠不在了，自己結束（social.js 的 groupBroken）
  pet.perch = null;
  pet.onArrive = null;
  pet.tripFrom ??= { x: pet.x, y: pet.gy }; // 紙條留在這裡
  const side = pet.x < st.W / 2 ? -1 : 1; // 往比較近的那一邊走
  const b = pet.bounds();
  pet.departure = { phase: 'toEdge', side, edgeX: side < 0 ? b.x0 + 4 * S : b.x1 - 4 * S, outX: side < 0 ? -pet.asset.w * S : st.W + pet.asset.w * S, t: 0 };
  pet.set('depart', 999);
}

// 旅行回來：從螢幕邊緣走進來
export function startReturn(pet) {
  const st = pet.stage, S = pet.S;
  const side = Math.random() < 0.5 ? -1 : 1;
  pet.x = side < 0 ? -pet.asset.w * S : st.W + pet.asset.w * S;
  pet.gy = st.H * (0.5 + Math.random() * 0.35);
  pet.alpha = 1;
  pet.returnTo = { x: side < 0 ? 120 * S : st.W - 120 * S, y: pet.gy };
  pet.set('tripReturn', 999);
}

export const TRAVEL_ACTIONS = {
  depart: {
    update(pet, dt) {
      const d = pet.departure, S = pet.S;
      if (!d) { pet.set('idle', 1); return; }
      d.t += dt;
      if (d.phase === 'toEdge') {
        if (pet.moveTo(d.edgeX, pet.gy, WALK_SPEED * S * 1.3, dt)) { d.phase = 'wave'; d.t = 0; pet.facing = -d.side; pet.showEmote('♪', 1.2); }
      } else if (d.phase === 'wave') {
        pet.facing = -d.side; // 回頭跟你揮手
        if (d.t > 1.3) { d.phase = 'out'; d.t = 0; }
      } else if (pet.moveTo(d.outX, pet.gy, WALK_SPEED * S * 1.3, dt) || d.t > 6) {
        pet.departure = null;
        pet.stage.fire('tripGone', pet);
      }
    },
    lift: pet => (pet.departure?.phase === 'wave' ? Math.round(Math.abs(Math.sin(pet.stateT * 9)) * 4) : Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2)),
    pose(pet, p) { if (pet.departure?.phase === 'wave') p.rot = Math.sin(pet.stateT * 9) * 0.12; },
    intangible: pet => pet.departure?.phase === 'out',
  },
  tripReturn: {
    update(pet, dt) {
      const r = pet.returnTo;
      if (!r || pet.moveTo(r.x, r.y, WALK_SPEED * pet.S * 1.2, dt)) {
        pet.returnTo = null;
        pet.showEmote('!', 1.2);
        pet.set('idle', 2);
      }
    },
    lift: pet => Math.round(Math.abs(Math.sin(pet.walkPhase)) * 2),
  },
};

// 回來了、明信片還沒收：頭上頂著一張小明信片
export function drawCarried(pet, ctx) {
  const S = pet.S, h = pet.head(), img = cards.mini;
  const bob = Math.floor(pet.t * 2) % 2 ? S : 0;
  blit(ctx, img, h.x - (img.width * S) / 2, h.y - (img.height + 3) * S - bob, S);
}
