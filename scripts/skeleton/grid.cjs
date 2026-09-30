const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
// Playwright：跟 test/e2e/lib.cjs 一樣的找法（PLAYWRIGHT_PATH、全域安裝）
const { chromium } = (() => { for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } } throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH）'); })();
const OUTDIR = process.env.OUTDIR || require('os').tmpdir();
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const id of process.argv.slice(2)) {
    const b64 = fs.readFileSync(path.join(ROOT, '.cache/sprites') + '/' + id + '.png').toString('base64');
    const url = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height; const g0 = c0.getContext('2d'); g0.drawImage(img, 0, 0);
      const d = g0.getImageData(0, 0, c0.width, c0.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c0.height; y++) for (let x = 0; x < c0.width; x++) if (d[(y * c0.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const W = x1 - x0 + 1, H = y1 - y0 + 1, Z = 14, M = 30;
      const o = document.createElement('canvas'); o.width = W * Z + M; o.height = H * Z + M; const g = o.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.imageSmoothingEnabled = false;
      g.drawImage(c0, x0, y0, W, H, M, M, W * Z, H * Z);
      g.font = '11px monospace'; g.fillStyle = '#000';
      for (let x = 0; x <= W; x++) { g.strokeStyle = x % 5 ? 'rgba(0,0,0,.08)' : 'rgba(255,0,0,.45)'; g.beginPath(); g.moveTo(M + x * Z, M); g.lineTo(M + x * Z, o.height); g.stroke(); if (x % 5 === 0) g.fillText(x, M + x * Z + 1, 12); }
      for (let y = 0; y <= H; y++) { g.strokeStyle = y % 5 ? 'rgba(0,0,0,.08)' : 'rgba(255,0,0,.45)'; g.beginPath(); g.moveTo(M, M + y * Z); g.lineTo(o.width, M + y * Z); g.stroke(); if (y % 5 === 0) g.fillText(y, 2, M + y * Z + 11); }
      return [o.toDataURL(), W, H];
    }, b64);
    fs.writeFileSync(OUTDIR + '/grid-' + id + '.png', Buffer.from(url[0].split(',')[1], 'base64'));
    console.log(id, url[1], url[2]);
  }
  await b.close();
})();
