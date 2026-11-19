# WP11: boot, wiring, updates and the full journeys

**Model:** Opus. **Stage 5, runs alone.** Every module exists; this package
turns them into the app.

## Read first

- `docs/v1-plan/contracts.md`: all of it.
- `docs/spec.md`: "Platform", "Adding a page", "Saved data" (the numbered
  list), "When something goes wrong" (first paragraph and "While using the
  app").
- `tests/README.md`. For the modules you wire, read their export lines only.

## Files you own

`app/js/app.js`, `tests/e2e/journey.e2e.cjs`, `tests/e2e/update.e2e.cjs`.

You may not edit other packages' files. If a journey test exposes a bug in
one, stop fixing, and list it in your report with the failing test's name,
the file at fault and what you saw. The orchestrator sends it to a fix
agent.

## `app.js`

Boot, in this order:

1. **Nothing fails silently.** `error` and `unhandledrejection` listeners on
   `window` that call `reportError`. (A page's own script errors happen in
   its iframe and never reach these; that's intended.)
2. `await initViewer()`, then `await initLibrary()`.
3. **Wire events** on `document`: `addPage` calls `addPageFlow()`;
   `replaceFile` calls `replaceFlow(detail.id)`; `openPage` calls
   `openPage(detail.id)`.
4. **Service worker.** If `navigator.serviceWorker` is missing, or
   `register('sw.js', { type: 'module', updateViaCache: 'none' })` rejects:
   `reportError(new JdError('sw-failed', { cause }))`. Don't await
   activation before showing the library.
5. **Persistent storage.** `await navigator.storage.persist()` if it exists
   (ignore a rejection), then dispatch `libraryChanged` so the library's
   storage warning is current.
6. `window.__jdReady = true`.

**Updates.** The installed app must pick up a deploy without a reinstall and
without losing anything.

- Note at boot whether `navigator.serviceWorker.controller` was set.
- On `controllerchange`: if there was a controller before, a new build has
  taken over: set `updatePending`. If there wasn't, this is the first
  install: just remember there is a controller now.
- Apply a pending update with `location.reload()` only when it's safe:
  `!isViewerOpen() && !hasOpenUi()`. Try on `controllerchange`, on
  `viewerClosed`, on `libraryChanged`, and when the document becomes visible.
- Ask for an update check (`registration.update()`, ignoring errors) at boot
  and each time the document becomes visible, at most once a minute.
- Guard against a reload loop: apply at most one reload per page load.

Nothing in `app.js` touches the real `localStorage` or `sessionStorage`.

## Tests you write

These run against the real app, through the UI, with
`t.helpers.setNextPick` standing in for Android's file picker.

`journey.e2e.cjs`:

- **first run:** empty library; "add new page"; the details step prefilled
  from the title; add; the added sheet; "open"; the page shows under the
  bar; "library" returns; the row is there with its tags and an open count
  of 1 in the database;
- **the spec's saved-data rules, end to end**, each as its own test:
  1. persists across views and an app reload;
  2. private to the page (the worked example: workout tracker and tip
     splitter, key `state`, `localStorage.clear()`);
  3. survives replacing the file (through the action sheet's "replace
     file");
  4. deleted when the page is removed: its `pageLocal` rows and its
     IndexedDB databases are gone, another page's remain;
  5. readable by Junk Drawer: `getLocalEntries` and `listPageDatabases`
     return the page's data;
- a page starts with empty saved data even when the real `localStorage`
  held a `state` key before it was added (set one in an init script), and
  that real key is untouched afterwards;
- after a whole journey (add, open, save, close, replace, remove),
  `t.helpers.realStorageKeys` shows Junk Drawer wrote nothing to the real
  `localStorage` or `sessionStorage`;
- same-name add offering replace, through the UI;
- a refused file (a `.png`) shows a notice that names it, has "copy
  details", stays until dismissed, and leaves the library unchanged;
- an error thrown in app code (dispatch an `openPage` with a bad detail, or
  reject a promise in the page) surfaces as a notice;
- offline: load once, go offline, reload: the library renders and a page
  opens;
- the app works when served from a sub-path (it already is: `/app/`): no
  request leaves `/app/` except the page's own.

`update.e2e.cjs` (the page may reload under you: poll from Node with
`try`/`catch` around `page.evaluate` rather than awaiting one long
evaluation):

- at the library with build `t1`: `server.setBuild('t2')`, override a
  stylesheet, trigger `registration.update()`: the app reloads by itself,
  the footer shows `t2`, and the pages, a page's saved data and the sort
  setting are all still there;
- while viewing a page the app does **not** reload; it does once the viewer
  closes;
- with a dialog open it does not reload; it does after the dialog closes
  and the next trigger fires;
- first install causes no reload (count `load` events).

## Done when

`node tests/run.cjs` passes in full. Your report lists any bugs you found in
other packages' files (see above) instead of fixes to them.
