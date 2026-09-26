// v3 PR 5：寫信給你——離開 7 小時 → 信封出現 → 打開 → 提到牠的名字和記憶裡的一件事；信箱；惡意暱稱不會被當成 HTML
const { run } = require('./lib.cjs');

run('letters', async ({ page, shot }, check) => {
  const r = await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 1 && Date.now() - t0 < 15000) await new Promise(res => setTimeout(res, 50));
    ui.modal.classList.add('hidden');
    director.nextSpawnAt = Infinity;
    const mon = game.state.mons[0];
    game.rename(mon.uid, '<img src=x onerror=window.__xss=1>');
    game.state.bag.puffs['sweet-basic'] = 1;
    game.feed(mon.uid, 'sweet-basic'); // 記憶：你餵了我甜甜泡芙
    // 離開 7 小時
    game.state.lastSeenAt = Date.now() - 7 * 3600_000;
    game.lastTick = game.state.lastSeenAt;
    game.catchUp();
    director.refreshMail();
    await new Promise(res => setTimeout(res, 600));
    const env = stage.props.find(p => p.kind === 'letter' && !p.gone);
    return { env: Boolean(env), unread: game.unreadLetters().length, name: game.displayName(mon) };
  });
  check(r.env && r.unread === 1, `離開 7 小時沒有收到信：${JSON.stringify(r)}`);
  await shot('letter-envelope');

  // 點信封：打開信
  const opened = await page.evaluate(() => {
    const { stage } = window.__kalos;
    stage.fire('click', stage.props.find(p => p.kind === 'letter' && !p.gone));
    const d = document.querySelector('.dialog.letter');
    return { text: d?.querySelector('.body').textContent, who: d?.querySelector('.who').textContent, imgs: d?.querySelectorAll('.body img').length, xss: window.__xss ?? null };
  });
  check(opened.text && /7個小時/.test(opened.text), `信的內容不對：${opened.text}`);
  check(/甜甜泡芙/.test(opened.text), `信裡沒有提到記憶裡的事（餵了甜甜泡芙）：${opened.text}`);
  check(opened.who?.includes(r.name), `信上沒有署名：${opened.who}`);
  check(opened.imgs === 0 && opened.xss === null, `惡意暱稱被當成 HTML 了：${JSON.stringify(opened)}`);
  await shot('letter-open');

  // 收好：信封不見；信箱裡有這封（已讀）
  await page.click('.dialog.letter [data-yes]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const { stage, ui, game } = window.__kalos;
    const env = stage.props.some(p => p.kind === 'letter' && !p.gone && p.life > 0);
    ui.open('mail');
    return { env, unread: game.unreadLetters().length };
  });
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => ({ rows: document.querySelectorAll('.mailbox .letter-row').length, unreadRows: document.querySelectorAll('.mailbox .letter-row.unread').length, summary: document.querySelector('.mailbox .summary')?.textContent }));
  check(!after.env && after.unread === 0, `看完以後信封還在：${JSON.stringify(after)}`);
  check(box.rows === 1 && box.unreadRows === 0, `信箱不對：${JSON.stringify(box)}`);
  await shot('letter-mailbox');

  // 設定生日
  await page.evaluate(() => window.__kalos.ui.open('settings'));
  await page.waitForTimeout(300);
  await page.selectOption('[data-bmonth]', '10');
  await page.selectOption('[data-bday]', '1');
  const bday = await page.evaluate(() => window.__kalos.game.state.settings.birthday);
  check(bday === '10-01', `生日沒有存起來：${bday}`);
  console.log(JSON.stringify({ r, opened, after, box, bday }));
});
