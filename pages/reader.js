// Reader view: shows an article extracted by Readability. The extracted HTML is rebuilt through an allowlist
// (no scripts, styles, forms, frames or event handlers can survive) before it is displayed.
const ALLOW = new Set('p h1 h2 h3 h4 h5 h6 a img ul ol li blockquote pre code em strong b i u sub sup br hr figure figcaption table thead tbody tr th td span div section article small mark cite q dl dt dd'.split(' '));
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'noscript', 'svg', 'canvas', 'video', 'audio']);
const safeUrl = (u, imgs) => { try { const x = new URL(u, 'https://x.invalid'); return imgs ? (x.protocol === 'https:' || /^data:image\/(png|jpe?g|gif|webp);/i.test(u)) : /^(https?|mailto):$/.test(x.protocol); } catch { return false; } };
function clean(node, out) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { out.append(document.createTextNode(c.nodeValue)); continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (!ALLOW.has(tag)) { clean(c, out); continue; }          // unknown element: keep its text, drop the element
    const e = document.createElement(tag);
    if (tag === 'a') { const h = c.getAttribute('href'); if (h && safeUrl(h, false)) { e.setAttribute('href', new URL(h, doc.url).href); e.setAttribute('rel', 'noopener noreferrer'); } }
    if (tag === 'img') { const s = c.getAttribute('src'); if (!s || !safeUrl(s, true)) continue; e.setAttribute('src', new URL(s, doc.url).href.startsWith('data:') ? s : new URL(s, doc.url).href); e.setAttribute('alt', (c.getAttribute('alt') || '').slice(0, 200)); e.setAttribute('loading', 'lazy'); e.setAttribute('referrerpolicy', 'no-referrer'); }
    clean(c, e); out.append(e);
  }
}
let doc = null, S = null, speaking = false, queue = [], qi = 0;
async function setPref(k, v) { await lethe.call('setSetting', { key: 'reader.' + k, value: v }); }
function applyPrefs() {
  const r = S.reader;
  document.body.classList.remove('papyrus', 'light', 'dark'); document.body.classList.add(r.theme);
  $('main').className = r.font; document.body.style.setProperty('--fs', r.size + 'px');
  $('theme').value = r.theme; $('font').value = r.font;
  document.body.classList.toggle('noimg', !!S.content.noImages);
}
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const d = await lethe.call('getSettings'); S = d.settings; applyTheme(d.theme);
  doc = await lethe.call('reader:get', id);
  if (!doc) { $('main').replaceChildren(el('div', { className: 'err', textContent: 'This reader page has expired. Go back to the original page and open reader mode again.' })); return; }
  document.title = doc.title + ' — Reader';
  $('title').textContent = doc.title || 'Untitled';
  $('meta').textContent = [doc.byline, doc.siteName || doc.host].filter(Boolean).join(' · ');
  const parsed = new DOMParser().parseFromString('<body>' + doc.content + '</body>', 'text/html');
  clean(parsed.body, $('art'));
  applyPrefs();
  $('orig').onclick = () => lethe.call('go', doc.url);
  $('theme').onchange = async e => { S.reader.theme = e.target.value; applyPrefs(); setPref('theme', e.target.value); };
  $('font').onchange = async e => { S.reader.font = e.target.value; applyPrefs(); setPref('font', e.target.value); };
  const size = dv => { S.reader.size = Math.max(14, Math.min(34, S.reader.size + dv)); applyPrefs(); setPref('size', S.reader.size); };
  $('smaller').onclick = () => size(-2); $('bigger').onclick = () => size(2);
  $('play').onclick = toggleSpeak; $('stop').onclick = stopSpeak;
})();

// ---- text to speech (the system's own voices; nothing is sent anywhere) ----
function paragraphs() { return [...$('art').querySelectorAll('p, h1, h2, h3, h4, li, blockquote')].filter(p => p.textContent.trim().length > 1); }
function speakNext() {
  document.querySelectorAll('.speaking').forEach(x => x.classList.remove('speaking'));
  if (qi >= queue.length) return stopSpeak();
  const p = queue[qi]; p.classList.add('speaking'); p.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const u = new SpeechSynthesisUtterance(p.textContent.trim()); u.rate = +$('rate').value; if (doc.lang) u.lang = doc.lang;
  u.onend = () => { if (speaking) { qi++; speakNext(); } }; u.onerror = () => { if (speaking) { qi++; speakNext(); } };
  speechSynthesis.speak(u);
}
function toggleSpeak() {
  if (!('speechSynthesis' in window)) return;
  if (!speaking) { speaking = true; queue = paragraphs(); qi = 0; $('play').textContent = '❚❚ Pause'; $('play').classList.add('on'); $('stop').hidden = false; speakNext(); return; }
  if (speechSynthesis.paused) { speechSynthesis.resume(); $('play').textContent = '❚❚ Pause'; } else { speechSynthesis.pause(); $('play').textContent = '▶ Resume'; }
}
function stopSpeak() { speaking = false; speechSynthesis.cancel(); document.querySelectorAll('.speaking').forEach(x => x.classList.remove('speaking')); $('play').textContent = '▶ Listen'; $('play').classList.remove('on'); $('stop').hidden = true; }
addEventListener('beforeunload', () => speechSynthesis.cancel());
