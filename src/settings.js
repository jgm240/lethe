const { PRESETS: UA_PRESETS, validCustom } = require('./useragents');

const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' }
};

const BACKGROUNDS = [
  { id: 'thrown', file: '1-thrown.jpg', name: 'Thrown in' },
  { id: 'downstream', file: '2-downstream.jpg', name: 'Downstream' },
  { id: 'sinking', file: '3-sinking.jpg', name: 'Sinking' },
  { id: 'mist', file: '4-mist.jpg', name: 'Mist' }
];

const LOCATIONS = [
  { id: 'newyork', name: 'New York, USA', lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
  { id: 'london', name: 'London, UK', lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  { id: 'paris', name: 'Paris, France', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { id: 'reykjavik', name: 'Reykjavík, Iceland', lat: 64.1466, lon: -21.9426, tz: 'Atlantic/Reykjavik' },
  { id: 'tokyo', name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { id: 'sydney', name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { id: 'saopaulo', name: 'São Paulo, Brazil', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
  { id: 'mumbai', name: 'Mumbai, India', lat: 19.076, lon: 72.8777, tz: 'Asia/Kolkata' },
  { id: 'capetown', name: 'Cape Town, South Africa', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  { id: 'nullisland', name: 'Null Island (0°, 0°)', lat: 0, lon: 0, tz: 'UTC' }
];

const DEFAULTS = {
  general: { searchEngine: 'duckduckgo', suggestions: true, hideSearchPromos: true, ddgBrowserHint: false },
  appearance: {
    preset: 'auto',
    custom: { accent: '#e8663d', bar: '#1f2048', bg: '#14142e' },
    newtabBackground: 'thrown',
    showFavorites: true
  },
  privacy: {
    trackerBlocking: true, httpsUpgrade: true, gpc: true, thirdPartyCookies: true,
    stripTrackingParams: true, cookiePopups: true, saveHistory: true, fireOnExit: false,
    unprotectedSites: [], fireproofSites: []
  },
  content: { noCss: false, noImages: false, noJs: false },
  userAgent: { preset: 'default', custom: '' },
  location: { spoof: false, preset: 'newyork', lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
  player: { mode: 'ask' }
};

const bool = v => (typeof v === 'boolean' ? v : undefined);
const oneOf = list => v => (list.includes(v) ? v : undefined);
const num = (min, max) => v => (typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : undefined);
const tzv = v => { if (typeof v !== 'string' || v.length > 64) return undefined; try { new Intl.DateTimeFormat('en', { timeZone: v }); return v; } catch { return undefined; } };
const hex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);

const SCHEMA = {
  'general.searchEngine': oneOf(Object.keys(ENGINES)),
  'general.suggestions': bool,
  'general.hideSearchPromos': bool,
  'general.ddgBrowserHint': bool,
  'appearance.preset': oneOf(['auto', 'ember', 'daylight', 'ocean', 'forest', 'sakura', 'graphite', 'midnight', 'sand', 'custom']),
  'appearance.custom.accent': hex,
  'appearance.custom.bar': hex,
  'appearance.custom.bg': hex,
  'appearance.newtabBackground': oneOf(['none', 'random', ...BACKGROUNDS.map(b => b.id)]),
  'appearance.showFavorites': bool,
  'privacy.trackerBlocking': bool,
  'privacy.httpsUpgrade': bool,
  'privacy.gpc': bool,
  'privacy.thirdPartyCookies': bool,
  'privacy.stripTrackingParams': bool,
  'privacy.cookiePopups': bool,
  'privacy.saveHistory': bool,
  'privacy.fireOnExit': bool,
  'content.noCss': bool,
  'content.noImages': bool,
  'content.noJs': bool,
  'location.spoof': bool,
  'location.preset': oneOf(['custom', ...LOCATIONS.map(l => l.id)]),
  'location.lat': num(-90, 90),
  'location.lon': num(-180, 180),
  'location.tz': tzv,
  'userAgent.preset': oneOf(UA_PRESETS.map(p => p.id)),
  'userAgent.custom': v => (validCustom(v) ? v : undefined),
  'player.mode': oneOf(['ask', 'always', 'never'])
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(base)) {
    if (k in over) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
      else if (typeof over[k] === typeof base[k]) out[k] = over[k];
    }
  }
  return out;
}
function load(stored) {
  const s = merge(DEFAULTS, stored);
  const ok = ['none', 'random', ...BACKGROUNDS.map(b => b.id)];
  if (!ok.includes(s.appearance.newtabBackground)) s.appearance.newtabBackground = 'thrown'; // old artwork ids -> new default
  return s;
}

function applySetting(settings, key, value) {
  const validate = SCHEMA[key];
  if (!validate) return false;
  const v = validate(value);
  if (v === undefined) return false;
  const parts = key.split('.');
  let o = settings;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = v;
  return true;
}

module.exports = { ENGINES, BACKGROUNDS, LOCATIONS, UA_PRESETS, DEFAULTS, load, applySetting };
