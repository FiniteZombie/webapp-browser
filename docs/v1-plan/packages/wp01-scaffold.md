# WP1: scaffold and test harness

**Model:** Sonnet. **Stage 1, runs alone.** Everything else builds on this.

## Read first

- `docs/v1-plan/contracts.md`, all of it.
- `docs/spec.md`, section "When something goes wrong" (for the error
  wording).
- `AGENTS.md`.

## Files you own

`app/index.html`, `app/js/config.js`, `app/js/errors.js`, every other `app/`
file in the layout as a **stub**, `tests/run.cjs`, `tests/server.cjs`,
`tests/unit/index.html`, `tests/unit/harness.js`, `tests/e2e/helpers.cjs`,
`tests/README.md`, `tests/unit/errors.test.js`, `tests/e2e/smoke.e2e.cjs`,
and one line in `.gitignore` (`tests/out/`).

## Build

1. **`app/index.html`** exactly as contracts section 4.
2. **`app/js/config.js`** exactly as contracts section 3.
3. **Stubs** for every other file in the layout, so nothing 404s:
   - JS modules: a first-line comment `// stub: owned by WPn`, plus exports
     with the names in contracts section 5 that throw
     `new Error('not built yet: <name>')` when called. `app.js` is the one
     exception: its stub only sets `window.__jdReady = true`.
   - `sw.js`: first line `const BUILD = 'dev';`, then a comment. No handlers.
   - CSS files: a comment. `manifest.webmanifest`: `{}`. Don't create icons.
4. **`app/js/errors.js`** per contracts section 5.
   - One catalogue entry per code, each with `title`, `body`, `next`. Plain
     words, no jargon, lowercase working labels. The body names the file or
     page from `ctx` ("“notes.png” isn't an HTML file").
   - `mhtml` names the format and says to save or download the page as HTML
     instead.
   - `detail` is multi-line `key: value` text and always ends with the
     environment lines.
   - `environmentDetail()` reports: build, user agent,
     `navigator.storage.persisted()` result, whether `showOpenFilePicker`
     exists, display mode (standalone or browser), and the `deleteBroken` and
     `fsaBroken` settings. It must not throw if `db.js` is still a stub (catch
     and print `unknown`).
5. **`tests/server.cjs`**: a static file server on Node's `http`, no
   dependencies. Exports `start() -> { url, appUrl, setBuild(b), override(path, body), reset(), listAppFiles(), close() }`.
   - Listens on port 0. Serves the repo root; correct `Content-Type` for
     `.html .js .css .json .webmanifest .svg .png`; `Cache-Control: no-cache`.
   - `setBuild('t2')`: `app/sw.js` is served with its first line's `'dev'`
     replaced. `setBuild(null)` serves it untouched. Default `'t1'`.
   - `override('app/js/x.js', body)` serves `body` for that path (simulates a
     deploy); `reset()` clears overrides and the build back to `'t1'`.
   - `listAppFiles()`: every file under `app/`, as paths relative to `app/`.
6. **`tests/run.cjs`** per contracts section 8.
   - Discovers `tests/unit/*.test.js` and `tests/e2e/*.e2e.cjs`.
   - Unit: one fresh context per file; open
     `<url>/tests/unit/index.html?file=<name>`; wait for `window.__done`.
   - E2E: one fresh context per test; 20 s timeout per test; `server.reset()`
     before each.
   - Collects uncaught page errors and `console.error` lines per test and
     appends up to 5 of them to that test's failure output.
   - Failure output capped at 12 lines per test. Prints nothing for passing
     tests unless `--verbose`. Last line is `RESULT: PASS n/n` or
     `RESULT: FAIL f/n`. Always closes the browser and server, also on a
     crash.
   - `--only`, `--unit`, `--e2e`, `--verbose`.
7. **`tests/unit/harness.js`**: `test(name, fn)`, `assert(cond, msg)`,
   `eq(actual, expected, msg)` (deep, via JSON for objects), `rejects(promise, check)`.
   `index.html` imports the file named in `?file=`, runs the tests in order
   and sets `window.__done = { results: [{ name, ok, error }] }`. An import
   failure is reported as one failed test.
8. **`tests/e2e/helpers.cjs`**, used as `t.helpers` and by `t.openApp()`:
   - `openApp(context, appUrl) -> page`: opens the app, waits for
     `window.__jdReady`.
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
  becomes true; no request made by the app starts outside `/app/` (proves
  relative URLs).

## Done when

`node tests/run.cjs` prints `RESULT: PASS`, and a deliberately broken test
(try it, then remove it) prints a `FAIL` line with a capped error and exits
non-zero.
