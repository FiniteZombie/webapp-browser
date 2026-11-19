'use strict';
// Static file server for the tests. No dependencies. One instance per test.
//
//   const { start } = require('./server.cjs');
//   const s = await start();   // { url, appUrl, setBuild, override, reset, listAppFiles, close }

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const DEFAULT_BUILD = 't1';
const SW_PATH = 'app/sw.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function typeFor(p) {
  return TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function walk(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, base, out);
    else if (ent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function stampBuild(text, build) {
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  const rest = nl === -1 ? '' : text.slice(nl);
  return first.replace("'dev'", `'${build}'`) + rest;
}

function start() {
  let build = DEFAULT_BUILD;
  const overrides = new Map();

  const send = (res, status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    } catch {
      return send(res, 400, 'text/plain', 'bad request');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain', 'method not allowed');
    }
    const norm = path.posix.normalize(rel || '.');
    if (norm.startsWith('..') || path.isAbsolute(norm)) return send(res, 403, 'text/plain', 'forbidden');

    let key = norm === '.' ? '' : norm;
    let full = path.join(ROOT, key);
    let isDir = false;
    try { isDir = fs.statSync(full).isDirectory(); } catch { /* not there */ }
    if (isDir) {
      if (!req.url.split('?')[0].endsWith('/')) {
        res.writeHead(301, { Location: `/${key}/`, 'Cache-Control': 'no-cache' });
        return res.end();
      }
      key = key ? `${key}/index.html` : 'index.html';
      full = path.join(ROOT, key);
    }

    if (overrides.has(key)) return send(res, 200, typeFor(key), overrides.get(key));

    fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, 'text/plain; charset=utf-8', `not found: /${key}`);
      let body = data;
      if (key === SW_PATH && build !== null) body = stampBuild(data.toString('utf8'), build);
      send(res, 200, typeFor(key), body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/`;
      resolve({
        url,
        appUrl: `${url}app/`,
        setBuild(b) { build = b; },
        override(p, body) { overrides.set(String(p).replace(/^\/+/, ''), body); },
        reset() { overrides.clear(); build = DEFAULT_BUILD; },
        listAppFiles() { return walk(APP, APP, []).sort(); },
        close() {
          return new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          });
        },
      });
    });
  });
}

module.exports = { start };
