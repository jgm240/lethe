let D;
const setKey = (key, value) => lethe.call('setSetting', { key, value });
const get = (o, path) => path.split('.').reduce((a, k) => a[k], o);

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button, section').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); $(b.dataset.s).classList.add('on'); location.hash = b.dataset.s;
});
if (location.hash) { const b = document.querySelector(`nav button[data-s="${location.hash.slice(1)}"]`); if (b) b.click(); }

function chips(box, list, name) {
  box.replaceChildren();
  if (!list.length) return box.append(el('span', { className: 'muted', textContent: 'None' }));
  for (const site of list) {
    const x = el('button', { className: 'x', textContent: '✕', title: 'Remove' });
    x.onclick = async () => { await lethe.call('removeSite', { list: name, site }); load(); };
    box.append(el('span', { className: 'chip' }, site, x));
  }
}

function render() {
  const s = D.settings;
  document.querySelectorAll('[data-k]').forEach(i => { i.checked = !!get(s, i.dataset.k); i.onchange = () => setKey(i.dataset.k, i.checked); });
  const eng = $('engine'); eng.replaceChildren();
  for (const [id, name] of Object.entries(D.engines)) eng.append(el('option', { value: id, textContent: name, selected: id === s.general.searchEngine }));
  eng.onchange = () => setKey('general.searchEngine', eng.value);
  $('pm').value = s.player.mode; $('pm').onchange = () => setKey('player.mode', $('pm').value);
  $('ver').textContent = 'v' + D.version;

  // themes
  const tbox = $('themes'); tbox.replaceChildren();
  const cur = s.appearance.preset;
  const mk = (id, name, vars) => {
    const sw = el('div', { className: 'sw' }, ...(vars ? [vars.bg, vars.bar, vars.accent].map(c => { const i = el('i'); i.style.background = c; return i; }) : []));
    if (!vars) sw.style.background = 'linear-gradient(90deg,#14142e 50%,#f6f6f8 50%)';
    const b = el('button', { className: 'th' + (cur === id ? ' on' : '') }, sw, el('div', { className: 'nm', textContent: name }));
    b.onclick = async () => { await setKey('appearance.preset', id); load(); };
    tbox.append(b);
  };
  mk('auto', 'Match system', null);
  D.presets.forEach(p => mk(p.id, p.name, p.vars));
  mk('custom', 'Custom', D.theme.vars);
  $('custom').classList.toggle('on', cur === 'custom');
  document.querySelectorAll('[data-c]').forEach(i => {
    i.value = s.appearance.custom[i.dataset.c];
    i.onchange = () => setKey('appearance.custom.' + i.dataset.c, i.value);
  });

  // backgrounds
  const bbox = $('bgs'); bbox.replaceChildren();
  const bgs = [{ id: 'none', name: 'None' }, { id: 'random', name: 'Random' }, ...D.backgrounds];
  for (const b of bgs) {
    const sw = el('div', { className: 'sw' });
    if (b.file) sw.style.backgroundImage = `url("/backgrounds/${b.file}")`; else sw.style.background = b.id === 'random' ? 'linear-gradient(135deg,#e8663d,#3b82f6)' : 'var(--field)';
    const t = el('button', { className: 'th' + (s.appearance.newtabBackground === b.id ? ' on' : '') }, sw, el('div', { className: 'nm', textContent: b.name }));
    t.onclick = async () => { await setKey('appearance.newtabBackground', b.id); load(); };
    bbox.append(t);
  }
  // location
  const lp = $('locPreset'); lp.replaceChildren();
  for (const l of D.locations) lp.append(el('option', { value: l.id, textContent: l.name }));
  lp.append(el('option', { value: 'custom', textContent: 'Custom…' }));
  lp.value = s.location.preset;
  lp.onchange = async () => { await setKey('location.preset', lp.value); load(); };
  $('locCustom').style.display = s.location.preset === 'custom' ? '' : 'none';
  const bindLoc = (id, key, conv) => {
    const i = $(id); i.value = s.location[key]; i.style.borderColor = '';
    i.onchange = async () => { const ok = await setKey('location.' + key, conv(i.value)); i.style.borderColor = ok ? '' : '#c0392b'; if (ok) load(); };
  };
  bindLoc('locLat', 'lat', Number); bindLoc('locLon', 'lon', Number); bindLoc('locTz', 'tz', v => v.trim());
  // user agent
  const up = $('uaPreset'); up.replaceChildren();
  for (const p of D.uaPresets) up.append(el('option', { value: p.id, textContent: p.name }));
  up.value = s.userAgent.preset;
  up.onchange = async () => { await setKey('userAgent.preset', up.value); load(); };
  $('uaCustomRow').style.display = s.userAgent.preset === 'custom' ? '' : 'none';
  const uc = $('uaCustom'); uc.value = s.userAgent.custom;
  uc.onchange = async () => { const ok = await setKey('userAgent.custom', uc.value); uc.style.borderColor = ok ? '' : '#c0392b'; if (ok) load(); };
  $('uaCurrent').textContent = D.uaCurrent;
  // map
  syncMap();
  renderExtras();
  chips($('fp'), s.privacy.fireproofSites, 'fireproofSites');
  chips($('up'), s.privacy.unprotectedSites, 'unprotectedSites');
}
$('burn').onclick = () => lethe.call('fire');
async function load() { D = await lethe.call('getSettings'); applyTheme(D.theme); render(); }
load();

// ---- location map (Leaflet bundled with the app; tiles load from OpenStreetMap only after you open it) ----
let map = null, marker = null;
function mapInfo(extra) {
  const l = D.settings.location;
  $('mapInfo').textContent = `${l.lat}, ${l.lon} · ${l.tz}` + (D.settings.location.spoof ? '' : ' — turn on “Spoof location” above to use it.') + (extra ? ' ' + extra : '');
}
function syncMap() {
  if (!map) return;
  const l = D.settings.location;
  marker.setLatLng([l.lat, l.lon]);
  if (!map.getBounds().contains([l.lat, l.lon])) map.setView([l.lat, l.lon], map.getZoom());
  mapInfo();
}
async function pick(ll) {
  const w = ll.wrap();
  const r = await lethe.call('location:pick', { lat: w.lat, lon: w.lng });
  if (r) { D = await lethe.call('getSettings'); render(); marker.setLatLng([r.lat, r.lon]); }
}
function openMap() {
  $('mapBox').style.display = '';
  $('mapBtn').textContent = 'Close map';
  if (!map) {
    const l = D.settings.location;
    map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([l.lat, l.lon], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    marker = L.marker([l.lat, l.lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="pin-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    map.on('click', e => pick(e.latlng));
    marker.on('dragend', () => pick(marker.getLatLng()));
    window.__map = map; // handy for tests
  }
  setTimeout(() => { map.invalidateSize(); syncMap(); }, 50);
}
$('mapBtn').onclick = () => {
  if ($('mapBox').style.display === 'none') openMap();
  else { $('mapBox').style.display = 'none'; $('mapBtn').textContent = 'Open map'; }
};

// ---- Eject & Forget, Filters, Site rules, Tabs ----
function chipList(box, list, onRemove) {
  box.replaceChildren();
  if (!list.length) return box.append(el('span', { className: 'muted', textContent: 'None' }));
  for (const item of list) {
    const x = el('button', { className: 'x', textContent: '✕', title: 'Remove' }); x.onclick = () => onRemove(item);
    box.append(el('span', { className: 'chip' }, item, x));
  }
}
const when = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function ruleSummary(r) {
  const out = [];
  if (r.userAgent) out.push('UA: ' + ((D.uaPresets.find(p => p.id === r.userAgent) || {}).name || r.userAgent));
  if (r.location) out.push('Location: ' + (r.location === 'off' ? 'real' : (D.locations.find(l => l.id === r.location) || {}).name || r.location));
  for (const [k, n] of [['noJs', 'JavaScript'], ['noCss', 'CSS'], ['noImages', 'Images']]) if (typeof r[k] === 'boolean') out.push(n + (r[k] ? ' blocked' : ' allowed'));
  return out.join(' · ');
}
function loadRuleIntoEditor(site) {
  const r = D.settings.siteRules[site] || {};
  $('ruleSite').value = site;
  $('ruleUa').value = r.userAgent || ''; $('ruleLoc').value = r.location || '';
  for (const [id, key] of [['ruleJs', 'noJs'], ['ruleCss', 'noCss'], ['ruleImg', 'noImages']]) $(id).value = r[key] === true ? 'on' : r[key] === false ? 'off' : '';
  $('ruleMsg').textContent = '';
}
async function refreshZaps() {
  const zaps = await lethe.call('zapped:list'), box = $('zaps'); box.replaceChildren();
  if (!zaps.length) return box.append(el('span', { className: 'muted', textContent: 'Nothing hidden yet.' }));
  for (const z of zaps) {
    const x = el('button', { className: 'x', textContent: '✕', title: 'Show it again' });
    x.onclick = async () => { await lethe.call('zapped:remove', z); refreshZaps(); };
    box.append(el('div', { className: 'it', style: 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)' }, el('div', { style: 'flex:1;min-width:0' }, el('div', { textContent: z.host }), el('div', { className: 'muted', style: 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', textContent: z.selector })), x));
  }
}
let extrasBound = false;
function renderExtras() {
  const s = D.settings;
  $('tabLayout').value = s.tabs.layout; $('tabLayout').onchange = () => setKey('tabs.layout', $('tabLayout').value);
  $('afterHours').value = String(s.forget.afterHours); $('afterHours').onchange = () => setKey('forget.afterHours', +$('afterHours').value);
  chipList($('closeList'), s.forget.onCloseSites, async site => { await lethe.call('forget:removeClose', site); load(); });
  // filter lists
  const box = $('lists'); box.replaceChildren();
  for (const l of s.filters.lists) {
    const sw = el('label', { className: 'switch' }, el('input', { type: 'checkbox', checked: l.enabled }), el('span'));
    sw.firstChild.onchange = async () => { await lethe.call('filters:toggle', l.id); load(); };
    const del = el('button', { className: 'x', textContent: '✕', title: 'Remove list' }); del.onclick = async () => { await lethe.call('filters:remove', l.id); load(); };
    box.append(el('div', { className: 'row' }, el('div', { className: 'txt' }, el('div', { className: 't', textContent: l.name }), el('div', { className: 'd', textContent: `${l.count.toLocaleString()} rules understood · updated ${when(l.updated)} · ${l.url}` })), sw, del));
  }
  // site rules
  const ua = $('ruleUa'); ua.replaceChildren(el('option', { value: '', textContent: 'Inherit' }));
  for (const p of D.uaPresets.filter(p => p.id !== 'custom')) ua.append(el('option', { value: p.id, textContent: p.name }));
  const loc = $('ruleLoc'); loc.replaceChildren(el('option', { value: '', textContent: 'Inherit' }), el('option', { value: 'off', textContent: 'Real location' }));
  for (const l of D.locations) loc.append(el('option', { value: l.id, textContent: l.name }));
  const rb = $('rules'); rb.replaceChildren();
  const entries = Object.entries(s.siteRules);
  if (!entries.length) rb.append(el('div', { className: 'row' }, el('span', { className: 'muted', textContent: 'No site rules yet.' })));
  for (const [site, r] of entries) {
    const edit = el('button', { className: 'btn', textContent: 'Edit' }); edit.onclick = () => { loadRuleIntoEditor(site); window.scrollTo(0, 0); };
    rb.append(el('div', { className: 'row' }, el('div', { className: 'txt' }, el('div', { className: 't', textContent: site }), el('div', { className: 'd', textContent: ruleSummary(r) })), edit));
  }
  if (extrasBound) return; extrasBound = true;
  $('closeAdd').onclick = async () => { const ok = await lethe.call('forget:addClose', $('closeSite').value); $('closeSite').style.borderColor = ok ? '' : '#c0392b'; if (ok) { $('closeSite').value = ''; load(); } };
  $('fhour').onclick = () => lethe.call('eject:run', 'hour'); $('fday').onclick = () => lethe.call('eject:run', 'day'); $('ejectNow').onclick = () => lethe.call('eject:run', 'all');
  const add = async (url, name, btn) => {
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Downloading…'; $('listMsg').textContent = '';
    const r = await lethe.call('filters:add', { url, name });
    btn.disabled = false; btn.textContent = old;
    $('listMsg').textContent = r.ok ? 'List added.' : 'Couldn’t add the list: ' + r.error; if (r.ok) { $('listUrl').value = ''; await load(); }
  };
  $('addEP').onclick = e => add('https://easylist.to/easylist/easyprivacy.txt', 'EasyPrivacy', e.target);
  $('addEL').onclick = e => add('https://easylist.to/easylist/easylist.txt', 'EasyList', e.target);
  $('listAdd').onclick = e => add($('listUrl').value.trim(), '', e.target);
  $('listUpdate').onclick = async e => { e.target.disabled = true; e.target.textContent = 'Updating…'; const r = await lethe.call('filters:update'); e.target.disabled = false; e.target.textContent = 'Update'; $('listMsg').textContent = `${r.updated} list${r.updated === 1 ? '' : 's'} updated.`; await load(); };
  $('ruleSave').onclick = async () => {
    const rule = {}; if ($('ruleUa').value) rule.userAgent = $('ruleUa').value; if ($('ruleLoc').value) rule.location = $('ruleLoc').value;
    for (const [id, key] of [['ruleJs', 'noJs'], ['ruleCss', 'noCss'], ['ruleImg', 'noImages']]) { const v = $(id).value; if (v) rule[key] = v === 'on'; }
    const ok = await lethe.call('siteRule:set', { site: $('ruleSite').value, rule });
    $('ruleMsg').textContent = ok ? (Object.keys(rule).length ? 'Saved. Reload the site to apply it.' : 'Rule removed (nothing set).') : 'Enter a valid site such as example.com.';
    if (ok) await load();
  };
  $('ruleDelete').onclick = async () => { const site = $('ruleSite').value.trim().toLowerCase(); await lethe.call('siteRule:remove', site.replace(/^www\./, '')); $('ruleMsg').textContent = 'Rule removed.'; await load(); };
  refreshZaps();
}
// open with ?site=… (from the shield menu): jump to the site-rule editor
(() => {
  const site = new URLSearchParams(location.search).get('site');
  if (!site) return;
  const go = () => { if (!D) return setTimeout(go, 100); document.querySelector('nav button[data-s="sites"]').click(); loadRuleIntoEditor(site); };
  go();
})();
