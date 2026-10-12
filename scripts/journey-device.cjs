// 在真的 Android 手機上點一輪卡洛斯旅行（除錯版 APK 要先裝好：node scripts/journey-apk.mjs --install）
// node scripts/journey-device.cjs
//
// 用 adb 把手機上 WebView 的遠端偵錯接到電腦，Playwright 用 CDP 連上去，跟 e2e 一樣真的點畫面。
// 不清除 app 的資料（使用者可能已經在玩）：還沒選夥伴就從開場玩起，已經有存檔就只在目前的地方動一下。
// 截圖放 .cache/device-*.png。需要 ANDROID_HOME（找 adb）和 Playwright（PLAYWRIGHT_PATH）。
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PKG = 'dev.kalos.journey';
const PORT = 9333;
const adbPath = path.join(process.env.ANDROID_HOME ?? '', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = (...args) => execFileSync(adbPath, args, { encoding: 'utf8' }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_PATH, 'playwright'].filter(Boolean)) { try { return require(t); } catch { /* 下一個 */ } }
  throw new Error('找不到 Playwright（設定 PLAYWRIGHT_PATH）');
}

async function main() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const device = adb('shell', 'getprop', 'ro.product.model');
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  let pid = '';
  for (let i = 0; i < 20 && !pid; i++) { await sleep(500); try { pid = adb('shell', 'pidof', PKG); } catch { /* 還沒起來 */ } }
  if (!pid) throw new Error('app 沒有啟動（APK 裝了嗎？）');
  adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  try {
    let page = null;
    for (let i = 0; i < 20 && !page; i++) {
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('/src/journey/')) ?? null;
      if (!page) await sleep(500);
    }
    if (!page) throw new Error('找不到遊戲的頁面');
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === '1' || !document.querySelector('#msg').hidden, null, { timeout: 20000 });
    const shot = name => page.screenshot({ path: path.join(ROOT, '.cache', `device-${name}.png`) });
    fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
    const tapThrough = async (n = 30) => {
      for (let i = 0; i < n; i++) {
        await sleep(250);
        if (!(await page.locator('#msg').isVisible())) return;
        await page.locator('#msg').click();
      }
    };
    const info = await page.evaluate(() => ({
      bridge: typeof window.KalosNative?.steps === 'function',
      steps: window.KalosNative?.steps?.(),
      ua: navigator.userAgent,
      w: innerWidth, h: innerHeight,
    }));
    check(info.bridge, '沒有 KalosNative（外殼沒接上）');
    console.log(`手機：${device}，畫面 ${info.w}×${info.h}，計步器：${info.steps < 0 ? '還沒有數字（沒有權限或還沒回報）' : info.steps}`);

    await tapThrough();
    if (await page.locator('.starter').count()) {
      await shot('starters');
      await page.locator('.starter').first().click();
      await tapThrough();
    }
    // 在地圖上：路線就往前走一格，城鎮就往前到路線（不打道館）
    if (await page.locator('#walk').count()) {
      await page.locator('#walk').click();
    } else if (await page.locator('#forward:not([disabled])').count()) {
      await page.locator('#forward').click();
      await tapThrough();
      if (await page.locator('#walk').count()) await page.locator('#walk').click();
    }
    await tapThrough();
    if (await page.locator('.battle').count()) {
      await shot('battle');
      for (let i = 0; i < 40 && (await page.locator('.battle').count()); i++) {
        if (await page.locator('.actions.list .mon:not([disabled])').count()) await page.locator('.actions.list .mon:not([disabled])').first().click();
        else if (await page.locator('#b-run:not([disabled])').count() && i > 2) await page.locator('#b-run').click();
        else await page.locator('.move').first().click();
        await tapThrough();
      }
    }
    await shot('area');
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('kalos-journey');
      return { local: Boolean(raw), backup: (window.KalosNative?.load?.() ?? '').length, same: raw === window.KalosNative?.load?.() };
    });
    check(saved.local && saved.backup > 0 && saved.same, `存檔沒有備份到 app 的資料夾：${JSON.stringify(saved)}`);
    const imgs = await page.evaluate(() => [...document.images].map(i => i.complete && i.naturalWidth > 0));
    check(imgs.length && imgs.every(Boolean), `有圖沒載入：${JSON.stringify(imgs)}`);
    check(!errors.length, `console 有錯誤：${errors.slice(0, 3).join(' | ')}`);
  } catch (err) {
    problems.push(err.stack ?? String(err));
  } finally {
    await browser.close().catch(() => {});
    try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* 已經沒了 */ }
  }
  console.log(problems.length ? `FAIL journey-device: ${problems.join('; ')}` : 'PASS journey-device');
  process.exitCode = problems.length ? 1 : 0;
}

main();
