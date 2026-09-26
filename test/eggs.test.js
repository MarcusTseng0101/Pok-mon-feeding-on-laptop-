// PR 4：孵蛋
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as eggs from '../src/core/eggs.js';
import { EGG_DATA } from '../src/core/eggdata.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const DAY = 24 * 3600 * 1000;

function newGame(seed = 1) {
  let clock = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(seed), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}
function bestFriends(g, a, b) {
  const x = g.createMon(a); const y = g.createMon(b);
  x.out = y.out = true;
  g.state.mons.push(x, y);
  g.bond(x.uid, y.uid, 220);
  return [x, y];
}

test('蛋的資料：72 種都有；傳說和幻之寶可夢不會生蛋', () => {
  assert.equal(Object.keys(EGG_DATA).length, 72);
  for (const id of [716, 717, 718, 719, 720, 721]) assert.equal(eggs.canBreed(id), false, id);
  assert.equal(eggs.canBreed(653), true);
  assert.equal(eggs.canBreed(703), true); // 小碎鑽可以
});

test('蛋：生出來的是最初型態，花色／花紋跟著父母，多麗米亞的造型不遺傳', () => {
  assert.equal(eggs.baseForm(dex, 655), 653);
  assert.equal(eggs.baseForm(dex, 671), 669);
  assert.equal(eggs.baseForm(dex, 653), 653);
  const rng = createRng(3);
  assert.deepEqual(eggs.eggFrom(dex, [{ uid: 'a', species: 671, form: 'blue' }, { uid: 'b', species: 719, form: null }], rng), { species: 669, form: 'blue', parent: 'a' });
  assert.deepEqual(eggs.eggFrom(dex, [{ uid: 'a', species: 666, form: 'polar' }], rng), { species: 664, form: 'polar', parent: 'a' });
  assert.equal(eggs.eggFrom(dex, [{ uid: 'a', species: 676, form: 'heart' }], rng).form, null);
  assert.equal(eggs.eggFrom(dex, [{ uid: 'a', species: 716 }, { uid: 'b', species: 717 }], rng), null);
});

test('蛋：每天一次機會，要有最好的朋友兩隻都在桌面上；最多 3 顆', () => {
  const g = newGame(5);
  g.createMon(650);
  assert.equal(g.maybeFindEgg(), null);
  assert.equal(g.state.eggDay, null, '沒有符合的一對時，今天的機會不會被用掉');
  bestFriends(g, 653, 656);
  let found = 0;
  for (let day = 0; day < 40; day++) {
    if (g.maybeFindEgg()) found++;
    assert.equal(g.maybeFindEgg(), null, '同一天只有一次');
    g.advance(DAY);
  }
  assert.equal(g.state.eggs.length, 3);
  assert.equal(found, 3);
  for (const e of g.state.eggs) {
    assert.ok([653, 656].includes(e.species));
    assert.equal(e.need, 20 * eggs.STEPS_PER_CYCLE);
  }
});

test('蛋：步數＝游標距離／1000＋操作秒數／10；孵出來會登記圖鑑、會出來桌面', () => {
  const g = newGame(2);
  g.state.eggs.push({ uid: 'e1', species: 704, form: null, shiny: false, steps: 0, need: eggs.eggNeed(704), receivedAt: T0 });
  assert.equal(eggs.eggNeed(704), 40 * eggs.STEPS_PER_CYCLE);
  const ready = [];
  g.on('eggReady', e => ready.push(e.uid));
  g.addEggSteps(1000 * 100, 10 * 100); // 200 步
  assert.equal(g.state.eggs[0].steps, 200);
  assert.equal(g.hatchEgg('e1'), null, '還沒好');
  g.addEggSteps(1e9, 0);
  assert.equal(g.state.eggs[0].steps, g.state.eggs[0].need);
  g.addEggSteps(1e9, 0);
  assert.deepEqual(ready, ['e1'], '只通知一次');
  const mon = g.hatchEgg('e1');
  assert.equal(mon.species, 704);
  assert.equal(mon.affection, eggs.HATCH_AFFECTION);
  assert.equal(mon.out, true);
  assert.equal(g.state.dex[704].caught, 1);
  assert.equal(g.state.eggs.length, 0);
  assert.equal(g.state.stats.eggsHatched, 1);
});

test('蛋：一般使用 1–3 天孵出來（大部分 20 週期、黏黏寶 40 週期）', () => {
  // 一天：開著電腦 4 小時、游標大約移動 60 萬像素（猜的使用量）
  const perDay = eggs.stepsFrom(600_000, 4 * 3600);
  const days = c => (c * eggs.STEPS_PER_CYCLE) / perDay;
  assert.ok(days(20) >= 0.8 && days(20) <= 2, `20 週期要 ${days(20).toFixed(1)} 天`);
  assert.ok(days(40) >= 1.5 && days(40) <= 3.5, `40 週期要 ${days(40).toFixed(1)} 天`);
});

test('蛋：存檔讀回來，蛋和今天找過了沒都還在', () => {
  const g = newGame(5);
  bestFriends(g, 653, 656);
  g.state.eggs.push({ uid: 'e1', species: 669, form: 'blue', shiny: true, steps: 55, need: 2400, receivedAt: T0 });
  g.state.eggDay = '2026-09-25';
  const back = migrate(structuredClone(g.state), dex, T0);
  assert.deepEqual(back.eggs, g.state.eggs);
  assert.equal(back.eggDay, '2026-09-25');
});
