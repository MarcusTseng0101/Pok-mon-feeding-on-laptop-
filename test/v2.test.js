// v2 基礎：存檔升級、形態系統
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate, normalizeTraining, SAVE_VERSION } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import * as forms from '../src/core/forms.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();

// 一份跟 main 分支上真正寫出來的 v1 存檔一樣結構的資料
const V1 = {
  version: 1,
  createdAt: T0 - 86400000,
  lastSeenAt: T0,
  lastDailyGift: '2026-09-25',
  starterChosen: true,
  settings: { musicVolume: 0.3, sfxVolume: 0.5, muted: true, encounterRate: 'high', showLauncher: false, quiet: false },
  bag: { balls: { poke: 7, great: 2, ultra: 4 }, puffs: { 'sweet-basic': 3, 'mint-deluxe': 1, 'spice-fancy': 2 } },
  dex: { 653: { seen: 3, caught: 2, shiny: 1, firstSeenAt: T0 - 5000, firstCaughtAt: T0 - 4000 }, 669: { seen: 1, caught: 1, shiny: 0, firstSeenAt: T0, firstCaughtAt: T0 } },
  mons: [
    { uid: 'abc', species: 653, nickname: '狐狐', nature: 'adamant', shiny: true, ball: 'great', caughtAt: T0 - 4000, affection: 180, fullness: 90, enjoyment: 30, xp: 120, out: true, tasteKnown: true, pos: { x: 0.25, y: 0.8 } },
    { uid: 'def', species: 669, nickname: null, nature: 'hardy', shiny: false, ball: 'poke', caughtAt: T0, affection: 12, fullness: 100, enjoyment: 100, xp: 3, out: false, tasteKnown: false, pos: null },
  ],
  zygardeCells: 4,
  shinyCharm: false,
  chain: { species: 653, count: 2 },
  bonds: { 'abc|def': 77 },
  regenMinutes: 12,
  nextPartnerGiftAt: T0 + 60000,
  stats: { encounters: 20, throws: 15, catches: 2, puffsFed: 9, strokes: 40, evolutions: 0, shinies: 1 },
};

test('存檔 v2：v1 的每一個欄位原封不動保留下來', () => {
  const s = migrate(structuredClone(V1), dex, T0 + 1);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 2);
  for (const k of ['createdAt', 'lastSeenAt', 'lastDailyGift', 'starterChosen', 'zygardeCells', 'shinyCharm', 'chain', 'bonds', 'regenMinutes', 'nextPartnerGiftAt']) {
    assert.deepEqual(s[k], V1[k], k);
  }
  for (const [k, v] of Object.entries(V1.settings)) assert.deepEqual(s.settings[k], v, `settings.${k}`); // 新版多出來的設定用預設值
  assert.deepEqual(s.bag.balls, V1.bag.balls);
  for (const [k, v] of Object.entries(V1.bag.puffs)) assert.equal(s.bag.puffs[k], v, k);
  for (const [id, d] of Object.entries(V1.dex)) assert.deepEqual(s.dex[id], d, `dex ${id}`);
  for (const [k, v] of Object.entries(V1.stats)) assert.equal(s.stats[k], v, k);
  assert.equal(s.mons.length, 2);
  V1.mons.forEach((m, i) => {
    for (const [k, v] of Object.entries(m)) assert.deepEqual(s.mons[i][k], v, `mon ${m.uid}.${k}`);
  });
});

test('存檔 v2：新欄位都有預設值', () => {
  const s = migrate(structuredClone(V1), dex, T0);
  assert.deepEqual(s.mons[0].training, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.equal(s.mons[0].form, null);
  assert.equal(s.mons[0].trimAt, null);
  assert.deepEqual(s.bag.berries, { pecha: 0, chesto: 0, aspear: 0, rawst: 0, cheri: 0 });
  assert.deepEqual(s.bag.items, { diancite: false });
  assert.deepEqual(s.eggs, []);
  assert.deepEqual(s.achievements, {});
  assert.deepEqual(s.focus, { sessions: 0, totalMinutes: 0, streakDays: 0, lastDay: null, active: null });
  assert.equal(s.weather, null);
  assert.equal(s.sync, null);
  for (const k of ['berriesPicked', 'puffsBaked', 'eggsHatched', 'focusSessions', 'perches']) assert.equal(s.stats[k], 0, k);
  // 新遊戲建立的寶可夢也是 v2 的樣子
  const g = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => T0 });
  const mon = g.createMon(669, { form: 'blue' });
  assert.equal(mon.form, 'blue');
  assert.deepEqual(Object.keys(migrate({ mons: [mon] }, dex, T0).mons[0]).sort(), Object.keys(mon).concat('pos').sort());
});

test('存檔 v2：migrate 兩次跟一次一樣', () => {
  const once = migrate(structuredClone(V1), dex, T0);
  const twice = migrate(structuredClone(once), dex, T0);
  assert.deepEqual(twice, once);
  const fresh = migrate(null, dex, T0);
  assert.deepEqual(migrate(structuredClone(fresh), dex, T0), fresh);
});

test('存檔 v2：壞掉的值會被夾回合法範圍', () => {
  const s = migrate({
    bag: { berries: { pecha: -3, cheri: 5000, chesto: NaN, durian: 9 }, items: { diancite: 'yes', masterball: true } },
    mons: [
      { uid: 'a', species: 669, form: 'purple', training: { hp: 999, atk: 300, def: -5, spa: NaN, spd: 100, spe: 100 } },
      { uid: 'b', species: 669, form: 'red' }, // 預設形態存成 null
      { uid: 'c', species: 719, form: 'mega' }, // 超級進化不能存進存檔
      { uid: 'd', species: 653, form: 'blue' }, // 火狐狸沒有形態
      { uid: 'e', species: 666, form: 'polar', trimAt: 'yesterday' },
    ],
    eggs: [
      { uid: 'e1', species: 669, form: 'white', steps: 9e9, need: 500 },
      { uid: 'e2', species: 1, steps: 0, need: 500 }, // 不是卡洛斯
      { uid: 'e3', species: 650, need: 'x' },
      { uid: 'e4', species: 650, need: 100 }, { uid: 'e5', species: 650, need: 100 }, { uid: 'e6', species: 650, need: 100 },
    ],
    dex: { 669: { seen: 2, caught: 1, forms: { blue: { seen: 1, caught: 1 }, red: { seen: -1 }, purple: { seen: 9 } } } },
    achievements: { 'dex-10': T0, 'bad id!': T0, 'x': 'soon' },
    focus: { sessions: -1, totalMinutes: 'a lot', lastDay: '26/9' },
    weather: { city: '中壢', lat: 24.95, lon: 121.22, enabled: 1 },
    sync: { folder: '', deviceId: 'x' },
    stats: { catches: -4, berriesPicked: 'many' },
  }, dex, T0);
  assert.deepEqual(s.bag.berries, { pecha: 0, chesto: 0, aspear: 0, rawst: 0, cheri: 999 });
  assert.deepEqual(s.bag.items, { diancite: true });
  assert.deepEqual(s.mons.map(m => m.form), [null, null, null, null, 'polar']);
  const t = s.mons[0].training;
  assert.deepEqual(t, { hp: 252, atk: 252, def: 0, spa: 0, spd: 6, spe: 0 });
  assert.equal(Object.values(t).reduce((a, b) => a + b, 0), 510);
  assert.equal(s.mons[4].trimAt, null);
  assert.deepEqual(s.eggs.map(e => e.uid), ['e1', 'e4', 'e5']);
  assert.equal(s.eggs[0].steps, 500);
  assert.equal(s.eggs[0].form, 'white');
  assert.deepEqual(s.dex[669].forms, { blue: { seen: 1, caught: 1 }, red: { seen: 0, caught: 0 } });
  assert.deepEqual(s.achievements, { 'dex-10': T0 });
  assert.deepEqual(s.focus, { sessions: 0, totalMinutes: 0, streakDays: 0, lastDay: null, active: null });
  assert.deepEqual(s.weather, { city: '中壢', lat: 24.95, lon: 121.22, enabled: true });
  assert.equal(s.sync, null);
  assert.equal(s.stats.catches, 0);
  assert.equal(s.stats.berriesPicked, 0);
});

test('超級特訓：總和不會超過 510、單項不會超過 252', () => {
  const t = normalizeTraining({ hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 });
  assert.deepEqual(t, { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 });
});

test('形態：圖片 key', () => {
  assert.equal(forms.spriteKey(669), '669');
  assert.equal(forms.spriteKey(669, 'red'), '669');
  assert.equal(forms.spriteKey(669, 'blue'), '669-blue');
  assert.equal(forms.spriteKey(666, 'poke-ball'), '666-poke-ball');
  assert.equal(forms.spriteKey(664, 'polar'), '664'); // 粉蝶蟲看不出花紋
  assert.equal(forms.spriteKey(676, 'la-reine'), '676-la-reine');
  assert.equal(forms.spriteKey(719, 'mega'), '10075');
  assert.equal(forms.spriteKey(658, 'ash'), '10117');
  assert.equal(forms.spriteKey(653, 'blue'), '653'); // 沒有形態的就用原本的圖
  assert.equal(forms.spriteKey(669, '../../etc'), '669');
  assert.equal(forms.speciesOfKey('669-blue'), 669);
  assert.equal(forms.speciesOfKey('10075'), 719);
  assert.equal(forms.speciesOfKey(653), 653);
  for (const [id, f] of Object.entries(forms.FORMS)) {
    assert.equal(f.keys.length, new Set(f.keys).size, `${id} 形態重複`);
    for (const k of f.keys) {
      assert.ok(forms.isSpriteKey(forms.spriteKey(Number(id), k)), `${id}-${k}`);
      assert.ok(forms.FORM_ZH[k], `${k} 沒有中文名稱`);
    }
  }
  assert.equal(forms.FORMS[666].keys.length, 20);
  assert.equal(forms.FORMS[676].keys.length, 10);
  assert.equal(forms.FORMS[669].keys.length, 5);
});

test('形態：圖片 key 驗證擋掉路徑穿越', () => {
  for (const ok of ['650', '669-blue', '666-high-plains', '10075']) assert.ok(forms.isSpriteKey(ok), ok);
  for (const bad of ['../x', '669/../../a', '669-Blue', '669-', '66', '669-blue.png', '', 669, null, '669\\..\\a', 'a669']) {
    assert.equal(forms.isSpriteKey(bad), false, String(bad));
  }
});

test('形態：進化時保留（藍花的花蓓蓓進化兩次變成藍花的花潔夫人）', () => {
  let clock = T0;
  const g = new Game({ dex, state: defaultSave(T0), rng: createRng(1), now: () => clock });
  const mon = g.createMon(669, { form: 'blue' });
  mon.xp = 9999;
  mon.affection = 255;
  g.state.mons.push(mon);
  assert.deepEqual(g.evolve(mon.uid), { from: 669, to: 670, isNewSpecies: true });
  assert.equal(mon.form, 'blue');
  assert.equal(g.evolve(mon.uid, { item: 'shiny-stone' })?.to, 671);
  assert.equal(mon.form, 'blue');
  assert.equal(forms.spriteKey(mon.species, mon.form), '671-blue');
  // 粉蝶蟲在被抓到時就決定的花紋，進化成彩粉蝶才看得到
  const bug = g.createMon(664, { form: 'polar' });
  bug.xp = 9999;
  g.state.mons.push(bug);
  g.evolve(bug.uid);
  assert.equal(forms.spriteKey(bug.species, bug.form), '665');
  g.evolve(bug.uid);
  assert.equal(forms.spriteKey(bug.species, bug.form), '666-polar');
  // 沒有形態的進化線不會多出形態
  assert.equal(forms.inheritForm(650, 651, 'blue'), null);
  assert.equal(forms.inheritForm(669, 670, 'red'), null);
});
