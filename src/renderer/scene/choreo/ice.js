// 冰屬性 4 招，每一招自己的演出
//   極光束   波浪狀的彩帶，顏色分層、底下垂著簾幕，慢慢波動往前；目標身上流過彩色光帶
//   冰礫     自己前面空中長出 3 根冰錐，一根接一根最快射出，碎成有稜角的冰片，地上留霜
//   雪崩     目標頭上雪越堆越多，一整塊砸下來，目標被雪埋一半、雪慢慢融
//   冷凍乾燥 霜從自己腳下沿地面長出分岔冰紋爬到目標，目標被冰塊包住 → 裂開 → 碎成雪花
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover } from './kit.js';

const ICE = '#7ad0ff', PALE = '#e8fbff', WHITE = '#ffffff', LILAC = '#b0a0ff';
const AURORA = ['#7affc8', '#7ab8ff', '#c070ff', '#ff9ec7'];

// ---------- 極光束 ----------
const AB_ON = 0.25, AB_REACH = 0.35, AB_OFF = 1.0; // 猜的，可調整
const aurorabeam = {
  time: () => ({ dur: 1.4, hit: AB_ON + AB_REACH + 0.01 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - AB_ON) / AB_REACH), fade = t > AB_OFF ? clamp01(1 - (t - AB_OFF) / 0.3) : 1;
    if (u1 <= 0 || fade <= 0) return;
    const n = 30, wave = (u, ph) => Math.sin(u * 7 - t * 6 + ph) * 13 * S * Math.min(1, u * 5);
    glow(ctx, () => {
      // 簾幕：沿路往下垂的淡色直條
      for (let i = 0; i <= n; i += 2) {
        const u = (i / n) * u1, x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) + wave(u, 0);
        const g = ctx.createLinearGradient(0, y - 16 * S, 0, y + 40 * S);
        g.addColorStop(0, rgba(AURORA[(i / 2) % 4], 0.45 * fade));
        g.addColorStop(1, rgba(AURORA[(i / 2) % 4], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - S, y - 16 * S, 3 * S, 56 * S);
      }
      // 4 條分層的彩帶
      AURORA.forEach((c, j) => {
        ctx.strokeStyle = rgba(c, 0.8 * fade);
        ctx.lineWidth = 2.2 * S;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const u = (i / n) * u1, x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) + wave(u, j * 0.5) + (j - 1.5) * 3 * S;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
    });
  },
  pose(pet, p, m, t) { if (t > AB_ON && t < AB_OFF) p.rot = pet.facing * Math.sin(t * 8) * 0.05; }, // 跟著彩帶輕輕搖
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    const r = K.isPet(m.target) ? m.target.rect() : { x: at.x - 14 * S, y: at.y - 14 * S, w: 28 * S, h: 28 * S };
    // 彩色光帶由下往上流過目標
    part(st, {
      x: at.x, y: at.y, life: 0.6,
      draw: (ctx, p, k) => glow(ctx, () => AURORA.forEach((c, j) => {
        const y = r.y + r.h * (1 - ((k * 1.4 + j * 0.18) % 1));
        ctx.fillStyle = rgba(c, 0.6 * (1 - k));
        ctx.fillRect(r.x, y, r.w, 2 * S);
      })),
    });
    st.fx.sparkles(at.x, at.y, S, 6, 22);
  },
};

// ---------- 冰礫 ----------
const SHARD_GROW = 0.3, SHOOT = [0.3, 0.37, 0.44], SHARD_FLY = 0.16; // 猜的，可調整
const SHARD_DY = [-9, 0, 9];
function drawShard(ctx, x, y, ang, len, w, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(len / 2, 0);
  ctx.lineTo(len * 0.1, -w / 2);
  ctx.lineTo(-len / 2, 0);
  ctx.lineTo(len * 0.1, w / 2);
  ctx.closePath();
  ctx.fillStyle = rgba(ICE, 0.85);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = Math.max(1, w / 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len / 2, 0);
  ctx.lineTo(-len / 2, 0);
  ctx.strokeStyle = PALE;
  ctx.stroke();
  ctx.restore();
}
const shardHome = (pet, i) => { const f = pet.mouth(); return { x: f.x + pet.facing * 12 * pet.S, y: f.y + SHARD_DY[i] * pet.S }; };
function frost(st, x, y) {
  const S = st.S;
  part(st, {
    x, y, life: 0.9,
    draw: (ctx, p, k) => {
      ctx.save();
      ctx.globalAlpha = 0.7 * (1 - k);
      ctx.fillStyle = PALE;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 16 * S, 4 * S, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = WHITE;
      for (let i = -2; i <= 2; i++) ctx.fillRect(p.x + i * 6 * S, p.y - S - (i % 2 ? S : 0), S, S);
      ctx.restore();
    },
  });
}
const iceshard = {
  time: () => ({ dur: 1.05, hit: SHOOT[2] + SHARD_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < 3 && t >= SHOOT[s.n]) {
      const i = s.n++, a = shardHome(pet, i), b = K.targetPoint(m.target), ang = Math.atan2(b.y - a.y, b.x - a.x);
      mover(st, {
        life: SHARD_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y + SHARD_DY[i] * S * 0.5, k) }),
        drawAt: (ctx, q) => {
          ctx.save();
          ctx.strokeStyle = rgba(WHITE, 0.6);
          ctx.lineWidth = S;
          for (const o of [-3, 3]) { ctx.beginPath(); ctx.moveTo(q.x - Math.cos(ang) * 22 * S, q.y + o * S); ctx.lineTo(q.x - Math.cos(ang) * 8 * S, q.y + o * S); ctx.stroke(); } // 速度線
          ctx.restore();
          drawShard(ctx, q.x, q.y, ang, 26 * S, 8 * S);
        },
        onArrive: q => {
          st.fx.burst(q.x, q.y, S, [WHITE, PALE, ICE], { n: 6, speed: 120, spread: TAU, g: 260, life: 0.45, size: S });
          if (i === 2 && pet.moveCtx === m) K.hit(pet);
          else if (K.isPet(m.target)) m.target.flinchT = 0.15;
        },
      });
    }
  },
  // 空中長出冰錐（還沒射出去的）
  draw(ctx, pet, m, t, K) {
    const S = pet.S, b = K.targetPoint(m.target);
    for (let i = 0; i < 3; i++) {
      if (t >= SHOOT[i]) continue;
      const g = clamp01((t - i * 0.06) / (SHARD_GROW - 0.05)), a = shardHome(pet, i);
      if (g <= 0) continue;
      drawShard(ctx, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), 26 * S * g, 8 * S * g, g);
    }
  },
  pose(pet, p, m, t) { if (t < SHARD_GROW) p.sy = 1.05; else if (t < SHOOT[2] + 0.1) p.rot = pet.facing * 0.08; },
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 有稜角的冰片往外噴＋地上一片霜
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3, v = 110 * S;
      mover(st, { life: 0.4, S, path: k => ({ x: at.x + Math.cos(a) * v * k * 0.4, y: at.y + Math.sin(a) * v * k * 0.4 + k * k * 30 * S }), drawAt: (ctx, q, p, k) => drawShard(ctx, q.x, q.y, a + k * 6, 7 * S, 3 * S, 1 - k) });
    }
    frost(st, g.x, g.y);
  },
};

// ---------- 雪崩 ----------
const PILE = [0.1, 0.75], DROP = 0.2; // 猜的，可調整
function snowMound(ctx, x, y, w, h, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  for (let i = 0; i <= 8; i++) { const u = i / 8; ctx.lineTo(x - w / 2 + w * u, y - Math.sin(u * Math.PI) * h - Math.sin(u * 17) * h * 0.12); }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALE;
  ctx.fillRect(x - w * 0.3, y - h * 0.3, w * 0.6, h * 0.12);
  ctx.strokeStyle = rgba(ICE, 0.8);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
const pileTop = (m, K, S) => { const b = K.targetPoint(m.target), h = K.isPet(m.target) ? m.target.rect().y : b.y - 16 * S; return { x: b.x, y: h - 22 * S }; };
const avalanche = {
  time: () => ({ dur: 1.75, hit: PILE[1] + DROP + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    // 雪花往那一堆飄
    if (t > PILE[0] && t < PILE[1] && Math.random() < dt * 25) {
      const top = pileTop(m, K, S);
      st.fx.add({ rect: WHITE, size: S / 2, x: top.x + (Math.random() - 0.5) * 60 * S, y: top.y - 40 * S, vx: 0, vy: 60 * S, life: 0.6, wobble: true });
    }
  },
  draw(ctx, pet, m, t, K) {
    if (t < PILE[0] || t > PILE[1] + DROP) return;
    const S = pet.S, top = pileTop(m, K, S), g = clamp01((t - PILE[0]) / (PILE[1] - PILE[0]));
    const fall = t > PILE[1] ? ((t - PILE[1]) / DROP) ** 2 : 0, gy = groundOf(m, K, S).y;
    const y = lerp(top.y, gy - 6 * S, fall);
    snowMound(ctx, top.x, y, (14 + 40 * g) * S, (6 + 16 * g) * S);
    // 還沒掉下來前：底下有影子
    if (fall === 0) { ctx.save(); ctx.globalAlpha = 0.25 * g; ctx.fillStyle = '#2a3a4a'; ctx.beginPath(); ctx.ellipse(top.x, gy, 24 * S * g, 5 * S, 0, 0, TAU); ctx.fill(); ctx.restore(); }
  },
  pose(pet, p, m, t) { if (t < PILE[1]) p.rot = -pet.facing * 0.12; }, // 抬頭看上面
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 被雪埋一半，雪慢慢融
    part(st, { x: g.x, y: g.y, life: 1.0, draw: (ctx, p, k) => snowMound(ctx, p.x, p.y, 56 * S * (1 - k * 0.3), 24 * S * (1 - k), k > 0.7 ? (1 - k) / 0.3 : 1) });
    for (const dir of [-1, 1]) for (let i = 0; i < 3; i++) FX.blob(st, { x: g.x + dir * 10 * S, y: g.y - 6 * S, vx: dir * (60 + i * 30) * S, vy: -20 * S, s0: 12, s1: 28, a0: 0.8, a1: 0, life: 0.7, col: WHITE, wisp: true, delay: i * 0.04 });
    st.fx.burst(g.x, g.y - 10 * S, S, [WHITE, PALE], { n: 12, speed: 120, dir: -Math.PI / 2, spread: 2.2, g: 300, life: 0.6, size: S });
  },
};

// ---------- 冷凍乾燥 ----------
const CREEP = [0.1, 0.7], ENCASE = 0.72, CRACK = 0.3, SHATTER = 0.45; // 猜的，可調整
// 冰紋：主線沿地面，固定的分岔（相對位置 u、長度、角度）
const BRANCHES = [[0.15, 7, -0.9], [0.28, 5, 0.8], [0.42, 8, -0.7], [0.55, 6, 0.9], [0.68, 7, -1.0], [0.8, 5, 0.7], [0.9, 6, -0.8]];
const freezedry = {
  dimAt: 'between',
  time: () => ({ dur: 1.6, hit: ENCASE }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, g = groundOf(m, K, S), a = { x: pet.x, y: pet.gy }, k = clamp01((t - CREEP[0]) / (CREEP[1] - CREEP[0]));
    const fade = t > 1.2 ? clamp01(1 - (t - 1.2) / 0.3) : 1;
    if (k <= 0 || fade <= 0) return;
    const pt = u => ({ x: lerp(a.x, g.x, u), y: lerp(a.y, g.y, u) - Math.sin(u * 23) * S });
    glow(ctx, () => {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = PALE;
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) { const q = pt((i / 30) * k); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
      ctx.stroke();
      ctx.lineWidth = 2 * S;
      for (const [u, len, ang] of BRANCHES) {
        if (u > k) break;
        const q = pt(u), L = len * 2 * S * clamp01((k - u) / 0.1), dir = Math.sign(g.x - a.x) || 1;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x + Math.cos(ang) * L * dir, q.y + Math.sin(ang) * L * 0.4);
        ctx.stroke();
      }
      const tip = pt(k);
      ctx.fillStyle = WHITE;
      ctx.fillRect(tip.x - S, tip.y - S, 2 * S, 2 * S);
    });
  },
  pose(pet, p, m, t) { if (t < CREEP[1]) { p.sx = 1.04; p.sy = 0.96; } }, // 手按地面
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    const r = K.isPet(m.target) ? m.target.rect() : { x: at.x - 14 * S, y: at.y - 14 * S, w: 28 * S, h: 28 * S };
    const x0 = r.x - 3 * S, y0 = r.y - 3 * S, w = r.w + 6 * S, h = r.h + 6 * S;
    // 冰塊包住 → 裂開 → 碎掉
    part(st, {
      x: at.x, y: at.y, life: SHATTER,
      draw: (ctx, p, k) => {
        ctx.save();
        ctx.fillStyle = rgba(ICE, 0.3);
        ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 1.5 * S;
        ctx.strokeRect(x0, y0, w, h);
        ctx.strokeStyle = PALE;
        ctx.beginPath(); ctx.moveTo(x0 + 3 * S, y0 + 3 * S); ctx.lineTo(x0 + w * 0.4, y0 + 3 * S); ctx.stroke(); // 反光
        if (p.t > CRACK) {
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = S;
          ctx.beginPath();
          ctx.moveTo(x0 + w * 0.5, y0); ctx.lineTo(x0 + w * 0.42, y0 + h * 0.4); ctx.lineTo(x0 + w * 0.6, y0 + h * 0.6); ctx.lineTo(x0 + w * 0.48, y0 + h);
          ctx.moveTo(x0 + w * 0.42, y0 + h * 0.4); ctx.lineTo(x0, y0 + h * 0.3);
          ctx.moveTo(x0 + w * 0.6, y0 + h * 0.6); ctx.lineTo(x0 + w, y0 + h * 0.75);
          ctx.stroke();
        }
        ctx.restore();
      },
    });
    FX.later(st, SHATTER, () => {
      st.fx.burst(r.x + r.w / 2, r.y + r.h / 2, S, [WHITE, PALE, LILAC], { n: 16, speed: 70, spread: TAU, g: 40, life: 0.9, size: S, wobble: true });
      FX.hitSpark(st, r.x + r.w / 2, r.y + r.h / 2, PALE, 18, 8);
    });
    if (K.isPet(m.target)) m.target.flinchT = SHATTER;
  },
};

export const ICE_MOVES = { aurorabeam, iceshard, avalanche, freezedry };
