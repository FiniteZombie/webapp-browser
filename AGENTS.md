# webapp-browser

**webapp-browser** is a PWA the owner installs on an Android phone from
GitHub Pages (`https://finitezombie.github.io/webapp-browser/`). It lists the
HTML files the owner has downloaded on the phone and gives a UI for browsing
and opening them. No backend.

## Where we are

The repo has its git, editor and CI setup and no app yet. The stack isn't
picked. The deploy workflow expects npm: `npm ci`, then `npm run check`
building into `dist/`, with the Vite `base` set to `/webapp-browser/`.

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

- Ask before adding any npm package, vendored file or program, and prefer
  ones with few dependencies.
- The committed `.npmrc` turns off install scripts, saves exact versions,
  skips releases younger than 7 days and blocks git dependencies. Don't loosen
  it. If a package can't work without its install script, ask. Install with
  `npm ci`.

## Repo conventions

- LF everywhere (`.gitattributes`, `.editorconfig`); batch files are CRLF.
- `.github/workflows/deploy-pages.yml` runs `npm run check` on every PR and
  push, and deploys `dist/` to GitHub Pages on a push to `main`. Actions are
  pinned by commit SHA, with the version in a comment.
- `local/` is gitignored: real HTML files copied off the phone for testing.
  They're personal and the repo is public, so never commit one or copy it into
  a test fixture.
- Before your final message, stop any dev server or browser you started, and
  nothing else. Say what you stopped.
