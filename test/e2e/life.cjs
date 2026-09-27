// 牠們自己的生活（規則在 core/life.js，這裡看畫面）
//   1. 手機頁面（真的小網站）：午餐時間，每隻寫著現在在做什麼，跟電腦算的一樣（F20），至少一隻在吃東西（F34）
//   2. 手機連不到電腦了：過 30 分鐘，牠們照樣過日子（照生活表換成下一件事）
//   3. 桌面：快轉 10 分鐘，至少有一次自己喝水、看書或吃東西，旁邊擺著杯子、書、碗；沒有任何通知（F35）
const { run, ROOT } = require('./lib.cjs');
const path = require('node:path');

const MIN = 60_000;

async function test({ page, shot: rawShot }, check) {
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); });
    return rawShot(name);
  };
  const setup = await page.evaluate(async MIN => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 80; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.story.lastAt = Date.now() + 86_400_000;
    // 把時鐘撥到今天（當地）的午餐時間，找第一格有夥伴在吃東西的（core/life.js 的分布另外有單元測試）
    const lunch = new Date(Date.now()); lunch.setHours(12, 0, 0, 0);
    let at = null;
    for (let t = lunch.getTime() + 5 * MIN; t < lunch.getTime() + 60 * MIN && at === null; t += 10 * MIN) if (game.homeMons().some(m => game.lifeAt(m.uid, t) === 'eat')) at = t;
    if (at !== null) window.__clock.offset += at - Date.now();
    await ui.setPhone(true);
    return { at, acts: game.homeMons().map(m => ({ uid: m.uid, name: game.displayName(m), act: game.lifeAt(m.uid) })) };
  }, MIN);
  check(setup.at !== null, '午餐時間沒有任何一隻在吃東西');

  // 1) 手機頁面：真的小網站，手機的時鐘跟電腦一樣（都撥到午餐時間）
  const snap = await page.evaluate(() => window.__kalos.director.pushPhone());
  const { createPhoneServer } = await import(path.join(ROOT, 'src/main/phone.js'));
  const dir = path.join(ROOT, 'src/phone');
  const server = createPhoneServer({ getSnapshot: () => snap, files: { '': path.join(dir, 'index.html'), 'phone.js': path.join(dir, 'phone.js'), 'phone.css': path.join(dir, 'phone.css'), 'font.woff2': path.join(ROOT, 'src/renderer/fonts/Cubic_11.woff2') } });
  const [u] = await server.start([{ address: '127.0.0.1', tailscale: false }], 39500 + Math.floor(Math.random() * 400));
  const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await phone.addInitScript(at => { const real = Date.now.bind(Date); const off = at - real(); window.__phoneClock = { off }; Date.now = () => real() + window.__phoneClock.off; }, setup.at + 30_000);
  const errors = [];
  phone.on('pageerror', e => errors.push(e.message));
  phone.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const ZH = { sleep: '在睡覺', nap: '在打盹', drink: '在喝水', eat: '在吃東西', read: '在看書', play: '在玩', wander: '在散步' };
  let later = null;
  try {
    await phone.goto(u.url);
    await phone.waitForSelector('section.pets .pet .act', { timeout: 10000 });
    const seen = await phone.$$eval('section.pets .pet', ps => ps.map(p => ({ name: p.querySelector('b').textContent, act: p.querySelector('.act')?.textContent, anim: p.querySelector('img')?.className })));
    for (const a of setup.acts) {
      const s = seen.find(x => x.name === a.name);
      check(s && s.act === ZH[a.act], `手機上${a.name}的生活跟電腦不一樣：手機「${s?.act}」、電腦「${ZH[a.act]}」`);
      check(s && /do-/.test(s.anim ?? ''), `手機上${a.name}的小圖沒有動作：${s?.anim}`);
    }
    check(seen.some(s => s.act === '在吃東西'), `午餐時間手機上沒有一隻在吃東西：${JSON.stringify(seen)}`);
    await phone.screenshot({ path: path.join(ROOT, 'docs/screens/life-phone.png') });

    // 2) 連不到電腦了：過 30 分鐘，照生活表換成下一件事（跟電腦在那個時間算的一樣）
    await server.stop();
    await phone.evaluate(() => { window.__phoneClock.off += 30 * 60_000; load(); });
    await phone.waitForFunction(() => /連不到電腦/.test(document.querySelector('.status').textContent), null, { timeout: 5000 });
    later = await phone.$$eval('section.pets .pet', ps => ps.map(p => ({ name: p.querySelector('b').textContent, act: p.querySelector('.act')?.textContent })));
    const expect = await page.evaluate(t => window.__kalos.game.homeMons().map(m => ({ name: window.__kalos.game.displayName(m), act: window.__kalos.game.lifeAt(m.uid, t) })), setup.at + 30_000 + 30 * MIN);
    for (const e of expect) check(later.find(x => x.name === e.name)?.act === ZH[e.act], `斷線 30 分鐘後${e.name}應該${ZH[e.act]}：${JSON.stringify(later)}`);
    check(errors.filter(e => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(e)).length === 0, `手機頁面有錯誤：${errors}`);
  } finally {
    await phone.close();
    await server.stop().catch(() => {});
  }

  // 3) 桌面：快轉 10 分鐘（固定 dt，時鐘跟著走），牠們自己喝水、看書、吃東西；沒有通知
  const desk = await page.evaluate(async () => {
    const { director, stage, ui } = window.__kalos;
    window.__holdRaf = true;
    await new Promise(r => setTimeout(r, 100));
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 12, focus: null });
    const toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (t, o) => { toasts.push(t); return toast(t, o); };
    stage.lifeLog = [];
    const DT = 1 / 30, steps = Math.round(600 / DT);
    let props = 0;
    for (let i = 0; i < steps; i++) {
      window.__clock.offset += DT * 1000;
      stage.update(DT);
      if (i % 30 === 0) props = Math.max(props, stage.props.filter(p => p.lifeItem && !p.gone).length);
      if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
    }
    ui.toast = toast;
    return { log: stage.lifeLog, props, toasts };
  });
  check(desk.log.length >= 1 && desk.props >= 1, `10 分鐘裡沒有自己喝水、看書、吃東西：${JSON.stringify(desk)}`);
  // 撥時鐘會換日，每日禮物是另一件事（不是生活的演出）
  const lifeToasts = desk.toasts.filter(t => !/^每日禮物/.test(t));
  check(lifeToasts.length === 0, `自己的生活不該跳通知：${lifeToasts}`);
  const perPet = {};
  for (const l of desk.log) perPet[`${l.uid}:${l.name}`] = (perPet[`${l.uid}:${l.name}`] ?? 0) + 1;
  check(Object.values(perPet).every(n => n <= 2), `同一隻 10 分鐘內同一件事做太多次：${JSON.stringify(perPet)}`);

  // 截圖：一隻在看書、一隻在喝水（直接叫出動作，只為了截圖）
  await page.evaluate(async () => {
    const { stage } = window.__kalos;
    const { startLifeAct } = await import('/src/renderer/scene/lifeacts.js');
    const [a, b] = [...stage.pets.values()];
    for (const [p, x] of [[a, 520], [b, 820]]) { p.endPlay?.(); p.group = null; p.partner = null; p.perch = null; p.x = x; p.gy = 520; p.facing = 1; }
    startLifeAct(a, 'read', 30);
    startLifeAct(b, 'sip', 30);
    window.__holdRaf = false;
    await new Promise(r => setTimeout(r, 1200));
  });
  await shot('life-desk');
  console.log(JSON.stringify({ at: new Date(setup.at).toTimeString().slice(0, 5), acts: setup.acts.map(a => a.act), later: later?.map(l => l.act), desk: desk.log.map(l => l.name) }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => (window.__holdRaf ? setTimeout(() => window.requestAnimationFrame(cb), 50) : raf(cb));
  },
};

run('life', test);
