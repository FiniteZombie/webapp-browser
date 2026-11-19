const BUILD = 'dev';
// Junk Drawer's service worker (WP7). A module worker: contracts section 6.
// The deploy workflow (and the test server) replaces 'dev' above with a build.

import { CACHE_PREFIX, PAGE_PATH, BUILD_PATH, HOST_GLOBAL, PAGE_DB_PREFIX, LOCAL_QUOTA_CHARS } from './js/config.js';
import { getFile } from './js/db.js';
import { buildPageParts, escapeForInlineScript } from './js/inject.js';
import { pageShim } from './js/page-shim.js';

// Every file under app/ except sw.js, relative to the scope, plus './'.
// A test checks this against the files on disk.
const SHELL = [
  './',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
  'index.html',
  'js/add-flow.js',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/errors.js',
  'js/html-check.js',
  'js/inject.js',
  'js/library.js',
  'js/model.js',
  'js/page-shim.js',
  'js/picker.js',
  'js/ui.js',
  'js/viewer.js',
  'manifest.webmanifest',
  'styles/base.css',
  'styles/library.css',
  'styles/viewer.css',
];

const STAMPED = BUILD !== 'dev';
const CURRENT = CACHE_PREFIX + BUILD;
const PAGE_ID_RE = /^([^/]+)\/$/;

const scope = () => self.registration.scope;

// ---- lifecycle ----

// Each file is fetched as <url>?v=<BUILD>: cache: 'reload' only skips the
// browser's HTTP cache, and a CDN edge (GitHub Pages' Fastly) can still hold
// the old copy of a plain URL for minutes after a deploy. The query is a URL
// the edge hasn't seen. The response is stored under the plain URL, so
// lookups match without the query.
async function precache() {
  const responses = await Promise.all(SHELL.map(async (entry) => {
    const url = new URL(entry, scope()).href;
    const busted = new URL(url);
    busted.searchParams.set('v', BUILD);
    const res = await fetch(new Request(busted.href, { cache: 'reload' }));
    if (!res.ok) throw new Error(`precache: ${busted.href} answered ${res.status}`);
    if (res.redirected) throw new Error(`precache: ${busted.href} was redirected to ${res.url}`);
    return [url, res];
  }));
  const cache = await caches.open(CURRENT);
  try {
    for (const [url, res] of responses) await cache.put(url, res);
  } catch (err) {
    await caches.delete(CURRENT);
    throw err;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (STAMPED) await precache();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CURRENT)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ---- responses ----

function errorDocument(pageId, code, detail, status) {
  const call = `parent[${escapeForInlineScript(HOST_GLOBAL)}].pageError(`
    + `${escapeForInlineScript(pageId)}, ${escapeForInlineScript(code)}, ${escapeForInlineScript(detail)})`;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Junk Drawer</title></head><body>'
    + '<p>Junk Drawer couldn\'t load this page.</p>'
    + `<script>try { ${call}; } catch (e) {}</script>`
    + '</body></html>\n';
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function pageDocument(pageId) {
  let file;
  try {
    file = await getFile(pageId);
  } catch (err) {
    const detail = `${err && err.name}: ${err && err.message}`;
    return errorDocument(pageId, 'page-unreadable', detail, 500);
  }
  if (!file) return errorDocument(pageId, 'page-missing', `no stored file for page ${pageId}`, 404);
  const boot = {
    pageId,
    hostGlobal: HOST_GLOBAL,
    dbPrefix: PAGE_DB_PREFIX + pageId + ':',
    quotaChars: LOCAL_QUOTA_CHARS,
  };
  let body;
  try {
    body = new Blob(buildPageParts(file.bytes, pageShim.toString(), boot));
  } catch (err) {
    const detail = `${err && err.name}: ${err && err.message}`;
    return errorDocument(pageId, 'page-unreadable', detail, 500);
  }
  const type = file.charset == null ? 'text/html' : `text/html; charset=${file.charset}`;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
  });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function stampedAppFile(request, url) {
  const cache = await caches.open(CURRENT);
  const rootPath = new URL(scope()).pathname;
  const isIndex = url.pathname === rootPath || url.pathname === rootPath + 'index.html';
  const key = request.mode === 'navigate' && isIndex ? new URL('index.html', scope()).href : request;
  const hit = await cache.match(key, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

async function devAppFile(event) {
  const { request } = event;
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      event.waitUntil(caches.open(CURRENT).then((c) => c.put(request, copy)).catch(() => {}));
    }
    return res;
  } catch {
    const cache = await caches.open(CURRENT);
    const hit = await cache.match(request, { ignoreSearch: true });
    return hit || Response.error();
  }
}

async function handle(event, url) {
  const root = scope();
  if (url.href.split('?')[0] === new URL(BUILD_PATH, root).href) {
    return new Response(JSON.stringify({ build: BUILD }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const pageBase = new URL(PAGE_PATH, root).pathname;
  if (url.pathname.startsWith(pageBase)) {
    const m = PAGE_ID_RE.exec(url.pathname.slice(pageBase.length));
    if (!m) return notFound();
    let pageId;
    try { pageId = decodeURIComponent(m[1]); } catch { return notFound(); }
    return pageDocument(pageId);
  }
  return STAMPED ? stampedAppFile(event.request, url) : devAppFile(event);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scope())) return;
  event.respondWith(handle(event, url).catch((err) => new Response(
    `Junk Drawer's service worker failed: ${err && err.name}: ${err && err.message}`,
    { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
  )));
});
