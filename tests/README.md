# Tests

No framework, nothing installed: Node plus `require('playwright')` (present
in Claude's cloud sessions). Headless Chromium is launched once.

```
node tests/run.cjs                     # everything
node tests/run.cjs --only db,helpers   # test FILES whose name contains any of these
node tests/run.cjs --unit | --e2e      # one kind only; --verbose lists passes too
```

- Run it with a **10-minute command timeout** (600000 ms on the Bash tool).
- Output: `FAIL <file>: <test name>` per failing test, at most 12 lines of its
  error, then up to 5 uncaught page errors or `console.error` lines from that
  test. Last line: `RESULT: PASS n/n (12s)` or `RESULT: FAIL f/n (12s)`. Exit
  code 0 only on PASS.
- Limits: 30 s per unit file, 20 s per e2e test, four files at a time (tests
  in a file run in order). It stops early after 10 failures or 8 minutes and
  then ends `(stopped early: <why>)`.
- Each unit file and e2e test gets a fresh context (empty storage, 412 by
  915) and its own server.

## The server (`server.cjs`)

Serves the repo root on a free port, `Cache-Control: no-cache`; the app is at
`/app/`, which also proves relative URLs. `start()` returns
`{ url, appUrl, setBuild(b), override(path, body), reset(), listAppFiles(), close() }`.

- `app/sw.js` is served with `'dev'` on its first line replaced by the build,
  `t1` by default. `setBuild('t2')` changes it; `setBuild(null)` serves it as is.
- `override('app/js/x.js', body)` serves `body` verbatim for that path (a
  deploy); `reset()` clears overrides and sets the build back to `t1`.
- `listAppFiles()`: every file under `app/`, relative to `app/`, sorted.

## Unit tests: `tests/unit/<name>.test.js`

Browser ES modules, loaded by `unit/index.html?file=<name>.test.js`.

```js
import { test, assert, eq, rejects } from './harness.js';
import { matchKey } from '../../app/js/model.js';
test('matchKey ignores case', () => eq(matchKey('Foo.HTML'), 'foo'));
```

`eq` compares objects through JSON. `rejects(promiseOrFn, check)`: `check` is
a function (`false` or a throw fails), a string (`err.code`, or text in
`err.message`) or an error class; returns the error.

## E2E tests: `tests/e2e/<name>.e2e.cjs`

`module.exports = [{ name, run: async (t) => { … } }, …]`, where `t` is
`{ context, server, appUrl, openApp(opts), helpers }`.

- `t.openApp({ boot = true })` opens the app, waits for `__jdReady` (10 s).
  `boot: false` sets `__jdTest.noBoot` first so `app.js` does nothing; call
  the `init…()` you need. Only `journey` and `update` use the real boot.
- `helpers.ensureWorker(page)`: registers `sw.js` as `app.js` would, waits
  until it is ready and controls the page.
- `helpers.seedPage(page, { name, html, fileName, tags, pinned, openCount, addedAt, lastOpenedAt })`
  adds a page through `db.js`, sets the extra fields, dispatches
  `libraryChanged`, returns the `PageRecord`.
- `helpers.setNextPick(page, { name, html | bytes, type, withHandle, removeFails, permission })`:
  every later `__jdTest.pickFile()` returns `{ file, handle }` with a fresh
  `File` (default name `page.html`, type `text/html`). `withHandle` adds a fake
  handle whose `queryPermission`/`requestPermission` (answer: `permission`,
  default `'granted'`) and `remove()` calls go into `__jdTest.handleLog`;
  `removeFails` makes `remove()` reject with `NoModificationAllowedError`.
- `helpers.viewerFrame(page)`: the frame whose URL contains `/p/`, or `null`.
- `helpers.dbDump(page)`: `{ pages, files: [{ id, size, charset }], local, settings, databases }`
  read straight from IndexedDB (`settings` as key to value).
- `helpers.realStorageKeys(page)`: `{ local, session }`, the window's real
  `localStorage`/`sessionStorage` keys (they must stay empty).

## Rules

- Fixtures live in your own test file; never use files from `local/`.
- Route other sites (`context.route('https://example.test/**', …)`): nothing
  may depend on the real internet. No fixed ports; leave nothing running.
- Scratch files go in `tests/out/`. `helpers.cjs` is frozen after stage 2.
