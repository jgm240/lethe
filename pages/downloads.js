const mb = n => (n / 1048576).toFixed(1) + ' MB';
async function refresh() {
  const rows = await lethe.call('downloads:list'), list = $('list');
  list.replaceChildren();
  if (!rows.length) return list.append(el('div', { className: 'empty', textContent: 'No downloads.' }));
  for (const d of rows) {
    const status = d.state === 'progressing' ? `${mb(d.received)} of ${d.total ? mb(d.total) : '?'}` : d.state === 'completed' ? mb(d.received) : d.state;
    const main = el('div', { className: 'main' }, el('div', { className: 'tt', textContent: d.name }), el('div', { className: 'u', textContent: status + ' · ' + hostLabel(d.url) }));
    const show = el('button', { className: 'btn', textContent: 'Show in folder' });
    show.onclick = () => lethe.call('downloads:show', d.id);
    show.disabled = !d.path;
    list.append(el('div', { className: 'it' }, main, show));
  }
}
$('clear').onclick = async () => { await lethe.call('downloads:clear'); refresh(); };
refresh(); setInterval(refresh, 1500);
