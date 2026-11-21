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
  - `sessionStorage`: the same kind of stand-in, held by the Junk Drawer
    window only while the page is open. It survives the page reloading
    itself and is empty on the next open ("lasts one view").
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
Android uses), the last four by the plan's reviewer. Build on them; don't
re-investigate them.

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
| After a top-level reload while such a page was open, `history.back()` is swallowed by the page's leftover entries; `navigation.traverseTo(navigation.entries()[index - 1].key)` lands on the library entry | holds |
| A notice container moved into the open modal `<dialog>` is clickable there; a `popover` shown above a modal dialog is visible but not clickable; a `transform` on the dialog misplaces fixed-position children | holds |
| A change in only an imported module triggers a service worker update; going offline in Playwright also blocks fetches made inside the worker; a sandboxed page calling `history.back()` can't move the top-level history | holds |
| An undeclared windows-1252 page in an iframe of a UTF-8 parent is read as UTF-8 (hence the stored `charset`) | holds |

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
  js/zip.js                later pure: writing and reading zip files
  js/backup.js             later the backup format: building, reading, restoring
  js/backup-flow.js        later export library, import library, export page flows
tests/
  run.cjs, server.cjs      WP1   headless runner and static server
  unit/index.html, unit/harness.js   WP1
  e2e/helpers.cjs          WP1
  unit/<name>.test.js      the package that owns the module under test
  e2e/<name>.e2e.cjs       the package named in its brief
  tools/make-icons.cjs     WP6
  tools/screenshots.cjs    WP13
  README.md                WP1
  out/                     gitignored: review notes, screenshots, every agent's scratch files
.gitignore                 WP1   one added line: tests/out/
.github/workflows/deploy-pages.yml   WP6
docs/phone-check.md, AGENTS.md, docs/spec.md (three edits)   WP13
```

WP1 creates every `app/` file in this list, the unowned ones as stubs (a
comment naming the owner, plus empty exports where section 5 names any), so
nothing 404s and the precache list can be complete from the start.

Test files and who owns them (a failing test goes to this package first):

| Test file | Package |
| --- | --- |
| `unit/errors.test.js`, `e2e/smoke.e2e.cjs` | WP1 |
| `unit/model.test.js`, `unit/html-check.test.js` | WP2 |
| `unit/db.test.js`, `e2e/helpers.e2e.cjs` | WP3 |
| `unit/inject.test.js`, `unit/page-shim.test.js` | WP4 |
| `e2e/ui.e2e.cjs` | WP5 |
| `e2e/install.e2e.cjs` | WP6 |
| `e2e/sw.e2e.cjs` | WP7 |
| `e2e/add-flow.e2e.cjs`, `e2e/picker.e2e.cjs` | WP8 |
| `e2e/library.e2e.cjs` | WP9 |
| `e2e/viewer.e2e.cjs` | WP10 |
| `e2e/journey.e2e.cjs`, `e2e/update.e2e.cjs` | WP11 |

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
  exportLibrary: 'jd:export-library',    // the library's "export library" button
  importLibrary: 'jd:import-library',    // the library's "import library" button
  exportPage: 'jd:export-page',          // detail: { id }; the viewer's "export" button
};
export const SETTINGS = {
  sort: 'library.sort',
  deleteBroken: 'deleteOriginal.broken',  // true once deleting has failed for a reason other than the owner saying no
  deleteLast: 'deleteOriginal.last',      // last position of the "delete the downloaded file" switch
  fsaBroken: 'picker.fsaBroken',          // true: use the plain file input (set when showOpenFilePicker fails outright, or by the owner in the footer)
  pickerLastError: 'picker.lastError',    // text of the last picker error, for diagnostics
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
  <div id="start-failed" hidden></div>
  <script>/* start guard: see below */</script>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- **Start guard.** A small inline classic script, so that a module failing to
  load never leaves a blank screen. It records the first `error` and
  `unhandledrejection` it sees on `window`, and if `window.__jdReady` isn't
  true 8 seconds after load it fills `#start-failed` with "Junk Drawer
  didn't start", what to try (close and reopen; if that fails, copy this and
  give it to an agent), and the recorded error text and user agent in a
  read-only `<textarea>`, and un-hides it. It uses nothing from `js/`.

- `library.js` owns everything inside `#library`; `viewer.js` inside
  `#viewer`; `ui.js` inside `#notices` and `#dialogs`.
- `#viewer` is a fixed full-screen layer above the library. Opening a page
  never hides or re-renders `#library` (set `inert` on it instead), which is
  what keeps its scroll position.
- CSS uses only the tokens `base.css` defines: `--jd-bg`, `--jd-surface`,
  `--jd-fg`, `--jd-muted`, `--jd-line`, `--jd-accent`, `--jd-danger`,
  `--jd-radius`, `--jd-gap`, `--jd-bar-h`, and the layers `--jd-z-viewer`
  (100) and `--jd-z-notices` (300). Class names are prefixed by owner:
  `ui-`, `lib-`, `view-`.
- `base.css` includes `[hidden] { display: none !important; }`, so `hidden`
  works on elements that have a `display` rule.

## 5. Module interfaces

All functions are `async` unless marked sync. Timestamps are `Date.now()`
numbers.

### `errors.js` (WP1)

```js
export class JdError extends Error {   // new JdError(code, { cause, detail })
  code; cause; detail;
}
export function describe(err, ctx) -> { title, body, next, detail }   // sync
export async function getBuild() -> string            // from BUILD_PATH; 'unknown' on failure
export async function environmentDetail() -> string   // multi-line; never rejects
```

- `ctx`: `{ file?: File | {name,type,size}, page?: {id,name} }`.
- `title`/`body`/`next` are plain words for the owner; `next` is `''` when
  there's nothing to do. `detail` is the technical text: code, file
  name/type/size, page name/id, `err.name: err.message` of the cause, time.
  It doesn't include the environment; whatever copies it appends
  `await environmentDetail()` at copy time (`ui.js`'s `copyButton` does).
- `getBuild()` caches only a successful answer. On a first launch the worker
  doesn't control the window yet and the answer is `unknown`; a later call
  gets the real one.
- `environmentDetail()`: build, user agent, display mode (standalone or
  browser), `navigator.storage.persisted()`, whether `showOpenFilePicker`
  exists, whether a service worker controls the window, the names of this
  origin's caches, and the `deleteBroken`, `fsaBroken` and `pickerLastError`
  settings.
- **`errors.js` is imported by `db.js`, so it also loads in the service
  worker.** Nothing at its top level may touch `window`, `document` or
  `navigator.storage`; use them only inside functions, guarded.
- Any non-`JdError` is described as code `unexpected`.
- Codes: `wrong-type`, `mhtml`, `unreadable`, `empty`, `not-html`,
  `storage-full`, `page-missing`, `page-unreadable`, `store-refused`,
  `delete-failed`, `delete-denied`, `picker-failed`, `sw-failed`,
  `unexpected`. WP1's brief says what each message must tell the owner.

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
export async function checkFile(file) -> { bytes: ArrayBuffer, charset: string | null, title: string | null, siblingRefs: string[] }
```

Throws `JdError` with `wrong-type`, `mhtml`, `unreadable`, `empty` or
`not-html`. `bytes` is what gets stored (identical to the file, except a
UTF-16 file is converted to UTF-8 with a BOM). `charset` is `null` (let the
browser decide, the normal case) or `'windows-1252'` for a file that
declares no encoding and isn't valid UTF-8; the service worker then sends it
in the `Content-Type`, because an undeclared page in an iframe would
otherwise be read as UTF-8 and show broken characters.

### `db.js` (WP3; must work in a window and in the service worker)

```js
// PageRecord: { id, name, fileName, tags: string[], pinned: boolean, openCount: number,
//               addedAt: number, lastOpenedAt: number | null, replacedAt: number | null, size: number }
export async function listPages() -> PageRecord[]
export async function getPage(id) -> PageRecord | undefined
export async function addPage({ name, fileName, tags, bytes, charset }) -> PageRecord
export async function replaceFile(id, { fileName, bytes, charset }) -> PageRecord
export async function updatePage(id, patch) -> PageRecord        // patch keys: name, tags, pinned
export async function recordOpen(id) -> PageRecord
export async function removePage(id) -> void
export async function getFile(id) -> { bytes: ArrayBuffer, charset: string | null } | undefined
export async function getLocalEntries(pageId) -> [string, string][]
export async function applyLocalOps(pageId, ops) -> void   // ops: [{ op: 'set' | 'remove' | 'clear', key, value }], applied in order in one transaction
export async function listPageDatabases(pageId) -> string[]      // full prefixed names
export async function getSetting(key, fallback) -> any
export async function setSetting(key, value) -> void
```

Stores (version 1):

| Store | Key | Value |
| --- | --- | --- |
| `pages` | `id` | `PageRecord` |
| `files` | `id` | `{ id, bytes: ArrayBuffer, charset: string \| null }` |
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
export function doctypeEnd(bytes) -> number
export function escapeForInlineScript(value) -> string           // JSON text that is safe inside <script> and ASCII only
export function inlineScript(shimSource, boot) -> Uint8Array     // '<script>(…)(…);document.currentScript.remove()</script>', ASCII only
export function buildPageParts(bytes, shimSource, boot) -> BlobPart[]   // [before, script, after]
```

`bytes` may be an `ArrayBuffer` or a `Uint8Array` in both functions.

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
    sessionEntries: [string, string][],   // the page's sessionStorage for this open
    applySession(op, key, value) -> void, // same ops; memory only; never throws
    notify(type, data) -> void,           // never throws
  },
  pageError(pageId, code, detail) -> void // from the service worker's error document
}
```

- `connect` returns `null` unless `pageId` is the page the viewer has open.
  The page calls it again each time it reloads itself.
- `notify` types: `'ready'`; `'external-nav'` `{ url }` (the page tried to
  go to another site without a tap); `'missing-file'` `{ url }` (the page
  tried to go to a file that sat beside it); `'store-refused'`
  `{ api: 'localStorage' | 'indexedDB', detail }`.
- Everything crossing this boundary is a string, a plain object or an array.

### `ui.js` (WP5)

```js
export function showNotice({ title, body, next, detail, actions }) -> { dismiss() }   // sync
export function reportError(err, ctx) -> void                      // sync: describe() then showNotice()
export function hasOpenUi() -> boolean                             // sync: any dialog or notice showing
export function copyButton({ label, getText }) -> HTMLElement      // sync: a button that copies; see below
export async function confirmDialog({ title, body, confirmLabel, cancelLabel, danger }) -> boolean
export async function choiceDialog({ title, body, list, choices }) -> string | null   // choices: [{ id, label, danger? }]; list: string[] shown as a list
export async function actionSheet({ title, actions }) -> string | null                // actions: [{ id, label, danger? }]
export async function detailsDialog({ title, name, tags, allTags, submitLabel }) -> { name, tags } | null
export async function addedSheet({ title, canDelete, deleteDefault }) -> { deleteOriginal: boolean, open: boolean } | null
```

- A notice stays until dismissed and has "copy details" when `detail` is
  given. `actions`: `[{ label, href }]` (opens in a new tab) or
  `[{ label, onClick }]`.
- `copyButton`: copies `await getText()` followed by
  `await environmentDetail()`, then reads "copied" for two seconds. If the
  clipboard refuses, it shows the text in a read-only `<textarea>` after
  itself. Notices use it for "copy details"; the library footer and the
  viewer's error panel use it too, so nobody else writes clipboard code.
- Dialogs are `<dialog>` elements opened with `showModal()`. Dismissing one
  (back gesture, Escape, a tap outside a sheet) resolves as cancel: `false`
  from `confirmDialog`, `null` from the others.
- `detailsDialog` returns `tags` as the owner gave them: the chips that are
  on, then the typed text split on commas, trimmed, empties dropped. It
  doesn't normalise; the caller passes them through `parseTags`. (`ui.js`
  imports nothing from `model.js`.)
- `ui.js` creates `#notices` and `#dialogs` if they're missing.

### `picker.js` (WP8)

```js
export async function pickFile() -> { file: File, handle: FileSystemFileHandle | null } | null   // null: cancelled
export async function canDeleteOriginal(handle) -> boolean
export async function deleteOriginal(handle) -> void   // throws JdError('delete-denied' | 'delete-failed')
```

Test seams, the only two places the app reads `__jdTest`:

- when `globalThis.__jdTest?.pickFile` is a function, `pickFile()` returns
  what it returns;
- when `globalThis.__jdTest?.noBoot` is true, `app.js` sets
  `window.__jdReady = true` and does nothing else (no init, no service
  worker, no update handling), so a package's tests can drive its module
  alone.

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
export function isViewerOpen() -> boolean       // sync: true from the start of an open until the close has finished
export async function whenSaved() -> void       // resolves when every localStorage write received so far is stored
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
   `getFile(pageId)`; respond with
   `new Blob(buildPageParts(bytes, pageShim.toString(), boot))`, status 200,
   `Cache-Control: no-store`, and `Content-Type: text/html` with **no
   charset** unless the stored `charset` isn't `null`, in which case
   `text/html; charset=<it>`.
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

- Boot: if the current state is `{ jd: 'view' }` (the app was reloaded, or
  Android discarded and restored it, while a page was open), go to the
  top-level entry before it:
  `const i = navigation.currentEntry.index; if (i > 0) navigation.traverseTo(navigation.entries()[i - 1].key); else history.replaceState({ jd: 'library' }, '')`.
  A plain `history.back()` is **not** enough: if the page had made history
  entries of its own, it gets swallowed by them (tested). In every other
  case, `history.replaceState({ jd: 'library' }, '')`.
- Open: remember `navigation.currentEntry.key` as the library key, then
  `history.pushState({ jd: 'view', pageId }, '')`, then create the iframe.
- `popstate` with `{ jd: 'library' }` while the viewer is open: close it
  (remove the iframe) and dispatch `viewerClosed`.
- `popstate` with `{ jd: 'view' }` while the viewer is closed: `history.back()`.
- "library" button: `navigation.traverseTo(libraryKey)`; if `navigation` is
  missing, `history.back()`. If the traverse rejects, or 500 ms later the
  viewer is still open, close the viewer directly and
  `history.replaceState({ jd: 'library' }, '')`. The button must never do
  nothing.
- Only one open at a time: `openPage` sets an "opening" flag before its
  first `await`, and a second call while opening or open is ignored.
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
node tests/run.cjs --only <text>   # test FILES whose name contains <text> (several: --only db,helpers)
node tests/run.cjs --unit | --e2e
```

- **Always run it with a 10-minute command timeout** (600000 ms on the Bash
  tool); the default of two minutes is too short for a full run.
- Output is short by design: `FAIL <file>: <test name>` per failing test plus
  at most 12 lines of its error, then `RESULT: PASS 41/41 (38s)` or
  `RESULT: FAIL 3/41 (52s)`. Exit code 0 only on PASS.
- It can't hang: 20 s per e2e test, 30 s per unit file, test files run four
  at a time, and it stops early after 10 failures or 8 minutes, still
  printing `RESULT: FAIL … (stopped early: <why>)`.
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

  `t`: `{ context, server, appUrl, openApp(opts), helpers }`. Each test has
  its own server instance, so tests running side by side can't disturb each
  other's build stamp or overrides. `tests/README.md` (WP1) documents the
  helpers: seeding pages through `db.js`, setting the next picked file,
  getting the viewer's frame, dumping the database.
- **`t.openApp({ boot: false })`** sets `__jdTest.noBoot` before the app
  loads, so `app.js` does nothing. Every package's own tests use it and call
  the idempotent `init…()` functions they need; that way they behave the
  same before and after the real `app.js` exists. Only `journey` and
  `update` (WP11) use the real boot, `t.openApp()`.
- A package keeps its fixtures inside its own test files. `helpers.cjs` is
  frozen after stage 2; ask the orchestrator for additions.
- Requests to other sites must be routed in the test
  (`context.route('https://example.test/**', …)`); nothing may depend on the
  real internet.
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
- Other agents share this working tree. Never run `git stash`,
  `git checkout`, `git restore`, `git reset` or `git clean`, and never
  delete a file you didn't create.
- Scratch files go in `tests/out/` (gitignored), nowhere else in the repo.
