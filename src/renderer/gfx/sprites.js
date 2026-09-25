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

  // 背景慢慢把整本圖鑑的圖抓下來，打開圖鑑時就不用等
  prefetchAll() {
    return this.dex.ids.reduce((p, id) => p.then(() => this.get(id)), Promise.resolve());
  }
}
