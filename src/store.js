const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const timers = {};
const file = name => path.join(app.getPath('userData'), name + '.json');

function loadJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function saveJSON(name, data) {
  if (!require('electron').app.isPackaged && process.env.LETHE_SETTINGS && name === 'settings') return; // dev test overrides must never be persisted
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => {
    try { fs.writeFileSync(file(name), JSON.stringify(data)); } catch { /* ignore */ }
  }, 150);
}
function saveJSONNow(name, data) {
  if (!require('electron').app.isPackaged && process.env.LETHE_SETTINGS && name === 'settings') return;
  clearTimeout(timers[name]);
  try { fs.writeFileSync(file(name), JSON.stringify(data)); } catch { /* ignore */ }
}
module.exports = { loadJSON, saveJSON, saveJSONNow };
