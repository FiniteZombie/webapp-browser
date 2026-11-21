# webapp-browser

**webapp-browser** is the repo for **Junk Drawer**, a PWA the owner installs
on an Android phone from GitHub Pages
(`https://finitezombie.github.io/webapp-browser/`). The owner adds HTML web
apps they've downloaded; Junk Drawer keeps its own copy of each and gives a
library for finding and using them. No backend.

## Where we are

v1 is built: library, add, replace and remove, viewer with per-page saved
data, offline use, updates. Since then: export page, and export and import of the
whole library as a backup zip (spec section "Backup and export"). What the app does is in
[`docs/spec.md`](docs/spec.md). How it was planned is in
[`docs/v1-plan/`](docs/v1-plan/README.md), and the fixed file layout and
interfaces are in [`docs/v1-plan/contracts.md`](docs/v1-plan/contracts.md).
What only the phone can prove is in [`docs/phone-check.md`](docs/phone-check.md).

## Stack

Plain HTML, CSS and JavaScript in `app/`, served as-is: no build, no npm
packages, no framework. The manifest and service worker are hand-written.
The one exception: the deploy workflow stamps the commit into the first line
of `app/sw.js`, and that line must stay exactly as it is.

- **Relative URLs only** inside `app/`. Pages serves it under
  `/webapp-browser/` and the dev server serves it at `/`; a leading `/` breaks
  one of them.
- **Updates:** the stamped first line makes `sw.js` differ on every deploy.
  The installed worker notices, caches the new files under the new build and
  takes over, and the app reloads once, only while the library is showing
  with no dialog or message open. The library footer shows the build.

## Tests

`node tests/run.cjs` (see [`tests/README.md`](tests/README.md)), with a
10-minute command timeout. It needs Playwright resolvable by Node, which cloud
sessions have; ask the owner before installing it anywhere else.
`node tests/tools/screenshots.cjs` saves screenshots to `tests/out/screens/`.

## How pages are kept apart

Every page runs on one web origin, so the app builds the separation of each
page's saved data itself. How, and the known limits (data saved from a web
worker or an inner frame isn't separated; it guards against accidents, not
intent), are in [`docs/v1-plan/contracts.md`](docs/v1-plan/contracts.md)
section 1.

## The platform limit

A web page can't read a phone folder by path, Downloads included. Files reach
the app only through the owner: a file picker, a directory picker where the
browser has one, or the share sheet (Web Share Target, via the manifest).
Check what Chrome on Android supports today before designing around any of
these, and say which one a feature depends on.

## Before you start a job

| The job | Load or read first |
| --- | --- |
| Adding a dependency, a vendored file, or installing a program | [Dependencies](#dependencies) below, and **ask the owner first** |
| Shell scripts, regexes, paths or commit messages on the owner's Windows PC (a cloud container is Linux: ignore its Git Bash, PowerShell and CRLF advice, but still write scripted edits to a file) | [`.agents/windows-tool-pitfalls.md`](.agents/windows-tool-pitfalls.md) |

## Dependencies

- The owner chose no dependencies. Ask before adding any npm package,
  vendored file, CDN script or program.
- If npm ever comes in, the committed `.npmrc` turns off install scripts,
  saves exact versions, skips releases younger than 7 days and blocks git
  dependencies. Don't loosen it.

## Repo conventions

- LF everywhere (`.gitattributes`, `.editorconfig`); batch files are CRLF.
- `.github/workflows/deploy-pages.yml` publishes `app/` to GitHub Pages on
  every push to `main` (or a manual run). Actions are pinned by commit SHA,
  with the version in a comment.
- Dev server: the `dev` configuration in `.claude/launch.json`, Python's
  `http.server` on `http://localhost:5180/` serving `app/`. Service workers
  need localhost or https, so never test from `file://`.
- `local/` is gitignored: real HTML files copied off the phone for testing.
  They're personal and the repo is public, so never commit one or copy it into
  `app/` or a test fixture.
- Before your final message, stop any dev server or browser you started, and
  nothing else. Say what you stopped.
