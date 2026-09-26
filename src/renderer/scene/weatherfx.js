// 下雨、下雪時在整個畫面上畫一層淡淡的像素雨／雪（透明度 ≤ 0.35）。
// 只是畫在 canvas 上，不參與點擊判定，所以不會攔截滑鼠。
const MAX_ALPHA = 0.35;
const COUNT = { rain: 90, snow: 60, thunder: 110 };

export class WeatherFx {
  constructor(stage) {
    this.stage = stage;
    this.kind = null;
    this.drops = [];
    this.fade = 0; // 0–1：切換天氣時淡入淡出
    this.flash = 0; // 打雷的閃光
  }

  set(kind) {
    this.kind = ['rain', 'snow', 'thunder'].includes(kind) ? kind : null;
  }

  spawn(anywhere) {
    const { W, H, S } = this.stage;
    const snow = this.kind === 'snow';
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -10 * S,
      v: (snow ? 30 + Math.random() * 25 : 420 + Math.random() * 180) * S,
      drift: snow ? (Math.random() - 0.5) * 20 * S : -60 * S,
      phase: Math.random() * 6,
    };
  }

  update(dt) {
    const want = this.kind ? 1 : 0;
    this.fade += Math.sign(want - this.fade) * Math.min(Math.abs(want - this.fade), dt * 0.5);
    if (this.fade <= 0) { this.drops.length = 0; return; }
    const n = COUNT[this.kind] ?? 0;
    while (this.drops.length < n) this.drops.push(this.spawn(this.drops.length < n / 2));
    const { W, H } = this.stage;
    for (const d of this.drops) {
      d.phase += dt;
      d.y += d.v * dt;
      d.x += (this.kind === 'snow' ? Math.sin(d.phase * 1.5) * 12 * this.stage.S : d.drift) * dt;
      if (d.y > H || d.x < -20 || d.x > W + 20) Object.assign(d, this.spawn(false));
    }
    if (this.kind === 'thunder' && Math.random() < dt * 0.05) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  draw(ctx) {
    if (this.fade <= 0) return;
    const S = this.stage.S;
    ctx.save();
    ctx.globalAlpha = MAX_ALPHA * this.fade;
    if (this.kind === 'snow') {
      ctx.fillStyle = '#ffffff';
      for (const d of this.drops) ctx.fillRect(Math.round(d.x / S) * S, Math.round(d.y / S) * S, S * 2, S * 2);
    } else {
      ctx.fillStyle = '#7aa8e8';
      for (const d of this.drops) {
        const x = Math.round(d.x / S) * S, y = Math.round(d.y / S) * S;
        for (let i = 0; i < 4; i++) ctx.fillRect(x - i * S * 0.5, y - i * S * 2, S, S * 2); // 斜斜的一小段
      }
    }
    if (this.flash > 0) {
      ctx.globalAlpha = 0.25 * this.flash * this.fade;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.stage.W, this.stage.H);
    }
    ctx.restore();
  }
}
