# Junk Drawer v1: contracts

Every agent building v1 reads this file. It fixes the architecture, the file
layout and the interfaces between modules, so that packages built in parallel
fit together. What the app must do is in [`../spec.md`](../spec.md); this file
says how.

**If a contract here is wrong or missing something you need, stop and say so
in your report. Don't work around it by changing another package's file or by
inventing an interface.** The orchestrator changes this file and tells the
agents it affects.

## 1. Architecture in one page

- `app/` is static files served as-is: ES modules, no build, no dependencies,
  relative URLs only.
- **Junk Drawer's own data lives in one IndexedDB database**, `junk-drawer`.
  The app never uses the real `localStorage` or `sessionStorage`: the origin
  is shared with the owner's other GitHub Pages sites, and one
  `localStorage.clear()` there would wipe it.
- **A page is shown in an `<iframe>` whose document the service worker
  builds** from the stored file. URL: `<scope>p/<pageId>/`. The page is
  same-origin with Junk Drawer, so storage, camera prompts and so on work as
  in a tab.
- **The service worker injects one inline `<script>` (the shim) straight after
  the page's doctype.** It runs before any of the page's own code and gives
  the page private storage:
  - `localStorage`: a stand-in object. Its data is held by the Junk Drawer
    window and persisted to the `pageLocal` store. The shim reaches the window
    by direct function call (`parent.__junkDrawerHost`), not `postMessage`, so
    a write is recorded synchronously and survives the page reloading itself.
  - `sessionStorage`: a stand-in held in memory, empty on every load.
  - `indexedDB`: the real thing, with every database name prefixed
    `junk-drawer:page:<pageId>:`. The page sees its own names.
- **The iframe is sandboxed without `allow-top-navigation`**, so a page can't
  navigate Junk Drawer away. The sandbox is a behaviour guard, not a security
  boundary.
- **The shim cancels navigations to other sites** (Navigation API) and hands
  the URL to Junk Drawer, which opens it in the browser.
- **Updates:** the deploy workflow stamps the commit into `sw.js`. A stamped
  worker precaches the app into a cache named after the build and serves
  cache-first; a new deploy is a new worker, which takes over and the app
  reloads itself when it's safe.

### Proven before this plan was written

These were tested in a throwaway spike on Chromium 157 (the engine Chrome for
Android uses). Build on them; don't re-investigate them.

| Claim | Result |
| --- | --- |
| A `<script>` inserted after the doctype (leading comment, BOM or none) keeps standards mode, `<html>` attributes and `<head>` content | holds |
| A large inline ASCII script before `<meta charset>` doesn't break charset detection (windows-1252, UTF-8, UTF-8 with BOM, undeclared UTF-8) when the response has no charset | holds |
| `Object.defineProperty(window, 'localStorage', …)` in the iframe; a `Proxy` over `Object.create(Storage.prototype)` passes `instanceof Storage`, `Object.keys`, `.length`, property get/set | holds |
| Patching `IDBFactory.prototype.open/deleteDatabase/databases` and the `IDBDatabase.prototype.name` getter in the iframe's realm isolates and hides the prefix; the parent's realm is untouched | holds |
| A module service worker can import the shim as a function and inject `'(' + fn.toString() + ')(' + json + ')'` | holds |
| Shim calls `parent.<host>.connect()` synchronously; `setItem` then `location.reload()` shows the new value on the next load | holds |
| No host (page URL opened top-level): `window.stop()` in the shim stops the page's own scripts from ever running | holds |
| Sandbox without `allow-top-navigation`: `top.location = …` throws `SecurityError`; `alert()` works with `allow-modals` | holds |
| Navigation API in the iframe: `navigate` fires for `location.href = 'https://…'` and for link clicks, is cancelable, and gives the URL and `userInitiated` | holds |
| Hash navigations inside the iframe add browser history entries; `history.back()` steps the iframe and fires no `popstate` in the parent; the parent's `navigation.entries()` doesn't grow; `navigation.traverseTo(libraryKey)` returns to the library in one step | holds |

### Known limits (the owner has accepted these)

- Separation guards against accidents (same key names, a reset button), not
  against a page written to reach around it.
- Data a page saves from a Web Worker, or from a frame it creates inside
  itself, is not separated.
- Cookies and the Cache API are shared between pages (the spec promises
  nothing for them). `storage` events don't fire.
- A page's URL is `…/p/<id>/`, so a file it expects beside it gets a 404.
- A page opened outside the viewer (it calls `window.open(location.href)`)
  shows "open this page from Junk Drawer" and runs nothing.

## 2. File layout and owners

One package owns each file. Only its agent edits it.

```
app/
  index.html               WP1   static skeleton (section 4)
  manifest.webmanifest     WP6
  sw.js                    WP7   module service worker
  icons/                   WP6   icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png
  styles/base.css          WP5   tokens, dialogs, notices, buttons
  styles/library.css       WP9
  styles/viewer.css        WP10
  js/config.js             WP1   constants (section 3)
  js/errors.js             WP1   JdError, message catalogue, environment detail
  js/model.js              WP2   pure: tags, sorting, filtering, same-name match
  js/html-check.js         WP2   file checks, title, sibling references
  js/db.js                 WP3   IndexedDB layer (window and service worker)
  js/inject.js             WP4   pure: where to inject, building the served bytes
  js/page-shim.js          WP4   the shim, exported as one self-contained function
  js/ui.js                 WP5   dialogs, sheets, notices
  js/picker.js             WP8   choosing a file, deleting the original
  js/add-flow.js           WP8   add and replace flows
  js/library.js            WP9   library view
  js/viewer.js             WP10  viewer, host object, history
  js/app.js                WP11  boot, wiring, persistence, updates
tests/
  run.cjs, server.cjs      WP1   headless runner and static server
  unit/index.html, unit/harness.js   WP1
  e2e/helpers.cjs          WP1
  unit/<name>.test.js      the package that owns the module under test
  e2e/<name>.e2e.cjs       the package named in its brief
  tools/make-icons.cjs     WP6
  tools/screenshots.cjs    WP13
  README.md                WP1
  out/                     gitignored: review notes, screenshots, throwaway files
.github/workflows/deploy-pages.yml   WP6
docs/phone-check.md, AGENTS.md, docs/spec.md (three edits)   WP13
```

WP1 creates every `app/` file in this list, the unowned ones as stubs (a
comment naming the owner, plus empty exports where section 5 names any), so
nothing 404s and the precache list can be complete from the start.

## 3. Constants: `js/config.js`

```js
export const DB_NAME = 'junk-drawer';
export const DB_VERSION = 1;
export const PAGE_DB_PREFIX = 'junk-drawer:page:';  // + pageId + ':' + the page's own name
export const CACHE_PREFIX = 'junk-drawer-shell-';   // + build
export const PAGE_PATH = 'p/';                      // <scope>p/<pageId>/
export const BUILD_PATH = '__jd/build';             // sw answers {"build":"…"}
export const HOST_GLOBAL = '__junkDrawerHost';
export const LOCAL_QUOTA_CHARS = 5_000_000;         // per page, keys + values
export const EVENTS = {
  libraryChanged: 'jd:library-changed',  // pages or settings changed; library re-reads
  openPage: 'jd:open-page',              // detail: { id }
  addPage: 'jd:add-page',                // the "add new page" button
  replaceFile: 'jd:replace-file',        // detail: { id }
  viewerClosed: 'jd:viewer-closed',
};
export const SETTINGS = {
  sort: 'library.sort',
  deleteBroken: 'deleteOriginal.broken',  // true once deleting has failed for a reason other than the owner saying no
  deleteLast: 'deleteOriginal.last',      // last position of the "delete the downloaded file" switch
  fsaBroken: 'picker.fsaBroken',          // true once showOpenFilePicker has failed outright
};
```

Events are `CustomEvent`s dispatched on `document`. Views never import each
other; `app.js` wires events to functions.

## 4. `index.html` skeleton

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Junk Drawer</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icons/icon.svg">
  <link rel="stylesheet" href="styles/base.css">
  <link rel="stylesheet" href="styles/library.css">
  <link rel="stylesheet" href="styles/viewer.css">
</head>
<body>
  <main id="library"></main>
  <section id="viewer" hidden></section>
  <div id="notices"></div>
  <div id="dialogs"></div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- `library.js` owns everything inside `#library`; `viewer.js` inside
  `#viewer`; `ui.js` inside `#notices` and `#dialogs`.
- `#viewer` is a fixed full-screen layer above the library. Opening a page
  never hides or re-renders `#library` (set `inert` on it instead), which is
  what keeps its scroll position.
- CSS uses only the tokens `base.css` defines: `--jd-bg`, `--jd-surface`,
  `--jd-fg`, `--jd-muted`, `--jd-line`, `--jd-accent`, `--jd-danger`,
  `--jd-radius`, `--jd-gap`, `--jd-bar-h`. Class names are prefixed by owner:
  `ui-`, `lib-`, `view-`.

## 5. Module interfaces

All functions are `async` unless marked sync. Timestamps are `Date.now()`
numbers.

### `errors.js` (WP1)

```js
export class JdError extends Error {   // new JdError(code, { cause, detail })
  code; cause; detail;
}
export function describe(err, ctx) -> { title, body, next, detail }   // sync
export function getBuild() -> string            // fetches BUILD_PATH once; 'unknown' on failure
export function environmentDetail() -> string   // build, user agent, persisted, picker support, flags
```

- `ctx`: `{ file?: File | {name,type,size}, page?: {id,name} }`.
- `title`/`body`/`next` are plain words for the owner; `next` is `''` when
  there's nothing to do. `detail` is the copyable technical text: code, file
  name/type/size, page name/id, `err.name: err.message` of the cause, build,
  user agent, time.
- Any non-`JdError` is described as code `unexpected`.
- Codes: `wrong-type`, `mhtml`, `unreadable`, `empty`, `not-html`,
  `storage-full`, `page-missing`, `page-unreadable`, `store-refused`,
  `delete-failed`, `delete-denied`, `picker-failed`, `sw-failed`,
  `unexpected`.

### `model.js` (WP2, pure, sync)

```js
export const SORTS = [{ id: 'name', label }, { id: 'recent-opened', label },
                      { id: 'recent-added', label }, { id: 'most-opened', label }];
export const DEFAULT_SORT = 'name';
export function normaliseTag(s) -> string          // trim, lowercase, collapse spaces; '' if nothing left
export function parseTags(input) -> string[]       // string (comma-separated) or array; normalised, de-duplicated
export function allTags(pages) -> string[]         // tags in use, alphabetical
export function matchKey(s) -> string              // for the same-name check
export function findSameName(pages, { name, fileName }) -> PageRecord[]
export function sortPages(pages, sortId) -> PageRecord[]   // pinned first, then the sort
export function filterPages(pages, activeTags) -> PageRecord[]   // must have all
export function fileStem(fileName) -> string       // without .html/.htm
```

### `html-check.js` (WP2)

```js
export async function checkFile(file) -> { bytes: ArrayBuffer, title: string | null, siblingRefs: string[] }
```

Throws `JdError` with `wrong-type`, `mhtml`, `unreadable`, `empty` or
`not-html`. `bytes` is what gets stored (identical to the file, except a
UTF-16 file is converted to UTF-8 with a BOM).

### `db.js` (WP3; must work in a window and in the service worker)

```js
// PageRecord: { id, name, fileName, tags: string[], pinned: boolean, openCount: number,
//               addedAt: number, lastOpenedAt: number | null, replacedAt: number | null, size: number }
export async function listPages() -> PageRecord[]
export async function getPage(id) -> PageRecord | undefined
export async function addPage({ name, fileName, tags, bytes }) -> PageRecord
export async function replaceFile(id, { fileName, bytes }) -> PageRecord
export async function updatePage(id, patch) -> PageRecord        // patch keys: name, tags, pinned
export async function recordOpen(id) -> PageRecord
export async function removePage(id) -> void
export async function getFileBytes(id) -> ArrayBuffer | undefined
export async function getLocalEntries(pageId) -> [string, string][]
export async function applyLocalOp(pageId, { op, key, value }) -> void   // op: 'set' | 'remove' | 'clear'
export async function listPageDatabases(pageId) -> string[]      // full prefixed names
export async function getSetting(key, fallback) -> any
export async function setSetting(key, value) -> void
```

Stores (version 1):

| Store | Key | Value |
| --- | --- | --- |
| `pages` | `id` | `PageRecord` |
| `files` | `id` | `{ id, bytes: ArrayBuffer }` |
| `pageLocal` | `[pageId, key]` | `{ pageId, key, value }` |
| `settings` | `key` | `{ key, value }` |

- `addPage` and `replaceFile` each write `pages` and `files` in **one**
  transaction: both land or neither does.
- `removePage` deletes the page's rows in `pages`, `files` and `pageLocal` in
  one transaction, then deletes every database named
  `PAGE_DB_PREFIX + id + ':…'`.
- A write refused for lack of space rejects with `JdError('storage-full')`.
- Ids are `crypto.randomUUID()`.

### `inject.js` (WP4, pure, sync)

```js
export function doctypeEnd(bytes /* Uint8Array */) -> number
export function inlineScript(shimSource, boot) -> Uint8Array     // '<script>(…)(…);document.currentScript.remove()</script>', ASCII only
export function buildPageParts(bytes, shimSource, boot) -> BlobPart[]   // [before, script, after]
```

### `page-shim.js` (WP4)

```js
export function pageShim(boot) { … }   // boot: { pageId, hostGlobal, dbPrefix, quotaChars }
```

One function, **self-contained**: it's turned into text with `toString()` and
runs inside the page, so it can't use imports or anything outside its own
body. Its source is ASCII only and never contains `</script` or `<!--`.

### Host object (`viewer.js` defines it; the shim and the error document call it)

`window[HOST_GLOBAL]` on the Junk Drawer window:

```js
{
  connect(pageId) -> null | {
    entries: [string, string][],          // the page's localStorage as of now
    apply(op, key, value) -> void,        // 'set' | 'remove' | 'clear'; never throws
    notify(type, data) -> void,           // never throws
  },
  pageError(pageId, code, detail) -> void // from the service worker's error document
}
```

- `connect` returns `null` unless `pageId` is the page the viewer has open.
- `notify` types: `'ready'`; `'external-nav'` `{ url }`; `'store-refused'`
  `{ api: 'localStorage' | 'indexedDB', detail }`.
- Everything crossing this boundary is a string, a plain object or an array.

### `ui.js` (WP5)

```js
export function showNotice({ title, body, next, detail, actions }) -> { dismiss() }   // sync
export function reportError(err, ctx) -> void                      // sync: describe() then showNotice()
export function hasOpenUi() -> boolean                             // sync: any dialog or notice showing
export async function confirmDialog({ title, body, confirmLabel, cancelLabel, danger }) -> boolean
export async function choiceDialog({ title, body, list, choices }) -> string | null   // choices: [{ id, label, danger? }]; list: string[] shown as a list
export async function actionSheet({ title, actions }) -> string | null                // actions: [{ id, label, danger? }]
export async function detailsDialog({ title, name, tags, allTags, submitLabel }) -> { name, tags } | null
export async function addedSheet({ title, canDelete, deleteDefault }) -> { deleteOriginal: boolean, open: boolean }
```

- A notice stays until dismissed and has "copy details" when `detail` is
  given. `actions`: `[{ label, href }]` (opens in a new tab) or
  `[{ label, onClick }]`.
- Dialogs are `<dialog>` elements opened with `showModal()`. Dismissing one
  (back gesture, Escape) resolves as cancel: `false`, `null`, or
  `{ deleteOriginal: false, open: false }`.
- `ui.js` creates `#notices` and `#dialogs` if they're missing.

### `picker.js` (WP8)

```js
export async function pickFile() -> { file: File, handle: FileSystemFileHandle | null } | null   // null: cancelled
export async function canDeleteOriginal(handle) -> boolean
export async function deleteOriginal(handle) -> void   // throws JdError('delete-denied' | 'delete-failed')
```

Test seam: when `globalThis.__jdTest?.pickFile` is a function, `pickFile()`
returns what it returns. Nothing else in the app reads `__jdTest`.

### `add-flow.js` (WP8)

```js
export async function addPageFlow() -> Result
export async function replaceFlow(pageId) -> Result
export async function ingest({ file, handle }, opts) -> Result   // opts: { mode: 'add' } | { mode: 'replace', pageId }
// Result: { status: 'added' | 'replaced' | 'cancelled' | 'refused', pageId? }
```

`ingest` is the entry point a share target will use later; keep it free of
any assumption that the file came from a picker.

### `library.js` (WP9), `viewer.js` (WP10), `app.js` (WP11)

```js
// library.js
export async function initLibrary() -> void     // idempotent
// viewer.js
export async function initViewer() -> void      // idempotent; defines the host object
export async function openPage(id) -> void
export function isViewerOpen() -> boolean       // sync
```

`app.js` exports nothing. It sets `window.__jdReady = true` when boot has finished. Tests wait
for it.

## 6. Service worker (`sw.js`, WP7)

First line of the file, exactly: `const BUILD = 'dev';` The deploy workflow
replaces `dev` with the commit; the test server can do the same.

Fetch handling, in order:

1. Not `GET`, another origin, or outside the worker's scope: don't call
   `respondWith`. The page gets the network as in a tab.
2. `<scope>__jd/build`: `{"build": BUILD}` as JSON.
3. `<scope>p/<pageId>/` (query ignored): the page document. Read
   `getFileBytes(pageId)`; respond with
   `new Blob(buildPageParts(bytes, pageShim.toString(), boot))`, status 200,
   `Content-Type: text/html` (**no charset**), `Cache-Control: no-store`.
   If the file is missing or the read throws: an error document (status 404 or
   500) that shows a plain message and calls
   `parent[HOST_GLOBAL].pageError(pageId, 'page-missing' | 'page-unreadable', detail)`
   inside `try`.
4. Anything else under `<scope>p/`: 404, plain text.
5. App files:
   - **stamped build:** from the cache `CACHE_PREFIX + BUILD`, falling back to
     the network. A navigation to the scope root gets the cached `index.html`.
   - **`dev`:** network first with `cache: 'no-store'`, updating the cache
     `CACHE_PREFIX + 'dev'`, falling back to that cache when offline.

Lifecycle: `install` precaches every file in the `SHELL` list (stamped builds;
fetch each with `cache: 'reload'`; all or nothing) and calls `skipWaiting()`.
`activate` deletes caches whose names start with `CACHE_PREFIX` and aren't the
current one (never any other cache: the origin is shared) and calls
`clients.claim()`.

Registration (in `app.js`):
`navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' })`.

## 7. History and the viewer

- Boot: `history.replaceState({ jd: 'library' }, '')` unless the current state
  is `{ jd: 'view' }`, in which case call `history.back()` (a reload while
  viewing lands on the library).
- Open: remember `navigation.currentEntry.key` as the library key, then
  `history.pushState({ jd: 'view', pageId }, '')`, then create the iframe.
- `popstate` with `{ jd: 'library' }` while the viewer is open: close it
  (remove the iframe) and dispatch `viewerClosed`.
- `popstate` with `{ jd: 'view' }` while the viewer is closed: `history.back()`.
- "library" button: `navigation.traverseTo(libraryKey)`; if `navigation` is
  missing, `history.back()`.
- Back gesture: the browser's own behaviour. It steps through the page's own
  history first, then reaches the library entry. This is the owner's choice.

The iframe:

```html
<iframe src="p/<pageId>/"
  sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups
           allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock
           allow-orientation-lock allow-presentation
           allow-top-navigation-to-custom-protocols"
  allow="camera; microphone; geolocation; fullscreen; clipboard-read; clipboard-write;
         autoplay; accelerometer; gyroscope; magnetometer; screen-wake-lock; web-share"
  allowfullscreen></iframe>
```

A new iframe element for every open; removed on close.

## 8. Tests

No test framework and nothing installed by the repo. The runner needs
Playwright to be resolvable by Node (`require('playwright')`), which it is in
Claude's cloud sessions.

```
node tests/run.cjs                 # everything
node tests/run.cjs --only <text>   # tests whose file or name contains <text>
node tests/run.cjs --unit | --e2e
```

- Output is short by design: one line per failing test plus at most 12 lines
  of its error, then `RESULT: PASS 41/41` or `RESULT: FAIL 3/41`. Exit code 0
  only on PASS.
- The server picks a free port, serves the repo root (the app is at `/app/`,
  which also proves relative URLs), and by default stamps `sw.js` with build
  `t1` so tests exercise the production path. Each test gets a fresh browser
  context (empty storage), viewport 412 by 915.
- **Unit tests** are browser ES modules, `tests/unit/<name>.test.js`:

  ```js
  import { test, assert, eq, rejects } from './harness.js';
  import { matchKey } from '../../app/js/model.js';
  test('matchKey ignores case', () => eq(matchKey('Foo.HTML'), 'foo'));
  ```

- **E2E tests** are Node files, `tests/e2e/<name>.e2e.cjs`:

  ```js
  module.exports = [
    { name: 'empty library offers add', run: async (t) => {
        const page = await t.openApp();
        …
    } },
  ];
  ```

  `t`: `{ context, server, appUrl, openApp(), helpers }`. `tests/README.md`
  (WP1) documents the helpers: seeding pages through `db.js`, setting the
  next picked file, getting the viewer's frame, dumping the database.
- A package keeps its fixtures inside its own test files. `helpers.cjs` is
  frozen after WP1; ask the orchestrator for additions.
- E2E tests must pass both before and after `app.js` is real: call
  `openApp()`, then the idempotent `init…()` you need, then use the DOM.
- Never start a server on a fixed port, and never leave a browser or server
  running.

## 9. Rules for every package

- Edit only the files your brief lists. Read only what it names.
- No dependencies, CDN scripts or vendored files. No real `localStorage` or
  `sessionStorage` in app code.
- Relative URLs only in `app/`.
- LF line endings, UTF-8, final newline.
- No state shown by colour alone (pair it with a mark, text or weight), and
  never red against green.
- Wording and looks that the spec and this plan don't fix are **placeholders**:
  plain, neutral, lowercase working labels. List each one you chose in your
  report.
- Never use real files from `local/`. Tests write their own HTML.
- Don't commit, push or start the dev server. The orchestrator commits.
