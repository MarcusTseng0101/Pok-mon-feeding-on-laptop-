// 飛行屬性 5 招，每一招自己的演出
//   啄         衝過去，頭一點一點快速啄 3 下，每下一個小三角形
//   空氣斬     2 片透明彎月刃交叉飛過去（亮邊、後面有淡淡的殘影），打中是 X 字切痕
//   勇鳥猛攻   往後退、全身包成一隻藍火鳥（翅膀在拍），斜斜衝過去，打中大爆、自己被反彈回來
//   暴風       目標腳下長出龍捲風漏斗（螺旋＋碎屑），把目標捲高一點再掉下來
//   死亡之翼   背後展開暗紅翅膀，一揮 → 羽毛組成的紅光，紅色光點吸回自己
import * as FX from '../movefx.js';
import { TAU, lerp, clamp01, rgba, glow, part, groundOf, mover } from './kit.js';

const WHITE = '#ffffff', SKY = '#d0dcff', BLUE = '#5aa0f0', FIRE = '#ff6a2a', GOLD = '#ffd25a', CRIMSON = '#8a1a30', RED = '#ff5d5d', DARKRED = '#3a1020';

// ---------- 啄 ----------
const PECKS = [0.3, 0.44, 0.58], DART = 0.2, PK_BACK = [0.68, 0.95]; // 猜的，可調整
function beak(ctx, x, y, dir, s, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = Math.max(1, s / 4);
  ctx.beginPath();
  ctx.moveTo(x + dir * s * 1.6, y);
  ctx.lineTo(x - dir * s * 0.4, y - s * 0.8);
  ctx.lineTo(x - dir * s * 0.4, y + s * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
const peck = {
  time: () => ({ dur: PK_BACK[1] + 0.05, hit: PECKS[2] + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    K.dash(pet, m, t < DART ? t / DART : t < PK_BACK[0] ? 1 : Math.max(0, 1 - (t - PK_BACK[0]) / (PK_BACK[1] - PK_BACK[0])));
    if (t < DART && Math.random() < dt * 30) FX.streaks(pet);
    const s = (m.s ??= { n: 0 });
    while (s.n < 3 && t >= PECKS[s.n]) {
      const i = s.n++, b = K.targetPoint(m.target), dir = b.x > pet.x ? 1 : -1, y = b.y + [-6, 2, -2][i] * S;
      part(st, { x: b.x - dir * 6 * S, y, life: 0.16, draw: (ctx, p, k) => beak(ctx, p.x, p.y, dir, 7 * S * (1.3 - k * 0.4), 1 - k) });
      if (i < 2) { if (K.isPet(m.target)) m.target.flinchT = 0.1; st.shake(1, 0.06); }
    }
  },
  pose(pet, p, m, t) { for (const s of PECKS) { const d = t - s + 0.06; if (d > 0 && d < 0.1) { p.rot = pet.facing * 0.35 * Math.sin((d / 0.1) * Math.PI); p.pivot = 'feet'; } } }, // 頭一點一點
  impact(pet, m, at) {
    const st = pet.stage, S = st.S, dir = at.x > pet.x ? 1 : -1;
    part(st, { x: at.x - dir * 4 * S, y: at.y, life: 0.25, draw: (ctx, p, k) => beak(ctx, p.x, p.y, dir, 10 * S * (1.4 - k * 0.5), 1 - k) });
    st.fx.burst(at.x, at.y, S, [WHITE, SKY], { n: 6, speed: 90, spread: TAU, g: 200, life: 0.4, size: S / 2 });
  },
};

// ---------- 空氣斬 ----------
const BLADES = [[0.25, 0.7], [0.35, -0.7]], BLADE_FLY = 0.4; // 出發時間、傾斜；猜的，可調整
function crescent(ctx, x, y, r, ang, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(0, 0, r, -1.2, 1.2);
  ctx.arc(-r * 0.35, 0, r * 0.85, 1.05, -1.05, true);
  ctx.closePath();
  ctx.fillStyle = rgba(SKY, 0.45);
  ctx.fill();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = Math.max(1, r / 7);
  ctx.beginPath();
  ctx.arc(0, 0, r, -1.2, 1.2);
  ctx.stroke();
  ctx.restore();
}
const airslash = {
  time: () => ({ dur: 1.2, hit: BLADES[1][0] + BLADE_FLY + 0.01 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage, S = pet.S;
    const s = (m.s ??= { n: 0 });
    while (s.n < BLADES.length && t >= BLADES[s.n][0]) {
      const i = s.n++, [, tilt] = BLADES[i], a = pet.mouth(), b = K.targetPoint(m.target), dir = b.x > a.x ? 1 : -1;
      const off = tilt * 26 * S; // 兩片從上下交叉過去
      mover(st, {
        life: BLADE_FLY, S,
        path: k => ({ x: lerp(a.x, b.x, k), y: lerp(a.y - off, b.y + off * 0.3, k) + Math.sin(k * Math.PI) * off * 0.6 }),
        drawAt: (ctx, q, p) => {
          const ang = (dir > 0 ? 0 : Math.PI) + tilt * 0.6;
          // 殘影（像空氣被扭曲）
          (p.hist ?? []).slice(-4, -1).forEach((h, j) => crescent(ctx, h.x, h.y, 19 * S, ang, 0.15 + j * 0.08));
          crescent(ctx, q.x, q.y, 19 * S, ang, 1);
        },
        onArrive: q => {
          FX.slash(st, q.x, q.y, SKY, { r: 22, dir: tilt > 0 ? 1 : -1 });
          if (i === BLADES.length - 1 && pet.moveCtx === m) K.hit(pet);
          else if (K.isPet(m.target)) m.target.flinchT = 0.15;
        },
      });
    }
  },
  pose(pet, p, m, t) { if (t > BLADES[0][0] - 0.1 && t < BLADES[1][0] + 0.1) p.rot = pet.facing * (t < BLADES[1][0] - 0.05 ? -0.2 : 0.2); }, // 左右揮
  impact(pet, m, at) {
    const st = pet.stage;
    FX.slash(st, at.x, at.y, WHITE, { r: 30, dir: 1, cross: true });
    FX.hitSpark(st, at.x, at.y, SKY, 20, 8);
  },
};

// ---------- 勇鳥猛攻 ----------
const RETREAT = 0.35, CHARGE = 0.8, RECOIL = [0.8, 1.0], BB_BACK = [1.05, 1.45]; // 猜的，可調整
function fireBird(ctx, pet, t, alpha) {
  const S = pet.S, r = pet.rect(), cx = pet.x, cy = r.y + r.h / 2, f = pet.facing, flap = Math.sin(t * 28) * 0.5;
  glow(ctx, () => {
    ctx.globalAlpha = alpha;
    // 兩片翅膀（往後上方張開，一直拍）
    for (const side of [-1, 1]) {
      const tipx = cx - f * r.w * 0.9, tipy = cy - side * r.h * (0.7 + flap * 0.3);
      const g = ctx.createLinearGradient(cx, cy, tipx, tipy);
      g.addColorStop(0, rgba(WHITE, 0.9));
      g.addColorStop(0.4, rgba(BLUE, 0.8));
      g.addColorStop(1, rgba(FIRE, 0.2));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx - f * r.w * 0.3, tipy, tipx, tipy);
      ctx.quadraticCurveTo(cx - f * r.w * 0.5, cy - side * r.h * 0.2, cx - f * r.w * 0.2, cy + side * 4 * S);
      ctx.closePath();
      ctx.fill();
    }
    // 包住全身的藍火＋前面的尖嘴
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.w * 0.8);
    g.addColorStop(0, rgba(WHITE, 0.5));
    g.addColorStop(0.6, rgba(BLUE, 0.4));
    g.addColorStop(1, rgba(BLUE, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r.w, cy - r.w, r.w * 2, r.w * 2);
    ctx.fillStyle = rgba(GOLD, 0.9);
    ctx.beginPath();
    ctx.moveTo(cx + f * r.w * 0.75, cy);
    ctx.lineTo(cx + f * r.w * 0.45, cy - 4 * S);
    ctx.lineTo(cx + f * r.w * 0.45, cy + 4 * S);
    ctx.closePath();
    ctx.fill();
  });
}
const bravebird = {
  time: () => ({ dur: BB_BACK[1] + 0.05, hit: CHARGE }),
  update(pet, m, t, dt, K) {
    const st = pet.stage;
    // 退後（k 負的＝往反方向）→ 斜斜衝過去 → 被反彈 → 回來
    const k = t < RETREAT ? -0.25 * Math.sin((t / RETREAT) * Math.PI / 2)
      : t < CHARGE ? lerp(-0.25, 1, ((t - RETREAT) / (CHARGE - RETREAT)) ** 2)
        : t < RECOIL[1] ? lerp(1, 0.35, Math.sin(((t - RECOIL[0]) / (RECOIL[1] - RECOIL[0])) * Math.PI / 2))
          : t < BB_BACK[0] ? 0.35 : Math.max(0, 0.35 * (1 - (t - BB_BACK[0]) / (BB_BACK[1] - BB_BACK[0])));
    K.dash(pet, m, k);
    pet.z = t < RETREAT ? 26 * (t / RETREAT) : t < CHARGE ? 26 * (1 - (t - RETREAT) / (CHARGE - RETREAT)) : t < RECOIL[1] ? Math.sin(((t - RECOIL[0]) / (RECOIL[1] - RECOIL[0])) * Math.PI) * 12 : 0;
    if (t > RETREAT && t < CHARGE) {
      m.ghostT = (m.ghostT ?? 0) - dt;
      if (m.ghostT <= 0) { m.ghostT = 0.04; FX.afterimage(pet); const r = pet.rect(); FX.blob(st, { x: pet.x, y: r.y + r.h / 2, s0: 16, s1: 6, a0: 0.8, a1: 0, life: 0.3, col: Math.random() < 0.5 ? BLUE : FIRE, wisp: true }); }
    }
  },
  draw(ctx, pet, m, t) { if (t > 0.05 && t < RECOIL[1]) fireBird(ctx, pet, t, t < 0.2 ? t / 0.2 : t > CHARGE ? 1 - (t - CHARGE) / (RECOIL[1] - CHARGE) : 1); },
  pose(pet, p, m, t) {
    if (t < RETREAT) p.rot = -pet.facing * 0.2;
    else if (t < CHARGE) p.rot = pet.facing * 0.35; // 斜斜往下衝
    else if (t < RECOIL[1]) { p.rot = -pet.facing * 0.4; p.pivot = 'center'; } // 被反彈、往後仰
  },
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    FX.explode(st, at.x, at.y, [BLUE, FIRE, WHITE], { n: 10, size: 16, spread: 10 });
    FX.shockwave(st, at.x, at.y, WHITE, 60, { thick: 4 });
    FX.rays(st, at.x, at.y, GOLD, 90, { n: 12, life: 0.4 });
    // 反作用：自己身上冒一點火星（受傷了）
    const r = pet.rect();
    st.fx.burst(pet.x, r.y + r.h / 2, S, [FIRE, GOLD], { n: 6, speed: 70, dir: -Math.PI / 2, spread: 2, g: 150, life: 0.5, size: S / 2 });
  },
};

// ---------- 暴風 ----------
const FORM = [0.15, 0.55], LIFT = [0.6, 1.15], HU_FADE = [1.3, 1.6], FUNNEL_H = 95; // 猜的，可調整
function funnel(ctx, x, y, h, t, S, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.5 * S;
  // 一層一層越往上越寬的橢圓（漏斗），每層轉的相位不一樣
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), yy = y - u * h, rx = (4 + u * 26) * S, ry = rx * 0.28, ph = t * 14 + i * 0.7;
    ctx.strokeStyle = rgba(i % 2 ? WHITE : SKY, 0.85);
    ctx.beginPath();
    ctx.ellipse(x + Math.sin(ph * 0.5) * u * 4 * S, yy, rx, ry, 0, ph % TAU, (ph % TAU) + Math.PI * 1.5);
    ctx.stroke();
  }
  // 繞著轉的碎屑
  ctx.fillStyle = '#8a7a6a';
  for (let i = 0; i < 8; i++) {
    const u = ((i * 0.37 + t * 0.6) % 1), a = t * 10 + i * 2.1, rx = (4 + u * 26) * S;
    ctx.fillRect(x + Math.cos(a) * rx, y - u * h + Math.sin(a) * rx * 0.28, 1.5 * S, 1.5 * S);
  }
  ctx.restore();
}
const hurricane = {
  dimAt: 'between',
  time: () => ({ dur: HU_FADE[1] + 0.05, hit: LIFT[0] + 0.2 }),
  update(pet, m, t, dt, K) {
    const st = pet.stage;
    // 把目標捲高一點再放下來：由一個特效負責，時間到一定放回地上（招式被打斷也一樣）
    if (t >= LIFT[0] && !m.s && K.isPet(m.target) && !['held', 'fall'].includes(m.target.state) && !m.target.floats) {
      m.s = true;
      const who = m.target, L = LIFT[1] - LIFT[0];
      part(st, {
        x: 0, y: 0, life: L + 0.25,
        tick: (p, dt2) => { const tt = p.t + dt2; who.z = tt < L ? Math.sin(Math.min(1, tt / (L * 0.6)) * Math.PI / 2) * 22 : Math.max(0, 22 * (1 - (tt - L) / 0.2)); if (tt >= p.life - dt2) who.z = 0; },
        draw: () => {},
      });
    }
  },
  draw(ctx, pet, m, t, K) {
    if (t < FORM[0] || t > HU_FADE[1]) return;
    const S = pet.S, g = groundOf(m, K, S), grow = clamp01((t - FORM[0]) / (FORM[1] - FORM[0]));
    const alpha = t > HU_FADE[0] ? 1 - (t - HU_FADE[0]) / (HU_FADE[1] - HU_FADE[0]) : 1;
    funnel(ctx, g.x, g.y, FUNNEL_H * S * grow, t, S, alpha);
  },
  pose(pet, p, m, t) { if (t < HU_FADE[0]) p.rot = Math.sin(t * 18) * 0.12; }, // 拍翅膀颳風
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    for (let i = 0; i < 6; i++) FX.blob(st, { x: at.x + Math.cos(i) * 14 * S, y: at.y + Math.sin(i) * 8 * S, vx: -Math.sin(i) * 90 * S, vy: Math.cos(i) * 40 * S - 30 * S, s0: 10, s1: 20, a0: 0.6, a1: 0, life: 0.5, col: WHITE, wisp: true });
  },
};

// ---------- 死亡之翼 ----------
const SPREAD = 0.4, OW_ON = 0.45, OW_REACH = 0.25, OW_OFF = 1.1; // 猜的，可調整
function wings(ctx, pet, k, S) {
  const r = pet.rect(), cx = pet.x - pet.facing * r.w * 0.15, cy = r.y + r.h * 0.4;
  ctx.save();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + side * (0.35 + i * 0.28) * k, len = (30 + i * 8) * S * k;
      const x1 = cx - pet.facing * Math.abs(Math.sin(a)) * len * 0.6 + Math.cos(a) * 0, y1 = cy + Math.sin(a) * len * 0.3 - Math.cos(side * 0.5) * len * 0.5;
      ctx.strokeStyle = i % 2 ? CRIMSON : DARKRED;
      ctx.lineWidth = (3.5 - i * 0.4) * S;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx - pet.facing * len * 0.2, y1 - side * len * 0.1, x1 - pet.facing * side * len * 0.2, y1 + side * i * 3 * S);
      ctx.stroke();
    }
  }
  ctx.restore();
}
function feather(ctx, x, y, ang, len, S, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(0, 0, len / 2, len / 6, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(RED, 0.9);
  ctx.lineWidth = Math.max(1, S / 2);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.stroke();
  ctx.restore();
}
const oblivionwing = {
  time: () => ({ dur: 1.5, hit: OW_ON + OW_REACH + 0.01 }),
  update() {},
  draw(ctx, pet, m, t, K) {
    const S = pet.S, spread = t < SPREAD ? t / SPREAD : t < OW_OFF ? 1 : clamp01(1 - (t - OW_OFF) / 0.3);
    if (spread > 0) wings(ctx, pet, spread, S);
    const u1 = clamp01((t - OW_ON) / OW_REACH), fade = t > OW_OFF ? clamp01(1 - (t - OW_OFF) / 0.25) : 1;
    if (u1 <= 0 || fade <= 0) return;
    const a = pet.mouth(), b = K.targetPoint(m.target), ang = Math.atan2(b.y - a.y, b.x - a.x);
    // 細細的紅色核心＋一片一片往前飄的羽毛
    glow(ctx, () => {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(lerp(a.x, b.x, u1), lerp(a.y, b.y, u1));
      ctx.stroke();
    });
    ctx.save();
    ctx.globalAlpha = fade;
    for (let i = 0; i < 12; i++) {
      const u = ((i / 12 + t * 1.6) % 1) * u1, side = i % 2 ? 1 : -1;
      const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u) + side * Math.sin(u * 12 + i) * 7 * S;
      feather(ctx, x, y, ang + side * 0.5, 14 * S, S, i % 3 ? CRIMSON : DARKRED);
    }
    ctx.restore();
  },
  pose(pet, p, m, t) { if (t > SPREAD - 0.1 && t < OW_ON + 0.1) { p.sy = 1.08; p.rot = pet.facing * 0.15; } }, // 翅膀一揮
  impact(pet, m, at) {
    const st = pet.stage, S = st.S;
    FX.hitSpark(st, at.x, at.y, RED, 22, 8);
    // 紅色光點吸回自己
    for (let i = 0; i < 6; i++) {
      const a = { x: at.x + (i - 2.5) * 4 * S, y: at.y + ((i * 3) % 5 - 2) * 4 * S }, arc = (i % 2 ? -1 : 1) * (26 + i * 4) * S;
      mover(st, {
        life: 0.5, delay: 0.12 + i * 0.06, S,
        path: k => { const r = pet.rect(), b = { x: pet.x, y: r.y + r.h * 0.5 }; return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * arc }; },
        drawAt: (ctx, q) => glow(ctx, () => { const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 6 * S); g.addColorStop(0, rgba(RED, 1)); g.addColorStop(1, rgba(CRIMSON, 0)); ctx.fillStyle = g; ctx.fillRect(q.x - 6 * S, q.y - 6 * S, 12 * S, 12 * S); }),
        onArrive: () => { const r = pet.rect(); FX.blob(st, { x: pet.x, y: r.y + r.h / 2, s0: r.w / S * 0.6, s1: r.w / S * 1.1, a0: 0.35, a1: 0, life: 0.3, col: RED }); },
      });
    }
  },
};

export const FLYING = { peck, airslash, bravebird, hurricane, oblivionwing };
