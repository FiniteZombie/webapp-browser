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
- Buttons: `.ui-btn`, `.ui-btn-primary`, `.ui-btn-danger`. A danger button is
  marked by its label and a heavier border as well as colour.
- A visible focus ring on everything focusable.

## `ui.js`

Build each element with DOM methods and `textContent`. Never put a page name,
tag, file name or error text through `innerHTML`.

- **`showNotice`**: appends a card to `#notices` (a column fixed to the top
  of the screen, above dialogs and the viewer; scrolls if there are many).
  Title, body, the `next` line when non-empty, a "copy details" button when
  `detail` is non-empty, any `actions`, and "dismiss". It never dismisses
  itself. "copy details" uses `navigator.clipboard.writeText`; if that
  rejects, show the detail in a read-only `<textarea>` inside the card,
  selected, so it can be copied by hand. After a successful copy the button
  reads "copied" for two seconds.
  - A notice must stay reachable while a modal `<dialog>` is open. A modal
    dialog makes the rest of the page inert, so while any dialog is open,
    move `#notices` into the topmost open dialog and move it back on close
    (or use `popover="manual"` on `#notices` and re-show it after each
    `showModal()` so it sits in the top layer above the dialog). Test this.
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
  Resolves `{ name: trimmed, tags }` where `tags` is the on chips plus the
  typed ones through `parseTags` (import it from `model.js`), or `null`.
- **`addedSheet`**: a sheet with the title; when `canDelete`, a checkbox
  "delete the downloaded file from this phone", initially `deleteDefault`;
  buttons "back to library" and "open". Resolves
  `{ deleteOriginal, open }`; `deleteOriginal` is always `false` when
  `canDelete` is false or the sheet was dismissed.
- Only one dialog shows at a time: a second call waits for the first to
  close.
- Dismissal: handle the dialog's `cancel` and `close` events, and a tap on
  the backdrop for sheets. Resolve exactly once and remove the element.

## Tests you write (`ui.e2e.cjs`)

Drive `ui.js` by importing it inside the page
(`page.evaluate(() => import('./js/ui.js'))`), then act through the DOM.

- a notice shows title, body and next; stays after 3 seconds; "dismiss"
  removes it; "copy details" puts the detail on the clipboard (grant
  clipboard permissions in the test context) and, with the clipboard
  rejected, shows the textarea;
- a notice raised while a dialog is open is visible and its "dismiss" is
  clickable;
- `reportError` with a `JdError('wrong-type')` and a file shows the file's
  name;
- `confirmDialog` resolves `true`/`false` for each button and `false` on
  Escape;
- `choiceDialog` lists items, caps at 10 with "and N more", resolves the id;
- `actionSheet` resolves the tapped id and `null` on backdrop tap;
- `detailsDialog`: prefill, empty name refused with the message, chip
  toggles, typed tags normalised and merged, cancel gives `null`;
- `addedSheet`: no checkbox when `canDelete` is false; each button with the
  box on and off; Escape gives both `false`;
- a page name containing `<img src=x onerror=…>` renders as text;
- `hasOpenUi()` in each state.

## Done when

`node tests/run.cjs --only ui` passes. Report every placeholder label and
colour you chose.
