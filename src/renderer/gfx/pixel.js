// 像素畫工具：字串點陣 → canvas；所有自製美術都以「1 格 = 1 美術像素」產生，畫到舞台時再乘上整數倍率。

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function hex(color) {
  const n = parseInt(color.slice(1), 16);
  return color.length === 7 ? [n >> 16, (n >> 8) & 255, n & 255, 255] : [n >> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255];
}

// rows: 字串陣列；palette: { 字元: '#rrggbb' }；'.' 或未定義的字元是透明
export function fromMap(rows, palette) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = palette[rows[y][x]];
      if (!col) continue;
      const [r, g, b, a] = hex(col);
      const i = (y * w + x) * 4;
      img.data.set([r, g, b, a], i);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 逐點畫：fn(set) 內呼叫 set(x, y, '#color')
export function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  fn((x, y, color) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h || !color) return;
    img.data.set(hex(color), (y * w + x) * 4);
  });
  ctx.putImageData(img, 0, 0);
  return c;
}

// 把圖染成單一顏色（保留透明度），用在剪影、白光
export function tint(src, color) {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// 加上一圈 1px 外框（讓自製的小物件在任何桌布上都看得清楚）
export function outline(src, color = '#2a2030') {
  const c = makeCanvas(src.width + 2, src.height + 2);
  const ctx = c.getContext('2d');
  const sil = tint(src, color);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) ctx.drawImage(sil, dx, dy);
  ctx.drawImage(src, 1, 1);
  return c;
}

// 由不透明像素建立命中遮罩，用來做「只有點到寶可夢本體才算」的點擊判定
export function alphaMask(src) {
  const { width: w, height: h } = src;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  return mask;
}

// 以整數倍率畫出（左上角對齊裝置像素，保持像素銳利）
export function blit(ctx, img, x, y, scale, { flipX = false, flipY = false, alpha = 1 } = {}) {
  const w = img.width * scale, h = img.height * scale;
  x = Math.round(x); y = Math.round(y);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flipX || flipY) {
    ctx.translate(x + (flipX ? w : 0), y + (flipY ? h : 0));
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(img, 0, 0, w, h);
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
  ctx.restore();
}
