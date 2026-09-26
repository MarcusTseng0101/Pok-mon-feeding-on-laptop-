// v3 PR 1：看得到的部分——想法泡泡、夥伴資料頁的「最近在想什麼」、聊天、一起散步、切磋輸贏的記憶
const { run } = require('./lib.cjs');

run('mind', async ({ page, shot }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage } = window.__kalos;
    game.chooseStarter(650);
    for (const id of [653, 656]) { const m = game.createMon(id); m.out = true; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    director.nextSpawnAt = Infinity;
    director.updateEnv = () => {};
    Object.assign(stage.env, { sleepy: false, userActive: true, hour: 14, focus: null });
    const [a, b, c] = [...stage.pets.values()];
    const step = async (sec, dt = 1 / 30) => { for (let i = 0; i < sec / dt; i++) { stage.update(dt); if (i % 60 === 0) await new Promise(res => setTimeout(res, 0)); } };
    const out = {};

    // 1) 一起散步：感情好（≥ 60）才會；兩隻會走在一起，結束後感情增加、互相記得
    game.bond(a.uid, b.uid, 80);
    for (const p of [a, b, c]) { p.set('idle', 999); p.x = 300 + [a, b, c].indexOf(p) * 250; p.gy = 500; }
    const opts = (await import('/src/renderer/scene/social.js')).groupOptions(a, [b]);
    out.hasWalk = opts.some(o => o[0] === 'walkTogether');
    opts.find(o => o[0] === 'walkTogether')[2]();
    const bondBefore = game.bondOf(a.uid, b.uid);
    let together = 0, maxGap = 0;
    for (let i = 0; i < 20 * 30; i++) {
      stage.update(1 / 30);
      if (a.state === 'walkTogether' && b.state === 'walkTogether') { together++; maxGap = Math.max(maxGap, Math.hypot(a.x - b.x, a.gy - b.gy) / a.S); }
      if (i % 60 === 0) await new Promise(res => setTimeout(res, 0));
    }
    out.walk = { together, maxGap: Math.round(maxGap), bondUp: game.bondOf(a.uid, b.uid) - bondBefore, memA: a.mon.memory.map(e => e.k), stateAfter: [a.state, b.state] };

    // 2) 聊天：輪流冒表情
    for (const p of [a, b]) p.set('idle', 999);
    const chat = (await import('/src/renderer/scene/social.js')).groupOptions(a, [b]).find(o => o[0] === 'chat');
    chat[2]();
    // 先走過去（approach 最多 16 秒）再聊 4～6.5 秒：跑到聊完為止，最多 30 秒
    const emotes = new Set();
    let chatted = false;
    for (let i = 0; i < 30 * 30; i++) {
      stage.update(1 / 30);
      const chatting = a.state === 'chat' || b.state === 'chat';
      if (chatting) { chatted = true; for (const p of [a, b]) if (p.emote) emotes.add(`${p.uid}:${p.emote.img.width}`); }
      if (chatted && !chatting) break;
      if (i % 60 === 0) await new Promise(res => setTimeout(res, 0));
    }
    out.chat = { emoteSpeakers: new Set([...emotes].map(e => e.split(':')[0])).size, ended: chatted && a.state !== 'chat' && b.state !== 'chat' };

    // 3) 切磋：分出輸贏 → 競爭心、記憶
    stage.fire('duelResult', a, c);
    out.duel = { rivalry: game.rivalryOf(a.uid, c.uid), memC: c.mon.memory.at(-1)?.k, memA: a.mon.memory.at(-1)?.k };

    // 4) 做決定 → 有想法
    for (const p of [a, b, c]) p.set('idle', 999);
    c.decide();
    out.thought = c.thought;
    for (const p of [a, b, c]) p.set('sit', 999); // 接下來測滑鼠停留：先不要動
    const rc = c.rect();
    out.at = { x: (rc.x + rc.w / 2) / stage.dpr, y: (rc.y + rc.h / 2) / stage.dpr };
    return out;
  });
  check(r.hasWalk, '感情好的沒有一起散步的選項');
  check(r.walk.together > 60 && r.walk.maxGap < 120, `沒有走在一起：${JSON.stringify(r.walk)}`);
  check(r.walk.bondUp >= 2 && r.walk.memA.includes('played-with'), `散步後感情或記憶沒有增加：${JSON.stringify(r.walk)}`);
  check(r.chat.emoteSpeakers === 2 && r.chat.ended, `聊天沒有輪流說話：${JSON.stringify(r.chat)}`);
  check(r.duel.rivalry === 1 && r.duel.memC === 'lost' && r.duel.memA === 'won', `切磋的結果沒有記下來：${JSON.stringify(r.duel)}`);
  // 滑鼠停在身上 0.6 秒才顯示泡泡
  await page.mouse.move(r.at.x, r.at.y);
  const hover = await page.evaluate(async () => {
    const { stage } = window.__kalos;
    const step = sec => { for (let i = 0; i < sec * 30; i++) stage.update(1 / 30); };
    step(0.3);
    const early = stage.hoverT;
    step(0.5);
    return { early, late: stage.hoverT, pet: Boolean(stage.hoverPet) };
  });
  r.early = hover.early; r.late = hover.late;
  check(hover.pet, '滑鼠停在寶可夢身上，但沒有認出來');
  check(r.thought?.text && r.thought.key.startsWith(`${r.thought.cat}.`), `沒有想法：${JSON.stringify(r.thought)}`);
  check(r.early < 0.6 && r.late >= 0.6, `停留時間不對：${r.early} ${r.late}`);

  // 截圖：想法泡泡
  // 想法和名字是同一個元素：不會疊在一起，泡泡在名字上面、兩個都在寶可夢頭上
  const bub = await page.evaluate(() => {
    const { stage, ui } = window.__kalos;
    stage.hoverPet.thought = { key: 'social.friend', text: '想找好朋友哈力栗玩', cat: 'social' };
    ui.update();
    stage.draw();
    const th = document.querySelector('.label .thought'), tag = document.querySelector('.label .tag');
    const a = th.getBoundingClientRect(), b = tag.getBoundingClientRect(), rc = stage.hoverPet.rect();
    const top = rc.y / stage.dpr, cx = (rc.x + rc.w / 2) / stage.dpr;
    return { shown: !th.classList.contains('hidden') && th.textContent === '想找好朋友哈力栗玩', gap: Math.round(b.top - a.bottom), aboveHead: b.bottom <= top + 1, centered: Math.abs((a.left + a.right) / 2 - cx) < 30 };
  });
  check(bub.shown && bub.gap >= 4 && bub.aboveHead && bub.centered, `想法泡泡的位置不對：${JSON.stringify(bub)}`);
  await shot('mind-thought');

  // 夥伴資料頁：心情、需求、最近在想什麼
  await page.evaluate(() => {
    const { ui, stage } = window.__kalos;
    ui.selectedUid = [...stage.pets.values()][0].uid;
    ui.open('party');
  });
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => {
    const m = document.querySelector('.party .mind');
    m?.scrollIntoView();
    return m ? { text: m.textContent.replace(/\s+/g, ' '), needs: m.querySelectorAll('.need').length, thoughts: m.querySelectorAll('li').length } : null;
  });
  check(panel && panel.needs === 6 && /心情：/.test(panel.text) && /最近在想什麼/.test(panel.text), `夥伴資料頁沒有心智：${JSON.stringify(panel)}`);
  check(panel && /記得：/.test(panel.text), `沒有顯示記得的事：${panel?.text}`);
  await shot('mind-party');
  console.log(JSON.stringify({ ...r, panel }));
});
