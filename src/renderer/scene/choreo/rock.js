// 岩石屬性 3 招，每一招自己的演出
//   力量寶石   3 顆寶石繞著自己轉兩圈 → 在前面排成一個稜鏡 → 射出一道彩虹色的稜鏡光，打中彩虹折射
//   雙刃頭錘   往後退很多 → 頭上包著岩石全速衝撞 → 碎石噴出、大震，自己也頭暈冒星星
//   鑽石風暴   鑽石在自己身邊圍成圈 → 圈突然往前炸開，變成一面旋轉的鑽石牆橫掃過去，滿滿亮片
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part } from './kit.js';

const GEM = '#bfe8ff', WHITE = '#ffffff', ROCK = '#c0a040', ROCK2 = '#8a7428', ROCK3 = '#f0e0a0', GOLD = '#ffe066';
const RAINBOW = ['#ff5d5d', '#ffb13a', '#ffe066', '#7ae07a', '#7ab8ff', '#c070ff'];

function diamond(ctx, x, y, s, ang, col = GEM, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.7, -s * 0.2);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.7, -s * 0.2);
  ctx.closePath();
  ctx.fillStyle = rgba(col, 0.85);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = Math.max(1, s / 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.7, -s * 0.2);
  ctx.lineTo(s * 0.7, -s * 0.2);
  ctx.stroke();
  ctx.restore();
}
function star(ctx, x, y, r, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, rr = i % 2 ? r * 0.45 : r; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- 力量寶石 ----------
const ORBIT = 0.5, ALIGN = 0.62, BEAM = [0.62, 1.05]; // 猜的，可調整
const powergem = {
  time: () => ({ dur: 1.35, hit: ALIGN + 0.06 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, r = pet.rect(), cx = pet.x, cy = r.y + r.h * 0.5, f = pet.facing;
    const prism = { x: pet.x + f * (r.w * 0.6 + 6 * S), y: cy - 4 * S };
    if (t < BEAM[1]) {
      for (let i = 0; i < 3; i++) {
        let x, y;
        if (t < ORBIT) { const a = (t / ORBIT) * 2 * TAU + (i / 3) * TAU; x = cx + Math.cos(a) * r.w * 0.7; y = cy + Math.sin(a) * r.h * 0.35; }
        else { const u = clamp01((t - ORBIT) / (ALIGN - ORBIT)), a = 2 * TAU + (i / 3) * TAU, x0 = cx + Math.cos(a) * r.w * 0.7, y0 = cy + Math.sin(a) * r.h * 0.35; x = lerp(x0, prism.x + (i - 1) * 3 * S, u); y = lerp(y0, prism.y + (i - 1) * 5 * S, u); }
        diamond(ctx, x, y, 6 * S, t * 4 + i, [GEM, '#ff9ec7', GOLD][i]);
      }
    }
    // 稜鏡光：從寶石射出、分成彩虹色的一束
    const u = clamp01((t - BEAM[0]) / 0.1), fade = t > BEAM[1] - 0.15 ? clamp01((BEAM[1] - t) / 0.15) : 1;
    if (u > 0 && t < BEAM[1]) {
      const b = K.targetPoint(m.target), ex = lerp(prism.x, b.x, u), ey = lerp(prism.y, b.y, u);
      glow(ctx, () => {
        ctx.lineCap = 'round';
        RAINBOW.forEach((c, i) => {
          const off = (i - 2.5) * 2.5 * S;
          ctx.strokeStyle = rgba(c, 0.85 * fade);
          ctx.lineWidth = 2.2 * S;
          ctx.beginPath();
          ctx.moveTo(prism.x, prism.y);
          ctx.lineTo(ex, ey + off * u);
          ctx.stroke();
        });
        ctx.strokeStyle = rgba(WHITE, fade);
        ctx.lineWidth = S;
        ctx.beginPath();
        ctx.moveTo(prism.x, prism.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      });
    }
  },
  pose(pet, p, m, t) { if (t < ORBIT) p.sy = 1.05; else if (t < BEAM[1]) p.rot = pet.facing * 0.06; },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    // 彩虹折射：6 道不同顏色的光往外折出去
    part(st, {
      x: at.x, y: at.y, life: 0.5,
      draw: (ctx, p, k) => glow(ctx, () => RAINBOW.forEach((c, i) => {
        const a = (i / 6) * TAU + 0.3, L = (10 + 30 * k) * S;
        ctx.strokeStyle = rgba(c, 1 - k);
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * 4 * S, p.y + Math.sin(a) * 4 * S);
        ctx.lineTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L);
        ctx.stroke();
      })),
    });
    st.fx.sparkles(at.x, at.y, S, 6, 24);
  },
};

// ---------- 雙刃頭錘 ----------
const BACK = 0.35, RAM = 0.6, DIZZY = [0.7, 1.45], HS_HOME = [0.75, 1.2]; // 猜的，可調整
const headAt = pet => { const r = pet.rect(); return { x: pet.x + pet.facing * r.w * 0.3, y: r.y + r.h * 0.25 }; };
const headsmash = {
  time: () => ({ dur: DIZZY[1] + 0.05, hit: RAM }),
  update(pet, m, t, dt, K) {
    const k = t < BACK ? -0.45 * Math.sin((t / BACK) * Math.PI / 2) : t < RAM ? lerp(-0.45, 1, ((t - BACK) / (RAM - BACK)) ** 2) : t < HS_HOME[0] ? 1 : Math.max(0, 1 - (t - HS_HOME[0]) / (HS_HOME[1] - HS_HOME[0]));
    K.dash(pet, m, k);
    if (t > BACK && t < RAM) {
      m.ghostT = (m.ghostT ?? 0) - dt;
      if (m.ghostT <= 0) { m.ghostT = 0.04; FX.afterimage(pet); }
    }
  },
  draw(ctx, pet, m, t) {
    const S = pet.S;
    // 頭上包著岩石（衝的時候）
    if (t > 0.1 && t < RAM + 0.05) {
      const h = headAt(pet), k = clamp01((t - 0.1) / 0.2);
      glow(ctx, () => { const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 16 * S * k); g.addColorStop(0, rgba(ROCK3, 0.8)); g.addColorStop(1, rgba(ROCK, 0)); ctx.fillStyle = g; ctx.fillRect(h.x - 16 * S, h.y - 16 * S, 32 * S, 32 * S); });
      for (let i = 0; i < 5; i++) { const a = t * 12 + (i / 5) * TAU; ctx.fillStyle = i % 2 ? ROCK : ROCK2; ctx.fillRect(h.x + Math.cos(a) * 11 * S * k - 1.5 * S, h.y + Math.sin(a) * 7 * S * k - 1.5 * S, 3 * S, 3 * S); }
    }
    // 自己也頭暈：頭上轉圈的星星
    if (t > DIZZY[0] && t < DIZZY[1]) {
      const r = pet.rect(), a0 = t * 7, alpha = t > DIZZY[1] - 0.2 ? (DIZZY[1] - t) / 0.2 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let i = 0; i < 3; i++) { const a = a0 + (i / 3) * TAU; star(ctx, pet.x + Math.cos(a) * 12 * S, r.y - 4 * S + Math.sin(a) * 3 * S, 3 * S, GOLD); }
      ctx.restore();
    }
  },
  pose(pet, p, m, t) {
    if (t < BACK) p.rot = -pet.facing * 0.15; // 往後仰（蓄力）
    else if (t < RAM) { p.rot = pet.facing * 0.4; p.pivot = 'center'; } // 頭往前衝
    else if (t < DIZZY[1]) p.rot = Math.sin(t * 16) * 0.12; // 暈
  },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    for (let i = 0; i < 12; i++) st.fx.add({ rect: [ROCK, ROCK2, ROCK3][i % 3], size: (i % 3 + 2) * S, x: at.x, y: at.y, vx: (Math.random() - 0.5) * 260 * S, vy: -(80 + Math.random() * 160) * S, g: 520 * S, life: 0.8 });
    FX.shockwave(st, at.x, at.y, ROCK3, 70, { thick: 5 });
    FX.hitSpark(st, at.x, at.y, WHITE, 30, 10);
    // 反作用：自己頭上也冒一點碎石
    const h = headAt(pet);
    st.fx.burst(h.x, h.y, S, [ROCK, ROCK2], { n: 5, speed: 80, dir: -Math.PI / 2, spread: 1.8, g: 300, life: 0.5, size: S });
  },
};

// ---------- 鑽石風暴 ----------
const N_DIA = 12, RING = [0.1, 0.45], BLAST = 0.5, SWEEP = 0.45; // 猜的，可調整
const diamondstorm = {
  dimAt: 'between',
  time: () => ({ dur: 1.5, hit: BLAST + SWEEP * 0.8 }),
  update(pet, m, t, dt, K) {
    if (t > BLAST && t < BLAST + SWEEP + 0.3 && Math.random() < dt * 30) {
      const b = K.targetPoint(m.target), u = clamp01((t - BLAST) / SWEEP), x = lerp(pet.x, b.x + (b.x - pet.x) * 0.25, u);
      pet.stage.fx.sparkles(x, b.y + (Math.random() - 0.5) * 60 * pet.S, pet.S, 1, 4);
    }
  },
  draw(ctx, pet, m, t, K) {
    const S = pet.S, r = pet.rect(), cx = pet.x, cy = r.y + r.h * 0.5, b = K.targetPoint(m.target);
    if (t < RING[0] || t > BLAST + SWEEP + 0.35) return;
    const alpha = t > BLAST + SWEEP ? clamp01(1 - (t - BLAST - SWEEP) / 0.35) : 1;
    for (let i = 0; i < N_DIA; i++) {
      const at = RING[0] + (i / N_DIA) * (RING[1] - RING[0]);
      if (t < at) continue;
      const a = (i / N_DIA) * TAU + t * 2, rx = r.w * 0.8, ry = r.h * 0.55;
      let x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      if (t > BLAST) {
        // 往前炸開：排成一面直的牆，旋轉著橫掃過去
        const u = clamp01((t - BLAST) / SWEEP), wallX = lerp(cx, b.x + (b.x - cx) * 0.25, u * (2 - u)), wallY = b.y + (i - N_DIA / 2 + 0.5) * 7 * S;
        const e = clamp01(u * 3);
        x = lerp(x, wallX + Math.sin(i * 1.7) * 6 * S, e);
        y = lerp(y, wallY, e);
      }
      diamond(ctx, x, y, 5 * S * clamp01((t - at) / 0.08), t * 10 + i, i % 3 ? GEM : WHITE, alpha);
    }
  },
  pose(pet, p, m, t) { if (t < BLAST) { p.sx = 1.05; p.sy = 0.95; } else if (t < BLAST + 0.15) { p.sx = 0.95; p.sy = 1.08; } }, // 蓄力 → 放出去
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    st.fx.sparkles(at.x, at.y, S, 10, 30);
    FX.hitSpark(st, at.x, at.y, GEM, 24, 8);
  },
};

export const ROCK_MOVES = { powergem, headsmash, diamondstorm };
