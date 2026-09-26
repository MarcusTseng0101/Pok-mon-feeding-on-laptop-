// 最小的 QR code 產生器（手機頁面的網址用）。不加套件，照 QR code 規格（ISO/IEC 18004）寫：
// 只做「位元組模式」、錯誤修正等級 M、版本 1–10（最多 213 個位元組，網址夠用了）。
// 做法參考 Nayuki 的 QR Code generator（MIT）。測試裡跟 Nayuki 的 Python 版逐格比對（test/fixtures/qr-nayuki.json，
// 含自動挑的遮罩），產生的圖也用 OpenCV 的 QR 解碼器掃過，讀出來的網址一字不差。

const ECC_M = { // 版本 → [每塊的修正碼數, 塊數]
  1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5],
};

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_M[ver][0] * ECC_M[ver][1];

// ---------- Reed–Solomon（GF(256)，多項式 0x11D）----------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

// 資料 → 加上修正碼、交錯排好的碼字
function codewords(bytes, ver) {
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const [eccLen, numBlocks] = ECC_M[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen), blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0); // 對齊長度用，交錯時跳過
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
  return out;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

// 產生 QR code：回傳 { size, get(x, y) → true 是黑格 }。mask：指定遮罩（測試用），不指定就自動挑最好的
export function encodeQR(text, { mask = null } = {}) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= 10 && dataCodewords(ver) * 8 < 4 + (ver < 10 ? 8 : 16) + bytes.length * 8) ver++;
  if (ver > 10) throw new Error('網址太長，放不進 QR code');
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

  // 定位、分隔、計時、對齊圖案
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // 格式資訊（先佔位置）、版本資訊
  const drawFormat = m => {
    const data = (0 << 3) | m; // 等級 M 的格式位元是 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true); // 固定的黑格
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }
  // 資料：從右下角開始，兩欄一組之字形往上往下
  const data = codewords(bytes, ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && i < data.length * 8) { mod[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const applyMask = m => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][m];
      if (inv) mod[y][x] = !mod[y][x];
    }
  };
  let best = mask;
  if (best === null) {
    let min = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(mod, size);
      if (p < min) { min = p; best = m; }
      applyMask(m); // 還原
    }
  }
  applyMask(best); drawFormat(best);
  return { size, version: ver, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] };
}

// 遮罩的扣分（規格裡的四條規則）
function penalty(mod, size) {
  let p = 0;
  const runs = line => {
    let s = 0, run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    // 1:1:3:1:1 的樣式（前後有 4 格白）
    const str = line.map(v => (v ? '1' : '0')).join('');
    for (const pat of ['00001011101', '10111010000']) for (let k = str.indexOf(pat); k >= 0; k = str.indexOf(pat, k + 1)) s += 40;
    return s;
  };
  for (let y = 0; y < size; y++) p += runs(mod[y]);
  for (let x = 0; x < size; x++) p += runs(mod.map(r => r[x]));
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mod[y][x];
    if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
  }
  let dark = 0;
  for (const r of mod) for (const v of r) if (v) dark++;
  const total = size * size;
  p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return p;
}
