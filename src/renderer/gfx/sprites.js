// 寶可夢圖片：向 main process 要 PNG（有快取），裁掉透明邊、建立命中遮罩與剪影。
import { makeCanvas, alphaMask, tint } from './pixel.js';
import { buildRig } from './rig.js';
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
  peekAnim(id, shiny = false) {
    const still = this.peek(id, shiny);
    let anim = RIGS.get(still);
    if (!anim) {
      const rig = buildRig(still.canvas, { floats: this.dex.floats?.(speciesOfKey(id)) ?? false });
      const wrap = set => ({ ...set, frames: set.frames.map(c => makeAsset(c)) });
      anim = { sets: { idle: wrap(rig.sets.idle), walk: wrap(rig.sets.walk) }, w: rig.w, h: rig.h, info: rig.info };
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
  // t：這隻自己的動畫時間（秒）；set：'idle' 待機、'walk' 走路
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

// 給有自己時間（t）的東西用：回傳它自己的 AnimView
export function liveAsset(owner, sprites, key, shiny, t, set = 'idle') {
  const anim = sprites.peekAnim?.(key, shiny);
  if (!anim) return sprites.peek(key, shiny);
  if (owner.view?.anim !== anim) owner.view = new AnimView(anim);
  return owner.view.at(t, set);
}
