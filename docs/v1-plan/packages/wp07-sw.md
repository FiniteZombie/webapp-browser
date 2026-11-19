# WP7: service worker

**Model:** Opus. **Stage 3, parallel.** Needs WP3 (`db.js`) and WP4
(`inject.js`, `page-shim.js`), which are done.

## Read first

- `docs/v1-plan/contracts.md`: sections 1, 2, 3, 5 (`db.js`, `inject.js`,
  `page-shim.js`, host object), 6, 8, 9.
- `docs/spec.md`: "Platform" (the last two bullets) and "Viewing a page".
- `AGENTS.md`: "Stack".
- `app/js/config.js`, `tests/README.md`. Read `app/js/inject.js` for its
  exports only; don't read `page-shim.js` or `db.js` beyond their export
  lines.

## Files you own

`app/sw.js`, `tests/e2e/sw.e2e.cjs`.

## Build

`app/sw.js` is a **module** worker. Line 1 stays exactly
`const BUILD = 'dev';`. It imports from `./js/config.js`, `./js/db.js`,
`./js/inject.js` and `./js/page-shim.js`. Follow contracts section 6 for the
fetch order and lifecycle. Details:

- **`SHELL`**: an explicit array of every file under `app/` except `sw.js`,
  as paths relative to the scope, plus `'./'`. A test keeps it honest.
- **Install (stamped):** open `CACHE_PREFIX + BUILD`; fetch every entry with
  `new Request(url, { cache: 'reload' })`; if any response isn't `ok`, fail
  the install (the old worker keeps serving). Then `skipWaiting()`.
  **Install (`dev`):** just `skipWaiting()`.
- **Activate:** delete caches that start with `CACHE_PREFIX` and aren't the
  current one; touch no other cache; `clients.claim()`.
- **Page document:** compute the page base as
  `new URL(PAGE_PATH, self.registration.scope)`. Match
  `<base><pageId>/` exactly (one path segment, trailing slash, any query).
  `boot = { pageId, hostGlobal: HOST_GLOBAL, dbPrefix: PAGE_DB_PREFIX + pageId + ':', quotaChars: LOCAL_QUOTA_CHARS }`.
- **Error document:** a tiny standalone HTML page (no shim) with a plain
  sentence ("Junk Drawer couldn't load this page") and an inline script that
  calls `parent[HOST_GLOBAL].pageError(pageId, code, detail)` in a `try`.
  Build its script with the same escaping as `inlineScript`
  (`JSON.stringify` with `<` and non-ASCII escaped). `Cache-Control: no-store`.
- **App files, stamped:** `caches.open(current).match(request, { ignoreSearch: true })`;
  on a miss, `fetch(request)`. Navigation requests for the scope root or
  `index.html` get the cached `index.html`.
- **App files, `dev`:** `fetch(request, { cache: 'no-store' })`, put a clone
  in the `dev` cache, return it; on a network error return the cached copy,
  and if there is none let the error through.
- Never cache or touch a request outside the scope or to another origin.
- Wrap handlers so a thrown error becomes a 500 response with the message,
  not a hung request.

## Tests you write (`sw.e2e.cjs`)

`app.js` may still be a stub while you work; your tests must not depend on
the viewer. Where a page has to be shown, the test itself defines a minimal
host on the app window (an object under `HOST_GLOBAL` whose `connect`
returns `{ entries, apply, notify }` backed by a `Map`), registers the worker
if the app hasn't
(`navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' })`,
then `navigator.serviceWorker.ready`), seeds a page with `t.helpers.seedPage`
and appends an iframe pointing at `p/<id>/`.

- `__jd/build` answers the stamped build; with `server.setBuild(null)` it
  answers `dev`;
- `SHELL` matches `server.listAppFiles()` minus `sw.js` exactly (fetch
  `sw.js` as text and parse the array, or read the cache's keys after
  install);
- a stored page is served with the shim: standards mode, its own title,
  `localStorage instanceof Storage`, and the response has no charset in its
  `Content-Type`;
- **the spec's worked example:** two pages both save under the key `state`;
  one calls `localStorage.clear()`; the other's value survives, and the
  library's records are intact;
- two pages each create an IndexedDB database with the same name and don't
  see each other's data;
- a windows-1252 page with a declared charset renders its accented title
  correctly;
- an unknown page id gets the error document and the host's `pageError` is
  called with `page-missing`;
- `p/<id>/other.js` gets a 404;
- a cross-origin request from a page isn't intercepted (route
  `https://example.test/**` in the Playwright context to a canned response
  and check the page receives it);
- **offline:** after one online load, set the context offline, reload the
  app: it loads, and a stored page still opens;
- **update:** load with build `t1`; `server.setBuild('t2')` and
  `server.override('app/styles/base.css', '/* t2 */')`; call
  `registration.update()`; wait for `controllerchange`; `__jd/build` now says
  `t2`, the `t1` cache is gone, the fetched stylesheet is the new one, and a
  page seeded before the update still opens with its saved data;
- activation leaves a cache named `someone-elses-cache` alone;
- `dev` build: an overridden file is served fresh on the next request with
  no version change.

## Done when

`node tests/run.cjs --only sw` passes and the whole suite still passes.
