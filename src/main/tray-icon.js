// 系統匣圖示：16×16 像素的精靈球，放大 2 倍做成 32×32（scaleFactor 2 讓高解析螢幕也清楚）
import { nativeImage } from 'electron';

const MAP = [
  '.....KKKKKK.....',
  '...KKRRRRRRKK...',
  '..KRRRRRRWWRRK..',
  '.KRRRRRRRWWRRRK.',
  '.KRRRRRRRRRRRRK.',
  'KRRRRRKKKKRRRRRK',
  'KRRRRKWWWWKRRRRK',
  'KKKKKKWWWWKKKKKK',
  'KWWWWKWWWWKWWWWK',
  'KWWWWWKKKKWWWWWK',
  'KWWWWWWWWWWWWWWK',
  '.KWWWWWWWWWWWWK.',
  '.KWWWWWWWWWWWGK.',
  '..KWWWWWWWWGGK..',
  '...KKGGGGGGKK...',
  '.....KKKKKK.....',
];
const COLORS = { K: [40, 32, 48], R: [232, 64, 72], W: [248, 244, 240], G: [196, 192, 200] };

export function trayImage() {
  const S = 2, N = 16 * S;
  const buf = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = MAP[Math.floor(y / S)][Math.floor(x / S)];
      const i = (y * N + x) * 4;
      if (c === '.') continue;
      const [r, g, b] = COLORS[c];
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N, scaleFactor: 2 });
}
