const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https') ? https : http;
    const req = lib.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBreaker/1.0; RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9,pt;q=0.8',
      },
      timeout: 12000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const peek = buf.slice(0, 500).toString('utf-8');
        const contentType = res.headers['content-type'] || '';
        const isLatin = /iso-8859-1|windows-1252|latin/i.test(peek + contentType);
        const text = isLatin ? buf.toString('latin1') : buf.toString('utf-8');
        resolve({ text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', cache: cache.size, uptime: process.uptime() }));
  }

  if (parsed.pathname === '/fetch') {
    const targetUrl = parsed.query.url;
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid or missing url' }));
    }

    const cached = cache.get(targetUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'X-Cache': 'HIT' });
      return res.end(cached.text);
    }

    try {
      const { text } = await fetchUrl(targetUrl);
      cache.set(targetUrl, { text, timestamp: Date.now() });
      if (cache.size > 500) {
        [...cache.entries()].sort((a,b)=>a[1].timestamp-b[1].timestamp).slice(0,100).forEach(e=>cache.delete(e[0]));
      }
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'X-Cache': 'MISS' });
      return res.end(text);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`NewsBreaker RSS Proxy on port ${PORT}`));
