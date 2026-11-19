# WP12: review (two reviewers, in parallel)

**Model:** Opus for both. **Stage 6.** Reviewers read and run; they change
nothing in `app/` or `tests/`. Each writes its full findings to a file under
`tests/out/` (gitignored) and reports only a short list.

## WP12a: does it do what the spec says?

### Read first

- `docs/spec.md`, all of it.
- `docs/v1-plan/README.md`, section "Decisions", and
  `docs/v1-plan/contracts.md` section 1 ("Known limits").
- `tests/README.md`.

### Do

1. Split the spec into individual checkable statements, section by section,
   from "Platform" to "When something goes wrong" plus "Look and wording".
   Skip "Later" and "Not planned" except for the check in step 4.
2. For each statement find the evidence: a test that asserts it (file and
   test name), or failing that the code that does it (file and function).
   Search with Grep; open only the parts of files you need. Mark each
   statement:
   - **tested**: a test asserts it;
   - **code only**: implemented, no test;
   - **phone only**: can't be shown in headless Chrome (file picker,
     delete from Downloads, install, permission prompts, back leaving the
     app);
   - **decided otherwise**: differs from the spec's words because of a
     decision in the README;
   - **missing** or **wrong**.
3. Run `node tests/run.cjs` once and record the result line.
4. "Later": confirm nothing blocks backup (all of a page's data is reachable
   through `db.js`) or the share sheet (`ingest` takes a file with no
   handle).
5. Write the full table to `tests/out/conformance.md`.

### Report (at most 40 lines)

The result line; counts per mark; then every **missing**, **wrong** and
**code only** statement, one line each: the statement in a few words, where
you looked, what you found.

## WP12b: can it lose data or get stuck?

### Read first

- `docs/v1-plan/contracts.md`, all of it.
- `docs/spec.md`: "Saved data", "Replacing a file", "Removing a page",
  "Platform" (the last bullet).
- Then the code, in this order, in full: `app/js/page-shim.js`,
  `app/js/inject.js`, `app/sw.js`, `app/js/db.js`, `app/js/viewer.js`,
  `app/js/app.js`. Don't read the other modules.

### Hunt for

- any path where a page runs without the shim, or with the shim half
  applied (an exception part-way through), and so touches shared storage;
- writes that can be lost or applied out of order: closing the viewer,
  reopening quickly, a page reloading itself, two opens in a row, an update
  reload arriving just after a write (`whenSaved`);
- an update reload that can fire in the middle of an add or replace, or
  while Android's file picker is up;
- a failed add or replace that leaves a half-written page; a remove that
  leaves a page's data behind, or deletes another page's;
- the update path: anything that could delete or orphan data, serve a mix of
  old and new files, loop on reload, or strand the app offline after a
  failed install;
- the service worker touching caches, databases or requests that aren't
  Junk Drawer's;
- any use of the real `localStorage` or `sessionStorage` by app code (Grep
  `app/` for both);
- any absolute URL path in `app/` (a leading `/` in `href`, `src`, `fetch`,
  `register`, `import`);
- page names, tags, file names or error text reaching `innerHTML`;
- ways the viewer can strand the owner: a blank frame, a history state that
  needs two backs, the "library" button doing nothing, the app reloaded or
  restored by Android while a page that made its own history entries was
  open.

For each suspicion, confirm it before reporting: write a throwaway test
under `tests/out/` and run it with Playwright, or trace the code until
you're sure. Don't report what you couldn't confirm as a finding; list it
separately as unverified.

Write the full notes to `tests/out/risk-review.md`.

### Report (at most 40 lines)

Confirmed findings, most serious first, one to three lines each: what
happens, the file and line, how you confirmed it. Then unverified
suspicions, one line each.
