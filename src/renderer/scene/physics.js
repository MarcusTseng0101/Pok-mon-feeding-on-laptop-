// 夥伴之間的物理：碰撞體積（不會互相穿過去）、擊退、被丟出去時撞到別隻。
// 桌面是從上往下看的平面，所以每隻寶可夢在地上的「腳印」是一個扁的橢圓：
//   橫向半徑 = 圖寬 × 0.35，縱深半徑是橫向的一半左右。
// 重量來自圖鑑（kg），越重越推不動、被打也退得越少。

const FOOT = 0.35; // 腳印橫向半徑佔圖寬的比例
const DEPTH = 0.45; // 縱深方向比較扁
const KNOCK_FRICTION = 0.02; // 擊退速度每秒剩下的比例

export function mass(pet) {
  const w = pet.stage.dex.get(pet.mon.species).weight ?? 10;
  return Math.sqrt(Math.max(0.5, Math.min(500, w)));
}

// 這個狀態下不參與碰撞（被抓著、鑽在地下、半透明的鬼、騎在別隻背上…）
function ghostly(p) {
  if (p.leaving || p.state === 'held' || p.state === 'appear' || p.state === 'evolving') return true;
  if (p.act?.intangible?.(p)) return true;
  if ((p.act?.sink?.(p) ?? 0) > 0.3) return true;
  if (p.habitName === 'ride' && p.state === 'habit') return true;
  if (p.hidden) return true; // 捉迷藏躲起來
  return false;
}

// 兩隻刻意貼在一起的時候（抱抱、蹭蹭、騎背…）不要推開
function together(a, b) {
  const close = ['nuzzle', 'habit', 'greet', 'comfort'];
  return (a.partner === b || b.partner === a) && (close.includes(a.state) || close.includes(b.state));
}

// 高度有沒有重疊（會飄的在上面飛過去就不會撞到）
function heightOverlap(a, b) {
  const a0 = a.alt + a.z, a1 = a0 + a.asset.h * 0.8;
  const b0 = b.alt + b.z, b1 = b0 + b.asset.h * 0.8;
  return a0 < b1 && b0 < a1;
}

// 給一隻寶可夢一個推力（裝置像素／秒），依重量打折
export function knock(pet, vx, vy, { hop = 0 } = {}) {
  if (ghostly(pet)) return;
  const m = mass(pet) / 3;
  pet.kvx = (pet.kvx ?? 0) + vx / Math.max(0.6, m);
  pet.kvy = (pet.kvy ?? 0) + vy / Math.max(0.6, m);
  if (hop && !pet.floats) pet.hopT = Math.max(pet.hopT ?? 0, hop);
  pet.squashT = Math.max(pet.squashT, 0.12);
}

// 從 (x, y) 往外推開某隻（x, y 是桌面平面上的點）
export function knockFrom(pet, x, y, power) {
  const S = pet.S;
  const dx = pet.x - x, dy = (pet.gy - y) / DEPTH;
  const d = Math.hypot(dx, dy) || 1;
  knock(pet, (dx / d) * power * S, (dy / d) * power * S * DEPTH, { hop: power > 200 ? 0.25 : 0 });
}

// 每一幀：套用擊退速度（Pet.update 呼叫）
export function integrateKnock(pet, dt) {
  if (!pet.kvx && !pet.kvy) return;
  if (pet.state === 'held') { pet.kvx = pet.kvy = 0; return; }
  pet.x += pet.kvx * dt;
  pet.gy += pet.kvy * dt;
  const f = Math.pow(KNOCK_FRICTION, dt);
  pet.kvx *= f;
  pet.kvy *= f;
  if (Math.hypot(pet.kvx, pet.kvy) < 4 * pet.S) pet.kvx = pet.kvy = 0;
}

// 每一幀：把重疊的推開；跑太快撞在一起會彈開、被丟出去的會把別隻撞飛
export function resolveCollisions(stage, dt) {
  const pets = [...stage.pets.values()].filter(p => !ghostly(p));
  const now = performance.now();
  for (let i = 0; i < pets.length; i++) {
    for (let j = i + 1; j < pets.length; j++) {
      const a = pets[i], b = pets[j];
      if (together(a, b) || !heightOverlap(a, b)) continue;
      const S = stage.S;
      const rx = (a.asset.w + b.asset.w) * FOOT * S;
      const ry = rx * DEPTH;
      const dx = b.x - a.x, dy = b.gy - a.gy;
      const nd = Math.hypot(dx / rx, dy / ry); // 橢圓空間的距離，< 1 表示重疊
      if (nd >= 1) continue;
      // 推開方向（剛好重疊在同一點時隨便挑一邊）
      let nx = dx / rx, ny = dy / ry;
      if (nd < 1e-4) { nx = Math.random() < 0.5 ? -1 : 1; ny = 0; }
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      const depth = 1 - nd;
      const ma = mass(a), mb = mass(b), sum = ma + mb;
      // 輕的被推比較多；一幀只修正一部分，看起來是軟軟地擠開
      const push = Math.min(1, depth) * 0.6;
      a.x -= nx * rx * push * (mb / sum); a.gy -= ny * ry * push * (mb / sum);
      b.x += nx * rx * push * (ma / sum); b.gy += ny * ry * push * (ma / sum);
      a.clamp(); b.clamp(); // 被擠到螢幕邊邊就停在邊上

      // 相對速度：被丟出去的（fall）用 vx/vy，其他用擊退速度＋這一幀的移動
      const va = velocity(a), vb = velocity(b);
      const rel = (va.x - vb.x) * nx + (va.y - vb.y) * ny; // 正的表示正在互相靠近
      const speed = Math.hypot(va.x - vb.x, va.y - vb.y);
      if (rel > 0 && speed > 140 * S) {
        // 撞擊：動量依重量分配
        const impulse = rel * 0.9;
        const hitter = Math.hypot(va.x, va.y) >= Math.hypot(vb.x, vb.y) ? a : b;
        const other = hitter === a ? b : a;
        const sgn = hitter === a ? 1 : -1;
        const hm = mass(hitter), om = mass(other);
        knock(other, sgn * nx * impulse * (hm / om) * 0.9, sgn * ny * impulse * (hm / om) * 0.9 * DEPTH, { hop: 0.25 });
        if (hitter.state === 'fall') { hitter.vx *= 0.35; hitter.vy *= 0.35; }
        else knock(hitter, -sgn * nx * impulse * 0.3, -sgn * ny * impulse * 0.3 * DEPTH);
        const key = a.uid < b.uid ? `${a.uid}|${b.uid}` : `${b.uid}|${a.uid}`;
        if (!stage.lastBump) stage.lastBump = new Map();
        if (now - (stage.lastBump.get(key) ?? 0) > 700) {
          stage.lastBump.set(key, now);
          const mx = (a.x + b.x) / 2, my = Math.min(a.head().y, b.head().y) + (a.asset.h * S) / 2;
          stage.fx.stars(mx, my, S, speed > 600 * S ? 6 : 3);
          stage.audio.sfx('land');
          // 被撞得很大力：頭暈；普通的撞一下：嚇一跳
          if (other.free || other.state === 'sleep' || other.state === 'nap') {
            if (speed > 700 * S) { other.set('dizzy', 1.2); other.showEmote('@', 1.2); }
            else { other.showEmote('!', 0.8); if (other.state === 'sleep' || other.state === 'nap') other.set('startle', 0.5); }
          }
          stage.fire('bump', hitter, other, speed / S);
        }
      }
    }
  }
}

// 這一幀大概的移動速度（裝置像素／秒）
function velocity(p) {
  if (p.state === 'fall') return { x: p.vx + (p.kvx ?? 0), y: p.vy + (p.kvy ?? 0) };
  const last = p.lastPos ?? { x: p.x, y: p.gy, dt: 1 };
  return { x: (p.kvx ?? 0) + (p.x - last.x) / Math.max(1 / 120, last.dt), y: (p.kvy ?? 0) + (p.gy - last.y) / Math.max(1 / 120, last.dt) };
}
