// 學會作息：用假時鐘
//   早上 08:00、上一次用電腦是 5 小時前 → 夥伴跑過來說早安（經過打擾額度）
//   深夜 01:10 還在用電腦 → 大家打哈欠，最喜歡你的那隻走到游標旁邊坐下
//   今天專注加起來超過兩小時 → 番茄鐘結束後大家一起跳舞慶祝
//   專注中不會有晚睡的反應
const { run } = require('./lib.cjs');

async function test({ page, shot }, check) {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    game.state.mons[0].affection = 200;
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.settings.interruptions = '1';
    Object.assign(stage.pointer, { x: stage.W * 0.6, y: stage.H * 0.5, known: true });
    director.signals = { idleSeconds: 0, typing: false };
    window.__toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (text, o) => { window.__toasts.push(text); return toast(text, o); };
  });
  // 把假時鐘撥到今天的 hh:mm（當地時間）
  const setClock = (h, m = 0) => page.evaluate(([h, m]) => {
    const real = window.__realNow(), d = new Date(real); d.setHours(h, m, 0, 0);
    window.__clock.offset = d.getTime() - real;
    window.__kalos.game.state.attention.granted = [];
    window.__kalos.director.attnQueue = []; // 前一段排隊中的（例如每日禮物）不要佔掉這一段的額度
  }, [h, m]);

  // 1) 早安
  await setClock(8, 0);
  const greet = await page.evaluate(() => {
    const { game, director, stage } = window.__kalos;
    game.state.routine.lastActiveAt = Date.now() - 5 * 3_600_000;
    const evs = director.routineTick();
    const again = director.routineTick();
    return { evs, again, toast: window.__toasts.find(t => /早安/.test(t)), following: [...stage.pets.values()].filter(p => p.state === 'follow').length };
  });
  check(greet.evs.includes('greet') && greet.toast && greet.following >= 1, `早安不對：${JSON.stringify(greet)}`);
  check(!greet.again.includes('greet'), '同一個早上打了兩次招呼');
  await page.waitForTimeout(600);
  await shot('routine-morning');

  // 2) 專注中到了半夜：不會有晚睡的反應
  await setClock(1, 10);
  const inFocus = await page.evaluate(() => {
    const { game, director } = window.__kalos;
    game.state.focus.active = { startedAt: Date.now(), minutes: 25 };
    window.__toasts.length = 0;
    director.bedtimePet = null;
    director.bedtime();
    const r = { toasts: [...window.__toasts], pet: director.bedtimePet };
    game.state.focus.active = null;
    return r;
  });
  check(inFocus.toasts.length === 0 && !inFocus.pet, `專注中還是有晚睡的反應：${JSON.stringify(inFocus)}`);

  // 3) 晚睡（資料不夠 7 天：01:00 以後就算）
  const night = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.state.routine.bedtime = null;
    // （PR-B 以後）「第一次一起熬夜」的里程碑比晚睡的反應優先，會先用掉這小時的額度（us.cjs 測）；這裡只看晚睡
    if (game.state.together) game.state.together.milestones.push({ id: 'late-night', at: Date.now() });
    window.__toasts.length = 0;
    const evs = director.routineTick();
    await new Promise(r => setTimeout(r, 300));
    const yawns = [...stage.pets.values()].filter(p => p.emote?.img === undefined ? false : p.state === 'stretch').length;
    return { evs, toast: window.__toasts.find(t => /早點休息/.test(t)), pet: director.bedtimePet, yawns };
  });
  check(night.evs.includes('bedtime') && night.toast && night.pet, `晚睡的反應不對：${JSON.stringify(night)}`);
  // 走到了、坐下的那一刻（之後可能被別隻找去玩，那沒關係）
  await page.waitForFunction(() => window.__kalos.director.bedtimeSat, null, { timeout: 20000 }).catch(() => {});
  const sat = await page.evaluate(uid => {
    const { stage, director } = window.__kalos, s = director.bedtimeSat, p = stage.pets.get(uid);
    return s ? { same: s.uid === uid, d: Math.round(Math.hypot(s.x - stage.pointer.x, s.y - stage.pointer.y) / stage.dpr), best: p?.mon.affection }
      : { none: true, state: p?.state, t: p?.target && Math.round(Math.hypot(p.target.x - p.x, p.target.y - p.gy) / stage.dpr), known: stage.pointer.known, log: director.attnLog.slice(-4).map(e => [e.id, e.granted]) };
  }, night.pet);
  check(sat && !sat.none && sat.same && sat.d < 200 && sat.best === 200, `最喜歡你的那隻沒有坐到游標旁邊：${JSON.stringify(sat)}`);
  await shot('routine-bedtime');

  // 4) 專注兩小時：已經專注 100 分鐘，再完成一段 25 分鐘 → 慶祝
  await setClock(15, 0);
  const focus = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const { routineDay } = await import('../../src/core/routine.js');
    const day = routineDay(Date.now());
    game.state.routine.days[day] = { ...(game.state.routine.days[day] ?? { first: 0, last: 0, typing: 0 }), focus: 100 };
    game.state.routine.focusDone = null;
    game.state.focus.active = { startedAt: Date.now() - 26 * 60_000, minutes: 25 };
    window.__toasts.length = 0;
    director.finishFocus();
    await new Promise(r => setTimeout(r, 3000));
    return { log: director.attnLog.slice(-6).map(e => [e.id, e.granted]), queue: (director.attnQueue ?? []).map(q => q.id), toasts: [...window.__toasts], toast: window.__toasts.find(t => /兩小時/.test(t)), dancing: [...stage.pets.values()].filter(p => p.state === 'dance').length };
  });
  check(focus.toast && focus.dancing >= 1, `專注兩小時沒有慶祝：${JSON.stringify(focus)}`);
  await shot('routine-focus');
  console.log(JSON.stringify({ greet, inFocus, night, sat, focus }));
}

test.options = {
  budget: true,
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('routine', test);
