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
