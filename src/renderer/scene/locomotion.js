// 移動（規格 PR-N2）：寶可夢怎麼從這裡走到那裡。Pet.moveTo() 全部交給這裡，所以 120 幾個呼叫的地方不用改。
//   - 加速、減速有上限（依身體：core/ethogram.js 的 GAIT.acc），快到的時候照煞車距離慢下來（arrive steering）
//   - 轉身：Pet 的 facing 一換，先停下來轉（turnT，GAIT.turn 秒）再起步；「先轉身再走」
//   - 翻面有遲滯：目標在反方向要持續 FLIP_HOLD 秒才轉，不會在目標附近左右抖（規格 F3）
//   - 被打斷（這一幀沒有人叫 moveTo）還有速度的：照減速度滑一小段停下，不會瞬間停住（規格 F2）
//   - 有腳的：速度不超過「步頻上限 × 一輪走的距離」，走路的動畫照走的距離播（Pet.update），腳不會在地上滑（規格 F1）
// 位置和速度都是裝置像素；stride（步幅）是美術像素（gfx/rig.js 的 info.stride）
import { gaitOf } from '../../core/ethogram.js';
import { footDist, collidesWith } from './physics.js';

const FLIP_HOLD = 0.12; // 秒（猜的，可調整）
const WALK_HZ = 4; // 走路一秒最多幾輪（一輪＝左右腳各一步；腳短的就是快速的小碎步；猜的，可調整）
const RUN_HZ = 6; // 跑（猜的，可調整）
// 跑的時候每一步有騰空，身體往前的距離比腳跨的多（木偶的腳不能畫得跨更開；猜的，可調整）。Pet.settle 播跑步動畫也照這個
export const RUN_STRIDE = 1.5;
const RUN_OVER = 1.5; // 呼叫的人給的速度超過走路速度的幾倍算在跑（決定用哪個步頻上限）
const RUN_REF = 72 / 26; // 跑步速度是走路的幾倍（behaviors.js 的 RUN_SPEED ÷ WALK_SPEED）：加速度的上限照跑步起步算
const ARRIVE = 2; // 離目標幾個美術像素以內算到了
const AVOID = 1.6; // 腳印距離小於這個（1＝剛好碰到）就開始繞

// 這一隻的步態：身體（物種表）＋木偶切出來的腳（有沒有腳、步幅）
export function gait(pet) {
  const g = gaitOf(pet.mon.species);
  const info = pet.view?.anim?.info;
  const stride = info?.hasLegs && !pet.floats ? info.stride ?? 0 : 0; // 美術像素；0＝沒有腳可以踩
  return { ...g, stride };
}

// 這一隻用這個速度（呼叫的人給的，裝置像素／秒）實際能走多快
export function topSpeed(pet, speed, walkSpeed) {
  const g = gait(pet), S = pet.S;
  if (!g.stride) return speed * g.speed;
  const run = speed > walkSpeed * S * RUN_OVER;
  return Math.min(speed, (run ? RUN_HZ * RUN_STRIDE : WALK_HZ) * 2 * g.stride * S); // 一輪走 2 步，一步 stride
}

// 往 (tx, ty) 走一幀；到了回傳 true。speed：裝置像素／秒
export function step(pet, tx, ty, speed, dt, walkSpeed) {
  const S = pet.S, g = gait(pet);
  const lv = (pet.lv ??= { x: 0, y: 0 });
  const vmax = topSpeed(pet, speed, walkSpeed);
  // 加速度上限依身體（規格 F2）：呼叫的人要比跑步還快（衝過去、被叫過去）也不會加速得比跑步起步還猛（規格 M1）
  const acc = Math.min(vmax, topSpeed(pet, walkSpeed * S * RUN_REF, walkSpeed)) / g.acc;
  const dx = tx - pet.x, dy = ty - pet.gy, d = Math.hypot(dx, dy);
  pet.moved = true;
  // 翻面（有遲滯）：目標在背後、而且不是很近，持續 FLIP_HOLD 秒才轉
  if (Math.abs(dx) > 4 * S && Math.sign(dx) !== pet.facing) {
    pet.flipWant = (pet.flipWant ?? 0) + dt;
    if (pet.flipWant >= FLIP_HOLD || Math.hypot(lv.x, lv.y) < acc * dt * 2) { pet.facing = Math.sign(dx); pet.flipWant = 0; } // 停著的直接開始轉
  } else pet.flipWant = 0;
  // 想要的速度：轉身中＝0（先轉再走）；快到了照煞車距離減速
  let want = 0;
  if (!(pet.turnT > 0) && d > ARRIVE * S) want = Math.min(vmax, Math.sqrt(2 * acc * (d - ARRIVE * S * 0.5)));
  let wx = d > 0 ? (dx / d) * want : 0, wy = d > 0 ? (dy / d) * want : 0;
  // 避開擋在前面的夥伴（動物走路會繞過別隻，不會直直撞上去）：腳印快碰到的，往旁邊偏（規格 PR-N2；AVOID 猜的，可調整）
  if (want > 0 && d > 12 * S) {
    for (const o of pet.stage.pets.values()) {
      if (o === pet || o === pet.partner || o.partner === pet || !collidesWith(pet, o)) continue; // 正要走去找的那隻不用繞
      const nd = footDist(pet, o, S);
      if (nd >= AVOID) continue;
      const ox = pet.x - o.x, oy = pet.gy - o.gy, od = Math.hypot(ox, oy) || 1;
      if (ox * wx + oy * wy > 0) continue; // 已經在離開牠了
      const k = want * (1 - nd / AVOID);
      wx += (ox / od) * k; wy += (oy / od) * k;
    }
    const w = Math.hypot(wx, wy);
    if (w > want) { wx *= want / w; wy *= want / w; }
  }
  // 靠近螢幕邊緣：往邊緣那個方向照煞車距離慢下來，不要一頭撞上去被夾住（避開別隻時可能被推向邊邊）
  const b = OFFSCREEN.has(pet.state) ? { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity } : pet.bounds(); // 出門、旅行回來：本來就要走到螢幕外
  const brake = (w, room) => Math.sign(w) * Math.min(Math.abs(w), Math.sqrt(2 * acc * Math.max(0, room)));
  if (wx < 0) wx = brake(wx, pet.x - b.x0); else if (wx > 0) wx = brake(wx, b.x1 - pet.x);
  if (wy < 0) wy = brake(wy, pet.gy - b.y0); else if (wy > 0) wy = brake(wy, b.y1 - pet.gy);
  accelerate(lv, wx, wy, acc * dt);
  const sx = lv.x * dt, sy = lv.y * dt, sd = Math.hypot(sx, sy);
  pet.x += sx; pet.gy += sy;
  pet.walkPhase += sd / (S * 4);
  pet.stepDist = (pet.stepDist ?? 0) + sd / S; // 這一幀走了幾個美術像素（Pet.update 拿去推走路的動畫）
  return d <= ARRIVE * S;
}

// 速度往 (wx, wy) 靠近，一幀最多變 maxDv
function accelerate(lv, wx, wy, maxDv) {
  const ex = wx - lv.x, ey = wy - lv.y, e = Math.hypot(ex, ey);
  if (e <= maxDv) { lv.x = wx; lv.y = wy; return; }
  lv.x += (ex / e) * maxDv; lv.y += (ey / e) * maxDv;
}

// 每一幀最後：這一幀沒有人叫 moveTo、身上還有速度的 → 照減速度滑一小段停下
export function coast(pet, dt, walkSpeed) {
  const lv = pet.lv;
  if (pet.moved) { pet.moved = false; return; }
  if (!lv || (!lv.x && !lv.y)) return;
  if (FROZEN.has(pet.state)) { lv.x = lv.y = 0; return; } // 被拎著、掉下來、出招…：交給那些動作自己管位置
  const g = gait(pet), S = pet.S;
  const acc = topSpeed(pet, walkSpeed * S, walkSpeed) / g.acc;
  accelerate(lv, 0, 0, acc * dt);
  const sx = lv.x * dt, sy = lv.y * dt;
  pet.x += sx; pet.gy += sy;
  pet.stepDist = (pet.stepDist ?? 0) + Math.hypot(sx, sy) / S;
}
const OFFSCREEN = new Set(['depart', 'tripReturn']);
const FROZEN = new Set(['held', 'fall', 'appear', 'evolving', 'depart', 'tripReturn', 'battle', 'move', 'duel', 'faint']);

// 轉身要多久（秒）
export function turnTime(pet) { return gaitOf(pet.mon.species).turn; }

// ---------- 探索：走走停停、微彎的路線 ----------
// 相關隨機漫步（correlated random walk）：每一段的方向跟上一段差一點點（大多在 ±30° 以內），不是直直走到隨機點；
// 間歇式移動（Kramer & McLaughlin 2001）：走一陣就停下來看一看再走。有目的地的走路（去吃、去基地）不停
const LEGS = [3, 4, 5]; // 幾段（PR-N4 從 2–3 段拉長：散步一段 10 秒左右，中間照樣走走停停，規格 M8；猜的，可調整）
const LEG_LEN = [30, 70]; // 一段幾個美術像素（猜的，可調整）
const TURN_SD = 0.5; // 每段轉的角度（弧度）的標準差（猜的，可調整）
const WALK_BEFORE_PAUSE = [0.8, 2]; // 走幾秒就停一下（猜的，可調整）
const PAUSE = [0.5, 1.8]; // 真的停住以後停多久（秒；規格 §3 的停頓是 0.3–2 秒，起步、煞車另外算；猜的，可調整）
const STILL = 2; // 比這個慢（美術像素／秒）才算停住了，停頓才開始算（跟 natural.cjs 的「在動」同一條線）

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// 一條散步的路線：[{ x, y }, …]（裝置像素），出發的方向大致是牠現在面向的那一邊
export function wanderPath(pet) {
  const S = pet.S, b = pet.bounds();
  const n = LEGS[Math.floor(Math.random() * LEGS.length)];
  let heading = (pet.facing > 0 ? 0 : Math.PI) + gauss() * 0.8, x = pet.x, y = pet.gy;
  const out = [];
  for (let i = 0; i < n; i++) {
    const len = (LEG_LEN[0] + Math.random() * (LEG_LEN[1] - LEG_LEN[0])) * S;
    let nx = x + Math.cos(heading) * len, ny = y + Math.sin(heading) * len * 0.7; // 縱深方向比較扁
    // 碰到邊就轉回來（反射），不要貼著邊走
    if (nx < b.x0 + 8 * S || nx > b.x1 - 8 * S) { heading = Math.PI - heading; nx = x + Math.cos(heading) * len; }
    if (ny < b.y0 + 4 * S || ny > b.y1 - 4 * S) { heading = -heading; ny = y + Math.sin(heading) * len * 0.7; }
    x = Math.max(b.x0 + 8 * S, Math.min(b.x1 - 8 * S, nx));
    y = Math.max(b.y0 + 4 * S, Math.min(b.y1 - 4 * S, ny));
    out.push({ x, y });
    heading += gauss() * TURN_SD;
  }
  return out;
}

// 散步中：要不要停下來看一看。回傳 true＝這一幀停著（不要叫 moveTo）。
// 走了 WALK_BEFORE_PAUSE 秒（每次重新抽）就停一下：小動物走幾步就停，不是走很久才偶爾停
export function pauseTick(pet, dt) {
  if (pet.pauseT > 0) {
    // 還在煞車滑行（coast）就不算：以前停頓從開始煞車就算，大鳥煞車要半秒，真的站住只剩 0.2 秒；慢的一邊又會超過 2 秒
    const lv = pet.lv, sliding = lv && Math.hypot(lv.x, lv.y) / pet.S > STILL;
    if (!sliding) pet.pauseT -= dt;
    return true;
  }
  pet.movingT = (pet.movingT ?? 0) + dt;
  pet.nextPause ??= WALK_BEFORE_PAUSE[0] + Math.random() * (WALK_BEFORE_PAUSE[1] - WALK_BEFORE_PAUSE[0]);
  if (pet.movingT >= pet.nextPause) {
    pet.pauseT = PAUSE[0] + Math.random() * (PAUSE[1] - PAUSE[0]);
    pet.movingT = 0;
    pet.nextPause = null;
    return true;
  }
  return false;
}
