// 打擾額度：用假時鐘模擬 8 小時，讓打字、夥伴送禮、信、感情變好、毛長回來、故事的電話都照常發生。
// 驗收：
//   1. 任意滾動 60 分鐘內，放行的主動打擾 ≤ 1 次（設定是每小時 1 次）
//   2. 每一個跳出來的通知，都在某一次放行之後 15 秒內（沒有繞過額度偷偷跳出來的）
//   3. 被延後的故事電話最後有打來、信的提醒最後有出現
//   4. 專注中完全不放行，專注結束後排隊的才出來
// 會印出一條時間軸（放行／排隊）
const { run } = require('./lib.cjs');

const MIN = 60_000;

async function test({ page }, check) {
  await page.evaluate(async () => {
    const { game, director, stage, ui } = window.__kalos;
    game.chooseStarter(650);
    for (const sp of [661, 664]) { const m = game.createMon(sp); m.out = true; m.affection = 120; game.state.mons.push(m); }
    director.syncPets();
    const t0 = Date.now();
    while (stage.pets.size < 3 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
    ui.modal.classList.add('hidden');
    game.state.settings.interruptions = '1';
    game.state.attention.granted = [];
    director.nextSpawnAt = Infinity;
    Object.assign(stage.pointer, { x: stage.W / 2, y: stage.H / 2, known: true }); // 打字反應要知道游標在哪
    // 記下每一個跳出來的通知（模擬裡沒有你的操作，所以全部都是主動的）
    window.__toasts = [];
    const toast = ui.toast.bind(ui);
    ui.toast = (text, o) => { window.__toasts.push({ at: Date.now(), text }); return toast(text, o); };
  });

  const res = await page.evaluate(async MIN => {
    const { game, director, ui } = window.__kalos;
    const clock = window.__clock;
    const uids = game.state.mons.map(m => m.uid);
    const step = async () => { clock.offset += MIN; director.drainAttention(); await new Promise(r => setTimeout(r, 0)); };
    // 故事：到了「新朋友」那天（序章做完了）
    game.storyDone('prologue', { choice: 'x' });
    game.state.story.startedAt -= 3 * 86_400_000;
    game.state.story.lastAt = 0;
    const focusAt = 5 * 60, focusEnd = focusAt + 50; // 第 5 小時專注 50 分鐘
    let storyAsked = false, focusGranted = 0;
    for (let m = 0; m < 8 * 60; m++) {
      const now = Date.now();
      if (m === 0) game.emit('dailyGift', { balls: { poke: 1, great: 0, ultra: 0 }, puffs: [] });
      if (m % 7 === 3) { director.signals = { typing: true, typingSeconds: 999 }; director.typingCooldown = 0; director.typingReaction(now); }
      if (m % 45 === 10) game.emit('partnerGift', { uid: uids[m % uids.length], puff: 'sweet-basic' });
      if (m % 90 === 20) game.emit('bondUp', { a: uids[1], b: uids[2], level: 2 + (m % 2), zh: '好朋友' });
      if (m === 30) game.emit('trimExpired', { uid: uids[0] });
      if (m === 40) game.emit('letter', { id: 'sim-letter', name: '哈力栗' });
      if (m === 50 && !storyAsked) { storyAsked = director.tickStory(); }
      if (m === focusAt) game.state.focus.active = { startedAt: now, minutes: 60 }; // 比 50 長：模擬自己在 focusEnd 關掉，app 的計時器不會搶先「專注完成」
      if (m === focusEnd) game.state.focus.active = null;
      if (m >= focusAt && m < focusEnd && director.attnLog.some(e => e.granted && e.at === now)) focusGranted++;
      // 故事的電話打來了：把對話點完
      if (ui.holo.busy) { for (let i = 0; i < 20 && ui.holo.busy; i++) { ui.holo.completeLine(); ui.holo.next(); } }
      await step();
    }
    // 讓最後一件故事事件演完（playStory 是 async）
    await new Promise(r => setTimeout(r, 50));
    const log = director.attnLog.map(e => ({ ...e, m: Math.round((e.at - director.attnLog[0].at) / MIN) }));
    return {
      log,
      toasts: window.__toasts.map(t => ({ ...t, m: Math.round((t.at - director.attnLog[0].at) / MIN) })),
      storyDone: game.state.story.done.includes('friends'),
      storyAsked, focusGranted,
      queue: (director.attnQueue ?? []).map(q => q.id),
    };
  }, MIN);

  const granted = res.log.filter(e => e.granted).map(e => e.at).sort((a, b) => a - b);
  // 時間軸
  console.log('時間軸（分鐘：放行✓／排隊…）');
  for (const e of res.log) console.log(`  ${String(e.m).padStart(3)}  ${e.granted ? (e.late ? '✓(排隊後)' : '✓') : '…'}  ${e.kind.padEnd(8)} ${e.id}`);
  let worst = 0;
  for (const t of granted) worst = Math.max(worst, granted.filter(x => x >= t && x < t + 60 * MIN).length);
  check(worst <= 1, `有一小時放行了 ${worst} 次`);
  check(granted.length >= 5, `8 小時只放行了 ${granted.length} 次（太安靜，額度可能沒有空出來）`);
  const stray = res.toasts.filter(t => !granted.some(g => t.at >= g && t.at <= g + 15_000));
  check(stray.length === 0, `有通知沒經過額度：${JSON.stringify(stray.slice(0, 3))}`);
  check(res.storyAsked && res.storyDone, `故事的電話沒有打來：${JSON.stringify({ storyAsked: res.storyAsked, storyDone: res.storyDone })}`);
  check(res.toasts.some(t => /寫了一封信/.test(t.text)), '信的提醒一直沒出現');
  check(res.log.some(e => e.kind === 'ambient' && e.id === 'typing'), '打字的反應沒有經過額度（模擬裡沒發生）');
  check(res.focusGranted === 0, `專注中放行了 ${res.focusGranted} 次`);
  console.log(JSON.stringify({ granted: granted.length, worst, toasts: res.toasts.length, queue: res.queue }));
}

// 假時鐘：Date.now() = 真的時間 + offset（director 用 Date.now 判斷額度）
test.options = {
  budget: true,
  init: () => {
    const real = Date.now.bind(Date);
    window.__clock = { offset: 0 };
    Date.now = () => real() + window.__clock.offset;
  },
};

run('attention', test);
