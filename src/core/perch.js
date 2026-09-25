// 站在視窗上：哪些視窗的「頂邊」看得到、可以站。
//
// 我們的透明視窗永遠在最上層，所以如果讓寶可夢站在被別的視窗遮住的頂邊上，
// 看起來會像浮在前面那個視窗的中間。所以要從最上面的視窗往下算，
// 把每個視窗頂邊被更上層視窗蓋住的部分扣掉，剩下的區段才可以站。
//
// rects：由上到下（z-order）的 [{ hwnd, x, y, w, h }]，座標系統跟舞台一樣。

export const MAX_PER_LEDGE = 2;

// 從 [a, b] 區間扣掉 [c, d]
function subtract(segs, c, d) {
  const out = [];
  for (const [a, b] of segs) {
    if (d <= a || c >= b) { out.push([a, b]); continue; }
    if (c > a) out.push([a, c]);
    if (d < b) out.push([d, b]);
  }
  return out;
}

// 回傳 [{ hwnd, x0, x1, y }]：每個看得到的頂邊區段（同一個視窗可能被切成好幾段）
export function visibleLedges(rects, { minWidth = 0, top = 0 } = {}) {
  const ledges = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.y <= top) continue; // 頂邊在螢幕外（或貼著上緣，站上去頭會出界）
    let segs = [[r.x, r.x + r.w]];
    // 更上層的視窗只要蓋到這條線（頂邊那一列）就遮住
    for (let j = 0; j < i && segs.length; j++) {
      const o = rects[j];
      if (o.y <= r.y && o.y + o.h > r.y) segs = subtract(segs, o.x, o.x + o.w);
    }
    for (const [x0, x1] of segs) if (x1 - x0 >= minWidth) ledges.push({ hwnd: r.hwnd, x0, x1, y: r.y });
  }
  return ledges;
}

// 某一點在不在這條區段上（用來判斷腳下的頂邊還在不在）
export function ledgeUnder(ledges, hwnd, x) {
  return ledges.find(l => l.hwnd === hwnd && x >= l.x0 && x <= l.x1) ?? null;
}

// 視窗移動得多快（每秒）才會把站在上面的寶可夢甩下來（DIP／秒）
export const SHAKE_OFF_SPEED = 600;
