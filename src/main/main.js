// Electron 主程序：一個覆蓋整個工作區、完全透明、永遠在最上層的視窗。
// 滑鼠平常會穿透到下面的視窗；只有游標停在寶可夢或介面上時，renderer 才會要求接收點擊。
import { app, BrowserWindow, ipcMain, screen, Tray, Menu } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createSpriteCache } from './sprites.js';
import { createSignals } from './signals.js';
import { trayImage } from './tray-icon.js';
import { createWindowProbe } from './windows.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.KALOS_DEV === '1';
const SMOKE = process.env.KALOS_SMOKE; // 截圖輸出路徑

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId?.('dev.kalos.amie');

let win = null;
let tray = null;
let signals = null;
let windowProbe = null;
let flushedForQuit = false;
const trayState = { muted: false, quiet: false, focus: false, focusMinutes: 25 };

function currentDisplay() {
  if (!win) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}

function fitToDisplay(display) {
  if (!win) return;
  win.setBounds(display.workArea); // 工作區＝扣掉工作列；寶可夢會站在工作列上緣
  win.webContents.send('display', { ...display.workArea, scaleFactor: display.scaleFactor });
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...display.workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'Kalos Amie',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(here, '../renderer/index.html'), { query: DEV ? { dev: '1' } : {} });
  win.once('ready-to-show', () => {
    win.showInactive();
    fitToDisplay(display);
  });
  win.on('closed', () => { win = null; });
  if (DEV || SMOKE) {
    win.webContents.on('console-message', e => console.log(`[renderer:${e.level}] ${e.message}`));
    win.webContents.on('render-process-gone', (_e, d) => console.error('renderer gone', d));
  }
  // 冒煙測試：開起來幾秒後把整個透明視窗截圖存檔，然後結束（CI／沒有螢幕的環境用）
  if (SMOKE) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      await writeFile(SMOKE, img.toPNG());
      console.log('smoke screenshot:', SMOKE);
      flushedForQuit = true;
      app.quit();
    }, 8000);
  }

  // 游標位置：即使滑鼠在別的視窗上也要知道，寶可夢才能看著你、被「摸」到
  let last = '';
  setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const key = `${p.x},${p.y}`;
    if (key === last) return;
    last = key;
    lastCursorMove = Date.now();
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 33);

  signals = createSignals(s => win?.webContents.send('signals', s), { lastCursorMove: () => lastCursorMove });
  startWindowWatch();
  screen.on('display-metrics-changed', () => fitToDisplay(currentDisplay()));
  screen.on('display-removed', () => fitToDisplay(screen.getPrimaryDisplay()));
}

// 其他視窗的位置（給寶可夢站在視窗上）：只有位置和大小，沒有標題或內容。
// 每 250 ms 查一次（Windows 上實測一次約 1–2 ms），有變化才送給畫面。勿擾模式時暫停。
let lastCursorMove = 0;
function startWindowWatch() {
  if (process.platform !== 'win32' || SMOKE) return;
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
  windowProbe = createWindowProbe({
    exclude: hwnd,
    // 實體像素 → DIP（縮放 125%、150% 的螢幕才不會歪），再換成相對於我們視窗的座標
    toDip: r => {
      const d = screen.screenToDipRect(null, r);
      const b = win?.getBounds() ?? { x: 0, y: 0 };
      return { x: d.x - b.x, y: d.y - b.y, width: d.width, height: d.height };
    },
  });
  let last = '';
  const tick = async () => {
    if (!win || windowProbe.disabled) return;
    if (!trayState.quiet) {
      const list = await windowProbe.snapshot();
      const key = JSON.stringify(list);
      if (key !== last) { last = key; win?.webContents.send('windows', list); }
    }
    setTimeout(tick, 250);
  };
  tick();
}

function send(command) {
  win?.webContents.send('command', command);
}

function buildTray() {
  tray ??= new Tray(trayImage());
  tray.setToolTip('Kalos Amie 卡洛斯桌面夥伴');
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '夥伴', click: () => send('party') },
    { label: '圖鑑', click: () => send('dex') },
    { label: '一起玩', click: () => send('play') },
    { label: '背包', click: () => send('bag') },
    { label: '氣息', click: () => send('aura') },
    { label: '設定', click: () => send('settings') },
    { type: 'separator' },
    trayState.focus
      ? { label: '結束專注', click: () => send('focusStop') }
      : { label: `開始專注（${trayState.focusMinutes} 分鐘）`, click: () => send('focusStart') },
    { label: '靜音', type: 'checkbox', checked: trayState.muted, click: () => send('toggleMute') },
    { label: '勿擾模式（收起寶可夢）', type: 'checkbox', checked: trayState.quiet, click: () => send('toggleQuiet') },
    { label: '移到游標所在的螢幕', click: () => fitToDisplay(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())) },
    { label: '開機時自動啟動', type: 'checkbox', checked: login, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    ...(DEV ? [{ label: '開發者工具', click: () => win?.webContents.openDevTools({ mode: 'detach' }) }] : []),
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]));
  tray.on('click', () => send('menu'));
}

app.whenReady().then(async () => {
  const store = createStore(app.getPath('userData'));
  const getSprite = createSpriteCache(path.join(app.getPath('userData'), 'sprites'));
  const dexData = JSON.parse(await readFile(path.join(here, '../../data/kalos.json'), 'utf8'));

  ipcMain.handle('data:dex', () => dexData);
  ipcMain.handle('save:load', () => store.load());
  ipcMain.handle('save:write', (_e, data) => store.save(data));
  ipcMain.handle('sprite:get', (_e, key, shiny) => getSprite(String(key), Boolean(shiny)));
  ipcMain.handle('signals:get', () => signals?.snapshot());
  ipcMain.handle('app:loginItem', (_e, on) => {
    if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on });
    buildTray();
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.on('mouse:interactive', (_e, on) => win?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('window:focus', () => win?.focus());
  ipcMain.on('tray:update', (_e, s) => { Object.assign(trayState, s); buildTray(); });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:flushed', () => { flushedForQuit = true; app.quit(); });

  createWindow();
  buildTray();
});

// 結束前先讓 renderer 把存檔寫完（最多等 1.5 秒）
app.on('before-quit', e => {
  if (flushedForQuit || !win) return;
  e.preventDefault();
  win.webContents.send('flush');
  setTimeout(() => { flushedForQuit = true; app.quit(); }, 1500);
});

app.on('second-instance', () => send('menu'));
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { windowProbe?.dispose(); signals?.dispose(); });
