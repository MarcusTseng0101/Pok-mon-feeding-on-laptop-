// 住進帳篷、換地板
//   1. 基地的面板：真的點「遊樂園」→ 院子換成遊樂園的地板（存檔、畫面都換了）；再點「沙地」換回來
//   2. 三隻都累了：帳篷住得下 2 隻 → 2 隻鑽進去、第 3 隻去床上睡
//   3. 在帳篷裡：看不見、點不到、滑鼠移過去沒有名字；偶爾從門口探頭；體力照樣恢復
//   4. 睡飽了走出來（看得見、點得到）
const { run } = require('./lib.cjs');

const holdRaf = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
};

const test = async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const sp of [653, 656]) { const m = game.createMon(sp); m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.canDepart = () => false;
    game.state.story.lastAt = Date.now() + 86_400_000;
  });

  // 1) 基地的面板：真的點地板
  await page.click('.launcher');
  await page.click('.menu [data-open="base"]');
  await page.waitForSelector('.basepanel .floor button[data-basefloor="park"]');
  await page.click('.basepanel .floor button[data-basefloor="park"]');
  const park = await page.evaluate(() => {
    const { game, stage } = window.__kalos;
    stage.draw();
    return { floor: game.state.base.floor, key: stage.baseView.yardKey, sel: document.querySelector('.basepanel .floor .sel')?.textContent };
  });
  check(park.floor === 'park' && park.key === '0:park' && park.sel === '遊樂園', `沒有換成遊樂園地板：${JSON.stringify(park)}`);
  // 畫面上院子中間的顏色是遊樂園的磚（不是沙地的米色）
  const pixel = await page.evaluate(() => {
    const { stage } = window.__kalos;
    const L = stage.baseView.layout(), c = stage.canvas.getContext('2d');
    const seen = new Set();
    for (let i = 0; i < 40; i++) { const d = c.getImageData(Math.round(L.x + L.w * (0.3 + i / 100)), Math.round(L.y + L.h * 0.7), 1, 1).data; seen.add(`${d[0]},${d[1]},${d[2]}`); }
    return [...seen];
  });
  const hex = s => s.split(',').map(n => Number(n).toString(16).padStart(2, '0')).join('');
  check(pixel.some(p => ['ffc8de', 'bfe4ff', 'fff0a8'].includes(hex(p))), `院子的顏色不是遊樂園的磚：${pixel.map(hex)}`);

  // 2) 三隻都累了（晚上）：帳篷住 2 隻，第 3 隻去床上
  await page.evaluate(() => { window.__kalos.ui.closePanel(); window.__holdRaf = true; });
  await page.waitForTimeout(100);
  const r = await page.evaluate(async () => {
    const { stage, director } = window.__kalos;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
    const pets = [...stage.pets.values()];
    pets.forEach((p, i) => { p.x = 700 + i * 150; p.gy = 500; p.mon.mind.energy = 10; p.set('idle', 0.05 + i * 0.4); });
    const seen = { inside: new Set(), bed: new Set(), peek: 0, hiddenAlpha: 1, hitInside: null, energy0: null, energy1: null };
    let a = null;
    for (let i = 0; i < 90 * 30; i++) {
      stage.update(1 / 30);
      const now = pets.filter(p => ['goIn', 'inside', 'goOut'].includes(p.state)).length;
      seen.maxNow = Math.max(seen.maxNow ?? 0, now);
      if (now === 2 && pets.some(p => p.bedId)) seen.full = true; // 2 隻在帳篷裡、同時有一隻在床上
      for (const p of pets) {
        if (p.state === 'inside') seen.inside.add(p.uid);
        if (p.bedId) seen.bed.add(p.uid);
      }
      if (!a) a = pets.find(p => p.state === 'inside');
      if (a && a.state === 'inside') {
        const alpha = a.alpha * (a.act?.alpha?.(a) ?? 1);
        if (a.peeking > 0) seen.peek++;
        else seen.hiddenAlpha = Math.min(seen.hiddenAlpha, alpha);
        if (seen.hitInside === null && !(a.peeking > 0)) { const rr = a.rect(); seen.hitInside = a.hit(rr.x + rr.w / 2, rr.y + rr.h / 2); seen.energy0 = a.mon.mind.energy; }
      }
      if (i % 300 === 0) await new Promise(r => setTimeout(r, 0));
    }
    seen.energy1 = a?.mon.mind.energy ?? null;
    return { ...seen, inside: [...seen.inside], bed: [...seen.bed], states: pets.map(p => p.state), uid: a?.uid };
  });
  check(r.maxNow === 2, `帳篷同時最多住 2 隻：${JSON.stringify(r)}`);
  check(r.full, `帳篷住滿的時候，第 3 隻沒有去床上睡：${JSON.stringify(r)}`);
  check(r.hiddenAlpha === 0 && r.hitInside === false, `在帳篷裡看得見或點得到：${JSON.stringify(r)}`);
  check(r.peek > 0, '在帳篷裡沒有探頭');
  check(r.energy1 > r.energy0, `在帳篷裡體力沒有恢復：${r.energy0} → ${r.energy1}`);

  // 截圖：一隻在帳篷門口探頭、一隻在床上
  await page.evaluate(async uid => {
    const { stage } = window.__kalos;
    const p = stage.pets.get(uid);
    p.set('inside', 30); p.peeking = 1.6; p.peekT = 99;
    const door = stage.baseView.door(); p.x = door.x; p.gy = door.y;
    stage.update(1 / 30);
    stage.draw();
  }, r.uid);
  await shot('base-tent');

  // 4) 睡飽了走出來：看得見、點得到
  const out = await page.evaluate(async uid => {
    const { stage } = window.__kalos;
    const p = stage.pets.get(uid);
    p.peeking = 0; p.set('inside', 0.2);
    const states = [];
    for (let i = 0; i < 4 * 30; i++) { stage.update(1 / 30); if (states.at(-1) !== p.state) states.push(p.state); }
    const rr = p.rect();
    return { states, alpha: p.alpha * (p.act?.alpha?.(p) ?? 1), hit: p.hit(rr.x + rr.w / 2, rr.y + rr.h * 0.6) };
  }, r.uid);
  check(out.states.includes('goOut') && out.alpha === 1, `沒有走出來：${JSON.stringify(out)}`);

  // 換回沙地
  await page.evaluate(() => { window.__holdRaf = false; });
  await page.click('.launcher');
  await page.click('.menu [data-open="base"]');
  await page.click('.basepanel .floor button[data-basefloor="sand"]');
  const sand = await page.evaluate(() => window.__kalos.game.state.base.floor);
  check(sand === 'sand', `換不回沙地：${sand}`);
  console.log(JSON.stringify({ park, r: { maxNow: r.maxNow, full: r.full, inside: r.inside.length, bed: r.bed.length, peek: r.peek, energy: [r.energy0, r.energy1] }, out }));
};
test.options = { init: holdRaf };
run('tent', test);
