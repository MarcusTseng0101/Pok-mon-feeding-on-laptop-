// 選單：真的用滑鼠點右下角的精靈球，再點選單裡的每一個按鈕 → 都要打開對應的面板
// （其他測試大多直接呼叫 ui.open()，這裡確保畫面上的按鈕本身是接好的）
const { run } = require('./lib.cjs');

run('menu', async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
  });
  const panels = await page.$$eval('.menu [data-open]', bs => bs.map(b => [b.dataset.open, b.textContent]));
  check(panels.length >= 10, `選單按鈕太少：${JSON.stringify(panels)}`);
  const broken = [];
  for (const [id, label] of panels) {
    if (await page.$eval('.menu', m => m.classList.contains('hidden'))) await page.click('.launcher');
    await page.waitForTimeout(100);
    await page.click(`.menu [data-open="${id}"]`);
    await page.waitForTimeout(250);
    const open = await page.evaluate(() => {
      const w = document.querySelector('.window');
      return { shown: !w.classList.contains('hidden'), title: w.querySelector('.title').textContent, body: w.querySelector('.body').children.length };
    });
    if (!open.shown || !open.title || !open.body) broken.push({ id, label, ...open });
    if (id === 'settings') {
      const phone = await page.$('.window fieldset.phone');
      if (!phone) broken.push({ id, label, missing: '在手機上看' });
      await shot('menu-settings');
    }
    await page.click('.window .close');
    await page.waitForTimeout(100);
  }
  check(broken.length === 0, `這些選單按鈕打不開：${JSON.stringify(broken)}`);
  // 心情那一排：點了之後選單還在、心情有記下來
  await page.click('.launcher');
  await page.waitForTimeout(100);
  const moodBtn = await page.$('.menu .mood-row [data-mood]');
  if (moodBtn) {
    await moodBtn.click();
    await page.waitForTimeout(150);
    const mood = await page.evaluate(() => window.__kalos.game.state.mood?.log?.length ?? 0);
    check(mood >= 1, '點了心情沒有記下來');
  }
  console.log(JSON.stringify({ panels: panels.map(p => p[0]), broken }));
});
