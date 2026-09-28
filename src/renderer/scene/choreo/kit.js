// choreo/*.js 共用的小工具（只有畫面）：座標都是裝置像素，S 是一個美術像素
export const TAU = Math.PI * 2;
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = v => Math.max(0, Math.min(1, v));

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 用「變亮」疊加畫（發光的東西）
export function glow(ctx, fn) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.restore();
}

// 加一個自己畫的東西（不自動淡出，淡出自己算）
export function part(stage, p) { stage.fx.add({ fade: false, ...p }); }

// 目標腳下的地面（目標不是夥伴時：打的那個點往下一點）
export function groundOf(m, K, S) {
  const to = K.targetPoint(m.target);
  return K.isPet(m.target) ? { x: m.target.x, y: m.target.gy } : { x: to.x, y: to.y + 20 * S };
}

// 從 from 到 to 的一個東西，照時間 k（0→1）走；path(k) 回傳位置
export function mover(stage, { life, path, drawAt, onArrive, delay = 0, ...rest }) {
  part(stage, {
    life, t: -delay, ...rest,
    tick: (p, dt) => {
      const q = path(Math.min(1, (p.t + dt) / p.life));
      (p.hist ??= []).push(q);
      if (p.hist.length > 9) p.hist.shift();
      if (p.t + dt >= p.life && !p.arrived) { p.arrived = true; onArrive?.(q); }
    },
    draw: (ctx, p, k) => drawAt(ctx, path(k), p, k),
  });
}

// 一條越來越細的尾巴（照走過的位置）
export function ribbon(ctx, hist, S, col, width, alpha = 0.8) {
  if (!hist || hist.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = col;
  for (let i = 1; i < hist.length; i++) {
    const u = i / (hist.length - 1);
    ctx.globalAlpha = alpha * u;
    ctx.lineWidth = Math.max(1, width * u * S);
    ctx.beginPath();
    ctx.moveTo(hist[i - 1].x, hist[i - 1].y);
    ctx.lineTo(hist[i].x, hist[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

// 一道很快劃過去的直線刀痕（ang：角度，len：美術像素）
export function cut(stage, x, y, ang, len, col, { life = 0.4, delay = 0, width = 2 } = {}) {
  const S = stage.S;
  part(stage, {
    x, y, life, t: -delay,
    draw: (ctx, p, k) => {
      const sweep = Math.min(1, k * 4), L = len * S, a = Math.max(0, 1 - Math.max(0, k - 0.3) * 1.5);
      const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
      glow(ctx, () => {
        ctx.globalAlpha = a;
        ctx.lineCap = 'round';
        for (const [w, c] of [[width * 2.5 * S, col], [width * S, '#ffffff']]) {
          ctx.strokeStyle = c;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(p.x - dx / 2, p.y - dy / 2);
          ctx.lineTo(p.x - dx / 2 + dx * sweep, p.y - dy / 2 + dy * sweep);
          ctx.stroke();
        }
      });
    },
  });
}

// 往外擴散的一圈（flat：扁的程度；fill：裡面也塗一點）
export function ripple(stage, x, y, col, r0, r1, { flat = 1, life = 0.5, delay = 0, width = 1.5, fill = 0 } = {}) {
  const S = stage.S;
  part(stage, {
    x, y, life, t: -delay,
    draw: (ctx, p, k) => {
      const r = lerp(r0, r1, 1 - (1 - k) * (1 - k)) * S;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, width * S * (1 - k * 0.5));
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * flat, 0, 0, TAU);
      if (fill) { ctx.fillStyle = rgba(col, fill * (1 - k)); ctx.fill(); }
      ctx.stroke();
      ctx.restore();
    },
  });
}
