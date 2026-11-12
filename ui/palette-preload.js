const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pal', {
  onOpen: cb => ipcRenderer.on('palette:open', (_e, items) => cb(items)),
  onTheme: cb => ipcRenderer.on('theme', (_e, t) => cb(t)),
  run: arg => ipcRenderer.send('cmd', 'palette-run', arg),
  close: () => ipcRenderer.send('cmd', 'palette-close')
});
