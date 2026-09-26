// PR 5：獎章
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { ACHIEVEMENTS, REWARD_FANCY_AT, newlyUnlocked } from '../src/core/achievements.js';
import { rollForm } from '../src/core/encounter.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();

function newGame() {
  let clock = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}

test('獎章：大約 25 個，id 不重複、都有名稱和說明；新存檔一個都沒有', () => {
  assert.ok(ACHIEVEMENTS.length >= 24 && ACHIEVEMENTS.length <= 30, ACHIEVEMENTS.length);
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) { assert.ok(a.name && a.desc, a.id); assert.match(a.id, /^[a-z0-9-]{1,40}$/); }
  assert.deepEqual(newlyUnlocked(defaultSave(T0)), []);
});

test('獎章：事情發生時自動解鎖，只通知一次，時間會記下來', () => {
  const g = newGame();
  const got = [];
  g.on('achievement', e => got.push(e.id));
  g.chooseStarter(653);
  assert.deepEqual(got, ['dex-1']);
  assert.equal(g.state.achievements['dex-1'], T0);
  g.tick();
  assert.deepEqual(got, ['dex-1'], '不會重複通知');
  // 餵泡芙 100 次
  g.state.stats.puffsFed = 99;
  const m = g.state.mons[0];
  m.fullness = 0;
  g.feed(m.uid, 'sweet-basic');
  assert.ok(got.includes('fed-100'));
  // 好感滿、最好的朋友
  const b = g.createMon(656); g.state.mons.push(b);
  g.bond(m.uid, b.uid, 210);
  assert.ok(got.includes('best-friends'));
});

test('獎章：收集 20 個給幻彩花紋、全部收集給球球花紋，各一次；抓到那隻就用掉', () => {
  const g = newGame();
  const rewards = [];
  g.on('vivillonReward', e => rewards.push(e.form));
  // 直接把 19 個標成已解鎖
  for (const a of ACHIEVEMENTS.slice(0, REWARD_FANCY_AT - 1)) g.state.achievements[a.id] = T0;
  g.checkAchievements();
  assert.deepEqual(rewards, []);
  g.state.achievements[ACHIEVEMENTS[REWARD_FANCY_AT - 1].id] = T0;
  g.checkAchievements();
  assert.deepEqual(rewards, ['fancy']);
  assert.deepEqual(g.state.pendingVivillon, ['fancy']);
  for (const a of ACHIEVEMENTS) g.state.achievements[a.id] = T0;
  g.checkAchievements();
  g.checkAchievements();
  assert.deepEqual(rewards, ['fancy', 'poke-ball']);
  // 下一隻粉蝶蟲是幻彩花紋
  assert.equal(rollForm(664, { timeZone: 'Asia/Taipei', vivillon: g.state.pendingVivillon[0] }, createRng(1)), 'fancy');
  // 抓到了就換下一個
  g.chooseStarter(650);
  const wild = g.startEncounter({ speciesId: 664, form: 'fancy', spot: 'grass', shiny: false, nature: 'hardy', special: false });
  g.state.bag.balls.ultra = 99;
  let r; for (let i = 0; i < 60 && !r?.caught && !wild.gone; i++) r = g.throwBall(wild, 'ultra', 2.5);
  assert.ok(r.caught);
  assert.equal(r.mon.form, 'fancy');
  assert.deepEqual(g.state.pendingVivillon, ['poke-ball']);
  // 存檔讀回來
  const back = migrate(structuredClone(g.state), dex, T0);
  assert.deepEqual(back.pendingVivillon, ['poke-ball']);
  assert.deepEqual(back.achievementRewards, { fancy: true, pokeBall: true });
});

test('獎章：各種條件', () => {
  const s = defaultSave(T0);
  const check = id => ACHIEVEMENTS.find(a => a.id === id).check(s);
  s.dex[669] = { seen: 5, caught: 5, forms: { red: { seen: 1, caught: 1 }, yellow: { seen: 1, caught: 1 }, orange: { seen: 1, caught: 1 }, blue: { seen: 1, caught: 1 }, white: { seen: 1, caught: 0 } } };
  assert.equal(check('flabebe-5'), false);
  s.dex[669].forms.white.caught = 1;
  assert.equal(check('flabebe-5'), true);
  s.dex[676] = { seen: 1, caught: 1, forms: { natural: { seen: 1, caught: 1 } } };
  for (const f of ['heart', 'star', 'diamond', 'debutante', 'matron', 'dandy', 'la-reine', 'kabuki']) s.dex[676].forms[f] = { seen: 1, caught: 1 };
  assert.equal(check('furfrou-9'), false, '只剪了 8 種');
  s.dex[676].forms.pharaoh = { seen: 1, caught: 1 };
  assert.equal(check('furfrou-9'), true);
  s.mons.push({ training: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 } });
  assert.equal(check('training-max'), true);
  for (const id of [716, 717]) s.dex[id] = { seen: 1, caught: 1 };
  assert.equal(check('legend-trio'), false);
  s.dex[718] = { seen: 1, caught: 1 };
  assert.equal(check('legend-trio'), true);
});
