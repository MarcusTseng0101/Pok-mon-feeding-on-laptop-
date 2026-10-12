// 打包卡洛斯旅行的 APK：node scripts/journey-apk.mjs [--install]
// 需要（都不在 package.json 裡）：JDK 17、Android SDK（platform 34、build-tools 34）、Gradle 8.7 以上
//   ANDROID_HOME（或 ANDROID_SDK_ROOT）＝SDK 的資料夾；JAVA_HOME＝JDK；GRADLE＝gradle 執行檔（沒設就用 PATH 裡的 gradle）
// 產出：dist/kalos-journey-debug.apk（除錯簽章，自己裝在自己的手機上用）
// --install：用 adb 裝到接著 USB 的手機（要先打開「USB 偵錯」）
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'android');
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk || !existsSync(sdk)) {
  console.error('找不到 Android SDK：請設定 ANDROID_HOME');
  process.exit(1);
}
writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}\n`);

const win = process.platform === 'win32';
const gradle = process.env.GRADLE ?? (win ? 'gradle.bat' : 'gradle');
// Windows 的 gradle.bat 要經過 cmd 執行（不用 shell: true，參數才不會被拼成一行）
const runGradle = args => (win ? spawnSync('cmd.exe', ['/d', '/c', gradle, ...args], { stdio: 'inherit' }) : spawnSync(gradle, args, { stdio: 'inherit' }));
const r = runGradle(['--offline', '-q', '-p', ANDROID, 'assembleDebug']);
if (r.status !== 0) {
  // 第一次打包要下載 Android Gradle Plugin：沒有快取時拿掉 --offline 再試一次
  const again = runGradle(['-q', '-p', ANDROID, 'assembleDebug']);
  if (again.status !== 0) process.exit(again.status ?? 1);
}
const apk = path.join(ANDROID, 'app/build/outputs/apk/debug/app-debug.apk');
mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist/kalos-journey-debug.apk');
copyFileSync(apk, out);
console.log(`APK：${path.relative(ROOT, out)}`);

if (process.argv.includes('--install')) {
  const adb = path.join(sdk, 'platform-tools', win ? 'adb.exe' : 'adb');
  const i = spawnSync(adb, ['install', '-r', out], { stdio: 'inherit' });
  process.exit(i.status ?? 1);
}
