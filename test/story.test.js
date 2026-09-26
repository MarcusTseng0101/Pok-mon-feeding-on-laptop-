// 主線故事（core/story.js）：照真實時間、錯過的一件一件補、版本、存檔與同步、故事的信
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { mergeShared } from '../src/core/sync.js';
import * as S from '../src/core/story.js';
import { KEY_ITEMS } from '../src/core/items.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const HOUR = 3_600_000, DAY = 24 * HOUR;

function newGame(t) {
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(3), now: () => t.v });
  g.chooseStarter(650);
  return g;
}

test('事件資料：id 不重複、主線照日子排序、說話的人都在登場人物裡、台詞不是空的、對戰和獎勵都合法', () => {
  const ids = S.EVENTS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < S.MAIN.length; i++) assert.ok(S.MAIN[i].day >= S.MAIN[i - 1].day, S.MAIN[i].id);
  for (const e of S.EVENTS) {
    assert.ok(['call', 'broadcast', 'letter', 'visit', 'battle', 'legend'].includes(e.kind), e.id);
    assert.ok(e.title, e.id);
    assert.ok(Number.isInteger(e.day), e.id);
    if (e.special) assert.ok(S.EVENT_BY_ID[e.requires] && !S.EVENT_BY_ID[e.requires].special, `${e.id} 的 requires`);
    for (const it of e.reward?.items ?? []) assert.ok(KEY_ITEMS[it], `${e.id} ${it}`);
    if (e.kind === 'letter') { assert.ok(S.CAST[e.from], e.id); assert.ok(e.text.length > 20 && e.text.length <= 600, e.id); continue; }
    assert.ok(e.lines.length > 0, e.id);
    if (e.kind === 'battle') {
      assert.ok(e.battle.foes.length >= 1 && e.battle.foes.every(id => dex.has(id)), e.id);
      assert.ok(e.battle.power > 0.5 && e.battle.power < 1.5, e.id);
      assert.ok(e.win?.length && e.lose?.length, e.id);
      if (e.battle.badge) assert.ok(S.BADGES[e.battle.badge], e.id);
    }
    if (e.kind === 'legend') assert.ok(['mine', 'other'].includes(e.legend), e.id);
    for (const [who, text] of [...e.lines, ...(e.after ?? []), ...(e.win ?? []), ...(e.lose ?? [])]) { assert.ok(S.CAST[who], `${e.id} ${who}`); assert.ok(text.length > 0 && text.length < 120, `${e.id} ${text}`); }
  }
  // 八個道館徽章各一次、照順序
  assert.deepEqual(S.MAIN.filter(e => e.battle?.badge).map(e => e.battle.badge), Object.keys(S.BADGES));
  assert.equal(S.EVENTS[0].id, 'prologue');
  assert.deepEqual(S.EVENTS[0].choice.options.map(o => o.value).sort(), ['x', 'y']);
});

test('照真實時間：序章馬上；第 1 天之前不會有下一件；過了半夜就是第 1 天', () => {
  const t = { v: T0 };
  const g = newGame(t);
  assert.equal(g.storyNext()?.id, 'prologue');
  assert.equal(g.storyDone('prologue', { choice: 'y' }), true);
  assert.equal(g.storyDone('prologue', { choice: 'x' }), false, '同一件事不會做兩次');
  assert.equal(g.state.story.version, 'y');
  t.v += 5 * HOUR; // 同一天晚上
  assert.equal(g.storyNext(), null);
  t.v = new Date(2026, 8, 26, 0, 30).getTime(); // 隔天半夜 0:30：第 1 天
  assert.equal(S.storyDay(g.state.story, t.v), 1);
  assert.equal(g.storyNext()?.id, 'friends');
});

test('錯過的：一件一件補，兩件之間至少隔 10 分鐘；還沒到的日子不會提前', () => {
  const t = { v: T0 };
  const g = newGame(t);
  g.storyDone('prologue', { choice: 'x' });
  t.v += 30 * DAY; // 一個月沒開
  const seen = [];
  for (let i = 0; i < 60; i++) {
    const ev = g.storyNext();
    if (!ev) { t.v += 60_000; continue; }
    seen.push(ev.id);
    g.storyDone(ev.id);
    assert.equal(g.storyNext(), null, '剛做完一件，下一件要等');
    t.v += S.GAP_MS - 1;
    assert.equal(g.storyNext(), null);
    t.v += 1;
  }
  assert.deepEqual(seen, S.MAIN.filter(e => e.day <= 30).slice(1).map(e => e.id), '特別事件的條件還沒到（要破關以後）');
  // 只過了 3 天：第 5 天的事還不會發生
  const t2 = { v: T0 };
  const g2 = newGame(t2);
  g2.storyDone('prologue', { choice: 'x' });
  t2.v += 3 * DAY;
  const ids = [];
  for (let i = 0; i < 10; i++) { const ev = g2.storyNext(); if (ev) { ids.push(ev.id); g2.storyDone(ev.id); } t2.v += S.GAP_MS; }
  assert.deepEqual(ids, ['friends']);
  assert.equal(S.daysUntilNext(g2.state.story, t2.v), 5 - S.storyDay(g2.state.story, t2.v));
});

test('還沒選御三家：故事不開始；開發用的 force 不看日子', () => {
  const t = { v: T0 };
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(1), now: () => t.v });
  assert.equal(g.storyNext(), null);
  g.chooseStarter(653);
  g.storyDone('prologue');
  assert.equal(g.storyNext(), null);
  assert.equal(g.storyNext({ force: true })?.id, 'friends');
});

test('故事的信：直接放進信箱、用寄信的人的名字、不會重複放', () => {
  const t = { v: T0 };
  const g = newGame(t);
  const ev = S.EVENT_BY_ID['lysandre-letter'];
  const l = g.storyLetter(ev);
  assert.equal(l.kind, 'story');
  assert.equal(l.name, '弗拉達利');
  assert.equal(l.from, 'lysandre');
  assert.equal(g.storyLetter(ev), null);
  assert.equal(g.state.letters.inbox.filter(x => x.kind === 'story').length, 1);
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t.v);
  assert.equal(back.letters.inbox.find(x => x.kind === 'story')?.from, 'lysandre');
});

test('存檔與同步：讀回來一樣；壞資料被丟掉；做過的取聯集、開始時間取早的、版本看誰先做序章', () => {
  const t = { v: T0 };
  const g = newGame(t);
  g.storyDone('prologue', { choice: 'x' });
  t.v += DAY; g.storyDone('friends');
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t.v);
  assert.deepEqual(back.story, g.state.story);
  assert.deepEqual(S.normalizeStory({ startedAt: 'x', version: 'z', done: ['nope', 'friends', 'friends'], log: [{ id: 'nope', at: 1 }, { id: 'friends', at: 'x' }] }), { ...S.defaultStory(), done: ['friends'] });
  // 另一台電腦：晚一天才開始、選了 Y
  const t2 = { v: T0 + DAY };
  const h = newGame(t2);
  h.storyDone('prologue', { choice: 'y' });
  const ab = mergeShared(g.state, h.state).story, ba = mergeShared(h.state, g.state).story;
  assert.deepEqual(ab, ba);
  assert.equal(ab.startedAt, T0);
  assert.equal(ab.version, 'x');
  assert.deepEqual(ab.done, ['prologue', 'friends']);
  // 舊存檔沒有 story
  const old = JSON.parse(JSON.stringify(g.state)); delete old.story;
  assert.deepEqual(migrate(old, dex, t.v).story, S.defaultStory());
});

// 跳到某一件事之前：前面的都做完（輸贏不管）
function doneUntil(g, t, id) {
  for (const e of S.EVENTS) {
    if (e.id === id) break;
    if (!e.special) g.storyDone(e.id, e.id === 'prologue' ? { choice: 'x' } : {});
  }
  t.v = g.state.story.startedAt + S.EVENT_BY_ID[id].day * DAY + 2 * HOUR;
}

test('對戰：輸了今天不會再來、隔天再來而且對手弱一點；贏了才算做完', () => {
  const t = { v: T0 };
  const g = newGame(t);
  doneUntil(g, t, 'gym-viola');
  assert.equal(g.storyNext()?.id, 'gym-viola');
  assert.equal(g.storyLost('gym-viola'), true);
  assert.equal(S.lossesOf(g.state.story, 'gym-viola'), 1);
  t.v += S.GAP_MS + 1;
  assert.equal(g.storyNext(), null, '同一天不會再來');
  assert.equal(S.daysUntilNext(g.state.story, t.v), 1);
  t.v += DAY;
  assert.equal(g.storyNext()?.id, 'gym-viola');
  g.storyLost('gym-viola');
  assert.equal(S.lossesOf(g.state.story, 'gym-viola'), 2);
  t.v += DAY;
  assert.equal(g.storyDone('gym-viola'), true);
  assert.equal(g.state.story.retry, null);
  assert.deepEqual(S.badgesOf(g.state.story), ['bug']);
  assert.equal(g.storyLost('gym-viola'), false, '做完的不會再輸');
  assert.equal(g.storyLost('friends'), false, '不是對戰');
  // 存檔讀回來還記得輸過
  g.storyLost('gym-grant');
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t.v);
  assert.deepEqual(back.story.retry, g.state.story.retry);
});

test('獎勵：可爾妮給超級手環＋摔角鷹人進化石；博士給你那一族的進化石；朋友給另外兩族的；不會重複拿', () => {
  const t = { v: T0 };
  const g = newGame(t); // 御三家是哈力栗
  const got = [];
  g.on('item', e => got.push(e.item));
  doneUntil(g, t, 'gym-korrina');
  assert.equal(g.state.bag.items.megaring, false);
  g.storyDone('gym-korrina');
  assert.deepEqual(got, ['megaring', 'hawluchanite']);
  g.storyDone('sycamore-mega');
  assert.equal(g.state.bag.items.chesnaughtite, true);
  assert.equal(g.state.bag.items.delphoxite, false);
  // 布里卡隆有石頭＋手環 → 可以超級進化；摔角鷹人也可以；沒有石頭的烏賊王不行
  const ches = g.createMon(652); g.state.mons.push(ches);
  const haw = g.createMon(701); g.state.mons.push(haw);
  const mal = g.createMon(687); g.state.mons.push(mal);
  assert.equal(g.canMega(ches.uid), true);
  assert.equal(g.canMega(haw.uid), true);
  assert.equal(g.canMega(mal.uid), false);
  const before = g.state.bag.balls.ultra;
  doneUntil(g, t, 'flare-grunt');
  g.storyDone('flare-grunt');
  assert.equal(g.state.bag.balls.ultra, before + 3);
  doneUntil(g, t, 'sycamore-letter');
  g.storyDone('sycamore-letter');
  t.v = g.state.story.startedAt + 45 * DAY + 2 * HOUR;
  assert.equal(g.storyNext()?.id, 'friends-gift');
  g.storyDone('friends-gift');
  assert.equal(g.state.bag.items.delphoxite && g.state.bag.items.greninjite, true);
  const n = got.length;
  g.storyReward(S.EVENT_BY_ID['gym-korrina']);
  assert.equal(got.length, n, '拿過的不會再通知一次');
});

test('你的御三家是哪一族：火狐狸開始的，博士給妖火紅狐進化石', () => {
  const t = { v: T0 };
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(2), now: () => t.v });
  g.chooseStarter(653);
  g.state.mons[0].species = 655; // 進化了
  g.storyReward(S.EVENT_BY_ID['sycamore-mega']);
  assert.equal(g.state.bag.items.delphoxite, true);
  assert.equal(g.state.bag.items.chesnaughtite, false);
});

test('超級手環：蒂安希進化石不需要手環（舊存檔）；其他進化石沒有手環不能超級進化', () => {
  const t = { v: T0 };
  const g = newGame(t);
  const d = g.createMon(719); g.state.mons.push(d);
  const p = g.createMon(668); g.state.mons.push(p);
  g.state.bag.items.diancite = true;
  g.state.bag.items.pyroarite = true;
  assert.equal(g.canMega(d.uid), true);
  assert.equal(g.canMega(p.uid), false);
  g.state.bag.items.megaring = true;
  assert.equal(g.canMega(p.uid), true);
});

test('傳說：X 版主線遇到哲爾尼亞斯、破關後遇到伊裴爾塔爾；不會逃走、比較好抓；沒有隨機出現', () => {
  const t = { v: T0 };
  const g = newGame(t);
  g.storyDone('prologue', { choice: 'x' });
  assert.equal(g.storyLegendPlan(S.EVENT_BY_ID['legend-awaken']).speciesId, 716);
  assert.equal(g.storyLegendPlan(S.EVENT_BY_ID['other-legend']).speciesId, 717);
  const plan = g.storyLegendPlan(S.EVENT_BY_ID['legend-awaken']);
  assert.equal(plan.shiny, false);
  const wild = g.startEncounter(plan);
  assert.equal(wild.story, 'legend-awaken');
  g.state.bag.balls.poke = 200;
  let caught = false, fled = false, throws = 0;
  while (!caught && throws < 100) { const r = g.throwBall(wild, 'poke'); throws++; caught = r.caught; fled ||= r.fled; }
  assert.equal(fled, false);
  assert.ok(caught && throws < 40, `丟了 ${throws} 次`);
  // Y 版反過來
  const t2 = { v: T0 };
  const h = newGame(t2);
  h.storyDone('prologue', { choice: 'y' });
  assert.equal(h.storyLegendPlan(S.EVENT_BY_ID['legend-awaken']).speciesId, 717);
});

test('特別事件：要主線做到那裡、而且時間對（國際刑警晚上才來；另一個傳說看版本）', () => {
  const t = { v: T0 };
  const g = newGame(t);
  doneUntil(g, t, 'az-past'); // flare-hq 做完了
  g.storyDone('az-past');
  const at = (day, hour) => { t.v = new Date(new Date(g.state.story.startedAt).setHours(0, 0, 0, 0) + day * DAY).setHours(hour, 0, 0, 0); };
  at(35, 14);
  assert.equal(g.storyNext(), null, '白天不會來');
  at(35, 21);
  assert.equal(g.storyNext()?.id, 'looker');
  g.storyDone('looker');
  assert.equal(g.state.bag.items.malamarite, true);
  // 破關以後：X 版的另一個傳說（伊裴爾塔爾）晚上來
  doneUntil(g, t, 'sycamore-letter');
  g.storyDone('sycamore-letter');
  g.storyDone('friends-gift');
  at(47, 14);
  assert.equal(g.storyNext(), null);
  at(47, 22);
  assert.equal(g.storyNext()?.id, 'other-legend');
  assert.equal(S.daysUntilNext(g.state.story, t.v), null, '主線說完了');
});

test('同步：輸掉的對戰取比較晚的那次', () => {
  const a = { ...S.defaultStory(), startedAt: T0, retry: { id: 'gym-grant', day: 14, losses: 1 } };
  const b = { ...S.defaultStory(), startedAt: T0, retry: { id: 'gym-grant', day: 15, losses: 2 } };
  assert.deepEqual(S.mergeStory(a, b).retry, { id: 'gym-grant', day: 15, losses: 2 });
  assert.deepEqual(S.mergeStory(b, a).retry, { id: 'gym-grant', day: 15, losses: 2 });
  assert.equal(S.mergeStory({ ...a, done: ['gym-grant'] }, b).retry, null, '有一邊已經贏了');
});
