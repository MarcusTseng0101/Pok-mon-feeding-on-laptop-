// 假的視窗偵測程序（測試用）：行為跟 windows.js 裡的 PowerShell 腳本一樣。
// argv[2]：'ok' 正常回答；'crash' 一收到查詢就結束；'nostart' 不印 ready 直接結束
import { createInterface } from 'node:readline';
const mode = process.argv[2] ?? 'ok';
if (mode === 'nostart') { process.stderr.write('Add-Type 被擋住了\n'); process.exit(1); }
console.log('ready');
createInterface({ input: process.stdin }).on('line', line => {
  if (line === 'q') process.exit(0);
  if (mode === 'crash') process.exit(3);
  if (line === 'stat') return console.log(JSON.stringify({ cpuMs: 12, rss: 1024 }));
  // 由上到下：最前面的視窗、一個太小的、被排除的自己、後面的視窗
  const all = [[111, 100, 50, 800, 600, 1], [222, 0, 0, 60, 30, 0], [333, 0, 0, 1920, 1040, 0], [444, 300, 200, 640, 480, 0]];
  console.log(JSON.stringify(all.filter(w => String(w[0]) !== line)));
});
