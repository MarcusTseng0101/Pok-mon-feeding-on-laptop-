// 毒屬性 2 招，每一招自己的演出
//   溶解液   吐出 3 坨紫色液體走小弧線，打到身上往下滴、冒泡嘶嘶，地上一灘
//   污泥炸彈 一大坨凹凸不平、會晃的泥球高高拋過去，「啪」放射狀濺開、黏一下才消失、冒紫泡
import * as FX from '../movefx.js';
import { TAU, lerp, rgba, part, groundOf, mover } from './kit.js';

const PURPLE = '#a040c0', LIGHT = '#e0a0f0', DARK = '#5a2070', MUD = '#6a2a6a';

function goo(ctx, x, y, r, t, wob = 0.18, col = PURPLE) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * TAU, rr = r * (1 + Math.sin(a * 5 + t * 12) * wob);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = DARK;
  ctx.lineWidth = Math.max(1, r / 6);
  ctx.stroke();
  ctx.fillStyle = rgba(LIGHT, 0.9);
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.restore();
}
// 冒上來的泡泡
function fizz(stage, x, y, n = 4, spread = 12) {
  const S = stage.S;
  for (let i = 0; i < n; i++) {
    const r = (2.5 + Math.random() * 2.5) * S, x0 = x + (Math.random() - 0.5) * spread * S;
    part(stage, { x: x0, y, vy: -(20 + Math.random() * 30) * S, life: 0.5 + Math.random() * 0.3, t: -i * 0.06, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = LIGHT; ctx.lineWidth = Math.max(1, S / 2); ctx.beginPath(); ctx.arc(p.x, p.y, r * (1 + k * 0.5), 0, TAU); ctx.stroke(); ctx.restore(); } });
  }
}
function puddle(stage, x, y, w, col = PURPLE, life = 1.1) {
  const S = stage.S;
  part(stage, { x, y, life, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 0.6 * (1 - k); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(p.x, p.y, w * S * Math.min(1, k * 5), w * 0.25 * S * Math.min(1, k * 5), 0, 0, TAU); ctx.fill(); ctx.restore(); } });
}

// ---------- 溶解液 ----------
const SPITS = [0.15, 0.25, 0.35], ACID_FLY = 0.55, ACID_ARC = 48; // 猜的，可調整
const acid = {
  time: () => ({ dur: 1.35, hit: SPITS[2] + ACID_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < 3 && t >= SPITS[s.n]) {
      const i = s.n++, a = pet.mouth(), b0 = K.targetPoint(m.target), b = { x: b0.x + (i - 1) * 5 * S, y: b0.y + (i - 1) * 6 * S };
      mover(st, {
        life: ACID_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * ACID_ARC * S }), // 往上吐、落下來
        drawAt: (ctx, q, p) => goo(ctx, q.x, q.y, 9 * S, p.t, 0.25),
        onArrive: q => {
          // 打到的地方往下滴
          part(st, {
            x: q.x, y: q.y, life: 0.8,
            draw: (ctx, p, k) => {
              ctx.save();
              ctx.globalAlpha = 1 - k * 0.7;
              ctx.strokeStyle = PURPLE;
              ctx.lineCap = 'round';
              ctx.lineWidth = 3 * S;
              for (const dx of [-4, 0, 4]) { ctx.beginPath(); ctx.moveTo(p.x + dx * S, p.y); ctx.lineTo(p.x + dx * S, p.y + (6 + Math.abs(dx)) * S * Math.min(1, k * 3) + k * 22 * S); ctx.stroke(); } // 一路滴到地上
              ctx.restore();
            },
          });
          fizz(st, q.x, q.y, 3, 8);
          if (i === 2 && pet.moveCtx === m) K.hit(pet);
          else if (K.isPet(m.target)) m.target.flinchT = 0.15;
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t < SPITS[2] + 0.08) { const b = Math.max(0, Math.sin((t - SPITS[0] + 0.08) * 45)); p.sx = 1 - b * 0.05; p.sy = 1 + b * 0.05; } }, // 伸長脖子吐
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    puddle(st, g.x, g.y, 34, PURPLE, 1.3);
    fizz(st, at.x, at.y, 8, 24);
    FX.later(st, 0.3, () => fizz(st, g.x, g.y - 2 * st.S, 8, 40)); // 地上那一灘也在冒泡
  },
};

// ---------- 污泥炸彈 ----------
const HEAVE = 0.35, LOB = 0.7, APEX = 90; // 猜的，可調整
const sludgebomb = {
  time: () => ({ dur: 1.65, hit: HEAVE + LOB + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    if (t >= HEAVE && !m.s) {
      m.s = true;
      const a = pet.mouth(), b = K.targetPoint(m.target);
      mover(st, {
        life: LOB, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * APEX * S }), // 高高拋
        onStep: (q, k) => { if (Math.random() < 0.25) st.fx.add({ rect: LIGHT, size: S / 2, x: q.x, y: q.y, vy: 20 * S, g: 200 * S, life: 0.4 }); }, // 沿路掉泥
        drawAt: (ctx, q, p) => goo(ctx, q.x, q.y, 15 * S, p.t, 0.2, MUD),
        onArrive: () => { if (pet.moveCtx === m) K.hit(pet); },
      });
    }
  },
  // 還沒丟出去：嘴巴前面慢慢鼓起一坨
  draw(ctx, pet, m, t) {
    if (t >= HEAVE) return;
    const f = pet.mouth(), S = pet.S;
    goo(ctx, f.x + pet.facing * 6 * S, f.y - 2 * S, (3 + 12 * (t / HEAVE)) * S, t, 0.2, MUD);
  },
  pose(pet, p, m, t) { if (t < HEAVE) { p.sx = 1.08; p.sy = 0.92; } else if (t < HEAVE + 0.15) { p.sy = 1.1; p.rot = -pet.facing * 0.12; } }, // 用力往上甩
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 放射狀濺開：8 坨往外飛、黏一下才消失
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2, d = (26 + (i % 3) * 8) * S;
      part(st, {
        x: at.x, y: at.y, life: 1.0,
        draw: (ctx, p, k) => {
          const u = Math.min(1, k * 5), x = p.x + Math.cos(a) * d * u, y = p.y + Math.sin(a) * d * u * 0.7 + Math.max(0, k - 0.5) * 12 * S;
          ctx.save();
          ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
          goo(ctx, x, y, (4 - (i % 2)) * S, i, 0.15, i % 2 ? PURPLE : MUD);
          ctx.restore();
        },
      });
    }
    part(st, { x: at.x, y: at.y, life: 0.3, draw: (ctx, p, k) => { ctx.save(); ctx.globalAlpha = 1 - k; goo(ctx, p.x, p.y, (12 + k * 10) * S, 3, 0.35, MUD); ctx.restore(); } });
    puddle(st, g.x, g.y, 28, MUD, 1.3);
    fizz(st, at.x, at.y, 8, 30);
    FX.smoke(st, at.x, at.y, 24);
  },
};

export const POISON = { acid, sludgebomb };
