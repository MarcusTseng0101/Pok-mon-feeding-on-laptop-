// 骨架木偶：手、腳、尾巴有關節（髖 → 膝 → 腳踝 → 腳掌、肩 → 肘 → 手），每一段繞自己的關節轉，腳踩在地上不滑。
//
// gfx/rig.js 的像素木偶是自動切的：腳只是最下面一條左右平移、手整根繞肩膀轉，看起來像斷手斷腳。
// 這裡改成每一隻手動標好的骨架（gfx/skeletons.js）：
//   1. 每一條手腳是一串關節點＋一個外框；框裡的像素分給離它最近的那一段骨頭（標記見 skeletons.js）
//   2. 蒙皮：關節附近的像素同時跟著上下兩段動（照距離分），膝蓋、手肘是彎過去的，不會斷成兩塊
//   3. 畫法：原圖用 Scale2x 放大 4 倍（只複製原本的格子），每一小格照它的骨頭算新位置，落到最近的格子。
//      像素永遠是方的、顏色都是原圖有的，轉的時候也不會有洞（一格會收到 16 小格）
//   4. 腳用反向運動（兩段 IK）：先決定腳踝在哪（踩在地上的那一點），膝蓋自己彎。身體往前走、往下蹲，腳都留在原地
//   5. 步態照真實動物：兩腳交替（人、蛙、鳥）、四腳側對步（貓、獅子：後左 → 前左 → 後右 → 前右）
// 參數跟 rig.js 一樣（lean、crouch、headPitch、breath、legL/legR、arm/tail/ear…），另外多兩個：
//   gait 步相（0–1，走路、跑步這一輪走到哪）、gaitAmt 走路的程度（0＝站著、1＝全速走：停下來時腳慢慢收回來）
import { makeCanvas } from './pixel.js';
import { ANG_STEP, PART_MAX, LIMITS } from './rig.js';

const PAD = 10; // 四周（下面除外）留幾格：大步跨出去的腳、舉高的手不會被切掉 // 猜的，可調整
const SEAM = 2.5; // 身體上靠近手腳根部幾格內，跟著手腳動一點（根部不會裂開） // 猜的，可調整
export const GAIT_STEPS = 16; // 一輪走路切幾張（量化） // 猜的，可調整
export const GAIT_AMT_STEPS = 4; // 走路的程度分幾級 // 猜的，可調整

const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// Scale2x（跟 gfx/rig.js 一樣）：放大 2 倍，只複製原本的格子，不混色
function scale2x(src, w, h) {
  const out = new Uint32Array(w * 2 * h * 2), W2 = w * 2;
  const P = (x, y) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const B = P(x, y - 1), D = P(x - 1, y), E = P(x, y), F = P(x + 1, y), H = P(x, y + 1);
    let e0 = E, e1 = E, e2 = E, e3 = E;
    if (B !== H && D !== F) { if (D === B) e0 = D; if (B === F) e1 = F; if (D === H) e2 = D; if (H === F) e3 = F; }
    const o = y * 2 * W2 + x * 2;
    out[o] = e0; out[o + 1] = e1; out[o + W2] = e2; out[o + W2 + 1] = e3;
  }
  return out;
}
const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const angOf = ([x, y]) => Math.atan2(y, x);

// 點到多邊形的邊最近多遠
const polyDist = (poly, x, y) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, y, poly[j], poly[i])); return d; };
const MARGIN = 1.5; // 外框外面幾格內、跟這條手腳連著的像素也算它（標框差一格，外框線不會留在原地變成一條散落的點） // 猜的，可調整
const N8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
const N4 = N8.slice(0, 4); // 往外走只走上下左右：像素畫的外框線是斜著一格一格接的，走斜的會從兩格外框線中間鑽過去

// 把每一格像素分給誰：limbs 的外框優先（照 skeletons.js 的順序，先標的先拿），再來是頭，剩下的是身體
//   分給這條手腳的哪一段：照「沿著這條手腳的像素走過去的距離」最近的那一段（Meta AnimatedDrawings 的做法），
//   不是直線距離——直線距離會把折起來的腳（大腿貼著小腿）分錯，動起來散成點。走不到的（框裡跟骨頭不連著的小塊）才用直線距離
//   pix（可以不給）：原圖的顏色。給了的話，畫家畫的深色外框線就是手腳的邊：從骨頭往外走，走到外框線停（外框線本身算手腳）。
//   框裡越過外框線才到得了、又跟身體連著的像素（例：大腿上端外框線另一邊的肚子）還給身體——不然腳一擺，大腿的外框線會轉進肚子中間
const DARK = 150; // R+G+B 小於這個算外框線（寶可夢的圖外框都接近黑色） // 猜的，可調整
const isDark = c => (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255) < DARK;
export function assign(spec, alpha, W, H, pix = null) {
  const owner = new Int16Array(W * H).fill(-2); // -2 透明、-1 身體、0… 第幾段（segs 的索引）
  const segs = [];
  spec.limbs.forEach((l, li) => { for (let k = 0; k + 1 < l.pts.length; k++) segs.push({ limb: li, k, a: l.pts[k], b: l.pts[k + 1] }); });
  const headSeg = spec.head ? segs.push({ limb: -1, k: 0, a: spec.head.pivot, b: spec.head.pivot }) - 1 : -1;
  const limbOf = new Int16Array(W * H).fill(-1); // 這格屬於第幾條手腳
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (alpha[i] <= 40) continue;
    owner[i] = -1;
    const cx = x + 0.5, cy = y + 0.5;
    const li = spec.limbs.findIndex(l => inPoly(l.poly, cx, cy));
    if (li >= 0) limbOf[i] = li;
    else if (spec.head && inPoly(spec.head.poly, cx, cy)) owner[i] = headSeg;
  }
  // 外框邊緣外 MARGIN 格內的身體像素：跟這條手腳的像素連著、而且已經過了根部（沿第一段的方向超過 SEAM 格；根部附近留給蒙皮接縫）就算這條手腳
  spec.limbs.forEach((l, li) => {
    const [a, b] = [l.pts[0], l.pts[1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const take = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (owner[i] !== -1 || limbOf[i] >= 0) continue;
      const cx = x + 0.5, cy = y + 0.5;
      if (polyDist(l.poly, cx, cy) > MARGIN) continue;
      if (((cx - a[0]) * (b[0] - a[0]) + (cy - a[1]) * (b[1] - a[1])) / L <= SEAM) continue;
      if (N8.some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < W && Y < H && limbOf[Y * W + X] === li; })) take.push(i);
    }
    for (const i of take) limbOf[i] = li;
  });
  // 每條手腳：從每一段骨頭經過的格子同時出發，沿著這條手腳自己的像素往外走（8 方向），先走到的那一段拿這格；同時走到的比直線距離
  const dist = new Float32Array(W * H).fill(Infinity);
  spec.limbs.forEach((l, li) => {
    const mine = s => s.limb === li;
    let front = [];
    segs.forEach((s, si) => {
      if (!mine(s)) return;
      const n = Math.max(1, Math.ceil(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) * 4));
      for (let t = 0; t <= n; t++) {
        const x = Math.floor(s.a[0] + (s.b[0] - s.a[0]) * t / n), y = Math.floor(s.a[1] + (s.b[1] - s.a[1]) * t / n);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (limbOf[i] !== li) continue;
        const d = segDist(x + 0.5, y + 0.5, s.a, s.b);
        if (dist[i] > 0 || d < segDist(x + 0.5, y + 0.5, segs[owner[i]].a, segs[owner[i]].b)) { if (dist[i] > 0) front.push(i); dist[i] = 0; owner[i] = si; }
      }
    });
    for (let step = 1; front.length; step++) {
      const next = [];
      for (const i of front) {
        if (pix && step > 1 && isDark(pix[i])) continue; // 外框線：走到這裡停（骨頭正好壓在外框線上的起點例外）
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of N4) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (limbOf[j] !== li) continue;
          if (dist[j] === Infinity) { dist[j] = step; owner[j] = owner[i]; next.push(j); }
          else if (dist[j] === step && owner[j] !== owner[i]) {
            const s1 = segs[owner[i]], s0 = segs[owner[j]];
            if (segDist(X + 0.5, Y + 0.5, s1.a, s1.b) < segDist(X + 0.5, Y + 0.5, s0.a, s0.b)) owner[j] = owner[i];
          }
        }
      }
      front = next;
    }
    // 走不到、但跟身體連著的（外框線另一邊）：還給身體
    if (pix) {
      let fr = [];
      for (let i = 0; i < W * H; i++) {
        if (limbOf[i] !== li || dist[i] !== Infinity) continue;
        const x = i % W, y = (i / W) | 0;
        if (N8.some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < W && Y < H && owner[Y * W + X] === -1 && limbOf[Y * W + X] < 0; })) fr.push(i);
      }
      while (fr.length) {
        const next = [];
        for (const i of fr) {
          if (limbOf[i] !== li) continue;
          limbOf[i] = -1; owner[i] = -1;
          const x = i % W, y = (i / W) | 0;
          for (const [dx, dy] of N4) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (limbOf[j] === li && dist[j] === Infinity) next.push(j); }
        }
        fr = next;
      }
    }
    // 還是走不到的（框裡跟骨頭、身體都不連著的小塊）：直線距離最近的那一段
    for (let i = 0; i < W * H; i++) if (limbOf[i] === li && dist[i] === Infinity) {
      const cx = (i % W) + 0.5, cy = ((i / W) | 0) + 0.5;
      let best = Infinity, bi = -1;
      segs.forEach((s, si) => { if (mine(s)) { const d = segDist(cx, cy, s.a, s.b); if (d < best) { best = d; bi = si; } } });
      owner[i] = bi;
    }
  });
  return { owner, segs, headSeg };
}

// 回傳跟 rig.js 的 buildRig 一樣的介面：{ sets, pose, target, stats, cache, w, h, info }
export function buildSkeleton(srcCanvas, spec) {
  const W = srcCanvas.width, H = srcCanvas.height;
  const img = srcCanvas.getContext('2d').getImageData(0, 0, W, H);
  const pix = new Uint32Array(img.data.slice().buffer);
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = img.data[i * 4 + 3];
  const { owner, segs, headSeg } = assign(spec, alpha, W, H, pix);
  const nb = segs.length + 1, BODY = segs.length; // 骨頭：segs 的每一段（含頭）＋身體
  const parentOf = si => { const s = segs[si]; if (s.limb >= 0 && s.k > 0) return si - 1; return BODY; };
  const childOf = si => { const s = segs[si]; const n = segs[si + 1]; return n && s.limb >= 0 && n.limb === s.limb && n.k === s.k + 1 ? si + 1 : -1; };
  const lenOf = s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  // 關節附近多大一圈兩段一起動（蒙皮）：短的那一段的 0.4 倍，2–5 格（越大彎得越圓，太大整段都軟掉） // 猜的，可調整
  const blendR = (p, c) => Math.max(SEAM, Math.min(5, 0.4 * Math.min(p >= 0 && p < BODY ? lenOf(segs[p]) || 99 : 99, lenOf(segs[c]) || 99)));
  // 每一格像素：主要跟哪一根骨頭（b1）、關節附近另外跟哪一根（b2，占 w2，0–0.5）
  const b1 = new Int16Array(W * H), b2 = new Int16Array(W * H).fill(-1), w2 = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = owner[i];
    if (o < -1) continue;
    const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
    if (o === -1) {
      b1[i] = BODY;
      // 身體上靠近手腳根部、脖子的：跟著那一段動一點（根部不會裂開）
      let best = SEAM, bs = -1;
      segs.forEach((s, si) => { if (s.k === 0) { const d = Math.hypot(x - s.a[0], y - s.a[1]); if (d < best) { best = d; bs = si; } } });
      if (bs >= 0) { b2[i] = bs; w2[i] = 0.5 * (1 - best / SEAM); }
      continue;
    }
    b1[i] = o;
    const s = segs[o], L = lenOf(s), dir = L ? [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L] : [0, 0];
    const u = L ? (x - s.a[0]) * dir[0] + (y - s.a[1]) * dir[1] : Math.hypot(x - s.a[0], y - s.a[1]); // 從這一段的根部往末端量
    const P = parentOf(o), rP = blendR(P, o);
    if (u < rP) { b2[i] = P; w2[i] = 0.5 * Math.min(1, 1 - u / rP); continue; }
    const C = childOf(o);
    if (C >= 0) { const v = L - u, rC = blendR(o, C); if (v < rC) { b2[i] = C; w2[i] = 0.5 * (1 - v / rC); } }
  }
  // 手腳底下補身體（underlay）：畫在前面的手腳，第一段（大腿、上臂）上端本來疊在身體上，手腳一移開那裡就空了。
  // 照黑白版畫家的做法（把被擋住的地方補畫出來），用規則補：從身體（不是外框線的）像素往手腳裡面延伸 FILL 格，顏色照最近的身體像素。
  // 補的像素跟著身體動、畫在身體後面（手腳在的時候被手腳蓋住，移開才看得到）。不會有原圖沒有的顏色
  const FILL = 3; // 往手腳裡面補幾格 // 猜的，可調整
  const under = new Uint32Array(W * H);
  {
    const ok = i => { const o = owner[i]; if (o < 0 || o === headSeg) return false; const s = segs[o]; return s.k === 0 && spec.limbs[s.limb].layer === 'front'; };
    let front = [];
    for (let i = 0; i < W * H; i++) {
      if (owner[i] !== -1 && owner[i] !== headSeg) continue;
      if (isDark(pix[i])) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (ok(j) && !under[j]) { under[j] = pix[i]; front.push(j); } }
    }
    for (let d = 1; d < FILL && front.length; d++) {
      const next = [];
      for (const i of front) { const x = i % W, y = (i / W) | 0; for (const [dx, dy] of N8) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = Y * W + X; if (ok(j) && !under[j]) { under[j] = under[i]; next.push(j); } } }
      front = next;
    }
  }
  // 畫的時候用放大 4 倍的原圖（Scale2x 兩次：只複製原本的格子，斜邊比較順），每一小格算新位置、落到最近的格子
  const big = scale2x(scale2x(pix, W, H), W * 2, H * 2), BW = W * 4;

  const face = spec.facing ?? -1; // 圖面向哪邊（-1 左）：「往前」是這個方向
  const limbs = spec.limbs.map((l, li) => {
    const idx = segs.map((s, si) => (s.limb === li ? si : -1)).filter(si => si >= 0);
    const len = idx.map(si => Math.hypot(segs[si].b[0] - segs[si].a[0], segs[si].b[1] - segs[si].a[1]));
    const rest = idx.map(si => angOf([segs[si].b[0] - segs[si].a[0], segs[si].b[1] - segs[si].a[1]]));
    // 膝蓋往哪邊彎：照原圖（大腿到腳踝那條線的哪一側）
    let bend = 1;
    if (l.kind === 'leg' && l.pts.length >= 3) {
      const [h, k, a] = l.pts;
      bend = Math.sign((k[0] - h[0]) * (a[1] - h[1]) - (k[1] - h[1]) * (a[0] - h[0])) || 1;
    }
    return { ...l, idx, len, rest, bend };
  });
  const legs = limbs.filter(l => l.kind === 'leg');
  const legLen = legs.length ? Math.max(...legs.map(l => l.len[0] + (l.len[1] ?? 0))) : 0;
  // 一步多大：腳在身體底下前後各走 A 格（腿長的 0.3 倍；真實動物慢走一步約腿長的 0.6–0.8 倍；猜的，可調整）
  const A = Math.max(2, Math.round(legLen * (spec.strideK ?? 0.3)));
  const duty = spec.duty ?? (spec.gait === 'hop' ? 0.5 : legs.length >= 4 ? 0.65 : 0.6); // 腳踩在地上的時間占一輪的幾成（慢走 0.6–0.7） // 猜的，可調整
  const lift = Math.max(1, Math.round(legLen * (spec.liftK ?? 0.2))); // 腳抬多高 // 猜的，可調整

  // 腳這一刻要在哪（相對於原圖的腳踝）：ph 這隻腳自己的步相
  const footAt = (ph, amt) => {
    ph = ((ph % 1) + 1) % 1;
    let x, y, pitch = 0;
    if (ph < duty) { const u = ph / duty; x = A - 2 * A * u; y = 0; } // 踩著：身體往前，腳相對往後
    else { const u = (ph - duty) / (1 - duty), s = u * u * (3 - 2 * u); x = -A + 2 * A * s; y = -lift * Math.sin(Math.PI * u); pitch = 0.35 * Math.sin(Math.PI * u); } // 抬起來往前擺，腳尖先垂下
    return [face * x * amt, y * amt, pitch * amt];
  };
  // 每一隻腳的步相差：兩腳交替 0、0.5；四腳側對步 後左 0、前左 0.25、後右 0.5、前右 0.75；跳的兩腳一起
  const offsetOf = l => l.phase ?? 0;
  // 走路時身體起伏：最低到最高差幾格（腿長的 0.06 倍，至少 1 格）；最低在著地後一點點（下沉） // 猜的，可調整
  const BOB = Math.max(1, Math.round(legLen * 0.06)), S_DOWN = 0.15;
  const nearLeg = legs.find(l => l.side === 'near') ?? legs[0];
  const nearPh = nearLeg ? offsetOf(nearLeg) : 0;
  const swayDir = nearLeg ? Math.sign(nearLeg.pts[0][0] - spec.root[0]) || 1 : 1; // 近的那隻腳在身體的哪一邊

  // 兩段 IK：hip → 目標 t，長度 a、b，膝蓋往 bend 那側。回傳兩段的絕對角度
  const ik = (hip, t, a, b, bend) => {
    const dx = t[0] - hip[0], dy = t[1] - hip[1];
    const d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, Math.hypot(dx, dy)));
    const base = Math.atan2(dy, dx);
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const A1 = base - bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
    const kx = hip[0] + a * Math.cos(A1), ky = hip[1] + a * Math.sin(A1);
    return [A1, Math.atan2(t[1] - ky, t[0] - kx)];
  };

  const bodyAngle = q => (q.lean ?? 0) * 0.04 * -face; // 前傾：往前的方向低頭（lean 負＝往前；一格約 2.3°） // 猜的，可調整
  function frame(q) {
    const OW = W + PAD * 2, OH = H + PAD;
    const amt = (q.gaitAmt ?? 0) / GAIT_AMT_STEPS, gph = (q.gait ?? 0) / GAIT_STEPS;
    // 身體：下沉 crouch 格；走路時一步起伏一次，照動畫的四個姿勢（The Animator's Survival Kit）：
    //   著地（s＝0，前腳剛踩下）→ 下沉（最低，S_DOWN，重量壓到前腳上）→ 交錯（兩腳錯身）→ 抬起（最高，推地那一下）→ 下一步著地
    //   s 是「這一步」走到哪（一輪兩步：近的腳著地 s＝0、遠的腳著地又是 0）
    const s = ((2 * (gph - nearPh)) % 1 + 1) % 1;
    const bob = legs.length && spec.gait !== 'hop' ? Math.round(amt * BOB * (0.5 + 0.5 * Math.cos(2 * Math.PI * (s - S_DOWN)))) : 0;
    const hopUp = spec.gait === 'hop' ? -Math.round(amt * lift * 1.5 * Math.max(0, Math.sin(2 * Math.PI * gph))) : 0;
    const by = (q.crouch ?? 0) + bob + hopUp;
    // 左右換重心（正面的圖才看得到，spec.sway 格）：身體往踩著地、撐著重量的那隻腳偏；近的腳踩地的正中間偏最多
    const bx = spec.sway && legs.length ? Math.round(amt * spec.sway * Math.cos(2 * Math.PI * (gph - nearPh - duty / 2))) * swayDir : 0;
    const bAng = bodyAngle(q);
    const root = spec.root;
    // 身體上一點（原圖座標）→ 這一刻的位置
    const onBody = p => { const r = rot([p[0] - root[0], p[1] - root[1]], bAng); return [root[0] + r[0] + bx, root[1] + r[1] + by]; };
    // 每一根骨頭這一刻的樣子：繞原圖的 a 轉 th，a 移到 J
    const xf = new Array(nb);
    xf[BODY] = { a: root, th: bAng, J: [root[0] + bx, root[1] + by] };
    if (headSeg >= 0) {
      const hp = spec.head.pivot, J = onBody(hp);
      J[1] += (q.headPitch ?? 0) - (q.breath ?? 0);
      xf[headSeg] = { a: hp, th: bAng + (q.headPitch ?? 0) * 0.08 * -face, J };
    }
    for (const l of limbs) {
      let at = onBody(l.pts[0]), angs;
      if (l.kind === 'leg') {
        // 腳踝的目標：原本的位置＋步伐（踩在地上的時候不跟著身體動）；另外 legL/legR 是習性指定的抬腳
        const [fx, fy, pitch] = footAt(gph + offsetOf(l), amt);
        const extra = l.side === 'far' ? q.legR : q.legL;
        const ank = l.pts[2] ?? l.pts[1];
        const tgt = [ank[0] + fx - (extra?.[0] ?? 0) * face, ank[1] + fy + (extra?.[1] ?? 0)];
        const [a1, a2] = ik(at, tgt, l.len[0], l.len[1] ?? 0.01, l.bend);
        angs = [a1 - l.rest[0], a2 - l.rest[1]];
        if (l.idx.length > 2) angs.push(-face * pitch); // 腳掌：踩著時保持原本的角度（平貼地面），抬起來時腳尖垂
      } else {
        // 手、尾巴、耳朵：整串一起彎（加上身體的角度）
        const k = l.kind, raise = l.raise ?? (k === 'tail' ? -face : face);
        const alt = l.side === 'far' ? -1 : 1;
        const total = Math.max(-PART_MAX, Math.min(PART_MAX, raise * (q[k] ?? 0) + alt * (q[k + 'Sw'] ?? 0)));
        const n = l.idx.length;
        angs = l.idx.map((_, j) => (k === 'arm' ? (j === 0 ? total : j === 1 ? -0.5 * total : 0) : total / n)); // 尾巴、耳朵：每一節轉一樣多，加起來末端轉 total
        if (k === 'arm' && amt) {
          // 走路時手跟對側的腳一起前後擺：手尖要往前（facing）移。垂直往下的手轉一點就是前後擺；橫著伸的手轉了只是上下，所以幾乎不擺
          const s = Math.cos(2 * Math.PI * (gph + (l.phase ?? 0))), v = [l.pts[l.pts.length - 1][0] - l.pts[0][0], l.pts[l.pts.length - 1][1] - l.pts[0][1]];
          const along = Math.hypot(...v) ? v[1] / Math.hypot(...v) : 0;
          angs[0] += -face * (l.swing ?? 0.2) * amt * s * along;
        }
      }
      let abs = l.kind === 'leg' ? 0 : bAng;
      l.idx.forEach((si, j) => {
        if (l.kind === 'leg') abs = angs[j] ?? 0; else abs += angs[j] ?? 0;
        const s = segs[si];
        xf[si] = { a: s.a, th: abs, J: at };
        const v = rot([s.b[0] - s.a[0], s.b[1] - s.a[1]], abs);
        at = [at[0] + v[0], at[1] + v[1]];
      });
    }
    for (const t of xf) if (t) { t.c = Math.cos(t.th); t.s = Math.sin(t.th); }
    // 前後：後面的手腳 0、身體 1、頭 2、前面的手腳 3；同一條手腳越末端越上面
    const layer = new Float32Array(nb);
    layer[BODY] = 1;
    if (headSeg >= 0) layer[headSeg] = 2;
    for (const l of limbs) l.idx.forEach((si, j) => { layer[si] = (l.layer === 'front' ? 3 : 0) + j * 0.01; });
    // 落點：每一格留「層最上面、而且最靠近格子中心」的那一小格
    const out = makeCanvas(OW, OH), o = out.getContext('2d');
    const id = o.createImageData(OW, OH), dst = new Uint32Array(id.data.buffer);
    const zb = new Float32Array(OW * OH).fill(-1), db = new Float32Array(OW * OH);
    for (let yy = 0; yy < H * 4; yy++) for (let xx = 0; xx < BW; xx++) {
      const col = big[yy * BW + xx];
      if ((col >>> 24) <= 40) continue;
      const i = (yy >> 2) * W + (xx >> 2);
      if (owner[i] < -1) continue;
      const px = (xx + 0.5) / 4, py = (yy + 0.5) / 4;
      const t1 = xf[b1[i]];
      let qx = t1.J[0] + t1.c * (px - t1.a[0]) - t1.s * (py - t1.a[1]), qy = t1.J[1] + t1.s * (px - t1.a[0]) + t1.c * (py - t1.a[1]);
      const w = w2[i];
      if (w > 0) {
        const t2 = xf[b2[i]];
        const rx = t2.J[0] + t2.c * (px - t2.a[0]) - t2.s * (py - t2.a[1]), ry = t2.J[1] + t2.s * (px - t2.a[0]) + t2.c * (py - t2.a[1]);
        qx += (rx - qx) * w; qy += (ry - qy) * w;
      }
      const dx = Math.floor(qx) + PAD, dy = Math.floor(qy) + PAD;
      if (dx < 0 || dy < 0 || dx >= OW || dy >= OH) continue;
      const k = dy * OW + dx, z = layer[b1[i]], d = (qx + PAD - dx - 0.5) ** 2 + (qy + PAD - dy - 0.5) ** 2;
      if (z > zb[k] || (z === zb[k] && d < db[k])) { zb[k] = z; db[k] = d; dst[k] = col; }
    }
    // 手腳底下補的身體：跟著身體，層在身體後面、後面的手腳前面
    const tb = xf[BODY], ZU = 0.9;
    for (let i = 0; i < W * H; i++) {
      if (!under[i]) continue;
      const px = (i % W) + 0.5, py = ((i / W) | 0) + 0.5;
      const qx = tb.J[0] + tb.c * (px - tb.a[0]) - tb.s * (py - tb.a[1]), qy = tb.J[1] + tb.s * (px - tb.a[0]) + tb.c * (py - tb.a[1]);
      const dx = Math.floor(qx) + PAD, dy = Math.floor(qy) + PAD;
      if (dx < 0 || dy < 0 || dx >= OW || dy >= OH) continue;
      const k = dy * OW + dx;
      if (ZU > zb[k]) { zb[k] = ZU; dst[k] = under[i]; }
    }
    o.putImageData(id, 0, 0);
    return out;
  }

  // ---------- 動作：跟 rig.js 同一組名字 ----------
  const TAU = Math.PI * 2;
  const fns = {
    idle: ph => ({ breath: 0.5 - 0.5 * Math.cos(ph * TAU) + 0.1, tailSw: 0.12 * Math.sin(ph * TAU), arm: 0.06 * Math.sin(ph * TAU) }),
    walk: ph => ({ gait: ph, gaitAmt: 1, lean: -1, tailSw: 0.15 * Math.cos(ph * TAU) }),
    run: ph => ({ gait: ph, gaitAmt: 1, lean: -2, crouch: 1, tailSw: 0.3 * Math.cos(ph * TAU), ear: -0.2 }),
    happy: ph => { const s = Math.sin(ph * TAU); return { crouch: -Math.max(0, s) * 2 + 1, headPitch: -1, arm: 0.3 + 0.35 * s, tailSw: 0.4 * Math.sin(ph * 2 * TAU) }; },
    sleep: ph => ({ crouch: 1 + 0.5 - 0.5 * Math.cos(ph * 2 * TAU), headPitch: 1, arm: -0.3, tail: -0.2, ear: -0.25 }),
    eat: ph => ({ headPitch: 1 + Math.cos(ph * 2 * TAU), lean: -1, crouch: 1 }),
    hurt: ph => ({ lean: 3 - 3 * ph, arm: 0.5 - 0.3 * ph, tail: 0.3, ear: -0.3 }),
    attack: ph => (ph < 0.5 ? { lean: 2, crouch: 1, arm: 0.6 + 0.4 * ph } : { lean: ph < 0.75 ? -3 : -2, arm: ph < 0.75 ? -0.4 : -0.2 }),
    dangle: ph => { const s = Math.sin(ph * TAU); return { legL: [0, 2], legR: [0, 2], arm: -0.4, armSw: 0.15 * s, tail: -0.3 }; },
  };
  const SETS = Object.keys(fns);
  const quantize = p => {
    const I = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v || 0)));
    const q = {
      lean: I(p.lean, -LIMITS.lean, LIMITS.lean), crouch: I(p.crouch, -LIMITS.crouchUp, LIMITS.crouchDown), headPitch: I(p.headPitch, -LIMITS.pitch, LIMITS.pitch), breath: I(p.breath, 0, 1),
      legL: [I(p.legL?.[0], -3, 3), I(p.legL?.[1], -3, 3)], legR: [I(p.legR?.[0], -3, 3), I(p.legR?.[1], -3, 3)],
      gait: p.gait == null ? 0 : ((Math.round(p.gait * GAIT_STEPS) % GAIT_STEPS) + GAIT_STEPS) % GAIT_STEPS,
      gaitAmt: I((p.gaitAmt ?? 0) * GAIT_AMT_STEPS, 0, GAIT_AMT_STEPS),
    };
    for (const k of ['arm', 'armSw', 'tail', 'tailSw', 'ear', 'earSw']) q[k] = Math.max(-PART_MAX, Math.min(PART_MAX, Math.round((p[k] || 0) / ANG_STEP) * ANG_STEP));
    q.key = [q.lean, q.crouch, q.headPitch, q.breath, ...q.legL, ...q.legR, q.gait, q.gaitAmt, ...['arm', 'armSw', 'tail', 'tailSw', 'ear', 'earSw'].map(k => Math.round(q[k] / ANG_STEP))].join(',');
    return q;
  };
  const cache = new Map(), stats = { built: 0, maxPart: 0 };
  const pose = (params, { build = true } = {}) => {
    const q = params.key ? params : quantize(params);
    const hit = cache.get(q.key);
    if (hit) { cache.delete(q.key); cache.set(q.key, hit); return hit; }
    if (!build) return null;
    const c = frame(q);
    stats.built++;
    cache.set(q.key, c);
    if (cache.size > 256) cache.delete(cache.keys().next().value);
    return c;
  };
  const N = { idle: 8, walk: GAIT_STEPS, run: GAIT_STEPS, happy: 6, sleep: 4, eat: 4, hurt: 3, attack: 4, dangle: 4 };
  const DUR = { idle: 0.2, walk: 0.06, run: 0.04, happy: 0.1, sleep: 0.6, eat: 0.15, hurt: 0.08, attack: 0.1, dangle: 0.2 };
  const sets = {};
  for (const name of SETS) {
    let frames = null;
    sets[name] = { durs: Array(N[name]).fill(DUR[name]), total: DUR[name] * N[name], get frames() { return (frames ??= Array.from({ length: N[name] }, (_, i) => pose(fns[name](i / N[name])))); } };
  }
  const target = (name, ph) => (fns[name] ?? fns.idle)(((ph % 1) + 1) % 1);
  // 一輪身體往前走多遠：每隻腳踩地的時候往後 2A 格、占 duty 輪 → 一輪 2A ÷ duty（stride 給 locomotion.js 用：一輪＝2 × stride）
  const info = { W, H, hasLegs: legs.length > 0, pad: PAD, stride: legs.length ? A / duty : 0, skeleton: true, neckY: spec.head?.pivot[1] ?? 0, hipY: H, legSplit: W / 2, parts: [] };
  return { sets, pose, target, quantize, stats, cache, w: W + PAD * 2, h: H + PAD, info, owner, segs, limbs, SETS };
}
