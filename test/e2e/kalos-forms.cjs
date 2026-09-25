// PR 2：卡洛斯形態的畫面
// 1. 野生的花蓓蓓帶著花色出現，抓到後花色跟著、圖鑑可以切換花色
// 2. 多麗米亞在夥伴面板修剪
// 3. 蒂安希超級進化：換圖、圖變大後不會跟旁邊的夥伴重疊、不會跑出螢幕、不會存進存檔；對戰結束變回來
// 4. 甲賀忍蛙牽絆變身
const { run } = require('./lib.cjs');

run('kalos-forms', async ({ page, shot }, check) => {
  const wait = ms => page.waitForTimeout(ms);
  const setup = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(656);
    ui.modal.classList.add('hidden');
    // 1) 野生藍花花蓓蓓 → 抓到
    const plan = { speciesId: 669, form: 'blue', spot: 'grass', shiny: false, nature: 'hardy', special: false };
    await director.spawn(plan);
    const spot = stage.spot;
    director.beginEncounter(spot);
    const wildKey = window.__kalos.stage.wild.asset && (await import('/src/core/forms.js')).spriteKey(669, stage.wild.enc.form);
    const wildFallback = stage.wild.asset.fallback;
    const wild = director.enc.wild;
    game.state.bag.balls.ultra = 99;
    let r;
    for (let i = 0; i < 60 && !r?.caught && !wild.gone; i++) r = game.throwBall(wild, 'ultra', 2.5);
    return { wildKey, wildFallback, caught: Boolean(r?.caught), form: r?.mon?.form, dexForms: game.state.dex[669].forms };
  });
  check(setup.wildKey === '669-blue', `野生花蓓蓓的圖是 ${setup.wildKey}`);
  check(setup.wildFallback === false, '野生花蓓蓓顯示替代圖');
  check(setup.caught && setup.form === 'blue', `抓到的花色是 ${setup.form}`);
  check(setup.dexForms?.blue?.caught === 1, `圖鑑沒記到藍花：${JSON.stringify(setup.dexForms)}`);

  // 圖鑑：再看過一隻白花，切換到白花
  await page.evaluate(async () => {
    const { game, director, ui } = window.__kalos;
    director.endEncounter?.('test');
    game.markSeen(669, 'white');
    ui.selectedDex = 669;
    ui.open('dex');
  });
  await wait(600);
  await page.click('[data-dexform="white"]');
  await wait(800);
  const dexView = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.formchip')].map(c => c.textContent.trim()), sel: document.querySelector('.formchip.sel')?.textContent }));
  check(dexView.sel === '白花', `圖鑑選到的是 ${dexView.sel}`);
  check(dexView.chips.filter(c => c === '？').length === 3, `圖鑑花色格子：${dexView.chips.join(',')}`);
  await page.evaluate(() => { const e = document.querySelector('.dex .entry'); e.scrollTop = e.scrollHeight; });
  await shot('dex-forms');

  // 2) 多麗米亞美容
  const trim = await page.evaluate(async () => {
    const { game, ui } = window.__kalos;
    const m = game.createMon(676);
    game.state.mons.push(m);
    ui.selectedUid = m.uid;
    ui.trimOpen = true;
    ui.open('party');
    return m.uid;
  });
  await wait(1200);
  await page.evaluate(() => { const e = document.querySelector('.party .detail'); e.scrollTop = e.scrollHeight; });
  const styleButtons = await page.evaluate(() => [...document.querySelectorAll('[data-style]')].map(b => { const r = b.getBoundingClientRect(); return { s: b.dataset.style, h: Math.round(r.height), label: b.textContent.trim() }; }));
  check(styleButtons.length === 9, `造型按鈕有 ${styleButtons.length} 個`);
  check(styleButtons.every(b => b.h >= 50 && b.label), `造型按鈕被壓扁或沒有名稱：${JSON.stringify(styleButtons)}`);
  await shot('furfrou-trim');
  await page.click('[data-style="pharaoh"]');
  await wait(300);
  const trimmed = await page.evaluate(uid => {
    const m = window.__kalos.game.mon(uid);
    return { form: m.form, trimAt: m.trimAt, affection: m.affection };
  }, trim);
  check(trimmed.form === 'pharaoh' && trimmed.trimAt > 0 && trimmed.affection === 10, `修剪後 ${JSON.stringify(trimmed)}`);

  // 3) 超級蒂安希：旁邊擠滿夥伴，變大後要推開、不跑出螢幕
  const mega = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    const T = await import('/src/renderer/scene/battleforms.js');
    ui.closePanel?.();
    for (const m of game.state.mons) m.out = false;
    const d = game.createMon(719); d.out = true; d.pos = { x: 0.98, y: 0.99 }; // 塞在右下角
    const f = game.createMon(673); f.out = true; f.pos = { x: 0.95, y: 0.99 }; // 坐騎山羊：夠高，跟漂浮的蒂安希在同一個高度範圍（矮的會從下面穿過去，那是對的）
    game.state.mons.push(d, f);
    stage.pets.clear();
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    const dp = stage.pets.get(d.uid), fp = stage.pets.get(f.uid);
    for (const p of [dp, fp]) p.set('idle', 99);
    dp.alt = 28; // 飄浮高度本來是隨機的（24–64）；固定在跟坐騎山羊重疊的高度，這樣才真的在測碰撞
    fp.x = dp.x; fp.gy = dp.gy;
    const before = { w: dp.asset.w, h: dp.asset.h };
    const noStone = await T.transform(dp, 'mega') && false; // 還沒有進化石也可以直接呼叫；UI 會擋
    await T.revert(dp); for (let i = 0; i < 40; i++) stage.update(0.05);
    // 正式流程：好感滿 → 拿到進化石 → 超級進化
    d.affection = 250; d.fullness = 0; game.state.bag.puffs['sweet-deluxe'] = 3;
    game.feed(d.uid, 'sweet-deluxe');
    const stone = game.state.bag.items.diancite;
    await T.transform(dp, 'mega');
    let bad = 0;
    const track = [];
    for (let i = 0; i < 60; i++) {
      stage.update(0.05); stage.draw();
      if (i % 10 === 0) track.push([Math.round(dp.x), Math.round(dp.gy), Math.round(fp.x), Math.round(fp.gy), dp.alt, fp.alt, dp.state, fp.state]);
      const r = dp.rect();
      if (r.x < -2 || r.x + r.w > stage.W + 2 || r.y < -2 || dp.gy > stage.H + 2) bad++;
    }
    const nd = Math.hypot((fp.x - dp.x) / ((dp.asset.w + fp.asset.w) * 0.35 * stage.S), (fp.gy - dp.gy) / ((dp.asset.w + fp.asset.w) * 0.35 * stage.S * 0.45));
    const after = { w: dp.asset.w, h: dp.asset.h, key: dp.spriteKey, fallback: dp.asset.fallback };
    stage.storePositions();
    const saved = JSON.parse(JSON.stringify(game.state)).mons.find(m => m.uid === d.uid).form;
    return { before, after, stone, bad, nd, saved, uid: d.uid, noStone, track, W: stage.W, H: stage.H };
  });
  check(mega.stone === true, '好感滿了沒拿到進化石');
  check(mega.after.key === '10075' && !mega.after.fallback, `超級進化的圖：${JSON.stringify(mega.after)}`);
  check(mega.after.h > mega.before.h, `超級進化沒有變大：${mega.before.h} → ${mega.after.h}`);
  check(mega.bad === 0, `超級進化後跑出螢幕 ${mega.bad} 幀`);
  check(mega.nd >= 0.9, `超級進化後跟旁邊的坐騎山羊重疊（距離 ${mega.nd.toFixed(2)}）`);
  check(mega.saved === null, `超級進化被寫進存檔：${mega.saved}`);
  await shot('mega-diancie');

  // 對戰中的超級進化：開始時變身，結束時變回來
  const duel = await page.evaluate(async uid => {
    const { stage } = window.__kalos;
    const M = await import('/src/renderer/scene/moves.js');
    const T = await import('/src/renderer/scene/battleforms.js');
    const dp = stage.pets.get(uid);
    await T.revert(dp);
    for (let i = 0; i < 40; i++) stage.update(0.05);
    const other = [...stage.pets.values()].find(p => p !== dp);
    for (const p of [dp, other]) { p.set('idle', 99); p.partner = null; }
    dp.x = 500; dp.gy = 450; other.x = 640; other.gy = 450;
    const opts = M.moveOptions(dp, [other]);
    opts.find(o => o[0] === 'duel')[2]();
    let megaDuring = false;
    for (let i = 0; i < 20 * 40 && (dp.duel || dp.state === 'approach' || i < 40); i++) {
      stage.update(0.05);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0)); // 讓圖片載入的 promise 有機會完成（真的畫面是一幀一幀跑的）
      if (dp.battleForm === 'mega') megaDuring = true;
    }
    for (let i = 0; i < 60; i++) stage.update(0.05);
    return { megaDuring, after: dp.battleForm ?? null };
  }, mega.uid);
  check(duel.megaDuring, '對戰中沒有超級進化');
  check(duel.after === null, `對戰結束後還是 ${duel.after}`);

  // 4) 牽絆甲賀忍蛙：條件符合時，對戰幾次一定會觸發；圖換成 10117
  const ash = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const M = await import('/src/renderer/scene/moves.js');
    for (const m of game.state.mons) m.out = false;
    const g = game.createMon(658); g.out = true; g.affection = 255; g.pos = { x: 0.4, y: 0.6 };
    const f = game.createMon(656); f.out = true; f.pos = { x: 0.55, y: 0.6 };
    game.state.mons.push(g, f);
    game.bond(g.uid, f.uid, 220);
    stage.pets.clear();
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    const gp = stage.pets.get(g.uid), fp = stage.pets.get(f.uid);
    await stage.sprites.get('10117');
    let transformed = false, duels = 0;
    for (; duels < 25 && !transformed; duels++) {
      for (const p of [gp, fp]) { p.set('idle', 99); p.partner = null; p.duel = null; }
      gp.x = 500; gp.gy = 450; fp.x = 640; fp.gy = 450;
      M.moveOptions(gp, [fp]).find(o => o[0] === 'duel')[2]();
      for (let i = 0; i < 20 * 40 && (gp.duel || gp.state === 'approach' || i < 40); i++) {
        stage.update(0.05);
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
        if (gp.battleForm === 'ash') { transformed = true; if (!window.__ashShot) { window.__ashShot = 1; for (let k = 0; k < 30; k++) stage.update(0.05); stage.draw(); break; } }
      }
    }
    return { transformed, duels, key: gp.spriteKey };
  });
  check(ash.transformed, `對戰 ${ash.duels} 次都沒有牽絆變身`);
  await shot('ash-greninja');
  console.log(JSON.stringify({ setup, dexView, trimmed, mega, duel, ash }));
});
