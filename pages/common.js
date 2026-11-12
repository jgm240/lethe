// Shared helpers for InstaOlvidar internal pages.
function applyTheme(t) {
  if (!t) return;
  for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty('--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), v);
  document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
}
const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const e = Object.assign(document.createElement(tag), props || {});
  for (const k of kids) e.append(k);
  return e;
}
if (window.insta) {
  insta.onTheme(applyTheme);
  insta.call('getSettings').then(d => applyTheme(d.theme));
}
function hostLabel(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
