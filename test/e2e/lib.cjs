// 瀏覽器端測試的共用工具：開一個靜態伺服器（repo 根目錄），用 Playwright 打開
// src/renderer/index.html（沒有 Electron 時會用 mock-api），回傳 page 與收集到的錯誤。
//
// 寶可夢圖片走 /__sprites/…：先看 .cache/sprites 有沒有，沒有就用 curl 從 PokeAPI 抓下來存著
// （curl 會走系統的 proxy 設定；瀏覽器自己連外網在某些環境會被擋）。圖片不進 repo。
//
// 執行：node test/e2e/<feature>.cjs   （需要已經安裝好的 Playwright，不在 package.json 裡）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const CACHE = path.join(ROOT, '.cache/sprites');
const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* 下一個 */ } }
  throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH 指到它的資料夾）');
}

function fetchSprite(rel) {
  const file = path.join(CACHE, rel);
  if (fs.existsSync(file)) return Promise.resolve(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new Promise(resolve => {
    execFile('curl', ['-sfL', '--max-time', '20', '-o', file, `${SPRITE_BASE}/${rel}`], err => {
      if (err) { fs.rmSync(file, { force: true }); resolve(null); } else resolve(file);
    });
  });
}

function serve() {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file;
    if (url.startsWith('/__sprites/')) {
      const rel = url.slice('/__sprites/'.length);
      if (!/^(shiny\/)?\d{3,5}(-[a-z]+)*\.png$/.test(rel)) { res.writeHead(400).end(); return; }
      file = await fetchSprite(rel);
    } else {
      file = path.join(ROOT, url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = null;
    }
    if (!file) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// query：額外的網址參數（例如 { windows: '...' }）
async function open({ query = {}, fresh = true, viewport = { width: 1280, height: 720 } } = {}) {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const q = new URLSearchParams({ dev: '1', sprites: '/__sprites', ...(fresh ? { fresh: '1' } : {}), ...query });
  await page.goto(`${base}/src/renderer/index.html?${q}`);
  await page.waitForFunction(() => window.__kalos?.game, null, { timeout: 15000 });
  return {
    page,
    errors,
    base,
    async shot(name) {
      // 測試用程式直接選了御三家，但 app 在圖片載好之後才決定要不要跳出歡迎視窗，會蓋住畫面
      await page.evaluate(() => {
        const { game, ui } = window.__kalos;
        if (game.state.starterChosen && ui.modal.querySelector('.starter')) ui.modal.classList.add('hidden');
      });
      const file = path.join(ROOT, 'docs/screens', `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },
    async close() { await browser.close(); server.close(); },
  };
}

// 每個腳本最後一行：PASS <名稱> 或 FAIL <名稱>: <原因>
async function run(name, fn) {
  let ctx;
  try {
    ctx = await open(fn.options);
    const problems = [];
    const check = (ok, msg) => { if (!ok) problems.push(msg); };
    await fn(ctx, check);
    if (ctx.errors.length) problems.push(`console 有錯誤：${ctx.errors.slice(0, 3).join(' | ')}`);
    console.log(problems.length ? `FAIL ${name}: ${problems.join('; ')}` : `PASS ${name}`);
    process.exitCode = problems.length ? 1 : 0;
  } catch (err) {
    console.log(`FAIL ${name}: ${err.stack ?? err}`);
    process.exitCode = 1;
  } finally {
    await ctx?.close();
  }
}

module.exports = { open, run, ROOT };
