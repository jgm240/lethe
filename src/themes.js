// Theme engine: presets + a custom theme built from three colours.
const hex2rgb = h => { h = h.replace('#', ''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => {
  const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function build(bg, bar, accent) {
  const dark = lum(bar) < 0.4;
  const fg = dark ? '#f4f4f7' : '#1b1b1f';
  return {
    bg, bar, tab: mix(bg, bar, 0.35), tabActive: bar, fg, muted: mix(fg, bar, 0.42),
    field: dark ? mix(bar, '#000000', 0.38) : mix(bar, '#ffffff', 0.75),
    border: mix(bar, fg, 0.18), accent, accentFg: lum(accent) > 0.5 ? '#111111' : '#ffffff',
    hover: dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)', ok: dark ? '#51cf66' : '#2f9e44'
  };
}

const PRESETS = {
  ember: { name: 'Ember', bg: '#14142e', bar: '#1f2048', accent: '#e8663d' },
  daylight: { name: 'Daylight', bg: '#e9e9ec', bar: '#f6f6f8', accent: '#e8663d' },
  ocean: { name: 'Ocean', bg: '#0b1d2e', bar: '#12304a', accent: '#38bdf8' },
  forest: { name: 'Forest', bg: '#0f1f17', bar: '#17332a', accent: '#4ade80' },
  sakura: { name: 'Sakura', bg: '#f3dfe7', bar: '#fff5f8', accent: '#e0558a' },
  graphite: { name: 'Graphite', bg: '#121212', bar: '#1f1f1f', accent: '#9ca3af' },
  midnight: { name: 'Midnight', bg: '#000000', bar: '#0b0b0d', accent: '#8b5cf6' },
  sand: { name: 'Sand', bg: '#e8dfca', bar: '#f7f1e3', accent: '#c2410c' }
};

function resolveTheme(settings, systemDark) {
  let id = settings.appearance.preset;
  if (id === 'auto') id = systemDark ? 'ember' : 'daylight';
  if (id === 'custom') {
    const c = settings.appearance.custom;
    const vars = build(c.bg, c.bar, c.accent);
    return { id: 'custom', dark: lum(c.bar) < 0.4, vars };
  }
  const p = PRESETS[id] || PRESETS.ember;
  return { id, dark: lum(p.bar) < 0.4, vars: build(p.bg, p.bar, p.accent) };
}

const presetList = () => Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, vars: build(p.bg, p.bar, p.accent), dark: lum(p.bar) < 0.4 }));

module.exports = { resolveTheme, presetList };
