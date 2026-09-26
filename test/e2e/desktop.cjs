// PR 4：番茄鐘、打字反應、孵蛋
const { run } = require('./lib.cjs');

run('desktop', async ({ page, shot }, check) => {
  const wait = ms => page.waitForTimeout(ms);
  await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(653);
    for (const id of [656, 659]) { const m = game.createMon(id, {}); m.affection = 120; m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50));
  });
  await wait(1000);
  await page.evaluate(() => { window.__kalos.ui.modal.classList.add('hidden'); });

  // ---------- 1. 番茄鐘：從選單開始 ----------
  await page.click('.launcher');
  await wait(200);
  await page.click('.menu [data-act="focus"]');
  await wait(300);
  const f1 = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    const quiet = ['idle', 'sit', 'sleep', 'look', 'appear', 'happy', 'stretch']; // stretch：坐完站起來伸懶腰，不會移動
    const bad = new Set();
    director.nextSpawnAt = 0; // 本來馬上就會有野生的：專注中不能出現
    for (let f = 0; f < 60 * 20; f++) {
      director.update(0.05);
      stage.update(0.05);
      for (const p of stage.pets.values()) if (!quiet.includes(p.state)) bad.add(p.state);
      if (f % 40 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { active: Boolean(game.state.focus.active), minutes: game.state.focus.active?.minutes, env: stage.env.focus, hud: !ui.focusHud.classList.contains('hidden') && ui.focusHud.textContent, spot: Boolean(stage.spot), bad: [...bad] };
  });
  check(f1.active && f1.minutes === 25 && f1.env, `專注沒開始：${JSON.stringify(f1)}`);
  check(/專注中 2[45]:\d\d/.test(f1.hud), `剩餘時間沒顯示：${f1.hud}`);
  check(!f1.spot, '專注中出現了野生寶可夢');
  check(f1.bad.length === 0, `專注中夥伴做了不安靜的事：${f1.bad}`);
  await shot('focus');
  // 時間到（把開始時間往前調，跟電腦睡了 25 分鐘回來一樣）
  const f2 = await page.evaluate(async () => {
    const { game, director, ui } = window.__kalos;
    const puffs = () => Object.values(game.state.bag.puffs).reduce((a, b) => a + b, 0);
    const before = puffs(), aff = game.state.mons.map(m => m.affection);
    game.state.focus.active.startedAt -= 25 * 60_000;
    director.update(0.05);
    ui.update();
    return { active: game.state.focus.active, sessions: game.state.focus.sessions, puffs: puffs() - before, aff: game.state.mons.map((m, i) => m.affection - aff[i]), hud: ui.focusHud.classList.contains('hidden'), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') };
  });
  check(f2.active === null && f2.sessions === 1 && f2.puffs === 1, `專注完成沒有獎勵：${JSON.stringify(f2)}`);
  check(f2.aff.every(d => d === 5), `外出夥伴好感沒有 +5：${f2.aff}`);
  check(f2.hud, '專注結束後剩餘時間還在');
  check(/專注 25 分鐘完成/.test(f2.toast), `沒有完成的提示：${f2.toast}`);
  // 中途放棄
  const f3 = await page.evaluate(() => { const { ui, game } = window.__kalos; ui.startFocus(); ui.stopFocus(); return { active: game.state.focus.active, sessions: game.state.focus.sessions }; });
  check(f3.active === null && f3.sessions === 1, `放棄後狀態不對：${JSON.stringify(f3)}`);

  // ---------- 2. 打字反應：只看 signals（不讀鍵盤） ----------
  await page.mouse.move(640, 300);
  await wait(200);
  const typing = await page.evaluate(async () => {
    const { director, stage, api } = window.__kalos;
    for (const p of stage.pets.values()) { p.set('idle', 1); p.x = 150 + Math.random() * 200; p.gy = 600; }
    api.emit('signals', { idleSeconds: 0, cpu: 0.1, typing: true, typingSeconds: 45, inputActive: true, activeSeconds: 60 });
    director.typingCooldown = 0;
    // 記錄每一隻離游標最近的距離（圍觀完會自己走開，所以不能只看最後）
    const closest = new Map();
    for (let f = 0; f < 20 * 20; f++) {
      director.update(0.05); stage.update(0.05);
      for (const p of stage.pets.values()) closest.set(p, Math.min(closest.get(p) ?? 1e9, Math.hypot(p.x - stage.pointer.x, p.gy - stage.pointer.y)));
      if (f % 40 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const sent = director.typingWatchers ?? [];
    const near = sent.filter(uid => closest.get(stage.pets.get(uid)) < 110 * stage.S);
    // 冷卻中不會再跑過來
    const cd = director.typingCooldown - Date.now();
    // 失敗時看得出是哪一隻、最近到多近、後來在做什麼
    const detail = sent.map(uid => { const p = stage.pets.get(uid); return { d: Math.round((closest.get(p) ?? 0) / stage.S), state: p?.state, thought: p?.thought?.key }; });
    return { near: near.length, sent: sent.length, cd, detail };
  });
  check(typing.sent >= 1 && typing.sent <= 2 && typing.near === typing.sent, `打字時叫了 ${typing.sent} 隻過來，真的走到游標旁邊的有 ${typing.near} 隻：${JSON.stringify(typing.detail)}`);
  check(typing.cd > 60_000, '沒有冷卻時間');
  await shot('typing');

  // ---------- 3. 孵蛋 ----------
  const egg = await page.evaluate(async () => {
    const { game, api } = window.__kalos;
    api.emit('signals', { idleSeconds: 0, cpu: 0.1, typing: false, typingSeconds: 0 });
    const [a, b] = game.state.mons.filter(m => m.out);
    game.bond(a.uid, b.uid, 230);
    let e = null;
    for (let i = 0; i < 30 && !e; i++) { game.state.eggDay = null; e = game.maybeFindEgg(); }
    return e && { species: e.species, need: e.need };
  });
  check(egg, '最好的朋友在桌面上，30 次機會都沒找到蛋');
  // 用真的滑鼠移動游標，步數要增加
  for (let i = 0; i < 60; i++) await page.mouse.move(200 + (i % 2) * 800, 200 + (i % 3) * 150, { steps: 4 });
  const steps = await page.evaluate(() => { const { director, game } = window.__kalos; director.tickEggs(10); return game.state.eggs[0].steps; });
  check(steps >= 30, `游標移動後步數只有 ${steps}`);
  // 快孵化了 → 出現在桌面上 → 點它
  await page.evaluate(() => { const { game } = window.__kalos; const e = game.state.eggs[0]; e.steps = e.need - 0.5; game.addEggSteps(1000, 0); });
  await wait(300);
  const prop = await page.evaluate(() => { const p = window.__kalos.stage.props.find(x => x.kind === 'egg'); return p && p.rect(); });
  check(prop, '好了的蛋沒有出現在桌面上');
  await shot('egg');
  const before = await page.evaluate(() => window.__kalos.game.state.mons.length);
  await page.mouse.move(prop.x + prop.w / 2, prop.y + prop.h / 2);
  await wait(100);
  await page.mouse.down();
  await page.mouse.up();
  await wait(1600);
  await shot('egg-hatching');
  await wait(2500);
  const hatched = await page.evaluate(() => {
    const { game, stage } = window.__kalos;
    const m = game.state.mons.at(-1);
    const p = stage.pets.get(m.uid);
    return { n: game.state.mons.length, species: m.species, onDesk: stage.pets.has(m.uid), eggs: game.state.eggs.length, stat: game.state.stats.eggsHatched, props: stage.props.filter(q => q.kind === 'egg').length, at: p && [Math.round(p.x), Math.round(p.gy)] };
  });
  const eggAt = [prop.x + prop.w / 2, prop.y + prop.h];
  check(hatched.at && Math.hypot(hatched.at[0] - eggAt[0], hatched.at[1] - eggAt[1]) < 120, `孵出來的位置 ${hatched.at} 離蛋 ${eggAt} 太遠`);
  check(hatched.n === before + 1 && hatched.species === egg.species && hatched.onDesk, `沒有孵出來：${JSON.stringify(hatched)}`);
  check(hatched.eggs === 0 && hatched.stat === 1 && hatched.props === 0, `孵完後狀態不對：${JSON.stringify(hatched)}`);
  await shot('egg-hatched');
  console.log(JSON.stringify({ f1, f2, typing, egg, steps, hatched }));
});
