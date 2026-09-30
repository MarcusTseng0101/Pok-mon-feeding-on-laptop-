const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
// Playwright：跟 test/e2e/lib.cjs 一樣的找法（PLAYWRIGHT_PATH、全域安裝）
const { chromium } = (() => { for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } } throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH）'); })();
const OUTDIR = process.env.OUTDIR || require('os').tmpdir();
// 新舊走路並排影片：每一隻一列，左＝現在的木偶（rig.js）、右＝骨架（skeleton.js），都真的往前走（速度照步幅，腳不滑）
const http = require('http'), fs = require('fs');
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); try { const b = fs.readFileSync(f); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'image/png' }); r.end(b); } catch { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html><body style="margin:0;background:#dfe7ea"></body></html>'); } }).listen(9484);
(async () => {
  const ids = (process.env.IDS || '658,656,652,667').split(',');
  const SECS = +(process.env.SECS || 10);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: (process.env.VDIR || OUTDIR), size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:9484/blank.html');
  await p.evaluate(async ({ ids, SECS, SET }) => {
    const { buildRig } = await import('/src/renderer/gfx/rig.js');
    const { buildSkeleton } = await import('/src/renderer/gfx/skeleton.js');
    const { SKELETONS } = await import('/src/renderer/gfx/skeletons.js');
    const crop = async id => { const img = new Image(); img.src = '/.cache/sprites/' + id + '.png'; await img.decode();
      const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height; const g0 = c0.getContext('2d'); g0.drawImage(img, 0, 0);
      const d = g0.getImageData(0, 0, c0.width, c0.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c0.height; y++) for (let x = 0; x < c0.width; x++) if (d[(y * c0.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1; c.getContext('2d').drawImage(c0, x0, y0, c.width, c.height, 0, 0, c.width, c.height); return c; };
    const rows = [];
    for (const id of ids) { const c = await crop(id); rows.push({ id, old: buildRig(c), neu: buildSkeleton(c, SKELETONS[id]) }); }
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; document.body.append(cv);
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const rowH = 720 / rows.length, Z = Math.min(2, Math.floor(rowH / 60) || 1) ;
    const HZ = 1.1; // 一秒幾輪 // 猜的，只是預覽
    const t0 = performance.now();
    await new Promise(done => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = '#dfe7ea'; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#333'; g.font = '16px sans-serif'; g.fillText('現在（rig.js）', 20, 20); g.fillText('骨架（skeleton.js）', 660, 20);
        g.strokeStyle = '#888'; g.beginPath(); g.moveTo(640, 0); g.lineTo(640, 720); g.stroke();
        rows.forEach((r, k) => {
          const base = (k + 1) * rowH - 8;
          g.strokeStyle = '#9aa'; g.beginPath(); g.moveTo(0, base); g.lineTo(1280, base); g.stroke();
          const ph = t * HZ;
          for (const [rig, x0, strideOf] of [[r.old, 0, rr => 2 * rr.info.stride], [r.neu, 640, rr => 2 * rr.info.stride]]) {
            const f = SET === 'walk' ? rig.pose(rig.target('walk', ph % 1)) : rig.pose(rig.target(SET, (t * 0.5) % 1));
            const dist = SET === 'walk' ? ph * strideOf(rig) : 0; // 一輪走 2 × stride（美術像素）
            const span = 640 - f.width * Z;
            const x = x0 + span - ((dist * Z) % (span + 1)) ;
            g.drawImage(f, Math.round(x), Math.round(base - f.height * Z), f.width * Z, f.height * Z);
          }
        });
        if (t < SECS) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }, { ids, SECS, SET: process.env.SET || 'walk' });
  const v = await p.video().path(); await ctx.close(); await b.close(); srv.close();
  fs.renameSync(v, (process.env.OUT || path.join(OUTDIR, 'out'))); console.log('ok', (process.env.OUT || path.join(OUTDIR, 'out')));
})();
