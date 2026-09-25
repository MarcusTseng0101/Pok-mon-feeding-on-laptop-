// 在一般瀏覽器裡開 index.html 時（沒有 Electron），用這個假的 API 代替 main process。
// 開發與截圖測試用：npx http-server 之類的靜態伺服器打開 src/renderer/index.html?dev=1
import { isSpriteKey } from '../core/forms.js';

export function createMockApi() {
  const listeners = new Map();
  const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
  const params = new URLSearchParams(location.search);
  const spriteBase = params.get('sprites') ?? SPRITE_BASE;
  return {
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
    async getSignals() { return { idleSeconds: 0, cpu: 0.1, cpuHot: false, justPluggedIn: false, returnedFromIdle: false, returnedAt: 0 }; },
    setInteractive() {},
    focus() {},
    async setLoginItem() { return false; },
    updateTray() {},
    flushed() {},
    quit() {},
    on(channel, fn) {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(fn);
      return () => {};
    },
    emit(channel, payload) { for (const fn of listeners.get(channel) ?? []) fn(payload); },
  };
}
