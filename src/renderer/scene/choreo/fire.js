// 火屬性 3 招，每一招自己的演出
//   火花     「噗、噗、噗」連吐 3 顆小火星，貼地彈一下再跳到目標，打中冒小煙、火星往上飄
//   噴射火焰 從嘴巴往前越來越寬的錐形火舌，一直往上飄；打中時目標邊緣燒成一圈火、頭上冒黑煙
//   魔法火焰 空中畫一圈紫色符文火環，火球從環裡升起、繞一圈、從上面落下，目標腳下噴出直的紫橘火柱
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover } from './kit.js';

const RED = '#ff3a1a', ORANGE = '#ff8a2a', YELLOW = '#ffd25a', CORE = '#fff2b0', VIOLET = '#c070ff';

// 一小團往上尖的火（flicker：0–1 的晃動）
function flame(ctx, x, y, r, cols = [RED, ORANGE, YELLOW], flicker = 0) {
  const h = r * (1.8 + flicker * 0.5);
  glow(ctx, () => {
    cols.forEach((c, i) => {
      const s = 1 - i * 0.3;
      ctx.fillStyle = rgba(c, 0.9);
      ctx.beginPath();
      ctx.moveTo(x - r * s, y);
      ctx.quadraticCurveTo(x - r * s, y - h * s * 0.6, x + (flicker - 0.5) * r * 0.5, y - h * s);
      ctx.quadraticCurveTo(x + r * s, y - h * s * 0.6, x + r * s, y);
      ctx.arc(x, y, r * s, 0, Math.PI);
      ctx.fill();
    });
  });
}

// 往上飄的火星
function embers(stage, x, y, n, spread = 10) {
  const S = stage.S;
  for (let i = 0; i < n; i++) stage.fx.add({ rect: i % 2 ? YELLOW : ORANGE, size: S / 2, x: x + (Math.random() - 0.5) * spread * S, y, vx: (Math.random() - 0.5) * 30 * S, vy: -(40 + Math.random() * 50) * S, g: -20 * S, life: 0.6 + Math.random() * 0.4 });
}

// ---------- 火花 ----------
const SPIT = [0.15, 0.27, 0.39], HOP = 0.45; // 猜的，可調整
const ember = {
  time: () => ({ dur: 1.3, hit: SPIT[2] + HOP + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < 3 && t >= SPIT[s.n]) {
      const i = s.n++, a = pet.mouth(), b = K.targetPoint(m.target), gy = groundOf(m, K, S).y - 2 * S;
      const mid = lerp(a.x, b.x, 0.45);
      // 先落到地上（彈一下），再跳到目標
      const path = k => k < 0.45
        ? { x: lerp(a.x, mid, k / 0.45), y: lerp(a.y, gy, (k / 0.45) ** 2) }
        : { x: lerp(mid, b.x, (k - 0.45) / 0.55), y: lerp(gy, b.y, (k - 0.45) / 0.55) - Math.sin(((k - 0.45) / 0.55) * Math.PI) * 18 * S };
      let bounced = false;
      mover(st, {
        life: HOP, S,
        path,
        onStep: (q, k) => { if (!bounced && k >= 0.45) { bounced = true; FX.smoke(st, q.x, q.y, 10); st.fx.burst(q.x, q.y, S, [ORANGE, YELLOW], { n: 3, speed: 50, dir: -Math.PI / 2, spread: 1.4, g: 200, life: 0.3, size: S / 2 }); } },
        drawAt: (ctx, q, p) => {
          flame(ctx, q.x, q.y, 5 * S, [RED, ORANGE, YELLOW], (Math.sin(p.t * 60) + 1) / 2);
        },
        onArrive: q => {
          embers(st, q.x, q.y, 3);
          FX.smoke(st, q.x, q.y, 14);
          if (i === 2 && pet.moveCtx === m) K.hit(pet);
          else if (K.isPet(m.target)) m.target.flinchT = 0.15;
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t < SPIT[2] + 0.1) { const b = Math.max(0, Math.sin((t - SPIT[0] + 0.1) * 50)); p.sx = 1 + b * 0.06; p.sy = 1 - b * 0.06; } }, // 吐一下縮一下
  impact(pet, m, at) {
    const st = pet.stage;
    embers(st, at.x, at.y, 8, 16);
    for (let i = 0; i < 2; i++) FX.smoke(st, at.x + (i ? 6 : -6) * st.S, at.y, 18);
    FX.hitSpark(st, at.x, at.y, YELLOW, 14, 6);
  },
};

// ---------- 噴射火焰 ----------
const FT_ON = 0.25, FT_REACH = 0.3, FT_OFF = 0.95; // 猜的，可調整
const flamethrower = {
  time: () => ({ dur: 1.3, hit: FT_ON + FT_REACH + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S, b = K.targetPoint(m.target);
    if (t > FT_ON + FT_REACH && t < FT_OFF && Math.random() < dt * 12) FX.smoke(st, b.x, b.y - 16 * S, 16); // 目標頭上的煙
    if (t > FT_ON && t < FT_OFF && Math.random() < dt * 20) embers(st, b.x, b.y, 1, 20);
  },
  // 錐形：越遠越寬、越往上飄；顏色從黃（嘴邊）到紅（前端）
  draw(ctx, pet, m, t, K) {
    const S = pet.S, a = pet.mouth(), b = K.targetPoint(m.target);
    const u1 = clamp01((t - FT_ON) / FT_REACH), fade = t > FT_OFF ? clamp01(1 - (t - FT_OFF) / 0.25) : 1;
    if (u1 <= 0 || fade <= 0) return;
    const n = 22;
    glow(ctx, () => {
      for (let i = n; i >= 0; i--) {
        const u = (i / n) * u1;
        const r = (3 + 13 * u) * S * fade, lift = u * u * 14 * S, wob = Math.sin(t * 34 + i * 1.7) * u * 5 * S;
        const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) - lift + wob;
        const col = u < 0.3 ? YELLOW : u < 0.65 ? ORANGE : RED;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(u < 0.2 ? CORE : YELLOW, 0.55 * fade));
        g.addColorStop(0.5, rgba(col, 0.35 * fade));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    // 錐形的邊上竄出的小火舌
    for (let i = 1; i <= 5; i++) {
      const u = (i / 6) * u1, x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) - u * u * 14 * S - (3 + 13 * u) * S * 0.6;
      flame(ctx, x, y, (1.5 + 2.5 * u) * S * fade, [RED, ORANGE, YELLOW], (Math.sin(t * 40 + i * 2) + 1) / 2);
    }
  },
  pose(pet, p, m, t) { if (t > FT_ON && t < FT_OFF) { p.rot = pet.facing * 0.05; p.sx = 1.03; } else if (t < FT_ON) { p.sy = 1.05; } }, // 先吸氣
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S;
    // 目標身上燒成一圈（邊緣的火舌），頭上冒黑煙
    const r = K.isPet(m.target) ? m.target.rect() : { x: at.x - 14 * S, y: at.y - 14 * S, w: 28 * S, h: 28 * S };
    part(st, {
      x: at.x, y: at.y, life: 0.6,
      draw: (ctx, p, k) => {
        const f = 1 - k;
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * TAU, x = r.x + r.w / 2 + Math.cos(ang) * r.w * 0.5, y = r.y + r.h / 2 + Math.sin(ang) * r.h * 0.45;
          flame(ctx, x, y, 3 * S * f, [RED, ORANGE, YELLOW], (Math.sin(p.t * 40 + i) + 1) / 2);
        }
      },
    });
    for (let i = 0; i < 3; i++) FX.smoke(st, at.x + (i - 1) * 8 * S, r.y, 24);
    embers(st, at.x, at.y, 6, 20);
  },
};

// ---------- 魔法火焰 ----------
const RUNE = 0.45, RISE = 0.75, LAND = 1.15; // 猜的，可調整
const ringAt = pet => { const r = pet.rect(); return { x: pet.x + pet.facing * r.w * 0.7, y: r.y + r.h * 0.35 }; };
function drawRune(ctx, c, R, k, spin, alpha, S) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = VIOLET;
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, R * 0.45, R, 0, spin, spin + TAU * k); // 側面看的圓環（直的橢圓）
  ctx.stroke();
  ctx.fillStyle = '#ffd0ff';
  for (let i = 0; i < 6; i++) {
    const a = spin + (i / 6) * TAU;
    if ((i / 6) > k) break;
    ctx.fillRect(c.x + Math.cos(a) * R * 0.45 - S, c.y + Math.sin(a) * R - S, 2 * S, 2 * S);
  }
  ctx.restore();
}
const mysticalfire = {
  time: () => ({ dur: 1.7, hit: LAND + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    if (t >= RUNE && !m.s) {
      m.s = true;
      const c = ringAt(pet), b = K.targetPoint(m.target), top = Math.min(c.y, b.y) - 50 * S;
      // 從環中間升起、繞一圈，再從上面落到目標
      const up = RISE - RUNE, down = LAND - RISE, L = up + down;
      const path = k => {
        const tt = k * L;
        if (tt < up) { const u = tt / up, a = u * TAU; return { x: c.x + Math.sin(a) * 10 * S, y: lerp(c.y, c.y - 30 * S, u) + (1 - Math.cos(a)) * 4 * S }; }
        const u = (tt - up) / down;
        return { x: lerp(c.x, b.x, u), y: lerp(c.y - 30 * S, b.y, u * u) - Math.sin(u * Math.PI) * (c.y - 30 * S - top) * 0.6 };
      };
      mover(st, {
        life: L, S, path,
        drawAt: (ctx, q, p) => {
          glow(ctx, () => { const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 12 * S); g.addColorStop(0, rgba(VIOLET, 0.6)); g.addColorStop(1, rgba(VIOLET, 0)); ctx.fillStyle = g; ctx.fillRect(q.x - 12 * S, q.y - 12 * S, 24 * S, 24 * S); });
          flame(ctx, q.x, q.y + 3 * S, 5 * S, [VIOLET, ORANGE, YELLOW], (Math.sin(p.t * 30) + 1) / 2);
        },
        onArrive: () => { if (pet.moveCtx === m) K.hit(pet); },
      });
    }
  },
  draw(ctx, pet, m, t) {
    if (t > RISE + 0.2) return;
    const S = pet.S, c = ringAt(pet), k = clamp01(t / RUNE), alpha = t > RISE ? 1 - (t - RISE) / 0.2 : 1;
    glow(ctx, () => drawRune(ctx, c, 22 * S, k, t * 3, alpha, S));
  },
  pose(pet, p, m, t) { if (t < RUNE) p.rot = -pet.facing * 0.08 * Math.sin(t * 14); }, // 畫符文時搖頭
  impact(pet, m, at, eff, K) {
    const st = pet.stage, S = st.S, g = groundOf(m, K, S);
    // 目標腳下噴出直的紫橘火柱
    part(st, {
      x: g.x, y: g.y, life: 0.65,
      draw: (ctx, p, k) => {
        const h = 70 * S * Math.min(1, k * 5), f = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        for (let i = 0; i < 7; i++) {
          const u = i / 6, y = p.y - u * h, w = (9 - u * 5) * S * f;
          flame(ctx, p.x + Math.sin(p.t * 25 + i * 1.3) * 2 * S, y, w, i % 2 ? [VIOLET, ORANGE, YELLOW] : [RED, VIOLET, CORE], (Math.sin(p.t * 40 + i) + 1) / 2);
        }
      },
    });
    FX.shockwave(st, g.x, g.y, VIOLET, 30, { flat: 0.3, thick: 2 });
    embers(st, g.x, g.y - 30 * S, 6, 12);
  },
};

export const FIRE = { ember, flamethrower, mysticalfire };
