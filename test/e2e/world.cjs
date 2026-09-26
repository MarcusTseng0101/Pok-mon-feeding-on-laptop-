// PR 5：天氣、獎章、雲端資料夾同步（用真的設定畫面操作）
const { run } = require('./lib.cjs');

run('world', async ({ page, shot }, check) => {
  const wait = ms => page.waitForTimeout(ms);
  await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(656);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    director.nextSpawnAt = Infinity;
    window.__kalos.api.getWeather = async () => ({ weather: 'rain', code: 63 }); // 假裝 Open-Meteo 說在下雨
  });
  await wait(800);

  // ---------- 1. 獎章：選了御三家就拿到「第一個夥伴」 ----------
  const medal = await page.evaluate(() => ({ got: Object.keys(window.__kalos.game.state.achievements), toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }));
  check(medal.got.includes('dex-1'), `沒有拿到第一個獎章：${medal.got}`);
  check(/獲得獎章「第一個夥伴」/.test(medal.toasts), `沒有獎章提示：${medal.toasts}`);
  await page.evaluate(() => { const { ui } = window.__kalos; ui.modal.classList.add('hidden'); ui.open('medals'); });
  await wait(600);
  const medalsUi = await page.evaluate(() => ({ total: document.querySelectorAll('.medal').length, got: document.querySelectorAll('.medal.got').length, summary: document.querySelector('.medals .summary').textContent }));
  check(medalsUi.total >= 24 && medalsUi.got === 1, `獎章畫面：${JSON.stringify(medalsUi)}`);
  await shot('medals');

  // ---------- 2. 天氣：在設定裡搜尋城市 → 選擇 → 下雨 ----------
  await page.evaluate(() => window.__kalos.ui.open('settings'));
  await wait(300);
  await page.fill('[data-city]', '台中東區'); // 按 Enter 也能搜尋
  await page.press('[data-city]', 'Enter');
  await wait(300);
  check(await page.locator('[data-citypick="0"]').count() === 1, '按 Enter 沒有搜尋');
  await page.fill('[data-city]', '中壢');
  await page.click('[data-act="citysearch"]');
  await wait(300);
  await page.click('[data-citypick="0"]');
  await wait(600);
  const w1 = await page.evaluate(() => {
    const { game, director, stage } = window.__kalos;
    return { saved: game.state.weather, weather: director.weather, fx: stage.weatherFx.kind, ctx: director.ctx().weather, text: document.querySelector('fieldset.weather')?.textContent.replace(/\s+/g, ' ') };
  });
  check(w1.saved?.city === '中壢' && w1.saved.enabled, `城市沒存起來：${JSON.stringify(w1.saved)}`);
  check(w1.weather === 'rain' && w1.fx === 'rain' && w1.ctx === 'rain', `天氣沒有套用：${JSON.stringify(w1)}`);
  check(/現在：下雨/.test(w1.text), `設定畫面沒顯示天氣：${w1.text}`);
  // 雨不能攔截滑鼠；查不到天氣時沿用上一次
  await page.evaluate(() => window.__kalos.ui.closePanel());
  await page.mouse.move(60, 380);
  await wait(1200);
  const w2 = await page.evaluate(async () => {
    const { director, stage, api } = window.__kalos;
    const wants = stage.wantsMouse();
    api.getWeather = async () => null; // 沒網路
    await director.refreshWeather(true);
    const aura = (await import('/src/core/encounter.js')).activeModifiers(director.ctx(), window.__kalos.dex).map(m => m.id);
    return { wants, after: director.weather, aura, last: api.interactiveCalls.at(-1) };
  });
  check(!w2.wants && w2.last === false, `下雨時滑鼠被攔截了：${JSON.stringify(w2)}`);
  check(w2.after === 'rain', `查不到天氣時沒有沿用上一次：${w2.after}`);
  check(w2.aura.includes('weather-rain'), `氣息沒有列出下雨：${w2.aura}`);
  await shot('weather-rain');
  // 關掉天氣
  await page.evaluate(() => window.__kalos.ui.open('settings'));
  await wait(300);
  await page.click('[data-weatheron]');
  await wait(300);
  const w3 = await page.evaluate(() => ({ weather: window.__kalos.director.weather, ctx: window.__kalos.director.ctx().weather }));
  check(w3.weather === null && w3.ctx === null, `關掉天氣後還在下雨：${JSON.stringify(w3)}`);

  // ---------- 3. 同步：這台先開始，另一台加入並抓了一隻、拿了樹果，再同步 ----------
  await page.click('[data-act="syncsetup"]');
  await wait(600);
  const s1 = await page.evaluate(() => {
    const { game } = window.__kalos;
    return { sync: game.state.sync && { folder: game.state.sync.folder, id: game.state.sync.deviceId }, files: Object.keys(window.__mockSync ?? {}) };
  });
  check(s1.sync?.folder === '/mock-sync' && s1.files.includes(s1.sync.id), `開始同步後沒有寫出檔案：${JSON.stringify(s1)}`);
  // 另一台電腦（B）：用資料夾裡的存檔加入，抓一隻仙子伊布、摘 5 顆桃桃果，同步寫回資料夾
  const s2 = await page.evaluate(async () => {
    const { game, dex } = window.__kalos;
    const S = await import('/src/core/sync.js');
    const V = await import('/src/core/save.js');
    const G = await import('/src/core/game.js');
    const R = await import('/src/core/rng.js');
    const fileA = V.migrate(structuredClone(window.__mockSync[game.state.sync.deviceId]), dex, Date.now());
    const b = new G.Game({ dex, state: S.joinSync(V.migrate(null, dex, Date.now()), fileA, { folder: '/b', deviceId: 'devbbbbbb2', mode: 'adopt' }), rng: R.createRng(9), now: () => Date.now() });
    const m = b.createMon(700); b.state.mons.push(m); b.state.dex[700] = { seen: 1, caught: 1, shiny: 0, firstSeenAt: Date.now(), firstCaughtAt: Date.now() };
    b.state.bag.berries.pecha += 5;
    window.__mockSync.devbbbbbb2 = S.syncStep(b.state, [fileA]);
    // 這台（A）同時也拿到 2 顆高級球
    game.state.bag.balls.ultra += 2;
    return { bUid: m.uid, pecha: game.state.bag.berries.pecha, ultra: game.state.bag.balls.ultra };
  });
  await page.click('[data-act="syncnow"]');
  await wait(800);
  const s3 = await page.evaluate(uid => {
    const { game, stage } = window.__kalos;
    return { has: game.state.mons.some(m => m.uid === uid), n: game.state.mons.length, pecha: game.state.bag.berries.pecha, ultra: game.state.bag.balls.ultra, dex: game.state.dex[700]?.caught, pets: stage.pets.size, status: document.querySelector('fieldset.sync')?.textContent.replace(/\s+/g, ' ') };
  }, s2.bUid);
  check(s3.has && s3.n === 2 && s3.dex === 1, `另一台抓的仙子伊布沒有同步過來：${JSON.stringify(s3)}`);
  check(s3.pecha === s2.pecha + 5 && s3.ultra === s2.ultra, `背包不對：桃桃果 ${s2.pecha}→${s3.pecha}（應該 +5）、高級球 ${s2.ultra}→${s3.ultra}（不能變）`);
  check(/和 1 台電腦同步了/.test(s3.status), `同步狀態沒顯示：${s3.status}`);
  // 再同步一次：不能重複加
  await page.click('[data-act="syncnow"]');
  await wait(600);
  const s4 = await page.evaluate(() => ({ n: window.__kalos.game.state.mons.length, pecha: window.__kalos.game.state.bag.berries.pecha }));
  check(s4.n === 2 && s4.pecha === s3.pecha, `同步兩次重複加了：${JSON.stringify(s4)}`);
  await page.evaluate(() => { document.querySelector('fieldset.sync')?.scrollIntoView(); });
  await shot('sync-settings');
  // 停止同步
  await page.click('[data-act="syncstop"]');
  await wait(200);
  await page.click('.modal [data-yes]');
  await wait(300);
  const s5 = await page.evaluate(() => window.__kalos.game.state.sync);
  check(s5 === null, '停止同步後還在同步');
  console.log(JSON.stringify({ medalsUi, w1, w2, s1, s3, s4 }));
});
