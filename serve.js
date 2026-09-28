/* Tiny static server so you can open the game on your phone.
   node serve.js         then browse to the address it prints
   Serves this folder on your local network only. Ctrl+C to stop. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
                '.js':'text/javascript; charset=utf-8', '.json':'application/json',
                '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(__dirname, '.' + path.posix.normalize(rel));
  if (!file.startsWith(__dirname)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                         'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = Object.values(nets).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('Kreuzungstrainer is being served.\n');
  console.log('  on this PC :  http://localhost:' + PORT + '/');
  ips.forEach(ip => console.log('  on a phone :  http://' + ip + ':' + PORT + '/   (same Wi-Fi)'));
  console.log('\nCtrl+C to stop.');
});
