const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.flac': 'audio/flac', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg'
};

function createStaticServer(root, resolveAsset = () => null) {
  const base = path.resolve(root);
  return http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end('Bad request'); return; }

    if (pathname.startsWith('/media/')) {
      const id = pathname.slice('/media/'.length);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { res.writeHead(404).end('Not found'); return; }
      const resource = resolveAsset(id);
      if (!resource) { res.writeHead(404).end('Not found'); return; }
      serveResource(req, res, resource);
      return;
    }

    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(base, requested);
    const relative = path.relative(base, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Referrer-Policy': 'strict-origin', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  });
}

function serveResource(req, res, resource) {
  const file = resource.path;
  const contentType = resource.contentType || mime[path.extname(file || '').toLowerCase()] || 'application/octet-stream';
  const baseHeaders = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (resource.buffer) {
    const buffer = resource.buffer;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${buffer.length}` }).end(); return; }
      let start = match[1] ? Number(match[1]) : null;
      let end = match[2] ? Number(match[2]) : null;
      if (start === null) { start = Math.max(0, buffer.length - end); end = buffer.length - 1; }
      else if (end === null) end = buffer.length - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= buffer.length) { res.writeHead(416, { 'Content-Range': `bytes */${buffer.length}` }).end(); return; }
      end = Math.min(end, buffer.length - 1);
      res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${buffer.length}` });
      if (req.method === 'HEAD') res.end(); else res.end(buffer.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...baseHeaders, 'Content-Length': buffer.length });
    if (req.method === 'HEAD') res.end(); else res.end(buffer);
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      let start = match[1] ? Number(match[1]) : null;
      let end = match[2] ? Number(match[2]) : null;
      if (start === null) { const suffix = end; start = Math.max(0, stat.size - suffix); end = stat.size - 1; }
      else if (end === null) end = stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}

module.exports = { createStaticServer, serveResource };
