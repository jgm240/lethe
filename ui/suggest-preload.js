const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sug', {
  onItems: cb => ipcRenderer.on('suggest-items', (_e, d) => cb(d)),
  onTheme: cb => ipcRenderer.on('theme', (_e, t) => cb(t)),
  choose: i => ipcRenderer.send('cmd', 'suggest-choose', i)
});
