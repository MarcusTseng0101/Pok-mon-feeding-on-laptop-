// 卡洛斯旅行（手機遊戲 src/journey）：手機大小的瀏覽器，全部用真的點擊玩一輪
// 開場 → 選夥伴 → 走 2 號道路（野生的削血、丟球抓、訓練家）→ 換帶頭 → 背包用傷藥 → 圖鑑
// → 重新打開還在 → 離開 20 小時再打開：夥伴找到東西、不會少任何東西
// 假時鐘 window.__clock、固定亂數 window.__seed、丟球的圈固定 window.__ring；圖片從 .cache/sprites 來（lib.cjs）
const { ROOT, serve, loadPlaywright, fetchSprite } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const NAME = 'journey';
const T0 = new Date(2026, 9, 14, 10, 0).getTime();

async function main() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(t0 => {
    const off = Number(localStorage.getItem('__clockOffset') ?? 0);
    window.__clock = () => t0 + off;
    window.__seed = 12345;
    window.__ring = 0.3;
  }, T0);
  await context.route('https://raw.githubusercontent.com/PokeAPI/**', async route => {
    const rel = new URL(route.request().url()).pathname.replace(/^.*\/sprites\/pokemon\//, '');
    const file = /^(back\/)?(shiny\/)?\d{3,5}\.png$/.test(rel) ? await fetchSprite(rel) : null;
    if (file) await route.fulfill({ path: file, contentType: 'image/png' });
    else await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `${base}/src/journey/index.html`;
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('kalos-journey') ?? 'null'));
  const shot = name => page.screenshot({ path: path.join(ROOT, 'docs/screens', `${name}.png`) });
  const msgVisible = () => page.locator('#msg').isVisible();
  const lines = [];
  // 對話框一直點到消失（最多 n 句），記下每一句
  async function tapThrough(n = 40) {
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(160);
      if (!(await msgVisible())) return;
      lines.push(await page.locator('#msgText').textContent());
      await page.locator('#msg').click();
    }
  }
  // 對戰：野生的沒抓過就先打一下再丟球，不然一直用第一招
  let caughtTries = 0, sawBattle = false;
  async function fightOut() {
    for (let i = 0; i < 60; i++) {
      await tapThrough();
      if (!(await page.locator('.battle').count())) return;
      if (!sawBattle) { sawBattle = true; await shot('journey-battle'); }
      if (await page.locator('.actions.list .mon').count()) { await page.locator('.actions.list .mon:not([disabled])').first().click(); continue; }
      const wild = await page.locator('.battle.k-wild').count();
      const foeHp = await page.evaluate(() => parseFloat(document.querySelector('#foe-hp i')?.style.width ?? '100'));
      const caught = await page.locator('.side.foe small', { hasText: '抓過了' }).count();
      if (wild && !caught && foeHp < 100 && caughtTries < 8) {
        caughtTries++;
        await page.locator('#b-bag').click();
        const ball = page.locator('.actions.list .item[data-item="poke"]');
        if (await ball.count()) {
          await ball.click();
          await page.locator('#ringwrap').click();
          continue;
        }
        await page.locator('#b-cancel').click();
      }
      await page.locator('.move').first().click();
    }
  }

  try {
    await page.goto(url);
    await page.waitForSelector('#msg:not([hidden])');
    await tapThrough(4);
    await page.waitForSelector('.starter');
    await shot('journey-starters');
    await page.locator('.starter[data-species="653"]').click();
    await tapThrough();
    let s = await state();
    check(s?.party?.[0]?.species === 653, `沒有選到火狐狸：${JSON.stringify(s?.party)}`);

    // 往前到 2 號道路，一直走到底
    await page.locator('#forward').click();
    await tapThrough();
    check((await page.locator('#where').textContent()) === '2 號道路', '沒有到 2 號道路');
    for (let i = 0; i < 12; i++) {
      s = await state();
      if (s.at !== 'route2' || s.node >= 5) break;
      await page.locator('#walk').click();
      await page.waitForTimeout(150);
      await fightOut();
    }
    s = await state();
    check(sawBattle, '整條路都沒有遇到對戰');
    check(s.beaten.includes('route2#3') || s.at === 'aquacorde', `2 號道路的訓練家沒打：${JSON.stringify(s.beaten)}`);
    check(lines.some(l => /使出了/.test(l)), '對話裡沒有出招');
    const caughtN = Object.values(s.dex).filter(d => d.caught).length;
    check(caughtN >= 2 || lines.some(l => /丟出了/.test(l)), `沒有丟過球：${lines.filter(l => /球|抓/.test(l)).join('｜')}`);
    await shot('journey-route');

    // 隊伍：有兩隻以上就換帶頭
    await page.locator('#nav-party').click();
    const mons = page.locator('.party .mon');
    if ((await mons.count()) >= 2) {
      const uid = await mons.nth(1).getAttribute('data-uid');
      await mons.nth(1).click();
      s = await state();
      check(String(s.party[0].uid) === uid, '點了沒有換帶頭');
    }
    await shot('journey-party');
    await page.locator('#close').click();

    // 背包：給帶頭的用傷藥（有受傷、有藥才用）
    await page.locator('#nav-bag').click();
    const use = page.locator('.bag .use:not([disabled])').first();
    if (await use.count()) {
      const before = (await state()).party[0].hp;
      await use.click();
      await tapThrough();
      check((await state()).party[0].hp > before, '用了傷藥沒有恢復');
    }
    await page.locator('#close').click();

    await page.locator('#nav-dex').click();
    check((await page.locator('.dex .cell.caught').count()) === caughtN, '圖鑑抓到的數量對不上');
    await shot('journey-dex');
    await page.locator('#close').click();

    // 重新打開：存檔還在
    const kept = await state();
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === '1' || !document.querySelector('#msg').hidden);
    await tapThrough();
    check((await page.locator('#where').textContent()) === J_ZH(kept.at), '重新打開不在原來的地方');

    // 離開 20 小時：夥伴找到東西，擁有的只會多
    const before = await state();
    await page.evaluate(ms => localStorage.setItem('__clockOffset', String(ms)), 20 * 3600_000);
    await page.reload();
    await page.waitForSelector('#msg:not([hidden])');
    const greetLines = [];
    for (let i = 0; i < 6 && (await msgVisible()); i++) { greetLines.push(await page.locator('#msgText').textContent()); await page.locator('#msg').click(); await page.waitForTimeout(160); }
    check(greetLines.some(l => /你不在的時候/.test(l)), `離開 20 小時沒有禮物：${greetLines.join('｜')}`);
    const after = await state();
    const items = st => Object.values(st.bag).reduce((a, b) => a + b, 0);
    check(items(after) > items(before) && after.party.length === before.party.length, '離開以後東西變少了');
    await shot('journey-area');
    check(!errors.length, `console 有錯誤：${errors.slice(0, 3).join(' | ')}`);
  } catch (err) {
    problems.push(err.stack ?? String(err));
    try { fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true }); await page.screenshot({ path: path.join(ROOT, '.cache', `fail-${NAME}.png`) }); } catch { /* 已經關了 */ }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(problems.length ? `FAIL ${NAME}: ${problems.join('; ')}` : `PASS ${NAME}`);
  process.exitCode = problems.length ? 1 : 0;
}

const J_ZH = id => ({ aquacorde: '亞連鎮', route2: '2 號道路', forest: '白檀森林', route3: '3 號道路', santalune: '白檀市' })[id];

main();
