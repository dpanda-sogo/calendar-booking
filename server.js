/**
 * Local development server — mirrors Vercel's routing without needing CLI auth.
 * Usage: node server.js
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    });
  console.log('[dev] Loaded .env');
} else {
  console.warn('[dev] No .env found — API calls will fail without credentials');
}

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// Build a minimal req/res shim that the Vercel handler functions expect
function buildShim(req, body, parsedUrl, rawRes) {
  // req shim
  const shimReq = Object.assign(Object.create(req), {
    method:  req.method,
    headers: req.headers,
    query:   Object.fromEntries(new URLSearchParams(parsedUrl.query || '')),
    body:    body,
  });

  // res shim
  let headersSent = false;
  const shimRes = {
    _status: 200,
    _headers: { 'Access-Control-Allow-Origin': '*' },
    status(code) { this._status = code; return this; },
    setHeader(k, v) { this._headers[k] = v; return this; },
    json(obj) {
      if (!headersSent) {
        headersSent = true;
        this._headers['Content-Type'] = 'application/json';
        rawRes.writeHead(this._status, this._headers);
        rawRes.end(JSON.stringify(obj));
      }
    },
    end(data) {
      if (!headersSent) {
        headersSent = true;
        rawRes.writeHead(this._status, this._headers);
        rawRes.end(data || '');
      }
    },
  };
  return { shimReq, shimRes };
}

const server = http.createServer(function (req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // API routes
  if (pathname === '/api/availability' || pathname === '/api/book') {
    let rawBody = '';
    req.on('data', function (chunk) { rawBody += chunk; });
    req.on('end', function () {
      let parsedBody = {};
      try { parsedBody = JSON.parse(rawBody || '{}'); } catch (_) {}

      const handlerPath = path.join(__dirname, pathname + '.js');
      let handler;
      try {
        // Clear require cache so edits are picked up on each request
        delete require.cache[require.resolve(handlerPath)];
        handler = require(handlerPath);
      } catch (err) {
        console.error('[dev] Failed to load handler', handlerPath, err.message);
        return sendJson(res, 500, { error: 'handler_load_failed', detail: err.message });
      }

      const { shimReq, shimRes } = buildShim(req, parsedBody, parsedUrl, res);
      Promise.resolve()
        .then(function () { return handler(shimReq, shimRes); })
        .catch(function (err) {
          console.error('[dev] Handler threw', err.message);
          if (!res.writableEnded) sendJson(res, 500, { error: 'internal', detail: err.message });
        });
    });
    return;
  }

  // Static files
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else {
    filePath = path.join(__dirname, pathname);
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

function listen(port) {
  server.listen(port, function () {
    console.log('');
    console.log('  Sogolytics Demo Booking — local dev server');
    console.log('  ─────────────────────────────────────────');
    console.log('  http://localhost:' + port);
    console.log('');
    console.log('  API routes:');
    console.log('    GET  /api/availability?region=us&date=YYYY-MM-DD&timezone=...');
    console.log('    POST /api/book');
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}

server.on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    var next = (server._port || PORT) + 1;
    server._port = next;
    console.warn('[dev] Port ' + (next - 1) + ' in use, trying ' + next + '...');
    server.close();
    listen(next);
  } else {
    throw err;
  }
});

server._port = PORT;
listen(PORT);
