// 寫信給你——離開 7 小時 → 桌面上的信箱立起旗子 → 點信箱打開 → 提到牠的名字和記憶裡的一件事；
// 收件夾（重讀、刪除）；惡意暱稱不會被當成 HTML
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
    const box = stage.props.find(p => p.kind === 'mailbox' && !p.gone);
    const L = stage.baseView.layout();
    return { box: Boolean(box), flag: box?.unread, besideBase: box ? box.x > L.x + L.w && box.x < L.x + L.w + 40 * stage.S : false, unread: game.unreadLetters().length, name: game.displayName(mon) };
  });
  check(r.box && r.flag === 1 && r.unread === 1, `離開 7 小時沒有收到信，或信箱沒有立旗子：${JSON.stringify(r)}`);
  check(r.besideBase, `信箱沒有放在秘密基地旁邊：${JSON.stringify(r)}`);
  await shot('letter-envelope');

  // 點信箱：有沒看的信就直接打開
  const opened = await page.evaluate(() => {
    const { stage } = window.__kalos;
    stage.fire('click', stage.props.find(p => p.kind === 'mailbox' && !p.gone));
    const d = document.querySelector('.dialog.letter');
    return { text: d?.querySelector('.body').textContent, who: d?.querySelector('.who').textContent, imgs: d?.querySelectorAll('.body img').length, xss: window.__xss ?? null };
  });
  check(opened.text && /7個小時/.test(opened.text), `信的內容不對：${opened.text}`);
  check(/甜甜泡芙/.test(opened.text), `信裡沒有提到記憶裡的事（餵了甜甜泡芙）：${opened.text}`);
  check(opened.who?.includes(r.name), `信上沒有署名：${opened.who}`);
  check(opened.imgs === 0 && opened.xss === null, `惡意暱稱被當成 HTML 了：${JSON.stringify(opened)}`);
  await shot('letter-open');

  // 收進信箱：旗子放下來；再點信箱打開收件夾，這封還在（已讀）
  await page.click('.dialog.letter [data-yes]');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const { stage, game } = window.__kalos;
    const mb = stage.props.find(p => p.kind === 'mailbox' && !p.gone);
    stage.fire('click', mb);
    return { flag: mb.unread, unread: game.unreadLetters().length };
  });
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => ({ panel: window.__kalos.ui.panel, rows: document.querySelectorAll('.mailbox .letter-row').length, unreadRows: document.querySelectorAll('.mailbox .letter-row.unread').length, dels: document.querySelectorAll('.mailbox [data-letterdel]').length }));
  check(after.flag === 0 && after.unread === 0, `看完以後旗子還立著：${JSON.stringify(after)}`);
  check(box.panel === 'mail' && box.rows === 1 && box.unreadRows === 0 && box.dels === 1, `收件夾不對：${JSON.stringify(box)}`);
  await shot('letter-mailbox');

  // 重讀以後刪掉：收件夾變空、存檔記得刪過（同步時不會跑回來）
  await page.click('.mailbox .letter-row');
  await page.waitForTimeout(200);
  await page.click('.dialog.letter [data-del]');
  await page.waitForTimeout(300);
  const del = await page.evaluate(() => {
    const { game } = window.__kalos;
    return { inbox: game.state.letters.inbox.length, deleted: game.state.letters.deleted.length, rows: document.querySelectorAll('.mailbox .letter-row').length, modal: !document.querySelector('.modal')?.classList.contains('hidden') && Boolean(document.querySelector('.dialog.letter')) };
  });
  check(del.inbox === 0 && del.deleted === 1 && del.rows === 0, `刪不掉：${JSON.stringify(del)}`);

  // 設定生日
  await page.evaluate(() => window.__kalos.ui.open('settings'));
  await page.waitForTimeout(300);
  await page.selectOption('[data-bmonth]', '10');
  await page.selectOption('[data-bday]', '1');
  const bday = await page.evaluate(() => window.__kalos.game.state.settings.birthday);
  check(bday === '10-01', `生日沒有存起來：${bday}`);
  console.log(JSON.stringify({ r, opened, after, box, del, bday }));
});
