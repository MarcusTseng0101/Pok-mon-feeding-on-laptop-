// 野生寶可夢相關的舞台物件：氣息點、野生寶可夢、丟出去的球、桌面上的小道具。
import { blit } from '../gfx/pixel.js';
import * as art from '../gfx/art.js';
import { pixelCircle } from './fx.js';
import { RING_MIN } from '../../core/capture.js';
import { spriteKey } from '../../core/forms.js';
import * as cards from '../gfx/postcards.js';

// ---------- 氣息點 ----------
export class Spot {
  constructor(stage, plan, { life }) {
    this.stage = stage;
    this.plan = plan;
    this.kind = plan.spot;
    this.t = 0;
    this.life = life;
    this.alpha = 0;
    const S = stage.S;
    // 氣息點會出現在桌面上的任何地方（避開右下角的選單按鈕）
    this.x = stage.W * (0.08 + Math.random() * 0.84);
    const groundY = stage.H * (0.3 + Math.random() * 0.62);
    if (this.x > stage.W - 120 * S && groundY > stage.H - 110 * S) this.x -= 160 * S;
    // 天空的影子在螢幕上半部盤旋；圓環浮在半空；鬼火飄在離地一點的地方
    this.baseY = this.kind === 'sky' ? stage.H * (0.15 + Math.random() * 0.25)
      : this.kind === 'ring' ? stage.H * (0.3 + Math.random() * 0.4)
      : this.kind === 'dusk' ? groundY - 18 * S
      : groundY;
    // 野生寶可夢跳出來後站的位置
    this.groundY = this.kind === 'sky' || this.kind === 'ring' ? this.baseY + 70 * S : groundY;
    this.y = this.baseY;
    this.nextRustle = 0.5;
    this.gone = false;
  }

  image() {
    const t = this.t;
    switch (this.kind) {
      case 'grass': return art.grass(Math.floor(t * 8), this.rustling);
      case 'puddle': return art.puddle(t);
      case 'rock': return art.rock(t);
      case 'dusk': return art.wisp(t);
      case 'sky': return art.bird(t);
      case 'ring': return art.ring(t);
      default: return art.grass(0, false);
    }
  }

  get rustling() { return this.kind === 'grass' && (this.t % 3) < 0.9; }

  scale() { return this.kind === 'sky' ? this.stage.S * 2 : this.stage.S; }

  rect() {
    const img = this.image(), sc = this.scale();
    const w = img.width * sc, h = img.height * sc;
    return { x: Math.round(this.x - w / 2), y: Math.round(this.y - h), w, h };
  }

  hit(px, py) {
    const r = this.rect(), pad = 8 * this.stage.S; // 比圖大一點，比較好點
    return !this.gone && px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  update(dt) {
    this.t += dt;
    const S = this.stage.S;
    this.alpha = Math.min(1, this.alpha + dt * 2);
    if (this.kind === 'sky') {
      this.x += Math.sin(this.t * 0.5) * 90 * S * dt;
      this.y = this.baseY + Math.sin(this.t * 1.3) * 12 * S;
    }
    if (this.kind === 'dusk') this.y = this.baseY + Math.round(Math.sin(this.t * 2) * 3) * S;
    if (this.kind === 'grass' && this.t > this.nextRustle) {
      this.nextRustle = this.t + 3;
      if (this.t < 10) this.stage.audio.sfx('rustle'); // 只在剛出現時出聲，不吵
    }
    // 色違：氣息點偶爾會閃一下（眼尖的人會發現）
    if (this.plan.shiny && this.alpha >= 1 && Math.random() < dt * 0.6) {
      const r = this.rect();
      this.stage.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, S, 1, 2);
    }
    if (this.t > this.life) {
      this.alpha -= dt * 2;
      if (this.alpha <= 0) this.gone = true;
    }
  }

  draw(ctx) {
    const img = this.image(), r = this.rect();
    blit(ctx, img, r.x, r.y, this.scale(), { alpha: this.alpha * (this.kind === 'sky' ? 0.7 : 1) });
    // 提示：懸停時閃「?」，平常每隔幾秒冒一下「!」吸引注意
    const cue = this.stage.hoverTarget === this ? (Math.floor(this.t * 4) % 2 === 0 ? '?' : null) : (this.t % 5 < 0.8 && this.alpha >= 1 ? '!' : null);
    if (cue) {
      const q = art.emotes[cue], S = this.stage.S;
      blit(ctx, q, this.x - (q.width * S) / 2, r.y - (q.height + 3) * S, S);
    }
  }
}

// ---------- 探頭：野生寶可夢從螢幕左右邊緣只露出半個身體 ----------
// 游標慢慢靠近、停在牠旁邊 1.5 秒 → 牠走進桌面（接著是一般的遭遇）；游標衝太快 → 牠縮回去跑掉。
// 探頭的寶可夢點不到（hit 永遠是 false），所以不會讓視窗攔截滑鼠。
export const PEEK_NEAR = 80; // CSS 像素
export const PEEK_SLOW = 250; // CSS 像素／秒：比這快就會嚇跑
export const PEEK_WAIT = 1.5; // 秒
export class PeekSpot extends Spot {
  constructor(stage, plan, opts) {
    super(stage, plan, opts);
    const S = stage.S;
    this.side = Math.random() < 0.5 ? -1 : 1; // 左邊或右邊
    this.x = this.side < 0 ? 0 : stage.W;
    this.floats = stage.dex.floats(plan.speciesId);
    this.groundY = stage.H * (0.35 + Math.random() * 0.45);
    this.baseY = this.y = this.groundY - (this.floats ? 50 * S : 0);
    this.calmT = 0;
    this.state = 'peek'; // peek → come（走進來）或 scared（縮回去）
    this.show = 0; // 露出多少（0–1）
  }

  get asset() { return this.stage.sprites.peek(spriteKey(this.plan.speciesId, this.plan.form), this.plan.shiny); }
  // 走進來以後站的位置
  get enterX() { return this.side < 0 ? 90 * this.stage.S : this.stage.W - 90 * this.stage.S; }

  // 看得到的那一半
  rect() {
    const a = this.asset, S = this.stage.S, w = a.w * S, h = a.h * S;
    const vis = w * 0.5 * this.show;
    return { x: this.side < 0 ? 0 : this.stage.W - vis, y: Math.round(this.y - h), w: vis, h };
  }

  hit() { return false; }

  update(dt) {
    const st = this.stage, S = st.S, p = st.pointer;
    this.t += dt;
    this.alpha = 1;
    if (this.state === 'scared') {
      this.show = Math.max(0, this.show - dt * 4);
      if (this.show <= 0) this.gone = true;
      return;
    }
    if (this.state === 'come') return;
    // 一下探出來、一下縮回去一點
    const target = 0.55 + Math.sin(this.t * 1.3) * 0.2;
    this.show += (target - this.show) * Math.min(1, dt * 3);
    this.y = this.baseY + (this.floats ? Math.round(Math.sin(this.t * 2) * 2) * S : 0);
    if (this.t > this.life) { this.state = 'scared'; return; } // 等太久：自己走掉
    if (!p.known) { this.calmT = Math.max(0, this.calmT - dt); return; }
    const r = this.rect();
    const cx = Math.max(r.x, Math.min(r.x + r.w, p.x)), cy = Math.max(r.y, Math.min(r.y + r.h, p.y));
    const d = Math.hypot(p.x - cx, p.y - cy) / st.dpr;
    if (d > PEEK_NEAR) { this.calmT = Math.max(0, this.calmT - dt); return; }
    if ((st.pointerSpeed?.() ?? 0) / st.dpr > PEEK_SLOW) {
      this.state = 'scared';
      st.fire('peekScared', this);
      return;
    }
    this.calmT += dt;
    if (this.calmT >= PEEK_WAIT) {
      this.state = 'come';
      st.fire('peekCome', this);
    }
  }

  draw(ctx) {
    const a = this.asset, S = this.stage.S;
    if (!a || this.show <= 0) return;
    const w = a.w * S, vis = w * 0.5 * this.show;
    // 身體的一半在螢幕外面，臉朝桌面（圖本來是朝左的）
    blit(ctx, a.canvas, this.side < 0 ? vis - w : this.stage.W - vis, this.y - a.h * S, S, { flipX: this.side < 0 });
    if (this.state === 'peek' && (this.t % 4) < 1.2) {
      const q = art.emotes[this.calmT > 0 ? '♪' : '?'];
      const hx = this.side < 0 ? Math.max(q.width * S, vis / 2) : this.stage.W - Math.max(q.width * S, vis / 2);
      blit(ctx, q, hx - (q.width * S) / 2, this.y - (a.h + q.height + 3) * S, S);
    }
  }
}

// ---------- 野生寶可夢 ----------
export class WildMon {
  constructor(stage, encounter, spot) {
    this.stage = stage;
    this.enc = encounter;
    this.x = spot.x;
    this.floats = stage.dex.floats(encounter.speciesId);
    this.alt = this.floats ? 50 : 0;
    const S = stage.S;
    this.fromY = spot.y;
    const a = this.asset;
    this.groundY = Math.max((a.h + this.alt + 8) * S, Math.min(stage.H - 3 * S, spot.groundY ?? stage.floorY));
    this.y = this.restY();
    this.t = 0;
    this.state = 'emerge';
    this.stateT = 0;
    this.facing = this.x > stage.W / 2 ? -1 : 1;
    this.visible = true;
    this.scaleK = 1;
    this.white = 0;
    this.emote = { img: art.emotes['!'], until: 1.2 };
    this.ringT = 0;
    this.eating = null;
    this.gone = false;
    this.alpha = 1;
    if (spot instanceof PeekSpot) {
      // 探頭的：從螢幕邊緣走進來
      this.walkFrom = spot.side < 0 ? -(a.w * S) / 2 : stage.W + (a.w * S) / 2;
      this.walkTo = spot.enterX;
      this.x = this.walkFrom;
      this.facing = spot.side < 0 ? 1 : -1;
      this.groundY = Math.max((a.h + this.alt + 8) * S, Math.min(stage.H - 3 * S, spot.groundY));
      this.y = this.restY();
      this.state = 'walkIn';
    }
    if (encounter.shiny) { stage.fx.sparkles(this.x, this.y - 30 * S, S, 16, 40); stage.fx.stars(this.x, this.y - 30 * S, S, 8); }
  }

  get asset() { return this.stage.sprites.peek(spriteKey(this.enc.speciesId, this.enc.form), this.enc.shiny); }
  restY() { return this.groundY - this.alt * this.stage.S; }
  set(state) { this.state = state; this.stateT = 0; }

  rect() {
    const a = this.asset, S = this.stage.S * this.scaleK;
    const w = a.w * S, h = a.h * S;
    return { x: Math.round(this.x - w / 2), y: Math.round(this.y - h), w, h };
  }
  center() { const r = this.rect(); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  mouth() { const r = this.rect(); return { x: r.x + r.w * (this.facing < 0 ? 0.35 : 0.65), y: r.y + r.h * 0.4 }; }

  hit(px, py) {
    if (!this.visible || this.state === 'emerge') return false;
    const r = this.rect(), pad = 6 * this.stage.S;
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  // 瞄準圈：大小在 1 → RING_MIN 之間來回
  ring() { return RING_MIN + (1 - RING_MIN) * (0.5 + 0.5 * Math.cos(this.ringT * Math.PI * 2 / 1.6)); }

  startEat(puffKey) { this.eating = { puff: puffKey, bites: 0 }; this.set('eat'); }

  update(dt) {
    const st = this.stage, S = st.S;
    this.t += dt;
    this.stateT += dt;
    this.ringT += dt;
    if (this.emote && this.t > this.emote.until) this.emote = null;
    if (this.enc.shiny && this.visible && Math.random() < dt * 1.2) {
      const r = this.rect();
      st.fx.sparkles(r.x + Math.random() * r.w, r.y + Math.random() * r.h, S, 1, 3);
    }
    switch (this.state) {
      case 'walkIn': {
        const k = Math.min(1, this.stateT / 1.2);
        this.x = this.walkFrom + (this.walkTo - this.walkFrom) * k;
        this.y = this.restY() - (Math.floor(this.stateT * 6) % 2) * S;
        if (k >= 1) this.set('idle');
        break;
      }
      case 'emerge': {
        // 從氣息點跳出來
        const k = Math.min(1, this.stateT / 0.5);
        this.y = this.fromY + (this.restY() - this.fromY) * k - Math.sin(k * Math.PI) * 30 * S;
        if (k >= 1) this.set('idle');
        break;
      }
      case 'idle':
        this.y = this.restY() + (this.floats ? Math.round(Math.sin(this.t * 2) * 2) * S : (Math.floor(this.t * 1.6) % 2) * -S);
        if (st.pointer.known && Math.abs(st.pointer.x - this.x) > 20 * S) this.facing = st.pointer.x > this.x ? 1 : -1;
        break;
      case 'eat':
        if (this.eating) {
          const bites = Math.min(3, Math.floor(this.stateT / 0.4));
          if (bites > this.eating.bites) {
            this.eating.bites = bites;
            const m = this.mouth();
            st.audio.sfx('eat');
            st.fx.crumbs(m.x, m.y, S);
          }
        }
        if (this.stateT > 1.4) { this.eating = null; this.set('idle'); }
        break;
      case 'absorbed':
        this.scaleK = Math.max(0.05, 1 - this.stateT / 0.35);
        this.white = 1;
        if (this.stateT > 0.35) this.visible = false;
        break;
      case 'reappear':
        this.visible = true;
        this.scaleK = Math.min(1, this.stateT / 0.3);
        this.white = this.stateT < 0.3 ? 1 : 0;
        if (this.stateT > 0.35) { this.scaleK = 1; this.set('idle'); }
        break;
      case 'flee':
        this.alpha = Math.max(0, 1 - this.stateT / 0.6);
        this.y -= 40 * S * dt;
        if (this.stateT > 0.6) this.gone = true;
        break;
      case 'caught':
        this.visible = false;
        break;
    }
  }

  draw(ctx) {
    if (!this.visible) return;
    const S = this.stage.S, a = this.asset, r = this.rect();
    const sc = Math.max(1, Math.round(S * this.scaleK));
    const img = this.white ? a.white : a.canvas;
    blit(ctx, img, this.x - (a.w * sc) / 2, this.y - a.h * sc, sc, { flipX: this.facing > 0, alpha: this.alpha });
    if (this.eating && this.eating.bites < 3) {
      const m = this.mouth(), p = art.bittenPuff(this.eating.puff, this.eating.bites);
      blit(ctx, p, m.x - (p.width * S) / 2, m.y - (p.height * S) / 2, S);
    }
    if (this.emote) {
      const e = this.emote.img;
      blit(ctx, e, r.x + r.w / 2 - (e.width * S) / 2, r.y - (e.height + 4) * S, S);
    }
  }

  drawRing(ctx, color) {
    const S = this.stage.S, r = this.rect(), c = this.center();
    const base = Math.max(r.w, r.h) * 0.62 + 6 * S;
    pixelCircle(ctx, c.x, c.y, base, S, 'rgba(255,255,255,0.85)', 1);
    pixelCircle(ctx, c.x, c.y, base * this.ring(), S, color, 2);
  }
}

// ---------- 丟出去的球 ----------
// 時間軸：飛行 → 命中（寶可夢被吸進去）→ 掉到地上 → 搖 N 下 → 成功（星星）或 破球
export class ThrownBall {
  constructor(stage, { kind, from, target, floorY, result, onHit, onDone }) {
    Object.assign(this, { stage, kind, from, target, floorY, result, onHit, onDone });
    this.t = 0;
    this.phase = 'fly';
    this.x = from.x;
    this.y = from.y;
    this.rot = 0;
    this.shakesDone = 0;
    this.alpha = 1;
    this.gone = false;
  }

  get img() { return art.balls[this.kind]; }

  update(dt) {
    const st = this.stage, S = st.S;
    this.t += dt;
    const T = this.t;
    switch (this.phase) {
      case 'fly': {
        const k = Math.min(1, T / 0.55);
        this.x = this.from.x + (this.target.x - this.from.x) * k;
        this.y = this.from.y + (this.target.y - this.from.y) * k - Math.sin(k * Math.PI) * 120 * S;
        this.rot = Math.floor(T * 16) % 4;
        if (k >= 1) {
          this.phase = 'hit';
          this.t = 0;
          this.rot = 0;
          st.audio.sfx('hit');
          st.fx.ring(this.x, this.y, S, '#ffffff', 30);
          this.onHit?.();
        }
        break;
      }
      case 'hit':
        if (T > 0.45) { this.phase = 'drop'; this.t = 0; this.dropFrom = this.y; }
        break;
      case 'drop': {
        const floor = (this.floorY ?? st.floorY) - (this.img.height / 2) * S;
        const k = Math.min(1, T / 0.35);
        this.y = this.dropFrom + (floor - this.dropFrom) * k * k;
        if (k >= 1) { this.phase = 'wait'; this.t = 0; st.audio.sfx('land'); }
        break;
      }
      case 'wait':
        if (T > 0.5) { this.phase = this.result.shakes > 0 ? 'shake' : 'resolve'; this.t = 0; }
        break;
      case 'shake': {
        // 每一下 0.9 秒：前 0.35 秒左右晃
        const within = T % 0.9;
        this.tilt = within < 0.35 ? Math.round(Math.sin((within / 0.35) * Math.PI * 2) * 2) : 0;
        const n = Math.floor(T / 0.9);
        if (n >= this.shakesDone && this.shakesDone < this.result.shakes) {
          this.shakesDone++;
          st.audio.sfx('shake');
        }
        if (T >= this.result.shakes * 0.9) { this.phase = 'resolve'; this.t = 0; this.tilt = 0; }
        break;
      }
      case 'resolve':
        this.phase = this.result.caught ? 'caught' : 'break';
        this.t = 0;
        if (this.result.caught) {
          st.audio.sfx('lock');
          st.fx.stars(this.x, this.y, S, 6);
        } else {
          st.audio.sfx('breakout');
          st.fx.ring(this.x, this.y, S, '#ffffff', 36);
        }
        this.onDone?.(this.result);
        break;
      case 'caught':
        if (T > 1.4) this.alpha = Math.max(0, 1 - (T - 1.4) * 3);
        if (this.alpha <= 0) this.gone = true;
        break;
      case 'break':
        this.alpha = Math.max(0, 1 - T * 4);
        if (this.alpha <= 0) this.gone = true;
        break;
    }
  }

  draw(ctx) {
    const S = this.stage.S, img = this.img;
    const w = img.width * S, h = img.height * S;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(Math.round(this.x), Math.round(this.y));
    ctx.rotate((this.rot * Math.PI) / 2 + (this.tilt ?? 0) * 0.2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

// ---------- 桌面上的小道具（誘餌泡芙、基格爾德核心） ----------
export class Prop {
  constructor(stage, { kind, x, y, puff = null, life = Infinity, onClick }) {
    Object.assign(this, { stage, kind, x, y, puff, life, onClick });
    this.t = 0;
    this.alpha = 0;
    this.gone = false;
  }
  image() { return this.kind === 'cell' ? art.zygardeCell(this.t) : this.kind === 'note' ? cards.note : art.puff(this.puff); }
  rect() {
    const img = this.image(), S = this.stage.S;
    const bob = this.kind === 'cell' ? Math.round(Math.sin(this.t * 2)) * S : 0;
    return { x: Math.round(this.x - (img.width * S) / 2), y: Math.round(this.y - img.height * S + bob), w: img.width * S, h: img.height * S };
  }
  hit(px, py) {
    const r = this.rect(), pad = 6 * this.stage.S;
    return !this.gone && px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }
  update(dt) {
    this.t += dt;
    this.alpha = this.t > this.life ? Math.max(0, this.alpha - dt * 2) : Math.min(1, this.alpha + dt * 2);
    if (this.t > this.life && this.alpha <= 0) this.gone = true;
    // 誘餌會飄出香味
    if (this.kind === 'lure' && Math.random() < dt * 1.5) {
      const S = this.stage.S;
      this.stage.fx.add({ rect: art.FLAVOR_COLORS[this.puff.split('-')[0]].H, size: S / 2, x: this.x + (Math.random() - 0.5) * 10 * S, y: this.y - 12 * S, vy: -20 * S, life: 1.2, wobble: true });
    }
  }
  draw(ctx) {
    const r = this.rect(), S = this.stage.S;
    blit(ctx, this.image(), r.x, r.y, S, { alpha: this.alpha });
  }
}
