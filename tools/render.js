// Renders procedural background scenes with Electron/Chromium.
// Usage: npx electron tools/render.js [sceneNumber ...]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const W = 2560, H = 1440;
const scenes = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const todo = scenes.length ? scenes : [1, 2, 3, 4];
const names = { 1: 'thrown', 2: 'downstream', 3: 'sinking', 4: 'mist' };

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'backgrounds');
  fs.mkdirSync(out, { recursive: true });
  for (const n of todo) {
    const win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, 'river.html'), { query: { scene: String(n), w: String(W), h: String(H) } });
    const t0 = Date.now();
    let data;
    for (;;) {
      data = await win.webContents.executeJavaScript('window.__result || (window.__error ? "ERR:" + window.__error : null)');
      if (data) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (data.startsWith('ERR:')) { console.error('scene', n, data); win.destroy(); continue; }
    const file = path.join(out, `${n}-${names[n]}.jpg`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', file, ((Date.now() - t0) / 1000).toFixed(1) + 's');
    win.destroy();
  }
  app.quit();
});
