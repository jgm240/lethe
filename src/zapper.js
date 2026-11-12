// Element zapper: lets the user click an element on the page; resolves with a CSS selector (or null if cancelled).
module.exports = `(() => new Promise(resolve => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #e8663d;background:rgba(232,102,61,.18);border-radius:3px';
  const tip = document.createElement('div');
  tip.textContent = 'Click an element to hide it \\u00b7 Esc to cancel';
  tip.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1f2048;color:#fff;font:13px system-ui,sans-serif;padding:8px 14px;border-radius:10px;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.4)';
  document.documentElement.append(box, tip);
  let cur = null;
  const move = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === tip) return;
    cur = el; const r = el.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  };
  const cleanup = () => { removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true); box.remove(); tip.remove(); };
  const selectorFor = el => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6) {
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter(c => /^[a-z][\\w-]{1,30}$/i.test(c) && !/\\d{4,}/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(c => CSS.escape(c)).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter(x => x.tagName === n.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
      parts.unshift(p);
      const s = parts.join(' > ');
      try { if (document.querySelectorAll(s).length === 1) return s; } catch (e) {}
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const click = e => { e.preventDefault(); e.stopPropagation(); const s = selectorFor(cur || e.target); cleanup(); resolve(s && s.length < 400 ? s : null); };
  const key = e => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
}))()`;
