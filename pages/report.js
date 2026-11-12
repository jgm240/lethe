async function load() {
  const r = await lethe.call('stats:report', 7);
  const T = r.totals;
  $('sub').textContent = r.enabled ? 'What Lethe kept off you over the last 7 days. Stored on this device only.' : 'The report is switched off (Settings → Privacy). Nothing new is being counted.';
  const stat = (n, label) => el('div', { className: 'stat' }, el('b', { textContent: n.toLocaleString() }), el('span', { textContent: label }));
  $('grid').replaceChildren(stat(T.blocked, 'tracker requests blocked'), stat(T.upgrades, 'connections upgraded to HTTPS'), stat(T.params, 'tracking links cleaned'), stat(T.popups, 'cookie pop-ups handled'), stat(T.cookies, 'third-party cookies refused'), stat(T.ejects, 'times you ejected to Lethe'));
  const max = Math.max(1, ...r.days.map(d => d.blocked)), bars = $('bars'); bars.replaceChildren();
  for (const d of r.days) {
    const day = new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    const i = el('i'); i.style.height = Math.max(3, d.blocked / max * 100) + '%';
    bars.append(el('div', { className: 'bar', title: `${d.date}: ${d.blocked} blocked` }, el('em', { textContent: d.blocked || '' }), i, el('small', { textContent: day })));
  }
  const top = $('top'); top.replaceChildren();
  if (!r.top.length) top.append(el('tr', {}, el('td', { textContent: 'No trackers blocked yet this week.' }), el('td')));
  const m = Math.max(1, ...r.top.map(x => x.count));
  for (const x of r.top) { const bar = el('div', { className: 'meter' }, el('i')); bar.firstChild.style.width = x.count / m * 100 + '%'; top.append(el('tr', {}, el('td', {}, el('div', { textContent: x.host }), bar), el('td', { textContent: x.count.toLocaleString() }))); }
}
$('clear').onclick = async () => { await lethe.call('stats:clear'); load(); };
load();
