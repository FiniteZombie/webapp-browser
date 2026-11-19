'use strict';
// WP11: the whole app, booted for real (app.js), driven through the UI.
// helpers.setNextPick stands in for Android's file picker.

const assert = require('assert/strict');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAIN = (title, text = title) => `<!doctype html><html><head><title>${title}</title></head><body><p id="x">${text}</p></body></html>`;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4];

const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const openDialog = (page, text) => page.locator('#dialogs dialog[open]', { hasText: text });
const row = (page, name) => page.locator('.lib-row').filter({
  has: page.locator('.lib-name', { hasText: new RegExp(`^${name}$`) }),
});
const libraryBtn = (page) => page.locator('#viewer').getByRole('button', { name: 'library', exact: true });

// Boots the app and waits for the service worker to control it.
async function boot(t) {
  const page = await t.openApp();
  await page.waitForFunction(() => {
    const c = navigator.serviceWorker.controller;
    return c && c.state === 'activated';
  }, null, { timeout: 10_000 });
  return page;
}

async function noDialogs(page) {
  await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'), null, { timeout: 5000 });
}

// Answers the added sheet with 'open' or 'back to library'.
async function answerSheet(page, action) {
  const dlg = openDialog(page, 'back to library');
  await dlg.waitFor({ timeout: 5000 });
  const title = await dlg.locator('h2').innerText();
  await btn(dlg, action).click();
  await noDialogs(page);
  return title;
}

// Adds a page through the UI: "add new page", details, added sheet.
// Returns { prefilled, title, id }.
async function addThroughUi(t, page, { fileName = 'page.html', html, name, tags, action = 'back to library' }) {
  await t.helpers.setNextPick(page, { name: fileName, html });
  const before = (await t.helpers.dbDump(page)).pages.map((p) => p.id);
  await btn(page, 'add new page').click();
  const dlg = openDialog(page, 'add a page');
  await dlg.waitFor({ timeout: 5000 });
  const input = dlg.getByLabel('name', { exact: true });
  const prefilled = await input.inputValue();
  if (name !== undefined) await input.fill(name);
  if (tags !== undefined) await dlg.getByLabel('new tags, separated by commas').fill(tags);
  await dlg.locator('button[type=submit]').click();
  const title = await answerSheet(page, action);
  const after = (await t.helpers.dbDump(page)).pages;
  const added = after.find((p) => !before.includes(p.id));
  return { prefilled, title, id: added && added.id };
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

async function openRow(t, page, name) {
  await row(page, name).click();
  return frameOf(t, page);
}

async function closeViewer(page) {
  await libraryBtn(page).click();
  await page.waitForFunction(() => document.getElementById('viewer').hidden, null, { timeout: 5000 });
}

const whenSaved = (page) => page.evaluate(() => import('./js/viewer.js').then((v) => v.whenSaved()));

async function rowsFor(t, page, id) {
  const dump = await t.helpers.dbDump(page);
  return Object.fromEntries(dump.local.filter((r) => r.pageId === id).map((r) => [r.key, r.value]));
}

const IDB_PUT = async (name) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

async function removeThroughUi(page, name) {
  await row(page, name).click({ button: 'right' });
  const sheet = page.locator('#dialogs dialog[open]');
  await btn(sheet, 'remove').click();
  await openDialog(page, 'deleted for good').waitFor({ timeout: 5000 });
  await btn(openDialog(page, 'deleted for good'), 'remove').click();
  await noDialogs(page);
  await row(page, name).waitFor({ state: 'detached', timeout: 5000 });
}

async function replaceThroughUi(t, page, name, { fileName, html }) {
  await t.helpers.setNextPick(page, { name: fileName, html });
  await row(page, name).click({ button: 'right' });
  await btn(page.locator('#dialogs dialog[open]'), 'replace file').click();
  return answerSheet(page, 'back to library');
}

module.exports = [
  { name: 'first run: add, details prefilled, added sheet, open, library, counted', run: async (t) => {
    const page = await boot(t);
    await page.locator('.lib-empty').waitFor();
    const r = await addThroughUi(t, page, {
      fileName: 'tips.html', html: PLAIN('Tip Splitter', 'split the bill'), tags: 'money, tools', action: 'open',
    });
    assert.equal(r.prefilled, 'Tip Splitter');
    assert.equal(r.title, 'added “Tip Splitter”');
    const f = await frameOf(t, page);
    assert.equal(await f.locator('#x').innerText(), 'split the bill');
    assert.equal(await page.locator('#viewer .view-name').innerText(), 'Tip Splitter');
    const frameBox = await page.locator('#viewer iframe').boundingBox();
    const barBox = await libraryBtn(page).boundingBox();
    assert.ok(frameBox.y >= barBox.y + barBox.height - 1, 'the page shows under the bar');
    await closeViewer(page);
    await row(page, 'Tip Splitter').waitFor();
    assert.match(await row(page, 'Tip Splitter').innerText(), /money, tools/);
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.pages[0].openCount, 1);
    assert.deepEqual([...dump.pages[0].tags].sort(), ['money', 'tools']);
  } },

  { name: 'saved data 1: persists across views and an app reload', run: async (t) => {
    const page = await boot(t);
    const { id } = await addThroughUi(t, page, { fileName: 'notes.html', html: PLAIN('notes') });
    let f = await openRow(t, page, 'notes');
    await f.evaluate(() => localStorage.setItem('k', 'v'));
    await closeViewer(page);
    f = await openRow(t, page, 'notes');
    assert.equal(await f.evaluate(() => localStorage.getItem('k')), 'v');
    await closeViewer(page);
    await whenSaved(page);
    assert.deepEqual(await rowsFor(t, page, id), { k: 'v' });
    await page.reload();
    await page.waitForFunction(() => window.__jdReady === true);
    f = await openRow(t, page, 'notes');
    assert.equal(await f.evaluate(() => localStorage.getItem('k')), 'v');
  } },

  { name: 'saved data 2: private to the page (workout tracker and tip splitter)', run: async (t) => {
    const page = await boot(t);
    const w = await addThroughUi(t, page, { fileName: 'workout.html', html: PLAIN('workout tracker') });
    const s = await addThroughUi(t, page, { fileName: 'tips.html', html: PLAIN('tip splitter') });
    let f = await openRow(t, page, 'workout tracker');
    await f.evaluate(() => localStorage.setItem('state', 'workout history'));
    await closeViewer(page);
    f = await openRow(t, page, 'tip splitter');
    assert.equal(await f.evaluate(() => localStorage.getItem('state')), null);
    await f.evaluate(() => { localStorage.setItem('state', 'tips'); localStorage.clear(); });
    assert.equal(await f.evaluate(() => localStorage.length), 0);
    await closeViewer(page);
    await whenSaved(page);
    f = await openRow(t, page, 'workout tracker');
    assert.equal(await f.evaluate(() => localStorage.getItem('state')), 'workout history');
    await closeViewer(page);
    assert.equal(await page.locator('.lib-row').count(), 2);
    assert.deepEqual(await rowsFor(t, page, w.id), { state: 'workout history' });
    assert.deepEqual(await rowsFor(t, page, s.id), {});
  } },

  { name: 'saved data 3: survives replacing the file through "replace file"', run: async (t) => {
    const page = await boot(t);
    const { id } = await addThroughUi(t, page, { fileName: 'calc.html', html: PLAIN('calc', 'v1') });
    let f = await openRow(t, page, 'calc');
    await f.evaluate(() => localStorage.setItem('total', '42'));
    await closeViewer(page);
    await whenSaved(page);
    const title = await replaceThroughUi(t, page, 'calc', { fileName: 'calc2.html', html: PLAIN('calc two', 'v2') });
    assert.equal(title, 'replaced the file for “calc”');
    f = await openRow(t, page, 'calc');
    assert.equal(await f.locator('#x').innerText(), 'v2');
    assert.equal(await f.evaluate(() => localStorage.getItem('total')), '42');
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.pages[0].id, id);
  } },

  { name: 'saved data 4: deleted when the page is removed; another page keeps its own', run: async (t) => {
    const page = await boot(t);
    const a = await addThroughUi(t, page, { fileName: 'a.html', html: PLAIN('alpha') });
    const b = await addThroughUi(t, page, { fileName: 'b.html', html: PLAIN('beta') });
    for (const name of ['alpha', 'beta']) {
      const f = await openRow(t, page, name);
      await f.evaluate((n) => localStorage.setItem('who', n), name);
      await f.evaluate(`(${IDB_PUT})('store')`);
      await closeViewer(page);
    }
    await whenSaved(page);
    let dump = await t.helpers.dbDump(page);
    assert.ok(dump.databases.includes(`junk-drawer:page:${a.id}:store`), dump.databases.join(', '));
    await removeThroughUi(page, 'alpha');
    dump = await t.helpers.dbDump(page);
    assert.equal(dump.local.some((r) => r.pageId === a.id), false);
    assert.equal(dump.databases.some((n) => n.startsWith(`junk-drawer:page:${a.id}:`)), false, dump.databases.join(', '));
    assert.deepEqual(await rowsFor(t, page, b.id), { who: 'beta' });
    assert.ok(dump.databases.includes(`junk-drawer:page:${b.id}:store`), dump.databases.join(', '));
  } },

  { name: 'saved data 5: readable by Junk Drawer (getLocalEntries, listPageDatabases)', run: async (t) => {
    const page = await boot(t);
    const { id } = await addThroughUi(t, page, { fileName: 'r.html', html: PLAIN('readable') });
    const f = await openRow(t, page, 'readable');
    await f.evaluate(() => { localStorage.setItem('a', '1'); localStorage.setItem('b', '2'); });
    await f.evaluate(`(${IDB_PUT})('mine')`);
    await closeViewer(page);
    await whenSaved(page);
    const got = await page.evaluate(async (id) => {
      const db = await import('./js/db.js');
      return { local: await db.getLocalEntries(id), dbs: await db.listPageDatabases(id) };
    }, id);
    assert.deepEqual(got.local.sort(), [['a', '1'], ['b', '2']]);
    assert.deepEqual(got.dbs, [`junk-drawer:page:${id}:mine`]);
  } },

  { name: 'a page starts empty even when the real localStorage held its key; the real key is untouched', run: async (t) => {
    await t.context.addInitScript(() => {
      try { if (window !== window.top) return; } catch { return; }
      if (location.pathname.endsWith('/app/')) localStorage.setItem('state', 'from downloads');
    });
    const page = await boot(t);
    await addThroughUi(t, page, { fileName: 's.html', html: PLAIN('stateful') });
    const f = await openRow(t, page, 'stateful');
    assert.equal(await f.evaluate(() => localStorage.getItem('state')), null);
    assert.equal(await f.evaluate(() => localStorage.length), 0);
    await f.evaluate(() => { localStorage.setItem('state', 'mine'); localStorage.clear(); });
    await closeViewer(page);
    await whenSaved(page);
    assert.equal(await page.evaluate(() => window.localStorage.getItem('state')), 'from downloads');
    assert.deepEqual((await t.helpers.realStorageKeys(page)).local, ['state']);
  } },

  { name: 'a whole journey writes nothing to the real localStorage or sessionStorage', run: async (t) => {
    const page = await boot(t);
    await addThroughUi(t, page, { fileName: 'j.html', html: PLAIN('journey', 'one') });
    let f = await openRow(t, page, 'journey');
    await f.evaluate(() => { localStorage.setItem('x', '1'); sessionStorage.setItem('y', '2'); });
    await closeViewer(page);
    await whenSaved(page);
    await replaceThroughUi(t, page, 'journey', { fileName: 'j2.html', html: PLAIN('journey two', 'two') });
    f = await openRow(t, page, 'journey');
    assert.equal(await f.evaluate(() => localStorage.getItem('x')), '1');
    await closeViewer(page);
    await removeThroughUi(page, 'journey');
    assert.deepEqual(await t.helpers.realStorageKeys(page), { local: [], session: [] });
  } },

  { name: 'same-name add offers replace, through the UI', run: async (t) => {
    const page = await boot(t);
    const first = await addThroughUi(t, page, { fileName: 'tip splitter.html', html: PLAIN('tip splitter', 'old') });
    await t.helpers.setNextPick(page, { name: 'Tip Splitter (1).html', html: PLAIN('Tip Splitter', 'new') });
    await btn(page, 'add new page').click();
    const dlg = openDialog(page, 'add as a new page');
    await dlg.waitFor({ timeout: 5000 });
    await btn(dlg, 'replace “tip splitter”').click();
    assert.equal(await answerSheet(page, 'back to library'), 'replaced the file for “tip splitter”');
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.pages[0].id, first.id);
    const f = await openRow(t, page, 'tip splitter');
    assert.equal(await f.locator('#x').innerText(), 'new');
  } },

  { name: 'a refused .png: a notice that names it, copy details, stays, library unchanged', run: async (t) => {
    const page = await boot(t);
    await page.locator('.lib-empty').waitFor();
    await t.helpers.setNextPick(page, { name: 'holiday.png', bytes: PNG, type: 'image/png' });
    await btn(page, 'add new page').click();
    const notice = page.locator('#notices .ui-notice');
    await notice.first().waitFor({ timeout: 5000 });
    assert.match(await notice.first().innerText(), /holiday\.png/);
    assert.equal(await btn(notice.first(), 'copy details').count(), 1);
    await sleep(3000);
    assert.equal(await notice.count(), 1, 'still showing');
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 0);
    assert.equal(dump.files.length, 0);
    assert.equal(await page.locator('.lib-empty').isVisible(), true);
    await btn(notice.first(), 'dismiss').click();
    await notice.first().waitFor({ state: 'detached' });
  } },

  { name: 'errors thrown in app code surface as notices', run: async (t) => {
    const page = await boot(t);
    const notice = page.locator('#notices .ui-notice');
    assert.equal(await notice.count(), 0);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:open-page', { detail: null })));
    await notice.first().waitFor({ timeout: 5000 });
    assert.equal(await btn(notice.first(), 'copy details').count(), 1);
    await btn(notice.first(), 'dismiss').click();
    await page.evaluate(() => { Promise.reject(new Error('wp11 test rejection')); });
    await notice.first().waitFor({ timeout: 5000 });
    assert.equal(await notice.count(), 1);
  } },

  { name: 'offline: load once, go offline, reload: the library renders and a page opens', run: async (t) => {
    const page = await boot(t);
    await addThroughUi(t, page, { fileName: 'off.html', html: PLAIN('offline page', 'works offline') });
    await t.context.setOffline(true);
    try {
      await page.reload();
      await page.waitForFunction(() => window.__jdReady === true, null, { timeout: 10_000 });
      await row(page, 'offline page').waitFor({ timeout: 5000 });
      const f = await openRow(t, page, 'offline page');
      assert.equal(await f.locator('#x').innerText(), 'works offline');
    } finally {
      await t.context.setOffline(false);
    }
  } },

  { name: 'served from a sub-path: no request leaves /app/ except the page\'s own', run: async (t) => {
    await t.context.route('https://example.test/**', (route) => route.fulfill({
      status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }));
    const urls = [];
    t.context.on('request', (r) => urls.push(r.url()));
    const page = await boot(t);
    const html = '<!doctype html><title>remote</title><p id="x">remote</p><img src="https://example.test/pixel.svg">';
    await addThroughUi(t, page, { fileName: 'remote.html', html });
    const f = await openRow(t, page, 'remote');
    await f.waitForFunction(() => document.querySelector('img').complete);
    await closeViewer(page);
    const http = urls.filter((u) => /^https?:/.test(u));
    assert.ok(http.some((u) => u === 'https://example.test/pixel.svg'), 'the page\'s own request went out');
    const outside = http.filter((u) => !u.startsWith(t.appUrl) && !u.startsWith('https://example.test/'));
    assert.deepEqual(outside, [], 'requests outside /app/');
  } },
];
