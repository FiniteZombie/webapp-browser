'use strict';
// Export library, import library, export page: the whole app, booted for
// real, driven through the UI. A second browser context stands in for the
// other phone. Downloads are real Playwright downloads; the share sheet is
// a stub (headless Chromium on Linux has none).

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', 'out');

const PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body><p id="x">${title}</p></body></html>`;

const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const openDialog = (page, text) => page.locator('#dialogs dialog[open]', { hasText: text });
const row = (page, name) => page.locator('.lib-row').filter({
  has: page.locator('.lib-name', { hasText: new RegExp(`^${name}$`) }),
});

async function boot(t, page) {
  page = page || await t.openApp();
  await page.waitForFunction(() => {
    const c = navigator.serviceWorker.controller;
    return c && c.state === 'activated';
  }, null, { timeout: 10_000 });
  return page;
}

async function noDialogs(page) {
  await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'), null, { timeout: 5000 });
}

async function frameOf(t, page) {
  for (let i = 0; i < 200; i++) {
    const f = t.helpers.viewerFrame(page);
    if (f) {
      await f.waitForLoadState('load');
      await f.waitForFunction(() => document.readyState === 'complete');
      return f;
    }
    await sleep(25);
  }
  throw new Error('no viewer frame appeared');
}

async function openPage(t, page, name) {
  await row(page, name).click();
  return frameOf(t, page);
}

async function backToLibrary(page) {
  await page.locator('#viewer').getByRole('button', { name: 'library', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('viewer').hidden, null, { timeout: 5000 });
}

// Saves data from inside the page, through Junk Drawer's shim.
async function saveInPage(frame, { local, idb }) {
  await frame.evaluate(async ({ local, idb }) => {
    for (const [k, v] of Object.entries(local || {})) localStorage.setItem(k, v);
    if (idb) {
      const open = indexedDB.open('mydb', 2);
      open.onupgradeneeded = () => open.result.createObjectStore('things');
      const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
      const tx = db.transaction('things', 'readwrite');
      for (const [k, v] of Object.entries(idb)) tx.objectStore('things').put({ v, at: new Date(1000) }, k);
      tx.objectStore('things').put({ pic: new Blob(['not really a png']) }, 'picture');
      await new Promise((res) => { tx.oncomplete = res; });
      db.close();
    }
  }, { local, idb });
}

async function readInPage(frame) {
  return frame.evaluate(async () => {
    const local = {};
    for (let i = 0; i < localStorage.length; i++) local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    const names = (await indexedDB.databases()).map((d) => d.name);
    let idb = null;
    if (names.includes('mydb')) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('mydb'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const tx = db.transaction('things');
      const keys = await new Promise((res) => { const r = tx.objectStore('things').getAllKeys(); r.onsuccess = () => res(r.result); });
      const vals = await new Promise((res) => { const r = tx.objectStore('things').getAll(); r.onsuccess = () => res(r.result); });
      idb = { version: db.version, entries: keys.map((k, i) => [k, vals[i].v, vals[i].at instanceof Date ? vals[i].at.getTime() : null]) };
      db.close();
    }
    return { local, idb };
  });
}

async function exportToFile(page, fileName) {
  await btn(page, 'export library').click();
  const dlg = openDialog(page, 'backup ready');
  await dlg.waitFor({ timeout: 10_000 });
  const text = await dlg.innerText();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    btn(dlg, 'save to downloads').click(),
  ]);
  await noDialogs(page);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, fileName);
  await download.saveAs(file);
  return { text, file, suggested: download.suggestedFilename() };
}

async function importFile(t, page, file, { confirm = true } = {}) {
  await t.helpers.setNextPick(page, { name: path.basename(file), bytes: fs.readFileSync(file), type: 'application/zip' });
  await btn(page, 'import library').click();
  const ask = openDialog(page, 'import this backup?');
  await ask.waitFor({ timeout: 5000 });
  const askText = await ask.innerText();
  if (!confirm) {
    await btn(ask, 'cancel').click();
    await noDialogs(page);
    return { askText };
  }
  await btn(ask, 'import').click();
  const done = openDialog(page, 'imported');
  await done.waitFor({ timeout: 10_000 });
  const doneText = await done.innerText();
  await btn(done, 'ok').click();
  await noDialogs(page);
  return { askText, doneText };
}

async function otherPhone(t) {
  const context = await t.context.browser().newContext({ viewport: { width: 412, height: 915 } });
  const page = await t.helpers.openApp(context, t.appUrl);
  await boot(t, page);
  return { context, page };
}

module.exports = [
  { name: 'export button only shows with pages; import always shows', run: async (t) => {
    const page = await boot(t);
    await page.locator('.lib-empty').waitFor();
    assert.equal(await btn(page, 'import library').isVisible(), true);
    assert.equal(await btn(page, 'export library').isVisible(), false);
    await t.helpers.seedPage(page, { name: 'one' });
    await btn(page, 'export library').waitFor({ timeout: 5000 });
  } },

  { name: 'export, then import on another phone: pages, details and saved data come across', run: async (t) => {
    const page = await boot(t);
    await t.helpers.seedPage(page, { name: 'Tips', fileName: 'tips.html', html: PAGE('Tips'), tags: ['money'], pinned: true });
    await t.helpers.seedPage(page, { name: 'Workout', fileName: 'workout.html', html: PAGE('Workout'), tags: ['health'] });
    let frame = await openPage(t, page, 'Workout');
    await saveInPage(frame, { local: { reps: '12', name: 'ünï 🙂' }, idb: { monday: 'legs', tuesday: 'arms' } });
    await backToLibrary(page);

    const { text, file, suggested } = await exportToFile(page, 'backup-e2e.zip');
    assert.match(suggested, /^junk-drawer-backup-\d{4}-\d\d-\d\d\.zip$/);
    assert.match(text, /2 pages/);
    assert.match(text, /“Workout”: 1 saved item holding files or images/);

    const { context, page: other } = await otherPhone(t);
    try {
      await t.helpers.seedPage(other, { name: 'Only here' });
      const { askText, doneText } = await importFile(t, other, file);
      assert.match(askText, /has 2 pages/);
      assert.match(askText, /2 pages will be added/);
      assert.match(askText, /aren’t in the backup stay/);
      assert.match(doneText, /imported 2 pages/);
      assert.match(doneText, /2 added/);
      assert.match(doneText, /left out when the backup was made/);

      await row(other, 'Workout').waitFor({ timeout: 5000 });
      const names = await other.locator('.lib-row .lib-name').allTextContents();
      assert.deepEqual(names, ['Tips', 'Only here', 'Workout'], 'pinned Tips first, the rest by name');
      assert.match(await row(other, 'Tips').innerText(), /money/);

      frame = await openPage(t, other, 'Workout');
      assert.equal(await frame.locator('#x').innerText(), 'Workout');
      const data = await readInPage(frame);
      assert.deepEqual(data.local, { reps: '12', name: 'ünï 🙂' });
      assert.deepEqual(data.idb, { version: 2, entries: [['monday', 'legs', 1000], ['tuesday', 'arms', 1000]] });

      // Change the data on this phone, then import again: the backup wins.
      await saveInPage(frame, { local: { reps: '99', extra: 'x' } });
      await backToLibrary(other);
      const again = await importFile(t, other, file);
      assert.match(again.askText, /2 pages will replace the same pages already here, saved data included/);
      assert.doesNotMatch(again.askText, /will be added/);
      assert.match(again.doneText, /2 replaced/);
      frame = await openPage(t, other, 'Workout');
      assert.deepEqual((await readInPage(frame)).local, { reps: '12', name: 'ünï 🙂' });
      await backToLibrary(other);
      assert.equal(await other.locator('.lib-row').count(), 3, 'nothing doubled');
    } finally {
      await context.close();
    }
  } },

  { name: 'cancelling the import changes nothing', run: async (t) => {
    const page = await boot(t);
    await t.helpers.seedPage(page, { name: 'Keep', html: PAGE('Keep') });
    const { file } = await exportToFile(page, 'backup-cancel.zip');
    const before = await t.helpers.dbDump(page);
    await page.evaluate(async () => {
      const db = await import('./js/db.js');
      const [p] = await db.listPages();
      await db.updatePage(p.id, { name: 'Changed' });
      document.dispatchEvent(new CustomEvent('jd:library-changed'));
    });
    const { askText } = await importFile(t, page, file, { confirm: false });
    assert.match(askText, /1 page will replace the same page already here/);
    const after = await t.helpers.dbDump(page);
    assert.equal(after.pages[0].name, 'Changed');
    assert.equal(after.pages.length, before.pages.length);
  } },

  { name: 'importing something that isn’t a backup says so and changes nothing', run: async (t) => {
    const page = await boot(t);
    await t.helpers.seedPage(page, { name: 'Keep' });
    await t.helpers.setNextPick(page, { name: 'photos.zip', html: '<p>not a zip</p>', type: 'application/zip' });
    await btn(page, 'import library').click();
    const notice = page.locator('.ui-notice', { hasText: 'Couldn’t read the backup' });
    await notice.waitFor({ timeout: 5000 });
    assert.match(await notice.innerText(), /“photos\.zip”/);
    assert.equal((await t.helpers.dbDump(page)).pages.length, 1);
  } },

  { name: 'export page from the viewer saves the HTML exactly as it was added', run: async (t) => {
    const page = await boot(t);
    const html = '<!doctype html><title>Mine</title><p id="x">café \u{1F600}</p>';
    await t.helpers.seedPage(page, { name: 'Renamed in the library', fileName: 'original name.html', html });
    await openPage(t, page, 'Renamed in the library');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.locator('#viewer').getByRole('button', { name: 'export page', exact: true }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'original name.html');
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, 'export-page.html');
    await download.saveAs(file);
    assert.equal(fs.readFileSync(file, 'utf8'), html);
    assert.equal(await page.locator('#viewer').isVisible(), true, 'the page stays open');
  } },

  { name: 'with a share sheet: export page and export library offer it, and fall back to Downloads', run: async (t) => {
    await t.context.addInitScript(() => {
      window.__shared = [];
      window.__shareFails = false;
      navigator.canShare = (data) => Boolean(data && data.files && data.files.length);
      navigator.share = async (data) => {
        if (window.__shareFails) throw new DOMException('no gesture', 'NotAllowedError');
        const f = data.files[0];
        window.__shared.push({ name: f.name, type: f.type, size: f.size, text: f.type === 'text/html' ? await f.text() : null, title: data.title });
      };
    });
    const page = await boot(t);
    await t.helpers.seedPage(page, { name: 'Sharer', fileName: 'sharer.html', html: PAGE('Sharer') });
    await openPage(t, page, 'Sharer');
    await page.locator('#viewer').getByRole('button', { name: 'export page', exact: true }).click();
    const sheet = openDialog(page, 'export “Sharer”');
    await sheet.waitFor({ timeout: 5000 });
    await btn(sheet, 'share…').click();
    await page.waitForFunction(() => window.__shared.length === 1);
    const [shared] = await page.evaluate(() => window.__shared);
    assert.deepEqual({ name: shared.name, type: shared.type, text: shared.text, title: shared.title },
      { name: 'sharer.html', type: 'text/html', text: PAGE('Sharer'), title: 'Sharer' });
    await backToLibrary(page);

    await btn(page, 'export library').click();
    let dlg = openDialog(page, 'backup ready');
    await dlg.waitFor({ timeout: 10_000 });
    await btn(dlg, 'share…').click();
    await page.waitForFunction(() => window.__shared.length === 2);
    const zip = (await page.evaluate(() => window.__shared))[1];
    assert.equal(zip.type, 'application/zip');
    assert.match(zip.name, /^junk-drawer-backup-.*\.zip$/);
    assert.ok(zip.size > 100);

    // The share sheet refuses: the file goes to Downloads and a notice says so.
    await page.evaluate(() => { window.__shareFails = true; });
    await btn(page, 'export library').click();
    dlg = openDialog(page, 'backup ready');
    await dlg.waitFor({ timeout: 10_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      btn(dlg, 'share…').click(),
    ]);
    assert.match(download.suggestedFilename(), /\.zip$/);
    await page.locator('.ui-notice', { hasText: 'Saved to Downloads instead' }).waitFor({ timeout: 5000 });
  } },
];
