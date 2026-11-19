# webapp-browser

**webapp-browser** is the repo for **Junk Drawer**, a PWA the owner installs
on an Android phone from GitHub Pages
(`https://finitezombie.github.io/webapp-browser/`). The owner adds HTML web
apps they've downloaded; Junk Drawer keeps its own copy of each and gives a
library for finding and using them. No backend.

## Where we are

The repo has its git, editor and deploy setup and no app yet. What the app
does is in [`docs/spec.md`](docs/spec.md); build from that, not from this
file.

## Stack

Plain HTML, CSS and JavaScript in `app/`, served as-is: no build, no npm
packages, no framework. The manifest and service worker are hand-written.

- **Relative URLs only** inside `app/`. Pages serves it under
  `/webapp-browser/` and the dev server serves it at `/`; a leading `/` breaks
  one of them.
- **The service worker keeps serving old files** until its cache name
  changes, so an installed app won't pick up a deploy unless the worker
  handles updates.

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
