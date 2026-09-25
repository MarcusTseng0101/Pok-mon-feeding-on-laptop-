// PR 2：卡洛斯形態（花蓓蓓花色、彩粉蝶花紋、多麗米亞美容、超級蒂安希、牽絆甲賀忍蛙）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { defaultSave, migrate } from '../src/core/save.js';
import { Game } from '../src/core/game.js';
import { rollForm, planSpawn } from '../src/core/encounter.js';
import { vivillonForTimeZone, VIVILLON_BY_TZ } from '../src/core/vivillon.js';
import { FORMS, spriteKey } from '../src/core/forms.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 8, 25, 14, 0).getTime();
const DAY = 24 * 3600 * 1000;
const ctx = (extra = {}) => ({ hour: 14, weekday: 5, cpuHot: false, justPluggedIn: false, returnedFromIdle: false, lure: null, timeZone: 'Asia/Taipei', ...extra });

function newGame(seed = 1) {
  let clock = T0;
  const game = new Game({ dex, state: defaultSave(T0), rng: createRng(seed), now: () => clock });
  game.advance = ms => { clock += ms; };
  return game;
}

test('花蓓蓓：野生的五種花色都會出現，大致平均', () => {
  const rng = createRng(7);
  const count = {};
  for (let i = 0; i < 5000; i++) { const f = rollForm(669, ctx(), rng) ?? 'red'; count[f] = (count[f] ?? 0) + 1; }
  assert.deepEqual(Object.keys(count).sort(), ['blue', 'orange', 'red', 'white', 'yellow']);
  for (const n of Object.values(count)) assert.ok(n > 800 && n < 1200, JSON.stringify(count));
  // 沒有形態的寶可夢不會多出形態
  assert.equal(rollForm(653, ctx(), rng), null);
  assert.equal(rollForm(676, ctx(), rng), null); // 野生的多麗米亞是原本的樣子
});

test('彩粉蝶：依時區決定花紋（跟原作的 3DS 地區設定一致）', () => {
  // 這幾個是原作裡很有名的對應，可以拿來抽查產生出來的表
  assert.equal(vivillonForTimeZone('Asia/Taipei'), 'monsoon');
  assert.equal(vivillonForTimeZone('Asia/Tokyo'), 'elegant');
  assert.equal(vivillonForTimeZone('Europe/Paris'), 'meadow');
  assert.equal(vivillonForTimeZone('Europe/London'), 'garden');
  assert.equal(vivillonForTimeZone('Pacific/Honolulu'), 'ocean');
  assert.equal(vivillonForTimeZone('Asia/Singapore'), 'jungle');
  assert.equal(vivillonForTimeZone('America/Sao_Paulo'), 'savanna');
  assert.equal(vivillonForTimeZone('Asia/Calcutta'), vivillonForTimeZone('Asia/Kolkata')); // 舊名稱
  // 查不到就用預設
  assert.equal(vivillonForTimeZone('UTC'), 'meadow');
  assert.equal(vivillonForTimeZone(undefined), 'meadow');
  for (const p of Object.values(VIVILLON_BY_TZ)) assert.ok(FORMS[666].keys.includes(p), p);
  assert.ok(!Object.values(VIVILLON_BY_TZ).includes('fancy') && !Object.values(VIVILLON_BY_TZ).includes('poke-ball'), '配信限定的花紋不會從地區決定');
  // 粉蝶蟲一族都拿到同一個花紋；雪國花紋的獎勵可以覆蓋（之後成就用）
  const rng = createRng(1);
  assert.equal(rollForm(664, ctx(), rng), 'monsoon');
  assert.equal(rollForm(666, ctx({ timeZone: 'Asia/Tokyo' }), rng), 'elegant');
  assert.equal(rollForm(664, ctx({ vivillon: 'fancy' }), rng), 'fancy');
  assert.equal(rollForm(664, ctx({ timeZone: 'Europe/Paris' }), rng), null); // 預設花紋存成 null
});

test('遭遇 → 捕獲：形態跟著寶可夢，圖鑑分形態記錄', () => {
  const g = newGame();
  g.chooseStarter(650);
  const wild = g.startEncounter({ speciesId: 669, form: 'blue', spot: 'grass', shiny: false, nature: 'hardy', special: false });
  assert.deepEqual(g.state.dex[669].forms, { blue: { seen: 1, caught: 0 } });
  g.state.bag.balls.ultra = 50;
  let r;
  for (let i = 0; i < 50 && !r?.caught && !wild.gone; i++) r = g.throwBall(wild, 'ultra', 2.5);
  assert.ok(r.caught, '要抓到才能測');
  assert.equal(r.mon.form, 'blue');
  assert.deepEqual(g.state.dex[669].forms.blue, { seen: 1, caught: 1 });
  // 紅花（預設）用 'red' 記
  g.startEncounter({ speciesId: 669, form: null, spot: 'grass', shiny: false, nature: 'hardy', special: false });
  assert.deepEqual(g.state.dex[669].forms.red, { seen: 1, caught: 0 });
  // 進化後新的寶可夢也記在同一個花色
  r.mon.xp = 9999;
  g.evolve(r.mon.uid);
  assert.deepEqual(g.state.dex[670].forms.blue, { seen: 1, caught: 1 });
  // 存檔讀回來還在
  const back = migrate(structuredClone(g.state), dex, T0);
  assert.deepEqual(back.dex[669].forms, g.state.dex[669].forms);
  assert.equal(back.mons.find(m => m.uid === r.mon.uid).form, 'blue');
});

test('planSpawn 會帶上形態', () => {
  const g = newGame(3);
  g.chooseStarter(650);
  const rng = createRng(3);
  let seen = 0;
  for (let i = 0; i < 3000 && seen < 5; i++) {
    const plan = planSpawn(ctx(), g.state, dex, rng);
    assert.ok('form' in plan);
    if (FORMS[plan.speciesId]?.family === 'vivillon') { assert.equal(plan.form, 'monsoon'); seen++; }
    if (!FORMS[plan.speciesId]) assert.equal(plan.form, null);
  }
  assert.ok(seen > 0, '3000 次都沒遇到粉蝶蟲一族');
});

test('多麗米亞美容：花一個泡芙、好感 +10、5 天後長回來', () => {
  const g = newGame();
  const mon = g.createMon(676);
  g.state.mons.push(mon);
  const puff = 'sweet-basic';
  const puffs = g.state.bag.puffs[puff];
  assert.equal(g.trim(mon.uid, 'natural', puff).ok, false); // 不能選「野生的樣子」
  assert.equal(g.trim(mon.uid, 'mohawk', puff).ok, false);
  const other = g.createMon(653);
  g.state.mons.push(other);
  assert.equal(g.trim(other.uid, 'heart', puff).ok, false);
  const events = [];
  g.on('trimmed', e => events.push(['trimmed', e.style]));
  g.on('trimExpired', e => events.push(['expired', e.uid]));
  assert.deepEqual(g.trim(mon.uid, 'kabuki', puff), { ok: true });
  assert.equal(mon.form, 'kabuki');
  assert.equal(mon.affection, 10);
  assert.equal(g.state.bag.puffs[puff], puffs - 1);
  assert.equal(spriteKey(mon.species, mon.form), '676-kabuki');
  assert.equal(g.state.dex[676].forms.kabuki.caught, 1);
  g.advance(5 * DAY - 60_000);
  g.tick();
  assert.equal(mon.form, 'kabuki', '還不到 5 天');
  g.advance(120_000);
  g.tick();
  assert.equal(mon.form, null);
  assert.equal(mon.trimAt, null);
  assert.deepEqual(events, [['trimmed', 'kabuki'], ['expired', mon.uid]]);
  // 關著遊戲過了 5 天，打開時也會長回來
  g.state.bag.puffs[puff] = 1;
  g.trim(mon.uid, 'star', puff);
  g.advance(6 * DAY);
  g.catchUp();
  assert.equal(mon.form, null);
  // 沒有泡芙不能剪（catchUp 可能剛發了每日禮物，先清空）
  g.state.bag.puffs[puff] = 0;
  assert.equal(g.trim(mon.uid, 'star', puff).reason, 'no-puff');
});

test('超級蒂安希：好感第一次滿了拿到進化石，只給一次；超級進化不會存進存檔', () => {
  const g = newGame();
  const d = g.createMon(719);
  g.state.mons.push(d);
  const items = [];
  g.on('item', e => items.push(e.item));
  assert.equal(g.canMega(d.uid), false);
  d.affection = 250;
  g.state.bag.puffs['sweet-deluxe'] = 5;
  d.fullness = 0;
  g.feed(d.uid, 'sweet-deluxe');
  assert.equal(d.affection, 255);
  assert.equal(g.state.bag.items.diancite, true);
  assert.equal(g.canMega(d.uid), true);
  d.fullness = 0;
  g.feed(d.uid, 'sweet-deluxe');
  assert.deepEqual(items, ['diancite']);
  // 其他寶可夢不能超級進化
  const f = g.createMon(653);
  g.state.mons.push(f);
  assert.equal(g.canMega(f.uid), false);
  // 就算畫面不小心把 mega 寫進 mon.form，讀存檔時也會被清掉
  d.form = 'mega';
  assert.equal(migrate(structuredClone(g.state), dex, T0).mons.find(m => m.uid === d.uid).form, null);
});

test('牽絆甲賀忍蛙：好感滿、而且有最好的朋友（感情 200）才可以', () => {
  const g = newGame();
  const gr = g.createMon(658);
  const friend = g.createMon(653);
  g.state.mons.push(gr, friend);
  assert.equal(g.canBondForm(gr.uid), false);
  gr.affection = 255;
  assert.equal(g.canBondForm(gr.uid), false, '還沒有好朋友');
  g.bond(gr.uid, friend.uid, 199);
  assert.equal(g.canBondForm(gr.uid), false);
  g.bond(gr.uid, friend.uid, 1);
  assert.equal(g.canBondForm(gr.uid), true);
  gr.affection = 254;
  assert.equal(g.canBondForm(gr.uid), false);
  assert.equal(g.canBondForm(friend.uid), false);
});
