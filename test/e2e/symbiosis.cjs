// 共生：你好好生活，就是在養牠們（規則在 core/symbiosis.js，這裡看畫面）
//   1. 連續用電腦 90 分鐘 → 最親近的那隻把樹果放到游標正下方的螢幕下緣，坐在旁邊（不出聲、不跳通知）
//   2. 用真的滑鼠點果實 → 說明「等你休息一下」（不催你）
//   3. 你離開 3 分鐘 → 大家走過去吃掉，每一隻都飽了一點；花草長一級
//   4. 三件好事都做到 → 花草 3 級；過去幾天留下的小花排在下緣
//   5. 昨天熬夜 → 今天早上大家打哈欠、走慢一點；數值一點都沒扣
const { run } = require('./lib.cjs');

const MIN = 60_000;

async function test({ page, shot: rawShot }, check) {
  // 截圖只看這個功能：別的功能的通知、故事的電話先藏起來（它們本身沒有錯）
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); ui.toasts.replaceChildren(); });
    return rawShot(name);
  };
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    game.state.mons[0].affection = 200;
    for (const m of game.state.mons) { m.fullness = 60; m.enjoyment = 60; }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.story.lastAt = Date.now() + 86_400_000; // 故事的電話今天先不要打來（會蓋住畫面）
    ui.holo.el.classList.add('hidden');
    window.__toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (text, o) => { window.__toasts.push(text); return toast(text, o); };
  });
  const setClock = (h, m = 0, dayOffset = 0) => page.evaluate(([h, m, dayOffset]) => {
    const real = window.__realNow(), d = new Date(real); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0);
    window.__clock.offset = d.getTime() - real;
  }, [h, m, dayOffset]);

  // 1) 連續用了 91 分鐘：游標在畫面右邊一點
  await setClock(10, 0);
  await page.mouse.move(820, 300);
  await page.waitForTimeout(200);
  const offered = await page.evaluate(async MIN => {
    const { game, director } = window.__kalos;
    const s = game.state.symbiosis;
    s.streakFrom = Date.now() - 91 * MIN;
    s.lastTickAt = Date.now() - MIN;
    director.setSignals({ ...director.signals, idleSeconds: 0 });
    window.__toasts.length = 0;
    const evs = director.lifeTick();
    const t0 = Date.now();
    while (!director.fruitBy && Date.now() - t0 < 55000) await new Promise(r => setTimeout(r, 100));
    return { evs: evs.map(e => e.type), toasts: [...window.__toasts] };
  }, MIN);
  check(offered.evs.includes('fruitOffered'), `沒有放果實：${JSON.stringify(offered)}`);
  check(!offered.toasts.some(t => /果|休息|吃/.test(t)), `放果實跳了通知（應該安安靜靜）：${offered.toasts}`);
  await page.waitForTimeout(1200);
  const fruit = await page.evaluate(() => {
    const { director, stage } = window.__kalos, f = director.fruitProp, p = stage.pets.get(director.fruitBy);
    return f && { x: f.x, y: f.y, H: stage.H, pointer: stage.pointer.x, by: p && { state: p.state, dx: Math.round(Math.abs(p.x - f.x)), dy: Math.round(Math.abs(p.gy - f.y)), best: p.mon.affection } };
  });
  check(fruit && Math.abs(fruit.x - fruit.pointer) < 60 && fruit.H - fruit.y < 20, `果實不在游標正下方的螢幕下緣：${JSON.stringify(fruit)}`);
  check(fruit?.by && fruit.by.dx < 90 && fruit.by.dy < 20 && fruit.by.state === 'sit' && fruit.by.best === 200, `最親近的那隻沒有坐在果實旁邊：${JSON.stringify(fruit?.by)}`);
  await shot('symbiosis-fruit');

  // 2) 真的用滑鼠點果實
  await page.mouse.move(fruit.x, fruit.y - 6);
  await page.waitForTimeout(150);
  await page.mouse.click(fruit.x, fruit.y - 6);
  await page.waitForTimeout(300);
  const clicked = await page.evaluate(() => window.__toasts.find(t => /休息/.test(t)));
  check(clicked, '點了果實沒有說明');

  // 3) 你離開 3 分鐘多：不用等到整分鐘，訊號一來就吃
  const before = await page.evaluate(() => window.__kalos.game.state.mons.map(m => ({ f: m.fullness, a: m.affection })));
  await page.evaluate(() => {
    const { director, stage } = window.__kalos;
    window.__ate = new Set();
    window.__ateTimer = setInterval(() => { for (const p of stage.pets.values()) if (p.state === 'eat') window.__ate.add(p.uid); }, 50);
    director.setSignals({ ...director.signals, idleSeconds: 200 });
  });
  await page.waitForTimeout(1500);
  const eating = await page.evaluate(() => ({ eaters: window.__kalos.director.fruitEaters?.length ?? 0 }));
  check(eating.eaters >= 2, `沒有大家一起去吃：${JSON.stringify(eating)}`);
  // 第一隻開始吃的畫面
  await page.waitForFunction(() => [...window.__kalos.stage.pets.values()].some(p => p.state === 'eat'), null, { timeout: 50000 }).catch(() => {});
  await shot('symbiosis-eat');
  // 走過去、吃掉（記下誰真的吃了），吃完果實才不見
  const ate = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const t0 = Date.now();
    while (director.fruitEating && Date.now() - t0 < 55000) await new Promise(r => setTimeout(r, 100));
    clearInterval(window.__ateTimer);
    return { gaveUp: director.fruitGaveUp ?? [], ate: window.__ate.size, fruit: game.state.symbiosis.fruit, prop: Boolean(director.fruitProp), mons: game.state.mons.map(m => ({ f: m.fullness, a: m.affection, home: !m.trip })), view: game.symbiosisView() };
  });
  eating.ate = ate.ate; eating.gaveUp = ate.gaveUp;
  check(ate.ate >= 2, `真的走過去吃的不到兩隻：${ate.ate}`);
  check(!ate.fruit && !ate.prop, `果實還在：${JSON.stringify({ fruit: ate.fruit, prop: ate.prop })}`);
  // 自己出門旅行的不在家，吃不到是對的
  check(ate.mons.every((m, i) => !m.home || (m.f > before[i].f && m.a >= before[i].a)), `在家的沒有每一隻都吃到：${JSON.stringify({ before, after: ate.mons })}`);
  check(ate.view.bloom === 1 && ate.view.fruitsToday === 1, `花草沒有長：${JSON.stringify(ate.view)}`);

  // 4) 三件好事都做到 + 過去幾天的小花
  const garden = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const { routineDay } = await import('../../src/core/routine.js');
    director.setSignals({ ...director.signals, idleSeconds: 0 });
    game.startFocus(25);
    game.state.focus.active.startedAt -= 26 * 60_000;
    director.finishFocus();
    const Sym = await import('../../src/core/symbiosis.js');
    const lv = Sym.mark(game.state.symbiosis, Date.now(), 'sleep');
    for (let i = 1; i <= 5; i++) game.state.symbiosis.flowers.push({ day: routineDay(Date.now() - i * 86_400_000), level: 1 + (i % 3) });
    game.state.symbiosis.flowers.sort((a, b) => (a.day < b.day ? -1 : 1));
    director.refreshLife();
    await new Promise(r => setTimeout(r, 4500)); // 慢慢長出來
    return { lv, stats: stage.garden.stats() };
  });
  check(garden.lv === 3 && garden.stats.shown === 3 && garden.stats.tufts === 42 && garden.stats.flowers >= 8 && garden.stats.days === 5, `花草不對：${JSON.stringify(garden)}`);
  await page.mouse.move(640, 200);
  await page.waitForTimeout(300);
  await shot('symbiosis-bloom');

  // 5) 昨天 02:30 才睡 → 今天早上一起累（昨天的紀錄、撥時鐘、tick 在同一個 evaluate：中間 app 自己的每分鐘 tick 不會搶先）
  const morning = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    const { routineDay } = await import('../../src/core/routine.js');
    game.state.routine.days[routineDay(Date.now())] = { first: 300, last: 1290, typing: 0, focus: 25 }; // 今天（作息日）02:30 才睡
    const real = window.__realNow(), d = new Date(Date.now()); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    window.__clock.offset = d.getTime() - real;
    game.tick(); // 一天份的自然消耗先算完（這不是一起累造成的）
    const snap = () => game.state.mons.map(m => [m.affection, m.fullness, m.enjoyment, m.xp]);
    const before = snap();
    director.setSignals({ ...director.signals, idleSeconds: 0 });
    const evs = director.lifeTick().map(e => e.type);
    const after = snap();
    window.__yawned = new Set();
    window.__yawnTimer = setInterval(() => { for (const p of stage.pets.values()) if (p.state === 'stretch') window.__yawned.add(p.uid); }, 50);
    return { evs, tired: stage.env.tired, home: stage.pets.size, before, after, toasts: [...window.__toasts] };
  });
  await page.waitForFunction(() => [...window.__kalos.stage.pets.values()].some(p => p.state === 'stretch'), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(350);
  await shot('symbiosis-tired');
  await page.waitForTimeout(2500);
  morning.stretched = await page.evaluate(() => { clearInterval(window.__yawnTimer); return window.__yawned.size; });
  check(morning.evs.includes('tired') && morning.tired && morning.stretched >= Math.min(2, morning.home), `熬夜隔天沒有一起累：${JSON.stringify({ evs: morning.evs, tired: morning.tired, stretched: morning.stretched })}`);
  check(morning.after.every((m, i) => m.every((v, k) => v >= morning.before[i][k])), `一起累扣了數值：${JSON.stringify({ before: morning.before, after: morning.after })}`);
  check(!morning.toasts.some(t => /熬夜|晚睡|累/.test(t)), `一起累說了責怪的話：${morning.toasts}`);
  // 中午以後恢復
  await setClock(12, 5, 1);
  const noon = await page.evaluate(() => { window.__kalos.director.refreshLife(); return window.__kalos.stage.env.tired; });
  check(noon === false, '中午以後還在累');
  console.log(JSON.stringify({ offered, fruit, eating, garden, morning: { evs: morning.evs, stretched: morning.stretched } }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('symbiosis', test);
