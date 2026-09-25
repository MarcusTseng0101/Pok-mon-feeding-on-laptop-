import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createWindowProbe, parseRects, powershellArgs } from '../src/main/windows.js';

const fake = fileURLToPath(new URL('./fixtures/fake-winprobe.mjs', import.meta.url));
const probeWith = (mode, opts = {}) => createWindowProbe({ platform: 'win32', command: process.execPath, args: [fake, mode], log: () => {}, ...opts });

test('視窗偵測：解析結果、排除自己、過濾太小的、保持 z-order', async () => {
  const probe = probeWith('ok', { exclude: 333 });
  const list = await probe.snapshot();
  assert.deepEqual(list.map(w => w.hwnd), ['111', '444']);
  assert.deepEqual(list[0], { hwnd: '111', x: 100, y: 50, w: 800, h: 600, fg: true });
  assert.deepEqual(await probe.stats(), { cpuMs: 12, rss: 1024 });
  probe.dispose();
});

test('視窗偵測：同時查詢共用同一個結果；toDip 換算座標', async () => {
  const probe = probeWith('ok', { toDip: r => ({ x: r.x / 2, y: r.y / 2, width: r.width / 2, height: r.height / 2 }) });
  const [a, b] = await Promise.all([probe.snapshot(), probe.snapshot()]);
  assert.equal(a, b);
  assert.deepEqual(a.find(w => w.hwnd === '111'), { hwnd: '111', x: 50, y: 25, w: 400, h: 300, fg: true });
  probe.dispose();
});

test('視窗偵測：程序一直掛掉時最多重啟 3 次，之後停用並回傳空陣列', async () => {
  const probe = probeWith('crash');
  for (let i = 0; i < 6; i++) assert.deepEqual(await probe.snapshot(), []);
  assert.equal(probe.disabled, true);
  assert.match(probe.lastError, /結束/);
});

test('視窗偵測：PowerShell 啟動失敗時帶回錯誤訊息', async () => {
  const probe = probeWith('nostart', { maxRestarts: 0 });
  assert.deepEqual(await probe.snapshot(), []);
  assert.match(probe.lastError, /Add-Type 被擋住了/);
  assert.equal(probe.disabled, true);
});

test('視窗偵測：Windows 以外的平台先不做，回傳空陣列', async () => {
  const probe = createWindowProbe({ platform: 'darwin' });
  assert.equal(probe.supported, false);
  assert.deepEqual(await probe.snapshot(), []);
});

test('視窗偵測：壞掉的資料不會讓它當掉；指令列參數長度在 Windows 限制內', () => {
  assert.deepEqual(parseRects('[[1,"x",0,500,500,0],null,[2,0,0,500,500,1]]').map(w => w.hwnd), ['2']);
  const cmdLen = powershellArgs().join(' ').length;
  assert.ok(cmdLen < 32000, `command line ${cmdLen}`);
});
