// 故事裡的對戰（core/battle.js）：屬性、變化招式、好感的效果、再挑戰變簡單、進化階段
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import * as B from '../src/core/battle.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const mk = (species, opts) => B.fighter({ species, types: dex.get(species).types, grade: B.gradeOf(dex, species), ...opts });
const TACKLE = { id: 'tackle', type: 'normal' }, EMBER = { id: 'ember', type: 'fire' }, LEAF = { id: 'razorleaf', type: 'grass' };
const fixed = v => () => v;

test('傷害：效果絕佳比較痛、沒有效果不痛、本系加成；4 倍剋制算 2.5 倍', () => {
  const rng = fixed(0.5);
  const fen = () => mk(653, { side: 'you' }); // 火狐狸（火）
  const hit = (att, def, m) => B.attack(att, def, m, rng);
  const vsGrass = hit(fen(), mk(650, { side: 'foe' }), EMBER);
  const vsWater = hit(fen(), mk(656, { side: 'foe' }), EMBER);
  const neutral = hit(fen(), mk(659, { side: 'foe' }), EMBER); // 掘掘兔（一般）
  assert.ok(vsGrass.dmg > neutral.dmg && neutral.dmg > vsWater.dmg);
  assert.equal(vsGrass.eff, 2);
  assert.equal(hit(fen(), mk(679, { side: 'foe' }), TACKLE).dmg, 0, '一般招式打不到幽靈');
  const stab = hit(mk(653, { side: 'you', grade: 1 }), mk(659, { side: 'foe' }), EMBER).dmg, noStab = hit(mk(650, { side: 'you', grade: 1 }), mk(659, { side: 'foe' }), EMBER).dmg;
  assert.ok(stab > noStab, '本系加成');
  // 音波龍（飛行／龍）被冰打是 4 倍 → 算成 2.5 倍
  const ice = hit(mk(659, { side: 'foe' }), mk(715, { side: 'you' }), { id: 'iceshard', type: 'ice' });
  const one = hit(mk(659, { side: 'foe' }), mk(715, { side: 'you' }), TACKLE);
  assert.equal(ice.eff, 4);
  assert.ok(Math.abs(ice.dmg / one.dmg - 2.5 / 1.2) < 0.1, `${ice.dmg} / ${one.dmg}`); // 撞擊有本系加成
});

test('變化招式：防守讓下一下變輕、力量提升讓下一下變重、只有一次', () => {
  const rng = fixed(0.5);
  const a = mk(659, { side: 'foe' }), d = mk(659, { side: 'you' });
  const plain = B.attack(a, d, TACKLE, rng).dmg;
  d.hp = 100;
  assert.equal(B.attack(d, a, { id: 'reflect', type: 'psychic' }, rng).kind, 'status');
  assert.ok(B.attack(a, d, TACKLE, rng).dmg < plain * 0.5);
  assert.equal(B.attack(a, d, TACKLE, rng).dmg, plain, '防守只擋一次');
  B.attack(a, d, { id: 'quiverdance', type: 'bug' }, rng);
  assert.ok(B.attack(a, d, TACKLE, rng).dmg > plain * 1.4);
});

test('好感：很親近的夥伴會躲開、快倒下時撐住一次；對手沒有這些', () => {
  const low = fixed(0.001); // 機率判定全部成立
  const foe = mk(659, { side: 'foe' }), mine = mk(659, { side: 'you', hearts: 5 });
  assert.equal(B.attack(foe, mine, TACKLE, low).kind, 'dodge');
  const mid = fixed(0.2); // 會撐住（25%×2），不會躲開（10%）
  mine.hp = 3;
  const r = B.attack(foe, mine, TACKLE, mid);
  assert.equal(r.endure, true);
  assert.equal(mine.hp, 1);
  mine.hp = 3; mine.endured = false;
  const shy = mk(659, { side: 'you', hearts: 0 });
  shy.hp = 3;
  assert.equal(B.attack(foe, shy, TACKLE, low).fainted, true, '還不親近的不會撐住');
  foe.hp = 3;
  assert.equal(B.attack(mine, foe, TACKLE, low).fainted, true);
});

test('進化階段與再挑戰：最後進化比較強；輸越多次對手越弱，最多弱到一半', () => {
  assert.ok(B.gradeOf(dex, 650) < B.gradeOf(dex, 651) && B.gradeOf(dex, 651) < B.gradeOf(dex, 652));
  assert.equal(B.gradeOf(dex, 716), 1.3);
  assert.equal(B.retryPower(1, 0), 1);
  assert.ok(B.retryPower(1, 1) < 1);
  assert.equal(B.retryPower(1, 50), 0.5);
});

test('對手選招：大多選最有效的', () => {
  const rng = createRng(4);
  const foe = mk(668, { side: 'foe' }), you = mk(650, { side: 'you' });
  let fire = 0;
  for (let i = 0; i < 200; i++) if (B.pickFoeMove(foe, you, [TACKLE, EMBER, { id: 'hypervoice', type: 'normal' }], rng).id === 'ember') fire++;
  assert.ok(fire > 150, fire);
  assert.equal(B.moveHint(EMBER, you).cls, 'super');
  assert.equal(B.moveHint(TACKLE, mk(679, { side: 'foe' })).cls, 'none');
  assert.equal(B.moveHint({ id: 'reflect', type: 'psychic' }, you).cls, 'status');
});

test('平衡：三隻親近的夥伴能打贏第一個道館；一隻剛抓的小寶可夢打不贏冠軍', () => {
  const rng = createRng(9);
  const fight = (team, foes, power) => {
    const f = foes.map(s => mk(s, { side: 'foe', power }));
    const m = team.map(s => mk(s, { side: 'you', hearts: 3 }));
    let i = 0, j = 0;
    while (i < m.length && j < f.length) {
      const best = [TACKLE, LEAF, EMBER].sort((a, b) => B.moveHint(b, f[j]).cls.localeCompare(B.moveHint(a, f[j]).cls))[0];
      B.attack(m[i], f[j], best, rng);
      if (f[j].hp <= 0) { j++; continue; }
      B.attack(f[j], m[i], TACKLE, rng);
      if (m[i].hp <= 0) i++;
    }
    return j >= f.length;
  };
  let w = 0;
  for (let k = 0; k < 200; k++) w += fight([652, 655, 668], [666], 0.75);
  assert.ok(w > 180, `道館：${w}/200`);
  w = 0;
  for (let k = 0; k < 200; k++) w += fight([664], [699, 697, 706], 1.3);
  assert.ok(w < 5, `冠軍：${w}/200`);
});
