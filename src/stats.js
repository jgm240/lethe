// Local, aggregate-only privacy statistics (counts per day). It deliberately stores no URLs and no visited-site
// names: only counts, plus the hostnames of the *trackers* that were blocked.
const { loadJSON, saveJSON } = require('./store');

let data = { days: {} };
let enabled = () => true;

const key = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function init(isEnabled) {
  enabled = isEnabled;
  data = loadJSON('stats', { days: {} });
  if (!data || typeof data.days !== 'object') data = { days: {} };
  const keep = Object.keys(data.days).sort().slice(-35);
  for (const k of Object.keys(data.days)) if (!keep.includes(k)) delete data.days[k];
}

function add(field, n = 1, tracker) {
  if (!enabled()) return;
  const d = data.days[key()] || (data.days[key()] = { trackers: {} });
  d[field] = (d[field] || 0) + n;
  if (tracker) {
    d.trackers[tracker] = (d.trackers[tracker] || 0) + 1;
    const hosts = Object.keys(d.trackers);
    if (hosts.length > 60) { // keep each day small
      hosts.sort((a, b) => d.trackers[a] - d.trackers[b]);
      for (const h of hosts.slice(0, hosts.length - 50)) delete d.trackers[h];
    }
  }
  saveJSON('stats', data);
}

function report(days = 7) {
  const out = [], totals = { blocked: 0, params: 0, popups: 0, upgrades: 0, cookies: 0, ejects: 0 }, tr = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = key(d), e = data.days[k] || {};
    const row = { date: k, blocked: e.blocked || 0, params: e.params || 0, popups: e.popups || 0, upgrades: e.upgrades || 0, cookies: e.cookies || 0, ejects: e.ejects || 0 };
    for (const f of Object.keys(totals)) totals[f] += row[f];
    for (const [h, n] of Object.entries(e.trackers || {})) tr[h] = (tr[h] || 0) + n;
    out.push(row);
  }
  const top = Object.entries(tr).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([host, count]) => ({ host, count }));
  return { days: out, totals, top, enabled: enabled() };
}

function clear() { data = { days: {} }; saveJSON('stats', data); }

module.exports = { init, add, report, clear };
