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

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const HOUR = 3_600_000, DAY = 24 * HOUR;

function newGame(t) {
  const g = new Game({ dex, state: migrate(defaultSave(t.v), dex, t.v), rng: createRng(3), now: () => t.v });
  g.chooseStarter(650);
  return g;
}

test('事件資料：id 不重複、照日子排序、說話的人都在登場人物裡、台詞不是空的', () => {
  const ids = S.EVENTS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < S.EVENTS.length; i++) assert.ok(S.EVENTS[i].day >= S.EVENTS[i - 1].day, S.EVENTS[i].id);
  for (const e of S.EVENTS) {
    assert.ok(['call', 'broadcast', 'letter', 'visit'].includes(e.kind), e.id);
    assert.ok(e.title, e.id);
    if (e.kind === 'letter') { assert.ok(S.CAST[e.from], e.id); assert.ok(e.text.length > 20 && e.text.length <= 600, e.id); continue; }
    assert.ok(e.lines.length > 0, e.id);
    for (const [who, text] of [...e.lines, ...(e.after ?? [])]) { assert.ok(S.CAST[who], `${e.id} ${who}`); assert.ok(text.length > 0 && text.length < 120, `${e.id} ${text}`); }
  }
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
  for (let i = 0; i < 20; i++) {
    const ev = g.storyNext();
    if (!ev) { t.v += 60_000; continue; }
    seen.push(ev.id);
    g.storyDone(ev.id);
    assert.equal(g.storyNext(), null, '剛做完一件，下一件要等');
    t.v += S.GAP_MS - 1;
    assert.equal(g.storyNext(), null);
    t.v += 1;
  }
  assert.deepEqual(seen, S.EVENTS.slice(1).map(e => e.id));
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
