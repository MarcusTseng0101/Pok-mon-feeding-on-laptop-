// 主線故事：序章（博士打來、選 X／Y）→ 新朋友（三個人輪流說）→ 弗拉達利的廣播（桌面中間變暗、夥伴轉頭看）
// → AZ 站在秘密基地旁邊（點他才說話）→ 弗拉達利的信（進信箱）→ 故事頁可以重看
// 測試環境連不到 Showdown，所以人物都是剪影
const { run } = require('./lib.cjs');

run('story', async ({ page, shot }, check) => {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(653);
    const m = game.createMon(650); m.out = true; game.state.mons.push(m);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 2 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
  });

  // 點過一整段對話（有選項就選 pick）；回傳看過的說話的人
  const talkThrough = async (pick, shotName) => {
    const names = new Set();
    let shotTaken = false;
    for (let i = 0; i < 80; i++) {
      const s = await page.evaluate(() => {
        const el = document.querySelector('.holo');
        return { hidden: el.classList.contains('hidden'), name: el.querySelector('.name').textContent, choices: [...el.querySelectorAll('[data-choice]')].map(b => b.dataset.choice), line: el.querySelector('.line').textContent };
      });
      if (s.hidden) break;
      names.add(s.name);
      if (shotName && !shotTaken && i === 2) { await page.waitForTimeout(700); await shot(shotName); shotTaken = true; }
      if (s.choices.length) await page.click(`.holo [data-choice="${pick}"]`);
      else await page.click('.holo .talk');
      await page.waitForTimeout(40);
    }
    return [...names];
  };

  // 1) 序章：博士打來；選 Y
  const started = await page.evaluate(() => window.__kalos.director.tickStory());
  check(started, '序章沒有開始');
  const hit = await page.evaluate(() => { const r = document.querySelector('.holo').getBoundingClientRect(); return window.__kalos.ui.hitTest?.(r.x + 20, r.y + 20) ?? true; });
  check(hit, '通訊器點不到（滑鼠會穿過去）');
  const pro = await talkThrough('y', 'story-call');
  const s1 = await page.evaluate(() => window.__kalos.game.state.story);
  check(s1.done.includes('prologue') && s1.version === 'y', `序章沒有記下來或版本不對：${JSON.stringify(s1)}`);
  check(pro.includes('布拉塔諾博士'), `序章說話的人不對：${pro}`);

  // 同一天：下一件還不會發生
  const early = await page.evaluate(() => window.__kalos.director.tickStory());
  check(!early, '還沒到第 1 天就發生下一件事');

  // 2) 新朋友：三個人輪流說
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  const fr = await talkThrough('x');
  check(['莎娜', '蒂艾爾諾', '特雷維'].every(n => fr.includes(n)), `新朋友沒有三個人都說到話：${fr}`);

  // 3) 廣播：桌面中間變暗、投影在正中間、夥伴轉頭看
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await page.waitForTimeout(700);
  const bc = await page.evaluate(() => {
    const { stage } = window.__kalos;
    const el = document.querySelector('.holo'), r = el.getBoundingClientRect();
    return { broadcast: el.classList.contains('broadcast'), dim: document.querySelector('.holo-dim').classList.contains('on'), centered: Math.abs(r.x + r.width / 2 - innerWidth / 2) < 4, looked: [...stage.pets.values()].filter(p => p.state === 'look').length };
  });
  check(bc.broadcast && bc.dim && bc.centered, `廣播的樣子不對：${JSON.stringify(bc)}`);
  check(bc.looked >= 1, `夥伴沒有轉頭看廣播：${JSON.stringify(bc)}`);
  await shot('story-broadcast');
  await talkThrough('x');

  // 4) AZ：站在秘密基地旁邊；不點他就不會說話、也不會發生下一件事；點了才說
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  await page.waitForTimeout(300);
  const az = await page.evaluate(() => {
    const { stage, director, game } = window.__kalos;
    const npc = stage.props.find(p => p.kind === 'npc' && !p.gone);
    const blocked = !director.tickStory({ force: true });
    return { npc: Boolean(npc), holoHidden: document.querySelector('.holo').classList.contains('hidden'), blocked, done: game.state.story.done.includes('az-visit') };
  });
  check(az.npc && az.holoHidden && az.blocked && !az.done, `AZ 沒有站在基地旁邊等你點：${JSON.stringify(az)}`);
  await shot('story-visit');
  await page.evaluate(() => { const { stage } = window.__kalos; stage.fire('click', stage.props.find(p => p.kind === 'npc')); });
  const azNames = await talkThrough('x');
  await page.waitForTimeout(900);
  const azAfter = await page.evaluate(() => {
    const { stage, game } = window.__kalos;
    for (let i = 0; i < 40; i++) stage.update(1 / 30);
    return { done: game.state.story.done.includes('az-visit'), npcLeft: !stage.props.some(p => p.kind === 'npc' && !p.gone) };
  });
  check(azNames.includes('AZ') && azAfter.done && azAfter.npcLeft, `跟 AZ 說完話以後不對：${JSON.stringify({ azNames, azAfter })}`);

  // 5) 弗拉達利的信：進信箱
  await page.evaluate(() => window.__kalos.director.tickStory({ force: true }));
  const letter = await page.evaluate(() => {
    const { game, ui } = window.__kalos;
    const l = game.state.letters.inbox.find(x => x.kind === 'story');
    if (l) ui.showLetter(l);
    const d = document.querySelector('.dialog.letter');
    return { has: Boolean(l), who: d?.querySelector('.who')?.textContent, body: d?.querySelector('.body')?.textContent.slice(0, 20), done: game.state.story.done.includes('lysandre-letter') };
  });
  check(letter.has && letter.done && /弗拉達利/.test(letter.who ?? ''), `弗拉達利的信不對：${JSON.stringify(letter)}`);
  await page.evaluate(() => document.querySelector('.modal').classList.add('hidden'));

  // 6) 故事頁：5 件事都在、可以重看
  await page.evaluate(() => window.__kalos.ui.open('story'));
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => ({ rows: document.querySelectorAll('.story .story-row').length, ver: document.querySelector('.story .ver')?.textContent, next: document.querySelector('.story .next')?.textContent }));
  check(panel.rows === 5 && panel.ver === 'Y', `故事頁不對：${JSON.stringify(panel)}`);
  await shot('story-panel');
  await page.click('.story [data-storyreplay="prologue"]');
  await page.waitForTimeout(200);
  const replay = await page.evaluate(() => !document.querySelector('.holo').classList.contains('hidden'));
  check(replay, '重看序章沒有打開通訊器');
  await talkThrough('x');
  const after = await page.evaluate(() => window.__kalos.game.state.story);
  check(after.version === 'Y'.toLowerCase(), '重看的時候選了別的答案，版本不應該被改掉');
  console.log(JSON.stringify({ pro, fr, bc, az, azAfter, letter, panel }));
});
