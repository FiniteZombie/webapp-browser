# WP13: phone checklist, screenshots and docs

**Model:** Sonnet. **Stage 7, runs alone**, after the review's fixes are in.

## Read first

- `docs/v1-plan/README.md`: sections "Decisions" and "What v1 can't prove
  without the phone".
- `docs/spec.md`: "Confirm on the phone", "Viewing a page".
- `AGENTS.md`, `tests/README.md`.
- The placeholder list the orchestrator gives you in the prompt.

## Files you own

`docs/phone-check.md`, `tests/tools/screenshots.cjs`, `AGENTS.md`,
`docs/spec.md` (the three edits below and nothing else).

## `docs/phone-check.md`

A checklist the owner works through once on the phone after the first
deploy, about ten minutes. Written for the owner, not for an agent: plain
steps, one action each, and for each step what they should see. Start with
how to install (open the Pages URL in Chrome, menu, "Add to home screen" or
"Install app"). Then:

1. The app opens from the home screen without browser bars and is called
   "Junk Drawer".
2. Adding a page from Downloads works. If tapping "add new page" does
   nothing or the picker comes back empty-handed, scroll to the bottom of
   the library, tap "use the simple picker", and try again; note that you
   had to.
3. On the added sheet, is there a "delete the downloaded file" box? If yes:
   tick it, note the prompts Android shows, and check in the Files app that
   the download is gone.
4. Press and hold a row: the action sheet opens, and no text-selection or
   browser menu appears.
5. Back gesture: from a page to the library; from the library out of the
   app; with a dialog open, back closes the dialog.
6. A page with its own screens: back steps through them before leaving.
7. A link to another site opens in the browser, and coming back shows the
   page as it was.
8. Aeroplane mode: the app opens and a page opens.
9. Saved data is still there after closing the app from recents and after
   restarting the phone.
10. The storage warning: is it showing in the library? (It should go away
    once installed; if it stays after a day of use, report it.)
11. A page that asks for the camera or location: the prompt names Junk
    Drawer.
12. After the next deploy: open the app, wait a few seconds, check the
    build in the footer changed and nothing was lost.

End with "If something's off": tap "copy diagnostics" in the library's
footer (or "copy details" on an error) and paste it to an agent with the
step number. If the app shows "Junk Drawer didn't start", copy what's in the
box on that screen instead.

## `tests/tools/screenshots.cjs`

A Node script (same server and Playwright as the tests) that seeds a few
pages and saves PNGs to `tests/out/screens/` at 412 by 915,
`deviceScaleFactor: 2`, in light and dark: empty library, library with
pinned and tagged pages and one chip on, the action sheet, the details
dialog, the added sheet with the delete box, the viewer, an error notice,
the remove confirmation, the footer's troubleshooting block. Prints the
paths. Run it and check each file exists and isn't blank.

## `AGENTS.md`

- Rewrite "Where we are": v1 is built; what exists; where the plan and
  contracts are.
- "Stack": keep "no build", and add the one exception: the deploy workflow
  stamps the commit into `sw.js`'s first line, and that line must stay
  exactly as it is. Replace the bullet about the worker serving old files
  with how updates work now.
- Add how to run the tests (`node tests/run.cjs`, needs Playwright
  resolvable by Node, present in cloud sessions; ask the owner before
  installing it anywhere else).
- Add a short "How pages are kept apart" paragraph pointing to
  `docs/v1-plan/contracts.md` section 1, including the known limits.
- Keep it short; keep the existing sections on the platform limit,
  dependencies and conventions.

## `docs/spec.md`

The owner made three choices while this plan was written. Make the spec say
them, changing as few words as possible:

1. "Viewing a page": back steps through the page's own screens first, then
   returns to the library; the "library" button always goes straight there.
2. "The library", per-page actions: tapping a row opens the page; pressing
   and holding it opens the other actions.
3. "Adding a page" steps 6 and 7: one sheet asks both.

Also add the two accepted limits to "Saved data" in one sentence (data
saved from a web worker or an inner frame isn't separated; separation
guards against accidents, not intent).

## Done when

The three docs read cleanly, the screenshot script ran, and
`node tests/run.cjs` still passes. Report the screenshot paths.
