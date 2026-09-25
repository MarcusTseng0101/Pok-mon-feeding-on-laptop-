// renderer 只能透過這個窄窄的介面跟 main process 溝通
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['cursor', 'signals', 'command', 'flush', 'display'];

contextBridge.exposeInMainWorld('kalos', {
  platform: process.platform,
  loadDexData: () => ipcRenderer.invoke('data:dex'),
  loadSave: () => ipcRenderer.invoke('save:load'),
  writeSave: data => ipcRenderer.invoke('save:write', data),
  getSprite: (id, shiny) => ipcRenderer.invoke('sprite:get', id, shiny),
  getSignals: () => ipcRenderer.invoke('signals:get'),
  setInteractive: on => ipcRenderer.send('mouse:interactive', on),
  focus: () => ipcRenderer.send('window:focus'),
  setLoginItem: on => ipcRenderer.invoke('app:loginItem', on),
  updateTray: state => ipcRenderer.send('tray:update', state),
  flushed: () => ipcRenderer.send('app:flushed'),
  quit: () => ipcRenderer.send('app:quit'),
  on(channel, fn) {
    if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${channel}`);
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
