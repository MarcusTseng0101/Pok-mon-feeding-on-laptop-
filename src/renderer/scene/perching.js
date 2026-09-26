// 站在其他視窗的頂邊（標題列上）。
//
// 座標模型：平常寶可夢在桌面平面上（x, gy）。站在視窗上時多了 pet.perch = { hwnd }：
// gy 固定在那個視窗的頂邊，只能沿著頂邊左右走，碰撞只跟同一個頂邊上的夥伴算。
// 視窗慢慢移動 → 跟著走；移動得很快、被最小化、被關掉 → 掉下來（沿用 fall 的物理，會撞到地上的夥伴）；
// 頂邊被新打開的視窗蓋住 → 自己跳下來。
import { visibleLedges, ledgeUnder, MAX_PER_LEDGE, SHAKE_OFF_SPEED } from '../../core/perch.js';
import { WALK_SPEED, RUN_SPEED } from './behaviors.js';

const JUMP_TIME = 0.55;

// ---------- 舞台：收到視窗清單 ----------
export function applyWindows(stage, list) {
  const now = performance.now(), dpr = stage.dpr;
  const prev = new Map(stage.windows.map(w => [w.hwnd, w]));
  const dt = Math.max(0.05, (now - (stage.windowsAt ?? now)) / 1000);
  stage.windowsAt = now;
  stage.windows = (list ?? []).map(w => ({ hwnd: w.hwnd, x: w.x * dpr, y: w.y * dpr, w: w.w * dpr, h: w.h * dpr }));
  stage.ledges = visibleLedges(stage.windows);
  for (const p of stage.pets.values()) {
    if (p.perch) follow(p, prev.get(p.perch.hwnd), dt);
    else if (p.state === 'perchUp' && !ledgeUnder(stage.ledges, p.perchJump.hwnd, p.perchJump.x)) cancelJump(p);
  }
}

function follow(pet, before, dt) {
  const st = pet.stage;
  const now = st.windows.find(w => w.hwnd === pet.perch.hwnd);
  if (!now) { dropFromLedge(pet, { vx: 0 }); return; } // 視窗被關掉或最小化
  const dx = now.x - (before?.x ?? now.x), dy = now.y - (before?.y ?? now.y);
  const speed = Math.hypot(dx, dy) / dt / st.dpr; // DIP／秒
  if (speed > SHAKE_OFF_SPEED) { dropFromLedge(pet, { vx: (dx / dt) * 0.6, vy: Math.max(0, dy / dt) * 0.3 }); return; }
  pet.x += dx;
  pet.gy = now.y;
  if (!ledgeUnder(st.ledges, pet.perch.hwnd, pet.x)) dropFromLedge(pet, { hop: true }); // 腳下被別的視窗蓋住了
}

// 這隻站在哪一段頂邊上
export function currentLedge(pet) {
  if (!pet.perch) return null;
  const ls = pet.stage.ledges.filter(l => l.hwnd === pet.perch.hwnd);
  return ls.find(l => pet.x >= l.x0 && pet.x <= l.x1) ?? ls[0] ?? null;
}

// 站在頂邊上時的活動範圍（Pet.bounds 用）
export function perchBounds(pet) {
  const l = currentLedge(pet);
  if (!l) return null;
  const half = (pet.asset.w * pet.S) / 2;
  const x0 = l.x0 + half * 0.6, x1 = Math.max(x0, l.x1 - half * 0.6); // 腳要踩在頂邊上，身體可以稍微超出一點
  return { x0, x1, y0: l.y, y1: l.y };
}

const onLedge = (stage, l) => [...stage.pets.values()].filter(p => (p.perch?.hwnd === l.hwnd && p.x >= l.x0 && p.x <= l.x1) || (p.state === 'perchUp' && p.perchJump.hwnd === l.hwnd)).length;

// 可以站上去的頂邊：夠寬、頭不會超出螢幕、人還沒滿
export function perchCandidates(pet) {
  const st = pet.stage, S = pet.S;
  const need = pet.asset.w * S * 2;
  const headroom = (pet.asset.h + pet.alt + 6) * S;
  return st.ledges.filter(l => l.x1 - l.x0 >= need && l.y >= headroom && l.y < st.H - 40 * S && onLedge(st, l) < MAX_PER_LEDGE);
}

// Pet.decide() 用：地上的寶可夢偶爾會跳到視窗上
export function perchOption(pet) {
  if (pet.perch || pet.stage.env.focus) return [];
  const ls = perchCandidates(pet);
  if (!ls.length) return [];
  return [['perch', pet.floats ? 5 : 3, () => {
    const l = ls[Math.floor(Math.random() * ls.length)];
    const half = pet.asset.w * pet.S;
    const x = l.x0 + half + Math.random() * Math.max(0, l.x1 - l.x0 - 2 * half);
    startPerch(pet, l, x);
  }]];
}

// 站在頂邊上時可以做的事（Pet.decide() 用）
export function perchedChoices(pet) {
  const b = perchBounds(pet);
  const rp = (a, c) => a + Math.random() * (c - a);
  return [
    ['walk', 20, () => { pet.target = { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 }; pet.set('walk'); }],
    ['idle', 14, () => pet.set('idle', rp(2, 6))],
    ['sit', 12, () => pet.set('sit', rp(4, 10))],
    ['look', 8, () => { pet.set('look', rp(1.6, 2.6)); if (Math.random() < 0.4) pet.showEmote('♪', 1.2); }],
    ['nap', pet.stage.env.sleepy ? 20 : 3, () => pet.set('sleep', rp(6, 12))],
    ['down', 7, () => dropFromLedge(pet, { hop: true })],
  ];
}

// 開始往上跳／飛：會走路的先走到正下方，再跳上去
export function startPerch(pet, ledge, x) {
  const S = pet.S;
  const b = pet.bounds();
  const baseY = Math.min(b.y1, Math.max(b.y0, ledge.y + 26 * S)); // 頂邊正下方一點
  pet.perchJump = { hwnd: ledge.hwnd, x, baseY, phase: pet.floats ? 'fly' : 'walk', t: 0, from: null };
  pet.set('perchUp', 25);
  pet.showEmote('!', 0.8);
}

function cancelJump(pet) {
  pet.perchJump = null;
  pet.z = 0;
  pet.set('idle', 1);
}

function land(pet) {
  const st = pet.stage, j = pet.perchJump;
  const l = ledgeUnder(st.ledges, j.hwnd, j.x);
  if (!l) { cancelJump(pet); return; }
  pet.perch = { hwnd: j.hwnd };
  pet.perchJump = null;
  pet.x = j.x;
  pet.gy = l.y;
  pet.z = 0;
  pet.squashT = 0.15;
  pet.set('idle', 1.5);
  pet.showEmote('♪', 1);
  st.audio.sfx('land');
  st.fire('perched', pet);
}

// 從頂邊下來。hop：自己跳下來；否則是被甩下來（視窗移動太快、被關掉）
export function dropFromLedge(pet, { vx = 0, vy = 0, hop = false } = {}) {
  if (!pet.perch) return;
  const st = pet.stage, S = pet.S;
  const ledgeY = pet.gy;
  pet.perch = null;
  // 在桌面平面上找一個落點：往下 60–140 像素（不能超出下緣）。
  // 把 gy 移到落點、z 墊高同樣的量，畫面上的位置不變，然後讓 z 掉到 0 → 看起來就是往下掉
  const b = pet.bounds();
  const drop = Math.max(0, Math.min(b.y1 - ledgeY, (60 + Math.random() * 80) * S));
  if (pet.floats) {
    // 會飄的：慢慢飄下去
    pet.target = { x: pet.x + (Math.random() - 0.5) * 80 * S, y: Math.min(b.y1, ledgeY + drop) };
    pet.set('walk');
    return;
  }
  pet.gy = ledgeY + drop;
  pet.z = drop / S;
  pet.vz = hop ? 90 : 0;
  pet.vx = vx + (hop ? (Math.random() < 0.5 ? -1 : 1) * 40 * S : 0);
  pet.vy = vy;
  pet.clamp();
  pet.set('fall');
  if (!hop) { pet.showEmote('!', 1); st.audio.sfx('grab'); }
}

// ---------- 狀態：跳上去 ----------
export const PERCH_ACTIONS = {
  perchUp: {
    intangible: () => true, // 跳上去的途中不跟別隻碰撞
    update(pet, dt) {
      const j = pet.perchJump, S = pet.S;
      if (!j) { pet.set('idle', 1); return; }
      const l = ledgeUnder(pet.stage.ledges, j.hwnd, j.x);
      if (!l) { cancelJump(pet); return; }
      if (j.phase === 'walk') {
        // 用跑的過去（整個螢幕寬也只要幾秒）
        if (pet.moveTo(j.x, j.baseY, RUN_SPEED * S, dt)) { j.phase = 'jump'; j.t = 0; j.from = { gy: pet.gy }; pet.squashT = 0.15; }
        if (pet.stateT > 20) cancelJump(pet); // 跑太久（被擋住）就算了
        return;
      }
      if (j.phase === 'fly') {
        if (pet.moveTo(j.x, l.y, WALK_SPEED * 2.2 * S, dt)) land(pet);
        return;
      }
      // 跳：腳的位置從地上移到頂邊，同時畫一個拋物線
      j.t += dt;
      const k = Math.min(1, j.t / JUMP_TIME);
      pet.gy = j.from.gy + (l.y - j.from.gy) * k;
      pet.z = Math.sin(k * Math.PI) * 18;
      if (k >= 1) land(pet);
    },
  },
};
