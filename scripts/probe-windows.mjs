// 視窗偵測測速：在 Windows 上執行 `node scripts/probe-windows.mjs`（不需要 npm install）。
// 每 250 ms 查一次所有視窗的位置，跑 60 秒，印出查詢耗時、CPU、記憶體，
// 用來決定「站在視窗上」要照原計畫做、降低頻率，還是換做法。
// 只讀視窗的位置與大小，不讀標題或程式名稱。
import os from 'node:os';
import { createWindowProbe } from '../src/main/windows.js';

const SECONDS = Number(process.argv[2]) || 60;
const INTERVAL = 250;

if (process.platform !== 'win32') {
  console.log('這支腳本只能在 Windows 上執行。');
  process.exit(1);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};

const probe = createWindowProbe({ log: (...a) => console.log('  [警告]', ...a) });

console.log('啟動 PowerShell 並編譯偵測程式…');
const t0 = performance.now();
const first = await probe.snapshot();
const startupMs = performance.now() - t0;
if (probe.lastError) {
  console.log('\n結果：偵測程式無法啟動（可能被防毒軟體或執行原則擋住）。請把上面的訊息整段貼回來。');
  process.exit(2);
}
console.log(`啟動花了 ${Math.round(startupMs)} ms，目前看到 ${first.length} 個視窗。`);
console.log(`\n接下來 ${SECONDS} 秒，請開著幾個視窗（瀏覽器、檔案總管…），隨意拖動、最大化、最小化。`);
console.log('最後 5 秒請把「這個 PowerShell 視窗」最大化並放在最前面。\n');

const before = await probe.stats();
const wall0 = performance.now();
const times = [];
let counts = [];
let failures = 0;
let lastFg = null;

const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  const t = performance.now();
  const errBefore = probe.lastError;
  const list = await probe.snapshot();
  const dt = performance.now() - t;
  if (probe.lastError !== errBefore) failures++; // 這次查詢失敗（程序重啟了）
  if (probe.disabled) break;
  times.push(dt);
  counts.push(list.length);
  lastFg = list.find(w => w.fg) ?? lastFg;
  const left = Math.ceil((end - Date.now()) / 1000);
  if (times.length % 20 === 0) process.stdout.write(`  剩 ${left} 秒，這次 ${dt.toFixed(1)} ms，${list.length} 個視窗\n`);
  await new Promise(r => setTimeout(r, Math.max(0, INTERVAL - dt)));
}

const after = await probe.stats();
const wallMs = performance.now() - wall0;
probe.dispose();

const cores = os.cpus().length;
const cpuMs = after && before ? after.cpuMs - before.cpuMs : NaN;
const cpuTotal = (cpuMs / wallMs / cores) * 100; // 跟工作管理員一樣：佔整台電腦的百分比
const cpuOneCore = (cpuMs / wallMs) * 100;
const p50 = pct(times, 0.5), p95 = pct(times, 0.95), max = Math.max(...times);

console.log('\n==================== 結果（整段貼回來） ====================');
console.log(`Windows ${os.release()}，${cores} 核心，Node ${process.version}`);
console.log(`啟動（含編譯）：${Math.round(startupMs)} ms`);
console.log(`查詢次數：${times.length}，失敗：${failures}`);
console.log(`每次查詢耗時：中位數 ${p50?.toFixed(1)} ms，p95 ${p95?.toFixed(1)} ms，最大 ${max.toFixed(1)} ms`);
console.log(`視窗數量：${Math.min(...counts)}–${Math.max(...counts)}`);
console.log(`偵測程序 CPU：整台電腦的 ${cpuTotal.toFixed(2)}%（單一核心的 ${cpuOneCore.toFixed(1)}%）`);
console.log(`偵測程序記憶體：${after ? Math.round(after.rss / 1024 / 1024) : '?'} MB`);
console.log(`最前面的視窗：${lastFg ? `x=${lastFg.x} y=${lastFg.y} 寬=${lastFg.w} 高=${lastFg.h}（實體像素）` : '沒抓到'}`);
let verdict;
if (failures || !times.length) verdict = 'C：偵測失敗';
else if (p95 <= 40 && cpuTotal <= 1) verdict = 'A：夠快，照原計畫做';
else if (p95 <= 150 && cpuTotal <= 3) verdict = 'B：偏慢，降低頻率、只追蹤最前面的視窗';
else verdict = 'C：太慢，需要換做法';
console.log(`判定：${verdict}`);
console.log('============================================================');
