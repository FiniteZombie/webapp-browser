# WP3: storage layer

**Model:** Sonnet. **Stage 2, parallel.**

This module is why an update or a failed add never loses the library. Favour
plain, obviously correct code over clever code.

## Read first

- `docs/v1-plan/contracts.md`: sections 1, 3, 5 (`db.js`), 8, 9.
- `docs/spec.md`: "Saved data", "Replacing a file", "Removing a page", and the
  paragraph beginning "A failed add or replace".
- `app/js/config.js`, `app/js/errors.js`, `tests/README.md`.

## Files you own

`app/js/db.js`, `tests/unit/db.test.js`.

## Build

- No DOM, no `window`: the service worker imports this file. Use
  `indexedDB`, `crypto` and `self` only.
- One connection, opened lazily and cached as a promise. Create the four
  stores in `onupgradeneeded`. On `versionchange`, close the connection and
  drop the cached promise so the next call reopens. If the open fails, drop
  the cached promise so a later call can retry.
- Wrap each operation in one transaction and resolve on the transaction's
  `complete`, not on the request's `success`.
- **Atomic writes:** `addPage` and `replaceFile` put to `pages` and `files`
  in the same transaction.
- **Errors:** when a transaction aborts or errors with `QuotaExceededError`
  (check `tx.error` and the request's error), reject with
  `new JdError('storage-full', { cause })`. Reject other failures with the
  original error.
- `addPage({ name, fileName, tags, bytes })`: new id; `pinned: false`,
  `openCount: 0`, `addedAt: Date.now()`, `lastOpenedAt: null`,
  `replacedAt: null`, `size: bytes.byteLength`.
- `replaceFile(id, { fileName, bytes })`: updates `fileName`, `size`,
  `replacedAt`, and the stored bytes. Leaves name, tags, pin, open count and
  dates alone. Rejects (changing nothing) if the page doesn't exist.
- `updatePage(id, patch)`: applies only `name`, `tags`, `pinned`; ignores
  other keys.
- `recordOpen(id)`: `openCount + 1`, `lastOpenedAt = Date.now()`.
- `getLocalEntries(pageId)`: all rows with key range
  `[pageId] … [pageId, []]`, as `[key, value]` pairs.
- `applyLocalOp(pageId, { op, key, value })`: `set` puts a row, `remove`
  deletes one, `clear` deletes the page's key range.
- `listPageDatabases(pageId)`: names from `indexedDB.databases()` starting
  with `PAGE_DB_PREFIX + pageId + ':'`.
- `removePage(id)`: one transaction deleting the `pages` row, the `files` row
  and the `pageLocal` range; then `indexedDB.deleteDatabase` for each name
  from `listPageDatabases(id)`, awaiting each. A `blocked` event is not a
  failure: keep waiting for `success`.
- `getSetting(key, fallback)` returns `fallback` when the row is missing.

## Tests you write (`db.test.js`)

Each test file runs in a fresh browser context, so the database starts empty.

- add, list, get; the record has every `PageRecord` field with the defaults
  above; the stored bytes round-trip exactly.
- `replaceFile` keeps name, tags, pin, `openCount`, `addedAt`,
  `lastOpenedAt` and changes `fileName`, `size`, `replacedAt` and the bytes.
- `replaceFile` on an unknown id rejects and creates nothing.
- **Atomicity:** make the `files` put fail (pass `bytes` that can't be
  cloned, such as an object holding a function) and check `addPage` rejects
  and `listPages()` is unchanged; same for `replaceFile` (old bytes still
  there).
- `updatePage` ignores unknown keys; `recordOpen` increments.
- Local entries: `set`, overwrite, `remove`, `clear`; two pages using the
  same key hold different values; `clear` on one leaves the other.
- `removePage` removes the three kinds of rows for that page only, and
  deletes databases you create named `PAGE_DB_PREFIX + id + ':mine'` while
  leaving one for another page and one unrelated database.
- Settings: fallback, set, get.
- A `QuotaExceededError` abort surfaces as `JdError` code `storage-full`
  (simulate by wrapping: export nothing extra; instead trigger through a
  transaction you abort with a `DOMException` named `QuotaExceededError` if
  that's reachable through the public API, otherwise test the mapping
  function through a clearly marked `export const _test = { … }`).

## Done when

`node tests/run.cjs --only db` passes.
