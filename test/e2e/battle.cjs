// 主線的對戰與獎勵：可爾妮來挑戰（站在基地旁邊）→ 點她說完話 → 派夥伴出場 → 選招式打到贏
// → 拿到格鬥徽章、超級手環、摔角鷹人進化石 → 布里卡隆有進化石＋手環，下一場一上場就超級進化
// → 認輸：明天再來 → 傳說的寶可夢出現在桌面上（不能離開、不會逃走），抓到才算做完
const { run } = require('./lib.cjs');

run('battle', async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const sp of [652, 701]) { const m = game.createMon(sp); m.out = true; m.affection = 200; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    // 前面的故事都做完了（X 版）
    const { EVENTS } = await import('../../src/core/story.js');
    for (const e of EVENTS) { if (e.id === 'gym-korrina') break; if (!e.special) game.storyDone(e.id, { choice: 'x' }); }
  });

  const talkThrough = async () => {
    const names = new Set();
    for (let i = 0; i < 80; i++) {
      const s = await page.evaluate(() => { const el = document.querySelector('.holo'); return { hidden: el.classList.contains('hidden'), name: el.querySelector('.name').textContent, choice: el.querySelector('[data-choice]')?.dataset.choice }; });
      if (s.hidden) break;
      names.add(s.name);
      if (s.choice) await page.click(`.holo [data-choice="${s.choice}"]`); else await page.click('.holo .talk');
      await page.waitForTimeout(30);
    }
    return [...names];
  };

  // 打到結束：輪到你就選「效果絕佳」的招式（沒有就選第一個）；要選夥伴就選第一隻
  const fight = async ({ shotName, pick } = {}) => {
    let turns = 0, shotTaken = false, sawFoe = false;
    for (let i = 0; i < 900; i++) {
      const s = await page.evaluate(() => {
        const hud = document.querySelector('.battle-hud'), b = window.__kalos.stage.battle;
        return { open: !hud.classList.contains('hidden'), moves: [...hud.querySelectorAll('[data-move]')].map(x => ({ id: x.dataset.move, sup: Boolean(x.querySelector('.super')) })), pets: [...hud.querySelectorAll('[data-pet]')].map(x => x.dataset.pet), foe: b?.foes[b.fi]?.pet ? true : false };
      });
      if (!s.open) break;
      sawFoe ||= s.foe;
      if (s.pets.length) await page.click(`.battle-hud [data-pet="${pick?.(s.pets) ?? s.pets[0]}"]`);
      else if (s.moves.length) {
        const m = s.moves.find(x => x.sup) ?? s.moves[0];
        if (shotName && !shotTaken && turns === 1) { await shot(shotName); shotTaken = true; }
        await page.click(`.battle-hud [data-move="${m.id}"]`);
        turns++;
      }
      await page.waitForTimeout(100);
    }
    return { turns, sawFoe };
  };

  // 1) 可爾妮來了：站在基地旁邊，點她說完話才開打
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => { const { stage } = window.__kalos; return { npc: stage.props.some(p => p.kind === 'npc' && !p.gone), battle: Boolean(stage.battle) }; });
  check(v.npc && !v.battle, `館主沒有站在基地旁邊等你：${JSON.stringify(v)}`);
  await page.evaluate(() => { const { stage } = window.__kalos; stage.fire('click', stage.props.find(p => p.kind === 'npc' && !p.gone)); });
  const intro = await talkThrough();
  check(intro.includes('可爾妮'), `開打前的台詞不對：${intro}`);
  await page.waitForTimeout(200);
  const hud = await page.evaluate(() => ({ open: !document.querySelector('.battle-hud').classList.contains('hidden'), pets: document.querySelectorAll('.battle-hud [data-pet]').length, battle: Boolean(window.__kalos.stage.battle), foe: window.__kalos.stage.guests.length }));
  check(hud.open && hud.pets === 3 && hud.battle && hud.foe === 1, `對戰沒有開始、或不能選夥伴：${JSON.stringify(hud)}`);
  const hit = await page.evaluate(() => { const r = document.querySelector('.battle-hud').getBoundingClientRect(); return window.__kalos.ui.hitTest?.(r.x + 20, r.y + 20) ?? true; });
  check(hit, '對戰面板點不到（滑鼠會穿過去）');

  // 2) 派哈力栗出場（對摔角鷹人不利），打到結束
  const chespin = await page.evaluate(() => [...window.__kalos.stage.pets.values()].find(p => p.mon.species === 650).uid);
  const r1 = await fight({ shotName: 'battle', pick: list => (list.includes(chespin) ? chespin : list[0]) });
  const win = await talkThrough();
  await page.waitForTimeout(300);
  const after1 = await page.evaluate(() => {
    const { game, stage } = window.__kalos;
    return { done: game.state.story.done.includes('gym-korrina'), retry: game.state.story.retry, ring: game.state.bag.items.megaring, haw: game.state.bag.items.hawluchanite, guests: stage.guests.length, battle: Boolean(stage.battle), stuck: [...stage.pets.values()].filter(p => p.inBattle || p.state === 'battle' || p.state === 'faint').length };
  });
  check(r1.turns >= 1 && r1.sawFoe, `沒有真的打：${JSON.stringify(r1)}`);
  check(!after1.battle && after1.guests === 0 && after1.stuck === 0, `對戰結束後沒有收乾淨：${JSON.stringify(after1)}`);
  // 三隻好感滿的夥伴打第三個道館，應該會贏（輸了就是平衡有問題）
  check(after1.done && after1.ring && after1.haw, `贏了卻沒拿到獎勵（或輸了）：${JSON.stringify({ after1, win })}`);

  // 3) 博士打來：給你那一族（哈力栗）的進化石 → 布里卡隆可以超級進化
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await talkThrough();
  const mega = await page.evaluate(() => { const { game } = window.__kalos; const c = game.state.mons.find(m => m.species === 652); return { stone: game.state.bag.items.chesnaughtite, can: game.canMega(c.uid) }; });
  check(mega.stone && mega.can, `布里卡隆不能超級進化：${JSON.stringify(mega)}`);

  // 4) 下一場（蒂艾爾諾的電話跳過）：派布里卡隆 → 一上場就超級進化；然後認輸 → 明天再來
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await talkThrough();
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true })); // 福爺
  await page.waitForTimeout(300);
  await page.evaluate(() => { const { stage } = window.__kalos; stage.fire('click', stage.props.find(p => p.kind === 'npc' && !p.gone)); });
  await talkThrough();
  await page.waitForTimeout(200);
  const ches = await page.evaluate(() => [...window.__kalos.stage.pets.values()].find(p => p.mon.species === 652).uid);
  await page.click(`.battle-hud [data-pet="${ches}"]`);
  await page.waitForTimeout(2600);
  const m2 = await page.evaluate(() => { const p = [...window.__kalos.stage.pets.values()].find(p => p.mon.species === 652); return { form: p.battleForm, key: p.spriteKey, w: p.asset.w }; });
  check(m2.form === 'mega' && m2.key === '10292', `布里卡隆沒有超級進化：${JSON.stringify(m2)}`);
  await shot('battle-mega');
  await page.waitForSelector('.battle-hud [data-giveup]', { timeout: 8000 });
  await page.click('.battle-hud [data-giveup]');
  await talkThrough();
  await page.waitForTimeout(300);
  const lost = await page.evaluate(() => {
    const { game, director, stage } = window.__kalos;
    const p = [...stage.pets.values()].find(p => p.mon.species === 652);
    for (let i = 0; i < 60; i++) stage.update(1 / 30);
    return { retry: game.state.story.retry, again: Boolean(game.storyNext()), form: p.battleForm ?? null, busy: director.storyBusy };
  });
  check(lost.retry?.id === 'gym-ramos' && lost.retry.losses === 1 && !lost.again && !lost.busy, `認輸以後不對：${JSON.stringify(lost)}`);

  // 5) 傳說：跳到武器醒來那天 → 博士打來 → 哲爾尼亞斯出現在桌面上（沒有「離開」、不會逃走）→ 抓到
  await page.evaluate(async () => {
    const { game } = window.__kalos;
    const { EVENTS } = await import('../../src/core/story.js');
    for (const e of EVENTS) { if (e.id === 'legend-awaken') break; if (!e.special) game.storyDone(e.id); }
    game.state.bag.balls.ultra = 60;
  });
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await talkThrough();
  await page.waitForTimeout(1500);
  const leg = await page.evaluate(() => { const { director } = window.__kalos; return { sp: director.enc?.wild.speciesId, story: director.enc?.wild.story, run: Boolean(document.querySelector('.encounter [data-act="run"]')), deadline: director.enc?.deadline === Infinity }; });
  check(leg.sp === 716 && leg.story === 'legend-awaken' && !leg.run && leg.deadline, `傳說沒有出現、或可以離開：${JSON.stringify(leg)}`);
  await shot('story-legend');
  let caught = false;
  for (let i = 0; i < 40 && !caught; i++) {
    await page.evaluate(() => {
      const { director } = window.__kalos;
      if (!director.enc || director.enc.throwing) return;
      director.throwBall('ultra');
    });
    await page.waitForTimeout(3200);
    caught = await page.evaluate(() => window.__kalos.game.state.story.done.includes('legend-awaken'));
    const fled = await page.evaluate(() => !window.__kalos.director.enc && !window.__kalos.game.state.story.done.includes('legend-awaken'));
    if (fled) { check(false, '傳說逃走了'); break; }
  }
  const got = await page.evaluate(() => ({ has: window.__kalos.game.state.mons.some(m => m.species === 716), busy: window.__kalos.director.storyBusy }));
  check(caught && got.has && !got.busy, `沒有抓到哲爾尼亞斯：${JSON.stringify({ caught, got })}`);

  // 6) 故事頁：徽章（3 顆以上亮著）
  await page.evaluate(() => window.__kalos.ui.open('story'));
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => ({ on: document.querySelectorAll('.story .gym-badge.on').length, all: document.querySelectorAll('.story .gym-badge').length }));
  check(panel.all === 8 && panel.on >= 3, `故事頁的徽章不對：${JSON.stringify(panel)}`);
  await shot('story-badges');
  console.log(JSON.stringify({ intro, r1, after1, mega, m2, lost, leg, panel }));
});
