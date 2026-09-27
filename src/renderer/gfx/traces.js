// 手機打卡留在桌面上的痕跡（core/checkin.js 的 CHECKINS[].trace）：你吃飯時牠吃剩的碗、你喝水時牠的杯子……
// 加一種新的打卡：在這裡加一張圖（key 跟 CHECKINS 的 trace 一樣）。沒有圖的用小星星。
import { fromMap } from './pixel.js';

const K = '#2a2030';
const PAL = {
  k: K, w: '#ffffff', c: '#fff6c8', b: '#6aa8ff', B: '#3b6fd1', r: '#e8404a', p: '#ff9ec4', g: '#6cc56b', G: '#3f8f45',
  y: '#ffd166', o: '#c98a4b', O: '#8a5a2e', s: '#d9c7aa', l: '#b9e0ff',
};

const MAPS = {
  // 吃完的碗（裡面剩一點樹果渣）
  bowl: [
    '..............',
    '....r..p......',
    '.kkkkkkkkkkkk.',
    '.kcpcccrcccck.',
    '.kwwwwwwwwwwk.',
    '..kwwwwwwwwk..',
    '...kssssssk...',
    '....kkkkkk....',
  ],
  // 喝過的杯子（水剩一半）
  cup: [
    '..kkkkkk...',
    '..kllllk...',
    '..kwwwwkkk.',
    '..kbbbbk.k.',
    '..kbBbbk.k.',
    '..kbbbbkkk.',
    '..kbbbbk...',
    '...kkkk....',
  ],
  // 散步帶回來的葉子
  leaf: [
    '.......kkk',
    '.....kkggk',
    '...kkgggGk',
    '..kggggGgk',
    '.kgggGgggk',
    '.kggGggkk.',
    '.kgGgkk...',
    'kGkkk.....',
    'kk........',
  ],
  // 窩過的枕頭
  pillow: [
    '..kkkkkkkkkk..',
    '.kccccccccccck',
    'kccccpccccccck',
    'kccccccccpccck',
    '.kccccccccccck',
    '..kkkkkkkkkkk.',
  ],
  // 翻開的書
  book: [
    '.kkkkk.kkkkk.',
    'kwwwwwkwwwwwk',
    'kwsswwkwwsswk',
    'kwwwwwkwsswwk',
    'kwsswwkwwwwwk',
    'kwwwwwkwwwwwk',
    'kkkkkkOkkkkkk',
    '.kOOOOkOOOOk.',
  ],
  // 沒有圖的新種類：小星星
  star: [
    '...k...',
    '..kyk..',
    'kkkykkk',
    '.kyyyk.',
    '..kyk..',
    '.kk.kk.',
  ],
};

const cache = new Map();
export function traceImg(id) {
  const key = MAPS[id] ? id : 'star';
  if (!cache.has(key)) cache.set(key, fromMap(MAPS[key], PAL));
  return cache.get(key);
}
