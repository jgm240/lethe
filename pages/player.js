(async () => {
  const q = new URLSearchParams(location.search);
  const id = q.get('v') || '';
  if (!/^[\w-]{11}$/.test(id)) {
    $('root').replaceChildren(el('div', { className: 'err', textContent: 'That doesn’t look like a valid YouTube video.' }));
    return;
  }
  const start = parseInt(q.get('start') || '0', 10) || 0;
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1` + (start ? `&start=${start}` : '');
  const f = el('iframe', { src, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true, title: 'Lethe Player' });
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  $('stage').append(f);
  $('yt').href = `https://www.youtube.com/watch?v=${id}&lethe_np=1` + (start ? `&t=${start}s` : '');
  const d = await lethe.call('getSettings');
  $('pm').value = d.settings.player.mode;
  $('pm').onchange = () => lethe.call('setSetting', { key: 'player.mode', value: $('pm').value });
  const meta = await lethe.call('player:meta', id);
  if (meta) { $('title').textContent = meta.title; $('by').textContent = meta.author; document.title = meta.title + ' — Lethe Player'; }
})();
