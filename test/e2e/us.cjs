// 心情、里程碑、節日、每週的信（用假時鐘）
//   選單最上面問今天的心情 → 很累：額度降一級、走慢、不跑來玩游標；很開心：大家跳舞；壓力大：好感最高的那隻坐到游標旁
//   認識滿一週 → 里程碑通知、故事頁顯示
//   2026 中秋 → 夥伴頭上有月亮、第一次看到你打招呼
//   週日早上 → 信箱多一封「這週我們一起」
const { run } = require('./lib.cjs');

async function test({ page, shot }, check) {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    game.state.mons[0].affection = 220;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    Object.assign(stage.pointer, { x: stage.W * 0.55, y: stage.H * 0.55, known: true });
    director.signals = { idleSeconds: 0, typing: false };
    window.__toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (text, o) => { window.__toasts.push(text); return toast(text, o); };
  });
  const setClock = (y, mo, d, h, mi = 0) => page.evaluate(([y, mo, d, h, mi]) => {
    window.__clock.offset = new Date(y, mo - 1, d, h, mi).getTime() - window.__realNow();
  }, [y, mo, d, h, mi]);
  await setClock(2026, 9, 21, 10);

  // 1) 選單最上面問心情；選「很累」
  await page.evaluate(() => window.__kalos.ui.toggleMenu(true));
  const ask = await page.evaluate(() => ({ ask: Boolean(document.querySelector('.menu .mood-row .ask')), n: document.querySelectorAll('.menu [data-mood]').length }));
  check(ask.ask && ask.n === 3, `選單沒有問心情：${JSON.stringify(ask)}`);
  await shot('mood-ask');
  await page.click('.menu [data-mood="tired"]');
  const tired = await page.evaluate(() => {
    const { game, director, stage } = window.__kalos;
    game.state.settings.interruptions = '1';
    director.update(0.016);
    return { mood: game.moodToday(), limit: director.attentionOpts().limit, calm: stage.env.calm, noApproach: stage.env.noApproach, row: document.querySelector('.menu .mood-row .today')?.textContent, toast: window.__toasts.at(-1) };
  });
  check(tired.mood === 'tired' && tired.limit === 0 && tired.calm && tired.noApproach, `很累的效果不對：${JSON.stringify(tired)}`);
  check(/很累/.test(tired.row ?? ''), `選過以後沒顯示今天的心情：${JSON.stringify(tired)}`);
  // 之後的通知不要被額度擋住（這裡要測的是心情、里程碑本身；額度在 attention.cjs 測）
  await page.evaluate(() => { window.__kalos.game.state.settings.interruptions = 'unlimited'; for (const p of window.__kalos.stage.pets.values()) p.set('idle', 3); });

  // 2) 改成「很開心」：大家跳舞
  await page.click('.menu [data-moodact="edit"]');
  const freeBefore = await page.evaluate(() => [...window.__kalos.stage.pets.values()].map(p => p.state));
  await page.click('.menu [data-mood="happy"]');
  const happy = await page.evaluate(b => ({ before: b, mood: window.__kalos.game.moodToday(), states: [...window.__kalos.stage.pets.values()].map(p => p.state), dancing: [...window.__kalos.stage.pets.values()].filter(p => p.state === 'dance').length }), freeBefore);
  check(happy.mood === 'happy' && happy.dancing >= 1, `很開心沒有跳舞：${JSON.stringify(happy)}`);
  await page.evaluate(() => window.__kalos.ui.toggleMenu(false));

  // 3) 「壓力大」：好感最高的那隻安靜地坐到游標旁邊（游標停著 8 秒以上）
  await page.mouse.move(700, 400);
  await page.waitForTimeout(9000);
  const stressed = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    for (const p of stage.pets.values()) p.set('idle', 3);
    game.setMood('stressed');
    director.moodT = 100;
    const dbg = { still: stage.pointerStill, known: stage.pointer.known, states: [...stage.pets.values()].map(p => [p.mon.affection, p.state, p.free]) };
    director.moodTick(0.1);
    const uid = director.companion;
    if (!uid) return { dbg };
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && stage.pets.get(uid)?.cursorSit?.seated !== true) await new Promise(r => setTimeout(r, 100));
    const p = stage.pets.get(uid);
    return { uid, best: p?.mon.affection, seated: p?.cursorSit?.seated, state: p?.state };
  });
  check(stressed.best === 220 && stressed.state === 'cursorSit', `壓力大時沒有坐到游標旁：${JSON.stringify(stressed)}`);

  // 4) 認識滿一週：里程碑通知＋故事頁
  const ms = await page.evaluate(async () => {
    const { game, ui } = window.__kalos;
    game.state.together.firstMet = Date.now() - 8 * 86_400_000;
    game.checkTogether(); // game.tick() 在同一瞬間已經跑過一次時會直接跳過，所以直接檢查
    await new Promise(r => setTimeout(r, 200));
    ui.open('story');
    await new Promise(r => setTimeout(r, 300));
    return { saved: game.state.together.milestones.map(m => m.id), toast: window.__toasts.find(t => /認識滿一週/.test(t)), days: document.querySelector('.story .us .days')?.textContent, chips: [...document.querySelectorAll('.story .us .chip')].map(c => c.textContent) };
  });
  check(ms.toast && /第 8 天/.test(ms.days ?? '') && ms.chips.some(c => /認識滿一週/.test(c)), `里程碑不對：${JSON.stringify(ms)}`);
  await shot('us-story');
  await page.evaluate(() => window.__kalos.ui.closePanel());

  // 5) 2026 中秋（9/25）：頭上有月亮、第一次看到你打招呼、第一次一起過節
  await setClock(2026, 9, 25, 20);
  const moon = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    window.__toasts.length = 0;
    const evs = director.routineTick();
    await new Promise(r => setTimeout(r, 300));
    return { evs, deco: stage.env.holidayDeco, toast: window.__toasts.find(t => /中秋/.test(t)), first: game.state.together.milestones.some(m => m.id === 'first-holiday') };
  });
  check(moon.evs.includes('holiday') && moon.deco === 'moon' && moon.toast && moon.first, `中秋不對：${JSON.stringify(moon)}`);
  // 打招呼的表情泡泡消失以後才看得到頭上的月亮（泡泡和裝飾在同一個位置）
  await page.evaluate(() => { for (const p of window.__kalos.stage.pets.values()) p.emote = null; window.__kalos.ui.holo.el.classList.add('hidden'); });
  await page.waitForTimeout(400);
  await shot('us-midautumn');

  // 6) 週日（9/27）早上：「這週我們一起」的信
  await setClock(2026, 9, 27, 9, 30);
  const weekly = await page.evaluate(async () => {
    const { game, ui } = window.__kalos;
    game.state.letters.sent = 2; // 今天的 2 封已經寄完了：每週的信照樣會寄
    game.maybeWeeklyLetter();
    const l = game.state.letters.inbox.find(x => x.kind === 'weekly');
    if (l) ui.showLetter(l);
    await new Promise(r => setTimeout(r, 300));
    return { has: Boolean(l), text: l?.text };
  });
  check(weekly.has && /這週我們一起過了 \d+ 天/.test(weekly.text ?? ''), `每週的信不對：${JSON.stringify(weekly)}`);
  await shot('us-weekly');
  console.log(JSON.stringify({ ask, tired, happy, stressed, ms, moon, weekly }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('us', test);
