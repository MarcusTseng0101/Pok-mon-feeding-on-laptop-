// 桌面上的夥伴寶可夢：走路、發呆、睡覺、看著游標、被抓起來、掉下來、吃泡芙。
// 位置 (x, y) = 腳底中心，單位是裝置像素；美術像素 × stage.S = 裝置像素。
import { blit } from '../gfx/pixel.js';
import * as art from '../gfx/art.js';
import { hearts } from '../../core/amie.js';

const WALK_SPEED = 26; // 美術像素／秒
const GRAVITY = 900; // 美術像素／秒²

export class Pet {
  constructor(stage, mon, { x, fromBall = false } = {}) {
    this.stage = stage;
    this.mon = mon;
    this.uid = mon.uid;
    this.floats = stage.dex.floats(mon.species);
    this.alt = this.floats ? 40 + Math.random() * 90 : 0; // 飄浮高度（美術像素）
    this.x = x ?? stage.W * (0.2 + Math.random() * 0.6);
    this.y = this.restY();
    this.vx = 0;
    this.vy = 0;
    this.facing = Math.random() < 0.5 ? -1 : 1; // -1 面向左（原圖方向）
    this.t = Math.random() * 10;
    this.state = fromBall ? 'appear' : 'idle';
    this.stateT = 0;
    this.dur = 1 + Math.random() * 2;
    this.targetX = this.x;
    this.emote = null;
    this.eating = null;
    this.grab = null;
    this.walkPhase = 0;
    this.upsideDown = false;
    this.alpha = 1;
    this.leaving = false;
    this.evolveView = null; // 進化演出時由外部控制
  }

  get asset() { return this.stage.sprites.peek(this.mon.species, this.mon.shiny); }
  get S() { return this.stage.S; }
  restY() { return this.stage.floorY - this.alt * this.stage.S; }
  set(state, dur = 0) { this.state = state; this.stateT = 0; this.dur = dur; }

  // 在螢幕上的矩形（裝置像素）
  rect() {
    const a = this.asset, S = this.S;
    const w = a.w * S, h = a.h * S;
    return { x: Math.round(this.x - w / 2), y: Math.round(this.y - h - this.lift() * S), w, h };
  }
  head() { const r = this.rect(); return { x: r.x + r.w / 2, y: r.y }; }
  mouth() { const r = this.rect(); return { x: r.x + r.w * (this.facing < 0 ? 0.35 : 0.65), y: r.y + r.h * 0.4 }; }

  lift() {
    if (this.state === 'walk' || this.state === 'follow') return Math.round(Math.abs(Math.sin(this.walkPhase)) * 2);
    if (this.state === 'hop' || this.state === 'happy') return Math.round(Math.sin(Math.min(1, this.stateT / 0.35) * Math.PI) * 6);
    if (this.floats && this.state !== 'held' && this.state !== 'fall') return Math.round(Math.sin(this.t * 2) * 2);
    if (this.state === 'sleep') return 0;
    return Math.floor(this.t * 1.6) % 2; // 呼吸
  }

  hit(px, py) {
    if (this.leaving || this.alpha < 0.5) return false;
    const r = this.rect(), S = this.S, a = this.asset;
    if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) return false;
    let ax = Math.floor((px - r.x) / S), ay = Math.floor((py - r.y) / S);
    if (this.facing > 0) ax = a.w - 1 - ax;
    if (this.upsideDown) ay = a.h - 1 - ay;
    // 容許 1 美術像素的誤差，細長的寶可夢比較好點
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = ax + dx, y = ay + dy;
      if (x >= 0 && y >= 0 && x < a.w && y < a.h && a.mask[y * a.w + x]) return true;
    }
    return false;
  }

  showEmote(key, seconds = 1.6) {
    const img = typeof key === 'string' ? art.emotes[key] : key;
    if (img) this.emote = { img, until: this.t + seconds };
  }

  // ---------- 反應 ----------
  onStroke(result) {
    const S = this.S, h = this.head();
    if (this.state === 'sleep') { this.set('idle', 1); this.showEmote('!', 0.8); }
    if (result?.affectionGain > 0 && Math.random() < 0.45) this.stage.fx.hearts(h.x, h.y, S);
    if (result?.enjoymentFull && Math.random() < 0.3) this.showEmote('♪');
    if (this.state === 'idle' || this.state === 'walk') this.set('hop', 0.35);
  }

  startEat(puffKey) {
    this.set('eat', 1.4);
    this.eating = { puff: puffKey, bites: 0 };
  }

  refuse() {
    this.set('refuse', 0.9);
    this.showEmote('…', 1.2);
  }

  happy() { this.set('happy', 0.6); }

  pickUp(px, py) {
    const r = this.rect();
    this.grab = { dx: px - r.x, dy: py - r.y };
    this.set('held');
    this.showEmote(hearts(this.mon.affection) >= 3 ? '♪' : '!', 0.8);
    this.upsideDown = this.mon.species === 686; // 好啦魷被抓起來時會倒過來
  }

  release(vx, vy) {
    this.vx = Math.max(-2500, Math.min(2500, vx));
    this.vy = Math.max(-2500, Math.min(2500, vy));
    this.grab = null;
    this.upsideDown = false;
    this.set('fall');
  }

  // ---------- 每一幀 ----------
  update(dt) {
    const st = this.stage, S = this.S;
    this.t += dt;
    this.stateT += dt;
    if (this.emote && this.t > this.emote.until) this.emote = null;
    const p = st.pointer;
    const near = p.known && Math.abs(p.x - this.x) < 260 * (S / 2) && Math.abs(p.y - this.y) < 300 * (S / 2);

    switch (this.state) {
      case 'appear':
        if (this.stateT > 0.45) this.set('idle', 1.5);
        break;
      case 'idle':
        if (near && st.env.userActive) this.facing = p.x > this.x ? 1 : -1;
        if (this.stateT > this.dur) this.decide();
        break;
      case 'walk':
      case 'follow': {
        if (this.state === 'follow') {
          this.targetX = p.x;
          if (this.stateT > this.dur) { this.set('idle', 2); break; }
        }
        const dx = this.targetX - this.x;
        const speed = WALK_SPEED * S * (this.state === 'follow' ? 1.8 : 1);
        if (Math.abs(dx) < 4 * S) {
          if (this.state === 'walk') this.set('idle', 1.5 + Math.random() * 3);
          break;
        }
        this.facing = Math.sign(dx);
        const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
        this.x += step;
        this.walkPhase += Math.abs(step) / (S * 4);
        break;
      }
      case 'sleep':
        if (!st.env.sleepy) this.set('idle', 1);
        else if (Math.floor(this.t) % 3 === 0 && !this.emote) this.showEmote('Z', 1.2);
        break;
      case 'hop':
      case 'happy':
      case 'refuse':
        if (this.state === 'refuse') this.facing = Math.floor(this.stateT * 8) % 2 ? 1 : -1;
        if (this.stateT > this.dur) this.set('idle', 1 + Math.random() * 2);
        break;
      case 'eat':
        if (this.eating) {
          const bites = Math.min(3, Math.floor(this.stateT / 0.4));
          if (bites > this.eating.bites) {
            this.eating.bites = bites;
            const m = this.mouth();
            st.audio.sfx('eat');
            st.fx.crumbs(m.x, m.y, S, art.FLAVOR_COLORS[this.eating.puff.split('-')[0]].F);
          }
        }
        if (this.stateT > this.dur) { this.eating = null; this.set('happy', 0.6); }
        break;
      case 'held':
        if (this.grab && p.known) {
          const a = this.asset;
          this.x = p.x - this.grab.dx + (a.w * S) / 2;
          this.y = p.y - this.grab.dy + a.h * S;
        }
        break;
      case 'fall': {
        const rest = this.restY();
        if (this.floats) {
          // 會飄的寶可夢：慢慢回到原本的高度
          this.vx *= Math.pow(0.02, dt);
          this.vy = (rest - this.y) * 3;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          if (Math.abs(rest - this.y) < S && Math.abs(this.vx) < 20) this.set('idle', 1);
        } else {
          this.vy += GRAVITY * S * dt;
          this.x += this.vx * dt;
          this.y += this.vy * dt;
          if (this.y >= rest) {
            this.y = rest;
            if (this.vy > 700 * S / 2) {
              this.vy *= -0.35;
              this.vx *= 0.6;
              st.audio.sfx('land');
              if (this.vy < -500) this.showEmote('@', 1.6);
            } else {
              this.vy = 0;
              this.vx = 0;
              this.set('idle', this.emote ? 1.6 : 1);
            }
          }
        }
        break;
      }
      case 'evolving':
        break;
      default:
        this.set('idle', 1);
    }
    // 不要跑出螢幕
    const half = (this.asset.w * S) / 2;
    if (this.state !== 'held') {
      if (this.x < half) { this.x = half; this.vx = Math.abs(this.vx) * 0.5; }
      if (this.x > st.W - half) { this.x = st.W - half; this.vx = -Math.abs(this.vx) * 0.5; }
    }
    if (this.leaving) this.alpha = Math.max(0, this.alpha - dt * 3);
  }

  decide() {
    const st = this.stage;
    if (st.env.sleepy) { this.set('sleep'); return; }
    const h = hearts(this.mon.affection);
    const r = Math.random();
    if (this.mon.fullness < 30 && r < 0.2) { this.showEmote(art.puff('sweet-basic'), 2); this.set('idle', 2); return; }
    if (h >= 3 && st.pointer.known && st.env.userActive && r < 0.18) { this.set('follow', 3 + Math.random() * 4); return; }
    if (r < 0.55) {
      const S = this.S;
      const dist = (60 + Math.random() * 280) * S * (Math.random() < 0.5 ? -1 : 1);
      this.targetX = Math.max(40 * S, Math.min(st.W - 40 * S, this.x + dist));
      this.set('walk');
      return;
    }
    this.set('idle', 2 + Math.random() * 4);
  }

  draw(ctx) {
    const S = this.S, a = this.asset, r = this.rect();
    let alpha = this.alpha;
    if (this.state === 'appear') {
      // 從球裡出來：白光慢慢變成原本的樣子
      const k = Math.min(1, this.stateT / 0.45);
      const sc = Math.max(1, Math.round(S * (0.3 + 0.7 * k)));
      const w = a.w * sc, h = a.h * sc;
      blit(ctx, k < 0.7 ? a.white : a.canvas, this.x - w / 2, this.y - h, sc, { flipX: this.facing > 0, alpha });
      return;
    }
    // 腳下的影子（貼地的才畫）
    if (!this.floats || this.state === 'held') {
      ctx.fillStyle = 'rgba(20,10,30,0.18)';
      const sw = Math.round((a.w * S) / 2 / S) * S;
      ctx.fillRect(Math.round(this.x - sw / 2), Math.round(this.restY()) - S, sw, S);
    }
    const img = this.evolveView ?? (this.state === 'sleep' ? a.canvas : a.canvas);
    blit(ctx, img, r.x, r.y, S, { flipX: this.facing > 0, flipY: this.upsideDown, alpha });
    if (this.state === 'sleep') {
      // 睡覺時稍微暗一點
      blit(ctx, a.dark, r.x, r.y, S, { flipX: this.facing > 0, alpha: 0.18 });
    }
    if (this.eating && this.eating.bites < 3) {
      const m = this.mouth();
      const img2 = art.bittenPuff(this.eating.puff, this.eating.bites);
      blit(ctx, img2, m.x - (img2.width * S) / 2, m.y - (img2.height * S) / 2, S);
    }
    if (this.emote) {
      const e = this.emote.img, h = this.head();
      const bob = Math.floor(this.t * 3) % 2 ? 0 : S;
      blit(ctx, e, h.x - (e.width * S) / 2 + (this.facing > 0 ? 6 : -6) * S, h.y - (e.height + 4) * S - bob, S);
    }
  }
}
