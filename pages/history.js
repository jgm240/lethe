let all = [];
async function refresh() { all = await insta.call('history:list'); render(); }
function render() {
  const q = $('filter').value.toLowerCase(), list = $('list');
  list.replaceChildren();
  const rows = all.filter(h => !q || (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q));
  if (!rows.length) return list.append(el('div', { className: 'empty', textContent: all.length ? 'No matches.' : 'No history.' }));
  let lastDay = '';
  for (const h of rows) {
    const day = new Date(h.time).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (day !== lastDay) { list.append(el('h2', { textContent: day })); lastDay = day; }
    const time = el('span', { className: 'muted', textContent: new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    time.style.width = '56px';
    const main = el('div', { className: 'main' }, el('div', { className: 'tt' }, el('a', { href: h.url, textContent: h.title || h.url })), el('div', { className: 'u', textContent: hostLabel(h.url) }));
    const del = el('button', { className: 'x', textContent: '✕', title: 'Remove' });
    del.onclick = async () => { await insta.call('history:remove', h.time); refresh(); };
    list.append(el('div', { className: 'it' }, time, main, del));
  }
}
$('filter').oninput = render;
$('clear').onclick = async () => { await insta.call('history:clear'); refresh(); };
refresh();
