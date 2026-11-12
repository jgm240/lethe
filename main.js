const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog, clipboard, nativeTheme, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { isTracker, siteOf } = require('./trackers');
const { ENGINES, BACKGROUNDS, LOCATIONS, UA_PRESETS, load: loadSettings, applySetting } = require('./src/settings');
const { resolveUA } = require('./src/useragents');
const tzlookup = require('tz-lookup');
const { resolveTheme, presetList } = require('./src/themes');
const { loadJSON, saveJSON, saveJSONNow } = require('./src/store');
const { startServer } = require('./src/server');
const COOKIE_SCRIPT = require('./src/cookiepopups');
const PROMO = require('./src/promo');

app.setName('InstaOlvidar Browser');

const PARTITION = 'persist:instaolvidar';
const TOPBAR = 82;
const FINDBAR = 40;
const isMac = process.platform === 'darwin';
const DEV = !app.isPackaged; // test hooks (INSTA_*) only exist in development runs
const REPO_URL = require('./package.json').homepage || '';
const ICON = path.join(__dirname, 'build', 'icon.png');

let ORIGIN = '';
let NEWTAB = '';
let settings, bookmarks, history, downloads = [], closedTabs = [];
let win = null, ses = null, tabs = [], activeId = null, nextId = 1, findOpen = false, quitting = false, firedOnExit = false;
let theme = null;
let BASE_UA = '';
let curUA = { ua: '', spoofed: false, hideCH: false };
let suggestView = null;
const suggest = { items: [], sel: -1, shown: false, seq: 0, text: '' };
const httpAllow = new Set();
const pendingUpgrade = new Map();

// ---------- URLs ----------
const INTERNAL = { newtab: 'newtab.html', settings: 'settings.html', bookmarks: 'bookmarks.html', history: 'history.html', downloads: 'downloads.html' };
const isInternal = url => !!ORIGIN && url.startsWith(ORIGIN + '/');

function toReal(url) {
  const m = /^io-browser:\/\/([a-z]+)(?:\/([\w-]{11}))?(\?.*)?$/i.exec(url);
  if (!m) return url;
  const [, name, id, q] = m;
  if (name === 'player') return `${ORIGIN}/player.html?v=${id || ''}` + (q ? '&' + q.slice(1) : '');
  if (INTERNAL[name.toLowerCase()]) return `${ORIGIN}/${INTERNAL[name.toLowerCase()]}${q || ''}`;
  return NEWTAB;
}
function toDisplay(url) {
  if (!isInternal(url)) return url;
  try {
    const u = new URL(url), n = u.pathname.slice(1).replace('.html', '');
    if (n === 'newtab') return '';
    if (n === 'player') return `io-browser://player/${u.searchParams.get('v') || ''}`;
    return `io-browser://${n}${u.search}`;
  } catch { return ''; }
}
function searchUrl(q) { return ENGINES[settings.general.searchEngine].url + encodeURIComponent(q); }

function normalizeInput(text) {
  const t = String(text || '').trim();
  if (!t) return NEWTAB;
  if (/^io-browser:/i.test(t)) return toReal(t);
  if (/^(https?|file|about):/i.test(t)) return t;
  if (!/\s/.test(t) && /^(localhost|(\d{1,3}\.){3}\d{1,3}|([\w-]+\.)+[a-z]{2,})(:\d+)?([/?#]\S*)?$/i.test(t)) {
    const local = /^(localhost|127\.|10\.|192\.168\.)/i.test(t);
    return (local ? 'http://' : 'https://') + t;
  }
  return searchUrl(t);
}
const looksLikeUrl = t => normalizeInput(t) !== searchUrl(t.trim()) && !!t.trim();

function isLocal(h) {
  return h === 'localhost' || h.endsWith('.localhost') || /^(127\.|10\.|192\.168\.)/.test(h) || h === '[::1]' || h.endsWith('.local');
}
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };

// YouTube -> InstaOlvidar Player
function youtubeTarget(u) {
  const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = null;
  if (h === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/shorts\/([\w-]{11})/.exec(u.pathname); if (m) id = m[1]; }
  } else if (h === 'youtu.be') { const m = /^\/([\w-]{11})/.exec(u.pathname); if (m) id = m[1]; }
  if (!id || !/^[\w-]{11}$/.test(id) || u.searchParams.has('insta_np')) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start');
  let start = 0;
  if (t) { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t); if (m) start = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); }
  return { id, url: `${ORIGIN}/player.html?v=${id}` + (start ? `&start=${start}` : '') };
}

// What DuckDuckGo's own browser sends (Safari-style UA ending in a Ddg/<version> token). Sent ONLY to duckduckgo.com.
const DDG_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Ddg/18.0';
const isDdgHost = h => h === 'duckduckgo.com' || h.endsWith('.duckduckgo.com');

const TRACK_PARAM = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_eid|mc_cid|igshid|yclid|_hsenc|_hsmi|mkt_tok|ref_src|ref_url|twclid|wbraid|gbraid|vero_id|oly_enc_id|oly_anon_id|s_cid)$/i;
const isProtected = host => !settings.privacy.unprotectedSites.includes(siteOf(host));

// ---------- content blocking + location spoofing ----------
const getSetting = key => key.split('.').reduce((a, k) => a[k], settings);
function contentPolicy() {
  const c = settings.content, parts = [];
  if (c.noJs) parts.push("script-src 'none'");
  if (c.noCss) parts.push("style-src 'none'");
  if (c.noImages) parts.push("img-src 'none'");
  return parts.join('; ');
}
async function applyLocation(tab) {
  const wc = tab.view.webContents, loc = settings.location;
  try {
    if (!loc.spoof && !wc.debugger.isAttached()) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    if (loc.spoof) {
      await wc.debugger.sendCommand('Emulation.setGeolocationOverride', { latitude: loc.lat, longitude: loc.lon, accuracy: 25 });
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: loc.tz });
    } else {
      await wc.debugger.sendCommand('Emulation.clearGeolocationOverride');
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: '' });
    }
  } catch { /* tab may be closing */ }
}
const applyLocationAll = () => tabs.forEach(applyLocation);
// Chromium's own UA emulation: keeps the User-Agent header, navigator.userAgent/platform, navigator.userAgentData
// and the sec-ch-ua-* request headers consistent with the chosen identity.
async function applyUAEmulation(tab) {
  const wc = tab.view.webContents;
  try {
    if (!curUA.spoofed && !wc.debugger.isAttached()) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    if (!curUA.spoofed) { await wc.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: '' }); return; }
    const params = { userAgent: curUA.ua, platform: curUA.platform || '' };
    if (curUA.chromeMajor) {
      const v = String(curUA.chromeMajor);
      params.userAgentMetadata = {
        brands: [{ brand: 'Chromium', version: v }, { brand: 'Google Chrome', version: v }, { brand: 'Not_A Brand', version: '24' }],
        fullVersion: v + '.0.0.0', platform: curUA.chPlatform, platformVersion: '', architecture: curUA.mobile ? '' : 'x86', model: '', mobile: !!curUA.mobile
      };
    }
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', params);
  } catch { /* tab may be closing */ }
}
const applyUAAll = () => tabs.forEach(applyUAEmulation);
const locationName = () => { const l = LOCATIONS.find(x => x.id === settings.location.preset); return l ? l.name : `${settings.location.lat}, ${settings.location.lon}`; };

function applyUserAgent() {
  curUA = resolveUA(settings, BASE_UA);
  ses.setUserAgent(curUA.ua);
}

// ---------- data ----------
function saveAll() {
  saveJSON('settings', settings); saveJSON('bookmarks', bookmarks); saveJSON('history', history);
}
const activeTab = () => tabs.find(t => t.id === activeId);
const tabByWcId = id => tabs.find(t => t.view.webContents.id === id);
const displayUrl = t => toDisplay(t.url);

function applyTheme() {
  theme = resolveTheme(settings, nativeTheme.shouldUseDarkColors);
  nativeTheme.themeSource = theme.dark ? 'dark' : 'light';
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(theme.vars.bg);
    win.webContents.send('theme', theme);
    if (suggestView) suggestView.webContents.send('theme', theme);
    for (const t of tabs) if (isInternal(t.url)) t.view.webContents.send('insta:theme', theme);
  }
}

// ---------- layout / state ----------
function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const top = TOPBAR + (findOpen ? FINDBAR : 0);
  const t = activeTab();
  if (t) t.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const t = activeTab();
  const wc = t && t.view.webContents;
  const url = t ? displayUrl(t) : '';
  const real = t ? t.url : '';
  win.webContents.send('state', {
    tabs: tabs.map(x => ({ id: x.id, title: x.title, favicon: x.favicon, loading: x.loading })),
    activeId,
    url,
    secure: !!t && (real.startsWith('https:') || isInternal(real)),
    blocked: t ? t.blocked : 0,
    protectedSite: !t || isInternal(real) || isProtected(hostOf(real)),
    canGoBack: !!wc && wc.navigationHistory.canGoBack(),
    canGoForward: !!wc && wc.navigationHistory.canGoForward(),
    loading: !!t && t.loading,
    bookmarked: !!url && bookmarks.some(b => b.url === url),
    findOpen
  });
}

// ---------- suggestions overlay ----------
function hideSuggest() {
  suggest.items = []; suggest.sel = -1; suggest.seq++;
  if (suggest.shown && win && !win.isDestroyed()) { try { win.contentView.removeChildView(suggestView); } catch { /* ignore */ } }
  suggest.shown = false;
}
function showSuggest(rect) {
  if (!suggest.items.length) return hideSuggest();
  const h = Math.min(suggest.items.length, 8) * 34 + 10;
  suggestView.setBounds({ x: Math.round(rect.x), y: 78, width: Math.round(rect.w), height: h });
  win.contentView.addChildView(suggestView);
  suggest.shown = true;
  suggestView.webContents.send('suggest-items', { items: suggest.items, sel: suggest.sel });
}
function matchLocal(text) {
  const q = text.toLowerCase(), out = [], seen = new Set();
  const add = (kind, label, url) => { if (!seen.has(url) && out.length < 4) { seen.add(url); out.push({ kind, label: label || url, sub: url.replace(/^https?:\/\//, ''), url, fill: url }); } };
  for (const b of bookmarks) if ((b.title || '').toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) add('bookmark', b.title, b.url);
  for (const h of history) if ((h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) add('history', h.title, h.url);
  return out;
}
async function updateSuggest(text, rect) {
  const seq = ++suggest.seq;
  suggest.text = text;
  if (!text.trim()) return hideSuggest();
  const first = looksLikeUrl(text)
    ? { kind: 'url', label: text.trim(), sub: 'Go to site', url: normalizeInput(text), fill: text.trim() }
    : { kind: 'search', label: text.trim(), sub: 'Search ' + ENGINES[settings.general.searchEngine].name, url: searchUrl(text.trim()), fill: text.trim() };
  suggest.items = [first, ...matchLocal(text.trim())];
  suggest.sel = -1;
  suggest.rect = rect;
  showSuggest(rect);
  if (settings.general.suggestions && settings.general.searchEngine === 'duckduckgo' && text.trim().length >= 2 && !looksLikeUrl(text)) {
    try {
      const r = await net.fetch('https://duckduckgo.com/ac/?type=list&q=' + encodeURIComponent(text.trim()));
      const data = await r.json();
      if (seq !== suggest.seq) return;
      const extra = (data[1] || []).slice(0, 5).filter(s => s.toLowerCase() !== text.trim().toLowerCase())
        .map(s => ({ kind: 'search', label: s, sub: '', url: searchUrl(s), fill: s }));
      suggest.items = [first, ...extra, ...matchLocal(text.trim())].slice(0, 8);
      showSuggest(rect);
    } catch { /* offline: local suggestions only */ }
  }
}

// ---------- tabs ----------
function recordHistory(tab) {
  if (!settings.privacy.saveHistory || !/^https?:/.test(tab.url) || isInternal(tab.url)) return;
  const last = history[0];
  if (last && last.url === tab.url && Date.now() - last.time < 60000) { last.title = tab.title; return; }
  history.unshift({ url: tab.url, title: tab.title, time: Date.now() });
  if (history.length > 3000) history.length = 3000;
  saveJSON('history', history);
}

function ytBanner(url) {
  return `(() => { try {
    if (document.getElementById('instaolvidar-yt-banner')) return;
    const host = document.createElement('div'); host.id = 'instaolvidar-yt-banner';
    host.style.cssText = 'position:fixed;top:72px;right:16px;z-index:2147483647';
    const sh = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.style.cssText = 'font:14px system-ui,sans-serif;background:#1f2048;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);display:flex;gap:12px;align-items:center;max-width:380px';
    const txt = document.createElement('span'); txt.textContent = 'Watch without personalized ads or tracking?';
    const a = document.createElement('a'); a.href = ${JSON.stringify(url)}; a.textContent = 'Open in Player';
    a.style.cssText = 'background:#e8663d;color:#fff;text-decoration:none;padding:7px 12px;border-radius:8px;font-weight:600;white-space:nowrap';
    const x = document.createElement('button'); x.textContent = '\\u2715';
    x.style.cssText = 'background:none;border:0;color:#fff;opacity:.7;cursor:pointer;font-size:14px';
    x.onclick = () => host.remove();
    box.append(txt, a, x); sh.append(box); document.documentElement.append(host);
  } catch (e) {} })()`;
}

function createTab(input, activate = true) {
  const url = input ? normalizeInput(input) : NEWTAB;
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'pagePreload.js'), autoplayPolicy: 'no-user-gesture-required'
    }
  });
  const tab = { id: nextId++, view, title: 'New Tab', url, favicon: null, loading: false, blocked: 0, blockedHosts: {}, stripped: 0, popups: 0 };
  tabs.push(tab);
  const wc = view.webContents;
  applyLocation(tab);
  applyUAEmulation(tab);

  wc.setWindowOpenHandler(({ url: u }) => { createTab(u, true); return { action: 'deny' }; });
  wc.on('page-title-updated', (_e, title) => { tab.title = title; pushState(); });
  wc.on('page-favicon-updated', (_e, favs) => { tab.favicon = favs[0] || null; pushState(); });
  wc.on('did-start-loading', () => { tab.loading = true; pushState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; tab.url = wc.getURL() || tab.url; recordHistory(tab); pushState(); });
  wc.on('did-start-navigation', d => {
    if (d.isMainFrame && !d.isSameDocument) { tab.blocked = 0; tab.blockedHosts = {}; tab.stripped = 0; tab.popups = 0; tab.favicon = null; }
  });
  wc.on('did-navigate', (_e, u) => {
    tab.url = u;
    if (isInternal(u)) { tab.title = tab.title === 'New Tab' || !tab.title ? ({ newtab: 'New Tab', settings: 'Settings', bookmarks: 'Bookmarks', history: 'History', downloads: 'Downloads', player: 'InstaOlvidar Player' }[toDisplay(u).replace('io-browser://', '').split(/[/?]/)[0]] || 'InstaOlvidar') : tab.title; wc.send('insta:theme', theme); }
    pushState();
  });
  wc.on('did-navigate-in-page', (_e, u, isMain) => { if (isMain) { tab.url = u; pushState(); maybeBanner(wc, u); } });
  wc.on('dom-ready', () => {
    const u = wc.getURL();
    if (isInternal(u)) { wc.send('insta:theme', theme); return; }
    if (settings.content.noJs) return;
    if (settings.general.hideSearchPromos && !(DEV && process.env.INSTA_NO_HIDE) && /^https:\/\/([\w-]+\.)?duckduckgo\.com\//.test(u)) {
      wc.insertCSS(PROMO.CSS).catch(() => {});
      wc.executeJavaScript(PROMO.JS).catch(() => {});
    }
    if (settings.privacy.cookiePopups && /^https?:/.test(u) && isProtected(hostOf(u))) {
      wc.executeJavaScript(COOKIE_SCRIPT).then(n => { if (n > 0 && tabs.includes(tab)) { tab.popups += n; pushState(); } }).catch(() => {});
    }
  });
  wc.on('did-finish-load', () => maybeBanner(wc, wc.getURL()));
  wc.on('did-fail-load', (_e, code, _desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return;
    try {
      const h = new URL(failedUrl).hostname;
      if (pendingUpgrade.has(h)) { const original = pendingUpgrade.get(h); pendingUpgrade.delete(h); httpAllow.add(h); wc.loadURL(original).catch(() => {}); }
    } catch { /* ignore */ }
  });
  wc.on('found-in-page', (_e, r) => { if (tab.id === activeId) win.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }); });
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.linkURL) {
      items.push({ label: 'Open Link in New Tab', click: () => createTab(p.linkURL, false) }, { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    if (p.mediaType === 'image') items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) });
    if (p.selectionText) {
      items.push({ role: 'copy' });
      items.push({ label: `Search ${ENGINES[settings.general.searchEngine].name} for “${p.selectionText.trim().slice(0, 60)}”`, click: () => createTab(searchUrl(p.selectionText.trim()), true) });
    }
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    if (!p.linkURL && !p.selectionText && !p.isEditable) {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() }
      );
    }
    items.push({ type: 'separator' }, { label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  wc.loadURL(url).catch(() => {});
  if (activate) activateTab(tab.id); else pushState();
  return tab;
}

function maybeBanner(wc, u) {
  if (settings.player.mode !== 'ask') return;
  try {
    const x = new URL(u);
    const yt = youtubeTarget(x);
    if (yt && !isInternal(u)) wc.executeJavaScript(ytBanner(yt.url)).catch(() => {});
  } catch { /* ignore */ }
}

function activateTab(id) {
  const next = tabs.find(t => t.id === id);
  if (!next) return;
  hideSuggest();
  const cur = activeTab();
  if (cur && cur !== next) {
    try { cur.view.webContents.stopFindInPage('clearSelection'); } catch { /* ignore */ }
    win.contentView.removeChildView(cur.view);
  }
  activeId = id;
  win.contentView.addChildView(next.view);
  layout();
  pushState();
  if (next.url === NEWTAB) win.webContents.send('focus-address'); else next.view.webContents.focus();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [tab] = tabs.splice(i, 1);
  if (/^https?:/.test(tab.url) || (isInternal(tab.url) && tab.url !== NEWTAB)) { closedTabs.push({ url: tab.url, title: tab.title }); if (closedTabs.length > 20) closedTabs.shift(); }
  try { win.contentView.removeChildView(tab.view); } catch { /* ignore */ }
  tab.view.webContents.close();
  if (!tabs.length) { createTab(); return; }
  if (id === activeId) activateTab(tabs[Math.min(i, tabs.length - 1)].id); else pushState();
}
function reopenTab() { const c = closedTabs.pop(); if (c) createTab(c.url, true); }
function cycleTab(dir) { const i = tabs.findIndex(t => t.id === activeId); activateTab(tabs[(i + dir + tabs.length) % tabs.length].id); }
function openInternal(name) {
  const url = toReal(`io-browser://${name}`);
  const existing = tabs.find(t => t.url === url || t.url.startsWith(url + '?'));
  if (existing) activateTab(existing.id); else createTab(url, true);
}

// ---------- Fire Button ----------
async function clearAllData() {
  const keep = new Set(settings.privacy.fireproofSites);
  let saved = [];
  if (keep.size) {
    const all = await ses.cookies.get({});
    saved = all.filter(c => keep.has(siteOf((c.domain || '').replace(/^\./, ''))));
  }
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  await ses.clearHostResolverCache();
  for (const c of saved) {
    const dom = (c.domain || '').replace(/^\./, '');
    try {
      await ses.cookies.set({ url: (c.secure ? 'https://' : 'http://') + dom + (c.path || '/'), name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate, sameSite: c.sameSite });
    } catch { /* ignore */ }
  }
  history = []; downloads = []; closedTabs = []; httpAllow.clear();
  saveJSONNow('history', history);
}

async function fire() {
  const fp = settings.privacy.fireproofSites.length;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Burn All Tabs and Data', 'Cancel'], defaultId: 0, cancelId: 1,
    message: 'Burn all tabs and data?',
    detail: 'Closes every tab and erases history, cookies, site data, cache and downloads list. Bookmarks and settings are kept.' + (fp ? `\n${fp} fireproof site${fp === 1 ? '' : 's'} will stay signed in.` : '')
  });
  if (response !== 0) return;
  hideSuggest();
  const old = tabs.slice();
  tabs = []; activeId = null;
  for (const t of old) { try { win.contentView.removeChildView(t.view); } catch { /* ignore */ } t.view.webContents.close(); }
  await clearAllData();
  createTab();
}

// ---------- privacy engine ----------
function setupPrivacy() {
  ses = session.fromPartition(PARTITION);
  BASE_UA = ses.getUserAgent().replace(/\s(Electron|instaolvidar-browser|InstaOlvidar[^/]*)\/\S+/gi, '');
  applyUserAgent();

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
    let u;
    try { u = new URL(d.url); } catch { return cb({}); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb({});
    if (u.origin === ORIGIN) return cb({});
    const tab = tabByWcId(d.webContentsId);
    const main = d.resourceType === 'mainFrame';
    const pageHost = tab ? hostOf(tab.url) : '';
    const prot = isProtected(main ? u.hostname : pageHost);

    if (main) {
      // InstaOlvidar Player
      if (settings.player.mode === 'always') { const yt = youtubeTarget(u); if (yt) return cb({ redirectURL: yt.url }); }
      // Link tracking protection
      if (settings.privacy.stripTrackingParams && prot) {
        let changed = false;
        for (const k of [...u.searchParams.keys()]) if (TRACK_PARAM.test(k)) { u.searchParams.delete(k); changed = true; }
        if (changed) { if (tab) tab.stripped++; return cb({ redirectURL: u.toString() }); }
      }
    }
    // Smarter encryption
    if (settings.privacy.httpsUpgrade && prot && u.protocol === 'http:' && !isLocal(u.hostname) && !httpAllow.has(u.hostname)) {
      if (main) pendingUpgrade.set(u.hostname, d.url);
      return cb({ redirectURL: d.url.replace(/^http:/, 'https:') });
    }
    // Tracker blocking (third-party only)
    if (settings.privacy.trackerBlocking && tab && !main && prot && isTracker(u.hostname) && siteOf(u.hostname) !== siteOf(pageHost)) {
      tab.blocked++;
      tab.blockedHosts[siteOf(u.hostname)] = (tab.blockedHosts[siteOf(u.hostname)] || 0) + 1;
      if (tab.id === activeId) pushState();
      return cb({ cancel: true });
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (d, cb) => {
    const h = d.requestHeaders;
    if (curUA.hideCH) for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('sec-ch-ua')) delete h[k]; // Firefox/Safari don't send Chromium client hints
    else if (curUA.spoofed && curUA.chPlatform) for (const k of Object.keys(h)) { // keep Chromium client hints consistent with the chosen UA
      const l = k.toLowerCase();
      if (l === 'sec-ch-ua-platform') h[k] = `"${curUA.chPlatform}"`;
      else if (l === 'sec-ch-ua-mobile') h[k] = curUA.mobile ? '?1' : '?0';
    }
    if (d.url.startsWith('https://tile.openstreetmap.org/')) h['User-Agent'] = `InstaOlvidar-Browser/${app.getVersion()}` + (REPO_URL ? ` (+${REPO_URL})` : ''); // OSM tile policy: identify the app
    if (settings.privacy.gpc && !d.url.startsWith(ORIGIN)) { h['Sec-GPC'] = '1'; h['DNT'] = '1'; }
    if (settings.general.ddgBrowserHint && !(DEV && process.env.INSTA_NO_HINT)) { try { if (isDdgHost(new URL(d.url).hostname)) h['User-Agent'] = DDG_UA; } catch { /* ignore */ } }
    const refKey = Object.keys(h).find(k => k.toLowerCase() === 'referer');
    if (refKey) {
      try {
        const r = new URL(h[refKey]), t = new URL(d.url);
        if (siteOf(r.hostname) !== siteOf(t.hostname)) h[refKey] = r.origin + '/';
      } catch { /* ignore */ }
    }
    cb({ requestHeaders: h });
  });

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, cb) => {
    const tab = tabByWcId(d.webContentsId);
    const policy = contentPolicy();
    if (policy && d.responseHeaders && d.url.startsWith('http') && !d.url.startsWith(ORIGIN + '/')
        && (d.resourceType === 'mainFrame' || (d.resourceType === 'subFrame' && tab && !isInternal(tab.url)))) {
      const key = Object.keys(d.responseHeaders).find(k => k.toLowerCase() === 'content-security-policy');
      d.responseHeaders[key || 'Content-Security-Policy'] = [...(key ? d.responseHeaders[key] : []), policy];
    }
    if (settings.privacy.thirdPartyCookies && tab && d.resourceType !== 'mainFrame' && d.responseHeaders) {
      try {
        if (siteOf(hostOf(tab.url)) !== siteOf(new URL(d.url).hostname)) {
          for (const k of Object.keys(d.responseHeaders)) if (k.toLowerCase() === 'set-cookie') delete d.responseHeaders[k];
        }
      } catch { /* ignore */ }
    }
    cb({ responseHeaders: d.responseHeaders });
  });

  const allowed = ['fullscreen', 'clipboard-sanitized-write'];
  const ok = perm => allowed.includes(perm) || (perm === 'geolocation' && settings.location.spoof);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(ok(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => ok(perm));

  let dlId = 1;
  ses.on('will-download', (_e, item) => {
    const rec = { id: dlId++, name: item.getFilename(), url: item.getURL(), state: 'progressing', received: 0, total: item.getTotalBytes(), path: '', time: Date.now() };
    downloads.unshift(rec);
    item.on('updated', () => { rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes(); rec.path = item.getSavePath(); });
    item.once('done', (_ev, state) => { rec.state = state; rec.path = item.getSavePath(); rec.received = item.getReceivedBytes(); });
  });
}

// ---------- menus ----------
function bookmarkMenu() {
  const items = bookmarks.length
    ? bookmarks.slice(0, 40).map(b => ({ label: (b.title || b.url).slice(0, 60), click: () => createTab(b.url, true) }))
    : [{ label: 'No bookmarks yet', enabled: false }];
  return [...items, { type: 'separator' }, { label: 'Manage Bookmarks…', click: () => openInternal('bookmarks') }];
}
function toggleBookmark() {
  const t = activeTab(); const url = t && displayUrl(t) ? (isInternal(t.url) ? '' : t.url) : '';
  if (!url) return;
  const i = bookmarks.findIndex(b => b.url === url);
  if (i >= 0) bookmarks.splice(i, 1); else bookmarks.push({ url, title: t.title, favorite: false, added: Date.now() });
  saveJSON('bookmarks', bookmarks); pushState();
}
function zoom(delta) { const wc = activeTab().view.webContents; wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta); }
function openFind() { findOpen = true; layout(); pushState(); win.webContents.focus(); }
function toggleList(key, site) {
  const list = settings.privacy[key], i = list.indexOf(site);
  if (i >= 0) list.splice(i, 1); else list.push(site);
  saveJSON('settings', settings); pushState();
}

function popupMenu(kind) {
  hideSuggest();
  const t = activeTab();
  const host = hostOf(t.url), site = siteOf(host), internal = isInternal(t.url);
  let tpl = [];
  if (kind === 'shield') {
    const hosts = Object.entries(t.blockedHosts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    tpl = [
      { label: internal ? 'InstaOlvidar page' : t.url.startsWith('https:') ? 'Connection is encrypted (HTTPS)' : 'Connection is not encrypted', enabled: false },
      { label: `${t.blocked} tracker request${t.blocked === 1 ? '' : 's'} blocked`, enabled: false },
      ...hosts.map(([h, n]) => ({ label: `    ${h} — ${n}`, enabled: false })),
      ...(t.stripped ? [{ label: `${t.stripped} tracking parameter redirect${t.stripped === 1 ? '' : 's'} cleaned`, enabled: false }] : []),
      ...(t.popups ? [{ label: `${t.popups} cookie pop-up${t.popups === 1 ? '' : 's'} handled`, enabled: false }] : []),
      ...(contentPolicy() ? [{ label: 'Blocking on this page: ' + [settings.content.noJs && 'JavaScript', settings.content.noCss && 'CSS', settings.content.noImages && 'images'].filter(Boolean).join(', '), enabled: false }] : []),
      ...(settings.location.spoof ? [{ label: `Location spoofed: ${locationName()}`, enabled: false }] : []),
      { type: 'separator' },
      ...(internal ? [] : [
        { label: `Protections on for ${site}`, type: 'checkbox', checked: isProtected(host), click: () => { toggleList('unprotectedSites', site); t.view.webContents.reload(); } },
        { label: `Fireproof ${site}`, type: 'checkbox', checked: settings.privacy.fireproofSites.includes(site), click: () => toggleList('fireproofSites', site) },
        { type: 'separator' }
      ]),
      { label: 'Privacy Settings…', click: () => openInternal('settings') }
    ];
  } else if (kind === 'bookmarks') {
    tpl = bookmarkMenu();
  } else {
    tpl = [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: closedTabs.length > 0, click: reopenTab },
      { type: 'separator' },
      { label: 'Bookmarks', submenu: bookmarkMenu() },
      { label: 'History', click: () => openInternal('history') },
      { label: 'Downloads', click: () => openInternal('downloads') },
      { type: 'separator' },
      { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: openFind },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => t.view.webContents.print() },
      { label: 'Zoom In', click: () => zoom(0.5) }, { label: 'Zoom Out', click: () => zoom(-0.5) }, { label: 'Actual Size', click: () => zoom(0) },
      { type: 'separator' },
      { label: 'Page Content', submenu: [
        ...[['No CSS', 'content.noCss'], ['No Images', 'content.noImages'], ['No JavaScript', 'content.noJs'], ['Spoof Location', 'location.spoof']].map(([label, key]) => ({
          label: key === 'location.spoof' ? `${label} (${locationName()})` : label, type: 'checkbox', checked: !!getSetting(key),
          click: () => { applySetting(settings, key, !getSetting(key)); saveJSON('settings', settings); if (key === 'location.spoof') applyLocationAll(); if (!isInternal(t.url)) t.view.webContents.reload(); pushState(); }
        })),
        { type: 'separator' }, { label: 'More Content Settings…', click: () => { openInternal('settings'); } }
      ] },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openInternal('settings') },
      { label: 'Developer Tools', click: () => t.view.webContents.openDevTools({ mode: 'detach' }) },
      { label: 'Burn All Tabs and Data…', click: fire },
      { type: 'separator' },
      { label: 'About InstaOlvidar Browser', click: () => dialog.showMessageBox(win, { message: 'InstaOlvidar Browser', detail: `Version ${app.getVersion()}\nOlvídalo al instante — forget instantly.\nPrivate by default. Search powered by DuckDuckGo.` }) }
    ];
  }
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function buildAppMenu() {
  const nav = () => activeTab().view.webContents;
  const tpl = [
    ...(isMac ? [{ label: 'InstaOlvidar', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => openInternal('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeId) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: reopenTab },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: () => { win.webContents.focus(); win.webContents.send('focus-address'); } },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => nav().print() },
        { label: 'Burn All Tabs and Data…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: fire },
        ...(isMac ? [] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: () => openInternal('settings') }, { role: 'quit' }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => nav().reload() },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: openFind },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => nav().openDevTools({ mode: 'detach' }) }
      ]
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => nav().navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => nav().navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'Show All History', accelerator: 'CmdOrCtrl+Y', click: () => openInternal('history') },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => openInternal('downloads') }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: toggleBookmark },
        { label: 'Manage Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => openInternal('bookmarks') },
        { type: 'separator' },
        ...bookmarks.slice(0, 30).map(b => ({ label: (b.title || b.url).slice(0, 60), click: () => createTab(b.url, true) }))
      ]
    },
    {
      label: 'Tab',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => cycleTab(1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycleTab(-1) },
        ...Array.from({ length: 8 }, (_, i) => ({ label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => tabs[i] && activateTab(tabs[i].id) }))
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- bookmarks import/export ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
async function importBookmarks() {
  const r = await dialog.showOpenDialog(win, { title: 'Import bookmarks', filters: [{ name: 'Bookmarks (HTML)', extensions: ['html', 'htm'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return 0;
  const html = fs.readFileSync(r.filePaths[0], 'utf8');
  let n = 0;
  for (const m of html.matchAll(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([^<]*)<\/a>/gi)) {
    if (!bookmarks.some(b => b.url === m[1])) { bookmarks.push({ url: m[1], title: m[2].replace(/&amp;/g, '&').trim(), favorite: false, added: Date.now() }); n++; }
  }
  saveJSON('bookmarks', bookmarks);
  return n;
}
async function exportBookmarks() {
  const r = await dialog.showSaveDialog(win, { title: 'Export bookmarks', defaultPath: 'instaolvidar-bookmarks.html', filters: [{ name: 'Bookmarks (HTML)', extensions: ['html'] }] });
  if (r.canceled || !r.filePath) return false;
  const body = bookmarks.map(b => `    <DT><A HREF="${esc(b.url)}">${esc(b.title || b.url)}</A>`).join('\n');
  fs.writeFileSync(r.filePath, `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${body}\n</DL><p>\n`);
  return true;
}

// ---------- IPC: browser chrome ----------
ipcMain.on('cmd', (_e, name, arg) => {
  const t = activeTab();
  const wc = t && t.view.webContents;
  switch (name) {
    case 'ready': pushState(); if (theme) win.webContents.send('theme', theme); break;
    case 'navigate': hideSuggest(); if (wc) { wc.loadURL(normalizeInput(arg)).catch(() => {}); wc.focus(); } break;
    case 'back': wc && wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(); break;
    case 'forward': wc && wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) (t.loading ? wc.stop() : wc.reload()); break;
    case 'new-tab': createTab(); break;
    case 'close-tab': closeTab(arg); break;
    case 'select-tab': activateTab(arg); break;
    case 'fire': fire(); break;
    case 'bookmark': toggleBookmark(); break;
    case 'menu': popupMenu(arg); break;
    case 'suggest': updateSuggest(String(arg.text || ''), { x: +arg.x || 0, w: +arg.w || 400 }); break;
    case 'suggest-hide': hideSuggest(); break;
    case 'suggest-move': {
      if (!suggest.shown || !suggest.items.length) break;
      const n = suggest.items.length;
      suggest.sel = ((suggest.sel + arg + 1 + n) % (n + 1)) - 1;
      suggestView.webContents.send('suggest-items', { items: suggest.items, sel: suggest.sel });
      win.webContents.send('fill', suggest.sel >= 0 ? suggest.items[suggest.sel].fill : suggest.text);
      break;
    }
    case 'suggest-choose': {
      const it = suggest.items[arg];
      hideSuggest();
      if (it && wc) { wc.loadURL(it.url).catch(() => {}); wc.focus(); }
      break;
    }
    case 'find':
      if (wc && arg.text) wc.findInText(arg.text, { forward: arg.forward !== false, findNext: !arg.fresh });
      else if (wc) { wc.stopFindInPage('clearSelection'); win.webContents.send('find-result', { active: 0, total: 0 }); }
      break;
    case 'find-close': findOpen = false; if (wc) wc.stopFindInPage('clearSelection'); layout(); pushState(); break;
  }
});

// ---------- IPC: internal pages ----------
ipcMain.on('insta:origin', e => { e.returnValue = ORIGIN; });
// Lets the page preload ask for the DuckDuckGo-browser UA (only ever used on duckduckgo.com pages).
ipcMain.on('insta:uaInfo', e => { e.returnValue = curUA.spoofed ? { ua: curUA.ua, platform: curUA.platform || '', vendor: curUA.vendor || '', hideCH: curUA.hideCH, chromeMajor: curUA.chromeMajor || 0, chPlatform: curUA.chPlatform || '', mobile: !!curUA.mobile } : null; });
ipcMain.on('insta:ddgHint', e => { e.returnValue = settings.general.ddgBrowserHint && !(DEV && process.env.INSTA_NO_HINT) ? DDG_UA : ''; });

const handlers = {
  getSettings: () => ({
    settings, theme,
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
    presets: presetList(), backgrounds: BACKGROUNDS, locations: LOCATIONS, uaPresets: UA_PRESETS.map(p => ({ id: p.id, name: p.name })), uaCurrent: curUA.ua, version: app.getVersion()
  }),
  setSetting: ({ key, value }) => {
    if (!applySetting(settings, key, value)) return false;
    if (key === 'location.preset') { const l = LOCATIONS.find(x => x.id === value); if (l) { settings.location.lat = l.lat; settings.location.lon = l.lon; settings.location.tz = l.tz; } }
    else if (key === 'location.lat' || key === 'location.lon') { settings.location.preset = 'custom'; try { settings.location.tz = tzlookup(settings.location.lat, settings.location.lon); } catch { /* keep tz */ } }
    else if (key === 'location.tz') settings.location.preset = 'custom';
    if (key.startsWith('userAgent.')) { applyUserAgent(); applyUAAll(); }
    if (key.startsWith('location.')) applyLocationAll();
    saveJSON('settings', settings);
    if (key.startsWith('appearance.preset') || key.startsWith('appearance.custom')) applyTheme();
    pushState();
    return true;
  },
  'location:pick': ({ lat, lon }) => {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    let tz = settings.location.tz;
    try { tz = tzlookup(lat, lon); } catch { /* keep current tz */ }
    Object.assign(settings.location, { preset: 'custom', lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, tz });
    saveJSON('settings', settings);
    applyLocationAll();
    return { lat: settings.location.lat, lon: settings.location.lon, tz };
  },
  removeSite: ({ list, site }) => {
    if (!['unprotectedSites', 'fireproofSites'].includes(list)) return false;
    const a = settings.privacy[list], i = a.indexOf(site);
    if (i >= 0) a.splice(i, 1);
    saveJSON('settings', settings); pushState(); return true;
  },
  'bookmarks:list': () => bookmarks,
  'bookmarks:remove': url => { bookmarks = bookmarks.filter(b => b.url !== url); saveJSON('bookmarks', bookmarks); pushState(); return true; },
  'bookmarks:favorite': url => { const b = bookmarks.find(x => x.url === url); if (b) { b.favorite = !b.favorite; saveJSON('bookmarks', bookmarks); } return !!b; },
  'bookmarks:import': () => importBookmarks(),
  'bookmarks:export': () => exportBookmarks(),
  'history:list': () => history.slice(0, 1000),
  'history:clear': () => { history = []; saveJSON('history', history); return true; },
  'history:remove': time => { history = history.filter(h => h.time !== time); saveJSON('history', history); return true; },
  'downloads:list': () => downloads,
  'downloads:show': id => { const d = downloads.find(x => x.id === id); if (d && d.path) shell.showItemInFolder(d.path); return true; },
  'downloads:clear': () => { downloads = downloads.filter(d => d.state === 'progressing'); return true; },
  fire: () => { fire(); return true; },
  go: (text, e) => { const t = tabByWcId(e.sender.id); if (t) t.view.webContents.loadURL(normalizeInput(text)).catch(() => {}); return true; },
  'player:meta': async id => {
    if (!/^[\w-]{11}$/.test(String(id))) return null;
    try {
      const r = await net.fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
      const j = await r.json();
      return { title: j.title, author: j.author_name };
    } catch { return null; }
  }
};

ipcMain.handle('insta:call', async (e, name, arg) => {
  const f = e.senderFrame;
  if (!f || f !== e.sender.mainFrame || !f.url.startsWith(ORIGIN + '/')) throw new Error('forbidden');
  const h = handlers[name];
  if (!h) throw new Error('unknown call');
  return h(arg, e);
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 600, minHeight: 400, title: 'InstaOlvidar Browser', icon: ICON,
    backgroundColor: theme.vars.bg,
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } } : { autoHideMenuBar: true }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  suggestView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'suggest-preload.js'), sandbox: true, contextIsolation: true } });
  suggestView.setBackgroundColor('#00000000');
  suggestView.webContents.loadFile(path.join(__dirname, 'ui', 'suggest.html'));
  suggestView.webContents.once('did-finish-load', () => suggestView.webContents.send('theme', theme));

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('blur', hideSuggest);
  win.on('closed', () => { win = null; tabs = []; });
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('theme', theme);
    const arg = process.argv.slice(app.isPackaged ? 1 : 2).find(a => /^(https?|insta):/i.test(a));
    createTab((DEV && process.env.INSTA_OPEN) || arg);
    if ((DEV && process.env.INSTA_SHOTS)) devShots((DEV && process.env.INSTA_SHOTS));
  });
}

// Developer hook: INSTA_SHOTS=<dir> saves screenshots of the chrome and active tab, then quits.
async function devShots(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  await wait(+(DEV && process.env.INSTA_WAIT) || 5000);
  fs.writeFileSync(path.join(dir, 'chrome.png'), (await win.webContents.capturePage()).toPNG());
  const t = activeTab();
  if (t && (DEV && process.env.INSTA_EVAL)) { try { console.log('EVAL', JSON.stringify(await t.view.webContents.executeJavaScript((DEV && process.env.INSTA_EVAL)))); } catch (e) { console.log('EVAL_ERR', String(e)); } }
  if (t) fs.writeFileSync(path.join(dir, 'tab.png'), (await t.view.webContents.capturePage()).toPNG());
  console.log('TABS', JSON.stringify(tabs.map(x => ({ title: x.title, url: x.url, blocked: x.blocked }))));
  quitting = true; firedOnExit = true; app.quit();
}

app.whenReady().then(async () => {
  const srv = await startServer(__dirname);
  ORIGIN = srv.origin; NEWTAB = ORIGIN + '/newtab.html';
  settings = loadSettings(loadJSON('settings', {}));
  if ((DEV && process.env.INSTA_SETTINGS)) { try { const o = JSON.parse((DEV && process.env.INSTA_SETTINGS)); for (const [sec, vals] of Object.entries(o)) Object.assign(settings[sec], vals); } catch { /* ignore */ } }
  bookmarks = loadJSON('bookmarks', []);
  history = loadJSON('history', []);
  if (isMac && app.dock) app.dock.setIcon(ICON);
  setupPrivacy();
  applyTheme();
  nativeTheme.on('updated', () => { if (settings.appearance.preset === 'auto') applyTheme(); });
  buildAppMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', e => {
  saveJSONNow('settings', settings); saveJSONNow('bookmarks', bookmarks); saveJSONNow('history', history);
  if (settings && settings.privacy.fireOnExit && !firedOnExit && !quitting) {
    e.preventDefault(); quitting = true;
    clearAllData().catch(() => {}).finally(() => { firedOnExit = true; app.quit(); });
  }
});
app.on('window-all-closed', () => app.quit());
