// 手機打卡（規則在 core/checkin.js，這裡看畫面，而且都用真的點擊和真的滑鼠）——共生 v2 的成功定義：
//   你在外面用手機做的事，回到電腦時桌面上看得到結果，而且看得出是因為你
//   1. 真的小網站（src/main/phone.js）開手機頁面 → 一打開就是一次「想念」，牠有回應
//   2. 用手指（page.click）按「我吃飯了」→ 1 秒內手機上牠做一樣的動作、寫出牠的名字
//   3. 桌面上那隻旁邊出現一個碗；滑鼠移上去寫「幾點 你去吃飯的時候，牠也吃了一顆樹果」；看過就淡掉
//   4. 架構：在 CHECKINS 表加一列「伸展」→ 手機多一個按鈕、按了桌面有痕跡（main/phone.js、game.js、director.js 都沒改）
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');
const os = require('node:os');

const TRACE_LINE = /^\d{1,2}:\d{2} 你.+的時候，.+也/;

async function test({ page, shot: rawShot }, check) {
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); });
    return rawShot(name);
  };
  const who = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 40; game.state.mons.push(m); }
    game.state.mons.find(m => m.species === 661).affection = 140; // 最親近的是小箭雀：打卡由牠做
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.story.lastAt = Date.now() + 86_400_000; // 故事的電話今天先不要打來（會蓋住畫面）
    const pet = [...stage.pets.values()].find(p => p.mon.species === 661);
    pet.perch = null; pet.x = 700; pet.gy = 520; pet.set('sit', 999); pet.partner = null;
    pet.reserved = true; // 測試中不要走開（痕跡要在牠旁邊）
    await ui.setPhone(true);
    return { uid: pet.uid, name: game.displayName(pet.mon), aff: pet.mon.affection };
  });

  // 真的小網站：打卡交給畫面的 director.phoneAction（Electron 裡是 main.js 經過 IPC 轉過來，真的 Electron 另外驗）
  let snap = await page.evaluate(() => window.__kalos.director.pushPhone());
  const refresh = async () => { snap = await page.evaluate(() => window.__kalos.director.pushPhone()); };
  const { createPhoneServer, privateAddresses } = await import(path.join(ROOT, 'src/main/phone.js'));
  const dir = path.join(ROOT, 'src/phone');
  const server = createPhoneServer({
    getSnapshot: () => snap,
    onAction: async a => { const r = await page.evaluate(a => window.__kalos.director.phoneAction(a), a); await refresh(); return r; },
    files: { '': path.join(dir, 'index.html'), 'phone.js': path.join(dir, 'phone.js'), 'phone.css': path.join(dir, 'phone.css'), 'font.woff2': path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2') },
  });
  // F25：用區網位址開（http 的頁面沒有 crypto.randomUUID）；沒有區網就用 127.0.0.1，並先把 randomUUID 拿掉
  const lan = privateAddresses(os.networkInterfaces()).filter(a => !a.tailscale).slice(0, 1);
  const urls = await server.start([...lan, { address: '127.0.0.1', tailscale: false }], 39500 + Math.floor(Math.random() * 400));
  const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await phone.addInitScript(() => { delete Crypto.prototype.randomUUID; });
  const errors = [];
  phone.on('pageerror', e => errors.push(e.message));
  phone.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  let seen;
  try {
    await phone.goto(urls[0].url);
    await phone.waitForSelector('section.checkin button[data-kind="meal"]', { timeout: 10000 });
    // 1) 一打開就是一次想念
    await phone.waitForFunction(() => /好像感覺到你在看牠/.test(document.querySelector('section.checkin .reply')?.textContent ?? ''), null, { timeout: 5000 });
    const buttons = await phone.$$eval('section.checkin button', bs => bs.map(b => b.textContent));
    check(buttons.join(',') === '我吃飯了,我喝水了,出門走走,我要去睡了,我在讀書', `手機的打卡按鈕不對：${buttons}`);
    const order = await phone.$$eval('main > section', ss => ss.map(s => s.className));
    check(order.indexOf('checkin') === order.indexOf('outing empty') + 1 || order[1] === 'checkin', `打卡不在「跟你出門中」下面：${order}`);

    // 2) 手指按「我吃飯了」：1 秒內牠做一樣的動作、寫出名字
    const t0 = Date.now();
    await phone.click('section.checkin button[data-kind="meal"]');
    await phone.waitForFunction(() => /也吃了一顆樹果/.test(document.querySelector('section.checkin .reply .line')?.textContent ?? ''), null, { timeout: 3000 });
    const took = Date.now() - t0;
    seen = await phone.evaluate(() => ({ line: document.querySelector('section.checkin .reply .line').textContent, anim: document.querySelector('section.checkin .reply img')?.className }));
    check(took < 1000 && seen.line === `${who.name}也吃了一顆樹果` && /do-munch/.test(seen.anim ?? ''), `手機上的回應不對（${took}ms）：${JSON.stringify(seen)}`);
    await phone.waitForTimeout(150);
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/checkin-phone.png') });
    check(errors.length === 0, `手機頁面有錯誤：${errors}`);

    // 3) 桌面：牠旁邊出現一個碗，滑鼠移上去看得到因果
    const trace = await page.evaluate(async uid => {
      const { stage, director } = window.__kalos;
      const t0 = Date.now();
      let prop = null;
      while (!prop && Date.now() - t0 < 5000) { prop = [...(director.traces?.values() ?? [])].find(p => p.traceKind === 'meal'); await new Promise(r => setTimeout(r, 50)); }
      if (!prop) return null;
      await new Promise(r => setTimeout(r, 600)); // 淡入
      const pet = stage.pets.get(uid), r = prop.rect();
      const a = stage.toCss(prop.x, prop.y), b = stage.toCss(pet.x, pet.gy), c = stage.toCss(r.x + r.w / 2, r.y + r.h / 2);
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), center: c, alpha: prop.alpha, id: prop.trace };
    }, who.uid);
    check(trace && trace.dist <= 80 && trace.alpha > 0.9, `碗不在牠旁邊：${JSON.stringify(trace)}`);
    const view = await page.evaluate(() => window.__kalos.game.symbiosisView());
    check(view.bloom === 1, `吃飯沒有算進今天做到的好事：${JSON.stringify(view)}`);
    const aff = await page.evaluate(uid => window.__kalos.game.mon(uid).affection, who.uid);
    check(aff > who.aff, `好感沒有加：${who.aff} → ${aff}`);
    await page.mouse.move(trace.center.x, trace.center.y);
    await page.waitForTimeout(300);
    const label = await page.evaluate(() => { const l = document.querySelector('.label'); return { text: l.querySelector('.tag').textContent, hidden: l.classList.contains('hidden') }; });
    check(!label.hidden && TRACE_LINE.test(label.text) && label.text.includes(`你去吃飯的時候，${who.name}也吃了一顆樹果`), `滑鼠移上去的文字不對：${JSON.stringify(label)}`);
    await shot('checkin-trace');
    // 看過了：滑鼠移開以後慢慢淡掉，不會再出現
    await page.mouse.move(200, 150);
    const faded = await page.evaluate(async id => {
      const { director, stage } = window.__kalos;
      const t0 = Date.now();
      while (Date.now() - t0 < 6000 && stage.props.some(p => p.trace === id && !p.gone)) await new Promise(r => setTimeout(r, 100));
      return { gone: !stage.props.some(p => p.trace === id && !p.gone), done: director.tracesDone.has(id) };
    }, trace.id);
    check(faded.gone && faded.done, `看過的痕跡沒有淡掉：${JSON.stringify(faded)}`);

    // 4) 架構可用性：只在 CHECKINS 表加一列（renderer 和伺服器都是讀同一個 core/checkin.js），手機多一個按鈕、按了有痕跡
    const row = { id: 'stretch', zh: '我伸展了一下', doing: '伸展', act: '伸了個懶腰', perDay: 3, trace: 'stretch', link: 'rest', anim: 'hop' };
    const nodeCI = await import(path.join(ROOT, 'src/core/checkin.js'));
    nodeCI.CHECKINS.push(row);
    await page.evaluate(async row => { (await import('/src/core/checkin.js')).CHECKINS.push(row); }, row);
    await refresh();
    await phone.reload();
    await phone.waitForSelector('section.checkin button[data-kind="stretch"]', { timeout: 5000 });
    await phone.click('section.checkin button[data-kind="stretch"]');
    await phone.waitForFunction(() => /也伸了個懶腰/.test(document.querySelector('section.checkin .reply .line')?.textContent ?? ''), null, { timeout: 3000 });
    const stretch = await page.evaluate(async () => {
      const { director } = window.__kalos;
      const t0 = Date.now();
      let prop = null;
      while (!prop && Date.now() - t0 < 5000) { prop = [...(director.traces?.values() ?? [])].find(p => p.traceKind === 'stretch'); await new Promise(r => setTimeout(r, 50)); }
      return prop && { text: prop.hoverText, img: prop.img?.width > 0 };
    });
    check(stretch && stretch.img && TRACE_LINE.test(stretch.text) && /你伸展的時候/.test(stretch.text), `加一列「伸展」沒有痕跡：${JSON.stringify(stretch)}`);
    // 用完拿掉（這一列只是證明做得到，不留在 app 裡）
    nodeCI.CHECKINS.splice(nodeCI.CHECKINS.indexOf(row), 1);
    await page.evaluate(async () => { const { CHECKINS } = await import('/src/core/checkin.js'); CHECKINS.splice(CHECKINS.findIndex(c => c.id === 'stretch'), 1); });
    check(errors.length === 0, `手機頁面有錯誤：${errors}`);
  } finally {
    await phone.close();
    await server.stop();
  }
  console.log(JSON.stringify({ who: who.name, phone: seen }));
}

run('checkin', test);
