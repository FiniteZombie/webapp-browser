# WP2: library logic and file checks

**Model:** Sonnet. **Stage 2, parallel.**

## Read first

- `docs/v1-plan/contracts.md`: sections 2, 5 (`errors.js`, `model.js`,
  `html-check.js`), 8, 9.
- `docs/spec.md`: "Adding a page" step 3, "The library", "When something goes
  wrong".
- `app/js/errors.js` (the codes) and `tests/README.md`.

## Files you own

`app/js/model.js`, `app/js/html-check.js`, `tests/unit/model.test.js`,
`tests/unit/html-check.test.js`.

## `model.js` (pure, no DOM, no storage)

- `normaliseTag`: trim, lowercase, runs of whitespace to one space.
- `parseTags`: accepts a comma-separated string or an array; drops empties;
  removes duplicates keeping first position.
- `matchKey(s)`: lowercase; trim; drop a trailing `.html` or `.htm`; drop a
  trailing ` (N)` (any digits, optional space before the bracket); collapse
  whitespace. So `Tip Splitter (1).html`, `tip splitter.htm` and
  `TIP  SPLITTER` all give `tip splitter`. Apply the two drops repeatedly
  until nothing changes (`a (1) (2).html`).
- `findSameName(pages, { name, fileName })`: a page matches when
  `matchKey(page.name)` or `matchKey(page.fileName)` equals
  `matchKey(name)` or `matchKey(fileName)`. Empty keys never match.
- `sortPages(pages, sortId)`: returns a new array. Pinned pages first, the
  same sort inside each group.
  - `name`: `localeCompare` with `{ sensitivity: 'base', numeric: true }`.
  - `recent-opened`: `lastOpenedAt ?? addedAt`, newest first.
  - `recent-added`: `addedAt`, newest first.
  - `most-opened`: `openCount`, highest first; ties by `recent-opened`.
  - Every remaining tie: by name, then by `id`, so the order is stable.
  - Unknown `sortId` behaves as `DEFAULT_SORT`.
- `filterPages(pages, activeTags)`: pages having every active tag; all pages
  when the list is empty.
- `SORTS` labels (placeholders): `name`, `recently opened`, `recently added`,
  `most opened`.

## `html-check.js`

`checkFile(file)` runs these in order and throws the first failure:

1. **Extension** (from `file.name`, case-insensitive): `.mhtml` or `.mht`
   gives `mhtml`; anything other than `.html` or `.htm` gives `wrong-type`.
2. **Size** 0 gives `empty`.
3. **Read** `await file.arrayBuffer()`; a throw gives `unreadable` with the
   cause.
4. **UTF-16**: bytes starting `FF FE` or `FE FF` are decoded as UTF-16 and
   re-encoded as UTF-8 with a BOM; that becomes `bytes`.
5. **Binary**: a known signature at the start (PNG, JPEG, GIF, PDF, ZIP,
   gzip, RIFF, `\x00\x00\x00` ISO media) or a NUL byte in the first 4096
   bytes gives `not-html`.
6. **Decode** as UTF-8. If the first 4096 characters hold a
   `<meta charset=…>` or `http-equiv` content-type naming another encoding
   that `TextDecoder` accepts, decode again with it. The decoded text is only
   for inspection; `bytes` stays as it is.
7. **MHTML content**: text starting with `From:` or `MIME-Version:` and
   containing `multipart/related` in the first 2000 characters gives `mhtml`.
8. Only whitespace gives `empty`.
9. **Looks like HTML**: the text must contain a tag from this set, else
   `not-html`: `!doctype html head body title meta script style div p span a
   img svg canvas main section table form input button ul ol pre h1-h6`
   (regex on `<name` followed by whitespace, `>` or `/`).
10. **Title**: parse with `DOMParser` (`text/html`); `title` is
    `doc.title.trim()` or `null` when empty.
11. **Sibling references**: empty list if `<base href>` is an absolute URL.
    Otherwise collect, in document order and de-duplicated, the raw values of
    `script[src]`, `link[href]` whose `rel` includes `stylesheet`, `icon`,
    `manifest`, `preload` or `modulepreload`, `img[src]`, `source[src]`,
    `video[src]`, `video[poster]`, `audio[src]`, `track[src]`, `iframe[src]`,
    `embed[src]`, `object[data]`, `input[type=image][src]`. A value counts
    when, trimmed, it's non-empty, doesn't start with `#` or `//`, and has no
    scheme (`/^[a-z][a-z0-9+.-]*:/i`). So `app.js`, `./css/a.css` and
    `/img/x.png` count; `https://…`, `data:…`, `blob:…` don't.

Every `JdError` carries `detail` with the file's name, type and size.

## Tests you write

`model.test.js`: tag normalising and parsing; `matchKey` on the examples
above plus `.HTM`, no extension, `(12)`; `findSameName` matching by name, by
file name, across the two, and not on empty; each sort including pins first,
never-opened pages under `recent-opened`, tie-breaks and input not mutated;
filter with zero, one and two tags.

`html-check.test.js` (build `File` objects in the test): each refusal code,
including a PNG renamed `.html`, MHTML content named `.html`, a `.mhtml`
name, an empty file, a whitespace-only file, plain text with no tags; title
from `<title>`, whitespace-collapsed, and `null` without one; a windows-1252
file with a declared charset gives the right title; a UTF-16LE file is
converted and still gives its title; sibling references found and absolute,
`data:`, `#` and `//` ones ignored; absolute `<base href>` gives none.

## Done when

`node tests/run.cjs --only model` and `--only html-check` pass.
