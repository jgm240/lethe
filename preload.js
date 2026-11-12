const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lin', {
  platform: process.platform,
  cmd: (name, arg) => ipcRenderer.send('cmd', name, arg),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFind: cb => ipcRenderer.on('find-result', (_e, r) => cb(r)),
  onFocusAddress: cb => ipcRenderer.on('focus-address', () => cb()),
  onTheme: cb => ipcRenderer.on('theme', (_e, t) => cb(t)),
  onFill: cb => ipcRenderer.on('fill', (_e, t) => cb(t)),
  onToast: cb => ipcRenderer.on('toast', (_e, t) => cb(t))
});
