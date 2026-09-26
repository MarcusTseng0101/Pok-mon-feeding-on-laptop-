// 讓原本不會動的像素圖動起來（維持 2 倍像素，不用 3D 動態圖）。
//
// 做法跟原作早期的「兩張圖交替」一樣：把圖切成幾塊，每塊只移動整數個像素，所以像素永遠是方的、不會糊掉。
//   1. 自動找「脖子」：上半身最窄的那一列 → 以上是頭（耳朵、角、頭髮）
//   2. 自動找「腳」：最下面幾列分成兩段以上 → 那一段以下是腳，依重心分成左腳、右腳
//   3. 待機：頭慢慢上下（呼吸）；走路：左右腳輪流抬起、身體跟著一上一下
//   4. 移開留下的縫，用相鄰那一列補上（看起來像脖子伸長、腿伸直），不會破洞
// 會飄的（沒有腳在地上）走路時整隻輕輕跳；沒找到腳的也一樣。
import { makeCanvas } from './pixel.js';

const PAD = 1; // 上、左、右各留 1 格，頭往上動時不會被切掉

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
  return { W, H, neckY, hipY: hasLegs ? hipY : H, hasLegs, legSplit };
}

// 畫一張：head [dx, dy]、body dy、legL/legR [dx, dy] 各自的位移（整數像素，負的是往上／往前）
function frame(src, a, { head = [0, 0], body = 0, legL = [0, 0], legR = [0, 0] }) {
  const { W, H, neckY, hipY, legSplit } = a;
  const c = makeCanvas(W + PAD * 2, H + PAD), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const put = (sx, sy, sw, sh, dx, dy) => { if (sw > 0 && sh > 0) g.drawImage(src, sx, sy, sw, sh, dx + PAD, dy + PAD, sw, sh); };
  // 腳（左、右各自抬）；身體往上抬比腳多的時候，用腳最上面那一列把縫補起來
  for (const [x0, x1, [dx, dy]] of [[0, legSplit, legL], [legSplit, W, legR]]) {
    put(x0, hipY, x1 - x0, H - hipY, x0 + dx, hipY + dy);
    for (let r = body; r < dy; r++) put(x0, hipY, x1 - x0, 1, x0 + dx, hipY + r);
  }
  // 身體
  put(0, neckY, W, hipY - neckY, 0, neckY + body);
  // 頭；往上抬比身體多的時候，用身體最上面那一列補（像脖子伸長）
  const [hx, hy] = head;
  for (let r = hy; r < body; r++) put(0, neckY, W, 1, 0, neckY + r);
  put(0, 0, W, neckY, hx, hy);
  return c;
}

const cycle = (src, a, poses, dur) => {
  const frames = poses.map(p => frame(src, a, p));
  const durs = poses.map(() => dur);
  return { frames, durs, total: dur * poses.length };
};

// 回傳 { sets: { idle, walk }, w, h }；frames 是一般的 canvas（外面再包成 asset）
export function buildRig(src, { floats = false } = {}) {
  const a = analyze(src);
  // 待機：頭慢慢抬起、放下（呼吸），偶爾往前一點
  const idle = cycle(src, a, [
    {}, {}, { head: [0, -1] }, { head: [0, -1] }, { head: [0, -1] }, { head: [0, -1] }, {}, {},
  ], 0.2);
  let walk;
  if (a.hasLegs && !floats) {
    // 左腳抬 → 身體上來 → 右腳抬 → 身體上來
    // 圖是面向左邊的：往前＝x 減 1。抬起來的那隻腳往前跨，另一隻往後蹬
    walk = cycle(src, a, [
      { legL: [-1, -1], legR: [1, 0] },
      { body: -1, head: [0, -1] },
      { legL: [1, 0], legR: [-1, -1] },
      { body: -1, head: [0, -1] },
    ], 0.13);
  } else {
    // 沒有腳（或會飄）：整隻輕輕跳，頭晚一拍
    walk = cycle(src, a, [
      {},
      { body: -1, legL: [0, -1], legR: [0, -1], head: [0, -1] },
      { body: -1, legL: [0, -1], legR: [0, -1], head: [0, -1] },
      { head: [0, -1] },
    ], 0.13);
  }
  return { sets: { idle, walk }, w: src.width + PAD * 2, h: src.height + PAD, info: a };
}
