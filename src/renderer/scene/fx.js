// 粒子特效：愛心、星星、碎屑、閃光圈。座標都是裝置像素。
import { blit } from '../gfx/pixel.js';
import * as art from '../gfx/art.js';

export class Fx {
  constructor() { this.parts = []; }

  add(p) { this.parts.push({ t: 0, vx: 0, vy: 0, g: 0, life: 1, fade: true, ...p }); }

  hearts(x, y, S, n = 1) {
    for (let i = 0; i < n; i++) {
      this.add({ img: art.heartSmall, x: x + (Math.random() - 0.5) * 20 * S, y, vx: (Math.random() - 0.5) * 20 * S, vy: -(28 + Math.random() * 20) * S, life: 1.1, wobble: true });
    }
  }
  bigHeart(x, y, S) { this.add({ img: art.heart, x, y, vy: -22 * S, life: 1.2, scale: 1 }); }
  sparkles(x, y, S, n = 6, spread = 30) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread * S;
      this.add({ img: art.sparkle, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vy: -8 * S, life: 0.5 + Math.random() * 0.6, blink: true });
    }
  }
  stars(x, y, S, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add({ img: art.star, x, y, vx: Math.cos(a) * 70 * S, vy: Math.sin(a) * 70 * S - 30 * S, g: 120 * S, life: 0.9 });
    }
  }
  crumbs(x, y, S, color = '#f7d7a8') {
    for (let i = 0; i < 5; i++) {
      this.add({ rect: color, size: S, x, y, vx: (Math.random() - 0.5) * 60 * S, vy: -Math.random() * 40 * S, g: 160 * S, life: 0.6 });
    }
  }
  ring(x, y, S, color = '#ffffff', maxR = 40) { this.add({ ring: color, x, y, maxR: maxR * S, S, life: 0.5 }); }
  text(x, y, str, S, color = '#ffffff') { this.add({ text: str, color, x, y, vy: -20 * S, life: 1.2, S }); }

  update(dt) {
    for (const p of this.parts) {
      p.t += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt + (p.wobble ? Math.sin(p.t * 8) * 0.6 : 0);
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter(p => p.t < p.life);
  }

  draw(ctx, S) {
    for (const p of this.parts) {
      const k = p.t / p.life;
      const alpha = p.fade ? Math.min(1, (1 - k) * 2) : 1;
      if (p.blink && Math.floor(p.t * 12) % 2) continue;
      if (p.img) {
        const sc = S * (p.scale ?? 1);
        blit(ctx, p.img, p.x - (p.img.width * sc) / 2, p.y - (p.img.height * sc) / 2, sc, { alpha });
      } else if (p.rect) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.rect;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size * 2, p.size * 2);
        ctx.globalAlpha = 1;
      } else if (p.ring) {
        // 像素風的圓：沿圓周放 S×S 的方塊
        const r = p.maxR * Math.min(1, k * 1.6);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.ring;
        const steps = Math.max(12, Math.floor((r / p.S) * 5));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          ctx.fillRect(Math.round((p.x + Math.cos(a) * r) / p.S) * p.S, Math.round((p.y + Math.sin(a) * r) / p.S) * p.S, p.S, p.S);
        }
        ctx.globalAlpha = 1;
      } else if (p.text) {
        ctx.globalAlpha = alpha;
        ctx.font = `${8 * p.S}px Cubic11, monospace`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 2 * p.S;
        ctx.strokeStyle = '#2a2030';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// 像素風圓圈（瞄準圈用）
export function pixelCircle(ctx, cx, cy, r, S, color, thickness = 1) {
  ctx.fillStyle = color;
  const steps = Math.max(16, Math.floor((r / S) * 6.5));
  const seen = new Set();
  for (let t = 0; t < thickness; t++) {
    const rr = r - t * S;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round((cx + Math.cos(a) * rr) / S) * S;
      const y = Math.round((cy + Math.sin(a) * rr) / S) * S;
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ctx.fillRect(x, y, S, S);
    }
  }
}
