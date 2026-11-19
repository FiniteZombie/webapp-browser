# WP5: dialogs, sheets, notices and base styles

**Model:** Sonnet. **Stage 2, parallel.**

## Read first

- `docs/v1-plan/contracts.md`: sections 4, 5 (`errors.js`, `ui.js`), 8, 9.
- `docs/spec.md`: "When something goes wrong" (the first list), "Look and
  wording", and "Adding a page" steps 4, 6 and 7.
- `app/index.html`, `app/js/errors.js`, `tests/README.md`.

## Files you own

`app/js/ui.js`, `app/styles/base.css`, `tests/e2e/ui.e2e.cjs`.

## Look (placeholder, the owner will restyle)

- System font. Neutral greys. Follows the phone's light or dark setting with
  `prefers-color-scheme`. One accent colour, a plain blue, defined once as
  `--jd-accent`. Define every token in contracts section 4 for both schemes.
- Phone first: touch targets at least 48px high, readable at 412px wide,
  nothing depends on hover.
- Dialogs and sheets are `<dialog>` elements. A **sheet** sits at the bottom
  of the screen, full width, rounded top corners; a **dialog** is centred.
  Position them with `inset`/`margin`, **never `transform`** (and no
  `filter` or `contain`): a transformed dialog becomes the containing block
  for the fixed-position notices moved into it, and they land in the wrong
  place.
- `base.css` also defines the tokens in contracts section 4, including the
  two layer tokens, and `[hidden] { display: none !important; }`.
- Buttons: `.ui-btn`, `.ui-btn-primary`, `.ui-btn-danger`. A danger button is
  marked by its label and a heavier border as well as colour.
- A visible focus ring on everything focusable.

## `ui.js`

Build each element with DOM methods and `textContent`. Never put a page name,
tag, file name or error text through `innerHTML`.

- **`showNotice`**: appends a card to `#notices` (a column fixed to the top
  of the screen, above dialogs and the viewer; scrolls if there are many).
  Title, body, the `next` line when non-empty, a "copy details" button when
  `detail` is non-empty (a `copyButton` whose `getText` returns the
  detail), any `actions`, and "dismiss". It never dismisses itself.
  - A notice must stay reachable while a modal `<dialog>` is open. A modal
    dialog makes the rest of the page inert, so while a dialog is open, move
    `#notices` into that dialog element, and move it back to `<body>`
    **before** the dialog element is removed. (A `popover` does not work for
    this: shown above a modal dialog it is visible but can't be clicked.
    Tested.) Test that a notice raised under an open dialog can be
    dismissed, and that one raised before a dialog opens is still there and
    clickable while it's open and after it closes.
- **`copyButton({ label, getText })`**: returns a button. On click it builds
  `await getText()` + a blank line + `await environmentDetail()` and calls
  `navigator.clipboard.writeText`. On success the button reads "copied" for
  two seconds. If that rejects, it inserts a read-only `<textarea>` holding
  the text straight after the button, focused and selected, so it can be
  copied by hand.
- **`reportError(err, ctx)`**: `showNotice(describe(err, ctx))`, and
  `console.error(err)`.
- **`hasOpenUi()`**: true when any dialog is open or any notice is showing.
- **`confirmDialog`**: title, body, two buttons. Resolves `true` only from
  the confirm button.
- **`choiceDialog`**: title, body, optional `list` (shown as a `<ul>`, at
  most 10 items then "and N more"), one full-width button per choice in the
  order given, then "cancel". Resolves the choice id, or `null`.
- **`actionSheet`**: a sheet with the title and one row per action. Resolves
  the action id, or `null`.
- **`detailsDialog`**: a form with
  - a name field, prefilled, required: submitting it empty (after trimming)
    keeps the dialog open and shows "give the page a name" next to the field;
  - tags: one toggle chip per entry of `allTags` (`aria-pressed`; the on
    state shows a check mark before the label as well as a filled look),
    preset on for those in `tags`; and a text field "new tags, separated by
    commas";
  - submit (label from `submitLabel`) and "cancel".
  Resolves `{ name: trimmed, tags }`, or `null`. `tags` is the labels of
  the chips that are on, followed by the typed text split on commas, each
  piece trimmed, empty pieces dropped. Don't normalise or de-duplicate:
  the caller does that. `ui.js` must not import `model.js`.
- **`addedSheet`**: a sheet with the title; when `canDelete`, a checkbox
  "delete the downloaded file from this phone", initially `deleteDefault`;
  buttons "back to library" and "open". A button resolves
  `{ deleteOriginal, open }` (`deleteOriginal` is `false` when `canDelete`
  is false); dismissing the sheet resolves `null`.
- Only one dialog shows at a time: a second call waits for the first to
  close.
- Dismissal: handle the dialog's `cancel` and `close` events, and for sheets
  a tap outside the sheet: count it only when both the `pointerdown` and the
  `click` landed on the `<dialog>` element itself (the backdrop), not on
  anything inside it. Resolve exactly once and remove the element.
- **A sheet opened by a long press must survive the finger lifting.** Ignore
  every activation inside a sheet or on its backdrop until the sheet has
  seen a `pointerdown` or `keydown` of its own after opening.

## Tests you write (`ui.e2e.cjs`)

Drive `ui.js` by importing it inside the page
(`page.evaluate(() => import('./js/ui.js'))`), then act through the DOM.

Use `t.openApp({ boot: false })`.

- a notice shows title, body and next; stays after 3 seconds; "dismiss"
  removes it; "copy details" puts the detail and the environment lines on
  the clipboard (grant clipboard permissions in the test context) and, with
  the clipboard rejected, shows the textarea;
- a notice raised while a dialog is open is visible, sits at the top of the
  screen (check its bounding box) and its "dismiss" is clickable; a notice
  raised before a dialog opens survives the dialog opening and closing;
- a sheet that has seen no `pointerdown` of its own ignores a `click` on its
  backdrop and on an action (dispatch the events directly); after a real
  click it responds;
- `reportError` with a `JdError('wrong-type')` and a file shows the file's
  name;
- `confirmDialog` resolves `true`/`false` for each button and `false` on
  Escape;
- `choiceDialog` lists items, caps at 10 with "and N more", resolves the id;
- `actionSheet` resolves the tapped id and `null` on backdrop tap;
- `detailsDialog`: prefill, empty name refused with the message, chip
  toggles, typed tags returned trimmed after the on chips with empties
  dropped, cancel gives `null`;
- `addedSheet`: no checkbox when `canDelete` is false; each button with the
  box on and off; Escape gives `null`;
- `copyButton` on its own: copies `getText()`'s text plus environment lines;
- a page name containing `<img src=x onerror=…>` renders as text;
- `hasOpenUi()` in each state.

## Done when

`node tests/run.cjs --only ui` passes. Report every placeholder label and
colour you chose.
