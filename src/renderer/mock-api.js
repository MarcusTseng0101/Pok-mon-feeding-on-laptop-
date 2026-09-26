// 在一般瀏覽器裡開 index.html 時（沒有 Electron），用這個假的 API 代替 main process。
// 開發與截圖測試用：npx http-server 之類的靜態伺服器打開 src/renderer/index.html?dev=1
import { isSpriteKey } from '../core/forms.js';

export function createMockApi() {
  const listeners = new Map();
  const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  const params = new URLSearchParams(location.search);
  const spriteBase = params.get('sprites') ?? SPRITE_BASE;
  // ?windows=[{"hwnd":"1","x":200,"y":300,"w":600,"h":400}]：假裝桌面上有這些視窗（CSS 像素，由上到下）
  let lastWindows = params.get('windows') ? JSON.parse(params.get('windows')) : null;
  const api = {
    platform: 'web',
    async loadDexData() { return (await fetch(new URL('../../data/kalos.json', import.meta.url))).json(); },
    async loadSave() {
      if (params.get('fresh') === '1') return null;
      try { return JSON.parse(localStorage.getItem('kalos-save')); } catch { return null; }
    },
    async writeSave(data) { try { localStorage.setItem('kalos-save', JSON.stringify(data)); } catch { /* 無痕模式 */ } },
    async getSprite(id, shiny) {
      if (!isSpriteKey(id)) return null;
      try {
        const res = await fetch(`${spriteBase}${shiny ? '/shiny' : ''}/${id}.png`);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      } catch { return null; }
    },
    async getAnimSprite(id, shiny) {
      if (!isSpriteKey(id) || params.get('anim') === '0') return null;
      try {
        const res = await fetch(`${spriteBase}/other/showdown${shiny ? '/shiny' : ''}/${id}.gif`);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      } catch { return null; }
    },
    // 故事的訓練家圖：測試環境連不到 Showdown，只有 ?trainers=<網址> 時才去抓
    async getTrainerSprite(name) {
      const base = params.get('trainers');
      if (!base || !/^[a-z0-9-]{1,40}$/.test(name)) return null;
      try {
        const res = await fetch(`${base}/${name}.png`);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      } catch { return null; }
    },
    // ?weather=rain：假裝現在的天氣（測試用）；城市搜尋回傳固定的結果
    async searchCity(city) { return { places: city ? [{ name: city, region: '測試', lat: 24.965, lon: 121.217 }] : [], offline: false }; },
    async getWeather() { const w = params.get('weather'); return w ? { weather: w, code: 0 } : null; },
    // 同步資料夾（測試用）：放在記憶體裡；window.__mockSync[deviceId] = 存檔 可以假裝別台電腦
    async pickSyncFolder() { return '/mock-sync'; },
    async listSyncFiles(folder, selfId) { return Object.entries(window.__mockSync ?? {}).filter(([id]) => id !== selfId).map(([deviceId, data]) => ({ deviceId, data: structuredClone(data) })); },
    async writeSyncFile(folder, deviceId, data) { (window.__mockSync ??= {})[deviceId] = structuredClone(data); return true; },
    async getSignals() { return { idleSeconds: 0, cpu: 0.1, cpuHot: false, justPluggedIn: false, returnedFromIdle: false, returnedAt: 0 }; },
    interactiveCalls: [], // 測試用：檢查小遊戲結束後有沒有把滑鼠還給桌面
    setInteractive(on) { this.interactiveCalls.push(on); },
    focus() {},
    async setLoginItem() { return false; },
    updateTray() {},
    flushed() {},
    quit() {},
    on(channel, fn) {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(fn);
      if (channel === 'windows' && lastWindows) fn(lastWindows); // 跟 main process 一樣：一開始就收到目前的視窗
      return () => {};
    },
    emit(channel, payload) {
      if (channel === 'windows') lastWindows = payload;
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
  };
  return api;
}
