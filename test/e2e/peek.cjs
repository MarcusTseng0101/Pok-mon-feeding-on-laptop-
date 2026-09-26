// v3 PR 2：野生寶可夢從螢幕邊緣探頭
//   慢慢靠近、停在旁邊 → 牠走進桌面，接著是一般的遭遇
//   衝太快 → 嚇跑（還沒開始遭遇，不會中斷連鎖），氣息點消失、排下一次
//   頻率：跟一般氣息點共用出現時間，30 次裡探頭最多 1/3
const { run } = require('./lib.cjs');

const holdRaf = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
};

const PLAN = { speciesId: 659, form: null, spot: 'peek', shiny: false, nature: 'hardy', special: false }; // 掘掘兔

const test = async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    window.__holdRaf = true;
    await new Promise(r => setTimeout(r, 100));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
  });
  const step = sec => page.evaluate(sec => { const { stage } = window.__kalos; for (let i = 0; i < sec * 30; i++) stage.update(1 / 30); }, sec);
  // 生出一個探頭的，回傳牠露出來的那一半在哪裡（CSS 像素）
  const spawnPeek = () => page.evaluate(async plan => {
    const { director, stage } = window.__kalos;
    director.endEncounter?.(); stage.wild = null; stage.spot = null;
    await director.spawn(plan);
    const s = stage.spot;
    for (let i = 0; i < 30; i++) stage.update(1 / 30); // 探出頭來
    const r = s.rect();
    return { side: s.side, x: (r.x + r.w / 2) / stage.dpr, y: (r.y + r.h / 2) / stage.dpr, kind: s.constructor.name };
  }, PLAN);

  // 1) 慢慢靠近 → 走進來
  const p1 = await spawnPeek();
  check(p1.kind === 'PeekSpot', `沒有生出探頭的：${p1.kind}`);
  const noticed = await page.evaluate(() => { const p = [...window.__kalos.stage.pets.values()][0]; return { mem: p.mon.memory.map(e => e.k), thought: p.thought?.text }; });
  check(noticed.mem.includes('saw-peeker') && /探頭|在看|邊邊/.test(noticed.thought ?? ''), `夥伴沒有注意到：${JSON.stringify(noticed)}`);
  const inward = p1.side < 0 ? 1 : -1;
  const start = { x: p1.x + inward * 260, y: p1.y };
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(200);
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(start.x - inward * i * 8.4, start.y); // 每次 8 像素、間隔 60ms：大約 140 像素／秒
    await page.waitForTimeout(60);
    await step(0.06);
  }
  await page.waitForTimeout(200);
  await step(2.2);
  const come = await page.evaluate(() => { const { director, stage } = window.__kalos; return { enc: Boolean(director.enc), wild: stage.wild?.state, spot: Boolean(stage.spot) }; });
  check(come.enc && !come.spot, `慢慢靠近沒有走進來：${JSON.stringify(come)}`);
  await step(0.5);
  await page.evaluate(() => window.__kalos.stage.draw());
  await shot('peek-come');
  await step(1);
  const walked = await page.evaluate(() => { const { stage } = window.__kalos; return { state: stage.wild?.state, x: stage.wild?.x / stage.dpr }; });
  check(walked.state === 'idle' && walked.x > 40 && walked.x < 1240, `沒有走進桌面：${JSON.stringify(walked)}`);

  // 2) 衝太快 → 嚇跑
  const p2 = await spawnPeek();
  await page.evaluate(() => window.__kalos.stage.draw());
  await page.mouse.move(p2.x + (p2.side < 0 ? 1 : -1) * 400, p2.y);
  await page.waitForTimeout(300);
  await shot('peek');
  await page.mouse.move(p2.x + (p2.side < 0 ? 1 : -1) * 20, p2.y, { steps: 3 });
  await step(0.1);
  await step(1);
  const scared = await page.evaluate(() => {
    const { director, stage } = window.__kalos;
    return { enc: Boolean(director.enc), spot: Boolean(stage.spot), next: director.nextSpawnAt < Infinity, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') };
  });
  check(!scared.enc && !scared.spot && scared.next, `衝太快沒有嚇跑：${JSON.stringify(scared)}`);
  check(/嚇跑了/.test(scared.toasts), `沒有「嚇跑了」的提示：${scared.toasts}`);

  // 3) 探頭的點不到：游標停在牠身上也不會讓視窗攔截滑鼠
  const p3 = await spawnPeek();
  await page.mouse.move(p3.x, p3.y);
  await page.evaluate(() => { const { stage } = window.__kalos; stage.update(1 / 30); });
  const grab = await page.evaluate(() => window.__kalos.stage.wantsMouse());
  check(!grab, '游標停在探頭的寶可夢身上時攔截了滑鼠');

  // 4) 頻率：一般的出現流程跑 30 次，探頭最多 1/3，而且不會連續
  const freq = await page.evaluate(async () => {
    const { director, stage } = window.__kalos;
    director.sprites.get = async () => {}; // 不用真的載圖
    const kinds = [];
    for (let i = 0; i < 30; i++) {
      director.endEncounter?.(); stage.wild = null; stage.spot = null;
      await director.spawn();
      kinds.push(stage.spot?.constructor.name === 'PeekSpot' ? 'peek' : 'spot');
    }
    stage.spot = null;
    return kinds;
  });
  const peeks = freq.filter(k => k === 'peek').length;
  const adjacent = freq.some((k, i) => k === 'peek' && (freq[i + 1] === 'peek' || freq[i + 2] === 'peek'));
  check(peeks <= 10 && peeks >= 1 && !adjacent, `探頭的頻率不對：${peeks}/30 ${freq.join(',')}`);
  console.log(JSON.stringify({ p1, noticed, come, walked, scared, peeks }));
};
test.options = { init: holdRaf };
run('peek', test);
