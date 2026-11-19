# WP10: the viewer

**Model:** Opus. **Stage 4, runs alone.** Needs WP3, WP4, WP5 and WP7, which
are done.

## Read first

- `docs/v1-plan/contracts.md`: sections 1, 3, 4, 5 (`errors.js`, `db.js`,
  `ui.js`, host object, `viewer.js`), 6 (item 3 only), 7, 8, 9.
- `docs/spec.md`: "Viewing a page", "Saved data", and under "When something
  goes wrong" the list "While using the app".
- `app/index.html`, `app/styles/base.css` (tokens), `tests/README.md`.
- In `app/js/page-shim.js`, only the places it calls the host, so you match
  them. Don't read the service worker.

## Files you own

`app/js/viewer.js`, `app/styles/viewer.css`, `tests/e2e/viewer.e2e.cjs`.

## The owner's choice on back

The back gesture steps through the page's own screens first (its hash and
history entries), then returns to the library. The "library" button always
goes straight to the library. Contracts section 7 has the mechanics, which
are proven.

## Build

`initViewer()` (idempotent) defines `window[HOST_GLOBAL]`, adds the
`popstate` listener and does the boot-time history step in contracts
section 7. `viewer.js` imports `db.js`, `ui.js`, `config.js`, `errors.js`
only.

**Layout.** `#viewer` is `position: fixed; inset: 0`, a column: a top bar
(`--jd-bar-h` high, never scrolls away) with the page's name (one line,
ellipsis) and a "library" button; below it the iframe filling the rest
(`flex: 1; border: 0; width: 100%`). Use `100dvh`. Respect
`env(safe-area-inset-*)` on the bar.

**`openPage(id)`**

1. If a page is already open, ignore the call.
2. `page = await getPage(id)`; if missing, `reportError(JdError('page-missing'))`
   and stop (no history entry).
3. Await the pending-writes promise (below), then load
   `entries = await getLocalEntries(id)` into a `Map`. This `Map` is the
   page's `localStorage` for as long as the viewer shows it.
4. `await navigator.serviceWorker.ready`, with a 10 s limit; on failure show
   the in-place error `sw-failed`.
5. Push the history entry (section 7), show `#viewer`, set `inert` on
   `#library`, put the name in the bar.
6. If `await getFileBytes(id)` is undefined: show the in-place error
   `page-missing` and stop. Don't count the open.
7. `recordOpen(id)`; dispatch `libraryChanged`.
8. Create the iframe exactly as in contracts section 7 and append it.
9. **Watchdog:** if the iframe's `load` event fires and the shim hasn't
   called `notify('ready')` for this open, or nothing has happened after
   10 s, show the in-place error `page-unreadable`.

**In-place error.** Replace the iframe with a panel under the bar showing
`describe(err, { page })`: title, body, next, and a "copy details" button.
The bar and its "library" button stay. Never a blank screen.

**Host object**

- `connect(pageId)`: `null` unless `pageId` is the open page; otherwise
  `{ entries: [...map], apply, notify }`. It's called again whenever the page
  reloads itself, and must return the current contents.
- `apply(op, key, value)`: update the `Map` synchronously, then chain
  `applyLocalOp(pageId, { op, key, value })` onto one promise queue (the
  pending-writes promise). If a write rejects, report `store-refused` once
  per open (not once per write). Never throws.
- `notify('ready')`: marks this open as served.
- `notify('store-refused', { api, detail })`: a notice saying Junk Drawer
  couldn't save data for this page, once per open per `api`.
- `notify('external-nav', { url })`: a notice "“<name>” tried to go to
  another site", showing the URL, with the action
  `{ label: 'open in browser', href: url }`.
- `pageError(pageId, code, detail)`: show the in-place error for the open
  page.
- Late calls for a page that's no longer open are still applied to storage
  (a page can write as it's being closed) but raise no UI.

**Closing.** On `popstate` to the library entry: remove the iframe, hide
`#viewer`, remove `inert`, clear the open-page state (keep the pending-writes
promise), dispatch `viewerClosed`. The "library" button and
`isViewerOpen()` are as in contracts.

## Tests you write (`viewer.e2e.cjs`)

`app.js` may still be a stub: after `openApp()`, register the worker if the
app hasn't and wait for `navigator.serviceWorker.ready`, call `initViewer()`,
seed pages with `t.helpers.seedPage`, and open with `openPage(id)`. Go back
with `page.evaluate(() => history.back())` (not `page.goBack()`, which waits
for a top-level navigation that never comes when only the iframe moves).

- the bar shows the name and a "library" button; the frame shows the page;
  `openCount` went up by one and `lastOpenedAt` is set;
- saved data: the page writes `localStorage`; close; reopen: the value is
  there; reload the whole app and reopen: still there; `sessionStorage`
  written in the first view is absent in the second;
- a page that does `setItem` then `location.reload()` sees the new value
  after the reload (a counter page that reloads itself three times ends at
  3);
- **the spec's worked example through the viewer:** two pages using key
  `state`; the second calls `localStorage.clear()`; the first still has its
  value; `listPages()` is intact;
- IndexedDB data written by a page is there on reopen;
- "library" button closes the viewer; `history.back()` closes it; after
  either, the library's `scrollY`, sort and active filter are what they were
  (seed 40 pages and scroll first; if `library.js` is real, init it too);
- a page with hash links: after two hash navigations, one `history.back()`
  leaves the viewer open on the earlier hash; the "library" button then
  closes it in one step and `history.state.jd` is `library`;
- every open is fresh: a value set on `window` in the first view is absent
  in the second;
- `top.location = …` from the page leaves Junk Drawer in place;
- a click on a link to another site opens a new browser page (Playwright's
  `context.waitForEvent('page')`) and the viewer still shows the page; a
  scripted `location.href = 'https://example.test/'` leaves the page in
  place and shows the notice with the URL;
- `alert()` from the page shows a dialog (Playwright `dialog` event);
- missing stored copy (delete the `files` row): the in-place error, not a
  blank frame, with "copy details"; `openCount` unchanged;
- an unknown id passed to `openPage`: a notice, no viewer;
- a page that fills `localStorage` past the quota: its `setItem` throws
  `QuotaExceededError` and Junk Drawer shows one notice;
- a write made in the same tick the viewer closes is stored;
- opening the page URL top-level (a new tab at `p/<id>/`) shows the "open
  this page from Junk Drawer" message and the page's script doesn't run.

## Done when

`node tests/run.cjs --only viewer` passes and the whole suite still passes.
Report every placeholder label you chose.
