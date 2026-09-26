// v3 PR 4：秘密基地
//   空地、帳篷點不到（滑鼠穿透），家具點得到；擺放模式放一張床、搬動桌子
//   把一隻的體力設成 10 → 牠走去床上睡；晚上大家回基地睡
const { run } = require('./lib.cjs');

const holdRaf = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
};

const test = async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    const m = game.createMon(653); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    window.__holdRaf = true;
    await new Promise(r => setTimeout(r, 100));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
    for (const p of stage.pets.values()) { p.x = 800; p.gy = 400; p.set('idle', 999); }
    Object.assign(game.state.bag.materials, { wood: 30, cloth: 30, stone: 10, shiny: 5 });
  });
  const step = sec => page.evaluate(sec => { const { stage, director } = window.__kalos; for (let i = 0; i < sec * 30; i++) { stage.update(1 / 30); director.update(1 / 30); } }, sec);
  // 某一格的中心（CSS 像素）
  const cellCss = (x, y) => page.evaluate(([x, y]) => { const { stage } = window.__kalos; const r = stage.baseView.cellRect(x, y); return { x: (r.x + r.w / 2) / stage.dpr, y: (r.y + r.h / 2) / stage.dpr }; }, [x, y]);
  const grabs = async pt => { await page.mouse.move(pt.x, pt.y); return page.evaluate(() => { window.__kalos.stage.update(1 / 30); return window.__kalos.stage.wantsMouse(); }); };

  // 1) 滑鼠：空地和帳篷點不到，家具（一開始的小床）點得到
  const empty = await grabs(await cellCss(5, 2));
  const tent = await page.evaluate(() => { const { stage } = window.__kalos; const L = stage.baseView.layout(); return { x: (L.x + 30 * stage.S) / stage.dpr, y: (L.y - 10 * stage.S) / stage.dpr }; });
  const overTent = await grabs(tent);
  const overBed = await grabs(await cellCss(0, 1));
  check(!empty && !overTent, `基地的空地或帳篷攔截了滑鼠：空地 ${empty}、帳篷 ${overTent}`);
  check(overBed, '家具點不到');

  // 2) 擺放模式：放一張桌子；搬動它
  await page.evaluate(() => window.__kalos.director.startBasePlace('table'));
  await page.mouse.click((await cellCss(3, 0)).x, (await cellCss(3, 0)).y);
  const placed = await page.evaluate(() => { const { game, stage } = window.__kalos; return { items: game.state.base.items.map(i => `${i.kind}@${i.x},${i.y}`), mode: stage.mode?.type ?? null, wood: game.state.bag.materials.wood }; });
  check(placed.items.includes('table@3,0') && !placed.mode && placed.wood === 27, `沒有放好桌子：${JSON.stringify(placed)}`);
  // 點桌子 → 搬到 (5,2)
  await page.mouse.click((await cellCss(3, 0)).x, (await cellCss(3, 0)).y - 2);
  const moving = await page.evaluate(() => window.__kalos.stage.mode);
  await page.mouse.click((await cellCss(5, 2)).x, (await cellCss(5, 2)).y);
  const moved = await page.evaluate(() => window.__kalos.game.state.base.items.map(i => `${i.kind}@${i.x},${i.y}`));
  check(moving?.type === 'base' && moving.moveId && moved.includes('table@5,2'), `搬動桌子失敗：${JSON.stringify({ moving, moved })}`);
  // 放不下的地方：不會放、也不會離開擺放模式
  await page.evaluate(() => window.__kalos.director.startBasePlace('bed'));
  await page.mouse.click((await cellCss(0, 1)).x, (await cellCss(0, 1)).y);
  const blocked = await page.evaluate(() => ({ n: window.__kalos.game.state.base.items.length, mode: window.__kalos.stage.mode?.type }));
  check(blocked.n === 2 && blocked.mode === 'base', `放在別的家具上：${JSON.stringify(blocked)}`);
  await page.mouse.click((await cellCss(0, 2)).x, (await cellCss(0, 2)).y);
  await page.mouse.move(640, 200);

  // 3) 體力 10 → 走去床上睡
  const slept = await page.evaluate(async () => {
    const { stage, game } = window.__kalos;
    const [a] = [...stage.pets.values()];
    a.mon.mind.energy = 10;
    a.set('idle', 0.05);
    let sawBed = null;
    for (let i = 0; i < 60 * 30 && !sawBed; i++) {
      stage.update(1 / 30);
      if (a.state === 'sleep' && a.bedId) sawBed = { bed: a.bedId, x: a.x, gy: a.gy };
      if (i % 300 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const bed = sawBed && game.state.base.items.find(i => i.id === sawBed.bed);
    const spot = bed && stage.baseView.spotOf(bed);
    return { sawBed, dist: spot ? Math.hypot(spot.x - sawBed.x, spot.y - sawBed.gy) : null, thoughts: a.mon.mind.thoughts.map(t => t.key) };
  });
  check(slept.sawBed && slept.dist < 5, `體力 10 沒有去床上睡：${JSON.stringify(slept)}`);
  check(slept.thoughts.some(k => k.startsWith('base.')), `沒有「回基地」的想法：${slept.thoughts}`);

  // 4) 晚上：大家回基地睡
  const night = await page.evaluate(async () => {
    const { stage } = window.__kalos;
    Object.assign(stage.env, { sleepy: true, hour: 23 });
    const pets = [...stage.pets.values()];
    pets.forEach((p, i) => { p.bedId = null; p.x = 900 + i * 120; p.gy = 380; p.set('idle', 0.05 + i * 0.3); });
    for (let i = 0; i < 70 * 30; i++) { stage.update(1 / 30); if (i % 300 === 0) await new Promise(r => setTimeout(r, 0)); }
    return pets.map(p => ({ home: stage.baseView.contains(p.x, p.gy, 20 * stage.S), state: p.state }));
  });
  check(night.every(p => p.home && ['sleep', 'nap'].includes(p.state)), `晚上沒有回基地睡：${JSON.stringify(night)}`);
  await page.evaluate(() => window.__kalos.stage.draw());
  await shot('base-night');
  await page.evaluate(() => window.__kalos.ui.open('base'));
  await page.waitForTimeout(400);
  await shot('base-panel');
  console.log(JSON.stringify({ empty, overTent, overBed, placed, moved, slept, night }));
};
test.options = { init: holdRaf };
run('base', test);
