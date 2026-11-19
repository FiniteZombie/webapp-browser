'use strict';
// Saves phone-sized screenshots of the main screens to tests/out/screens/,
// in light and dark. Run: node tests/tools/screenshots.cjs
// Uses the same server and Playwright as the tests. Seeds fake pages only.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const server = require('../server.cjs');
const helpers = require('../e2e/helpers.cjs');

const OUT = path.join(__dirname, '..', 'out', 'screens');
const page_ = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;padding:24px}button{font-size:20px;padding:12px 20px}</style></head>
<body><h1>${title}</h1><p>${body}</p><button>Tap me</button></body></html>`;

const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const dialog = (page) => page.locator('#dialogs dialog[open]');

async function noDialogs(page) {
  await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'), null, { timeout: 5000 });
}

async function seed(page) {
  const day = 86400000;
  const now = Date.now();
  await helpers.seedPage(page, { name: 'Tip Splitter', tags: ['money', 'tools'], pinned: true, openCount: 12, addedAt: now - 9 * day, lastOpenedAt: now - day, html: page_('Tip Splitter', 'Split the bill.') });
  await helpers.seedPage(page, { name: 'Workout Log', tags: ['health'], pinned: true, openCount: 30, addedAt: now - 20 * day, lastOpenedAt: now - 2 * day, html: page_('Workout Log', 'Sets and reps.') });
  await helpers.seedPage(page, { name: 'Unit Converter', tags: ['tools'], openCount: 3, addedAt: now - 5 * day, html: page_('Unit Converter', 'Metres to feet.') });
  await helpers.seedPage(page, { name: 'Budget Tracker', tags: ['money'], openCount: 7, addedAt: now - 3 * day, html: page_('Budget Tracker', 'Spend less.') });
  await helpers.seedPage(page, { name: 'Recipe Scaler', tags: [], openCount: 0, addedAt: now - day, html: page_('Recipe Scaler', 'Scale a recipe.') });
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await server.start();
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, colorScheme: scheme,
      });
      const page = await helpers.openApp(context, srv.appUrl);
      const shot = async (name) => {
        await page.waitForTimeout(250);
        const file = path.join(OUT, `${name}-${scheme}.png`);
        await page.screenshot({ path: file });
        written.push(file);
      };

      await page.locator('.lib-empty').waitFor();
      await shot('01-empty-library');

      await seed(page);
      await page.locator('.lib-row').first().waitFor();
      const chip = page.locator('.lib-chips .ui-chip').filter({ hasText: 'tools' });
      await chip.click();
      await shot('02-library-pinned-tagged-chip');
      await chip.click();

      const row = page.locator('.lib-row').filter({ hasText: 'Unit Converter' });
      await row.click({ button: 'right' });
      await dialog(page).waitFor();
      await shot('03-action-sheet');
      await btn(dialog(page), 'edit').click().catch(() => {});

      // Details dialog: via "edit" if it opened one, otherwise via add.
      let details = dialog(page).filter({ has: page.getByLabel('name', { exact: true }) });
      if (!(await details.count())) {
        await page.keyboard.press('Escape');
        await noDialogs(page).catch(() => {});
        await helpers.setNextPick(page, { name: 'notes.html', html: page_('Notes', 'A page.'), withHandle: true });
        await btn(page, 'add new page').click();
        details = dialog(page);
        await details.waitFor();
      }
      await shot('04-details-dialog');
      await page.keyboard.press('Escape');
      await noDialogs(page).catch(() => {});

      // Added sheet with the delete box.
      await helpers.setNextPick(page, { name: 'notes.html', html: page_('Notes', 'A page.'), withHandle: true });
      await btn(page, 'add new page').click();
      await dialog(page).getByLabel('name', { exact: true }).waitFor();
      await dialog(page).locator('button[type=submit]').click();
      await dialog(page).filter({ hasText: 'back to library' }).waitFor();
      await shot('05-added-sheet-delete-box');
      await btn(dialog(page), 'open').click();

      // Viewer.
      await page.locator('#viewer iframe').waitFor();
      await page.waitForTimeout(500);
      await shot('06-viewer');
      await page.locator('#viewer').getByRole('button', { name: 'library', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('viewer').hidden);

      // Error notice: a file that isn't a web page.
      await helpers.setNextPick(page, { name: 'photo.png', type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3] });
      await btn(page, 'add new page').click();
      await page.locator('#notices .ui-notice').first().waitFor();
      await shot('07-error-notice');
      await page.evaluate(() => document.querySelectorAll('#notices .ui-notice').forEach((n) => n.remove()));

      // Remove confirmation.
      await page.locator('.lib-row').filter({ hasText: 'Recipe Scaler' }).click({ button: 'right' });
      await btn(dialog(page), 'remove').click();
      await dialog(page).filter({ hasText: 'deleted for good' }).waitFor();
      await shot('08-remove-confirmation');
      await btn(dialog(page), 'keep it').click();
      await noDialogs(page);

      // Footer troubleshooting block.
      await page.locator('.lib-trouble').scrollIntoViewIfNeeded();
      await shot('09-footer-troubleshooting');

      await context.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  for (const f of written) {
    const size = fs.statSync(f).size;
    if (size < 3000) throw new Error(`looks blank (${size} bytes): ${f}`);
    console.log(f);
  }
  console.log(`${written.length} screenshots in ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
