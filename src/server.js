// Tiny loopback-only static server for the browser's internal pages (settings, new tab, player...).
// Serving over http://127.0.0.1 (instead of file://) gives the InstaOlvidar Player a real HTTP origin,
// which YouTube's privacy-enhanced embed requires.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };

function startServer(root) {
  return new Promise(resolve => {
    let port = 0;
    const srv = http.createServer((req, res) => {
      if (req.headers.host !== `127.0.0.1:${port}` || req.method !== 'GET') { res.writeHead(403); return res.end(); } // blocks DNS rebinding
      let p;
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
      let file = null;
      if (/^\/[\w-]+\.(html|css|js)$/.test(p)) file = path.join(root, 'pages', path.basename(p));
      else if (/^\/backgrounds\/[\w-]+\.jpg$/.test(p)) file = path.join(root, 'backgrounds', path.basename(p));
      else if (p === '/icon.png') file = path.join(root, 'build', 'icon.png');
      if (!file) { res.writeHead(404); return res.end('Not found'); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => { port = srv.address().port; resolve({ server: srv, port, origin: `http://127.0.0.1:${port}` }); });
  });
}
module.exports = { startServer };
