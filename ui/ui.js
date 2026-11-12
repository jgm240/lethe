const $ = id => document.getElementById(id);
const I = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  forward: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 9v4M12 16v.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.8 2 1.6 2.4C10.2 8.5 10.8 5.5 12 3z"/></svg>',
  bookmarks: '<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
};
if (lin.platform === 'darwin') document.body.classList.add('mac');
$('back').innerHTML = I.back; $('forward').innerHTML = I.forward; $('reload').innerHTML = I.reload;
$('star').innerHTML = I.star; $('fire').innerHTML = I.fire; $('bookmarks').innerHTML = I.bookmarks; $('menu').innerHTML = I.menu;

let last = null, prevFind = false;
const addr = $('address');

function render(s) {
  last = s;
  const box = $('tabs');
  box.innerHTML = '';
  for (const t of s.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === s.activeId ? ' active' : '') + (t.loading ? ' loading' : '');
    const icon = t.favicon ? Object.assign(document.createElement('img'), { src: t.favicon }) : Object.assign(document.createElement('span'), { className: 'ph' });
    const title = Object.assign(document.createElement('span'), { className: 'title', textContent: t.title || 'New Tab' });
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '✕', title: 'Close Tab' });
    x.onclick = e => { e.stopPropagation(); lin.cmd('close-tab', t.id); };
    el.append(icon, title, x);
    el.onclick = () => lin.cmd('select-tab', t.id);
    el.onauxclick = e => { if (e.button === 1) lin.cmd('close-tab', t.id); };
    box.append(el);
  }
  $('back').disabled = !s.canGoBack;
  $('forward').disabled = !s.canGoForward;
  $('reload').innerHTML = s.loading ? I.stop : I.reload;
  $('shield').classList.toggle('insecure', !s.secure || !s.protectedSite);
  $('lock').innerHTML = s.secure || !s.url ? I.shield : I.warn;
  $('blocked').textContent = s.blocked ? s.blocked : '';
  $('star').classList.toggle('on', s.bookmarked);
  if (document.activeElement !== addr) addr.value = s.url;
  $('findbar').hidden = !s.findOpen;
  if (s.findOpen && !prevFind) { $('findinput').focus(); $('findinput').select(); }
  prevFind = s.findOpen;
}

lin.onState(render);
lin.onFocusAddress(() => { addr.focus(); addr.select(); });
lin.onFind(r => { $('findcount').textContent = r.total ? `${r.active} of ${r.total}` : ($('findinput').value ? 'No matches' : ''); });

$('back').onclick = () => lin.cmd('back');
$('forward').onclick = () => lin.cmd('forward');
$('reload').onclick = () => lin.cmd('reload');
$('newtab').onclick = () => lin.cmd('new-tab');
$('fire').onclick = () => lin.cmd('fire');
$('star').onclick = () => lin.cmd('bookmark');
$('shield').onclick = () => lin.cmd('menu', 'shield');
$('bookmarks').onclick = () => lin.cmd('menu', 'bookmarks');
$('menu').onclick = () => lin.cmd('menu', 'main');

let sugTimer;
addr.addEventListener('input', () => {
  clearTimeout(sugTimer);
  sugTimer = setTimeout(() => { const r = $('omni').getBoundingClientRect(); lin.cmd('suggest', { text: addr.value, x: r.left, w: r.width }); }, 70);
});
addr.addEventListener('keydown', e => {
  if (e.key === 'Enter') { lin.cmd('navigate', addr.value); addr.blur(); }
  else if (e.key === 'Escape') { lin.cmd('suggest-hide'); addr.value = last ? last.url : ''; addr.blur(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); lin.cmd('suggest-move', 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); lin.cmd('suggest-move', -1); }
});
addr.addEventListener('blur', () => setTimeout(() => lin.cmd('suggest-hide'), 160));
lin.onFill(t => { addr.value = t; });
lin.onTheme(t => {
  for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty('--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), v);
  document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
});
addr.addEventListener('focus', () => addr.select());

const fi = $('findinput');
fi.addEventListener('input', () => lin.cmd('find', { text: fi.value, fresh: true }));
fi.addEventListener('keydown', e => {
  if (e.key === 'Enter') lin.cmd('find', { text: fi.value, forward: !e.shiftKey });
  if (e.key === 'Escape') lin.cmd('find-close');
});
$('findnext').onclick = () => lin.cmd('find', { text: fi.value, forward: true });
$('findprev').onclick = () => lin.cmd('find', { text: fi.value, forward: false });
$('findclose').onclick = () => lin.cmd('find-close');

lin.cmd('ready');
