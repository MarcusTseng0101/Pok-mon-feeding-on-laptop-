// renderer 進入點：讀資料與存檔 → 建立遊戲、舞台、導演、介面 → 開始主迴圈。
import { createDex } from '../core/dex.js';
import { createRng } from '../core/rng.js';
import { migrate, defaultSave } from '../core/save.js';
import { Game } from '../core/game.js';
import { SpriteBank } from './gfx/sprites.js';
import { AudioEngine } from './audio/audio.js';
import { Stage } from './scene/stage.js';
import { Director } from './director.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';

async function main() {
  const api = window.kalos ?? (await import('./mock-api.js')).createMockApi();
  const dex = createDex(await api.loadDexData());
  const state = migrate(await api.loadSave(), dex, Date.now());
  const rng = createRng();
  const game = new Game({ dex, state, rng });

  const audio = new AudioEngine();
  const sprites = new SpriteBank(api, dex);
  const stage = new Stage({ canvas: document.getElementById('stage'), api, dex, sprites, audio, game });
  const director = new Director({ stage, game, dex, sprites, audio, api, rng, dev: DEV });
  const ui = new UI({ root: document.getElementById('ui'), game, dex, sprites, audio, stage, director, api, dev: DEV });
  director.ui = ui;
  window.__kalos = { game, stage, director, ui, audio, dex, api }; // 方便除錯

  // ---- 存檔：有變動就在 3 秒內寫入，另外每 30 秒保底一次 ----
  let dirty = false;
  const save = () => { dirty = false; stage.storePositions(); return api.writeSave(game.state); };
  game.on('change', () => { dirty = true; });
  setInterval(() => { if (dirty) save(); }, 3000);
  setInterval(save, 30_000);
  api.on('flush', async () => { await save(); api.flushed(); });

  ui.onReset = async () => {
    game.state = defaultSave(Date.now());
    await save();
    location.reload();
  };

  // ---- 音量與系統匣 ----
  const applyAudio = () => {
    const s = game.state.settings;
    const focusing = Boolean(game.state.focus.active); // 專注中：沒有音效、音樂小聲
    audio.setVolumes({ music: s.musicVolume * (focusing ? 0.3 : 1), sfx: focusing ? 0 : s.sfxVolume, muted: s.muted });
    api.updateTray({ muted: s.muted, quiet: s.quiet, focus: focusing, focusMinutes: s.focusMinutes });
  };
  ui.onSettings = applyAudio;
  game.on('settings', applyAudio);
  game.on('focus', applyAudio);
  applyAudio();

  api.on('command', cmd => {
    if (cmd === 'menu') ui.toggleMenu(true);
    else if (['party', 'dex', 'play', 'bag', 'aura', 'settings'].includes(cmd)) ui.open(cmd);
    else if (cmd === 'toggleMute') { game.setSetting('muted', !game.state.settings.muted); }
    else if (cmd === 'toggleQuiet') ui.toggleQuiet();
    else if (cmd === 'focusStart') ui.startFocus();
    else if (cmd === 'focusStop') ui.stopFocus();
  });

  // ---- 電腦狀態 → 氣息 ----
  director.setSignals(await api.getSignals());
  api.on('signals', s => director.setSignals(s));
  api.on('display', () => stage.resize());
  api.on('windows', list => stage.setWindows(list)); // 其他視窗的位置（寶可夢可以站在標題列上）

  // ---- 開始 ----
  const away = game.catchUp();
  director.refreshMusic();
  if (!state.starterChosen) {
    await Promise.all([650, 653, 656].map(id => sprites.get(id)));
    ui.showStarter(id => {
      audio.resume();
      game.chooseStarter(id);
      director.syncPets();
      director.scheduleNext();
      ui.toast(`${dex.name(id)}來到你的桌面了！試著用游標來回摸摸牠吧`);
      save();
    });
  } else {
    director.syncPets();
    if (away > 60) ui.toast('好久不見！夥伴們都在等你');
    setTimeout(() => director.showReadyEggs(), 2000); // 上次關掉時已經可以孵的蛋
  }
  sprites.prefetchAll();

  setInterval(() => {
    director.tickEggs(10);
    game.tick();
    director.updateEnv();
    director.refreshMusic();
  }, 10_000);

  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    director.update(dt);
    stage.frame(now);
    ui.update();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal hit">啟動失敗：${String(err.stack ?? err)}</pre>`);
});
