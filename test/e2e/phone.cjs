// 手機頁面：設定裡打開 → 顯示網址和 QR code → 畫面送出摘要（夥伴的小圖、明信片、信、心情）
// → 用真的小網站（src/main/phone.js）開在 127.0.0.1，手機大小的瀏覽器打開：
//    內容都在、暱稱裡的 HTML 原樣顯示（不會執行）、沒有 token 打不開
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');

run('phone', async ({ page, shot }, check) => {
  const snap = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    const m = game.createMon(661); m.out = true; m.affection = 200; game.state.mons.push(m);
    game.rename(game.state.mons[0].uid, '<img src=x onerror=alert(1)>');
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    // 一封信、一張明信片、心情
    const w = game.state.mons[1];
    game.state.letters.pending.push({ key: 'phone-test', kind: 'hearts', uid: w.uid, due: Date.now(), data: {} });
    game.deliverLetters();
    game.state.postcards.push({ id: 'pc1', place: Object.keys((await import('../../src/core/trips.js')).PLACES)[0], seed: 7, at: Date.now(), uid: w.uid, name: '小箭雀', diary: '今天看到好大的海。' });
    game.setMood('happy');
    await new Promise(r => setTimeout(r, 1500)); // 夥伴的圖載好
    await ui.setPhone(true);
    ui.open('settings');
    await new Promise(r => setTimeout(r, 300));
    const cv = document.querySelector('.settings canvas[data-qr]');
    const dark = cv ? [...cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data].filter((v, i) => i % 4 === 0 && v < 50).length : 0;
    return { nick: game.state.mons[0].nickname, urls: [...document.querySelectorAll('.settings .purl')].map(b => b.textContent), qr: cv ? [cv.width, dark] : null, data: director.pushPhone() };
  });
  check(snap.urls.length === 2 && /Tailscale/.test(snap.urls.join()), `設定裡的網址不對：${JSON.stringify(snap.urls)}`);
  check(snap.qr && snap.qr[1] > 500, `QR code 沒畫出來：${JSON.stringify(snap.qr)}`);
  const d = snap.data;
  check(d && d.pets.length === 2 && d.letters.length >= 1 && d.postcards[0]?.img?.startsWith('data:image/png') && Object.keys(d.pics).length >= 1, `摘要不完整：${JSON.stringify({ pets: d?.pets, letters: d?.letters?.length, pics: Object.keys(d?.pics ?? {}), card: Boolean(d?.postcards?.[0]?.img) })}`);
  await page.evaluate(() => document.querySelector('.settings fieldset.phone').scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(200);
  await shot('phone-settings');

  // 真的小網站
  const { createPhoneServer } = await import(path.join(ROOT, 'src/main/phone.js'));
  const dir = path.join(ROOT, 'src/phone');
  const server = createPhoneServer({ getSnapshot: () => d, files: { '': path.join(dir, 'index.html'), 'phone.js': path.join(dir, 'phone.js'), 'phone.css': path.join(dir, 'phone.css'), 'font.woff2': path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2') } });
  const [u] = await server.start([{ address: '127.0.0.1', tailscale: false }], 39000 + Math.floor(Math.random() * 500));
  const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const alerts = [], errors = [];
  phone.on('dialog', dlg => { alerts.push(dlg.message()); dlg.dismiss(); });
  phone.on('pageerror', e => errors.push(e.message));
  phone.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  try {
    await phone.goto(u.url);
    await phone.waitForSelector('.pet', { timeout: 10000 });
    const seen = await phone.evaluate(() => ({
      today: document.querySelector('.today').textContent,
      pets: [...document.querySelectorAll('.pet b')].map(b => b.textContent),
      injected: document.querySelectorAll('.pet img:not(.pic), main img[src="x"]').length,
      letters: document.querySelectorAll('details.letter').length,
      card: Boolean(document.querySelector('.card img')),
      pics: document.querySelectorAll('img.pic').length,
    }));
    check(snap.nick.startsWith('<img') && seen.pets.includes(snap.nick) && seen.injected === 0 && alerts.length === 0, `暱稱被當成 HTML 了：${JSON.stringify({ seen, alerts })}`);
    check(/很開心/.test(seen.today) && seen.letters >= 1 && seen.card && seen.pics >= 1, `手機頁面的內容不對：${JSON.stringify(seen)}`);
    await phone.click('details.letter summary');
    await phone.waitForTimeout(200);
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/phone-page.png'), fullPage: true });
    check(errors.length === 0, `手機頁面有錯誤：${errors.slice(0, 3)}`);
    // 沒有 token：打不開（Chrome 顯示純文字的 404 頁會被 CSP 擋掉內建的樣式，那個錯誤不算）
    const bad = await phone.goto(u.url.replace(/\/t\/[0-9a-f]+\//, '/t/' + 'f'.repeat(32) + '/'));
    check(bad.status() === 404, `token 不對還打得開：${bad.status()}`);
  } finally {
    await phone.close();
    await server.stop();
  }
});
