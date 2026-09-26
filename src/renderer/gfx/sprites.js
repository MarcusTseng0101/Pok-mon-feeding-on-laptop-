// 寶可夢圖片：向 main process 要 PNG（有快取），裁掉透明邊、建立命中遮罩與剪影。
import { makeCanvas, alphaMask, tint } from './pixel.js';
import { fallbackSprite } from './art.js';
import { speciesOfKey } from '../../core/forms.js';

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

  // ---------- 會動的圖 ----------
  // 同步取得：已經解好就回傳動畫（所有同一種的共用），還沒就回傳 null 並開始載入（先用不會動的圖）
  peekAnim(id, shiny = false) {
    const k = `anim:${this.key(id, shiny)}`;
    let entry = this.cache.get(k);
    if (!entry) {
      entry = { anim: null };
      this.cache.set(k, entry);
      if (this.api.getAnimSprite && typeof ImageDecoder !== 'undefined') {
        // 先等不會動的圖：動畫要縮放成一樣高，桌面上的大小才不會變
        entry.promise = this.get(id, shiny)
          .then(still => (still.fallback ? null : this.api.getAnimSprite(String(id), shiny).then(url => (url ? decodeAnim(url, still.h) : null))))
          .then(anim => (entry.anim = anim))
          .catch(() => null);
      }
    }
    return entry.anim;
  }

  // 背景慢慢把整本圖鑑的圖抓下來，打開圖鑑時就不用等
  prefetchAll() {
    return this.dex.ids.reduce((p, id) => p.then(() => this.get(id)), Promise.resolve());
  }
}

// ---------- 會動的圖：GIF → 一格一格的 canvas ----------
const MAX_FRAMES = 120;

function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 每一格用同一個裁切範圍（所有格的聯集），動的時候腳底才不會跳來跳去；
// 再縮放成跟不會動的圖一樣高（Showdown 的圖大小跟原作比例一樣，有的會比現在大很多）
export async function decodeAnim(url, targetH) {
  const dec = new ImageDecoder({ data: dataUrlBytes(url), type: 'image/gif' });
  await dec.tracks.ready;
  const n = Math.min(MAX_FRAMES, dec.tracks.selectedTrack?.frameCount ?? 0);
  if (n < 2) { dec.close(); return null; }
  const raw = [];
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const c = makeCanvas(image.displayWidth, image.displayHeight);
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const dur = Math.max(0.02, (image.duration ?? 50000) / 1e6); // 微秒 → 秒
    image.close();
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    raw.push({ c, dur });
  }
  dec.close();
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const k = targetH / ch;
  const scale = Math.abs(k - 1) < 0.08 ? 1 : k;
  const w = Math.max(1, Math.round(cw * scale)), h = Math.max(1, Math.round(ch * scale));
  const frames = raw.map(({ c, dur }) => {
    const out = makeCanvas(w, h);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = scale !== 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, x0, y0, cw, ch, 0, 0, w, h);
    return makeAsset(out);
  });
  const durs = raw.map(r => r.dur);
  return { frames, durs, total: durs.reduce((a, b) => a + b, 0), w, h };
}

// 一隻寶可夢自己的播放位置（同一種的兩隻不會同步）；看起來跟一般的 asset 一樣
export class AnimView {
  constructor(anim) {
    this.anim = anim;
    this.i = 0;
    this.w = anim.w;
    this.h = anim.h;
    this.fallback = false;
    this.animated = true;
  }
  // t：這隻自己的動畫時間（秒）
  at(t) {
    const { durs, total } = this.anim;
    let r = ((t % total) + total) % total, i = 0;
    while (i < durs.length - 1 && r >= durs[i]) { r -= durs[i]; i++; }
    this.i = i;
    return this;
  }
  get frame() { return this.anim.frames[this.i]; }
  get canvas() { return this.frame.canvas; }
  get mask() { return this.frame.mask; }
  get white() { return this.frame.white; }
  get dark() { return this.frame.dark; }
}

// 給有自己時間（t）的東西用：動畫載好了回傳它自己的 AnimView，不然回傳不會動的圖
export function liveAsset(owner, sprites, key, shiny, t) {
  const anim = sprites.peekAnim?.(key, shiny);
  if (!anim) return sprites.peek(key, shiny);
  if (owner.view?.anim !== anim) owner.view = new AnimView(anim);
  return owner.view.at(t);
}
