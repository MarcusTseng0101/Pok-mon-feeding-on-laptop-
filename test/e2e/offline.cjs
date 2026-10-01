// 斷網也能用（Tailscale HTTPS＋service worker）。沒辦法在沙盒裡連真的 Tailscale，所以：
//   本機自簽憑證起一個 HTTPS 代理假裝 tailscale serve（https://laptop.tail1234.ts.net → 127.0.0.1），
//   另開一個 Chromium 把這個名字指到本機（--host-resolver-rules）、接受自簽憑證。
//   1. 電腦的設定：打開手機頁面 →「在外面也能用」貼網址、按測試連線（真的伺服器、真的經過代理）→ 成功、QR code 換成 https 網址
//   2. 手機開 https 網址：service worker 生效、辨識的檔案存好
//   3. 手機斷網、重新整理：頁面還在，寫「離線中，資料是 HH:MM 的」，牠們照樣過日子
//   4. 斷網時拍杯子 → 猜喝水 → 一起做：手機上馬上一起喝水；確認的事排進佇列
//   5. 連回來（電腦那邊已經過了幾分鐘、跨過下一個 10 分鐘的格子）：佇列送出；桌面上的杯子痕跡寫的是**斷網時按的時間**，不是送到的時間
//   6. F24：清掉手機上所有資料 → 重新打開，東西都從電腦回來（只有照片不見，README 有寫）
//   7. F26：重新產生網址 → 舊網址寫「網址換了」，service worker 自己取消註冊
//   F30、F33：手機送出的 body 都只有 { kind, id, at }；CSP 違規 0 次
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url'); // Windows：import() 要 file:// 網址，不能直接給 C: 的路徑
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

const HOST = 'laptop.tail1234.ts.net';
const BASE = `https://${HOST}`;
const TLS = path.join(ROOT, 'test/fixtures/tls');
const MIN = 60_000;

function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } }
  throw new Error('找不到 Playwright');
}

// 假裝 tailscale serve：https://HOST → http://127.0.0.1:<port>（電腦的 app 沒開時回 502，跟 tailscale serve 一樣）
function startProxy(target, port = 0) {
  const server = https.createServer({ key: fs.readFileSync(path.join(TLS, 'key.pem')), cert: fs.readFileSync(path.join(TLS, 'cert.pem')) }, (req, res) => {
    const up = http.request({ host: '127.0.0.1', port: target(), path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
    req.pipe(up);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

async function test({ page, shot: rawShot }, check) {
  const shot = async name => { await page.evaluate(() => window.__kalos.ui.holo.el.classList.add('hidden')); return rawShot(name); };
  const who = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; game.state.mons.push(m); }
    game.state.mons[1].affection = 80;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.canDepart = () => false; // 測試中不要有夥伴自己去旅行（在家的會少一隻，跟這裡要測的無關）
    game.state.story.lastAt = Date.now() + 86_400_000;
    return { uid: game.state.mons[1].uid, name: game.displayName(game.state.mons[1]) };
  });

  // 真的伺服器；POST act 交給 director.phoneAction（main.js 用 IPC 做一樣的事）
  const { createPhoneServer, checkServe, serveBase, serveCommand } = await import(pathToFileURL(path.join(ROOT, 'src/main/phone.js')).href);
  const dir = path.join(ROOT, 'src/phone');
  let snap = null;
  const acts = [];
  const server = createPhoneServer({
    getSnapshot: () => snap,
    vendorDir: path.join(dir, 'vendor'),
    onAction: async a => { acts.push(a); const r = await page.evaluate(a => window.__kalos.director.phoneAction(a), a); snap = await page.evaluate(() => window.__kalos.director.pushPhone()); return r; },
    files: Object.fromEntries([['', 'index.html'], ...['phone.js', 'phone.css', 'snap.js', 'snap.css', 'sw.js'].map(f => [f, f])].map(([k, f]) => [k, path.join(dir, f)]).concat([['font.woff2', path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2')]])),
  });
  const port = 39500 + Math.floor(Math.random() * 400);
  let proxy = await startProxy(() => server.port ?? 1);
  const proxyPort = proxy.address().port;
  // 測試連線走代理（main.js 的 checkServe 用真的 fetch；這裡把名字指到本機代理、信任測試用的憑證）
  const viaProxy = url => new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ host: '127.0.0.1', port: proxyPort, path: u.pathname, servername: HOST, headers: { Host: HOST }, ca: fs.readFileSync(path.join(TLS, 'cert.pem')) }, r => {
      let body = ''; r.on('data', c => { body += c; }); r.on('end', () => resolve({ ok: r.statusCode === 200, status: r.statusCode, json: async () => JSON.parse(body) }));
    }).on('error', reject);
  });
  // 電腦的設定畫面接到真的伺服器（mock-api 沒有 main process）
  let serve = null;
  const info = extra => ({ urls: server.urls, serve, command: serveCommand(server.port ?? port), ...extra });
  await page.exposeFunction('__setPhone', async on => { if (!on) { await server.stop(); return { urls: [] }; } await server.start([], port, { serve }); return info(); });
  await page.exposeFunction('__servePhone', async b => {
    serve = b == null ? null : serveBase(b);
    if (b != null && !serve) return info({ ok: false, error: '網址要像 https://你的電腦.xxxx.ts.net' });
    await server.start([], port, { serve });
    return { ...info(), ...(serve ? await checkServe(serve, server.token, viaProxy) : {}) };
  });
  await page.exposeFunction('__regenPhone', async () => { server.regenerate(); return info(); });
  await page.evaluate(() => { const { ui } = window.__kalos; ui.api.setPhone = on => window.__setPhone(on); ui.api.servePhone = b => window.__servePhone(b); ui.api.regenPhone = () => window.__regenPhone(); });

  let pressAt = null, offlineStatus = null, queuedReply = null;
  try {
    // 1) 電腦的設定：真的點
    await page.click('.launcher');
    await page.click('.menu [data-open="settings"]');
    await page.evaluate(() => document.querySelector('.settings fieldset.phone').scrollIntoView({ block: 'end' }));
    await page.click('.settings input[data-phone]');
    await page.waitForSelector('.settings .serve input[data-serve]', { timeout: 5000 });
    const cmd = await page.textContent('.settings .serve code.cmd');
    check(/^tailscale serve --bg --https=443 http:\/\/127\.0\.0\.1:\d+$/.test(cmd), `指令不對：${cmd}`);
    await page.fill('.settings input[data-serve]', 'https://evil.example.com');
    await page.click('.settings [data-act="servetest"]');
    await page.waitForSelector('.settings [data-serve-status].warn', { timeout: 5000 });
    await page.fill('.settings input[data-serve]', `${HOST}/`);
    await page.click('.settings [data-act="servetest"]');
    await page.waitForSelector('.settings [data-serve-status].ok', { timeout: 10000 });
    const set = await page.evaluate(() => ({ sel: document.querySelector('.settings .purl.sel')?.textContent, status: document.querySelector('[data-serve-status]').textContent }));
    check(/^在外面（HTTPS）：https:\/\/laptop\.tail1234\.ts\.net\/t\/[0-9a-f]{32}\/$/.test(set.sel ?? ''), `QR code 沒有換成 https 網址：${JSON.stringify(set)}`);
    await page.evaluate(() => document.querySelector('.settings .serve').scrollIntoView({ block: 'end' }));
    await shot('offline-settings');
    await page.evaluate(() => document.querySelector('.window .close')?.click());
    snap = await page.evaluate(() => window.__kalos.director.pushPhone());
    const url = server.urls.find(u => u.https).url;

    // 手機：另開一個 Chromium，把 HOST 指到本機代理、接受自簽憑證（真的 Tailscale 的憑證是真的）
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${proxyPort}`, '--ignore-certificate-errors', '--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_proxy$/i.test(k))) }); // 直接連本機代理（不要走系統的 proxy）
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'allow' });
    const phone = await ctx.newPage();
    const errors = [], sent = [];
    phone.on('pageerror', e => errors.push(e.message));
    phone.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    ctx.on('request', r => { if (r.postData()) sent.push({ url: r.url(), body: r.postData() }); });
    await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const status = () => phone.textContent('.status');
    const actOf = () => phone.evaluate(n => [...document.querySelectorAll('section.pets .pet')].find(p => p.querySelector('b').textContent === n)?.querySelector('.act')?.textContent ?? null, who.name);
    try {
      // 2) service worker 生效、辨識的檔案存好
      await phone.goto(url);
      await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 });
      await phone.evaluate(() => navigator.serviceWorker.ready);
      await phone.reload();
      await phone.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
      const cached = await phone.evaluate(async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
          const keys = await caches.keys(), v = keys.find(k => k.startsWith('kalos-vendor'));
          if (v && (await (await caches.open(v)).keys()).length === 11) return keys;
          await new Promise(r => setTimeout(r, 200));
        }
        return caches.keys();
      });
      check(cached.includes('kalos-page-v1') && cached.some(k => k.startsWith('kalos-vendor')), `沒有存好快取：${cached}`);

      // 3) 手機斷網、重新整理：頁面還在，寫離線中
      // 手機完全連不到電腦（電腦關機、Tailscale 斷了）：代理整個關掉；頁面本身也斷網
      // （Playwright 的 setOffline 管不到 service worker 自己發的請求，所以一定要把代理關掉）
      await new Promise(r => { proxy.close(r); proxy.closeAllConnections(); }); // 連保持連線的舊連線也切斷
      await ctx.setOffline(true);
      await phone.reload();
      await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 });
      offlineStatus = await status();
      check(/^離線中，資料是 \d{2}:\d{2} 的/.test(offlineStatus), `離線時沒有寫「離線中」：${offlineStatus}`);

      // 4) 斷網時拍杯子 → 猜喝水 → 一起做（模型從 service worker 的快取來）
      const [fc] = await Promise.all([phone.waitForEvent('filechooser'), phone.click('section.snap label.shoot')]);
      await fc.setFiles(path.join(ROOT, 'test/fixtures/snap/cup.jpg'));
      await phone.waitForFunction(() => { const q = document.querySelector('.snap .q').textContent; return q && q !== '在看是什麼…'; }, null, { timeout: 60000 });
      const guess = await phone.textContent('.snap .q');
      check(guess === '在喝水？', `離線時猜不出來：${guess}`);
      pressAt = Date.now();
      await phone.click('.snap button.go');
      await phone.waitForFunction(n => [...document.querySelectorAll('section.pets .pet')].some(p => p.querySelector('b').textContent === n && /跟你一起喝水/.test(p.querySelector('.act')?.textContent ?? '')), who.name, { timeout: 1000 });
      await phone.waitForFunction(() => /還沒送到家裡的電腦/.test(document.querySelector('.snap .reply').textContent), null, { timeout: 5000 });
      queuedReply = await phone.textContent('.snap .reply');
      const q = await phone.evaluate(() => JSON.parse(localStorage.getItem('kalos-snap-queue')));
      check(q.length === 1 && q[0].kind === 'drink' && Object.keys(q[0]).sort().join() === 'at,id,kind', `佇列不對：${JSON.stringify(q)}`);
      check(acts.length === 0, '斷網時不該送到電腦');
      // 斷網時重新整理：還在一起喝水
      await phone.reload();
      await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 });
      check(/跟你一起喝水/.test(await actOf() ?? ''), `斷網重新整理以後忘了在一起喝水：${await actOf()}`);
      await phone.screenshot({ path: path.join(ROOT, 'docs/screens/offline-phone.png') });

      // 5) 連回來（電腦那邊已經過了幾分鐘）：重新打開頁面就送出；桌面的時間是斷網時按的時間
      // 電腦的時鐘一定跨過下一個 10 分鐘的格子（手機比電腦慢、剛好在換格：生活表查不到現在，以前會什麼都不顯示）
      await page.evaluate(m => { const slot = 10 * m, now = Date.now(); window.__clock.offset += slot - (now % slot) + m; }, MIN);
      proxy = await startProxy(() => server.port ?? 1, proxyPort);
      await ctx.setOffline(false);
      await phone.reload();
      await phone.waitForFunction(() => document.querySelector('section.snap').dataset.queued === '0', null, { timeout: 10000 });
      // 舊頁面收到 online、新頁面一打開都會送：同一個 id 送兩次沒關係（電腦去重，F18），只記一筆
      const recs = await page.evaluate(() => Object.values(window.__kalos.game.state.symbiosis.checkins.days).flatMap(d => Object.values(d)));
      check(new Set(acts.map(a => a.id)).size === 1 && acts.every(a => a.kind === 'drink' && Math.abs(a.at - pressAt) < 2000) && recs.length === 1, `連回來沒有照原樣送出：${JSON.stringify(acts)} ${JSON.stringify(recs)}`);
      check(!/^離線中/.test(await status()), '連回來還寫離線中');
      const desk = await page.evaluate(async ([uid, at]) => {
        const { director, game } = window.__kalos, t0 = Date.now();
        let prop = null;
        while (!prop && Date.now() - t0 < 5000) { prop = [...(director.traces?.values() ?? [])].find(p => p.traceKind === 'drink'); await new Promise(r => setTimeout(r, 50)); }
        return { text: prop?.hoverText ?? null, life: game.lifeAt(uid, at), now: Date.now() };
      }, [who.uid, pressAt]);
      const hm = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
      check(desk.text === `${hm(pressAt)} 你喝水的時候，${who.name}也一起喝了` && desk.life === 'drink', `桌面的時間不是按下去的時間（按：${hm(pressAt)}、電腦現在：${hm(desk.now)}）：${JSON.stringify(desk)}`);

      // 6) F24：清掉手機上所有資料 → 重新打開，東西都從電腦回來
      await phone.evaluate(async () => {
        localStorage.clear();
        for (const k of await caches.keys()) await caches.delete(k);
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        await new Promise(r => { const d = indexedDB.deleteDatabase('kalos-snap'); d.onsuccess = d.onerror = d.onblocked = r; });
      });
      await phone.goto(url);
      await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 }).catch(async e => { console.error('F24DBG', (await phone.textContent('body')).slice(0, 300), JSON.stringify(errors)); throw e; });
      const back = await phone.evaluate(() => ({ pets: document.querySelectorAll('section.pets .pet').length, album: document.querySelectorAll('.snap .memory').length }));
      // 「跟你一起」只記在手機上；電腦的生活表說牠這時候在喝水（跟桌面一樣）。照片不見（README 有寫）
      check(back.pets === 3 && back.album === 0 && (await actOf()) === '在喝水', `清掉以後沒有從電腦回來：${JSON.stringify(back)} ${await actOf()}`);

      // 7) F26：重新產生網址 → 舊網址寫「網址換了」、service worker 取消註冊
      await phone.evaluate(() => navigator.serviceWorker.ready);
      await phone.reload();
      await phone.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
      await page.click('.launcher');
      await page.click('.menu [data-open="settings"]');
      await page.evaluate(() => document.querySelector('.settings fieldset.phone').scrollIntoView({ block: 'end' }));
      await page.click('.settings [data-act="phoneregen"]');
      await page.click('.modal [data-yes]');
      await page.waitForFunction(old => !document.querySelector('.settings .purl.sel')?.textContent.includes(old), url.split('/t/')[1], { timeout: 5000 }).catch(() => {});
      check(server.urls.every(u => u.url !== url), '網址沒有換掉');
      await phone.reload();
      const goneText = await phone.textContent('body');
      const regs = await phone.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
      check(/網址換了/.test(goneText) && regs === 0, `舊網址沒有說網址換了，或 service worker 還在：${goneText.slice(0, 80)} ${regs}`);

      check(sent.every(s => s.body.length <= 200 && !/image\/|data:|base64/.test(s.body)), `照片資料離開了手機：${JSON.stringify(sent)}`);
      const csp = await phone.evaluate(() => window.__csp).catch(() => []);
      check(csp.length === 0, `CSP 違規：${csp}`);
      check(errors.filter(e => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e)).length === 0, `手機頁面有錯誤：${errors}`);
    } finally {
      await browser.close();
    }
  } finally {
    await server.stop();
    proxy.close();
  }
  console.log(JSON.stringify({ who: who.name, offlineStatus, queuedReply, pressAt: new Date(pressAt).toTimeString().slice(0, 5) }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('offline', test);
