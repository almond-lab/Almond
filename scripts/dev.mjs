import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { handleQuantum } from '../server/quantum-service.mjs';
import { handleXFeed } from '../server/x-feed-service.mjs';
import './build.mjs';

const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.otf': 'font/otf' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:3000');
    if (['/api/quantum', '/api/x-feed'].includes(url.pathname)) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 32_768) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'The circuit request exceeds 32 KB.' })); return; }
      }
      const handler = url.pathname === '/api/quantum' ? handleQuantum : handleXFeed;
      const response = await handler(new Request(url, { method: req.method, headers: req.headers, ...(!['GET','HEAD'].includes(req.method) ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const file = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(3000, '127.0.0.1', () => console.log('Almond frontend and API: http://127.0.0.1:3000'));
