// v3 PR 3：出門旅行——出發（正在玩鬼抓人的會正常結束）→ 走出螢幕 → 紙條 → 快轉 → 走回來 → 收下明信片 → 相簿
const { run } = require('./lib.cjs');

const holdRaf = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__holdRaf ? 0 : raf(cb));
};

const test = async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const id of [653, 656]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
    for (const m of game.state.mons) m.affection = 80;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    window.__holdRaf = true;
    await new Promise(r => setTimeout(r, 100));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: false, hour: 14, focus: null });
  });
  const step = sec => page.evaluate(sec => { const { stage, director } = window.__kalos; for (let i = 0; i < sec * 30; i++) { stage.update(1 / 30); director.update(1 / 30); } }, sec);

  // 1) 三隻在玩鬼抓人，其中一隻出發去旅行：另外兩隻的遊戲要正常結束
  const start = await page.evaluate(async () => {
    const { stage, director, game } = window.__kalos;
    const [a, b, c] = [...stage.pets.values()];
    [a.x, b.x, c.x] = [500, 650, 800]; for (const p of [a, b, c]) { p.gy = 450; p.set('idle', 999); }
    const { groupOptions } = await import('/src/renderer/scene/social.js');
    groupOptions(a, [b, c]).find(o => o[0] === 'oni')[2]();
    for (let i = 0; i < 30; i++) stage.update(1 / 30);
    const inGame = [a, b, c].map(p => p.state);
    const ok = director.sendOnTrip(a.uid);
    return { uid: a.uid, from: { x: a.x, y: a.gy }, inGame, ok, trip: game.mon(a.uid).trip };
  });
  check(start.inGame.every(s => s === 'oni') && start.ok, `鬼抓人沒開始或不能出發：${JSON.stringify(start)}`);
  await step(1);
  const others = await page.evaluate(uid => [...window.__kalos.stage.pets.values()].filter(p => p.uid !== uid).map(p => ({ state: p.state, group: Boolean(p.group) })), start.uid);
  check(others.every(o => o.state !== 'oni' && !o.group), `出發後鬼抓人沒有結束：${JSON.stringify(others)}`);

  // 2) 走到邊邊、揮手、走出去；原本的位置留一張紙條
  let waved = false, gone = false;
  for (let i = 0; i < 30 && !gone; i++) {
    const r = await page.evaluate(uid => { const p = window.__kalos.stage.pets.get(uid); window.__kalos.stage.update(1 / 30); return p ? p.departure?.phase : null; }, start.uid);
    await step(0.5);
    if (r === 'wave') { waved = true; await page.evaluate(() => window.__kalos.stage.draw()); await shot('trip-wave'); }
    gone = !(await page.evaluate(uid => window.__kalos.stage.pets.has(uid), start.uid));
  }
  check(waved && gone, `沒有揮手走出去：waved=${waved} gone=${gone}`);
  await step(1.2);
  const away = await page.evaluate(({ uid, from }) => {
    const { stage, director } = window.__kalos;
    const note = stage.props.find(p => p.kind === 'note');
    note?.onClick();
    return { note: note && { dx: Math.round(note.x - from.x), dy: Math.round(note.y - from.y) }, pets: stage.pets.size, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).at(-1) };
  }, start);
  check(away.note && Math.abs(away.note.dx) < 3 && Math.abs(away.note.dy) < 3, `紙條不在出發的地方：${JSON.stringify(away)}`);
  check(away.pets === 2 && /旅行了，大約/.test(away.toast ?? ''), `旅行中的狀態不對：${JSON.stringify(away)}`);
  await page.evaluate(() => window.__kalos.stage.draw());
  await shot('trip-note');

  // 3) 快轉到回來的時間：從邊邊走進來，頭上頂著明信片；紙條不見了
  await page.evaluate(uid => { const m = window.__kalos.game.mon(uid); m.trip.returnAt = Date.now() - 1000; m.trip.departedAt = Date.now() - 3600_000; }, start.uid);
  await step(1.2);
  await page.waitForTimeout(500); // 等圖片（非同步）
  await step(4);
  const back = await page.evaluate(uid => {
    const { stage, game } = window.__kalos;
    const p = stage.pets.get(uid);
    return { on: Boolean(p), state: p?.state, x: p && p.x / stage.W, status: game.tripStatus(uid), note: stage.props.some(q => q.kind === 'note' && !q.gone && q.life > 0) };
  }, start.uid);
  check(back.on && back.status === 'back' && back.x > 0.02 && back.x < 0.98 && !back.note, `沒有走回來：${JSON.stringify(back)}`);

  // 4) 點牠：收下明信片（禮物進背包）；再點一次不會再拿一次
  const got = await page.evaluate(uid => {
    const { stage, game } = window.__kalos;
    const bag = JSON.stringify(game.state.bag);
    const p = stage.pets.get(uid);
    p.set('idle', 999);
    stage.draw();
    stage.fire('click', p);
    const r = { cards: game.state.postcards.length, bagChanged: JSON.stringify(game.state.bag) !== bag, status: game.tripStatus(uid), modal: document.querySelector('.dialog.postcard')?.textContent.replace(/\s+/g, ' ') };
    return r;
  }, start.uid);
  await shot('trip-postcard');
  Object.assign(got, await page.evaluate(uid => {
    const { stage, game } = window.__kalos;
    const bag2 = JSON.stringify(game.state.bag);
    stage.fire('click', stage.pets.get(uid)); // 再點一次：只是打開一般的選單
    const r = { again: game.state.postcards.length, bagAgain: JSON.stringify(game.state.bag) === bag2 };
    window.__kalos.ui.closeBubble?.();
    return r;
  }, start.uid));
  check(got.cards === 1 && got.bagChanged && got.status === 'home' && /來自.+的明信片/.test(got.modal ?? ''), `沒有收下明信片：${JSON.stringify(got)}`);
  check(got.again === 1 && got.bagAgain, `點第二次又拿了一次：${JSON.stringify(got)}`);

  // 5) 相簿
  await page.evaluate(() => { const { ui } = window.__kalos; ui.modal.classList.add('hidden'); ui.open('album'); });
  await page.waitForTimeout(400);
  const album = await page.evaluate(() => ({ cards: document.querySelectorAll('.album .card').length, summary: document.querySelector('.album .summary')?.textContent }));
  check(album.cards === 1 && /去過 1／12/.test(album.summary ?? ''), `相簿不對：${JSON.stringify(album)}`);
  await shot('trip-album');
  // 夥伴頁：旅行回來以後又可以再去（但同時只有一隻）
  const medal = await page.evaluate(() => Boolean(window.__kalos.game.state.achievements['trip-1']));
  check(medal, '沒有拿到「第一次出遠門」獎章');
  console.log(JSON.stringify({ start: start.inGame, others, away, back, got, album }));
};
test.options = { init: holdRaf };
run('trips', test);
