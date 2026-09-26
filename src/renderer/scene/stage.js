// 舞台：全螢幕透明 canvas。負責每一幀的更新與繪製、游標互動，以及「什麼時候要攔截滑鼠」。
//
// 滑鼠穿透的規則：只有游標停在寶可夢／氣息點／道具的不透明像素上，或停在介面元素上，
// 或正在拖曳、拿著泡芙、瞄準時，視窗才接收滑鼠；其餘時間點擊都會落到下面的視窗。
import { Fx } from './fx.js';
import { Pet } from './pet.js';
import { resolveCollisions } from './physics.js';
import { blit } from '../gfx/pixel.js';
import * as art from '../gfx/art.js';

const STROKE_DIST = 16; // 美術像素：來回滑動多少距離算一次撫摸
const DRAG_START = 6; // CSS 像素

export class Stage {
  constructor({ canvas, api, dex, sprites, audio, game }) {
    Object.assign(this, { canvas, api, dex, sprites, audio, game });
    this.ctx = canvas.getContext('2d');
    this.fx = new Fx();
    this.pets = new Map();
    this.spot = null;
    this.wild = null;
    this.balls = [];
    this.props = [];
    this.decals = []; // 地上的裝飾（花、鑽石、根…），畫在夥伴後面，不能點
    this.pointer = { x: 0, y: 0, known: false };
    this.mode = null; // { type: 'feed', puff, target } | { type: 'aim', ball }
    this.env = { sleepy: false, userActive: true };
    this.handlers = {};
    this.uiHit = () => false;
    this.interactive = false;
    this.drag = null;
    this.stroke = { target: null, acc: 0, dir: 0, turns: 0, last: 0 };
    this.feedHover = { target: null, t: 0 };
    this.hoverPet = null;
    this.hoverTarget = null;
    this.busyUntil = 0;
    this.lastDraw = 0;
    this.hidden = false;
    this.trail = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  on(name, fn) { this.handlers[name] = fn; }
  fire(name, ...args) { return this.handlers[name]?.(...args); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.W = Math.round(window.innerWidth * dpr);
    this.H = Math.round(window.innerHeight * dpr);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.S = Math.max(1, Math.round(2 * dpr)); // 「2x 像素」：每個美術像素 = 2 CSS 像素（取整數裝置像素）
    this.floorY = this.H;
    this.ctx.imageSmoothingEnabled = false;
    for (const p of this.pets.values()) p.clamp();
  }

  toDevice(cx, cy) { return { x: cx * this.dpr, y: cy * this.dpr }; }
  toCss(x, y) { return { x: x / this.dpr, y: y / this.dpr }; }
  markBusy(seconds = 1) { this.busyUntil = Math.max(this.busyUntil, performance.now() + seconds * 1000); }

  // 在地上放一個裝飾（x, y 是底部中央）
  addDecal(img, x, y, life = 20) {
    this.decals.push({ img, x, y, t: 0, life });
    if (this.decals.length > 40) this.decals.shift();
  }

  // ---------- 寶可夢管理 ----------
  addPet(mon, opts) {
    if (this.pets.has(mon.uid)) return this.pets.get(mon.uid);
    const pet = new Pet(this, mon, opts);
    this.pets.set(mon.uid, pet);
    return pet;
  }
  removePet(uid) {
    const pet = this.pets.get(uid);
    if (!pet) return;
    pet.leaving = true;
    this.fx.ring(pet.x, pet.y - (pet.asset.h * this.S) / 2, this.S, '#ffffff', 24);
    setTimeout(() => this.pets.delete(uid), 400);
  }

  // ---------- 命中判定 ----------
  petAt(x, y) {
    const list = [...this.pets.values()].filter(p => !p.leaving).sort((a, b) => this.drawOrder(b) - this.drawOrder(a));
    return list.find(p => p.hit(x, y)) ?? null;
  }
  drawOrder(p) { return (p.floats ? 1e6 : 0) + p.gy; } // 桌面上越下面（越靠近你）的畫在越前面

  // 游標最近的移動速度（裝置像素／秒）
  pointerSpeed() {
    const tr = this.trail;
    if (tr.length < 2) return 0;
    const a = tr[0], b = tr[tr.length - 1];
    if (performance.now() - b.t > 150) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / (Math.max(16, b.t - a.t) / 1000);
  }

  // 把夥伴的位置記進存檔（用螢幕比例，換解析度也放得回去）
  storePositions() {
    for (const p of this.pets.values()) {
      if (p.leaving || p.state === 'held') continue;
      p.mon.pos = { x: +(p.x / this.W).toFixed(4), y: +(p.gy / this.H).toFixed(4) };
    }
  }

  targetAt(x, y) {
    if (this.hidden) return null;
    // 氣息點會消失，所以優先於夥伴（夥伴站在草叢前也點得到草叢）
    for (const b of this.props) if (b.hit(x, y)) return b;
    if (this.wild?.hit(x, y)) return this.wild;
    if (this.spot?.hit(x, y)) return this.spot;
    return this.petAt(x, y);
  }

  wantsMouse() {
    if (this.mode || this.drag?.held) return true;
    const css = this.toCss(this.pointer.x, this.pointer.y);
    if (this.uiHit(css.x, css.y)) return true;
    return this.pointer.known && Boolean(this.targetAt(this.pointer.x, this.pointer.y));
  }

  refreshInteractive() {
    const want = this.wantsMouse();
    if (want !== this.interactive) {
      this.interactive = want;
      this.api.setInteractive(want);
    }
    const t = this.pointer.known ? this.targetAt(this.pointer.x, this.pointer.y) : null;
    this.hoverTarget = t;
    this.hoverPet = t instanceof Pet ? t : null;
    const cursor = this.mode?.type === 'feed' ? 'none'
      : this.mode?.type === 'aim' ? 'crosshair'
      : this.drag?.held ? 'grabbing'
      : t instanceof Pet ? 'grab'
      : t ? 'pointer' : 'default';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ---------- 輸入 ----------
  bindInput() {
    // main process 每 33ms 送一次游標位置（就算游標在別的視窗上也收得到）
    this.api.on('cursor', ({ x, y }) => this.movePointer(x, y, false));
    window.addEventListener('pointermove', e => this.movePointer(e.clientX, e.clientY, e.buttons & 1));
    this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
    window.addEventListener('pointerup', e => this.pointerUp(e));
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (this.mode) this.fire('cancelMode'); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.fire('escape'); });
  }

  movePointer(cx, cy) {
    const inside = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
    const { x, y } = this.toDevice(cx, cy);
    const prev = { x: this.pointer.x, y: this.pointer.y };
    if (x === prev.x && y === prev.y && inside === this.pointer.known) return;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.known = inside;
    const now = performance.now();
    this.trail.push({ x, y, t: now });
    while (this.trail.length > 6 || (this.trail.length > 1 && now - this.trail[0].t > 120)) this.trail.shift();

    if (this.drag && !this.drag.held) {
      const moved = Math.hypot(x - this.drag.sx, y - this.drag.sy) / this.dpr;
      if (moved > DRAG_START && this.drag.pet) {
        this.drag.held = true;
        this.drag.pet.pickUp(this.drag.sx, this.drag.sy);
        this.audio.sfx('grab');
        this.fire('petPicked', this.drag.pet);
      }
    }
    if (!this.drag?.held && !this.mode && inside) this.detectStroke(prev, x, y, now);
    this.refreshInteractive();
  }

  detectStroke(prev, x, y, now) {
    const s = this.stroke;
    // 開始摸之後，只要游標還在牠的外框內就算數（身體中間的透明縫隙不會打斷）
    const inRect = p => { const r = p.rect(); return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; };
    const pet = s.target && !s.target.leaving && inRect(s.target) ? s.target : this.petAt(x, y);
    if (!pet || pet !== s.target) {
      Object.assign(s, { target: pet, acc: 0, dir: 0, turns: 0 });
      return;
    }
    const dx = x - prev.x;
    s.acc += Math.hypot(dx, y - prev.y);
    const dir = Math.abs(dx) > this.dpr ? Math.sign(dx) : 0;
    if (dir && dir !== s.dir) { if (s.dir) s.turns++; s.dir = dir; }
    if (s.acc > STROKE_DIST * this.S && s.turns >= 1 && now - s.last > 110) {
      s.acc = 0;
      s.turns = 0;
      s.last = now;
      this.fire('stroke', pet);
    }
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    this.audio.resume();
    const { x, y } = this.toDevice(e.clientX, e.clientY);
    this.pointer = { x, y, known: true };
    const target = this.targetAt(x, y);
    if (this.mode) {
      this.fire('modeClick', target, { x, y });
      return;
    }
    this.drag = { sx: x, sy: y, target, pet: target instanceof Pet && target.state !== 'evolving' ? target : null, held: false };
    this.refreshInteractive();
  }

  pointerUp(e) {
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.held) {
      const tr = this.trail;
      let vx = 0, vy = 0;
      if (tr.length >= 2) {
        const a = tr[0], b = tr[tr.length - 1];
        const dt = Math.max(16, b.t - a.t) / 1000;
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
      const wasUpsideDown = d.pet.upsideDown;
      d.pet.release(vx, vy);
      this.markBusy(2);
      this.fire('petReleased', d.pet, { wasUpsideDown });
    } else if (d.target) {
      this.fire('click', d.target);
    }
    this.refreshInteractive();
  }

  // ---------- 每一幀 ----------
  frame(now) {
    const dt = Math.min(0.1, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    // 沒什麼在動的時候 30fps 就夠了，省電
    const busy = now < this.busyUntil || this.drag?.held || this.mode || this.balls.length || this.wild || this.minigame;
    this.accum = (this.accum ?? 0) + dt;
    if (!busy && now - this.lastDraw < 30) return;
    const step = this.accum;
    this.accum = 0;
    this.lastDraw = now;
    this.update(step);
    this.draw();
  }

  update(dt) {
    for (const p of this.pets.values()) p.update(dt);
    resolveCollisions(this, dt); // 夥伴之間不會互相穿過去
    this.spot?.update(dt);
    if (this.spot?.gone) { this.spot = null; this.fire('spotGone'); }
    this.wild?.update(dt);
    if (this.wild?.gone) this.wild = null;
    for (const b of this.balls) b.update(dt);
    this.balls = this.balls.filter(b => !b.gone);
    for (const p of this.props) p.update(dt);
    this.props = this.props.filter(p => !p.gone);
    for (const d of this.decals) d.t += dt;
    this.decals = this.decals.filter(d => d.t < d.life);
    this.fx.update(dt);
    this.updateFeeding(dt);
    this.minigame?.update(dt); // 小遊戲（ui/minigames/host.js）
    this.refreshInteractive();
  }

  // 拿著泡芙靠近嘴巴 0.25 秒就會開始吃
  updateFeeding(dt) {
    const m = this.mode;
    if (m?.type !== 'feed' || !this.pointer.known) return;
    const { x, y } = this.pointer;
    const target = m.target === 'wild' ? (this.wild?.hit(x, y) ? this.wild : null) : this.petAt(x, y);
    if (target && target === this.feedHover.target) {
      this.feedHover.t += dt;
      if (this.feedHover.t > 0.25) {
        this.feedHover = { target: null, t: -0.6 };
        this.fire('feed', target, m.puff);
      }
    } else {
      this.feedHover = { target, t: 0 };
    }
  }

  draw() {
    const ctx = this.ctx, S = this.S;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.hidden) { this.fx.draw(ctx, S); return; }
    for (const d of this.decals) {
      const k = d.t / d.life, alpha = Math.min(1, d.t * 3, (1 - k) * 4);
      blit(ctx, d.img, d.x - (d.img.width * S) / 2, d.y - d.img.height * S, S, { alpha });
    }
    for (const p of this.props) p.draw(ctx);
    this.minigame?.active?.ctl?.drawUnder?.(ctx); // 小遊戲畫在夥伴後面的東西（樹果樹…）
    const pets = [...this.pets.values()].sort((a, b) => this.drawOrder(a) - this.drawOrder(b));
    // 地上的夥伴畫在氣息點後面（看起來像站在草叢後），飄浮的畫在前面
    for (const p of pets) if (p.state !== 'held' && !p.floats) p.draw(ctx);
    this.spot?.draw(ctx);
    for (const p of pets) if (p.state !== 'held' && p.floats) p.draw(ctx);
    this.wild?.draw(ctx);
    if (this.mode?.type === 'aim' && this.wild?.visible && this.wild.state === 'idle') this.wild.drawRing(ctx, this.mode.ringColor ?? '#7ee06a');
    for (const b of this.balls) b.draw(ctx);
    for (const p of pets) if (p.state === 'held') p.draw(ctx);
    this.minigame?.draw(ctx);
    this.fx.draw(ctx, S);
    if (this.mode?.type === 'feed' && this.pointer.known) {
      const img = art.puff(this.mode.puff);
      blit(ctx, img, this.pointer.x - (img.width * S) / 2, this.pointer.y - (img.height * S) / 2, S);
    }
    if (this.mode?.type === 'aim' && this.pointer.known) {
      const img = art.balls[this.mode.ball];
      blit(ctx, img, this.pointer.x + 6 * S, this.pointer.y + 6 * S, S);
    }
  }
}
