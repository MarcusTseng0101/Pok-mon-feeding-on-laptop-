// v3 PR 5：寶可夢寫信給你（全部在本機用範本組出來）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as L from '../src/core/letters.js';
import * as M from '../src/core/mind.js';
import { EVENT_KINDS, remember } from '../src/core/memory.js';
import { mergeShared } from '../src/core/sync.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const HOUR = 3_600_000;
const NATURES = dex.natures.map(n => n.slug);
const KINDS = Object.keys(EVENT_KINDS);

// 隨機的一隻寶可夢（隨機的記憶、需求、性格；有些記憶故意缺欄位）
function randomMon(rng) {
  const mon = { uid: 'm', nature: rng.pick(NATURES), fullness: rng.int(0, 255), enjoyment: rng.int(0, 255), mind: M.createMind(rng), memory: [] };
  const n = rng.int(0, 12);
  for (let i = 0; i < n; i++) {
    const k = rng.pick(KINDS);
    const data = rng() < 0.2 ? undefined : { name: rng.pick(['哈力栗', '呆火狐', '<b>壞</b>', '']), puffZh: rng.pick(['甜甜泡芙', undefined]), hours: rng.pick([3, 9, undefined]) };
    remember(mon.memory, { k, with: rng() < 0.5 ? 'x' : undefined, data }, T0 - rng.int(0, 72) * HOUR);
  }
  return mon;
}

test('1000 個隨機存檔：信裡沒有 undefined、null、NaN、{；提到的事在記憶裡真的存在', () => {
  const rng = createRng(11);
  for (let i = 0; i < 1000; i++) {
    const mon = randomMon(rng);
    const kind = rng.pick(Object.keys(L.KINDS));
    const r = L.writeLetter(mon, kind, rng, { now: T0, hours: rng.pick([7, undefined]), place: rng.pick(['鏡面洞窟', undefined]), friend: rng() < 0.5 ? { name: '哈力栗' } : null, rival: rng() < 0.3 ? { name: '呆火狐' } : null });
    assert.ok(!/undefined|null|NaN|[{}]/.test(r.text), `第 ${i} 封：${r.text}`);
    assert.ok(r.text.split('\n').length >= 3, r.text);
    for (const ref of r.refs) assert.ok(mon.memory.some(e => e.k === ref.k && e.at === ref.at), `信裡提到記憶裡沒有的事：${JSON.stringify(ref)}`);
  }
});

test('不重複：100 封裡至少 60 封不同；開頭、結尾在最近 5 封裡不重複', () => {
  const rng = createRng(5);
  const mon = randomMon(rng);
  mon.nature = 'hardy';
  const recent = { open: [], close: [] };
  const texts = new Set();
  const opens = [];
  for (let i = 0; i < 100; i++) {
    const r = L.writeLetter(mon, 'hearts', rng, { now: T0 }, recent);
    texts.add(r.text);
    opens.push(r.openIdx);
    recent.open = [...recent.open, r.openIdx].slice(-5);
    recent.close = [...recent.close, r.closeIdx].slice(-5);
  }
  assert.ok(texts.size >= 60, `${texts.size}`);
  // 每一種語氣的開頭有 6 種、結尾 5 種：連續 5 封開頭都不一樣
  for (let i = 5; i < opens.length; i++) assert.ok(!opens.slice(i - 5, i).includes(opens[i]) || new Set(opens.slice(i - 5, i)).size === 6, `第 ${i} 封開頭和最近的重複`);
});

test('語氣看個性：膽小的害羞、外向的熱情、貪吃的一定提到吃的', () => {
  const rng = createRng(3);
  const base = { uid: 'm', fullness: 150, enjoyment: 150, mind: M.createMind(() => 0.9), memory: [] };
  assert.equal(L.writeLetter({ ...base, nature: 'timid' }, 'hearts', rng).tone, 'shy');
  assert.equal(L.writeLetter({ ...base, nature: 'jolly' }, 'hearts', rng).tone, 'warm');
  const greedy = Object.entries(M.NATURE_TRAITS).find(([, t]) => t.greedy >= 0.6)[0];
  for (let i = 0; i < 20; i++) assert.match(L.writeLetter({ ...base, nature: greedy }, 'hearts', rng).text, /泡芙|餓|吃/);
});

test('會提到競爭對手：「○○是我的對手」或切磋的記憶', () => {
  const rng = createRng(8);
  const mon = { uid: 'm', nature: 'hardy', fullness: 150, enjoyment: 150, mind: M.createMind(() => 0.9), memory: [] };
  remember(mon.memory, { k: 'lost', with: 'x', data: { name: '呆火狐' } }, T0 - HOUR);
  const texts = Array.from({ length: 10 }, () => L.writeLetter(mon, 'hearts', rng, { now: T0, rival: { name: '呆火狐' } }).text);
  assert.ok(texts.every(t => t.includes('呆火狐')), texts.join('\n---\n'));
});

test('Game：離開 7 小時 → 一封「你不在的時候」；每天最多 2 封，剩下的明天寄；打開', () => {
  let t = T0;
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(1), now: () => t });
  g.chooseStarter(650);
  g.state.lastSeenAt = t;
  t += 7 * HOUR;
  g.catchUp();
  const box = g.state.letters;
  assert.equal(box.inbox.length, 1);
  const l = box.inbox[0];
  assert.equal(l.kind, 'away');
  assert.match(l.text, /7個小時/);
  assert.equal(l.name, '哈力栗');
  assert.equal(g.unreadLetters().length, 1);
  g.openLetter(l.id);
  assert.equal(g.unreadLetters().length, 0);
  // 再排 3 封：今天只能再寄 1 封
  const uid = g.state.mons[0].uid;
  for (const k of ['a', 'b', 'c']) L.queue(box, { key: `x-${k}`, kind: 'hearts', uid, due: t });
  g.deliverLetters();
  assert.equal(box.inbox.length, 2);
  assert.equal(box.pending.length, 2);
  t += 24 * HOUR;
  g.deliverLetters();
  assert.equal(box.inbox.length, 4);
  assert.equal(box.pending.length, 0);
  // 同一個 key 不會寄兩次
  assert.equal(L.queue(box, { key: 'x-a', kind: 'hearts', uid, due: t }), false);
});

test('Game：旅行回來 → 隔天早上 9 點寄；好感滿 → 寄一封；生日那天寄一封（每年一次）', () => {
  let t = T0;
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(2), now: () => t });
  g.chooseStarter(650);
  const b = g.createMon(653); b.out = true; g.state.mons.push(b);
  const trip = g.depart(g.state.mons[0].uid);
  t = trip.returnAt + 1000;
  g.settleTrip(g.state.mons[0].uid);
  g.deliverLetters();
  assert.equal(g.state.letters.inbox.filter(l => l.kind === 'trip').length, 0, '當天不寄');
  t = L.nextMorning(t) + 1000;
  g.deliverLetters();
  const tl = g.state.letters.inbox.find(l => l.kind === 'trip');
  assert.ok(tl, '隔天早上寄');
  // 好感滿
  const mon = g.state.mons[1];
  mon.affection = 250;
  g.state.bag.puffs['sweet-deluxe'] = 3;
  g.feed(mon.uid, 'sweet-deluxe');
  t += 2 * 60_000;
  g.deliverLetters();
  assert.ok(g.state.letters.inbox.some(l => l.kind === 'hearts' && l.uid === mon.uid));
  // 生日
  const d = new Date(t);
  g.state.settings.birthday = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  t += 24 * HOUR; // 換一天（每天的上限重算）
  g.state.settings.birthday = L.localDay(t).slice(5);
  g.checkBirthday(t);
  g.checkBirthday(t);
  g.deliverLetters();
  assert.equal(g.state.letters.inbox.filter(l => l.kind === 'birthday').length, 1);
});

test('存檔、同步：讀回來一樣；兩邊的信取聯集、打開過的算打開過；壞的生日被丟掉', () => {
  let t = T0;
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(4), now: () => t });
  g.chooseStarter(650);
  g.state.lastSeenAt = t; t += 8 * HOUR; g.catchUp();
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t);
  assert.deepEqual(back.letters, g.state.letters);
  const A = structuredClone(back), B = structuredClone(back);
  A.letters.inbox[0].opened = true;
  L.queue(B.letters, { key: 'x', kind: 'hearts', uid: back.mons[0].uid, due: t });
  const ab = mergeShared(A, B), ba = mergeShared(B, A);
  assert.deepEqual(ab.letters.inbox, ba.letters.inbox);
  assert.equal(ab.letters.inbox[0].opened, true);
  assert.equal(ab.letters.pending.length, 1);
  assert.deepEqual(mergeShared(ab, B).letters.inbox, ab.letters.inbox);
  assert.equal(migrate({ ...defaultSave(T0), settings: { birthday: '13-40' } }, dex, T0).settings.birthday, null);
  assert.equal(migrate({ ...defaultSave(T0), settings: { birthday: '10-01' } }, dex, T0).settings.birthday, '10-01');
});

test('刪信：收件夾拿掉、記在 deleted；同步時另一台還留著也不會跑回來，也不會再寄一次', () => {
  let t = T0;
  const g = new Game({ dex, state: migrate(defaultSave(T0), dex, T0), rng: createRng(5), now: () => t });
  g.chooseStarter(650);
  g.state.lastSeenAt = t; t += 8 * HOUR; g.catchUp();
  const id = g.state.letters.inbox[0].id;
  const other = structuredClone(g.state); // 另一台電腦：還沒刪
  assert.equal(g.deleteLetter(id), true);
  assert.equal(g.deleteLetter(id), false);
  assert.equal(g.state.letters.inbox.length, 0);
  assert.deepEqual(g.state.letters.deleted, [id]);
  const back = migrate(JSON.parse(JSON.stringify(g.state)), dex, t);
  assert.deepEqual(back.letters.deleted, [id]);
  for (const m of [mergeShared(g.state, other), mergeShared(other, g.state)]) {
    assert.equal(m.letters.inbox.some(l => l.id === id), false);
    assert.ok(m.letters.deleted.includes(id));
  }
  assert.equal(L.queue(g.state.letters, { key: id, kind: 'away', uid: g.state.mons[0].uid, due: t }), false);
  // 舊存檔沒有 deleted：補成空陣列
  const old = structuredClone(other); delete old.letters.deleted;
  assert.deepEqual(migrate(old, dex, t).letters.deleted, []);
});
