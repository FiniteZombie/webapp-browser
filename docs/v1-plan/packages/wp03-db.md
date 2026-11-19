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

`app/js/db.js`, `tests/unit/db.test.js`, `tests/e2e/helpers.e2e.cjs`.

You're also the first agent able to exercise WP1's `seedPage` and `dbDump`
helpers, which call your module. If your helper test shows a bug in those
two functions in `tests/e2e/helpers.cjs`, fix it there (that file is
otherwise WP1's; nobody else edits it this stage) and list the fix under
`DEVIATIONS`.

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
  in the same transaction. A `put` can throw synchronously (a value that
  can't be cloned); if the first put has already been issued, the
  transaction would still commit it. So wrap the puts in `try`/`catch`, call
  `tx.abort()` in the catch, and reject.
- **Errors:** when a transaction aborts or errors with `QuotaExceededError`
  (check `tx.error` and the request's error), reject with
  `new JdError('storage-full', { cause })`. Reject other failures with the
  original error.
- `addPage({ name, fileName, tags, bytes, charset })`: new id;
  `pinned: false`, `openCount: 0`, `addedAt: Date.now()`,
  `lastOpenedAt: null`, `replacedAt: null`, `size: bytes.byteLength`. The
  `files` row is `{ id, bytes, charset: charset ?? null }`.
- `replaceFile(id, { fileName, bytes, charset })`: updates `fileName`,
  `size`, `replacedAt`, and the stored bytes and charset. Leaves name, tags,
  pin, open count and dates alone. Rejects (changing nothing) if the page
  doesn't exist.
- `getFile(id)`: `{ bytes, charset }`, or `undefined` when there's no row.
- `updatePage(id, patch)`: applies only `name`, `tags`, `pinned`; ignores
  other keys.
- `recordOpen(id)`: `openCount + 1`, `lastOpenedAt = Date.now()`.
- `getLocalEntries(pageId)`: all rows with key range
  `[pageId] … [pageId, []]`, as `[key, value]` pairs.
- `applyLocalOps(pageId, ops)`: applies the array in order inside one
  transaction: `set` puts a row, `remove` deletes one, `clear` deletes the
  page's key range. An empty array resolves without opening a transaction.
- `listPageDatabases(pageId)`: names from `indexedDB.databases()` starting
  with `PAGE_DB_PREFIX + pageId + ':'`.
- `removePage(id)`: one transaction deleting the `pages` row, the `files` row
  and the `pageLocal` range; then `indexedDB.deleteDatabase` for each name
  from `listPageDatabases(id)`. A `blocked` event is not a failure: keep
  waiting for `success`, but give each delete 3 seconds at most and then
  carry on (the page is gone from the library either way; a leftover
  database is invisible and harmless). Never let `removePage` hang.
- `getSetting(key, fallback)` returns `fallback` when the row is missing.

## Tests you write (`db.test.js`)

Each test file runs in a fresh browser context, so the database starts empty.

- add, list, get; the record has every `PageRecord` field with the defaults
  above; the stored bytes round-trip exactly through `getFile`; `charset`
  is `null` when not given and round-trips when given.
- `replaceFile` keeps name, tags, pin, `openCount`, `addedAt`,
  `lastOpenedAt` and changes `fileName`, `size`, `replacedAt` and the bytes.
- `replaceFile` on an unknown id rejects and creates nothing.
- **Atomicity:** make the `files` put fail (pass `bytes` that can't be
  cloned, such as an object holding a function) and check `addPage` rejects
  and `listPages()` is unchanged; same for `replaceFile` (old bytes still
  there).
- `updatePage` ignores unknown keys; `recordOpen` increments.
- Local entries: `set`, overwrite, `remove`, `clear`; several ops in one
  call apply in order (`set a`, `clear`, `set b` leaves only `b`); two pages
  using the same key hold different values; `clear` on one leaves the other.
- `removePage` removes the three kinds of rows for that page only, and
  deletes databases you create named `PAGE_DB_PREFIX + id + ':mine'` while
  leaving one for another page and one unrelated database.
- Settings: fallback, set, get.
- A `QuotaExceededError` abort surfaces as `JdError` code `storage-full`
  (simulate by wrapping: export nothing extra; instead trigger through a
  transaction you abort with a `DOMException` named `QuotaExceededError` if
  that's reachable through the public API, otherwise test the mapping
  function through a clearly marked `export const _test = { … }`).

`helpers.e2e.cjs` (uses `t.openApp({ boot: false })`): `seedPage` with
every optional field (`tags`, `pinned`, `openCount`, `addedAt`,
`lastOpenedAt`, `fileName`) and then `dbDump` shows a page with exactly
those values, a `files` entry of the right size, and empty `local`; after
`applyLocalOps` and creating a database named with the page prefix, `dbDump`
shows them under `local` and `databases`.

## Done when

`node tests/run.cjs --only db,helpers` passes.
