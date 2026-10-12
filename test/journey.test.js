// 卡洛斯旅行（手機遊戲）的規則：core/journey.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import * as J from '../src/core/journey.js';
import { HP } from '../src/core/battle.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 9, 12, 9, 0).getTime();
const H = 3_600_000;
const fresh = (starter = 653, seed = 1) => {
  const s = J.newJourney(T0, seed);
  J.chooseStarter(s, starter, dex, T0, createRng(seed));
  return s;
};
const ctx = J.lifeCtx(T0);

test('選最初的夥伴：只能選三隻之一、只能選一次，5 級、有一點好感', () => {
  const s = J.newJourney(T0);
  assert.equal(J.chooseStarter(s, 700, dex, T0, createRng(1)), null);
  const m = J.chooseStarter(s, 656, dex, T0, createRng(1));
  assert.equal(J.levelOf(m), 5);
  assert.ok(m.affection > 0);
  assert.equal(J.chooseStarter(s, 650, dex, T0, createRng(1)), null);
  assert.equal(s.party.length, 1);
  assert.equal(s.dex[656].caught, 1);
});

test('地圖：路線走完才能往前，有道館的城鎮要打贏才能過；城鎮會補血、記成輸了回來的地方', () => {
  const s = fresh();
  assert.equal(J.goForward(s).id, 'route2');
  assert.equal(J.blockedBy(s), 'route');
  assert.equal(J.goForward(s), null);
  s.node = J.here(s).nodes;
  s.party[0].hp = 10;
  for (const id of ['forest', 'route3']) { J.goForward(s); assert.equal(s.at, id); s.node = J.here(s).nodes; }
  assert.equal(s.at, 'route3');
  assert.equal(s.lastTown, 'aquacorde');
  J.goForward(s);
  assert.equal(s.at, 'santalune');
  assert.equal(s.lastTown, 'santalune');
  assert.equal(s.party[0].hp, HP);
  assert.equal(J.blockedBy(s), 'gym');
  J.goBack(s);
  assert.equal(s.at, 'route3');
  assert.equal(s.node, J.here(s).nodes, '往回走是從路的盡頭進去');
});

test('往前走：訓練家固定在那一格、打贏就不再擋路；走到底以後是閒逛（不再前進、沒有訓練家）', () => {
  const s = fresh();
  J.goForward(s);
  const rng = createRng(3);
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(J.step(s, dex, rng, ctx));
  assert.equal(seen[2].kind, 'trainer');
  assert.equal(seen[2].trainer.id, 'route2#3');
  s.beaten.push('route2#3');
  s.node = 2;
  assert.notEqual(J.step(s, dex, rng, ctx).kind, 'trainer');
  s.node = J.here(s).nodes;
  for (let i = 0; i < 30; i++) {
    const e = J.step(s, dex, rng, ctx);
    assert.ok(e.wander);
    assert.notEqual(e.kind, 'trainer');
    if (e.kind === 'wild') assert.ok(J.here(s).pool.includes(e.wild.species));
  }
  assert.equal(s.node, J.here(s).nodes);
});

test('對戰：贏了拿到成長和好感，訓練家記成打贏過', () => {
  const s = fresh(653);
  const b = J.trainerBattle(s, { id: 'route2#3', zh: 't', team: [[650, 3]] }); // 火打草
  const rng = createRng(5);
  let ev = [];
  for (let i = 0; i < 30 && !b.over; i++) ev = ev.concat(J.useMove(s, b, 'ember', dex, rng));
  assert.equal(b.over, 'win');
  assert.ok(ev.some(e => e.kind === 'xp' && e.gain > 0));
  assert.ok(s.beaten.includes('route2#3'));
  assert.ok(s.party[0].xp > J.xpForLevel(5));
});

test('全部倒下：回到上次的城鎮、補滿血，夥伴和道具都還在', () => {
  const s = fresh(650);
  s.bag = { poke: 3, potion: 1 };
  J.goForward(s);
  const b = J.trainerBattle(s, { id: 'x', zh: 't', team: [[663, 40]] });
  const rng = createRng(7);
  for (let i = 0; i < 50 && !b.over; i++) J.useMove(s, b, 'tackle', dex, rng);
  assert.equal(b.over, 'lose');
  assert.equal(s.at, 'aquacorde');
  assert.equal(s.party[0].hp, HP);
  assert.deepEqual(s.bag, { poke: 3, potion: 1 });
  assert.ok(!s.beaten.includes('x'));
});

test('捕獲：血越少越好抓（滿血跟桌面一樣）；抓到的進隊伍、滿 6 隻進箱子；野生的一定逃得掉', () => {
  assert.equal(J.hpCatchMult(1), 1);
  assert.equal(J.hpCatchMult(0), 3);
  const s = fresh();
  s.bag = { ultra: 99 };
  const wild = { species: 659, lv: 3, hp: 5, nature: 'hardy', shiny: false, form: null };
  const rng = createRng(11);
  for (let n = 0; n < 6; n++) {
    const b = J.wildBattle(s, { ...wild });
    for (let i = 0; i < 20 && !b.over; i++) J.throwBall(s, b, 'ultra', 0.3, dex, rng, T0);
    if (b.over !== 'caught') n--;
  }
  assert.equal(s.party.length, 6);
  assert.equal(s.box.length, 1);
  const b = J.wildBattle(s, { ...wild });
  assert.deepEqual(J.run(s, b), [{ kind: 'ran' }]);
  assert.equal(J.run(s, J.trainerBattle(s, { id: 'y', zh: 't', team: [[659, 3]] })).length, 0);
});

test('沒有球不能丟、傷藥只能給還沒倒下又沒滿血的', () => {
  const s = fresh();
  s.bag = {};
  const b = J.wildBattle(s, { species: 659, lv: 3, hp: HP, nature: 'hardy' });
  assert.deepEqual(J.throwBall(s, b, 'poke', 0.3, dex, createRng(1)), []);
  s.bag = { potion: 1 };
  const uid = s.party[0].uid;
  assert.deepEqual(J.useItem(s, null, 'potion', uid, dex, createRng(1)), []);
  s.party[0].hp = 30;
  J.useItem(s, null, 'potion', uid, dex, createRng(1));
  assert.equal(s.party[0].hp, 70);
  assert.equal(s.bag.potion, undefined);
});

test('走路：開機總步數變小（重開機）當作從 0 算、一天有上限、帶頭的夥伴成長和好感', () => {
  const s = fresh();
  assert.deepEqual(J.addSteps(s, 5000, T0), { walked: 0 }, '第一次只記下來');
  const m = s.party[0];
  const xp0 = m.xp, aff0 = m.affection;
  const r = J.addSteps(s, 5000 + 4000, T0 + H);
  assert.equal(r.walked, 4000);
  assert.equal(m.xp - xp0, 4000 / J.STEPS_PER_XP);
  assert.ok(m.affection > aff0);
  assert.equal(J.addSteps(s, 300, T0 + 2 * H).walked, 300, '重開機');
  assert.equal(J.addSteps(s, 300 + 100000, T0 + 3 * H).walked, J.DAY_CAP - 4300);
  assert.equal(J.addSteps(s, 300 + 100000 + 500, T0 + 30 * H).walked, 500, '隔天重新算');
});

test('離開再回來：8 小時以上才有禮物、最多算 7 天；回來不會少任何東西', () => {
  const s = fresh();
  s.lastSeen = T0;
  assert.equal(J.welcomeBack(s, T0 + 2 * H, createRng(1)).gifts.length, 0);
  assert.equal(J.welcomeBack(s, T0 + 2 * H + 17 * H, createRng(1)).gifts.length, 2);
  const r = J.welcomeBack(s, T0 + 400 * 24 * H, createRng(1));
  assert.equal(r.gifts.length, J.GIFT_MAX);
});

test('存檔：缺欄位補預設、壞掉的寶可夢丟掉、超過 6 隻的放進箱子；舊的 lastSeen 保留', () => {
  const raw = { party: [...Array(7)].map((_, i) => ({ uid: i + 1, species: 650, xp: 40 })).concat([{ nope: 1 }]), bag: { poke: 2, fake: 9, potion: -1 }, at: 'nowhere', lastSeen: 123 };
  const s = J.normalizeJourney(raw, T0);
  assert.equal(s.party.length, 6);
  assert.equal(s.box.length, 1);
  assert.deepEqual(s.bag, { poke: 2 });
  assert.equal(s.at, 'aquacorde');
  assert.equal(s.lastSeen, 123);
  assert.equal(s.nextUid, 8);
  assert.deepEqual(J.normalizeJourney(null, T0).party, []);
  assert.deepEqual(J.normalizeJourney(JSON.parse(JSON.stringify(s)), T0), s, '存了再讀一樣');
});

test('進化：成長夠了（原作等級 × 8）就可以進化', () => {
  const s = fresh();
  s.party = [J.makeMon(s, 661)]; // 小箭雀：17 級
  assert.equal(J.evolutions(s, dex, ctx).length, 0);
  s.party[0].xp = J.xpForLevel(17);
  const e = J.evolutions(s, dex, ctx);
  assert.deepEqual(e.map(x => x.to), [662]);
  J.evolve(s, e[0].uid, 662, dex);
  assert.equal(s.party[0].species, 662);
  assert.equal(s.dex[662].caught, 1);
});

test('每個地方的寶可夢、訓練家、道館都是圖鑑裡有的', () => {
  for (const a of J.AREAS) {
    for (const id of a.pool ?? []) assert.ok(dex.has(id), `${a.id} ${id}`);
    for (const t of a.trainers ?? []) for (const [id] of t.team) assert.ok(dex.has(id));
    for (const [id] of a.gym?.team ?? []) assert.ok(dex.has(id));
    if (a.gym) assert.ok(J.GYM_LINES[a.gym.leader] && J.BADGE_ZH[a.gym.badge]);
  }
});
