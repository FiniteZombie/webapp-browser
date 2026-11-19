# WP9: the library view

**Model:** Sonnet. **Stage 3, parallel.** Needs WP2, WP3 and WP5, which are
done.

## Read first

- `docs/v1-plan/contracts.md`: sections 3, 4, 5 (`errors.js`, `model.js`,
  `db.js`, `ui.js`, `library.js`), 8, 9.
- `docs/spec.md`: "The library", "Removing a page", "Look and wording", and
  under "When something goes wrong" the bullet about persistent storage.
- `app/index.html`, `app/styles/base.css` (the tokens and button classes),
  `tests/README.md`. For the modules you call, read their export lines, not
  their bodies.

## Files you own

`app/js/library.js`, `app/styles/library.css`, `tests/e2e/library.e2e.cjs`.

## What the owner chose

- Rows show the page's name and tags and nothing else to tap. **Tapping a
  row opens the page. Pressing and holding a row opens a sheet of actions.**
- Pinned rows carry a pin mark.

## Build

`initLibrary()` is idempotent. It renders into `#library` and re-renders on
the `libraryChanged` event. It imports `db.js`, `model.js`, `ui.js`,
`config.js` and `errors.js` only; it reaches everything else by dispatching
events (contracts section 3).

Layout, top to bottom:

1. **Header:** "junk drawer" and an "add new page" button (dispatches
   `addPage`).
2. **Storage warning**, only while `navigator.storage.persisted()` resolves
   false: says this phone may clear the pages and their saved data when it
   runs short of space, and that installing Junk Drawer to the home screen
   usually fixes it. Not dismissible. Check on every render.
3. **Controls** (hidden when the library is empty): a labelled `<select>`
   for the sort (`SORTS`); a row of tag chips, one per tag in use,
   alphabetical. A chip is a button with `aria-pressed`; the on state shows a
   check mark before the label as well as a filled look.
4. **List:** `sortPages(filterPages(pages, activeTags), sort)`. Each row is
   one `<button>` holding the pin mark (pinned only: a pin glyph plus
   visually hidden text "pinned"), the name, and the tags as plain text
   below. When a filter leaves nothing: "no pages have all of those tags".
5. **Empty library:** one or two sentences on what Junk Drawer is for (a
   place for the HTML web apps Claude or Gemini made you) and an "add new
   page" button.
6. **Footer:** the hint "press and hold a page for more"; "build <id>" from
   `getBuild()`; a "copy diagnostics" button (copies
   `environmentDetail()`); and, only when the `deleteBroken` setting is
   true, a button "offer to delete downloaded files again" that clears it.

State:

- **Sort** is read from the `sort` setting at start (default `DEFAULT_SORT`)
  and saved on change.
- **Active tags** live in memory only, so they clear on each launch. When a
  tag is no longer in use, drop it from the active set.
- Re-rendering must not move the scroll position: replace the list's
  children in place; never rebuild `#library` from scratch after the first
  render.

Tap and hold:

- A tap (`click`) dispatches `openPage` with the id.
- Open the action sheet on **either** of these, whichever comes first, and
  never twice: the row's `contextmenu` event (Chrome on Android fires it on
  a long press; it also covers right-click and the keyboard menu key); or a
  touch pointer held 500 ms without moving more than 10px (cancel on
  `pointerup`, `pointercancel`, `pointerleave` and scroll).
- `preventDefault()` the `contextmenu`. After a hold opened the sheet, swallow
  the `click` that follows.
- On rows: `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation`.

Action sheet (`actionSheet`, titled with the page's name):

- "pin" or "unpin": `updatePage(id, { pinned })`.
- "edit name and tags": `detailsDialog` with the current values and
  `allTags`; on submit `updatePage`.
- "replace file": dispatch `replaceFile` with the id.
- "remove": `confirmDialog` (danger) saying "“<name>” and its saved data will
  be deleted for good"; on confirm `removePage(id)`.
- After each change dispatch `libraryChanged`. Wrap each action in
  `try`/`catch` and `reportError(err, { page })`.

All text goes in with `textContent`.

## Tests you write (`library.e2e.cjs`)

`app.js` may still be a stub: call `openApp()`, then
`page.evaluate(() => import('./js/library.js').then(m => m.initLibrary()))`,
seed with `t.helpers.seedPage`, and act through the DOM. Listen for the
events the library dispatches by adding a listener in the page.

- empty library shows the explanation and an add button, which dispatches
  `addPage`; no controls;
- rows show name and tags; a tap dispatches `openPage` with the right id;
- pinned pages come first under every sort, and carry the "pinned" text;
- each of the four sorts gives the expected order (seed explicit dates and
  counts), including a never-opened page under "recently opened";
- the chosen sort survives a reload; an active tag filter does not;
- tag chips: one per tag in use; two on shows only pages with both; a pinned
  page that doesn't match is hidden; turning a chip off restores;
  `aria-pressed` and the check mark follow the state;
- right-click on a row opens the sheet (and no `openPage` is dispatched);
  a 600 ms touch hold opens it once (dispatch pointer events with
  `pointerType: 'touch'`); a hold that moves 30px does not;
- pin, then unpin, through the sheet;
- edit: rename and change tags; a tag used by no page disappears from the
  chips and from the active filter;
- "replace file" dispatches `replaceFile`;
- remove: the confirm names the page; cancel keeps it; confirm deletes the
  page, its file and its saved-data rows;
- scroll position is unchanged after a `libraryChanged` re-render (seed 40
  pages, scroll, dispatch, compare `scrollY`);
- storage warning shows when `navigator.storage.persisted` is stubbed to
  false and not when stubbed to true;
- the footer shows the build; "offer to delete…" appears only with
  `deleteBroken` set, and clears it;
- a page named `<img src=x onerror=alert(1)>` renders as text.

## Done when

`node tests/run.cjs --only library` passes. Report every placeholder label
you chose.
