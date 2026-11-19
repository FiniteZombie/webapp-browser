# WP4: the page shim and injection

**Model:** Opus. **Stage 2, parallel.**

The shim is the code that runs inside every page and gives it private saved
data. It's the highest-risk file in the app: a bug here corrupts or leaks a
page's data.

## Read first

- `docs/v1-plan/contracts.md`: sections 1 (all of it, including "Proven" and
  "Known limits"), 3, 5 (`inject.js`, `page-shim.js`, host object), 8, 9.
- `docs/spec.md`: "Viewing a page", "Saved data".
- `app/js/config.js`, `tests/README.md`.

## Files you own

`app/js/inject.js`, `app/js/page-shim.js`, `tests/unit/inject.test.js`,
`tests/unit/page-shim.test.js`.

## `inject.js` (pure)

- `doctypeEnd(bytes)`: decode the first 65536 bytes as latin1 (a long
  licence comment before the doctype is common enough; a short window would
  miss the doctype and put the page in quirks mode) and match, from the
  start: an optional UTF-8 BOM (`EF BB BF`), then any run of whitespace and
  `<!-- … -->` comments, then `<!doctype …>` (case-insensitive). Return the
  byte offset just after the doctype. With no doctype, return 3 if there is
  a BOM, else 0.
- `escapeForInlineScript(value)`: `JSON.stringify(value)` with every `<`
  replaced by the six characters backslash, `u`, `0`, `0`, `3`, `c`, and
  every character above `0x7F` replaced by its `\uXXXX` escape. The result
  is ASCII and can't close a script element.
- `inlineScript(shimSource, boot)`: bytes of
  `<script>(SHIM)(BOOT);document.currentScript.remove()</script>`, where
  `BOOT` is `escapeForInlineScript(boot)`. Throw if `shimSource` contains a
  non-ASCII character, `</script` (any case) or `<!--`.
- `buildPageParts(bytes, shimSource, boot)`:
  `[bytes up to doctypeEnd, inlineScript, the rest]`.

## `page-shim.js`

`export function pageShim(boot)`, self-contained (see contracts). Write it in
plain ES2020, ASCII only. In this order:

1. **Find the host.** `parent[boot.hostGlobal].connect(boot.pageId)` inside
   `try`. If there is no parent frame, no host, or `connect` returns `null`:
   call `window.stop()`, replace `document.documentElement.innerHTML` with a
   short plain message ("open this page from Junk Drawer"), and throw. The
   page's own scripts must never run in that case.
2. **`localStorage`.** A `Map` filled from `host.entries`, behind a `Proxy`
   over `Object.create(Storage.prototype)`:
   - methods `getItem`, `setItem`, `removeItem`, `clear`, `key`, and
     `length`; keys and values coerced with `String()`;
   - named access: `ls.foo`, `ls.foo = 1`, `delete ls.foo`, `'foo' in ls`,
     `Object.keys(ls)`, `JSON.stringify(ls)`, `for…in`;
   - a stored key that has a method's name (`getItem`, `length`…) is
     reachable through `getItem()` but doesn't shadow the method;
   - every change calls `host.apply(op, key, value)`;
   - **quota:** keep a running total of key and value lengths. A `setItem`
     that would take it over `boot.quotaChars` changes nothing, calls
     `host.notify('store-refused', { api: 'localStorage', detail })` and
     throws what Chrome throws: `new QuotaExceededError(message)` where that
     class exists, else `new DOMException(message, 'QuotaExceededError')`.
     Either way `err.name === 'QuotaExceededError'`.
   - Install with
     `Object.defineProperty(window, 'localStorage', { get, configurable: true })`.
3. **`sessionStorage`.** The same stand-in, filled from
   `host.sessionEntries` and reporting changes to `host.applySession`. No
   quota. (The host keeps it only while the page is open, so it survives the
   page reloading itself and is gone on the next open.)
4. **`indexedDB`.** Patch `IDBFactory.prototype` in this realm:
   - `open(name, …rest)` and `deleteDatabase(name, …rest)` prefix the name
     with `boot.dbPrefix`, passing the other arguments through unchanged
     (`open(name)` must stay a one-argument call);
   - `databases()` returns only this page's databases, names un-prefixed;
   - the `IDBDatabase.prototype.name` getter strips the prefix;
   - on each `open` request, listen for `error` on the request and for
     `error` and `abort` on the resulting database (they bubble up from
     transactions); when the error's name is `QuotaExceededError`, call
     `host.notify('store-refused', { api: 'indexedDB', detail })`. Don't
     interfere with the page's own handlers.
5. **Leaving the page.** If `window.navigation` exists, on `navigate`:
   - return when the destination is the same document, a hash change, a
     download (`downloadRequest !== null`), not `http:`/`https:`, or has the
     page's own origin and pathname (a reload, or a form posting to itself);
   - return when the event isn't cancelable;
   - otherwise `preventDefault()`, and then:
     - **same origin, another path** (a link to `about.html`, a file that
       sat beside the page): `host.notify('missing-file', { url })`;
     - **another site**, `userInitiated`: `window.open(url, '_blank', 'noopener')`;
     - **another site**, not user initiated (a script redirect):
       `host.notify('external-nav', { url })`.
6. `host.notify('ready')`.

Wrap every host call so a failure in the host can't throw into the page's
code (the quota error in step 2 is the one deliberate throw).

## Tests you write

`inject.test.js`: offsets for a plain doctype, uppercase, leading whitespace,
leading comment, BOM plus doctype, BOM and no doctype, no doctype, a legacy
long doctype; `inlineScript` escapes `<`, `</script>` inside a value and
non-ASCII; it throws on a shim source containing `</script` or a non-ASCII
character; `pageShim.toString()` passes that check (the real shim is ASCII
and safe).

`page-shim.test.js`: no service worker needed. For each test, write a small
HTML document as a string (doctype, then a script that records results on
`window.R`), encode it, pass it through
`buildPageParts(bytes, pageShim.toString(), boot)`, make a `Blob` of the
parts with type `text/html`, and load its object URL in an iframe in the
test document. Define a fake host on the test window under `HOST_GLOBAL`
that records `apply`, `applySession` and `notify` calls. Cover:

- standards mode kept (`document.compatMode`), the injected script removed
  from the DOM;
- every `localStorage` behaviour in step 2, `instanceof Storage`, and that
  the **real** `localStorage` of the test window is untouched;
- initial entries from the host are visible; changes arrive at
  `host.apply` in order with the right arguments;
- quota: an oversized `setItem` throws `QuotaExceededError`, changes nothing
  and notifies;
- `sessionStorage` starts from `host.sessionEntries`, reports changes to
  `host.applySession`, and the real `sessionStorage` of the test window is
  untouched;
- IndexedDB: two shimmed frames with different `dbPrefix` each create
  database `d` with different contents and don't see each other's;
  `db.name` is `d`; `indexedDB.databases()` lists only their own; the real
  names (seen from the test window) carry the prefixes; `deleteDatabase('d')`
  in one leaves the other;
- no host (`connect` returns `null`): the page's script never ran;
- navigation: `location.href = 'https://example.test/'` stays on the page
  and the host gets `external-nav` with the URL; a navigation to a
  same-origin URL with another path stays on the page and the host gets
  `missing-file`; a hash change is not intercepted;
- a doctype after a 3000-character comment still gives standards mode.

Clean up the databases and iframes each test creates.

## Done when

`node tests/run.cjs --only inject` and `--only page-shim` pass.
