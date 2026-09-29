// 牠們感受得到你的世界（規則在 core/world.js、core/sun.js，這裡看畫面）
//   1. 日落（設定的城市、假時鐘）：沒有視窗 → 排排坐在螢幕下緣；有視窗 → 坐在最上層視窗的頂邊；都面向西邊（左）
//   2. 下雨：沒事做的擠到游標（真的滑鼠）旁邊躲雨；天晴了散開
//   3. 全螢幕（假的視窗矩形）：最大化不算；全螢幕 → 躲到右下角變小、不出聲；退出就回來
//   4. 你不在 10 分鐘：自己玩；你回來：陸續發現（不是同一個畫面），只有最親近的跑過來
const { run } = require('./lib.cjs');

async function test({ page, shot: rawShot }, check) {
  const shot = async name => {
    await page.evaluate(() => { const { ui } = window.__kalos; ui.holo.el.classList.add('hidden'); ui.toasts.replaceChildren(); });
    return rawShot(name);
  };
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    for (const sp of [661, 664, 659]) { const m = game.createMon(sp); m.out = true; m.affection = 100; game.state.mons.push(m); }
    game.state.mons[0].affection = 220;
    game.state.weather = { city: '臺北', lat: 25.033, lon: 121.5654, enabled: true };
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 4 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    game.state.story.lastAt = Date.now() + 86_400_000;
    game.canDepart = () => false; // 這裡不測旅行（出門的會從桌面上消失）
    ui.holo.el.classList.add('hidden');
  });
  // 大家先回到畫面中間、站好
  const settle = () => page.evaluate(async () => {
    const { stage, director } = window.__kalos;
    director.sunsetDay = null;
    let i = 0;
    for (const p of stage.pets.values()) { p.perch = null; p.perchJump = null; p.reserved = false; p.huddling = false; p.sunsetSit = false; p.partner = null; p.group = null; p.onArrive = null; p.x = (300 + i * 180) * stage.dpr; p.gy = 420 * stage.dpr; p.z = 0; p.set('idle', 0.5); i++; }
    await new Promise(r => setTimeout(r, 400));
  });
  // 大家閒著：idle 30（PR-N4b 起 5 秒以內的 idle 是過場，同一幀就挑下一件事；PR-N5 習性一段裡重複做、比較長，常常全部都在忙，沒有閒著的可以被叫去玩）
  const idleAll = () => page.evaluate(() => { for (const p of window.__kalos.stage.pets.values()) if (!['idle', 'walk', 'sit', 'look'].includes(p.state)) { p.partner = null; p.group = null; p.set('idle', 30); } });

  // ---------- 1a) 日落，沒有視窗：螢幕下緣排排坐，面向左 ----------
  await settle();
  await idleAll();
  const sunset = await page.evaluate(async () => {
    const { director, stage } = window.__kalos;
    const { sunTimes } = await import('../../src/core/sun.js');
    const s = sunTimes(25.033, 121.5654, Date.now()).sunset;
    window.__clock.offset = s + 2 * 60_000 - window.__realNow();
    for (const p of stage.pets.values()) if (!p.free) p.set('idle', 0.3);
    await new Promise(r => setTimeout(r, 1300)); // refreshWorld 每秒一次
    const seats = director.sunsetSeats ?? [];
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && [...stage.pets.values()].some(p => p.sunsetSit)) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    const H = stage.pets.values().next().value.bounds().y1;
    return { day: director.sunsetDay, seats: seats.length, onWindow: seats.some(x => x.onWindow), pets: [...stage.pets.values()].filter(p => seats.some(x => x.uid === p.uid)).map(p => ({ st: p.state, facing: p.facing, dy: Math.round(Math.abs(p.gy - H)) })) };
  });
  check(sunset.day && sunset.seats >= 2 && !sunset.onWindow, `日落沒有開始：${JSON.stringify(sunset)}`);
  check(sunset.pets.filter(p => p.st === 'sit' && p.facing === -1 && p.dy < 6).length >= 2, `沒有在下緣面向西邊坐好：${JSON.stringify(sunset.pets)}`);
  await page.mouse.move(640, 150);
  await shot('world-sunset');
  // 同一天不會再來一次
  const again = await page.evaluate(async () => { const { director } = window.__kalos; const before = director.sunsetSeats; await new Promise(r => setTimeout(r, 1200)); return director.sunsetSeats === before; });
  check(again, '同一天日落演了兩次');

  // ---------- 1b) 日落，有視窗：坐在最上層視窗的頂邊 ----------
  await settle();
  await idleAll();
  const onWin = await page.evaluate(async () => {
    const { director, stage, api } = window.__kalos;
    api.emit('windows', [{ hwnd: '1', x: 240, y: 330, w: 800, h: 300, fg: true }]);
    await new Promise(r => setTimeout(r, 100));
    director.sunsetDay = null;
    await new Promise(r => setTimeout(r, 1300));
    const seats = director.sunsetSeats ?? [];
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && [...stage.pets.values()].some(p => p.sunsetSit)) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    return { seats: seats.filter(x => x.onWindow).length, perched: [...stage.pets.values()].filter(p => p.perch?.hwnd === '1' && p.state === 'sit' && p.facing === -1).length, ys: [...stage.pets.values()].map(p => Math.round(p.gy / stage.dpr)) };
  });
  check(onWin.seats >= 3 && onWin.perched >= 3, `沒有坐到視窗頂邊：${JSON.stringify(onWin)}`);
  await shot('world-sunset-window');
  await page.evaluate(() => { const { api, stage } = window.__kalos; api.emit('windows', []); for (const p of stage.pets.values()) { p.perch = null; } window.__clock.offset = 0; });

  // ---------- 2) 下雨：擠到游標旁邊，天晴散開 ----------
  await settle();
  await idleAll();
  await page.mouse.move(640, 300);
  await page.waitForTimeout(100);
  await page.mouse.move(650, 305);
  const rain = await page.evaluate(async () => {
    const { director, stage } = window.__kalos;
    // 不是日落的時間（上午）
    const d = new Date(window.__realNow()); d.setHours(10, 0, 0, 0); window.__clock.offset = d.getTime() - window.__realNow();
    director.setWeather('rain');
    await new Promise(r => setTimeout(r, 1300));
    const uids = director.huddle?.uids ?? [];
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && uids.some(u => ['walk', 'trip'].includes(stage.pets.get(u)?.state))) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    const px = stage.pointer.x, py = stage.pointer.y;
    return { n: uids.length, near: uids.map(u => stage.pets.get(u)).filter(p => p && p.state === 'sit' && Math.hypot(p.x - px, p.gy - py) / stage.dpr < 200).length, log: director.attnLog.filter(e => e.id.startsWith('rain')).map(e => e.granted) };
  });
  check(rain.n >= 2 && rain.near >= 2 && rain.log.includes(true), `下雨沒有擠到游標旁邊：${JSON.stringify(rain)}`);
  await shot('world-rain');
  const clear = await page.evaluate(async () => {
    const { director, stage } = window.__kalos;
    const uids = director.huddle?.uids ?? [];
    director.setWeather(null);
    await new Promise(r => setTimeout(r, 1300));
    return { huddle: director.huddle, sitting: uids.filter(u => stage.pets.get(u)?.huddling).length };
  });
  check(!clear.huddle && clear.sitting === 0, `天晴了還擠在一起：${JSON.stringify(clear)}`);
  // 專注中不躲雨（要經過打擾額度，專注中不放行）
  const focusRain = await page.evaluate(async () => {
    const { director, game } = window.__kalos;
    game.startFocus(25);
    director.setWeather('rain');
    await new Promise(r => setTimeout(r, 1300));
    const uids = director.huddle?.uids ?? [];
    game.state.focus.active = null;
    director.setWeather(null);
    await new Promise(r => setTimeout(r, 1200));
    return uids.length;
  });
  check(focusRain === 0, `專注中還是跑去躲雨：${focusRain}`);

  // ---------- 3) 全螢幕 ----------
  await settle();
  await idleAll();
  const fs = await page.evaluate(async () => {
    const { director, stage, api } = window.__kalos;
    // 螢幕 1280×760，工作列 40 px 在下面；我們的視窗＝工作區 1280×720
    api.emit('screen', { x: 0, y: 0, width: 1280, height: 760 });
    api.emit('windows', [{ hwnd: '9', x: 0, y: 0, w: 1280, h: 720, fg: true }]); // 最大化
    await new Promise(r => setTimeout(r, 1300));
    const maximized = Boolean(director.hushed);
    api.emit('windows', [{ hwnd: '9', x: 0, y: 0, w: 1280, h: 760, fg: true }]); // 全螢幕
    await new Promise(r => setTimeout(r, 1300));
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && [...stage.pets.values()].some(p => ['walk', 'trip', 'idle'].includes(p.state))) await new Promise(r => setTimeout(r, 200)); // 走過去的路上跌倒：站起來繼續走
    await new Promise(r => setTimeout(r, 300));
    const pets = [...stage.pets.values()].map(p => ({ x: Math.round(p.x / stage.dpr), st: p.state }));
    return { maximized, hushed: Boolean(director.hushed), tiny: stage.env.tiny, blocked: director.attentionOpts().blocked, pets };
  });
  check(!fs.maximized, '最大化被當成全螢幕');
  check(fs.hushed && fs.tiny && fs.blocked && fs.pets.every(p => p.x > 1280 - 330 && p.st === 'sit'), `全螢幕沒有躲到角落：${JSON.stringify(fs)}`);
  await shot('world-fullscreen');
  const back = await page.evaluate(async () => {
    const { director, stage, api } = window.__kalos;
    api.emit('windows', []);
    await new Promise(r => setTimeout(r, 1300));
    return { hushed: Boolean(director.hushed), tiny: stage.env.tiny, reserved: [...stage.pets.values()].filter(p => p.reserved).length };
  });
  check(!back.hushed && !back.tiny && back.reserved === 0, `退出全螢幕沒有回來：${JSON.stringify(back)}`);

  // ---------- 4) 你不在：自己玩；你回來：陸續發現 ----------
  await settle();
  await idleAll();
  const away = await page.evaluate(async () => {
    const { director, api } = window.__kalos;
    director.awayPlays = [];
    api.emit('signals', { ...director.signals, idleSeconds: 11 * 60, returnedAt: director.signals.returnedAt });
    await new Promise(r => setTimeout(r, 2300));
    return director.awayPlays.length;
  });
  check(away >= 1, '你不在的時候沒有自己玩');
  await page.evaluate(() => { for (const p of window.__kalos.stage.pets.values()) { p.partner = null; p.group = null; p.set('idle', 5); } });
  const notice = await page.evaluate(async () => {
    const { director, api } = window.__kalos;
    director.greetOrder = null;
    api.emit('signals', { ...director.signals, idleSeconds: 0, returnedAt: Date.now() });
    await new Promise(r => setTimeout(r, 4600));
    const o = director.greetOrder ?? [];
    const at = o.filter(x => x.noticedAt).map(x => x.noticedAt);
    return { n: o.length, runs: o.filter(x => x.run).length, noticed: at.length, spread: at.length ? Math.max(...at) - Math.min(...at) : 0, delays: o.map(x => +x.delay.toFixed(2)) };
  });
  check(notice.n >= 3 && notice.runs === 1 && notice.noticed >= 3 && notice.spread > 300, `回來時的反應太整齊或沒有反應：${JSON.stringify(notice)}`);
  console.log(JSON.stringify({ sunset, onWin, rain, fs: { ...fs, pets: undefined }, away, notice }));
}

test.options = {
  init: () => {
    const real = Date.now.bind(Date);
    window.__realNow = real;
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('world2', test);
