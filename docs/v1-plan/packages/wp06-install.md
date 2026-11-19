# WP6: manifest, icons and deploy

**Model:** Sonnet. **Stage 2, parallel.**

## Read first

- `docs/v1-plan/contracts.md`: sections 1 (the "Updates" bullet), 2, 6 (the
  first paragraph), 8, 9.
- `docs/spec.md`: "Platform".
- `.github/workflows/deploy-pages.yml`, `AGENTS.md`, `tests/README.md`.

## Files you own

`app/manifest.webmanifest`, `app/icons/*`, `tests/tools/make-icons.cjs`,
`tests/e2e/install.e2e.cjs`, `.github/workflows/deploy-pages.yml`.

## Manifest

```json
{
  "name": "Junk Drawer",
  "short_name": "Junk Drawer",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f2f2f2",
  "theme_color": "#f2f2f2",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

No `share_target` yet (it's a "Later" feature).

## Icons (placeholder)

- `app/icons/icon.svg`: a neutral grey rounded square with the letters "JD".
  Obviously temporary.
- `tests/tools/make-icons.cjs`: renders the SVG to the three PNGs with
  Playwright (a page of the right size, `omitBackground` off, screenshot).
  The maskable one keeps the letters inside the central 80% and fills the
  whole square with the background. Run it once and commit the PNGs. The
  script takes no arguments and prints the files it wrote.

## Deploy workflow

Edit `.github/workflows/deploy-pages.yml`:

1. Remove the `app` gate step, its `TODO` comment, and the two `if:` lines.
2. Add a step after checkout and before the upload:

   ```yaml
         - name: Stamp the build into the service worker
           run: |
             build="${GITHUB_SHA::7}"
             sed -i "s/^const BUILD = 'dev';/const BUILD = '${build}';/" app/sw.js
             grep -q "^const BUILD = '${build}';" app/sw.js
   ```

   The `grep` fails the deploy if the line wasn't found, so an unstamped
   worker can't ship.
3. Keep everything else: the triggers, permissions, concurrency, and the
   actions pinned by commit SHA with their version comments.

You can't run the workflow here. Check the YAML parses
(`python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <file>` if
PyYAML is present; otherwise read it back carefully) and run the two shell
lines locally against a copy of `app/sw.js` with `GITHUB_SHA` set, to prove
the `sed` and `grep` work on the stub's first line.

## Tests you write (`install.e2e.cjs`)

Use `t.openApp({ boot: false })`.

- the manifest is valid JSON with name "Junk Drawer", `display: standalone`,
  relative `start_url` and `scope`;
- each icon in the manifest is served, is a PNG, and has the pixel size it
  claims (load it in the page and read `naturalWidth`/`naturalHeight`);
- `index.html` links the manifest with a relative URL.

## Done when

`node tests/run.cjs --only install` passes, and your report shows the output
of the local `sed`/`grep` check.
