'use strict';
// WP3: the e2e helpers that touch the database (seedPage, dbDump).

const assert = require('assert/strict');

const PREFIX = 'junk-drawer:page:';

module.exports = [
  { name: 'dbDump on a fresh origin is empty and creates nothing', run: async (t) => {
    const page = await t.openApp({ boot: false });
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages, []);
    assert.deepEqual(dump.files, []);
    assert.deepEqual(dump.local, []);
    assert.deepEqual(dump.settings, {});
    assert.ok(Array.isArray(dump.databases));
  } },

  { name: 'seedPage defaults, then dbDump shows the page and its file', run: async (t) => {
    const page = await t.openApp({ boot: false });
    const html = '<!doctype html><title>plain</title><p>plain</p>';
    const rec = await t.helpers.seedPage(page, { name: 'plain', html });
    assert.equal(rec.name, 'plain');
    assert.equal(rec.fileName, 'plain.html');
    assert.equal(rec.pinned, false);
    assert.equal(rec.openCount, 0);
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.deepEqual(dump.pages[0], rec);
    assert.deepEqual(dump.files, [{ id: rec.id, size: Buffer.byteLength(html), charset: null }]);
    assert.deepEqual(dump.local, []);
    assert.deepEqual(dump.settings, {});
  } },

  { name: 'seedPage with every optional field', run: async (t) => {
    const page = await t.openApp({ boot: false });
    const rec = await t.helpers.seedPage(page, {
      name: 'full', html: '<p>full</p>', fileName: 'full-file.html', tags: ['x', 'y'],
      pinned: true, openCount: 7, addedAt: 1000, lastOpenedAt: 2000,
    });
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.deepEqual(dump.pages[0], {
      id: rec.id, name: 'full', fileName: 'full-file.html', tags: ['x', 'y'], pinned: true,
      openCount: 7, addedAt: 1000, lastOpenedAt: 2000, replacedAt: null, size: 11,
    });
    assert.deepEqual(rec, dump.pages[0]);
    assert.equal(dump.files.length, 1);
    assert.equal(dump.files[0].size, 11);
    assert.deepEqual(dump.local, []);
  } },

  { name: 'seedPage dispatches libraryChanged', run: async (t) => {
    const page = await t.openApp({ boot: false });
    await page.evaluate(() => {
      window.__changed = 0;
      document.addEventListener('jd:library-changed', () => { window.__changed++; });
    });
    await t.helpers.seedPage(page, { name: 'evt' });
    assert.equal(await page.evaluate(() => window.__changed), 1);
  } },

  { name: 'dbDump shows local entries, settings and databases', run: async (t) => {
    const page = await t.openApp({ boot: false });
    const rec = await t.helpers.seedPage(page, { name: 'withdata' });
    const dbName = `${PREFIX}${rec.id}:mine`;
    await page.evaluate(async ({ id, dbName }) => {
      const db = await import(new URL('js/db.js', document.baseURI).href);
      await db.applyLocalOps(id, [{ op: 'set', key: 'k', value: 'v' }]);
      await db.setSetting('some.setting', 'on');
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
      });
    }, { id: rec.id, dbName });
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.local, [{ pageId: rec.id, key: 'k', value: 'v' }]);
    assert.deepEqual(dump.settings, { 'some.setting': 'on' });
    assert.ok(dump.databases.includes(dbName));
    assert.ok(dump.databases.includes('junk-drawer'));
  } },

  { name: 'setNextPick keeps returning a fresh file; viewerFrame is null without a viewer', run: async (t) => {
    const page = await t.openApp({ boot: false });
    await t.helpers.setNextPick(page, { name: 'a.html', html: '<p>a</p>', withHandle: true, permission: 'prompt' });
    const out = await page.evaluate(async () => {
      const one = await __jdTest.pickFile();
      const two = await __jdTest.pickFile();
      const perm = await one.handle.queryPermission({ mode: 'readwrite' });
      return {
        name: one.file.name, type: one.file.type, fresh: one.file !== two.file, perm,
        same: await one.handle.isSameEntry(one.handle), got: (await one.handle.getFile()) === one.file,
        log: __jdTest.handleLog,
      };
    });
    assert.equal(out.name, 'a.html');
    assert.equal(out.type, 'text/html');
    assert.equal(out.fresh, true);
    assert.equal(out.perm, 'prompt');
    assert.equal(out.same, true);
    assert.equal(out.got, true);
    assert.deepEqual(out.log, [{ method: 'queryPermission', mode: 'readwrite' }]);
    assert.equal(t.helpers.viewerFrame(page), null);
  } },
];
