// 寶可夢圖片：向 main process 要 PNG（有快取），裁掉透明邊、建立命中遮罩與剪影。
import { makeCanvas, alphaMask, tint } from './pixel.js';
import { buildRig, quantize, ANG_STEP, LIMITS, PART_MAX } from './rig.js';
import { buildSkeleton, GAIT_STEPS } from './skeleton.js';
import { SKELETONS } from './skeletons.js';
import { fallbackSprite } from './art.js';
import { speciesOfKey } from '../../core/forms.js';

const RIGS = new WeakMap(); // 不會動的圖 → 做好的動畫

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function crop(img) {
  const c = makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (data[(y * c.width + x) * 4 + 3] > 10) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return c;
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// 跟 makeAsset 一樣，但點擊用的遮罩第一次用到才算（木偶的姿勢圖很多張，大部分不會被點）
function lazyAsset(canvas) {
  return {
    canvas, w: canvas.width, h: canvas.height, fallback: false, _mask: null, _white: null, _dark: null,
    get mask() { return (this._mask ??= alphaMask(this.canvas)); },
    get white() { return (this._white ??= tint(this.canvas, '#ffffff')); },
    get dark() { return (this._dark ??= tint(this.canvas, '#28203a')); },
  };
}

export function makeAsset(canvas, fallback = false) {
  return {
    canvas,
    w: canvas.width,
    h: canvas.height,
    mask: alphaMask(canvas),
    fallback,
    _white: null,
    _dark: null,
    get white() { return (this._white ??= tint(this.canvas, '#ffffff')); },
    get dark() { return (this._dark ??= tint(this.canvas, '#28203a')); },
  };
}

export class SpriteBank {
  constructor(api, dex) {
    this.api = api;
    this.dex = dex;
    this.cache = new Map();
  }

  // id：圖鑑號，或 core/forms.js 的 spriteKey（'669-blue'、'10075'）
  key(id, shiny) { return `${id}:${shiny ? 1 : 0}`; }

  // 同步取得（還沒載好就先回傳備用圖，同時開始載入）
  peek(id, shiny = false) {
    const k = this.key(id, shiny);
    const hit = this.cache.get(k);
    if (hit?.asset) return hit.asset;
    this.get(id, shiny);
    return this.fallback(id);
  }

  get(id, shiny = false) {
    const k = this.key(id, shiny);
    if (!this.cache.has(k)) {
      const entry = { asset: null, promise: null };
      entry.promise = this.api.getSprite(String(id), shiny)
        .then(url => (url ? loadImage(url) : null))
        .then(img => (entry.asset = img ? makeAsset(crop(img)) : this.fallback(id)))
        .catch(() => (entry.asset = this.fallback(id)));
      this.cache.set(k, entry);
    }
    return this.cache.get(k).promise;
  }

  fallback(id) {
    const species = speciesOfKey(id);
    const k = `fb:${species}`;
    if (!this.cache.has(k)) this.cache.set(k, { asset: makeAsset(fallbackSprite(this.dex.get(species)?.types ?? ['normal'], species), true) });
    return this.cache.get(k).asset;
  }

  // ---------- 會動的圖（原本的像素圖切塊移動，見 gfx/rig.js）----------
  // 同步取得：用現在拿得到的圖（還沒下載好就是替代圖）做成動畫；同一張圖只做一次，所有同一種的共用
  // 有手標骨架的（gfx/skeletons.js，照圖片編號，不同形態的圖不一樣所以不照物種）用骨架木偶（gfx/skeleton.js：手腳有關節、腳踩地），
  // 其他、替代圖、圖大小跟標的時候不一樣的，照舊用自動木偶
  peekAnim(id, shiny = false) {
    const still = this.peek(id, shiny);
    let anim = RIGS.get(still);
    if (!anim) {
      const spec = still.fallback ? null : SKELETONS[Number.parseInt(id, 10)];
      const fits = spec && (!spec.size || (spec.size[0] === still.canvas.width && spec.size[1] === still.canvas.height));
      const rig = fits ? buildSkeleton(still.canvas, spec) : buildRig(still.canvas, { floats: this.dex.floats?.(speciesOfKey(id)) ?? false });
      // 每一組動作第一次用到才做（睡覺、出招那些很多隻一輩子都用不到幾次）
      // 每一組的畫面要看的時候才做（木偶畫法只拿 sets 當「現在是哪一組」的標籤，用不到固定的畫面）
      const sets = {};
      for (const name of Object.keys(rig.sets)) {
        const s = rig.sets[name];
        let frames = null;
        sets[name] = { name, durs: s.durs, total: s.total, get frames() { return (frames ??= s.frames.map(c => makeAsset(c))); } };
      }
      // 參數姿勢（規格 PR-N3）：量化後的參數 → 做好的圖（rig.js 快取）→ 包成 asset（遮罩、剪影第一次用到才算）
      const assets = new WeakMap();
      const wrap = c => { let x = assets.get(c); if (!x) { x = lazyAsset(c); assets.set(c, x); } return x; };
      const pose = (q, opts) => { const c = rig.pose(q, opts); return c && wrap(c); };
      anim = { sets, w: rig.w, h: rig.h, info: rig.info, pose, target: rig.target, stats: rig.stats, quantize: rig.quantize ?? quantize };
      RIGS.set(still, anim);
    }
    return anim;
  }

  // 背景慢慢把整本圖鑑的圖抓下來，打開圖鑑時就不用等
  prefetchAll() {
    return this.dex.ids.reduce((p, id) => p.then(() => this.get(id)), Promise.resolve());
  }
}

// 一隻寶可夢自己的播放位置（同一種的兩隻不會同步）；看起來跟一般的 asset 一樣
export class AnimView {
  constructor(anim) {
    this.anim = anim;
    this.i = 0;
    this.set = anim.sets.idle;
    this.w = anim.w;
    this.h = anim.h;
    this.fallback = false;
    this.animated = true;
  }
  // t：這隻自己的動畫時間（秒）；set：'idle' 待機、'walk' 走路…（全部見 gfx/rig.js 的 SETS）
  at(t, set = 'idle') {
    const s = (this.set = this.anim.sets[set] ?? this.anim.sets.idle);
    const { durs, total } = s;
    let r = ((t % total) + total) % total, i = 0;
    while (i < durs.length - 1 && r >= durs[i]) { r -= durs[i]; i++; }
    this.i = i;
    return this;
  }
  get frame() { return this.set.frames[this.i]; }
  get canvas() { return this.frame.canvas; }
  get mask() { return this.frame.mask; }
  get white() { return this.frame.white; }
  get dark() { return this.frame.dark; }
}

// ---------- 像素木偶的參數姿勢（規格 PR-N3、§4.3）----------
// 手上的參數是連續的，每一個用臨界阻尼彈簧追目標（不同參數不同快慢），畫之前才量化（gfx/rig.js 的 quantize）。
// 所以換動作時姿勢是慢慢過去的，不會「喀」一下跳格（規格 F8）。
// 彈簧大約 2/ω 秒追到：腳 0.05 秒（要跟著步伐）、身體 0.09 秒、手 0.11、耳朵 0.14、尾巴 0.2（部位慢半拍＝跟隨，規格 0.08–0.2 秒）
const OMEGA = { lean: 22, crouch: 22, headPitch: 20, breath: 16, lLx: 40, lLy: 40, lRx: 40, lRy: 40, arm: 18, armSw: 18, ear: 14, earSw: 14, tail: 10, tailSw: 10 }; // 猜的，可調整
const KEYS = Object.keys(OMEGA);
const GAIT_OMEGA = 12; // 骨架木偶的「走路程度」追目標多快（約 0.17 秒：開始走、停下來時腳慢慢跨開、收回） // 猜的，可調整
const PART_SPEED = 8; // 部位最快一秒轉幾弧度（規格 F9：不要一直甩） // 猜的，可調整
const FOLLOW = 0.015; // 身體前後晃的速度（格／秒）帶動尾巴、耳朵往反方向擺多少（弧度） // 猜的，可調整
const REST_SWING = 0.3; // 休息時帶動的擺幅打幾折（規格 F9） // 猜的，可調整
const BUILD_PER_SEC = 30; // 同一隻一秒最多新做幾張圖，超過就先用上一張（規格 F13） // 猜的，可調整
const PARTS = new Set(['arm', 'armSw', 'ear', 'earSw', 'tail', 'tailSw']);
const HYST = 0.2; // 量化的遲滯（級） // 猜的，可調整
// 每個參數的級數範圍（跟 rig.js 的 quantize 一樣）
const ANG_LV = Math.round(PART_MAX / ANG_STEP);
const LEVEL_RANGE = {
  lean: [-LIMITS.lean, LIMITS.lean], crouch: [-LIMITS.crouchUp, LIMITS.crouchDown], headPitch: [-LIMITS.pitch, LIMITS.pitch], breath: [0, 1],
  lLx: [-3, 3], lLy: [-2, 2], lRx: [-3, 3], lRy: [-2, 2],
  arm: [-ANG_LV, ANG_LV], armSw: [-ANG_LV, ANG_LV], ear: [-ANG_LV, ANG_LV], earSw: [-ANG_LV, ANG_LV], tail: [-ANG_LV, ANG_LV], tailSw: [-ANG_LV, ANG_LV],
};
const flat = t => ({ ...t, lLx: t.legL?.[0] ?? 0, lLy: t.legL?.[1] ?? 0, lRx: t.legR?.[0] ?? 0, lRy: t.legR?.[1] ?? 0 });

export class PuppetView extends AnimView {
  constructor(anim) {
    super(anim);
    this.x = null; // 現在的參數（連續）
    this.v = {}; // 每個參數的速度
    this.cur = null; // 現在畫的那一張
    this.budget = BUILD_PER_SEC;
    this.puppet = true;
  }
  // 每一幀：set＝哪一組動作、ph＝這一組的步相（0–1）、extra＝整張圖的姿勢翻成的 lean／crouch（scene/pet.js 的 toPuppet）、rest＝在休息
  // over＝直接指定的參數（習性的身體姿勢，habits.js 的 puppet）：蓋過這一組動作的目標，其他照這一組
  drive(dt, setName, ph, extra = {}, rest = false, over = null) {
    const name = this.anim.sets[setName] ? setName : 'idle';
    this.set = this.anim.sets[name];
    const tg = flat(over ? { ...this.anim.target(name, ph), ...over } : this.anim.target(name, ph));
    tg.lean = (tg.lean ?? 0) + (extra.lean ?? 0);
    tg.crouch = (tg.crouch ?? 0) + (extra.crouch ?? 0);
    const x = this.x, v = this.v;
    if (!x) { this.x = Object.fromEntries(KEYS.map(k => [k, tg[k] ?? 0])); for (const k of KEYS) v[k] = 0; }
    else if (dt > 0) {
      // 跟隨：身體往前晃，尾巴、耳朵往後甩一下（休息時小一點）
      const follow = -FOLLOW * (v.lean ?? 0) * (rest ? REST_SWING : 1);
      for (const k of KEYS) {
        let goal = tg[k] ?? 0;
        if (k === 'tailSw' || k === 'earSw') goal += follow;
        // 臨界阻尼彈簧的精確解（dt 大一點也不會爆）
        const w = OMEGA[k], e = x[k] - goal, d = Math.exp(-w * dt), m = v[k] + w * e;
        let nx = goal + (e + m * dt) * d, nv = (v[k] - w * m * dt) * d;
        if (PARTS.has(k)) { const lim = PART_SPEED * dt; if (Math.abs(nx - x[k]) > lim) { nx = x[k] + Math.sign(nx - x[k]) * lim; nv = Math.sign(nv) * Math.min(Math.abs(nv), PART_SPEED); } }
        x[k] = nx; v[k] = nv;
      }
    }
    this.budget = Math.min(BUILD_PER_SEC, this.budget + dt * BUILD_PER_SEC);
    // 量化加遲滯：過了分界再多 HYST 級才換，彈簧在分界附近抖的時候不會一直換圖（少做很多張，規格 F13）。
    // 每一幀每個參數最多換 1 級（1 格、1 個角度級）：畫出來的姿勢永遠不會跳格（規格 F8、M8）
    const was = this.level, lv = {}, p = {};
    for (const k of KEYS) {
      const step = PARTS.has(k) ? ANG_STEP : 1, cur = this.x[k] / step, w = was?.[k];
      lv[k] = w == null ? Math.round(cur) : Math.abs(cur - w) > 0.5 + HYST ? w + Math.max(-1, Math.min(1, Math.round(cur) - w)) : w;
      const [lo, hi] = LEVEL_RANGE[k]; lv[k] = Math.max(lo, Math.min(hi, lv[k])); // 跟 quantize 一樣的範圍：不然算頭的位置時會跟畫出來的對不上（以前偶爾頭一次動 2 格）
    }
    // 頭的位置＝身體下沉＋低頭−吸氣：三個一起換一級，頭會一次動 3 格。頭一幀也最多動 1 格（先讓身體動，低頭、呼吸晚一幀）
    if (was) {
      const head = l => l.crouch + l.headPitch - l.breath;
      if (Math.abs(head(lv) - head(was)) > 1) lv.headPitch = was.headPitch;
      if (Math.abs(head(lv) - head(was)) > 1) lv.breath = was.breath;
    }
    for (const k of KEYS) p[k] = lv[k] * (PARTS.has(k) ? ANG_STEP : 1);
    // 骨架木偶的步相 gait（0–1 會繞回去）不能用彈簧追（彈簧會往回掃一整圈）：直接照這一組給的；這一組沒給（待機、吃…）就停在原本的步相，
    // 靠 gaitAmt（走路的程度）用彈簧慢慢收到 0，腳一步一步收回原位，不會一下跳回去
    // 一幀最多往前（或往後）走 1 格步相（規格 F8、M8：姿勢不跳格）。走最快時一秒 64 格比 60 幀多一點，那時腳會滑一點點；
    // 從別的動作換回走路時，步相也是一格一格追上去
    // （還沒走過路的從 0 開始：畫出來的一直是步相 0，第一次走也要一格一格追）
    if (tg.gait != null) { const g = this.gait ?? 0, d = ((tg.gait - g + 1.5) % 1) - 0.5, lim = 1 / GAIT_STEPS; this.gait = (g + Math.max(-lim, Math.min(lim, d)) + 1) % 1; }
    const ga = tg.gaitAmt ?? 0;
    if (this.gaitAmt == null || !(dt > 0)) { this.gaitAmt ??= ga; this.gaitV = 0; }
    else { const w = GAIT_OMEGA, e = this.gaitAmt - ga, d = Math.exp(-w * dt), m = this.gaitV + w * e; this.gaitAmt = ga + (e + m * dt) * d; this.gaitV = (this.gaitV - w * m * dt) * d; }
    const before = this.anim.stats.built;
    const q = (this.anim.quantize ?? quantize)({ ...p, legL: [p.lLx, p.lLy], legR: [p.lRx, p.lRy], gait: this.gait ?? 0, gaitAmt: this.gaitAmt });
    const f = this.anim.pose(q, { build: this.budget >= 1 || !this.cur });
    if (this.anim.stats.built > before) this.budget -= 1;
    // 這一幀做不出新圖（超過預算）：還是畫上一張，級數也留在上一張（下一次才不會一次跳兩級）
    if (f) { this.cur = f; this.key = q.key; this.level = lv; } // key：畫出來那一張的量化參數（測試用）
    return this;
  }
  get frame() { return this.cur ?? super.frame; }
}

// 夥伴用的：回傳它自己的 PuppetView（姿勢由 scene/pet.js 每一幀 drive）
export function puppetAsset(owner, sprites, key, shiny) {
  const anim = sprites.peekAnim?.(key, shiny);
  if (!anim) return sprites.peek(key, shiny);
  if (owner.view?.anim !== anim) owner.view = new PuppetView(anim);
  return owner.view;
}

// 給有自己時間（t）的東西用：回傳它自己的 AnimView
export function liveAsset(owner, sprites, key, shiny, t, set = 'idle') {
  const anim = sprites.peekAnim?.(key, shiny);
  if (!anim) return sprites.peek(key, shiny);
  if (owner.view?.anim !== anim) owner.view = new AnimView(anim);
  return owner.view.at(t, set);
}
