const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
// Playwright：跟 test/e2e/lib.cjs 一樣的找法（PLAYWRIGHT_PATH、全域安裝）
const { chromium } = (() => { for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } } throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH）'); })();
const OUTDIR = process.env.OUTDIR || require('os').tmpdir();
// 骨架總表：每一隻一列＝[原圖＋分段上色＋骨頭線] + 走路 16 格中的 8 格
const http = require('http'), fs = require('fs');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); try { const b = fs.readFileSync(f); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html' }); r.end(b); } catch { r.writeHead(404); r.end(); } }).listen(9482);
(async () => {
  const ids = (process.env.IDS || '658,656,652,667').split(',');
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => console.log('LOG', m.text()));
  await p.goto('http://localhost:9482/package.json');
  const url = await p.evaluate(async ({ ids, set, n, Z }) => {
    const { buildSkeleton } = await import('/src/renderer/gfx/skeleton.js?' + Date.now());
    const { SKELETONS } = await import('/src/renderer/gfx/skeletons.js?' + Date.now());
    const crop = async id => { const img = new Image(); img.src = '/.cache/sprites/' + id + '.png'; await img.decode();
      const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height; const g0 = c0.getContext('2d'); g0.drawImage(img, 0, 0);
      const d = g0.getImageData(0, 0, c0.width, c0.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c0.height; y++) for (let x = 0; x < c0.width; x++) if (d[(y * c0.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1; c.getContext('2d').drawImage(c0, x0, y0, c.width, c.height, 0, 0, c.width, c.height); return c; };
    const HUE = [0, 35, 60, 120, 180, 220, 270, 310, 20, 90, 150, 200, 240, 290];
    const rows = [];
    for (const id of ids) {
      const c = await crop(id), spec = SKELETONS[id], sk = buildSkeleton(c, spec);
      const W = c.width, H = c.height;
      // 分段上色
      const ov = document.createElement('canvas'); ov.width = W * Z; ov.height = H * Z; const g = ov.getContext('2d'); g.imageSmoothingEnabled = false;
      g.globalAlpha = 0.45; g.drawImage(c, 0, 0, W * Z, H * Z); g.globalAlpha = 1;
      for (let i = 0; i < W * H; i++) { const o = sk.owner[i]; if (o < -1) continue; const x = i % W, y = (i / W) | 0;
        if (o === -1) continue; const s = sk.segs[o]; const hue = s.limb < 0 ? 0 : HUE[(s.limb * 3 + s.k) % HUE.length];
        g.fillStyle = s.limb < 0 ? 'rgba(255,255,255,.35)' : `hsla(${hue},85%,55%,.55)`; g.fillRect(x * Z, y * Z, Z, Z); }
      g.lineWidth = 2;
      for (const l of spec.limbs) { g.strokeStyle = '#000'; g.beginPath(); l.pts.forEach(([x, y], k) => (k ? g.lineTo(x * Z, y * Z) : g.moveTo(x * Z, y * Z))); g.stroke();
        for (const [x, y] of l.pts) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x * Z, y * Z, 3, 0, 7); g.fill(); g.stroke(); } }
      g.fillStyle = '#f0f'; for (const pt of [spec.root, spec.head.pivot]) { g.beginPath(); g.arc(pt[0] * Z, pt[1] * Z, 4, 0, 7); g.fill(); }
      const fr = Array.from({ length: n }, (_, i) => sk.pose(sk.target(set, i / n)));
      rows.push({ ov, fr, W, H, pad: sk.info.pad });
    }
    const cw = Math.max(...rows.map(r => r.fr[0].width)) * Z / 2, ch = Math.max(...rows.map(r => r.fr[0].height)) * Z / 2;
    const ow = Math.max(...rows.map(r => r.ov.width));
    const out = document.createElement('canvas'); out.width = ow + cw * n; out.height = rows.reduce((s, r) => s + Math.max(r.ov.height, ch), 0);
    const g = out.getContext('2d'); g.imageSmoothingEnabled = false; g.fillStyle = '#e8eef0'; g.fillRect(0, 0, out.width, out.height);
    let y = 0;
    for (const r of rows) { g.drawImage(r.ov, 0, y); r.fr.forEach((f, i) => { g.strokeStyle = '#c5ccd0'; g.strokeRect(ow + i * cw, y, cw, ch); g.drawImage(f, ow + i * cw, y + ch - f.height * Z / 2, f.width * Z / 2, f.height * Z / 2); g.strokeStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(ow + i * cw, y + ch - 1); g.lineTo(ow + (i + 1) * cw, y + ch - 1); g.stroke(); }); y += Math.max(r.ov.height, ch); }
    return out.toDataURL();
  }, { ids, set: process.env.SET || 'walk', n: +(process.env.N || 8), Z: +(process.env.Z || 6) });
  fs.writeFileSync((process.env.OUT || path.join(OUTDIR, 'out')), Buffer.from(url.split(',')[1], 'base64'));
  await b.close(); srv.close();
})();
