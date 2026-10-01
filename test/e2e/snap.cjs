// 拍照，一起做（成功定義）：你拍下一杯水 → 手機猜「在喝水？」→ 你按一起做 → 1 秒內牠在你的手機上一起喝水；
// 桌面上那段時間牠也在喝水，旁邊有一個杯子，滑鼠移上去寫「12:40 你喝水的時候，小箭雀也一起喝了」；照片從頭到尾沒有離開手機。
//   1. 手機頁面（真的小網站、真的模型）：用手指按「📷」選照片（真的 file chooser）
//   2. 空白照片：什麼都不預選，「一起做」按不下去（F31）
//   3. 杯子照片：預選喝水；改按讀書 → 送出的是讀書（F31）；牠一起讀；按「讀完了」
//   4. 杯子照片：預選喝水 → 一起做 → 1 秒內手機上那隻「跟你一起喝水」；桌面上那隻當下也去喝水
//   5. 桌面：lifeAt 是 drink；杯子在牠旁邊，滑鼠移上去看得到因果
//   6. F30：手機頁面送出的每一個請求 body ≤ 200 bytes，沒有 image/、data:、base64；F33：securitypolicyviolation 0 次
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url'); // Windows：import() 要 file:// 網址，不能直接給 C: 的路徑

const FIX = path.join(ROOT, 'test/fixtures/snap');

async function test({ page, shot: rawShot }, check) {
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); });
    return rawShot(name);
  };
  const who = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; game.state.mons.push(m); }
    game.state.mons[1].affection = 80; // 最親近的是小箭雀：跟你一起做的是牠
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.canDepart = () => false; // 測試中不要有夥伴自己去旅行（出發的那隻會跟別隻重疊、或不在家，跟這裡要測的無關）
    game.state.story.lastAt = Date.now() + 86_400_000;
    await ui.setPhone(true);
    const m = game.state.mons[1];
    // 放在畫面中間好截圖
    const pet = stage.pets.get(m.uid);
    pet.x = stage.W * 0.45; pet.facing = 1;
    return { uid: m.uid, name: game.displayName(m) };
  });

  // 真的小網站；POST act 跟 app 一樣交給 director.phoneAction（main.js 用 IPC 做一樣的事）
  const { createPhoneServer } = await import(pathToFileURL(path.join(ROOT, 'src/main/phone.js')).href);
  const dir = path.join(ROOT, 'src/phone');
  let snap = await page.evaluate(() => window.__kalos.director.pushPhone());
  const acts = [];
  const server = createPhoneServer({
    getSnapshot: () => snap,
    vendorDir: path.join(dir, 'vendor'),
    onAction: async a => {
      acts.push(a);
      const r = await page.evaluate(a => window.__kalos.director.phoneAction(a), a);
      snap = await page.evaluate(() => window.__kalos.director.pushPhone());
      return r;
    },
    files: { '': path.join(dir, 'index.html'), 'phone.js': path.join(dir, 'phone.js'), 'phone.css': path.join(dir, 'phone.css'), 'snap.js': path.join(dir, 'snap.js'), 'snap.css': path.join(dir, 'snap.css'), 'font.woff2': path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2') },
  });
  const [u] = await server.start([{ address: '127.0.0.1', tailscale: false }], 39100 + Math.floor(Math.random() * 400));
  const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [], sent = [];
  phone.on('pageerror', e => errors.push(e.message));
  phone.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await phone.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  // F30：攔下手機頁面的每一個請求（照原樣放行），記下有 body 的
  await phone.route('**', route => { const r = route.request(); sent.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }); return route.continue(); });
  const pick = async file => {
    const [fc] = await Promise.all([phone.waitForEvent('filechooser'), phone.click('section.snap label.shoot')]);
    await fc.setFiles(path.join(FIX, file));
    await phone.waitForFunction(() => { const q = document.querySelector('.snap .q').textContent; return q && q !== '在看是什麼…'; }, null, { timeout: 60000 });
    return phone.evaluate(() => ({
      q: document.querySelector('.snap .q').textContent, guess: document.querySelector('section.snap').dataset.guess,
      pick: document.querySelector('.snap .opt.pick')?.dataset.kind ?? null, go: !document.querySelector('.snap button.go').disabled,
      sizes: [...document.querySelectorAll('.snap .opt')].map(b => `${b.offsetWidth}x${b.offsetHeight}`),
    }));
  };
  const actText = () => phone.evaluate(name => [...document.querySelectorAll('section.pets .pet')].find(p => p.querySelector('b').textContent === name)?.querySelector('.act')?.textContent ?? null, who.name);

  let together = null;
  try {
    await phone.goto(u.url);
    await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 });

    // 2) 空白照片：不預選，按不下去；選項一樣大（F31）
    const t0 = Date.now();
    const blank = await pick('blank.jpg');
    const firstGuess = Date.now() - t0;
    check(blank.pick === null && !blank.go && blank.q === '你現在在做什麼？', `空白照片不該預選：${JSON.stringify(blank)}`);
    check(new Set(blank.sizes).size === 1 && blank.sizes.length === 4, `選項不一樣大：${blank.sizes}`);
    check(acts.length === 0, '選了照片還沒按確認就送出去了');

    // 3) 杯子：預選喝水；改按讀書 → 送出的是讀書；按「讀完了」
    const cup = await pick('cup.jpg');
    check(cup.pick === 'drink' && cup.guess === 'drink' && cup.q === '在喝水？' && cup.go, `杯子沒有預選喝水：${JSON.stringify(cup)}`);
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/snap-guess.png') });
    check(acts.length === 0, '只是猜到了就送出去了（一定要按確認）');
    await phone.click('.snap .opt[data-kind="read"]');
    await phone.click('.snap button.go');
    await phone.waitForFunction(n => [...document.querySelectorAll('section.pets .pet')].some(p => p.querySelector('b').textContent === n && /跟你一起看書/.test(p.querySelector('.act')?.textContent ?? '')), who.name, { timeout: 1000 });
    for (let i = 0; i < 40 && acts.length < 1; i++) await phone.waitForTimeout(50);
    check(acts.length === 1 && acts[0].kind === 'read', `改按讀書，送出的不是讀書：${JSON.stringify(acts)}`);
    const reading = await phone.evaluate(() => ({ done: !document.querySelector('.snap button.done').hidden, text: document.querySelector('.snap').textContent }));
    check(reading.done && !/\d+\s*分|倒數|分數|%/.test(reading.text.replace(/\d+:\d+/g, '')), `讀書的時候不該有倒數或分數：${JSON.stringify(reading)}`);
    await phone.click('.snap button.done');
    for (let i = 0; i < 40 && acts.length < 2; i++) await phone.waitForTimeout(50);
    check(acts[1]?.kind === 'done' && !/跟你一起/.test(await actText() ?? ''), `讀完了沒有回到自己的生活：${await actText()} ${JSON.stringify(acts)}`);

    // 4) 成功定義：杯子 → 預選喝水 → 一起做 → 1 秒內手機上牠跟你一起喝水
    const cup2 = await pick('cup.jpg');
    check(cup2.pick === 'drink', `第二次杯子沒有預選喝水：${JSON.stringify(cup2)}`);
    const t1 = Date.now();
    await phone.click('.snap button.go');
    await phone.waitForFunction(n => [...document.querySelectorAll('section.pets .pet')].some(p => p.querySelector('b').textContent === n && /跟你一起喝水/.test(p.querySelector('.act')?.textContent ?? '') && /do-munch/.test(p.querySelector('img')?.className ?? '')), who.name, { timeout: 1000 });
    const took = Date.now() - t1;
    await phone.waitForFunction(n => document.querySelector('.snap .reply').textContent === `${n}跟你一起喝水`, who.name, { timeout: 3000 });
    await phone.waitForSelector('.snap .memory:nth-child(2) img', { timeout: 5000 });
    const album = await phone.$$eval('.snap .memory', ms => ms.map(m => ({ img: m.querySelector('img').src.slice(0, 22), dl: m.querySelector('a.save').getAttribute('download'), w: m.querySelector('img').naturalWidth })));
    check(album.length === 2 && album.every(a => a.img === 'data:image/jpeg;base64' && /^kalos-\d{12}\.jpg$/.test(a.dl) && a.w === 600), `今天的小相簿不對：${JSON.stringify(album)}`);
    await phone.evaluate(() => window.scrollTo(0, 0));
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/snap-together.png'), fullPage: true });
    together = { took, reply: await phone.textContent('.snap .reply') };

    // 6) F30、F33
    const bodies = sent.filter(s => s.body);
    check(bodies.length === 3 && bodies.every(b => b.method === 'POST' && /\/act$/.test(b.url)), `送出 body 的請求不對：${JSON.stringify(bodies.map(b => b.url))}`);
    check(bodies.every(b => b.body.length <= 200 && !/image\/|data:|base64/.test(b.body) && Object.keys(JSON.parse(b.body)).sort().join() === 'at,id,kind'), `照片資料離開了手機：${JSON.stringify(bodies)}`);
    check(sent.every(s => s.url.startsWith(u.url)), `手機頁面連了別的網址：${sent.map(s => s.url).filter(x => !x.startsWith(u.url))}`);
    const csp = await phone.evaluate(() => window.__csp);
    check(csp.length === 0, `CSP 違規：${csp}`);
    check(errors.filter(e => !/Failed to load resource/.test(e)).length === 0, `手機頁面有錯誤：${errors}`);
    const loaded = sent.filter(s => /model\.json|group1-shard|tf-core/.test(s.url)).length;
    check(loaded === 7, `模型不是只載一次：${loaded}`);
    together.firstGuess = firstGuess;
  } finally {
    await phone.close();
    await server.stop();
  }

  // 5) 桌面：那段時間牠在喝水、當下也去喝水；杯子在牠旁邊，滑鼠移上去看得到因果
  const desk = await page.evaluate(async uid => {
    const { stage, director, game } = window.__kalos;
    const t0 = Date.now();
    let prop = null;
    while (!prop && Date.now() - t0 < 5000) { prop = [...(director.traces?.values() ?? [])].find(p => p.traceKind === 'drink'); await new Promise(r => setTimeout(r, 50)); }
    if (!prop) return null;
    const pet = stage.pets.get(uid);
    const state = pet.state;
    await new Promise(r => setTimeout(r, 600)); // 淡入
    const r = prop.rect(), a = stage.toCss(prop.x, prop.y), b = stage.toCss(pet.x, pet.gy), c = stage.toCss(r.x + r.w / 2, r.y + r.h / 2);
    return { life: game.lifeAt(uid), state, dist: Math.hypot(a.x - b.x, a.y - b.y), center: c, alpha: prop.alpha, id: prop.trace, text: prop.hoverText, traces: director.traces.size, bloom: game.symbiosisView().bloom };
  }, who.uid);
  check(desk && desk.life === 'drink', `桌面上那段時間牠不是在喝水：${JSON.stringify(desk)}`);
  check(desk && desk.state === 'sip', `你在家拍的，桌面上那隻沒有當下一起喝：${JSON.stringify(desk)}`);
  check(desk && desk.dist <= 80 && desk.alpha > 0.9, `杯子不在牠旁邊：${JSON.stringify(desk)}`);
  check(desk && desk.traces === 2, `痕跡應該有讀書和喝水兩個：${JSON.stringify(desk)}`);
  check(desk && desk.bloom === 2, `喝水、讀書沒有算進今天做到的好事：${JSON.stringify(desk)}`);
  await page.mouse.move(desk.center.x, desk.center.y);
  await page.waitForTimeout(300);
  const label = await page.evaluate(() => { const l = document.querySelector('.label'); return { text: l.querySelector('.tag').textContent, hidden: l.classList.contains('hidden') }; });
  check(!label.hidden && /^\d{1,2}:\d{2} 你喝水的時候，/.test(label.text) && label.text.endsWith(`你喝水的時候，${who.name}也一起喝了`), `滑鼠移上去的文字不對：${JSON.stringify(label)}`);
  await shot('snap-desk');
  console.log(JSON.stringify({ who: who.name, together, label: label.text }));
}

run('snap', test);
