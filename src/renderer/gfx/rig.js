// 讓原本不會動的像素圖動起來（維持 2 倍像素，不用 3D 動態圖）：像素木偶。
//
// 卡洛斯的寶可夢每隻只有一張靜止的像素圖，原圖沒有的姿勢畫不出來；能做的是把圖切成幾塊，各自動：
//   1. 自動找「脖子」：上半身最窄的那一列 → 以上是頭
//   2. 自動找「腳」：最下面幾列分成兩段以上 → 那一段以下是腳，依重心分成左腳、右腳
//   3. 自動找「突出去的部位」（手、尾巴、耳朵、角、翅膀）：把輪廓「磨掉細的地方」剩下身體的核心，
//      核心外面、接在核心上的那幾塊就是突出去的部位；接在核心的那幾格是它的關節，可以繞著關節轉
//   4. 身體會彎：一列一列左右錯開（腳站著不動、越上面錯越多），像往前傾、往後仰、扭來扭去
//   5. 頭、身體、腳只移動整數個像素；移開留下的縫，用相鄰那一列補上（看起來像脖子伸長、腿伸直）
// 轉動用 RotSprite 的做法：先用 Scale2x 放大 4 倍（只會複製原本的格子，不會混色），轉過去以後每一格取最近的那一點。
// 所以不管怎麼動，像素永遠是方的、也不會出現原圖沒有的顏色。
// 會飄的（沒有腳在地上）走路時整隻輕輕跳、翅膀拍；沒找到腳的也一樣。
import { makeCanvas } from './pixel.js';

const PAD = 4; // 上、左、右各留 4 格：頭往上、身體傾斜、手舉起來時不會被切掉 // 猜的，可調整
const JOINT = 2.5; // 關節附近多少格留在身上 // 猜的，可調整
const LONG = 18; // 比這個長（格）的部位，轉的角度按比例變小 // 猜的，可調整
const MAX_PARTS = 6; // 突出去的部位最多幾塊（太多的話是圖很碎，動起來會亂） // 猜的，可調整

// 每一格到最近的「關」的距離（8 方向，棋盤距離）；outside：圖外面算「關」（0）還是很遠
function chess(on, W, H, outside) {
  const d = new Int32Array(W * H), BIG = 1 << 20;
  for (let i = 0; i < W * H; i++) d[i] = on[i] ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? outside : d[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
  }
  return d;
}

function analyze(canvas) {
  const W = canvas.width, H = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, W, H);
  const on = (x, y) => data[(y * W + x) * 4 + 3] > 40;
  const runs = y => {
    const out = [];
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const v = x < W && on(x, y);
      if (v && start < 0) start = x;
      if (!v && start >= 0) { out.push([start, x - 1]); start = -1; }
    }
    return out;
  };
  const width = y => { const r = runs(y); return r.length ? r[r.length - 1][1] - r[0][0] + 1 : 0; };
  // 腳：從最下面往上，連續「分成兩段以上、而且每段都不寬」的列
  let hipY = H;
  for (let y = H - 1; y >= Math.floor(H * 0.55); y--) {
    const r = runs(y).filter(([a, b]) => b - a >= 0);
    const legs = r.length >= 2 && r.every(([a, b]) => b - a + 1 <= W * 0.5);
    if (legs) hipY = y;
    else if (y < H - 3) break; // 最下面 3 列可以是一整片（腳掌），再上去就要分開
  }
  const hasLegs = hipY < H - 1 && hipY <= H - 2;
  // 脖子：20%～55% 之間最窄的那一列（比最寬的窄很多才算）
  let neckY = Math.round(H * 0.4), best = Infinity, maxW = 0;
  for (let y = 0; y < H; y++) maxW = Math.max(maxW, width(y));
  for (let y = Math.floor(H * 0.2); y <= Math.floor(H * 0.55); y++) {
    const w = width(y);
    if (w > 0 && w < best) { best = w; neckY = y; }
  }
  if (best > maxW * 0.8) neckY = Math.round(H * 0.4);
  neckY = Math.max(2, Math.min(neckY, (hasLegs ? hipY : H) - 3));
  // 左右腳的分界：腳那一段的重心
  let sx = 0, n = 0;
  for (let y = hipY; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) { sx += x; n++; }
  const legSplit = n ? Math.round(sx / n) : Math.round(W / 2);
  const a = { W, H, neckY, hipY: hasLegs ? hipY : H, hasLegs, legSplit, pad: PAD };
  a.parts = findParts(data, W, H, a);
  return a;
}

// 突出去的部位：核心＝把比 2r+1 細的地方磨掉（先縮 r 再長回 r）；不在核心裡、接在核心上的每一塊就是一個部位
function findParts(data, W, H, a) {
  const on = new Uint8Array(W * H);
  let area = 0;
  for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] > 40) { on[i] = 1; area++; }
  const r = Math.max(2, Math.min(5, Math.round(Math.min(W, H) / 10))); // 多細算「突出去」 // 猜的，可調整
  const inner = chess(on, W, H, 0);
  const eroded = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) eroded[i] = inner[i] > r ? 1 : 0;
  const notEroded = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) notEroded[i] = eroded[i] ? 0 : 1;
  const toCore = chess(notEroded, W, H, 1 << 20);
  const core = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) core[i] = on[i] && toCore[i] <= r ? 1 : 0;
  // 核心外面的格子分成一塊一塊（上下左右相連）
  const seen = new Uint8Array(W * H), parts = [];
  for (let s = 0; s < W * H; s++) {
    if (!on[s] || core[s] || seen[s]) continue;
    const px = [], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      px.push(i);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (on[j] && !core[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    // 關節：這一塊裡面緊貼著核心的格子
    let jx = 0, jy = 0, jn = 0, cx = 0, cy = 0, maxY = 0;
    for (const i of px) {
      const x = i % W, y = (i / W) | 0;
      cx += x; cy += y; maxY = Math.max(maxY, y);
      const touch = (x > 0 && core[i - 1]) || (x < W - 1 && core[i + 1]) || (y > 0 && core[i - W]) || (y < H - 1 && core[i + W]);
      if (touch) { jx += x; jy += y; jn++; }
    }
    if (!jn) continue; // 沒接在身上（例如分開的小碎片）：跟著身體動就好
    const pivot = { x: jx / jn + 0.5, y: jy / jn + 0.5 };
    cx = cx / px.length + 0.5; cy = cy / px.length + 0.5;
    let reach = 0;
    for (const i of px) reach = Math.max(reach, Math.hypot((i % W) + 0.5 - pivot.x, ((i / W) | 0) + 0.5 - pivot.y));
    if (px.length < Math.max(8, area * 0.006) || reach < 4) continue; // 太小：轉了也看不出來 // 猜的，可調整
    if (a.hasLegs && maxY >= a.hipY) continue; // 腳另外處理（左右腳輪流抬）
    if (maxY >= H - 1) continue; // 碰到地面的：是站著的東西，不轉
    const vx = cx - pivot.x, vy = cy - pivot.y;
    // 頭上的是耳朵（跟著頭動）；其他的：朝前（圖是面向左邊的）的當手，朝後的當尾巴
    const kind = pivot.y < a.neckY ? 'ear' : vx < 0 ? 'arm' : 'tail';
    // 「舉起來」要往哪邊轉：朝左的順時針轉會往上，朝右的逆時針
    const raise = Math.abs(vx) < 0.5 ? (vy < 0 ? 0 : 1) : vx < 0 ? 1 : -1;
    parts.push({ px, pivot, reach, kind, raise, host: pivot.y < a.neckY ? 'head' : 'body', n: px.length });
  }
  parts.sort((p, q) => q.n - p.n);
  parts.length = Math.min(parts.length, MAX_PARTS);
  // 同一種的部位輪流（走路時左手、右手一前一後）
  const count = {};
  for (const p of parts) { count[p.kind] = (count[p.kind] ?? 0) + 1; p.alt = count[p.kind] % 2 ? 1 : -1; }
  return parts;
}

// ---------- 轉動（RotSprite：Scale2x 兩次＝放大 4 倍，再最近取樣）----------
function scale2x(src, w, h) {
  const out = new Uint32Array(w * 2 * h * 2), W2 = w * 2;
  const P = (x, y) => src[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const B = P(x, y - 1), D = P(x - 1, y), E = P(x, y), F = P(x + 1, y), H = P(x, y + 1);
    let e0 = E, e1 = E, e2 = E, e3 = E;
    if (B !== H && D !== F) {
      if (D === B) e0 = D;
      if (B === F) e1 = F;
      if (D === H) e2 = D;
      if (H === F) e3 = F;
    }
    const o = y * 2 * W2 + x * 2;
    out[o] = e0; out[o + 1] = e1; out[o + W2] = e2; out[o + W2 + 1] = e3;
  }
  return out;
}

// 一個部位：自己一張小圖（放大 4 倍存著），轉某個角度的結果快取起來
function makePart(part, pix, W) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of part.px) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // 四周多留 1 格透明，Scale2x 看邊緣才正確
  x0--; y0--; x1++; y1++;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, small = new Uint32Array(w * h);
  for (const i of part.px) { const x = i % W, y = (i / W) | 0; small[(y - y0) * w + (x - x0)] = pix[i]; }
  const big = scale2x(scale2x(small, w, h), w * 2, h * 2);
  const R = Math.ceil(part.reach) + 1;
  const cache = new Map();
  return {
    ...part, R,
    // 轉 ang（弧度，順時針為正）以後的小圖；圖的中心（R, R）＝關節所在的格子
    at(ang) {
      const key = Math.round(ang * 100);
      if (cache.has(key)) return cache.get(key);
      const size = R * 2 + 1, c = makeCanvas(size, size), g = c.getContext('2d');
      const img = g.createImageData(size, size), out = new Uint32Array(img.data.buffer);
      const cos = Math.cos(-ang), sin = Math.sin(-ang), BW = w * 4, BH = h * 4;
      const pxI = Math.floor(part.pivot.x), pyI = Math.floor(part.pivot.y);
      for (let oy = 0; oy < size; oy++) for (let ox = 0; ox < size; ox++) {
        // 這一格的中心，相對於關節
        const dx = pxI + (ox - R) + 0.5 - part.pivot.x, dy = pyI + (oy - R) + 0.5 - part.pivot.y;
        const sx = part.pivot.x + dx * cos - dy * sin, sy = part.pivot.y + dx * sin + dy * cos;
        const bx = Math.floor((sx - x0) * 4), by = Math.floor((sy - y0) * 4);
        if (bx < 0 || by < 0 || bx >= BW || by >= BH) continue;
        out[oy * size + ox] = big[by * BW + bx];
      }
      g.putImageData(img, 0, 0);
      const res = { canvas: c, ox: pxI - R, oy: pyI - R };
      cache.set(key, res);
      return res;
    },
  };
}

// ---------- 一張畫面 ----------
// head [dx, dy]（dx 會讓脖子錯開、看起來像兩層臉，動作裡都用 0，要往前靠 lean）、body dy、legL/legR [dx, dy]：整數像素位移（負的是往上／往前）
// lean：最上面那一列左右錯開幾格（負的往前＝往左，腳那一段不動）
// arm/tail/ear：那一種部位「舉起來」轉幾弧度（負的是垂下去）；armSw/tailSw/earSw：左右兩隻反方向擺
function frame(src, a, parts, pose) {
  const { head = [0, 0], body = 0, legL = [0, 0], legR = [0, 0], lean = 0 } = pose;
  const { W, H, neckY, hipY, legSplit } = a;
  // 1. 頭、身體、腳（突出去的部位已經從 src 挖掉）
  const c = makeCanvas(W + PAD * 2, H + PAD), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const put = (sx, sy, sw, sh, dx, dy) => { if (sw > 0 && sh > 0) g.drawImage(src, sx, sy, sw, sh, dx + PAD, dy + PAD, sw, sh); };
  // 腳（左、右各自抬）；身體往上抬比腳多的時候，用腳最上面那一列把縫補起來
  for (const [x0, x1, [dx, dy]] of [[0, legSplit, legL], [legSplit, W, legR]]) {
    put(x0, hipY, x1 - x0, H - hipY, x0 + dx, hipY + dy);
    for (let r = body; r < dy; r++) put(x0, hipY, x1 - x0, 1, x0 + dx, hipY + r);
  }
  // 兩腳往左右分開時中間會有一條直縫：用左腳最右邊那一行往右補
  for (let k = 1; k <= legR[0] - legL[0]; k++) put(legSplit - 1, hipY, 1, H - hipY, legSplit - 1 + legL[0] + k, hipY + legL[1]);
  // 身體
  put(0, neckY, W, hipY - neckY, 0, neckY + body);
  // 頭；往上抬比身體多的時候，用身體最上面那一列補（像脖子伸長）
  const [hx, hy] = head;
  for (let r = hy; r < body; r++) put(0, neckY, W, 1, 0, neckY + r);
  put(0, 0, W, neckY, hx, hy);
  // 2. 身體彎：每一列錯開 shift(y) 格，腳那一段不動
  const top = PAD + Math.min(0, hy), hipRow = PAD + hipY;
  const shift = y => (y >= hipRow ? 0 : Math.round(lean * (hipRow - y) / Math.max(1, hipRow - top)));
  // 3. 部位：尾巴畫在身體後面，手和耳朵畫在前面；跟著接的那一塊（頭或身體）一起移動
  const out = makeCanvas(c.width, c.height), o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  const drawParts = kinds => {
    for (const p of parts) {
      if (!kinds.includes(p.kind)) continue;
      // 越長的部位轉越少（尖端移動的距離差不多），不然長樹枝、大翅膀一甩就扯開
      const ang = (p.raise * (pose[p.kind] ?? 0) + p.alt * (pose[p.kind + 'Sw'] ?? 0)) * Math.min(1, LONG / p.reach);
      const r = p.at(ang);
      const [mx, my] = p.host === 'head' ? head : [0, body];
      const jy = Math.floor(p.pivot.y) + my + PAD;
      o.drawImage(r.canvas, r.ox + mx + PAD + shift(jy), r.oy + my + PAD);
    }
  };
  drawParts(['tail']);
  if (lean) { for (let y = 0; y < c.height; y++) o.drawImage(c, 0, y, c.width, 1, shift(y), y, c.width, 1); }
  else o.drawImage(c, 0, 0);
  drawParts(['arm', 'ear']);
  return out;
}

// ---------- 動作（每一組是一串姿勢；秒數都是猜的，可調整）----------
const TAU = Math.PI * 2;
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i, (i / n) * TAU));
// 走路時一隻腳前後各跨幾格：腳越長跨越大，最多 3 格（再大，自動找到的「腳」是葉子、裙擺的會扯開；猜的，可調整）。
// 一步身體往前 2 × STEP 格（腳從前面 +STEP 踩到後面 −STEP），info.stride 給 scene/locomotion.js 算速度、照距離播動畫
export const stepOf = a => (a.hasLegs ? Math.max(1, Math.min(3, Math.round((a.H - a.hipY) / 4))) : 0);
function poseSets(a, floats) {
  const legs = a.hasLegs && !floats;
  const A = Math.max(1, stepOf(a));
  return {
    // 待機：呼吸（頭慢慢上下）、尾巴慢慢晃、手輕輕動、偶爾抖一下耳朵
    idle: [range(8, (i, ph) => ({
      head: [0, i >= 2 && i <= 5 ? -1 : 0], tailSw: 0.12 * Math.sin(ph), arm: 0.06 * Math.sin(ph),
      earSw: i === 6 ? 0.25 : 0, lean: i === 4 ? -1 : 0,
    })), 0.2],
    // 走路：左右腳輪流抬、手反方向擺、尾巴跟著甩、身體往前傾一點；會飄的整隻輕輕跳、翅膀一起拍
    walk: legs ? [[
      { legL: [-A, -1], legR: [A, 0], armSw: 0.3, tailSw: 0.15, lean: -1 },
      { body: -1, head: [0, -1], lean: -1, ear: 0.08 },
      { legL: [A, 0], legR: [-A, -1], armSw: -0.3, tailSw: -0.15, lean: -1 },
      { body: -1, head: [0, -1], lean: -1, ear: 0.08 },
    ], 0.13] : [[
      { arm: 0.3, tail: 0.1 },
      { body: -1, legL: [0, -1], legR: [0, -1], head: [0, -1], arm: -0.15, lean: -1 },
      { body: -1, legL: [0, -1], legR: [0, -1], head: [0, -1], arm: -0.3, tail: -0.1, lean: -1 },
      { head: [0, -1], arm: 0.05 },
    ], 0.13],
    // 跑：傾得更前面、身體彈更高、手和尾巴甩更大（腳跨的跟走路一樣：跑快是步頻變快，不是跨更大）
    run: [[
      { legL: [-A, -1], legR: [A, 0], body: -1, head: [0, -1], armSw: 0.5, tailSw: 0.3, arm: floats ? 0.4 : 0, lean: -2, ear: -0.2 },
      { body: -2, head: [0, -2], lean: -2, ear: -0.25, arm: floats ? -0.3 : 0 },
      { legL: [A, 0], legR: [-A, -1], body: -1, head: [0, -1], armSw: -0.5, tailSw: -0.3, arm: floats ? 0.4 : 0, lean: -2, ear: -0.2 },
      { body: -2, head: [0, -2], lean: -2, ear: -0.25, arm: floats ? -0.3 : 0 },
    ], 0.08],
    // 開心：身體彈、兩手舉高、尾巴大力甩、左右扭
    happy: [range(6, (i, ph) => ({
      body: -Math.round(1 + Math.sin(ph)), head: [0, -Math.round(1 + Math.sin(ph)) - 1],
      arm: 0.3 + 0.35 * Math.sin(ph), tailSw: 0.4 * Math.sin(ph * 2), earSw: 0.2 * Math.sin(ph * 2), lean: Math.round(2 * Math.sin(ph)),
    })), 0.1],
    // 睡覺：頭垂下、身體沉下去一點點、手和耳朵垂著，慢慢起伏
    sleep: [range(4, i => ({ head: [0, i % 2 ? 2 : 1], body: i % 2 ? 1 : 0, arm: -0.3, tail: -0.2, ear: -0.25 })), 0.6],
    // 吃：頭往前下點、身體往前
    eat: [[
      { head: [0, 2], lean: -1, ear: 0.1 }, { head: [0, 1], lean: -1 },
      { head: [0, 2], lean: -1, ear: 0.1, tailSw: 0.15 }, { head: [0, 0], tailSw: -0.15 },
    ], 0.15],
    // 被打到：往後仰、手甩開、耳朵往後
    hurt: [range(3, i => ({ lean: 3 - i, head: [0, 0], arm: 0.5 - i * 0.1, tail: 0.3, ear: -0.3 })), 0.08],
    // 出招：往後蓄力 → 往前撲、手揮下去
    attack: [[
      { lean: 2, head: [0, 0], arm: 0.6, ear: -0.2, tailSw: 0.2 },
      { lean: 2, head: [0, -1], arm: 0.8, ear: -0.3, tailSw: 0.3 },
      { lean: -3, head: [0, 0], body: -1, arm: -0.4, ear: -0.1, tailSw: -0.3 },
      { lean: -2, head: [0, 0], arm: -0.2, tailSw: -0.1 },
    ], 0.1],
    // 被拎起來：腳垂下來、手垂著晃、整隻輕輕盪
    dangle: [range(4, (i, ph) => ({ legL: [0, 1], legR: [0, 1], arm: -0.4, armSw: 0.15 * Math.sin(ph), tail: -0.3, tailSw: 0.1 * Math.sin(ph), ear: -0.15, lean: Math.round(Math.sin(ph)) })), 0.2],
  };
}

export const SETS = ['idle', 'walk', 'run', 'happy', 'sleep', 'eat', 'hurt', 'attack', 'dangle'];

// 回傳 { sets: { idle, walk, run, … }, w, h, info }；每一組第一次用到才做（frames 是一般的 canvas，外面再包成 asset）
export function buildRig(srcCanvas, { floats = false } = {}) {
  const a = analyze(srcCanvas);
  const { W, H } = a;
  // 把突出去的部位從原圖挖掉，另外存成可以轉的小圖
  const g = srcCanvas.getContext('2d'), img = g.getImageData(0, 0, W, H);
  const pix = new Uint32Array(img.data.slice().buffer);
  const parts = a.parts.map(p => makePart(p, pix, W));
  const base = makeCanvas(W, H), bg = base.getContext('2d');
  const hole = new ImageData(new Uint8ClampedArray(img.data), W, H);
  // 關節附近幾格留在身上：部位轉開的時候，根部才不會露出一個缺口
  for (const p of a.parts) for (const i of p.px) {
    if (Math.hypot((i % W) + 0.5 - p.pivot.x, ((i / W) | 0) + 0.5 - p.pivot.y) > JOINT) hole.data[i * 4 + 3] = 0;
  }
  bg.putImageData(hole, 0, 0);
  const defs = poseSets(a, floats), sets = {};
  for (const name of SETS) {
    let built = null;
    Object.defineProperty(sets, name, {
      enumerable: true,
      get() {
        if (!built) {
          const [poses, dur] = defs[name];
          const frames = poses.map(p => frame(base, a, parts, p));
          built = { frames, durs: poses.map(() => dur), total: dur * poses.length };
        }
        return built;
      },
    });
  }
  const info = { W, H, neckY: a.neckY, hipY: a.hipY, hasLegs: a.hasLegs, legSplit: a.legSplit, pad: PAD, stride: 2 * stepOf(a), parts: a.parts.map(p => ({ kind: p.kind, n: p.n, pivot: p.pivot })) };
  return { sets, w: W + PAD * 2, h: H + PAD, info };
}
