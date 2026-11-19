# WP1: scaffold and test harness

**Model:** Opus. **Stage 1, runs alone.** Everything else builds on this,
and a bug in the harness would surface later inside several agents at once.

## Read first

- `docs/v1-plan/contracts.md`, all of it.
- `docs/spec.md`, sections "When something goes wrong" and "Deleting the
  original" (for the error wording).
- `AGENTS.md`.

## Files you own

`app/index.html`, `app/js/config.js`, `app/js/errors.js`, every other `app/`
file in the layout as a **stub**, `tests/run.cjs`, `tests/server.cjs`,
`tests/unit/index.html`, `tests/unit/harness.js`, `tests/e2e/helpers.cjs`,
`tests/README.md`, `tests/unit/errors.test.js`, `tests/e2e/smoke.e2e.cjs`,
and one line in `.gitignore` (`tests/out/`).

`tests/out/` is the scratch folder for every agent, you included. Create it.

## Build

1. **`app/index.html`** exactly as contracts section 4, including the start
   guard: write that inline script (about 25 lines, no imports, plain DOM
   methods and `textContent`).
2. **`app/js/config.js`** exactly as contracts section 3.
3. **Stubs** for every other file in the layout, so nothing 404s:
   - JS modules: a first-line comment `// stub: owned by WPn`, plus exports
     with the names in contracts section 5 that throw
     `new Error('not built yet: <name>')` when called. `app.js` is the one
     exception: its stub only sets `window.__jdReady = true` (which is also
     what the real one does under `__jdTest.noBoot`).
   - `sw.js`: first line `const BUILD = 'dev';`, then a comment. No handlers.
   - CSS files: a comment. `manifest.webmanifest`: `{}`. Don't create icons.
4. **`app/js/errors.js`** per contracts section 5 (read its bullets: this
   file also loads in the service worker).
   - One catalogue entry per code, each with `title`, `body`, `next`. Plain
     words, no jargon, lowercase working labels. The body names the file or
     page from `ctx` ("“notes.png” isn't an HTML file").
   - `detail` is multi-line `key: value` text, without the environment.
   - `environmentDetail()` reports what contracts lists. Each line is
     gathered in its own `try`; a failure prints `unknown` for that line. To
     read settings it imports `db.js` **dynamically inside the function**
     (`await import('./db.js')`), never at the top of the file: `db.js`
     imports `errors.js`, and in stage 1 `db.js` is a stub.
   - What each message must tell the owner:

     | Code | The message says |
     | --- | --- |
     | `wrong-type` | the file isn't an HTML file; Junk Drawer takes `.html` or `.htm` |
     | `mhtml` | the file is a web archive (MHTML), which Junk Drawer can't use; download or save the page as HTML instead |
     | `unreadable` | the phone wouldn't let Junk Drawer read the file; try picking it again |
     | `empty` | the file is empty |
     | `not-html` | the file is named like a web page but its contents aren't HTML |
     | `storage-full` | there isn't enough storage left on this phone to keep a copy; free some space and try again; nothing was changed |
     | `page-missing` | Junk Drawer's copy of this page is missing; replace its file from the library to get it back; its saved data is still there |
     | `page-unreadable` | Junk Drawer couldn't load its copy of this page; go back and open it again |
     | `store-refused` | the phone refused to save this page's data; what you just did in the page may not be remembered; free some space |
     | `delete-failed` | the downloaded file is still on the phone; Junk Drawer couldn't delete it and won't offer to again on this phone (the footer can turn the offer back on); the page was added |
     | `delete-denied` | the downloaded file is still on the phone because permission wasn't given; the page was added |
     | `picker-failed` | the file picker didn't open; tap "add new page" again |
     | `sw-failed` | Junk Drawer couldn't set itself up to work offline and open pages; close it and open it again while connected |
     | `unexpected` | something went wrong inside Junk Drawer; copy the details for an agent |
5. **`tests/server.cjs`**: a static file server on Node's `http`, no
   dependencies. Exports `start() -> { url, appUrl, setBuild(b), override(path, body), reset(), listAppFiles(), close() }`.
   The runner starts **one server per test** (they're cheap) and closes it
   after, so parallel tests never share a build stamp or overrides.
   - Listens on port 0. Serves the repo root; correct `Content-Type` for
     `.html .js .css .json .webmanifest .svg .png`; `Cache-Control: no-cache`.
   - `setBuild('t2')`: `app/sw.js` is served with its first line's `'dev'`
     replaced. `setBuild(null)` serves it untouched. Default `'t1'`.
   - `override('app/js/x.js', body)` serves `body` for that path (simulates a
     deploy); `reset()` clears overrides and the build back to `'t1'`.
   - `listAppFiles()`: every file under `app/`, as paths relative to `app/`.
6. **`tests/run.cjs`** per contracts section 8.
   - Discovers `tests/unit/*.test.js` and `tests/e2e/*.e2e.cjs`.
   - `--only <text>` filters by **file name** only (comma-separated values
     allowed), never by test name.
   - Unit: one fresh context per file; open
     `<url>/tests/unit/index.html?file=<name>`; wait for `window.__done`,
     30 s at most.
   - E2E: one fresh context and one server per test; 20 s timeout per test.
   - Run up to four test files at a time (tests inside a file run in
     order). Launch the browser once.
   - Stop early after 10 failed tests or 8 minutes of wall time, and still
     print the result line, ending `(stopped early: <why>)`.
   - Collects uncaught page errors and `console.error` lines per test and
     appends up to 5 of them to that test's failure output.
   - A failing test prints `FAIL <file>: <test name>` and then at most 12
     lines of its error. Prints nothing for passing tests unless
     `--verbose`. Last line is `RESULT: PASS n/n (<seconds>s)` or
     `RESULT: FAIL f/n (<seconds>s)`. Always closes the browser and servers,
     also on a crash.
   - `--only`, `--unit`, `--e2e`, `--verbose`.
7. **`tests/unit/harness.js`**: `test(name, fn)`, `assert(cond, msg)`,
   `eq(actual, expected, msg)` (deep, via JSON for objects), `rejects(promise, check)`.
   `index.html` imports the file named in `?file=`, runs the tests in order
   and sets `window.__done = { results: [{ name, ok, error }] }`. An import
   failure is reported as one failed test.
8. **`tests/e2e/helpers.cjs`**, used as `t.helpers` and by `t.openApp()`:
   - `openApp(context, appUrl, { boot = true } = {}) -> page`: with
     `boot: false`, first adds an init script setting
     `globalThis.__jdTest = { noBoot: true }` (keep any other `__jdTest`
     keys a test sets). Opens the app and waits for `window.__jdReady`, 10 s
     at most. `t.openApp(opts)` calls it with the test's context and URL.
   - `ensureWorker(page)`: registers `sw.js` the way contracts section 6
     says, if it isn't already, and waits for `navigator.serviceWorker.ready`
     and for the worker to control the page.
   - `seedPage(page, { name, html, fileName, tags, pinned, openCount, addedAt, lastOpenedAt }) -> PageRecord`:
     calls `db.addPage` in the page, then `db.updatePage`/a direct put for the
     extra fields, then dispatches `libraryChanged`.
   - `setNextPick(page, { name, html | bytes, type, withHandle, removeFails })`:
     sets `globalThis.__jdTest.pickFile`. With `withHandle`, the fake handle
     has `requestPermission()` and `remove()`, and records calls on
     `__jdTest.handleLog`.
   - `viewerFrame(page) -> Frame` (the frame whose URL contains `/p/`).
   - `dbDump(page) -> { pages, files: [{ id, size }], local, settings, databases }`.
   - `realStorageKeys(page) -> { local: string[], session: string[] }`: the
     real `localStorage` and `sessionStorage` key lists of the app window.
9. **`tests/README.md`**: how to run, the helper list, the rules from
   contracts section 8. Under 80 lines.

## Tests you write

- `tests/unit/errors.test.js`: every code has a non-empty title and body;
  `describe` includes the file name in `body` and file name, type and size in
  `detail`; a plain `TypeError` is described as `unexpected` and its message
  is in `detail`.
- `tests/e2e/smoke.e2e.cjs`: the app opens under `/app/` and `__jdReady`
  becomes true, with `boot: false` and without; no request made by the app
  starts outside `/app/` (proves relative URLs); the start guard shows its
  message when `app.js` is overridden with a script that throws (use
  Playwright's clock or wait the 8 s), and stays hidden on a normal start;
  `setNextPick` works: after it, calling `globalThis.__jdTest.pickFile()` in
  the page returns a `File` with the given name and contents, and with
  `withHandle` a handle whose `remove()` is recorded in `handleLog` and
  rejects when `removeFails` is set.

## Done when

`node tests/run.cjs` prints `RESULT: PASS`; a deliberately broken test (try
it, then remove it) prints a `FAIL <file>: <name>` line with a capped error
and exits non-zero; and a test that never finishes (try it, then remove it)
is cut off at 20 s rather than hanging the run. `seedPage` and `dbDump`
can't be tested until `db.js` exists; WP3 tests them in stage 2.
