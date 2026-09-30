const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
// Playwright：跟 test/e2e/lib.cjs 一樣的找法（PLAYWRIGHT_PATH、全域安裝）
const { chromium } = (() => { for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } } throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH）'); })();
const OUTDIR = process.env.OUTDIR || require('os').tmpdir();
const http = require('http'), fs = require('fs');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); try { const b = fs.readFileSync(f); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'image/png' }); r.end(b); } catch { r.writeHead(404); r.end(); } }).listen(9483);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:9483/package.json');
  const url = await p.evaluate(async ({ id, params, Z }) => {
    const { buildSkeleton } = await import('/src/renderer/gfx/skeleton.js?' + Date.now());
    const { SKELETONS } = await import('/src/renderer/gfx/skeletons.js?' + Date.now());
    const img = new Image(); img.src = '/.cache/sprites/' + id + '.png'; await img.decode();
    const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height; const g0 = c0.getContext('2d'); g0.drawImage(img, 0, 0);
    const d = g0.getImageData(0, 0, c0.width, c0.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c0.height; y++) for (let x = 0; x < c0.width; x++) if (d[(y * c0.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1; c.getContext('2d').drawImage(c0, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    const sk = buildSkeleton(c, SKELETONS[id]);
    const fr = params.map(q => sk.pose(q));
    const w = fr[0].width, h = fr[0].height;
    const out = document.createElement('canvas'); out.width = w * Z * fr.length; out.height = h * Z; const g = out.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#dfe7ea'; g.fillRect(0, 0, out.width, out.height);
    fr.forEach((f, i) => { g.drawImage(f, i * w * Z, 0, w * Z, h * Z); g.strokeStyle = '#999'; g.strokeRect(i * w * Z, 0, w * Z, h * Z); });
    return out.toDataURL();
  }, { id: process.env.ID, params: JSON.parse(process.env.P), Z: +(process.env.Z || 8) });
  fs.writeFileSync((process.env.OUT || path.join(OUTDIR, 'out')), Buffer.from(url.split(',')[1], 'base64'));
  await b.close(); srv.close();
})();
