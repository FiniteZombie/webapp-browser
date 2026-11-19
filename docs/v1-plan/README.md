# Junk Drawer v1: build plan

You are the **orchestrator**. Your job is to get version 1 of
[`../spec.md`](../spec.md) built by delegating to subagents, checking their
work with the test suite, and keeping every context small, your own
included. You write almost no code yourself.

Read this file and [`contracts.md`](contracts.md). Don't read the package
briefs in `packages/`, the spec, or the source files: the agents you spawn
read those.

## Where to run this

**A Claude cloud session** is the intended place. It has headless Chromium
and Playwright already installed, which the tests need, and nothing here
needs the phone.

On the owner's Windows laptop it also works, with two differences: Playwright
has to be available to Node, and `AGENTS.md` says to ask the owner before
installing anything; and `.agents/windows-tool-pitfalls.md` applies to you
and to every subagent (say so in each prompt).

Before starting, check and stop with a clear message if any fails:

- `git status` is clean and you're on the branch you were told to use;
- `node -e "require('playwright')"` exits 0;
- `app/` doesn't exist yet (if it does, a previous run got part-way: read
  "Resuming" below).

## Decisions

Made by the owner while this plan was written. They override the spec's
wording where they differ; WP13 updates the spec to match.

| Question | Decision |
| --- | --- |
| Back gesture inside a page with its own screens | Steps through the page's screens first, then the library. The "library" button always goes straight to the library. |
| Reaching per-page actions | Tap a row to open. Press and hold a row for a sheet with pin, edit, replace file, remove. Rows show no buttons. |
| "Delete the original?" and "Open it?" | One sheet after adding or replacing: a "delete the downloaded file" box, then "back to library" and "open". |
| Limits of per-page privacy | Accepted for v1: it guards against accidents, not intent; data saved from a web worker or an inner frame isn't separated. |

Made by the planner where the spec is silent. Each is cheap to change later;
list them in the final report so the owner can object.

- **Looks are placeholders**: system font, neutral greys, follows the
  phone's light or dark setting, a "JD" letter icon.
- **Default sort** is by name.
- **The delete box** starts unticked and then remembers its last position.
- **If deleting the download fails** for any reason other than the owner
  saying no, Junk Drawer stops offering it (the spec: "where it can't work,
  step 6 never appears"). A footer button turns the offer back on.
- **Updates apply by themselves**: the app reloads once, only while the
  library is showing with no dialog or message open. The footer shows the
  build.
- **Same-name check** offers "replace" for up to three matching pages.
- **A page's `localStorage` is capped** at 5 million characters, like
  Chrome's own limit, and each page gets its own allowance.
- **The file picker** shows HTML files by default but lets the owner switch
  to all files, because Chrome on Android can mislabel downloads.
- **The deploy workflow stamps the commit into `sw.js`**. This is the one
  step that isn't "served as-is"; without it an installed app can't tell a
  new deploy from the old one.
- **Tests use Playwright from the environment**. Nothing is added to the
  repo's dependencies or to the app.

## What v1 can't prove without the phone

The build doesn't depend on any of these: each has a fallback or is the
browser's own behaviour. WP13 writes a ten-minute checklist for the owner.

- Deleting a file in Downloads (`FileSystemHandle.remove()` on an Android
  content URI). If it fails on the phone the app says so once and stops
  offering it.
- `navigator.storage.persist()` being granted to the installed app. If not,
  the library shows the warning.
- Long-press firing as expected, the back gesture closing a dialog, links
  opening in the browser from the installed app, permission prompts naming
  Junk Drawer.

## Rules for keeping contexts small

These matter as much as the code. A bloated context costs the owner money
and produces wrong answers.

**For you**

1. Don't read source files, test files or package briefs. If you need to
   know something about the code, ask the agent that wrote it or spawn a
   reader with a narrow question.
2. Run only `node tests/run.cjs` (its output is capped). Never `cat` a file
   to "check" it; trust the gate.
3. Never fix code yourself beyond a one-line change you can make without
   reading the file. Anything more goes to a fix agent.
4. One fresh agent per package. Don't reuse an agent for a second package.
   Send a follow-up message to an agent only for a small correction to the
   package it just finished.
5. Keep what you retain from each report to its status, deviations,
   placeholders and open questions.

**For subagents** (the prompt template below says this)

1. Read the brief, the contract sections it names, and the files it names.
   Nothing else unless a test failure sends you there.
2. Edit only the files the brief lists.
3. Run tests with `--only`. Run the full suite once, at the end.
4. If a contract is wrong or something outside your files is broken, stop
   and report it. Don't work around it.
5. Report in the fixed format, 25 lines at most.

## The prompt for a package agent

Use `subagent_type: "general-purpose"` and the model the stage table gives.
Send exactly this, filling the three slots. Don't paste the brief or any
code into the prompt.

```
You're building one package of Junk Drawer v1 in /home/user/webapp-browser
(adjust the path if different).

Your brief: docs/v1-plan/packages/<file>.md
Read it first, then read what it tells you to read, and only that.

Rules:
- Edit only the files your brief lists. Other files are owned by agents
  working at the same time as you.
- docs/v1-plan/contracts.md is fixed. If it's wrong or lacks something you
  need, or a file you don't own is broken, stop and report; don't work
  around it.
- Run tests with: node tests/run.cjs --only <text>. Run the whole suite once
  when you think you're done. Don't start a dev server. Don't commit or push.
- Stop any browser or server you started.
<extra>

Finish with exactly this report, 25 lines at most:
STATUS: done | blocked | partial
FILES: <files you created or changed>
TESTS: <the RESULT line of your last full run> and <the RESULT line for your own tests>
DEVIATIONS: <anything you did differently from the brief or contracts, or "none">
PLACEHOLDERS: <labels, colours, wording you chose that the owner may want to change, or "none">
PROBLEMS: <contract gaps, bugs you saw in files you don't own, anything you couldn't finish, or "none">
```

`<extra>` is empty unless this file or a previous report gives you
something to pass on (for example a contract change made since the brief
was written). For the review agents (WP12) drop the first two rules and the
report format; their brief has its own.

## Stages

Spawn the agents of a stage in **one message** so they run in parallel, then
wait for all of them. Don't start a stage until the previous gate has
passed.

| Stage | Package | Brief | Model | Depends on |
| --- | --- | --- | --- | --- |
| 1 | WP1 scaffold and test harness | `wp01-scaffold.md` | sonnet | none |
| 2 | WP2 library logic and file checks | `wp02-logic.md` | sonnet | WP1 |
| 2 | WP3 storage layer | `wp03-db.md` | sonnet | WP1 |
| 2 | WP4 page shim and injection | `wp04-shim.md` | opus | WP1 |
| 2 | WP5 dialogs, notices, base styles | `wp05-ui.md` | sonnet | WP1 |
| 2 | WP6 manifest, icons, deploy | `wp06-install.md` | sonnet | WP1 |
| 3 | WP7 service worker | `wp07-sw.md` | opus | WP3, WP4 |
| 3 | WP8 picker, add and replace | `wp08-add-flow.md` | opus | WP2, WP3, WP5 |
| 3 | WP9 library view | `wp09-library.md` | sonnet | WP2, WP3, WP5 |
| 4 | WP10 viewer | `wp10-viewer.md` | opus | WP3, WP4, WP5, WP7 |
| 5 | WP11 boot, updates, journeys | `wp11-app.md` | opus | everything above |
| 6 | WP12a spec conformance review | `wp12-review.md` | opus | WP11 |
| 6 | WP12b data-safety review | `wp12-review.md` | opus | WP11 |
| 7 | WP13 phone checklist, screenshots, docs | `wp13-wrapup.md` | sonnet | fixes from stage 6 |

Why this shape: stage 1 creates every file as a stub plus the test harness,
so stage 2's five agents can't collide and can each run their own tests.
Stages 4 and 5 are single agents because they integrate everything and their
tests drive the whole app; splitting them would have several agents
debugging the same failures.

For WP12, tell each reviewer which half of the brief is theirs ("you are
WP12a" or "you are WP12b").

## The gate after every stage

1. Read each report. Any `STATUS: blocked` or non-empty `PROBLEMS`: handle
   it (below) before going on.
2. Run `node tests/run.cjs`. It must end `RESULT: PASS`.
3. `git status --short`: every changed file should belong to a package of
   this stage (the layout in `contracts.md` section 2 says who owns what).
   A file changed by a non-owner is a problem to resolve, not to commit.
4. Commit everything with a message naming the stage and packages, and push
   to the working branch (a cloud container is temporary; unpushed work can
   be lost). Never push to `main`.

## When something goes wrong

- **Tests fail at a gate.** From the runner's output, work out which
  package owns each failing test (the test file's name tells you). Spawn one
  fix agent per owning package, same model as the package, with: the brief's
  path, the failing test names, and the failure lines (30 at most). Fix
  agents follow the same rules and report format.
- **A failing test belongs to one package but the fault is in another's
  file.** The fix agent will report that under `PROBLEMS`. Spawn a fix agent
  for the package that owns the faulty file, quoting the finding.
- **A contract is wrong.** Decide the change, edit `contracts.md` yourself
  (this is the one file you do edit), and tell every agent it affects:
  running ones by message, later ones through `<extra>`. Record the change
  for the final report.
- **Two rounds of fixes haven't cleared a failure.** Stop and ask the owner,
  giving the test name, what was tried, and the failure lines. Don't weaken
  or delete a test to get a pass, and don't skip one.
- **A spec rule turns out to be unbuildable** (the spec names this for
  IndexedDB privacy and backup): stop and ask the owner. Don't quietly drop
  it.
- **An agent's report is missing or vague.** Ask it once for the report
  format. Don't go and read its files instead.

## Stage 6: acting on the reviews

Each reviewer returns a short list. For every confirmed finding and every
"missing" or "wrong" spec statement:

1. Group them by the package that owns the file at fault.
2. Spawn one fix agent per package (same model as the package), giving it
   its brief's path and its findings verbatim. Each fix comes with a test
   that fails before and passes after.
3. Run the gate.

"Code only" statements (implemented but untested): have the owning package's
agent add the test if it's a saved-data, add/replace/remove or update rule;
otherwise list it in the final report. Don't re-run the reviewers.

## Finishing

1. Run the full suite one last time; it must pass.
2. Make sure everything is committed and pushed to the working branch. Don't
   open a pull request and don't merge to `main` unless the owner asks:
   pushing to `main` deploys.
3. Stop anything you started. Send the owner the screenshots from WP13 if
   your tools allow.
4. Report to the owner, briefly:
   - what was built and the final test result;
   - **placeholders** to review (collected from the reports): looks,
     labels, wording, icon;
   - the planner's decisions above, and any contract changes you made;
   - anything left "code only" or unverified by the reviewers;
   - what to do next: merge the branch to `main` to deploy, then work
     through `docs/phone-check.md` on the phone;
   - what you stopped.

## Resuming

If a run was interrupted: `git log --oneline` shows the last stage
committed. Uncommitted changes belong to the stage in progress; run the
suite, and if it doesn't pass, discard only that stage's uncommitted files
(`git status` lists them; ask the owner first if anything looks like it
isn't the build's) and redo the stage.
