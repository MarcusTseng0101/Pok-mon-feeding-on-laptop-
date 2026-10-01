// 帶一隻出門（規則在 core/outing.js，這裡看畫面，而且都用真的滑鼠）
//   1. 用滑鼠把夥伴拖到螢幕左邊邊緣放開 → 牠揮手走出去，原來的地方留一張「跟你出門了」的紙條
//   2. 真的小網站打開手機頁面 → 出門中的夥伴在最上面，文字寫「家裡那邊」
//   3. 45 分鐘後點紙條 → 牠從邊邊跑回紙條那裡，給你一張「今天跟你出門」的明信片，相簿多一張
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url'); // Windows：import() 要 file:// 網址，不能直接給 C: 的路徑

async function test({ page, shot: rawShot }, check) {
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); });
    return rawShot(name);
  };
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.story.lastAt = Date.now() + 86_400_000; // 故事的電話今天先不要打來（會蓋住畫面）
    game.state.weather = { city: '臺北', lat: 25.03, lon: 121.56, enabled: true };
    director.setWeather('rain'); // 家裡那邊在下雨
    window.__toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (text, o) => { window.__toasts.push(text); return toast(text, o); };
  });

  // 1) 挑一隻站在地上、沒在做事的，放到畫面中間偏右，再用滑鼠拖到左邊邊緣放開
  const who = await page.evaluate(async () => {
    const { stage } = window.__kalos;
    const pet = [...stage.pets.values()].find(p => p.mon.species === 661);
    pet.perch = null; pet.x = 760; pet.gy = 500; pet.set('idle', 30); pet.partner = null;
    await new Promise(r => setTimeout(r, 300));
    const r = pet.rect();
    return { uid: pet.uid, x: r.x + r.w / 2, y: r.y + r.h / 2, from: { x: pet.x, y: pet.gy } };
  });
  await page.mouse.move(who.x, who.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(who.x + ((2 - who.x) * i) / 20, who.y + (0 * i) / 20); await page.waitForTimeout(16); }
  await page.waitForTimeout(150);
  const hint = await page.evaluate(() => window.__toasts.find(t => /放開就帶/.test(t)));
  check(hint, '拖到邊緣沒有說「放開就帶牠出門」');
  await page.mouse.up();
  const gone = await page.evaluate(async uid => {
    const { game, stage, director } = window.__kalos;
    const t0 = Date.now(), states = new Set();
    while (stage.pets.has(uid) && Date.now() - t0 < 15000) { states.add(stage.pets.get(uid).state); await new Promise(r => setTimeout(r, 50)); }
    await new Promise(r => setTimeout(r, 1200)); // refreshOutings 每秒一次
    const note = director.outNotes?.get(uid);
    return { states: [...states], onStage: stage.pets.has(uid), outing: game.mon(uid).outing, note: note && { x: note.x, y: note.y, props: stage.props.includes(note) }, home: game.homeMons().length };
  }, who.uid);
  check(gone.outing && !gone.onStage && gone.states.includes('depart'), `沒有走出去：${JSON.stringify(gone)}`);
  check(gone.note?.props && Math.abs(gone.note.x - who.from.x) < 60 && Math.abs(gone.note.y - who.from.y) < 60, `紙條不在牠原來的地方：${JSON.stringify({ note: gone.note, from: who.from })}`);
  await page.mouse.move(640, 200);
  await shot('outing-note');

  // 2) 手機頁面（真的小網站，照 phone.cjs）
  await page.evaluate(() => { window.__clock.offset += 50 * 60_000; });
  const d = await page.evaluate(async () => { await window.__kalos.ui.setPhone(true); return window.__kalos.director.pushPhone(); });
  check(d?.outing && d.outing.minutes >= 50 && /家裡那邊下雨/.test(d.outing.line) && d.pics[d.outing.pic], `手機摘要沒有出門中的夥伴：${JSON.stringify(d?.outing)}`);
  const { createPhoneServer } = await import(pathToFileURL(path.join(ROOT, 'src/main/phone.js')).href);
  const dir = path.join(ROOT, 'src/phone');
  const server = createPhoneServer({ getSnapshot: () => d, files: { '': path.join(dir, 'index.html'), 'phone.js': path.join(dir, 'phone.js'), 'phone.css': path.join(dir, 'phone.css'), 'font.woff2': path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2') } });
  const [u] = await server.start([{ address: '127.0.0.1', tailscale: false }], 39500 + Math.floor(Math.random() * 400));
  const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  phone.on('pageerror', e => errors.push(e.message));
  try {
    await phone.goto(u.url);
    await phone.waitForSelector('section.outing .trip', { timeout: 10000 });
    const seen = await phone.evaluate(() => {
      const first = [...document.querySelectorAll('main section')].find(s => !s.classList.contains('empty'));
      return { first: first?.className, name: document.querySelector('section.outing b')?.textContent, text: document.querySelector('section.outing')?.textContent, pic: Boolean(document.querySelector('section.outing img.pic')), pets: [...document.querySelectorAll('section.pets b')].map(b => b.textContent) };
    });
    check(seen.first === 'outing' && seen.pic && /家裡那邊/.test(seen.text) && !/你那邊/.test(seen.text) && !seen.pets.includes(seen.name), `手機頁面最上面不是出門中的夥伴：${JSON.stringify(seen)}`);
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/outing-phone.png'), fullPage: true });
    check(errors.length === 0, `手機頁面有錯誤：${errors}`);
  } finally {
    await phone.close();
    await server.stop();
  }

  // 3) 回來了：用真的滑鼠點紙條
  const before = await page.evaluate(() => window.__kalos.game.state.postcards.length);
  await page.mouse.move(gone.note.x, gone.note.y - 8);
  await page.waitForTimeout(150);
  await page.mouse.click(gone.note.x, gone.note.y - 8);
  const back = await page.evaluate(async uid => {
    const { game, stage } = window.__kalos;
    const t0 = Date.now();
    let entered = null;
    while (Date.now() - t0 < 25000) { // 畫面卡的時候遊戲時間比較慢，多等一下
      const p = stage.pets.get(uid);
      if (p && entered === null) entered = { x: Math.round(p.x), state: p.state };
      if (p && !p.runningHome && p.state !== 'tripReturn') break;
      await new Promise(r => setTimeout(r, 50));
    }
    const p = stage.pets.get(uid);
    await new Promise(r => setTimeout(r, 400));
    const modal = document.querySelector('.modal:not(.hidden) .postcard');
    return { entered, at: p && { x: Math.round(p.x), y: Math.round(p.gy) }, outing: game.mon(uid).outing, postcards: game.state.postcards.length, last: game.state.postcards.at(-1), title: modal?.querySelector('h2')?.textContent, diary: modal?.querySelector('.diary')?.textContent };
  }, who.uid);
  check(!back.outing && back.entered && (back.entered.x < 0 || back.entered.x > 1280) && back.entered.state === 'tripReturn', `沒有從邊邊跑回來：${JSON.stringify(back.entered)}`);
  check(back.at && Math.abs(back.at.x - gone.note.x) < 40 && Math.abs(back.at.y - gone.note.y) < 40, `沒有跑回紙條那裡：${JSON.stringify({ at: back.at, note: gone.note })}`);
  check(back.postcards === before + 1 && back.last?.place === 'with-you' && back.title === '今天跟你出門' && /50 分鐘/.test(back.diary) && /家裡那邊下雨/.test(back.diary), `明信片不對：${JSON.stringify(back)}`);
  await shot('outing-postcard');
  // 相簿（從選單真的點進去）多一張「跟你出門」
  await page.click('.modal [data-yes]');
  await page.click('.launcher');
  await page.click('.menu [data-open="album"]');
  await page.waitForTimeout(300);
  const album = await page.$$eval('.album .card b', bs => bs.map(b => b.textContent));
  check(album[0] === '跟你出門', `相簿第一張不是跟你出門：${album}`);
  const noteLeft = await page.evaluate(uid => window.__kalos.director.outNotes?.has(uid) || window.__kalos.stage.props.some(p => p.outing === uid && !p.gone && p.life > 0), who.uid);
  check(!noteLeft, '紙條還在');
  console.log(JSON.stringify({ gone: { states: gone.states, note: gone.note }, entered: back.entered, at: back.at, diary: back.diary, album: album.slice(0, 2) }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('outing', test);
