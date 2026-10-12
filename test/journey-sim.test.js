// 卡洛斯旅行的驗收：模擬一個玩家玩 30 天（假時鐘、固定亂數種子），檢查 docs/JOURNEY.md 的設計原則。
// 機器人照「普通玩家」的方式玩：往前走、打得過就打、沒抓過的就削血再丟球、血少就喝傷藥、打不過道館就回頭練等級。
// 每個動作花的時間（秒）是估的 // 猜的，可調整
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDex } from '../src/core/dex.js';
import { createRng } from '../src/core/rng.js';
import { effectiveness } from '../src/core/types.js';
import * as J from '../src/core/journey.js';

const dex = createDex(JSON.parse(readFileSync(new URL('../data/kalos.json', import.meta.url), 'utf8')));
const T0 = new Date(2026, 9, 12, 8, 0).getTime();
const H = 3_600_000, DAY = 24 * H;
const SEC = { step: 5, turn: 7, throw: 9, heal: 4, talk: 6 };

// 一個會玩的玩家。play() 回傳這一段花了多少秒、做了什麼
function bot(state, rng, now) {
  let t = 0;
  const ctx = J.lifeCtx(now);
  const best = (b) => {
    const v = J.battleView(state, b, dex);
    return [...v.me.moves].sort((x, y) => effectiveness(y.type, v.foe.types) * (v.me.types.includes(y.type) ? 1.2 : 1) - effectiveness(x.type, v.foe.types) * (v.me.types.includes(x.type) ? 1.2 : 1))[0].id;
  };
  const fight = (b, { catchIt = false } = {}) => {
    for (let i = 0; i < 200 && !b.over; i++) {
      if (b.needSwitch) { J.switchTo(state, b, J.lead(state).uid, dex, rng); t += SEC.heal; continue; }
      const me = J.activeMon(state, b), foe = J.foeOf(b);
      const ball = ['ultra', 'great', 'poke'].find(k => state.bag[k] > 0);
      if (catchIt && ball && foe.hp <= 45) { J.throwBall(state, b, ball, rng.range(0.3, 0.8), dex, rng, now); t += SEC.throw; continue; }
      const heal = ['superpotion', 'potion', 'oran'].find(k => state.bag[k] > 0);
      if (me.hp < 30 && heal) { J.useItem(state, b, heal, me.uid, dex, rng); t += SEC.heal; continue; }
      J.useMove(state, b, best(b), dex, rng);
      t += SEC.turn;
    }
    return b.over;
  };
  return {
    // 玩一段：budget 秒用完、或走到一個段落（走完一條路、打完道館）就停
    play(budget) {
      const log = [];
      const startAt = state.at;
      while (t < budget) {
        const a = J.here(state);
        if (a.kind === 'town') {
          if (a.gym && J.blockedBy(state) === 'gym') {
            const lv = J.levelOf(state.party[0]);
            if (lv < a.gym.team.at(-1)[1] - 1) { J.goBack(state); t += SEC.step; log.push('grind'); continue; }
            t += SEC.talk * 2;
            const r = fight(J.gymBattle(state));
            log.push(`gym:${r}`);
            if (r === 'win' || state.at !== startAt) break;
            continue;
          }
          if (!J.goForward(state)) { log.push('end'); break; }
          t += SEC.step;
          continue;
        }
        // 在路上：要練等級（道館打不過）就閒逛，不然往前走
        const grinding = a.id === 'route3' && state.badges.length === 0 && state.beaten.includes('route3#6') && J.levelOf(state.party[0]) < 11;
        if (state.node >= a.nodes && !grinding) {
          J.goForward(state); t += SEC.step;
          log.push(`arrive:${state.at}`); // 走完一條路＝一個段落
          break;
        }
        const e = J.step(state, dex, rng, ctx);
        t += SEC.step;
        if (!e) break;
        if (e.kind === 'trainer') { t += SEC.talk; const r = fight(J.trainerBattle(state, e.trainer)); log.push(`trainer:${r}`); if (r === 'lose') break; }
        if (e.kind === 'wild') {
          const want = !(state.dex[e.wild.species]?.caught > 0);
          const r = fight(J.wildBattle(state, e.wild), { catchIt: want });
          log.push(`wild:${r}`);
          if (r === 'lose') break;
        }
        for (const ev of J.evolutions(state, dex, ctx)) J.evolve(state, ev.uid, ev.to, dex);
      }
      return { secs: t, log };
    },
  };
}

// 看得到、會讓人覺得「少了」的東西
const holdings = s => ({
  mons: s.party.length + s.box.length,
  items: Object.values(s.bag).reduce((a, b) => a + b, 0),
  badges: s.badges.length,
  caught: Object.values(s.dex).filter(d => d.caught > 0).length,
  xp: [...s.party, ...s.box].reduce((a, m) => a + m.xp, 0),
  love: [...s.party, ...s.box].reduce((a, m) => a + m.affection, 0),
  beaten: s.beaten.length,
});

function newPlayer(seed, starter) {
  const s = J.newJourney(T0, seed);
  J.chooseStarter(s, starter, dex, T0, createRng(seed));
  return s;
}

test('原則 1：不懲罰離開——不管離開多久（1 小時～60 天），回來時擁有的東西只會多不會少', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = createRng(seed);
    const s = newPlayer(seed, J.STARTERS[seed % 3]);
    let now = T0;
    for (let k = 0; k < 12; k++) {
      bot(s, rng, now).play(rng.range(180, 900));
      J.touch(s, now);
      const before = holdings(s);
      now += rng.pick([1, 5, 9, 20, 49, 24 * 7, 24 * 60]) * H;
      J.welcomeBack(s, now, rng);
      const after = holdings(s);
      for (const k2 of Object.keys(before)) assert.ok(after[k2] >= before[k2], `seed ${seed}：離開後 ${k2} 從 ${before[k2]} 變 ${after[k2]}`);
      assert.equal(s.at === 'aquacorde' || J.AREA_BY_ID[s.at] !== undefined, true);
    }
  }
});

test('原則 1：沒有被時間鎖住的內容——同樣的玩法壓在 1 天或攤在 30 天，進度一樣', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const run = gapH => {
      const s = newPlayer(seed, 650);
      const rng = createRng(seed * 7);
      let now = T0;
      for (let k = 0; k < 15; k++) { bot(s, rng, T0).play(600); now += gapH * H; J.touch(s, now); }
      return { at: s.at, badges: s.badges.length, beaten: s.beaten.length, caught: holdings(s).caught };
    };
    assert.deepEqual(run(0.1), run(48), `seed ${seed}`);
  }
});

test('原則 2：每一段都有結尾——一條路線（包含訓練家和野生的）大多 10 分鐘內走完、最慢不超過 15 分鐘', t => {
  const times = [];
  for (let seed = 1; seed <= 60; seed++) {
    const rng = createRng(seed);
    const s = newPlayer(seed, J.STARTERS[seed % 3]);
    for (let k = 0; k < 6; k++) {
      const r = bot(s, rng, T0 + k * DAY).play(60 * 60);
      if (r.log.some(x => x.startsWith('arrive:'))) times.push(r.secs);
      if (r.log.some(x => x.endsWith('lose'))) break;
    }
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  const median = times[Math.floor(times.length / 2)];
  t.diagnostic(`走完 ${times.length} 條路線：中位數 ${median} 秒、p95 ${p95} 秒`);
  assert.ok(times.length > 30, `走完的路線太少：${times.length}`);
  assert.ok(median <= 10 * 60, `中位數 ${median} 秒`);
  assert.ok(p95 <= 15 * 60, `p95 ${p95} 秒`);
});

test('原則 3：有難度但不卡關——不練等級直接挑戰道館會有輸有贏；練過的大多會贏；一週玩 3 次、每次 10 分鐘，兩週內拿到第一個徽章', t => {
  let rushWins = 0, rushN = 0, badgeIn14 = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = createRng(seed * 13);
    // 直衝：走到白檀市就直接打
    const s = newPlayer(seed, J.STARTERS[seed % 3]);
    s.at = 'santalune'; s.lastTown = 'santalune';
    s.party[0].xp = J.xpForLevel(9);
    rushN++;
    const b = J.gymBattle(s);
    for (let i = 0; i < 300 && !b.over; i++) {
      if (b.needSwitch) J.switchTo(s, b, J.lead(s).uid, dex, rng);
      else J.useMove(s, b, J.battleView(s, b, dex).me.moves[0].id, dex, rng);
    }
    if (b.over === 'win') rushWins++;
    // 普通玩家：一週 3 次、每次 10 分鐘
    const p = newPlayer(seed, J.STARTERS[seed % 3]);
    let now = T0;
    for (let day = 0; day < 14; day++, now += DAY) {
      if (![1, 3, 6].includes(day % 7)) continue;
      J.welcomeBack(p, now, rng);
      const b2 = bot(p, rng, now);
      // play() 的秒數是這次打開累計的；走到目前做好的最後一個地方（end）就收工
      for (let r = { secs: 0, log: [] }; r.secs < 600 && !r.log.includes('end');) r = b2.play(600);
      J.touch(p, now);
    }
    if (p.badges.length) badgeIn14++;
  }
  const rate = rushWins / rushN;
  t.diagnostic(`9 級直衝道館勝率 ${rate.toFixed(2)}；一週 3 次×10 分鐘，兩週內拿到徽章 ${badgeIn14}/60`);
  assert.ok(rate >= 0.1 && rate <= 0.85, `9 級直衝道館的勝率 ${rate}`);
  assert.ok(badgeIn14 / 60 >= 0.8, `兩週內拿到徽章的比例 ${badgeIn14 / 60}`);
});

test('原則 4：跟生活一起——現實的時段改變遇到的寶可夢（夜晚、清晨不一樣）', () => {
  const count = hour => {
    const s = newPlayer(1, 650);
    J.enter(s, 'route3', { fromEnd: true });
    const rng = createRng(99);
    const ctx = J.lifeCtx(new Date(2026, 9, 14, hour).getTime());
    const c = {};
    for (let i = 0; i < 3000; i++) { const e = J.step(s, dex, rng, ctx); if (e.kind === 'wild') c[e.wild.species] = (c[e.wild.species] ?? 0) + 1; }
    return c;
  };
  const morning = count(7), night = count(22);
  // 3 號道路：清晨飛行（小箭雀 661）多，白天格鬥（頑皮熊貓 674）多
  assert.ok(morning[661] > night[661], JSON.stringify({ morning, night }));
});
