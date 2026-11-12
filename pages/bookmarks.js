let all = [];
async function refresh() { all = await lethe.call('bookmarks:list'); render(); }
function render() {
  const q = $('filter').value.toLowerCase(), list = $('list');
  list.replaceChildren();
  const rows = all.filter(b => !q || (b.title || '').toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
  if (!rows.length) return list.append(el('div', { className: 'empty', textContent: all.length ? 'No matches.' : 'No bookmarks yet. Press Cmd/Ctrl+D on a page to add one.' }));
  for (const b of rows) {
    const star = el('button', { className: 'x', textContent: b.favorite ? '★' : '☆', title: 'Favorite (shows on New Tab)' });
    star.style.color = b.favorite ? 'var(--accent)' : ''; star.style.fontSize = '18px';
    star.onclick = async () => { await lethe.call('bookmarks:favorite', b.url); refresh(); };
    const main = el('div', { className: 'main' }, el('div', { className: 'tt' }, el('a', { href: b.url, textContent: b.title || b.url })), el('div', { className: 'u', textContent: b.url }));
    const del = el('button', { className: 'x', textContent: '✕', title: 'Delete' });
    del.onclick = async () => { await lethe.call('bookmarks:remove', b.url); refresh(); };
    list.append(el('div', { className: 'it' }, star, main, del));
  }
}
$('filter').oninput = render;
$('imp').onclick = async () => { const n = await lethe.call('bookmarks:import'); if (n) refresh(); };
$('exp').onclick = () => lethe.call('bookmarks:export');
refresh();
