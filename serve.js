const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const PORT = process.env.MEOOW_SITE_PORT || 8787;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.exe': 'application/octet-stream',
};

http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400); res.end('400'); return;
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Meoow site: http://127.0.0.1:' + PORT));