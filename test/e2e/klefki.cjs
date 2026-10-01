// 鑰圈兒的收藏：找到亮晶晶的東西 → 叼著走回基地門口 → 放進收藏罐（core/base.js 的 trinkets）
//   叼著走的時候嘴邊畫著那個東西、真的往門口走；放進去以後院子裡有收藏罐；真的點選單打開秘密基地，看得到收藏
//   滿了（8 個）就只看看不撿
const { run } = require('./lib.cjs');

const test = async ({ page, shot }, check) => {
  await page.waitForSelector('.modal .starter [data-id="650"]', { timeout: 20000 });
  await page.click('.modal .starter [data-id="650"]');
  await page.waitForFunction(() => window.__kalos.game.state.starterChosen, null, { timeout: 10000 });
  await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const m = game.createMon(707); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (![...stage.pets.values()].some(p => p.mon.species === 707 && p.state !== 'appear') && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    // 不讓外面的事插進來：不出門、不生野生的、白天
    game.canDepart = () => false; director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
  });
  // 準備狀況：讓牠站在畫面右邊、開始「找到了」；要不要叼由遊戲的亂數決定（TRINKET_CHANCE），這裡固定成叼硬幣
  const start = await page.evaluate(async () => {
    const { game, stage } = window.__kalos;
    const { startHabit } = await import('/src/renderer/scene/habits.js');
    const p = [...stage.pets.values()].find(q => q.mon.species === 707);
    for (const q of stage.pets.values()) if (q !== p) { q.x = stage.W * 0.5; q.gy = stage.H * 0.4; q.set('sit', 999); }
    game.trinketToCarry = () => 'coin';
    p.x = stage.W * 0.8; p.gy = stage.H * 0.6;
    startHabit(p, 'keyfound');
    const door = stage.baseView.door();
    return { x: p.x, door, dist: Math.hypot(p.x - door.x, p.gy - door.y) };
  });
  // 叼著走：記下每 0.25 秒的狀態和離門口多遠，直到放進去
  const seen = [];
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => {
      const { game, stage } = window.__kalos, p = [...stage.pets.values()].find(q => q.mon.species === 707), d = stage.baseView.door();
      return { habit: p.state === 'habit' ? p.habitName : p.state, dist: Math.round(Math.hypot(p.x - d.x, p.gy - d.y)), n: game.state.base.trinkets.length };
    });
    seen.push(s);
    if (s.habit === 'keycarry' && !seen.carryShot) { seen.carryShot = true; await page.waitForTimeout(600); await shot('klefki-carry'); }
    if (s.n > 0) break;
    await page.waitForTimeout(250);
  }
  const carried = seen.filter(s => s.habit === 'keycarry');
  check(carried.length >= 2, `沒有叼著走回去：${JSON.stringify(seen.slice(0, 12))}`);
  check(carried.length >= 2 && carried.at(-1).dist < carried[0].dist - 50, `沒有往基地門口走：${JSON.stringify(carried.map(s => s.dist))}`);
  const after = await page.evaluate(() => window.__kalos.game.state.base.trinkets.map(t => t.kind));
  check(after.length === 1 && after[0] === 'coin', `收藏罐裡應該有一個硬幣：${JSON.stringify(after)}`);
  await page.waitForTimeout(800);
  await shot('klefki-jar');

  // 真的點：右下角的選單 → 秘密基地，看得到收藏
  await page.click('.launcher');
  await page.click('.menu [data-open="base"]');
  await page.waitForSelector('.basepanel .trinkets h3', { timeout: 5000 }).catch(() => {});
  const panel = await page.evaluate(() => document.querySelector('.basepanel .trinkets')?.textContent ?? '');
  check(panel.includes('鑰圈兒的收藏（1／8）') && panel.includes('硬幣'), `秘密基地看不到收藏：${panel}`);
  await page.evaluate(() => document.querySelector('.basepanel .trinkets')?.scrollIntoView());
  await page.waitForTimeout(200);
  await shot('klefki-panel');
  await page.click('.window .close');

  // 滿了：再找到也只看看不撿（用遊戲本來的判斷，不固定）
  const full = await page.evaluate(async () => {
    const { game, stage } = window.__kalos;
    delete game.trinketToCarry;
    for (let i = 0; i < 7; i++) game.stashTrinket('marble');
    const { startHabit } = await import('/src/renderer/scene/habits.js');
    const p = [...stage.pets.values()].find(q => q.mon.species === 707);
    startHabit(p, 'keyfound');
    await new Promise(r => setTimeout(r, 4500));
    return { n: game.state.base.trinkets.length, state: p.state === 'habit' ? p.habitName : p.state };
  });
  check(full.n === 8 && full.state !== 'keycarry', `滿了還在叼：${JSON.stringify(full)}`);
  console.log(JSON.stringify({ start, carried: carried.map(s => s.dist), after, panel, full }));
};

run('klefki', test);
