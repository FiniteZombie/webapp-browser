# WP8: choosing a file, adding and replacing

**Model:** Opus. **Stage 3, parallel.** Needs WP2, WP3 and WP5, which are
done.

## Read first

- `docs/v1-plan/contracts.md`: sections 3, 5 (`errors.js`, `model.js`,
  `html-check.js`, `db.js`, `ui.js`, `picker.js`, `add-flow.js`), 8, 9.
- `docs/spec.md`: "Adding a page" (all of it, including "Deleting the
  original"), "Replacing a file", "When something goes wrong", "Confirm on
  the phone".
- `AGENTS.md`: "The platform limit".
- `tests/README.md`. For the modules you call, read their export lines, not
  their bodies.

## Files you own

`app/js/picker.js`, `app/js/add-flow.js`, `tests/e2e/add-flow.e2e.cjs`,
`tests/e2e/picker.e2e.cjs`.

## `picker.js`

Whether deleting a file in Downloads works on the owner's phone is unproven,
so nothing here assumes it. Detect, try, and fall back.

- **`pickFile()`**
  1. If `globalThis.__jdTest?.pickFile` is a function, return its result.
  2. If `window.showOpenFilePicker` exists and the `fsaBroken` setting isn't
     true: call it with
     `{ multiple: false, excludeAcceptAllOption: false, types: [{ description: 'HTML pages', accept: { 'text/html': ['.html', '.htm'] } }] }`,
     then `handle.getFile()`. Return `{ file, handle }`.
     - `AbortError` means the owner cancelled: return `null`.
     - Any other error: save its `name: message` to the `pickerLastError`
       setting and throw `JdError('picker-failed', { cause })`, whose
       message tells the owner to tap "add new page" again.
     - Set `fsaBroken` to true **only** when the error isn't
       `NotAllowedError` or `SecurityError`. Those two are transient (a
       double tap gives `NotAllowedError`), and latching on them would
       silently take away the delete offer for good. After `fsaBroken` is
       set, dispatch `libraryChanged` so the footer shows it.
  3. Otherwise use a hidden
     `<input type="file" accept=".html,.htm,text/html">` created for the
     call: resolve `{ file, handle: null }` on `change`, `null` on the
     input's `cancel` event. Remove the input afterwards.
  - Chrome on Android may ignore the type filter, so never assume the file
    is HTML; `checkFile` decides.
  - The library's footer lets the owner switch pickers by hand (it flips
    `fsaBroken`), which covers a phone where the full picker opens but
    never returns a file.
- **`canDeleteOriginal(handle)`**: true when `handle` has a `remove`
  function and the `deleteBroken` setting isn't true.
- **`deleteOriginal(handle)`**: call it straight from the tap handler (the
  permission prompt needs the tap).
  1. If `handle.requestPermission` exists, await
     `handle.requestPermission({ mode: 'readwrite' })`. Anything but
     `'granted'`: throw `JdError('delete-denied')`. A `NotAllowedError`
     thrown here is also `delete-denied`.
  2. `await handle.remove()`. On failure set `deleteBroken` to true,
     dispatch `libraryChanged` (the footer offers to turn it back on), and
     throw `JdError('delete-failed', { cause })`.
  - `delete-denied` leaves `deleteBroken` alone: the owner said no, the
    feature works.

## `add-flow.js`

`ingest({ file, handle }, opts)` does the whole flow. `addPageFlow()` and
`replaceFlow(pageId)` call `pickFile()` (reporting a thrown error with
`reportError` and returning `refused`; `null` returns `cancelled`) and then
`ingest`.

1. **Check.** `checkFile(file)`. On `JdError`: `reportError(err, { file })`,
   return `{ status: 'refused' }`. Nothing was written.
2. **Sibling files.** If `siblingRefs` isn't empty: `choiceDialog` saying the
   page refers to files that were beside it, that Junk Drawer doesn't have
   them and the page may not work, with the list, and choices "add anyway"
   and cancel. Cancel returns `cancelled`.
3. **Same name** (mode `add` only). Candidate name is the title, or
   `fileStem(file.name)` without one. `findSameName(await listPages(), …)`.
   If there are matches: `choiceDialog` with one choice per match ("replace
   “<name>”", at most three), then "add as a new page", and cancel. Choosing
   a replace switches to mode `replace` for that page and skips step 4.
4. **Details** (mode `add` only). `detailsDialog` with the candidate name,
   no tags on, and `allTags(pages)`. `null` returns `cancelled`. Pass the
   returned `tags` through `parseTags` before storing.
5. **Space.** If `navigator.storage.estimate` exists and
   `quota - usage < bytes.byteLength + 1_000_000`, treat as
   `JdError('storage-full')`.
6. **Write.** `db.addPage(…)` or `db.replaceFile(pageId, …)`, passing
   `bytes` and `charset` from `checkFile`. On error: `reportError`, return
   `refused`. The library is exactly as it was.
7. `navigator.storage.persist()` without awaiting or failing on it; dispatch
   `libraryChanged`.
8. **Added sheet.** `addedSheet({ title, canDelete, deleteDefault })`: title
   "added “<name>”" or "replaced the file for “<name>”"; `canDelete` from
   `canDeleteOriginal(handle)`; `deleteDefault` from the `deleteLast`
   setting (default `false`).
   - `null` means the sheet was dismissed: delete nothing, open nothing,
     and leave `deleteLast` alone.
   - When `canDelete` and a button was used, save the box's position to
     `deleteLast`.
   - If `deleteOriginal`: call `deleteOriginal(handle)`. On failure,
     `reportError(err, { file })`; the message says the downloaded file is
     still there (and for `delete-failed`, that Junk Drawer won't offer this
     again on this phone). The add stands.
   - If `open`: dispatch `openPage` with the id.
9. Return `{ status: 'added' | 'replaced', pageId }`.

Mode `replace` never changes the page's name, even when the new file has a
different title. An unexpected exception anywhere is caught, reported with
`reportError`, and returns `refused`.

## Tests you write

Use `t.openApp({ boot: false })`; drive the flow with
`page.evaluate(() => import('./js/add-flow.js').then(m => m.ingest(…)))` or
by setting the next pick with `t.helpers.setNextPick` and calling
`addPageFlow()`, answer dialogs through the DOM, and assert on
`t.helpers.dbDump`.

`add-flow.e2e.cjs`:

- happy path: name prefilled from `<title>`; from the file name when there's
  no title; edited name and tags stored (tags lowercased); bytes stored
  equal the file;
- cancelling the details step adds nothing;
- each refusal (wrong extension, `.mhtml`, empty, renamed PNG, MHTML
  content): a notice naming the file, `refused`, database unchanged;
- storage full (stub `navigator.storage.estimate` in an init script): the
  storage notice, nothing added;
- sibling files: the list is shown; cancel adds nothing; "add anyway"
  continues;
- same name: `Tip Splitter (1).html` against an existing "tip splitter"
  offers replace; replace keeps name, tags, pin, count and dates and swaps
  the bytes; "add as a new page" makes a second page; cancel changes
  nothing;
- `replaceFlow`: bytes replaced, name kept though the title differs, saved
  data rows (`pageLocal`) untouched; a refused replacement leaves the old
  bytes;
- added sheet: no checkbox when there's no handle; with a fake handle, box
  on then "back to library" calls `remove()`; "open" dispatches `openPage`;
  the box's last position is remembered, including unticked; dismissing the
  sheet (Escape) deletes nothing and doesn't change the remembered position;
- an undeclared windows-1252 file is stored with `charset: 'windows-1252'`;
- delete fails: notice shown, page still added, `deleteBroken` set, and the
  next add shows no checkbox; permission denied: notice, `deleteBroken` not
  set.

`picker.e2e.cjs`:

- with `showOpenFilePicker` removed in an init script, `pickFile()` uses the
  file input: answer Playwright's `filechooser` event with a file and get it
  back with `handle: null`;
- with `showOpenFilePicker` stubbed to throw `AbortError`: `null`;
- stubbed to throw a `TypeError`: `picker-failed`, `fsaBroken` set,
  `pickerLastError` saved, and the next call uses the input;
- stubbed to throw `NotAllowedError`: `picker-failed`, `fsaBroken` **not**
  set.

## Done when

`node tests/run.cjs --only add-flow` and `--only picker` pass. Report every
placeholder label you chose.
