// 桌面上的蛋：好了之後出現在夥伴旁邊，點一下開始孵化：
// 搖晃 → 出現裂痕 → 白光 → 寶可夢出現。演出用舞台的時間（不用 setTimeout）。
import * as art from '../gfx/art.js';
import { blit } from '../gfx/pixel.js';

const SHAKE = 2.4; // 搖晃、裂開的時間
const SCALE = 2; // 蛋畫成 2 倍大，比較看得到
const FLASH = 0.5;

export class EggProp {
  constructor(stage, { uid, x, y, color, onHatch }) {
    Object.assign(this, { stage, uid, x, y, color, onHatch });
    this.kind = 'egg';
    this.t = 0;
    this.alpha = 0;
    this.gone = false;
    this.hatchT = null; // 開始孵化後的時間
    this.onClick = () => this.start();
  }
  start() {
    if (this.hatchT !== null) return;
    this.hatchT = 0;
    this.stage.audio.sfx('open');
    this.stage.markBusy?.(SHAKE + FLASH + 1);
  }
  image() {
    const cracks = this.hatchT === null ? 0 : Math.min(3, Math.floor((this.hatchT / SHAKE) * 4));
    return art.egg(this.color, cracks);
  }
  rect() {
    const img = this.image(), S = this.stage.S * SCALE;
    return { x: Math.round(this.x - (img.width * S) / 2), y: Math.round(this.y - img.height * S), w: img.width * S, h: img.height * S };
  }
  hit(px, py) {
    const r = this.rect(), pad = 6 * this.stage.S;
    return !this.gone && this.hatchT === null && px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }
  update(dt) {
    this.t += dt;
    this.alpha = Math.min(1, this.alpha + dt * 2);
    if (this.hatchT === null) return;
    const before = this.hatchT;
    this.hatchT += dt;
    const S = this.stage.S;
    // 每出現一道裂痕就噴一點碎片
    if (Math.floor((before / SHAKE) * 4) !== Math.floor((this.hatchT / SHAKE) * 4) && this.hatchT < SHAKE) {
      this.stage.fx.sparkles(this.x, this.y - 8 * S, S, 2, 8);
      this.stage.audio.sfx('click');
    }
    if (before < SHAKE && this.hatchT >= SHAKE) {
      this.stage.fx.sparkles(this.x, this.y - 8 * S, S, 10, 18);
      this.stage.audio.sfx('sparkle');
    }
    if (this.hatchT >= SHAKE + FLASH && !this.gone) {
      this.gone = true;
      this.onHatch?.(this);
    }
  }
  draw(ctx) {
    const S = this.stage.S * SCALE, r = this.rect();
    // 平常偶爾晃一下；孵化時越晃越大力
    const k = this.hatchT === null ? (Math.sin(this.t * 1.3) > 0.93 ? 1 : 0) : 1 + (this.hatchT / SHAKE) * 3;
    const wob = Math.round(Math.sin((this.hatchT ?? this.t) * 22) * k) * S;
    ctx.fillStyle = 'rgba(20,10,30,0.18)';
    ctx.fillRect(Math.round(this.x - 5 * S), Math.round(this.y) - this.stage.S, 10 * S, this.stage.S);
    blit(ctx, this.image(), r.x + wob, r.y, S, { alpha: this.alpha });
    if (this.hatchT !== null && this.hatchT > SHAKE) {
      const w = Math.min(1, (this.hatchT - SHAKE) / FLASH);
      blit(ctx, art.egg('#ffffff', 0), r.x, r.y, S, { alpha: w });
    }
  }
}
