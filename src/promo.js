// Replaces DuckDuckGo's "get our browser" promotions on duckduckgo.com pages with a short note.
// DDG's class names are generated and change often, so this matches the promo *text* and hides the
// smallest surrounding block that contains no search UI or results.
const fs = require('fs');
const path = require('path');

const NOTE_TEXT = 'No browser promos - already using InstaOlvidar Browser';
let svg = '';
try { svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8'); } catch { /* note works without the icon */ }

// Pre-hide the known promo containers to avoid a flash before the script runs.
const CSS = `[class*="cta-cards-module"], [class*="desktop-homepage-module"][class*="ctaSection"] { display: none !important; }`;

const JS = `(() => {
  if (window.__instaPromo) return;
  window.__instaPromo = true;
  const NOTE = ${JSON.stringify(NOTE_TEXT)};
  const ICON = ${JSON.stringify(svg)};
  const BANNER = /^(download browser|install (mac |windows |ios |android |linux )?browser|upgrade to our private browser|get our free browser.*|switch to duckduckgo.*|set as default search)$/i;
  const MENU = /^(downloads|about (our )?browser|browser extensions|(ios|android|mac|windows) browser)$/i;
  const KEEP = 'input,textarea,article,form,main,#links,#react-layout,[data-testid*="result"]';

  function makeNote() {
    const box = document.createElement('div');
    box.id = 'instaolvidar-promo-note';
    box.style.cssText = 'display:flex;align-items:center;gap:12px;box-sizing:border-box;width:fit-content;max-width:min(92%,520px);margin:18px auto;padding:12px 18px 12px 12px;border-radius:14px;border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.09);color:inherit;font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;';
    if (ICON) {
      try {
        const doc = new DOMParser().parseFromString(ICON, 'image/svg+xml');
        const svgEl = document.importNode(doc.documentElement, true);
        svgEl.setAttribute('width', '40'); svgEl.setAttribute('height', '40');
        svgEl.style.cssText = 'flex:none;display:block';
        box.append(svgEl);
      } catch (e) {}
    }
    const t = document.createElement('span'); t.textContent = NOTE; box.append(t);
    return box;
  }

  function block(el) {
    let cand = el;
    while (cand.parentElement && cand.parentElement !== document.body && (cand.parentElement.textContent || '').trim().length < 300 && !cand.parentElement.querySelector(KEEP)) cand = cand.parentElement;
    return cand;
  }
  function hide(el, replace) {
    const cand = block(el);
    if (cand.dataset.instaHidden) return;
    cand.style.setProperty('display', 'none', 'important');
    cand.dataset.instaHidden = '1';
    if (replace && !document.getElementById('instaolvidar-promo-note') && cand.parentNode) cand.parentNode.insertBefore(makeNote(), cand);
  }
  function scan() {
    if (!document.body) return;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const banners = [], menus = []; let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.trim();
      if (!t || t.length > 60) continue;
      if (BANNER.test(t)) banners.push(n.parentElement); else if (MENU.test(t)) menus.push(n.parentElement);
    }
    banners.forEach(el => hide(el, true));
    menus.forEach(el => hide(el, false));
  }
  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 150); }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})()`;
module.exports = { CSS, JS, NOTE_TEXT };
