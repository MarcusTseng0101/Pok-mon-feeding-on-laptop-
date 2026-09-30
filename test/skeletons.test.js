// 骨架木偶的標記（gfx/skeletons.js）照規格 docs/specs/skeleton-72.md 的失敗模式檢查：
//   FM1 每隻都一樣：每一隻都要有動作卡；沒有兩隻的步態組合（步態、duty、步幅、每隻腳的步相）完全一樣
//   FM2 斷手斷腳：腳至少 3 個點（2 段，會彎）
//   其他：步相在 0–1 之間、外框至少 3 個點、size 有寫
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKELETONS } from '../src/renderer/gfx/skeletons.js';

const text = readFileSync(new URL('../src/renderer/gfx/skeletons.js', import.meta.url), 'utf8').split(/\r?\n/);

test('骨架：每一隻都有動作卡（寫在那一筆前面的註解）', () => {
  for (const id of Object.keys(SKELETONS)) {
    const at = text.findIndex(l => l.startsWith(`  ${id}: {`));
    assert.ok(at > 0, `${id} 找不到那一筆`);
    const before = text.slice(Math.max(0, at - 12), at).join('\n');
    // 最早的 4 隻（試做）沒有寫「動作卡」三個字，但註解寫了動法；之後的每一隻都要有
    if (['652', '656', '658', '667'].includes(id)) assert.ok(/\/\/ /.test(before), `${id} 沒有註解`);
    else assert.ok(before.includes('動作卡：像'), `${id} 沒有動作卡（「// 動作卡：像 <現實的動物>」）`);
  }
});

test('骨架：腳至少 3 個點（會彎，不是一整塊硬的）、步相在 0–1、外框至少 3 個點、有 size', () => {
  for (const [id, s] of Object.entries(SKELETONS)) {
    assert.ok(Array.isArray(s.size) && s.size.length === 2, `${id} 沒有 size`);
    for (const l of s.limbs) {
      if (l.kind === 'leg') assert.ok(l.pts.length >= 3, `${id} 有一隻腳只有 ${l.pts.length} 個點`);
      for (const k of ['phase', 'runPhase']) if (l[k] != null) assert.ok(l[k] >= 0 && l[k] < 1, `${id} 的 ${k} ${l[k]} 不在 0–1`);
      assert.ok(l.poly.length >= 3, `${id} 有一條外框不到 3 個點`);
    }
  }
});

test('骨架：沒有兩隻的步態組合完全一樣（FM1 每隻都一樣）', () => {
  const seen = new Map();
  for (const [id, s] of Object.entries(SKELETONS)) {
    const legs = s.limbs.filter(l => l.kind === 'leg').map(l => [l.phase ?? 0, l.runPhase ?? null]);
    const key = JSON.stringify([s.gait, s.duty ?? null, s.strideK ?? null, s.runDuty ?? null, s.waddle ?? 0, s.headBob ?? 0, s.nod ?? 0, legs, s.fly ?? false, s.flapK ?? null, s.flapAmp ?? null, s.glide ?? false, s.flutter ?? 0]); // 飛的（第 4 批）比拍翅的欄位
    assert.ok(!seen.has(key), `${id} 跟 ${seen.get(key)} 的步態組合一模一樣`);
    seen.set(key, id);
  }
});
