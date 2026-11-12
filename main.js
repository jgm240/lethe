const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog, clipboard, nativeTheme, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { isTracker, siteOf } = require('./trackers');
const { ENGINES, BACKGROUNDS, LOCATIONS, UA_PRESETS, SITE_RE, normalizeRule, load: loadSettings, applySetting } = require('./src/settings');
const { resolveUA } = require('./src/useragents');
const tzlookup = require('tz-lookup');
const { resolveTheme, presetList } = require('./src/themes');
const { loadJSON, saveJSON, saveJSONNow } = require('./src/store');
const { startServer } = require('./src/server');
const COOKIE_SCRIPT = require('./src/cookiepopups');
const PROMO = require('./src/promo');
const ZAP_SCRIPT = require('./src/zapper');
const { createEngine } = require('./src/filters');
const stats = require('./src/stats');

app.setName('Lethe');

const PARTITION = 'persist:lethe';
const TOPBAR = 82;
const FINDBAR = 40;
const isMac = process.platform === 'darwin';
const DEV = !app.isPackaged; // test hooks (LETHE_*) only exist in development runs
const REPO_URL = require('./package.json').homepage || '';
const ICON = path.join(__dirname, 'build', 'icon.png');

let ORIGIN = '';
let NEWTAB = '';
let settings, bookmarks, history, downloads = [], closedTabs = [];
let win = null, ses = null, tabs = [], activeId = null, nextId = 1, findOpen = false, quitting = false, firedOnExit = false;
let theme = null;
let BASE_UA = '';
let curUA = { ua: '', spoofed: false, hideCH: false };
let suggestView = null, ejectView = null, paletteView = null;
const palette = { shown: false, items: [] };
let ejectShown = false;
let filterEngine = createEngine();
let visits = {};          // site -> { t, hosts[] }   (site names only, never page URLs)
let zapped = {};          // host -> [css selectors]
let groups = [], nextGroupId = 1;
const readerDocs = new Map();
let nextReader = 1;
const GROUP_COLORS = ['#e8663d', '#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ec4899'];
const SIDEBAR_W = 232;
const VBAR = 44;          // toolbar height when tabs are vertical
const suggest = { items: [], sel: -1, shown: false, seq: 0, text: '' };
const httpAllow = new Set();
const pendingUpgrade = new Map();

// ---------- URLs ----------
const INTERNAL = { newtab: 'newtab.html', settings: 'settings.html', bookmarks: 'bookmarks.html', history: 'history.html', downloads: 'downloads.html', report: 'report.html', reader: 'reader.html' };
const isInternal = url => !!ORIGIN && url.startsWith(ORIGIN + '/');

function toReal(url) {
  const m = /^lethe:\/\/([a-z]+)(?:\/([\w-]{11}))?(\?.*)?$/i.exec(url);
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
    if (n === 'player') return `lethe://player/${u.searchParams.get('v') || ''}`;
    return `lethe://${n}${u.search}`;
  } catch { return ''; }
}
function searchUrl(q) { return ENGINES[settings.general.searchEngine].url + encodeURIComponent(q); }

function normalizeInput(text) {
  const t = String(text || '').trim();
  if (!t) return NEWTAB;
  if (/^lethe:/i.test(t)) return toReal(t);
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

// YouTube -> Lethe Player
function youtubeTarget(u) {
  const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = null;
  if (h === 'youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/shorts\/([\w-]{11})/.exec(u.pathname); if (m) id = m[1]; }
  } else if (h === 'youtu.be') { const m = /^\/([\w-]{11})/.exec(u.pathname); if (m) id = m[1]; }
  if (!id || !/^[\w-]{11}$/.test(id) || u.searchParams.has('lethe_np')) return null;
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
function contentPolicy(site) {
  const c = settings.content, r = (site && settings.siteRules[site]) || {}, parts = [];
  const pick = k => (typeof r[k] === 'boolean' ? r[k] : c[k]);
  if (pick('noJs')) parts.push("script-src 'none'");
  if (pick('noCss')) parts.push("style-src 'none'");
  if (pick('noImages')) parts.push("img-src 'none'");
  return parts.join('; ');
}
// The place to fake for a given host (per-site rule first, then the global setting), or null for "real location".
function locationFor(host) {
  const r = settings.siteRules[siteOf(host || '')];
  if (r && r.location) {
    if (r.location === 'off') return null;
    const l = LOCATIONS.find(x => x.id === r.location);
    return l ? { lat: l.lat, lon: l.lon, tz: l.tz } : null;
  }
  return settings.location.spoof ? { lat: settings.location.lat, lon: settings.location.lon, tz: settings.location.tz } : null;
}
const infoOf = c => ({ ua: c.ua, platform: c.platform || '', vendor: c.vendor || '', hideCH: !!c.hideCH, chromeMajor: c.chromeMajor || 0, chPlatform: c.chPlatform || '', mobile: !!c.mobile });
function defaultIdentity() {
  return {
    ua: BASE_UA, platform: process.platform === 'darwin' ? 'MacIntel' : process.platform === 'win32' ? 'Win32' : 'Linux x86_64', vendor: 'Google Inc.', hideCH: false,
    chromeMajor: +String(process.versions.chrome).split('.')[0], chPlatform: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux', mobile: false
  };
}
// Identity for a host: a per-site rule wins over the global user-agent setting.
function effectiveUA(host) {
  const r = settings.siteRules[siteOf(host || '')];
  if (r && r.userAgent) return Object.assign(resolveUA({ userAgent: { preset: r.userAgent, custom: '' } }, BASE_UA), { site: true });
  return curUA;
}
function uaInfoFor(host) {
  const eff = effectiveUA(host);
  if (!eff.site) return curUA.spoofed ? infoOf(curUA) : null;
  return infoOf(eff.spoofed ? eff : defaultIdentity());
}
async function applyLocation(tab, host) {
  const wc = tab.view.webContents, loc = locationFor(host !== undefined ? host : hostOf(tab.url));
  tab.locKey = loc ? `${loc.lat},${loc.lon},${loc.tz}` : '';
  try {
    if (!loc && !wc.debugger.isAttached()) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    if (loc) {
      await wc.debugger.sendCommand('Emulation.setGeolocationOverride', { latitude: loc.lat, longitude: loc.lon, accuracy: 25 });
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: loc.tz });
    } else {
      await wc.debugger.sendCommand('Emulation.clearGeolocationOverride');
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: '' });
    }
  } catch { /* tab may be closing */ }
}
const applyLocationAll = () => tabs.forEach(t => applyLocation(t));
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
    if (paletteView) paletteView.webContents.send('theme', theme);
    for (const t of tabs) if (isInternal(t.url)) t.view.webContents.send('lethe:theme', theme);
  }
}

// ---------- layout / state ----------
const isVertical = () => settings.tabs.layout === 'vertical';
const chromeTop = () => (isVertical() ? VBAR : TOPBAR) + (findOpen ? FINDBAR : 0);
function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const top = chromeTop(), left = isVertical() ? SIDEBAR_W : 0;
  const t = activeTab();
  if (t) t.view.setBounds({ x: left, y: top, width: Math.max(0, w - left), height: Math.max(0, h - top) });
  for (const v of [ejectView, paletteView]) if (v) v.setBounds({ x: 0, y: 0, width: w, height: h });
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const t = activeTab();
  const wc = t && t.view.webContents;
  const url = t ? displayUrl(t) : '';
  const real = t ? t.url : '';
  win.webContents.send('state', {
    tabs: tabs.map(x => ({ id: x.id, title: x.title, favicon: x.favicon, loading: x.loading, pinned: !!x.pinned, group: x.group })),
    groups: groups.map(g => ({ id: g.id, name: g.name, color: g.color, collapsed: !!g.collapsed })),
    layout: settings.tabs.layout,
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
  suggestView.setBounds({ x: Math.round(rect.x), y: isVertical() ? 40 : 78, width: Math.round(rect.w), height: h });
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
    if (document.getElementById('lethe-yt-banner')) return;
    const host = document.createElement('div'); host.id = 'lethe-yt-banner';
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
  const tab = { id: nextId++, view, title: 'New Tab', url, favicon: null, loading: false, blocked: 0, blockedHosts: {}, stripped: 0, popups: 0, pinned: false, group: null, sites: new Set(), curSite: '', locKey: '' };
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
    const prevSite = tab.curSite, nowSite = /^https?:/.test(u) && !isInternal(u) ? siteOf(hostOf(u)) : '';
    tab.curSite = nowSite;
    if (nowSite) noteVisit(tab, u);
    if (prevSite && prevSite !== nowSite) maybeForgetClosedSites([prevSite]);
    if (isInternal(u)) { tab.title = tab.title === 'New Tab' || !tab.title ? ({ newtab: 'New Tab', settings: 'Settings', bookmarks: 'Bookmarks', history: 'History', downloads: 'Downloads', player: 'Lethe Player', report: 'Privacy Report', reader: 'Reader' }[toDisplay(u).replace('lethe://', '').split(/[/?]/)[0]] || 'Lethe') : tab.title; wc.send('lethe:theme', theme); }
    pushState();
  });
  wc.on('did-navigate-in-page', (_e, u, isMain) => { if (isMain) { tab.url = u; pushState(); maybeBanner(wc, u); } });
  wc.on('dom-ready', () => {
    const u = wc.getURL();
    if (isInternal(u)) { wc.send('lethe:theme', theme); return; }
    applyCosmetics(wc, u);
    if (settings.content.noJs) return;
    if (settings.general.hideSearchPromos && !(DEV && process.env.LETHE_NO_HIDE) && /^https:\/\/([\w-]+\.)?duckduckgo\.com\//.test(u)) {
      wc.insertCSS(PROMO.CSS).catch(() => {});
      wc.executeJavaScript(PROMO.JS).catch(() => {});
    }
    if (settings.privacy.cookiePopups && /^https?:/.test(u) && isProtected(hostOf(u))) {
      wc.executeJavaScript(COOKIE_SCRIPT).then(n => { if (n > 0 && tabs.includes(tab)) { tab.popups += n; stats.add('popups', n); pushState(); } }).catch(() => {});
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
  const g = next.group != null && groups.find(x => x.id === next.group);
  if (g && g.collapsed) g.collapsed = false;
  win.contentView.addChildView(next.view);
  raiseOverlays();
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
  groups = groups.filter(g => tabs.some(t => t.group === g.id));
  maybeForgetClosedSites([...tab.sites]);
  if (!tabs.length) { createTab(); return; }
  if (id === activeId) activateTab(tabs[Math.min(i, tabs.length - 1)].id); else pushState();
}
// ---- pinned tabs, groups, ordering ----
function orderTabs() {
  const pinned = tabs.filter(t => t.pinned), rest = tabs.filter(t => !t.pinned), out = [], seen = new Set();
  for (const t of rest) {
    if (t.group == null) out.push(t);
    else if (!seen.has(t.group)) { seen.add(t.group); out.push(...rest.filter(x => x.group === t.group)); }
  }
  tabs = [...pinned, ...out];
}
function tidyGroups() { groups = groups.filter(g => tabs.some(t => t.group === g.id)); }
function pinTab(id, v) { const t = tabs.find(x => x.id === id); if (!t) return; t.pinned = v; if (v) t.group = null; orderTabs(); tidyGroups(); pushState(); }
function newGroupWith(id) {
  const t = tabs.find(x => x.id === id); if (!t) return;
  const g = { id: nextGroupId++, name: 'Group ' + (nextGroupId - 1), color: GROUP_COLORS[groups.length % GROUP_COLORS.length], collapsed: false };
  groups.push(g); t.group = g.id; t.pinned = false; orderTabs(); pushState();
}
function setGroup(id, gid) { const t = tabs.find(x => x.id === id); if (!t) return; t.group = gid; if (gid != null) t.pinned = false; orderTabs(); tidyGroups(); pushState(); }
function moveTab(id, beforeId) {
  const t = tabs.find(x => x.id === id); if (!t || id === beforeId) return;
  const b = tabs.find(x => x.id === beforeId);
  if (b && b.pinned !== t.pinned) return;
  tabs = tabs.filter(x => x !== t);
  if (b) { t.group = b.group; tabs.splice(tabs.indexOf(b), 0, t); } else { t.group = null; tabs.push(t); }
  orderTabs(); tidyGroups(); pushState();
}
function tabMenu(id) {
  const t = tabs.find(x => x.id === id); if (!t) return;
  const items = [
    { label: t.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => pinTab(id, !t.pinned) },
    { label: 'Add to New Group', click: () => newGroupWith(id) },
    ...(groups.length ? [{ label: 'Add to Group', submenu: groups.map(g => ({ label: g.name, type: 'checkbox', checked: t.group === g.id, click: () => setGroup(id, g.id) })) }] : []),
    ...(t.group != null ? [{ label: 'Remove from Group', click: () => setGroup(id, null) }] : []),
    { type: 'separator' },
    { label: 'Duplicate Tab', click: () => createTab(t.url, true) },
    { label: 'Close Tab', click: () => closeTab(id) },
    { label: 'Close Other Tabs', enabled: tabs.length > 1, click: () => tabs.filter(x => x.id !== id && !x.pinned).forEach(x => closeTab(x.id)) }
  ];
  Menu.buildFromTemplate(items).popup({ window: win });
}
function groupMenu(gid) {
  const g = groups.find(x => x.id === gid); if (!g) return;
  Menu.buildFromTemplate([
    { label: g.collapsed ? 'Expand Group' : 'Collapse Group', click: () => { g.collapsed = !g.collapsed; pushState(); } },
    { label: 'Color', submenu: GROUP_COLORS.map((c, i) => ({ label: ['Orange', 'Blue', 'Green', 'Purple', 'Yellow', 'Pink'][i], type: 'radio', checked: g.color === c, click: () => { g.color = c; pushState(); } })) },
    { label: 'Ungroup', click: () => { tabs.forEach(t => { if (t.group === gid) t.group = null; }); tidyGroups(); pushState(); } },
    { label: 'Close Group', click: () => tabs.filter(t => t.group === gid).forEach(t => closeTab(t.id)) }
  ]).popup({ window: win });
}
function setLayout(v) { applySetting(settings, 'tabs.layout', v); saveJSON('settings', settings); layout(); pushState(); }

function reopenTab() { const c = closedTabs.pop(); if (c) createTab(c.url, true); }
function cycleTab(dir) { const i = tabs.findIndex(t => t.id === activeId); activateTab(tabs[(i + dir + tabs.length) % tabs.length].id); }
function openInternal(name) {
  const url = toReal(`lethe://${name}`);
  const existing = tabs.find(t => t.url === url || t.url.startsWith(url + '?'));
  if (existing) activateTab(existing.id); else createTab(url, true);
}

// ---------- forgetting: Eject to Lethe, forget ranges, per-site and timed forgetting ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fireproof = site => settings.privacy.fireproofSites.includes(site);
const currentSite = () => { const t = activeTab(); return t && /^https?:/.test(t.url) && !isInternal(t.url) ? siteOf(hostOf(t.url)) : ''; };
function toast(text) { if (win && !win.isDestroyed()) win.webContents.send('toast', text); }

// Remember *which sites* were visited (never URLs or titles) so they can be forgotten later by range, timer or rule.
function noteVisit(tab, url) {
  if (!/^https?:/.test(url) || isInternal(url)) return;
  const host = hostOf(url), site = siteOf(host);
  const v = visits[site] || (visits[site] = { t: 0, hosts: [] });
  v.t = Date.now();
  if (!v.hosts.includes(host)) { v.hosts.push(host); if (v.hosts.length > 20) v.hosts.shift(); }
  tab.sites.add(site);
  persistVisits();
}
function persistVisits() { if (settings.privacy.saveHistory || settings.forget.afterHours > 0) saveJSON('visits', visits); }

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
  history = []; downloads = []; closedTabs = []; visits = {}; httpAllow.clear();
  saveJSONNow('history', history); saveJSONNow('visits', visits);
}

// Erase everything a site stored (cookies, local storage, caches) plus its history entries.
async function forgetSite(site, { respectFireproof = false } = {}) {
  if (!site || (respectFireproof && fireproof(site))) return false;
  const hosts = new Set([site, 'www.' + site, ...((visits[site] || {}).hosts || [])]);
  const cookies = await ses.cookies.get({});
  for (const c of cookies) {
    const dom = (c.domain || '').replace(/^\./, '');
    if (siteOf(dom) === site) {
      hosts.add(dom);
      try { await ses.cookies.remove((c.secure ? 'https://' : 'http://') + dom + (c.path || '/'), c.name); } catch { /* ignore */ }
    }
  }
  for (const h of hosts) for (const proto of ['https://', 'http://']) { try { await ses.clearStorageData({ origin: proto + h }); } catch { /* ignore */ } }
  history = history.filter(x => siteOf(hostOf(x.url)) !== site);
  delete visits[site];
  saveJSON('history', history); persistVisits();
  return true;
}

// Forget every site visited in the last `ms` milliseconds (and the history / downloads from that window).
async function forgetSince(ms) {
  const cutoff = Date.now() - ms;
  const sites = Object.entries(visits).filter(([, v]) => v.t >= cutoff).map(([k]) => k);
  let n = 0;
  for (const site of sites) if (await forgetSite(site, { respectFireproof: true })) n++;
  history = history.filter(h => h.time < cutoff); downloads = downloads.filter(d => d.time < cutoff);
  saveJSON('history', history);
  for (const t of tabs) {
    if (sites.includes(siteOf(hostOf(t.url))) && !fireproof(siteOf(hostOf(t.url))) && !isInternal(t.url)) t.view.webContents.loadURL(NEWTAB).catch(() => {});
  }
  return n;
}

// Timed forgetting: sites untouched for N hours are forgotten (never ones that are open, or fireproof).
async function forgetStale() {
  const hrs = settings.forget.afterHours;
  if (!hrs) return 0;
  const cutoff = Date.now() - hrs * 3600e3, open = new Set(tabs.map(t => siteOf(hostOf(t.url)))); let n = 0;
  for (const [site, v] of Object.entries(visits)) if (v.t < cutoff && !open.has(site) && !fireproof(site) && await forgetSite(site)) n++;
  return n;
}
// "Forget when the tab closes" rule.
function maybeForgetClosedSites(sites) {
  for (const site of sites) {
    if (settings.forget.onCloseSites.includes(site) && !tabs.some(t => siteOf(hostOf(t.url)) === site)) forgetSite(site).catch(() => {});
  }
}

async function eject(scope = 'all') {
  const site = currentSite();
  if (scope === 'site' && !site) return toast('Open a website first');
  const fp = settings.privacy.fireproofSites.length;
  const copy = {
    all: ['Eject to Lethe?', 'Throws every tab, your history, cookies, site data, cache and downloads list into the river. Bookmarks and settings are kept.' + (fp ? `\n${fp} fireproof site${fp === 1 ? '' : 's'} will stay signed in.` : '')],
    hour: ['Forget the last hour?', 'Erases cookies, site data and history for every site you visited in the last hour (fireproof sites keep their sign-ins). Sites you also visited earlier are forgotten completely.'],
    day: ['Forget the last day?', 'Erases cookies, site data and history for every site you visited in the last 24 hours (fireproof sites keep their sign-ins). Sites you also visited earlier are forgotten completely.'],
    site: [`Forget ${site}?`, `Erases ${site}'s cookies, site data and history entries. You'll be signed out of it.`]
  }[scope];
  if (settings.eject.confirm && !(DEV && process.env.LETHE_AUTOCONFIRM)) {
    const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: [scope === 'all' ? 'Eject to Lethe' : 'Forget', 'Cancel'], defaultId: 0, cancelId: 1, message: copy[0], detail: copy[1] });
    if (response !== 0) return;
  }
  hideSuggest(); closePalette();
  if (scope === 'all') {
    const started = Date.now(), animate = settings.eject.animation;
    if (animate) showEject();
    const old = tabs.slice();
    tabs = []; groups = []; activeId = null;
    for (const t of old) { try { win.contentView.removeChildView(t.view); } catch { /* ignore */ } t.view.webContents.close(); }
    await clearAllData();
    stats.add('ejects');
    createTab();
    if (animate) { const left = 2400 - (Date.now() - started); if (left > 0) await sleep(left); hideEject(); }
    return;
  }
  let msg;
  if (scope === 'site') {
    await forgetSite(site);
    const t = activeTab(); if (t) t.view.webContents.loadURL(NEWTAB).catch(() => {});
    msg = `Forgot ${site}`;
  } else {
    const n = await forgetSince(scope === 'hour' ? 3600e3 : 86400e3);
    msg = `Forgot ${n} site${n === 1 ? '' : 's'} from the last ${scope}`;
  }
  pushState(); toast(msg);
}
const fire = () => eject('all');

function showEject() {
  if (!ejectView) return;
  const [w, h] = win.getContentSize();
  ejectView.setBounds({ x: 0, y: 0, width: w, height: h });
  win.contentView.addChildView(ejectView);
  ejectShown = true;
  ejectView.webContents.executeJavaScript('window.__start && window.__start()').catch(() => {});
}
function hideEject() { ejectShown = false; if (ejectView && win && !win.isDestroyed()) { try { win.contentView.removeChildView(ejectView); } catch { /* ignore */ } } }
// A view added later sits on top, so re-raise any open overlay after a tab is added (the Eject animation stays above new tabs).
function raiseOverlays() {
  if (!win || win.isDestroyed()) return;
  if (suggest.shown && suggestView) win.contentView.addChildView(suggestView);
  if (palette.shown && paletteView) win.contentView.addChildView(paletteView);
  if (ejectShown && ejectView) win.contentView.addChildView(ejectView);
}
function closePalette() { if (palette.shown && paletteView && win && !win.isDestroyed()) { try { win.contentView.removeChildView(paletteView); } catch { /* ignore */ } } palette.shown = false; }

// ---------- filter lists + element zapper ----------
const filtersDir = () => path.join(app.getPath('userData'), 'filters');
function loadFilterLists() {
  const e = createEngine();
  for (const l of settings.filters.lists) if (l.enabled) { try { e.addText(fs.readFileSync(path.join(filtersDir(), l.id + '.txt'), 'utf8')); } catch { /* list file missing */ } }
  filterEngine = e;
}
async function fetchFilterList(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https:// lists are allowed');
  const r = await net.fetch(url);
  if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + ')');
  const text = await r.text();
  if (text.length > 30 * 1048576) throw new Error('That list is too large');
  return text;
}
async function addFilterList(url, name) {
  const text = await fetchFilterList(url), u = new URL(url), id = 'l' + Date.now().toString(36);
  fs.mkdirSync(filtersDir(), { recursive: true });
  fs.writeFileSync(path.join(filtersDir(), id + '.txt'), text);
  const probe = createEngine(); probe.addText(text);
  settings.filters.lists.push({ id, name: String(name || u.hostname + u.pathname).slice(0, 60), url, enabled: true, updated: Date.now(), count: probe.size });
  saveJSON('settings', settings); loadFilterLists();
}
async function updateFilterLists(onlyStale = false) {
  let n = 0;
  for (const l of settings.filters.lists) {
    if (!l.enabled || (onlyStale && Date.now() - l.updated < 7 * 86400e3)) continue;
    try {
      const text = await fetchFilterList(l.url); fs.writeFileSync(path.join(filtersDir(), l.id + '.txt'), text);
      const probe = createEngine(); probe.addText(text); l.count = probe.size; l.updated = Date.now(); n++;
    } catch { /* keep the old copy */ }
  }
  if (n) { saveJSON('settings', settings); loadFilterLists(); }
  return n;
}
const zapCss = host => {
  const sels = [];
  for (const [k, v] of Object.entries(zapped)) if (host === k || host.endsWith('.' + k)) sels.push(...v);
  return sels.length ? sels.join(',\n') + ' { display: none !important; }' : '';
};
function applyCosmetics(wc, url) {
  const host = hostOf(url); let css = '';
  if (settings.privacy.trackerBlocking && filterEngine.size && isProtected(host)) css += filterEngine.cosmeticCss(host);
  css += zapCss(host);
  if (css) wc.insertCSS(css).catch(() => {});
}
async function zapElement() {
  const t = activeTab();
  if (!t || isInternal(t.url) || !/^https?:/.test(t.url)) return toast('Open a website to zap an element');
  t.view.webContents.focus();
  try {
    const sel = await t.view.webContents.executeJavaScript(ZAP_SCRIPT);
    if (!sel) return;
    const host = hostOf(t.url), list = zapped[host] || (zapped[host] = []);
    if (!list.includes(sel)) list.push(sel);
    if (list.length > 50) list.shift();
    saveJSON('zapped', zapped);
    t.view.webContents.insertCSS(`${sel} { display: none !important; }`).catch(() => {});
    toast('Element hidden. You can undo it in Settings → Filters.');
  } catch { toast('Couldn’t zap an element on this page'); }
}

// ---------- reader mode ----------
let READER_SRC = '';
async function openReader() {
  const t = activeTab();
  if (!t || isInternal(t.url) || !/^https?:/.test(t.url)) return toast('Reader mode works on regular web pages');
  try {
    if (!READER_SRC) READER_SRC = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
    const art = await t.view.webContents.executeJavaScript(`(() => { var module = { exports: {} }; ${READER_SRC}
      var R = module.exports; var a = new R(document.cloneNode(true)).parse();
      return a ? { title: a.title, byline: a.byline, siteName: a.siteName, content: a.content, excerpt: a.excerpt, lang: a.lang } : null; })()`);
    if (!art || !art.content) return toast('Couldn’t find an article on this page');
    const id = nextReader++;
    readerDocs.set(id, { ...art, url: t.url, host: hostOf(t.url) });
    if (readerDocs.size > 20) readerDocs.delete(readerDocs.keys().next().value);
    t.view.webContents.loadURL(toReal(`lethe://reader?id=${id}`)).catch(() => {});
  } catch { toast('Couldn’t open reader mode on this page'); }
}

// ---------- privacy engine ----------
function setupPrivacy() {
  ses = session.fromPartition(PARTITION);
  BASE_UA = ses.getUserAgent().replace(/\s(Electron|lethe|Lethe[^/]*)\/\S+/gi, '');
  applyUserAgent();

  const handleBefore = (d, cb) => {
    let u;
    try { u = new URL(d.url); } catch { return cb({}); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return cb({});
    if (u.origin === ORIGIN) return cb({});
    const tab = tabByWcId(d.webContentsId);
    const main = d.resourceType === 'mainFrame';
    const pageHost = tab ? hostOf(tab.url) : '';
    const prot = isProtected(main ? u.hostname : pageHost);

    if (main) {
      // Lethe Player
      if (settings.player.mode === 'always') { const yt = youtubeTarget(u); if (yt) return cb({ redirectURL: yt.url }); }
      // Link tracking protection
      if (settings.privacy.stripTrackingParams && prot) {
        let changed = false;
        for (const k of [...u.searchParams.keys()]) if (TRACK_PARAM.test(k)) { u.searchParams.delete(k); changed = true; }
        if (changed) { if (tab) tab.stripped++; stats.add('params'); return cb({ redirectURL: u.toString() }); }
      }
    }
    // Smarter encryption
    if (settings.privacy.httpsUpgrade && prot && u.protocol === 'http:' && !isLocal(u.hostname) && !httpAllow.has(u.hostname)) {
      if (main) pendingUpgrade.set(u.hostname, d.url);
      stats.add('upgrades');
      return cb({ redirectURL: d.url.replace(/^http:/, 'https:') });
    }
    // Tracker blocking: built-in list + any filter lists the user added
    if (settings.privacy.trackerBlocking && tab && !main && prot) {
      const third = siteOf(u.hostname) !== siteOf(pageHost);
      if ((third && isTracker(u.hostname)) || (filterEngine.size && filterEngine.match(d.url, pageHost, d.resourceType))) {
        const th = siteOf(u.hostname);
        tab.blocked++; tab.blockedHosts[th] = (tab.blockedHosts[th] || 0) + 1; stats.add('blocked', 1, th);
        if (tab.id === activeId) pushState();
        return cb({ cancel: true });
      }
    }
    cb({});
  };
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => {
    // A per-site location rule must be in place *before* the page loads (geolocation + time zone).
    if (d.resourceType === 'mainFrame' && !d.url.startsWith(ORIGIN)) {
      const tab = tabByWcId(d.webContentsId), h = hostOf(d.url);
      if (tab && h) {
        const loc = locationFor(h), key = loc ? `${loc.lat},${loc.lon},${loc.tz}` : '';
        if ((tab.locKey || '') !== key) { applyLocation(tab, h).finally(() => handleBefore(d, cb)); return; }
      }
    }
    handleBefore(d, cb);
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (d, cb) => {
    const h = d.requestHeaders, tabR = tabByWcId(d.webContentsId);
    const uaHost = d.resourceType === 'mainFrame' || !tabR ? hostOf(d.url) : hostOf(tabR.url);
    const eff = effectiveUA(uaHost), stripCH = () => { for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('sec-ch-ua')) delete h[k]; };
    if (eff.site) { h['User-Agent'] = eff.ua; stripCH(); }                  // per-site identity
    else if (curUA.hideCH) stripCH();                                        // Firefox/Safari don't send Chromium client hints
    else if (curUA.spoofed && curUA.chPlatform) {
      for (const k of Object.keys(h)) {                                      // keep Chromium client hints consistent with the chosen UA
        const l = k.toLowerCase();
        if (l === 'sec-ch-ua-platform') h[k] = `"${curUA.chPlatform}"`;
        else if (l === 'sec-ch-ua-mobile') h[k] = curUA.mobile ? '?1' : '?0';
      }
    }
    if (d.url.startsWith('https://tile.openstreetmap.org/')) h['User-Agent'] = `Lethe/${app.getVersion()}` + (REPO_URL ? ` (+${REPO_URL})` : ''); // OSM tile policy: identify the app
    if (settings.privacy.gpc && !d.url.startsWith(ORIGIN)) { h['Sec-GPC'] = '1'; h['DNT'] = '1'; }
    if (settings.general.ddgBrowserHint && !(DEV && process.env.LETHE_NO_HINT)) { try { if (isDdgHost(new URL(d.url).hostname)) h['User-Agent'] = DDG_UA; } catch { /* ignore */ } }
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
    const policy = contentPolicy(siteOf(d.resourceType === 'mainFrame' || !tab ? hostOf(d.url) : hostOf(tab.url)));
    if (policy && d.responseHeaders && d.url.startsWith('http') && !d.url.startsWith(ORIGIN + '/')
        && (d.resourceType === 'mainFrame' || (d.resourceType === 'subFrame' && tab && !isInternal(tab.url)))) {
      const key = Object.keys(d.responseHeaders).find(k => k.toLowerCase() === 'content-security-policy');
      d.responseHeaders[key || 'Content-Security-Policy'] = [...(key ? d.responseHeaders[key] : []), policy];
    }
    if (settings.privacy.thirdPartyCookies && tab && d.resourceType !== 'mainFrame' && d.responseHeaders) {
      try {
        if (siteOf(hostOf(tab.url)) !== siteOf(new URL(d.url).hostname)) {
          for (const k of Object.keys(d.responseHeaders)) if (k.toLowerCase() === 'set-cookie') { delete d.responseHeaders[k]; stats.add('cookies'); }
        }
      } catch { /* ignore */ }
    }
    cb({ responseHeaders: d.responseHeaders });
  });

  const allowed = ['fullscreen', 'clipboard-sanitized-write'];
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.includes(perm) || (perm === 'geolocation' && !!locationFor(hostOf((details && details.requestingUrl) || wc.getURL())))));
  ses.setPermissionCheckHandler((_wc, perm, origin) => allowed.includes(perm) || (perm === 'geolocation' && !!locationFor(hostOf(origin || ''))));

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
      { label: internal ? 'Lethe page' : t.url.startsWith('https:') ? 'Connection is encrypted (HTTPS)' : 'Connection is not encrypted', enabled: false },
      { label: `${t.blocked} tracker request${t.blocked === 1 ? '' : 's'} blocked`, enabled: false },
      ...hosts.map(([h, n]) => ({ label: `    ${h} — ${n}`, enabled: false })),
      ...(t.stripped ? [{ label: `${t.stripped} tracking parameter redirect${t.stripped === 1 ? '' : 's'} cleaned`, enabled: false }] : []),
      ...(t.popups ? [{ label: `${t.popups} cookie pop-up${t.popups === 1 ? '' : 's'} handled`, enabled: false }] : []),
      ...(contentPolicy(site) ? [{ label: 'Blocking on this page: ' + contentPolicy(site).split('; ').map(p => ({ 'script-src': 'JavaScript', 'style-src': 'CSS', 'img-src': 'images' }[p.split(' ')[0]])).join(', '), enabled: false }] : []),
      ...(!internal && locationFor(host) ? [{ label: `Location spoofed: ${(settings.siteRules[site] && settings.siteRules[site].location && settings.siteRules[site].location !== 'off') ? (LOCATIONS.find(l => l.id === settings.siteRules[site].location) || {}).name : locationName()}`, enabled: false }] : []),
      ...(!internal && settings.siteRules[site] ? [{ label: `This site has custom rules`, enabled: false }] : []),
      { type: 'separator' },
      ...(internal ? [] : [
        { label: `Protections on for ${site}`, type: 'checkbox', checked: isProtected(host), click: () => { toggleList('unprotectedSites', site); t.view.webContents.reload(); } },
        { label: `Fireproof ${site}`, type: 'checkbox', checked: settings.privacy.fireproofSites.includes(site), click: () => toggleList('fireproofSites', site) },
        { label: `Forget ${site} when its tab closes`, type: 'checkbox', checked: settings.forget.onCloseSites.includes(site), click: () => { const a = settings.forget.onCloseSites, i = a.indexOf(site); if (i >= 0) a.splice(i, 1); else a.push(site); saveJSON('settings', settings); } },
        { label: `Forget ${site} now`, click: () => eject('site') },
        { label: `Site rules for ${site}…`, click: () => openInternal('settings?site=' + encodeURIComponent(site)) },
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
      { label: 'Privacy Report', click: () => openInternal('report') },
      { type: 'separator' },
      { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: openPalette },
      { label: 'Reader Mode', accelerator: 'CmdOrCtrl+Shift+R', click: openReader },
      { label: 'Zap Element…', accelerator: 'CmdOrCtrl+Shift+X', click: zapElement },
      { label: 'Vertical Tabs', type: 'checkbox', checked: isVertical(), click: () => setLayout(isVertical() ? 'horizontal' : 'vertical') },
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
      { label: 'Eject to Lethe…', click: () => eject('all') },
      { type: 'separator' },
      { label: 'About Lethe', click: () => dialog.showMessageBox(win, { message: 'Lethe', detail: `Version ${app.getVersion()}\nΛήθη — forget instantly.\nPrivate by default. Search powered by DuckDuckGo.` }) }
    ];
  }
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function buildAppMenu() {
  const nav = () => activeTab().view.webContents;
  const tpl = [
    ...(isMac ? [{ label: 'Lethe', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => openInternal('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeId) },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: reopenTab },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: () => { win.webContents.focus(); win.webContents.send('focus-address'); } },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => nav().print() },
        { label: 'Eject to Lethe…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: () => eject('all') },
        ...(isMac ? [] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: () => openInternal('settings') }, { role: 'quit' }])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => nav().reload() },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: openFind },
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+K', click: openPalette },
        { label: 'Reader Mode', accelerator: 'CmdOrCtrl+Shift+R', click: openReader },
        { label: 'Zap Element…', accelerator: 'CmdOrCtrl+Shift+X', click: zapElement },
        { label: 'Vertical Tabs', type: 'checkbox', checked: isVertical(), click: () => setLayout(isVertical() ? 'horizontal' : 'vertical') },
        { type: 'separator' },
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
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => openInternal('downloads') },
        { label: 'Privacy Report', click: () => openInternal('report') }
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
        { label: 'Pin / Unpin Tab', click: () => { const t = activeTab(); if (t) pinTab(t.id, !t.pinned); } },
        ...Array.from({ length: 8 }, (_, i) => ({ label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => tabs[i] && activateTab(tabs[i].id) }))
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- Eject menu + command palette ----------
function ejectMenu() {
  hideSuggest();
  const site = currentSite();
  Menu.buildFromTemplate([
    { label: 'Eject to Lethe…  (close all tabs, erase everything)', accelerator: 'CmdOrCtrl+Shift+Backspace', click: () => eject('all') },
    { type: 'separator' },
    { label: 'Forget the last hour', click: () => eject('hour') },
    { label: 'Forget the last day', click: () => eject('day') },
    { label: site ? `Forget ${site} only` : 'Forget this site only', enabled: !!site, click: () => eject('site') },
    { type: 'separator' },
    { label: 'Eject settings…', click: () => openInternal('settings') }
  ]).popup({ window: win });
}

function toggleSetting(key) {
  applySetting(settings, key, !getSetting(key)); saveJSON('settings', settings);
  if (key === 'location.spoof') applyLocationAll();
  const t = activeTab(); if (t && !isInternal(t.url)) t.view.webContents.reload();
  pushState();
}
function buildPaletteItems() {
  const t = activeTab(), items = []; let n = 0;
  const on = k => (getSetting(k) ? 'on' : 'off');
  const act = (label, hint, run, sub = '') => items.push({ id: 'a' + n++, kind: 'action', label, sub, hint, run });
  act('New Tab', 'Cmd/Ctrl+T', () => createTab());
  act('Reopen Closed Tab', 'Cmd/Ctrl+Shift+T', reopenTab);
  act('Settings', 'Cmd/Ctrl+,', () => openInternal('settings'));
  act('History', '', () => openInternal('history'));
  act('Bookmarks', '', () => openInternal('bookmarks'));
  act('Downloads', '', () => openInternal('downloads'));
  act('Privacy Report', 'last 7 days', () => openInternal('report'));
  act('Eject to Lethe…', 'erase everything', () => eject('all'));
  act('Forget the last hour', '', () => eject('hour'));
  act('Forget the last day', '', () => eject('day'));
  if (currentSite()) act(`Forget ${currentSite()} only`, '', () => eject('site'));
  if (t && !isInternal(t.url)) {
    act('Reader Mode', 'Cmd/Ctrl+Shift+R', openReader);
    act('Zap Element…', 'hide something on this page', zapElement);
    act('Bookmark This Page', 'Cmd/Ctrl+D', toggleBookmark);
    if (currentSite()) act(`Site rules for ${currentSite()}…`, '', () => openInternal('settings?site=' + encodeURIComponent(currentSite())));
  }
  act(`Vertical tabs: switch to ${isVertical() ? 'horizontal' : 'vertical'}`, '', () => setLayout(isVertical() ? 'horizontal' : 'vertical'));
  if (t) act(t.pinned ? 'Unpin this tab' : 'Pin this tab', '', () => pinTab(t.id, !t.pinned));
  act(`No JavaScript (${on('content.noJs')}) — toggle`, '', () => toggleSetting('content.noJs'));
  act(`No CSS (${on('content.noCss')}) — toggle`, '', () => toggleSetting('content.noCss'));
  act(`No images (${on('content.noImages')}) — toggle`, '', () => toggleSetting('content.noImages'));
  act(`Spoof location (${on('location.spoof')}) — toggle`, '', () => toggleSetting('location.spoof'));
  act('Find in Page', 'Cmd/Ctrl+F', openFind);
  for (const x of tabs) items.push({ id: 't' + x.id, kind: 'tab', label: x.title || displayUrl(x) || 'New Tab', sub: displayUrl(x), run: () => activateTab(x.id) });
  bookmarks.slice(0, 80).forEach((b, i) => items.push({ id: 'b' + i, kind: 'bookmark', label: b.title || b.url, sub: b.url, run: () => createTab(b.url, true) }));
  history.slice(0, 120).forEach((h, i) => items.push({ id: 'h' + i, kind: 'history', label: h.title || h.url, sub: h.url, run: () => createTab(h.url, true) }));
  return items;
}
function openPalette() {
  if (!paletteView) return;
  if (palette.shown) return closePalette();
  hideSuggest();
  const [w, h] = win.getContentSize();
  paletteView.setBounds({ x: 0, y: 0, width: w, height: h });
  win.contentView.addChildView(paletteView);
  palette.shown = true;
  palette.items = buildPaletteItems();
  paletteView.webContents.send('palette:open', palette.items.map(({ id, kind, label, sub, hint }) => ({ id, kind, label, sub, hint })));
  paletteView.webContents.focus();
}
function runPalette(arg) {
  closePalette();
  const it = palette.items.find(x => x.id === (arg && arg.id));
  if (it) { try { it.run(); } catch { /* ignore */ } return; }
  if (arg && typeof arg.text === 'string' && arg.text.trim()) { const t = activeTab(); if (t) { t.view.webContents.loadURL(normalizeInput(arg.text)).catch(() => {}); t.view.webContents.focus(); } }
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
  const r = await dialog.showSaveDialog(win, { title: 'Export bookmarks', defaultPath: 'lethe-bookmarks.html', filters: [{ name: 'Bookmarks (HTML)', extensions: ['html'] }] });
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
    case 'eject-menu': ejectMenu(); break;
    case 'fire': eject('all'); break;
    case 'tab-menu': tabMenu(arg); break;
    case 'group-menu': groupMenu(arg); break;
    case 'group-toggle': { const g = groups.find(x => x.id === arg); if (g) { g.collapsed = !g.collapsed; pushState(); } break; }
    case 'group-rename': { const g = groups.find(x => x.id === (arg && arg.id)); if (g && typeof arg.name === 'string') { g.name = arg.name.trim().slice(0, 30) || g.name; pushState(); } break; }
    case 'move-tab': if (arg) moveTab(arg.id, arg.before); break;
    case 'palette': openPalette(); break;
    case 'palette-run': runPalette(arg); break;
    case 'palette-close': closePalette(); break;
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
ipcMain.on('lethe:origin', e => { e.returnValue = ORIGIN; });
// Lets the page preload ask for the DuckDuckGo-browser UA (only ever used on duckduckgo.com pages).
ipcMain.on('lethe:uaInfo', (e, host) => { e.returnValue = uaInfoFor(String(host || '')); });
ipcMain.on('lethe:ddgHint', e => { e.returnValue = settings.general.ddgBrowserHint && !(DEV && process.env.LETHE_NO_HINT) ? DDG_UA : ''; });

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
    if (key === 'tabs.layout') layout();
    if (key.startsWith('forget.')) persistVisits();
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
  fire: () => { eject('all'); return true; },
  'eject:run': scope => { if (!['all', 'hour', 'day', 'site'].includes(scope)) return false; eject(scope); return true; },
  'stats:report': days => stats.report(Math.min(30, Math.max(1, +days || 7))),
  'stats:clear': () => { stats.clear(); return true; },
  'forget:addClose': site => {
    const host = String(site || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0], s = siteOf(host);
    if (!SITE_RE.test(s)) return false;
    if (!settings.forget.onCloseSites.includes(s)) settings.forget.onCloseSites.push(s);
    saveJSON('settings', settings); return true;
  },
  'forget:removeClose': site => { settings.forget.onCloseSites = settings.forget.onCloseSites.filter(x => x !== site); saveJSON('settings', settings); return true; },
  'filters:add': async ({ url, name }) => { try { await addFilterList(String(url || ''), name); return { ok: true }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } },
  'filters:toggle': id => { const l = settings.filters.lists.find(x => x.id === id); if (!l) return false; l.enabled = !l.enabled; saveJSON('settings', settings); loadFilterLists(); return true; },
  'filters:remove': id => {
    settings.filters.lists = settings.filters.lists.filter(x => x.id !== id);
    try { fs.unlinkSync(path.join(filtersDir(), String(id).replace(/[^\w]/g, '') + '.txt')); } catch { /* ignore */ }
    saveJSON('settings', settings); loadFilterLists(); return true;
  },
  'filters:update': async () => ({ updated: await updateFilterLists(false) }),
  'zapped:list': () => Object.entries(zapped).flatMap(([host, sels]) => sels.map(selector => ({ host, selector }))),
  'zapped:remove': ({ host, selector }) => { if (!zapped[host]) return false; zapped[host] = zapped[host].filter(x => x !== selector); if (!zapped[host].length) delete zapped[host]; saveJSON('zapped', zapped); return true; },
  'siteRule:set': ({ site, rule }) => {
    const host = String(site || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0], s = siteOf(host);
    if (!SITE_RE.test(s)) return false;
    const r = normalizeRule(rule);
    if (Object.keys(r).length) settings.siteRules[s] = r; else delete settings.siteRules[s];
    saveJSON('settings', settings); pushState(); return true;
  },
  'siteRule:remove': site => { delete settings.siteRules[site]; saveJSON('settings', settings); pushState(); return true; },
  'reader:get': id => readerDocs.get(+id) || null,
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

ipcMain.handle('lethe:call', async (e, name, arg) => {
  const f = e.senderFrame;
  if (!f || f !== e.sender.mainFrame || !f.url.startsWith(ORIGIN + '/')) throw new Error('forbidden');
  const h = handlers[name];
  if (!h) throw new Error('unknown call');
  return h(arg, e);
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 600, minHeight: 400, title: 'Lethe', icon: ICON,
    backgroundColor: theme.vars.bg,
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } } : { autoHideMenuBar: true }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  suggestView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'suggest-preload.js'), sandbox: true, contextIsolation: true } });
  suggestView.setBackgroundColor('#00000000');
  suggestView.webContents.loadFile(path.join(__dirname, 'ui', 'suggest.html'));
  suggestView.webContents.once('did-finish-load', () => suggestView.webContents.send('theme', theme));

  ejectView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  ejectView.webContents.loadFile(path.join(__dirname, 'ui', 'eject.html'));
  paletteView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'ui', 'palette-preload.js'), sandbox: true, contextIsolation: true } });
  paletteView.setBackgroundColor('#00000000');
  paletteView.webContents.loadFile(path.join(__dirname, 'ui', 'palette.html'));
  paletteView.webContents.once('did-finish-load', () => paletteView.webContents.send('theme', theme));

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('blur', hideSuggest);
  win.on('closed', () => { win = null; tabs = []; });
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('theme', theme);
    const arg = process.argv.slice(app.isPackaged ? 1 : 2).find(a => /^(https?|lethe):/i.test(a));
    createTab((DEV && process.env.LETHE_OPEN) || arg);
    if ((DEV && process.env.LETHE_SHOTS)) devShots((DEV && process.env.LETHE_SHOTS));
  });
}

// Developer hook: LETHE_SHOTS=<dir> saves screenshots of the chrome, active tab and any overlay, then quits.
// LETHE_MAIN_EVAL=<js> runs in the main process first (e.g. to open the palette) and prints MAIN <result>.
async function snap(wc) {
  try { return (await wc.capturePage()).toPNG(); } catch {
    // no display surface available (e.g. screen locked): fall back to a protocol-level screenshot
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const r = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r.data, 'base64');
  }
}
async function devShots(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    fs.mkdirSync(dir, { recursive: true });
    await wait(+(DEV && process.env.LETHE_WAIT) || 5000);
    if (DEV && process.env.LETHE_MAIN_EVAL) {
      try { console.log('MAIN', JSON.stringify(await eval(process.env.LETHE_MAIN_EVAL))); } catch (e) { console.log('MAIN_ERR', String(e)); }
      await wait(+(DEV && process.env.LETHE_AFTER) || 1200);
    }
    fs.writeFileSync(path.join(dir, 'chrome.png'), await snap(win.webContents));
    const t = activeTab();
    if (t && (DEV && process.env.LETHE_EVAL)) { try { console.log('EVAL', JSON.stringify(await t.view.webContents.executeJavaScript((DEV && process.env.LETHE_EVAL)))); } catch (e) { console.log('EVAL_ERR', String(e)); } }
    if (t) fs.writeFileSync(path.join(dir, 'tab.png'), await snap(t.view.webContents));
    if (palette.shown) fs.writeFileSync(path.join(dir, 'palette.png'), await snap(paletteView.webContents));
    if (DEV && process.env.LETHE_SHOT_EJECT) fs.writeFileSync(path.join(dir, 'eject.png'), await snap(ejectView.webContents));
    console.log('TABS', JSON.stringify(tabs.map(x => ({ title: x.title, url: x.url, blocked: x.blocked, pinned: x.pinned, group: x.group }))));
  } catch (e) { console.log('SHOT_ERR', String(e)); }
  quitting = true; firedOnExit = true; app.quit();
}

// One-time migration: copy settings, bookmarks and history from the app's previous name.
// (Cookies and site data are deliberately not migrated: this browser is meant to forget.)
function migrateLegacyData() {
  try {
    const old = path.join(app.getPath('appData'), 'InstaOlvidar Browser');
    const cur = app.getPath('userData');
    if (fs.existsSync(path.join(cur, 'settings.json')) || !fs.existsSync(path.join(old, 'settings.json'))) return;
    fs.mkdirSync(cur, { recursive: true });
    for (const f of ['settings.json', 'bookmarks.json', 'history.json']) {
      if (fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(cur, f));
    }
  } catch { /* start fresh */ }
}

app.whenReady().then(async () => {
  const srv = await startServer(__dirname);
  ORIGIN = srv.origin; NEWTAB = ORIGIN + '/newtab.html';
  migrateLegacyData();
  settings = loadSettings(loadJSON('settings', {}));
  if ((DEV && process.env.LETHE_SETTINGS)) { try { const o = JSON.parse((DEV && process.env.LETHE_SETTINGS)); for (const [sec, vals] of Object.entries(o)) Object.assign(settings[sec], vals); } catch { /* ignore */ } }
  bookmarks = loadJSON('bookmarks', []);
  history = loadJSON('history', []);
  stats.init(() => settings.stats.enabled);
  visits = loadJSON('visits', {});
  for (const [k, v] of Object.entries(visits)) if (!v || typeof v.t !== 'number' || Date.now() - v.t > 60 * 86400e3) delete visits[k];
  zapped = loadJSON('zapped', {});
  loadFilterLists();
  if (isMac && app.dock) app.dock.setIcon(ICON);
  setupPrivacy();
  applyTheme();
  nativeTheme.on('updated', () => { if (settings.appearance.preset === 'auto') applyTheme(); });
  buildAppMenu();
  createWindow();
  setInterval(() => forgetStale().catch(() => {}), 10 * 60 * 1000);
  setTimeout(() => { forgetStale().catch(() => {}); updateFilterLists(true).catch(() => {}); }, 25000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', e => {
  saveJSONNow('settings', settings); saveJSONNow('bookmarks', bookmarks); saveJSONNow('history', history); saveJSONNow('zapped', zapped);
  if (settings && (settings.privacy.saveHistory || settings.forget.afterHours > 0)) saveJSONNow('visits', visits);
  if (settings && settings.privacy.fireOnExit && !firedOnExit && !quitting) {
    e.preventDefault(); quitting = true;
    clearAllData().catch(() => {}).finally(() => { firedOnExit = true; app.quit(); });
  }
});
app.on('window-all-closed', () => app.quit());
