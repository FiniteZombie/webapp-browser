'use strict';
// WP1: the scaffold opens, uses relative URLs, the start guard works, and
// setNextPick fakes a picked file.

const assert = require('assert/strict');

const ready = (page) => page.evaluate(() => window.__jdReady === true);

async function guardState(page) {
  return page.evaluate(() => {
    const box = document.getElementById('start-failed');
    const area = box.querySelector('textarea');
    return { hidden: box.hidden, text: box.textContent, value: area ? area.value : null, readOnly: area ? area.readOnly : null };
  });
}

module.exports = [
  { name: 'opens with boot: false', run: async (t) => {
    const page = await t.openApp({ boot: false });
    assert.equal(await ready(page), true);
    assert.equal(await page.evaluate(() => globalThis.__jdTest?.noBoot), true);
    assert.equal(new URL(page.url()).pathname, '/app/');
  } },

  { name: 'opens with the normal boot', run: async (t) => {
    const page = await t.openApp();
    assert.equal(await ready(page), true);
    assert.equal(await page.evaluate(() => globalThis.__jdTest?.noBoot), undefined);
  } },

  { name: 'boot: false keeps other __jdTest keys', run: async (t) => {
    await t.context.addInitScript(() => { globalThis.__jdTest = { other: 7 }; });
    const page = await t.openApp({ boot: false });
    assert.deepEqual(await page.evaluate(() => globalThis.__jdTest), { other: 7, noBoot: true });
  } },

  { name: 'every request the app makes is under /app/', run: async (t) => {
    const urls = [];
    t.context.on('request', (r) => urls.push(r.url()));
    const page = await t.openApp();
    await page.waitForLoadState('load');
    const files = t.server.listAppFiles();
    assert.ok(files.includes('index.html') && files.includes('js/app.js') && files.includes('sw.js'), files.join(' '));
    const http = urls.filter((u) => /^https?:/.test(u));
    assert.ok(http.some((u) => u.endsWith('/app/js/app.js')), 'app.js was requested');
    const outside = http.filter((u) => !u.startsWith(t.appUrl));
    assert.deepEqual(outside, [], 'requests outside /app/');
  } },

  { name: 'start guard shows when app.js throws', run: async (t) => {
    t.server.override('app/js/app.js', "throw new Error('smoke: app.js failed on purpose');\n");
    const page = await t.context.newPage();
    await page.clock.install();
    await page.goto(t.appUrl, { waitUntil: 'load' });
    assert.equal((await guardState(page)).hidden, true, 'hidden before 8 s');
    await page.clock.runFor(7000);
    assert.equal((await guardState(page)).hidden, true, 'still hidden at 7 s');
    await page.clock.runFor(2000);
    const s = await guardState(page);
    assert.equal(s.hidden, false, 'shown after 8 s');
    assert.ok(s.text.includes('Junk Drawer didn’t start'), s.text);
    assert.equal(s.readOnly, true);
    assert.ok(s.value.includes('smoke: app.js failed on purpose'), s.value);
    assert.ok(s.value.includes(await page.evaluate(() => navigator.userAgent)), 'has the user agent');
  } },

  { name: 'start guard reports a module that fails to load', run: async (t) => {
    t.server.override('app/js/app.js', "import './no-such-module.js';\nwindow.__jdReady = true;\n");
    const page = await t.context.newPage();
    await page.clock.install();
    await page.goto(t.appUrl, { waitUntil: 'load' });
    await page.clock.runFor(9000);
    const s = await guardState(page);
    assert.equal(s.hidden, false);
    assert.ok(/app\.js|no-such-module/.test(s.value), s.value);
  } },

  { name: 'start guard stays hidden on a normal start', run: async (t) => {
    const page = await t.context.newPage();
    await page.clock.install();
    await page.goto(t.appUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__jdReady === true);
    await page.clock.runFor(20_000);
    const s = await guardState(page);
    assert.equal(s.hidden, true);
    assert.equal(s.value, null);
  } },

  { name: 'setNextPick fakes a picked file without a handle', run: async (t) => {
    const page = await t.openApp({ boot: false });
    await t.helpers.setNextPick(page, { name: 'tip calc.html', html: '<!doctype html><p>café</p>' });
    const r = await page.evaluate(async () => {
      const { file, handle } = await globalThis.__jdTest.pickFile();
      return { isFile: file instanceof File, name: file.name, type: file.type, text: await file.text(), handle };
    });
    assert.deepEqual(r, { isFile: true, name: 'tip calc.html', type: 'text/html', text: '<!doctype html><p>café</p>', handle: null });

    await t.helpers.setNextPick(page, { name: 'x.bin', bytes: Buffer.from([0, 1, 255]), type: '' });
    const b = await page.evaluate(async () => {
      const { file } = await globalThis.__jdTest.pickFile();
      return { name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
    });
    assert.deepEqual(b, { name: 'x.bin', type: '', bytes: [0, 1, 255] });
  } },

  { name: 'setNextPick with a handle records calls and can fail remove()', run: async (t) => {
    const page = await t.openApp({ boot: false });
    await t.helpers.setNextPick(page, { name: 'a.html', html: '<p>a</p>', withHandle: true });
    const ok = await page.evaluate(async () => {
      const { file, handle } = await globalThis.__jdTest.pickFile();
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      await handle.remove();
      return { perm, name: handle.name, same: (await handle.getFile()) === file, log: globalThis.__jdTest.handleLog };
    });
    assert.equal(ok.perm, 'granted');
    assert.equal(ok.name, 'a.html');
    assert.equal(ok.same, true);
    assert.deepEqual(ok.log, [{ method: 'requestPermission', mode: 'readwrite' }, { method: 'remove' }]);

    await t.helpers.setNextPick(page, { name: 'b.html', html: '<p>b</p>', withHandle: true, removeFails: true });
    const bad = await page.evaluate(async () => {
      const { handle } = await globalThis.__jdTest.pickFile();
      try { await handle.remove(); return { rejected: false }; } catch (e) {
        return { rejected: true, name: e.name, log: globalThis.__jdTest.handleLog.map((l) => l.method) };
      }
    });
    assert.equal(bad.rejected, true);
    assert.equal(bad.name, 'NoModificationAllowedError');
    assert.deepEqual(bad.log, ['requestPermission', 'remove', 'remove']);
  } },

  { name: 'realStorageKeys and viewerFrame work on an empty app', run: async (t) => {
    const page = await t.openApp({ boot: false });
    assert.deepEqual(await t.helpers.realStorageKeys(page), { local: [], session: [] });
    assert.equal(t.helpers.viewerFrame(page), null);
  } },

  { name: 'server stamps the build and serves overrides', run: async (t) => {
    const get = async (p) => (await fetch(t.server.url + p)).text();
    assert.match(await get('app/sw.js'), /^const BUILD = 't1';/);
    t.server.setBuild('t2');
    assert.match(await get('app/sw.js'), /^const BUILD = 't2';/);
    t.server.setBuild(null);
    assert.match(await get('app/sw.js'), /^const BUILD = 'dev';/);
    t.server.override('app/js/model.js', 'export const X = 1;\n');
    assert.equal(await get('app/js/model.js'), 'export const X = 1;\n');
    t.server.reset();
    assert.match(await get('app/sw.js'), /^const BUILD = 't1';/);
    assert.match(await get('app/js/model.js'), /stub|export/);
    const res = await fetch(t.server.url + 'app/');
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(t.server.url + 'app/nope.js')).status, 404);
  } },
];
