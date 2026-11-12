(async () => {
  const d = await lethe.call('getSettings');
  const s = d.settings;
  $('q').placeholder = 'Search privately with ' + d.engines[s.general.searchEngine];
  let bg = s.appearance.newtabBackground;
  if (bg === 'random') bg = d.backgrounds[Math.floor(Math.random() * d.backgrounds.length)].id;
  const b = d.backgrounds.find(x => x.id === bg);
  if (b) {
    document.body.style.setProperty('--bgimg', `url("/backgrounds/${b.file}")`);
    document.body.classList.add('bg');
    if (b.id === 'thrown') document.body.classList.add('right');
  }
  $('f').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value.trim(); if (v) lethe.call('go', v); });
  if (s.appearance.showFavorites) {
    const favs = (await lethe.call('bookmarks:list')).filter(x => x.favorite).slice(0, 8);
    const box = $('favs');
    const colors = ['#e8663d', '#3b82f6', '#10b981', '#a855f7', '#ef4444', '#f59e0b', '#14b8a6', '#ec4899'];
    favs.forEach((f, i) => {
      const a = el('a', { className: 'fav', href: f.url, title: f.url });
      const ic = el('div', { className: 'ic', textContent: (hostLabel(f.url)[0] || '?').toUpperCase() });
      ic.style.background = colors[i % colors.length];
      a.append(ic, el('div', { className: 'nm', textContent: f.title || hostLabel(f.url) }));
      box.append(a);
    });
  }
  try {
    const r = await lethe.call('stats:report', 7);
    if (r.enabled && r.totals.blocked > 0) {
      const tag = document.querySelector('.tag');
      tag.textContent = `This week: ${r.totals.blocked.toLocaleString()} tracker${r.totals.blocked === 1 ? '' : 's'} blocked · `;
      tag.append(el('a', { href: 'lethe://report', textContent: 'View privacy report', style: 'color:inherit;text-decoration:underline' }));
    }
  } catch { /* keep the default line */ }
  $('q').focus();
})();
