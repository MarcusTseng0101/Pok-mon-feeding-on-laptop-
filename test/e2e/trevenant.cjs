// 朽木妖讓小夥伴站在頭上：朽木妖伸根鬚（站著不動）時，附近小隻的夥伴走過去、蹲一下跳上頭頂，站著左右看；
//   朽木妖伸完根鬚要走了 → 跳下來；真的用滑鼠把朽木妖拎起來 → 頭上的掉下來
const { run } = require('./lib.cjs');

const test = async ({ page, shot }, check) => {
  await page.waitForSelector('.modal .starter [data-id="650"]', { timeout: 20000 });
  await page.click('.modal .starter [data-id="650"]');
  await page.waitForFunction(() => window.__kalos.game.state.starterChosen, null, { timeout: 10000 });
  await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const m = game.createMon(709); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (![...stage.pets.values()].some(p => p.mon.species === 709 && p.state !== 'appear') && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    game.canDepart = () => false; director.nextSpawnAt = Infinity; director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
  });
  // 準備狀況：朽木妖站在中間開始伸根鬚，哈力栗在旁邊閒著。有沒有夥伴跳上來是遊戲的亂數（HEAD_GUEST_CHANCE），沒有就再伸一次
  const climb = async () => {
    for (let i = 0; i < 10; i++) {
      const got = await page.evaluate(async () => {
        const { stage } = window.__kalos;
        const { startHabit } = await import('/src/renderer/scene/habits.js');
        const t = [...stage.pets.values()].find(p => p.mon.species === 709), c = [...stage.pets.values()].find(p => p.mon.species === 650);
        t.x = stage.W * 0.5; t.gy = stage.H * 0.75; t.partner = null; c.partner = null; c.z = 0;
        c.x = stage.W * 0.3; c.gy = stage.H * 0.75; c.set('idle', 999);
        startHabit(t, 'roots');
        await new Promise(r => setTimeout(r, 1500));
        return c.state === 'habit' && c.habitName === 'climbHead';
      });
      if (got) return true;
    }
    return false;
  };
  check(await climb(), '朽木妖伸了 10 次根鬚，都沒有夥伴跳上來');
  // 等牠站上去：腳（畫出來的圖的下緣）要在朽木妖的圖上緣附近
  let on = null;
  for (let i = 0; i < 60 && !on; i++) {
    await page.waitForTimeout(250);
    on = await page.evaluate(() => {
      const { stage } = window.__kalos, t = [...stage.pets.values()].find(p => p.mon.species === 709), c = [...stage.pets.values()].find(p => p.mon.species === 650);
      if (!(c.state === 'habit' && c.habitName === 'headSit')) return null;
      const rt = t.rect(), rc = c.rect(), d = stage.dpr;
      return { feet: Math.round((rc.y + rc.h) / d), treeTop: Math.round(rt.y / d), treeH: Math.round(rt.h / d), dx: Math.round((c.x - t.x) / d), front: c.gy > t.gy };
    });
  }
  check(on, '沒有站上朽木妖的頭');
  if (on) {
    check(on.feet > on.treeTop && on.feet < on.treeTop + on.treeH * 0.35 && Math.abs(on.dx) < 4, `站的位置不在頭頂：${JSON.stringify(on)}`);
    check(on.front, '站在頭上的應該畫在朽木妖前面');
  }
  await page.waitForTimeout(500);
  await shot('trevenant-head');

  // 真的用滑鼠把朽木妖拎起來：頭上的掉下來（點朽木妖身體下半部，不是頭上那隻）
  const pt = await page.evaluate(() => {
    const { stage } = window.__kalos, t = [...stage.pets.values()].find(p => p.mon.species === 709), r = t.rect(), d = stage.dpr;
    for (let v = 0.85; v > 0.5; v -= 0.05) for (const u of [0.5, 0.45, 0.55, 0.4, 0.6]) { const x = r.x + r.w * u, y = r.y + r.h * v; if (stage.petAt(x, y) === t) return { x: x / d, y: y / d }; }
    return null;
  });
  check(pt, '點不到朽木妖');
  if (pt) {
    await page.mouse.move(pt.x, pt.y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(pt.x + i * 4, pt.y - i * 8); await page.waitForTimeout(30); }
    await page.waitForTimeout(300);
    const held = await page.evaluate(() => { const { stage } = window.__kalos, t = [...stage.pets.values()].find(p => p.mon.species === 709), c = [...stage.pets.values()].find(p => p.mon.species === 650); return { tree: t.state, guest: c.state === 'habit' ? c.habitName : c.state }; });
    check(held.tree === 'held' && held.guest !== 'headSit', `拎起朽木妖時頭上的沒有下來：${JSON.stringify(held)}`);
    await page.mouse.up();
  }
  await page.waitForTimeout(2500);
  const landed = await page.evaluate(() => { const c = [...window.__kalos.stage.pets.values()].find(p => p.mon.species === 650); return { z: c.z, state: c.state, partner: Boolean(c.partner) }; });
  check(landed.z === 0 && !landed.partner, `掉下來以後沒有落地：${JSON.stringify(landed)}`);

  // 朽木妖伸完根鬚要走了：頭上的自己跳下來
  check(await climb(), '第二次沒有夥伴跳上來');
  let sat = false;
  for (let i = 0; i < 60 && !sat; i++) { await page.waitForTimeout(250); sat = await page.evaluate(() => { const c = [...window.__kalos.stage.pets.values()].find(p => p.mon.species === 650); return c.state === 'habit' && c.habitName === 'headSit'; }); }
  check(sat, '第二次沒有站上去');
  const off = await page.evaluate(async () => {
    const { stage } = window.__kalos, t = [...stage.pets.values()].find(p => p.mon.species === 709), c = [...stage.pets.values()].find(p => p.mon.species === 650);
    t.stateT = t.dur; // 讓牠伸完根鬚（時間到）
    await new Promise(r => setTimeout(r, 3000));
    return { tree: t.state === 'habit' ? t.habitName : t.state, guest: c.state === 'habit' ? c.habitName : c.state, z: c.z, partners: [Boolean(t.partner), Boolean(c.partner)] };
  });
  check(off.guest !== 'headSit' && off.z === 0 && !off.partners[0] && !off.partners[1], `朽木妖走了，頭上的沒有下來：${JSON.stringify(off)}`);
  console.log(JSON.stringify({ on, landed, off }));
};

run('trevenant', test);
