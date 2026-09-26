// PR 3：五個小遊戲實際玩一遍，並且測每一種結束方式之後，滑鼠都有還給桌面。
// 失敗模式 6：小遊戲關掉後透明視窗還在攔截點擊，使用者的電腦會點不動。
const { run } = require('./lib.cjs');

run('minigames', async ({ page, shot }, check) => {
  const wait = ms => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await ev(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(653);
    game.state.mons[0].affection = 120;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
    director.nextSpawnAt = Infinity; // 測試時不要有野生寶可夢跑出來
  });
  await wait(800);

  // 滑鼠移到桌面上沒有東西的地方，檢查：沒有小遊戲、沒有滑鼠模式、最後一次 setInteractive 是 false
  async function released(label) {
    await page.mouse.move(40, 360);
    await wait(250);
    const r = await ev(() => {
      const { ui, stage, api } = window.__kalos;
      return {
        active: Boolean(ui.minigames.active),
        mode: stage.mode?.type ?? null,
        visible: !ui.minigames.el.classList.contains('hidden'),
        last: api.interactiveCalls.at(-1),
        wants: stage.wantsMouse(),
      };
    });
    check(!r.active && !r.mode && !r.visible && r.last === false && !r.wants, `${label}：結束後滑鼠沒有還給桌面 ${JSON.stringify(r)}`);
  }
  async function openGame(name) {
    await ev(() => window.__kalos.ui.open('play'));
    await wait(300);
    await page.click(`[data-play="${name}"]`);
    await wait(200);
    return ev(n => window.__kalos.ui.minigames.active?.name === n, name);
  }

  // ---------- 1. 摘樹果：完整玩完，按「關閉」 ----------
  check(await openGame('berry'), '摘樹果打不開');
  const berry = await ev(async () => {
    const { ui, stage } = window.__kalos;
    const host = ui.minigames;
    let shotDone = false, clicked = 0;
    for (let f = 0; f < 34 * 20 && host.active && !host.active.done; f++) {
      stage.update(0.05);
      stage.draw();
      const ctl = host.active?.ctl;
      // 一半的樹果在空中就接，剩下的讓它掉到地上再撿
      for (const b of ctl?.berries ?? []) {
        if (b.delay > 0) continue;
        if ((b.landed > 0.3 || (b.vy > 0 && Math.random() < 0.05)) && clicked < 12) { host.click(b.x, b.y - 4 * stage.S); clicked++; break; }
      }
      if (!shotDone && (ctl?.berries?.length ?? 0) >= 3) { shotDone = true; window.__berryShot = true; await new Promise(r => setTimeout(r, 0)); }
      if (f % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { done: host.active?.done, berries: { ...window.__kalos.game.state.bag.berries }, text: host.body.textContent };
  });
  check(berry.done, '摘樹果沒有結束');
  const got = Object.values(berry.berries).reduce((a, b) => a + b, 0);
  check(got >= 6, `只摘到 ${got} 顆樹果`);
  await shot('minigame-berry-result');
  await page.click('.minigame [data-close]');
  await released('摘樹果（按關閉）');

  // 摘樹果的畫面（樹、掉下來的樹果）
  check(await openGame('berry'), '摘樹果第二次打不開');
  await ev(async () => {
    const { stage } = window.__kalos;
    for (let f = 0; f < 120; f++) { stage.update(0.05); if (f % 10 === 0) await new Promise(r => setTimeout(r, 0)); if ((window.__kalos.ui.minigames.active.ctl.berries.filter(b => !b.landed && b.delay <= 0).length) >= 3) break; }
    stage.draw();
  });
  await shot('minigame-berry');
  // 結束方式：右鍵（取消滑鼠模式）
  await page.mouse.click(640, 200, { button: 'right' });
  await released('摘樹果（右鍵）');

  // 結束方式：夥伴被收回球裡
  check(await openGame('berry'), '摘樹果第三次打不開');
  await ev(() => { const { game } = window.__kalos; game.setOut(game.state.mons[0].uid, false); });
  await wait(400);
  await released('摘樹果（夥伴被收回）');
  await ev(async () => {
    const { game, director, stage } = window.__kalos;
    game.setOut(game.state.mons[0].uid, true);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
  });
  await wait(600);

  // ---------- 2. 做泡芙：用真的滑鼠操作 ----------
  await ev(() => { const b = window.__kalos.game.state.bag.berries; b.pecha = Math.max(b.pecha, 3); });
  check(await openGame('bake'), '做泡芙打不開');
  for (let i = 0; i < 3; i++) await page.click('[data-berry="pecha"]');
  await shot('minigame-bake-pick');
  await page.click('[data-go]');
  await wait(200);
  // 攪拌：按住在碗裡穩定地畫圈 5.5 秒
  const box = await page.locator('.minigame canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, R = box.height * 0.3;
  await page.mouse.move(cx + R, cy);
  await page.mouse.down();
  const tStir = Date.now();
  let a = 0;
  while (Date.now() - tStir < 5600) {
    a += 0.25;
    await page.mouse.move(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    await wait(16);
  }
  await page.mouse.up();
  await wait(200);
  const step2 = await ev(() => document.querySelector('.minigame h4')?.textContent);
  check(step2 === '② 烘烤', `攪拌完沒有進到烘烤：${step2}`);
  await shot('minigame-bake-oven');
  // 烘烤：等指針走到最右邊再取出
  for (let i = 0; i < 300; i++) {
    const w = await ev(() => parseFloat(document.querySelector('.minigame .meter i')?.style.width));
    if (w >= 96) break;
    await wait(10);
  }
  await page.click('[data-take]');
  await wait(200);
  // 裝飾：點 5 個分散的點
  const box2 = await page.locator('.minigame canvas').boundingBox();
  const px = (fx, fy) => [box2.x + box2.width / 2 + (fx - 0.5) * 144 * (box2.width / 300) * 1, box2.y + box2.height / 2 + (fy - 0.5) * 144 * (box2.height / 200)];
  for (const [fx, fy] of [[0.2, 0.25], [0.8, 0.25], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]]) { const [x, y] = px(fx, fy); await page.mouse.click(x, y); }
  await wait(150);
  await shot('minigame-bake-deco');
  await page.click('[data-done]');
  await wait(300);
  const bake = await ev(() => ({ text: document.querySelector('.minigame .result')?.textContent ?? '', baked: window.__kalos.game.state.stats.puffsBaked, pecha: window.__kalos.game.state.bag.berries.pecha }));
  check(bake.baked === 1, `沒有做出泡芙：${bake.text}`);
  const total = Number((bake.text.match(/總分\s*(\d+)/) ?? [])[1]);
  check(total >= 60, `照著規則好好做，分數應該不低：${total}（${bake.text}）`);
  console.log('做泡芙：', bake.text.replace(/\s+/g, ' '));
  await shot('minigame-bake-result');
  // 結束方式：Esc
  await page.keyboard.press('Escape');
  await released('做泡芙（Esc）');

  // 做泡芙到一半打開別的視窗
  await ev(() => { const b = window.__kalos.game.state.bag.berries; b.pecha = Math.max(b.pecha, 3); });
  check(await openGame('bake'), '做泡芙第二次打不開');
  await ev(() => window.__kalos.ui.open('party'));
  await wait(200);
  await ev(() => window.__kalos.ui.closePanel());
  await released('做泡芙（中途打開夥伴視窗）');

  // ---------- 3. 頭球：完美的玩家，頂 6 次後故意不點 ----------
  check(await openGame('headit'), '頭球打不開');
  const head = await ev(async () => {
    const { ui, stage } = window.__kalos;
    const host = ui.minigames;
    let shotted = false;
    for (let f = 0; f < 60 * 30 && host.active && !host.active.done; f++) {
      stage.update(1 / 60);
      const ctl = host.active.ctl;
      if (ctl.hot && ctl.streak < 6) host.click(0, 0);
      if (!shotted && ctl.streak === 3) { shotted = true; stage.draw(); window.__headShotNow = true; await new Promise(r => setTimeout(r, 0)); }
      if (f % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { done: host.active?.done, text: host.body.textContent, aff: window.__kalos.game.state.mons[0].affection };
  });
  check(head.done && /連續頂了\s*6\s*次/.test(head.text), `頭球結果不對：${head.text}`);
  check(head.aff >= 126, `頭球好感沒有增加：${head.aff}`);
  await shot('minigame-headit-result');
  await page.click('.minigame .close');
  await released('頭球（按 ✕）');

  // 頭球的畫面
  check(await openGame('headit'), '頭球第二次打不開');
  await ev(async () => { const { stage, ui } = window.__kalos; for (let f = 0; f < 200; f++) { stage.update(1 / 60); if (ui.minigames.active.ctl.hot) { ui.minigames.click(0, 0); if (ui.minigames.active.ctl.streak >= 2) break; } } for (let f = 0; f < 12; f++) stage.update(1 / 60); stage.draw(); });
  await shot('minigame-headit');
  // 結束方式：勿擾模式（系統匣）
  await ev(() => window.__kalos.ui.toggleQuiet(true));
  await wait(300);
  await released('頭球（勿擾模式）');
  await ev(async () => {
    const { ui, stage } = window.__kalos;
    ui.toggleQuiet(false);
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
  });
  await wait(600);

  // ---------- 4. 拼圖：用真的點擊拼回來 ----------
  check(await openGame('puzzle'), '拼圖打不開');
  await page.waitForSelector('.puzzle .tile', { timeout: 15000 });
  await shot('minigame-puzzle');
  const enjoyBefore = await ev(() => window.__kalos.game.state.mons[0].enjoyment);
  for (let guard = 0; guard < 20; guard++) {
    const tiles = await ev(() => window.__kalos.ui.minigames.active?.ctl.tiles);
    if (!tiles) break;
    const i = tiles.findIndex((t, k) => t !== k);
    if (i < 0) break;
    const j = tiles.indexOf(i);
    await page.click(`.puzzle .tile[data-i="${i}"]`);
    await page.click(`.puzzle .tile[data-i="${j}"]`);
  }
  await wait(1200);
  const puzzle = await ev(() => ({ text: window.__kalos.ui.minigames.body.textContent, enjoy: window.__kalos.game.state.mons[0].enjoyment }));
  check(/拼好了/.test(puzzle.text), `拼圖沒完成：${puzzle.text}`);
  check(puzzle.enjoy === Math.min(255, enjoyBefore + 20), `拼圖滿足感：${enjoyBefore} → ${puzzle.enjoy}`);
  await page.click('.minigame [data-close]');
  await released('拼圖（按關閉）');
  // 結束方式：拼到一半按 Esc
  check(await openGame('puzzle'), '拼圖第二次打不開');
  await page.waitForSelector('.puzzle .tile', { timeout: 15000 });
  await page.click('.puzzle .tile[data-i="0"]');
  await page.keyboard.press('Escape');
  await released('拼圖（Esc）');

  // ---------- 5. 超級特訓：點 20 秒氣球 ----------
  check(await openGame('training'), '特訓打不開');
  await page.click('[data-stat="spe"]');
  await wait(200);
  const tBox = await page.locator('.minigame canvas').boundingBox();
  const tEnd = Date.now() + 21500;
  let shotT = false;
  while (Date.now() < tEnd) {
    const target = await ev(() => {
      const ctl = window.__kalos.ui.minigames.active?.ctl;
      if (!ctl || window.__kalos.ui.minigames.active.done) return 'done';
      const b = ctl.balloons.find(x => x.stat === ctl.stat && x.y < 100 && x.y > 5);
      return b ? { x: b.x + 8 + Math.sin(b.wob) * 1.5, y: b.y + 7 } : null;
    });
    if (target === 'done') break;
    if (target) await page.mouse.click(tBox.x + target.x * (tBox.width / 160), tBox.y + target.y * (tBox.height / 110));
    if (!shotT && Date.now() > tEnd - 12000) { shotT = true; await shot('minigame-training'); }
    await wait(60);
  }
  await wait(500);
  const train = await ev(() => ({ text: window.__kalos.ui.minigames.body.textContent, spe: window.__kalos.game.state.mons[0].training.spe }));
  check(train.spe >= 20, `特訓速度只有 ${train.spe}：${train.text}`);
  await shot('minigame-training-result');
  await page.click('.minigame [data-close]');
  await released('超級特訓（按關閉）');

  console.log(JSON.stringify({ berries: berry.berries, bake: bake.text.slice(0, 80), head: head.text.slice(0, 40), puzzle: puzzle.text.slice(0, 40), train: train.text.slice(0, 60) }));
});
