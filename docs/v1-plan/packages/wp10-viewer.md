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

You run alone, so you may also make **small fixes in other packages'
files** when one of your tests exposes a bug there: about 20 lines at most
per fix, each with a test that fails before and passes after, each listed
under `DEVIATIONS` with the file and what was wrong. Anything larger, or
anything that changes a contract: stop and report it.

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

**Layout.** `#viewer` is `position: fixed; inset: 0; z-index: var(--jd-z-viewer)`, a column: a top bar
(`--jd-bar-h` high, never scrolls away) with the page's name (one line,
ellipsis) and a "library" button; below it the iframe filling the rest
(`flex: 1; border: 0; width: 100%`). Use `100dvh`. Respect
`env(safe-area-inset-*)` on the bar.

**`openPage(id)`**

1. If a page is open or an open is under way, ignore the call. Set the
   "opening" flag **before the first `await`** (a double tap must not open
   twice); clear it on every exit path.
2. `page = await getPage(id)`; if missing, `reportError(JdError('page-missing'))`
   and stop (no history entry).
3. `await whenSaved()`, then load `entries = await getLocalEntries(id)` into
   a `Map`. This `Map` is the page's `localStorage` for as long as the
   viewer shows it. Start an empty `Map` for its `sessionStorage`.
4. Push the history entry (section 7), show `#viewer`, set `inert` on
   `#library`, put the name in the bar. From here on any failure is shown
   in place, under the bar.
5. `await navigator.serviceWorker.ready` and wait until
   `navigator.serviceWorker.controller` is set, 10 s at most in total; on
   failure show the in-place error `sw-failed`.
6. If `await getFile(id)` is undefined: show the in-place error
   `page-missing` and stop. Don't count the open.
7. `recordOpen(id)`; dispatch `libraryChanged`.
8. Create the iframe exactly as in contracts section 7 and append it.
9. **Watchdog:** if the iframe's `load` event fires and the shim hasn't
   called `notify('ready')` for this open, or nothing has happened after
   10 s, show the in-place error `page-unreadable`.

**In-place error.** Replace the iframe with a panel under the bar showing
`describe(err, { page })`: title, body, next, and a "copy details" button
(`copyButton` from `ui.js`). The bar and its "library" button stay. Never a
blank screen.

**Host object**

- `connect(pageId)`: `null` unless `pageId` is the open page; otherwise
  `{ entries, apply, sessionEntries, applySession, notify }` with the two
  entry lists copied from the current `Map`s. It's called again whenever
  the page reloads itself, and must return the current contents.
- `apply(op, key, value)`: update the `Map` synchronously and push the op
  onto a pending list for that page. One writer at a time: while a
  `applyLocalOps` call is in flight, ops pile up; when it settles, the whole
  pile goes in the next single call. (A page saving on every keystroke then
  costs one transaction per batch, not one per write.) If a write rejects,
  report `store-refused` once per open (not once per write) and carry on
  with later batches. Never throws.
- `applySession(op, key, value)`: update the session `Map`. Memory only.
- `whenSaved()`: resolves once the pending list is empty and no write is in
  flight. `openPage` awaits it before reading a page's entries, and
  `app.js` awaits it before reloading for an update.
- `notify('ready')`: marks this open as served.
- `notify('store-refused', { api, detail })`: a notice saying Junk Drawer
  couldn't save data for this page, once per open per `api`.
- `notify('external-nav', { url })`: a notice "“<name>” tried to go to
  another site", showing the URL, with the action
  `{ label: 'open in browser', href: url }`.
- `notify('missing-file', { url })`: a notice saying "“<name>” links to a
  file that was beside it, which Junk Drawer doesn't have", showing the
  file's name (the last part of the URL's path). At most one per open per
  file.
- `pageError(pageId, code, detail)`: show the in-place error for the open
  page.
- Late calls for a page that's no longer open are still applied to storage
  (a page can write as it's being closed) but raise no UI.

**Closing.** On `popstate` to the library entry: remove the iframe, hide
`#viewer`, remove `inert`, clear the open-page state and the session `Map`
(keep the pending writes going), dispatch `viewerClosed`. The "library"
button (including its fallback), the boot-time step and `isViewerOpen()` are
as in contracts section 7.

## Tests you write (`viewer.e2e.cjs`)

Use `t.openApp({ boot: false })`, then `t.helpers.ensureWorker(page)`, call
`initViewer()`, seed pages with `t.helpers.seedPage`, and open with
`openPage(id)`. Where a test needs the library underneath, call
`initLibrary()` too and wire `openPage` yourself in the test. Go back
with `page.evaluate(() => history.back())` (not `page.goBack()`, which waits
for a top-level navigation that never comes when only the iframe moves).

- the bar shows the name and a "library" button; the frame shows the page;
  `openCount` went up by one and `lastOpenedAt` is set;
- saved data: the page writes `localStorage`; close; reopen: the value is
  there; reload the whole app and reopen: still there; `sessionStorage`
  written in the first view is absent in the second, but survives the page
  reloading itself within one view;
- a page that does `setItem` then `location.reload()` sees the new value
  after the reload (a counter page that reloads itself three times ends at
  3);
- **the spec's worked example through the viewer:** two pages using key
  `state`; the second calls `localStorage.clear()`; the first still has its
  value; `listPages()` is intact;
- IndexedDB data written by a page is there on reopen;
- "library" button closes the viewer; `history.back()` closes it; after
  either, the library's `scrollY`, sort and active filter are what they were
  (seed 40 pages, init the library, scroll and set a filter first);
- a page with hash links: after two hash navigations, one `history.back()`
  leaves the viewer open on the earlier hash; the "library" button then
  closes it in one step and `history.state.jd` is `library`;
- **reload while viewing:** open a page, make two hash navigations,
  `page.reload()`, init again: `history.state.jd` is `library` and the
  viewer is closed; open the page again and the "library" button closes it
  in one step (this is Android discarding and restoring the app; a plain
  `history.back()` at boot fails this test);
- the "library" button's fallback: with `navigation.traverseTo` stubbed to
  reject, the button still closes the viewer and leaves state `library`;
- two `openPage` calls in the same tick create one iframe and one history
  entry;
- a link to `about.html` (a file beside the page) leaves the page in place
  and shows the missing-file notice; no new browser page opens;
- 500 `setItem` calls in a loop are all stored, in far fewer than 500
  transactions (count `applyLocalOps` calls by wrapping it, or just assert
  the final contents and that `whenSaved()` resolves);
- every open is fresh: a value set on `window` in the first view is absent
  in the second;
- `top.location = …` from the page leaves Junk Drawer in place;
- a click on a link to another site opens a new browser page (Playwright's
  `context.waitForEvent('page')`; route `https://example.test/**` to a
  canned response) and the viewer still shows the page; a scripted
  `location.href = 'https://example.test/'` leaves the page in place and
  shows the notice with the URL;
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
