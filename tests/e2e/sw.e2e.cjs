'use strict';
// WP7: the service worker.

const assert = require('assert/strict');

// A minimal host on the app window: per-page localStorage and sessionStorage
// in Maps, and a log of pageError calls. connect() answers for any page id.
async function installHost(page) {
  await page.evaluate(async () => {
    const config = await import(new URL('js/config.js', document.baseURI).href);
    const local = new Map();
    const session = new Map();
    const mapFor = (all, id) => { if (!all.has(id)) all.set(id, new Map()); return all.get(id); };
    const applyTo = (m, op, key, value) => {
      if (op === 'set') m.set(String(key), String(value));
      else if (op === 'remove') m.delete(String(key));
      else if (op === 'clear') m.clear();
    };
    window.__testHost = { local, session, errors: [], notes: [] };
    window[config.HOST_GLOBAL] = {
      connect(pageId) {
        const l = mapFor(local, pageId);
        const s = mapFor(session, pageId);
        return {
          entries: [...l],
          apply(op, key, value) { try { applyTo(l, op, key, value); } catch {} },
          sessionEntries: [...s],
          applySession(op, key, value) { try { applyTo(s, op, key, value); } catch {} },
          notify(type, data) { window.__testHost.notes.push({ pageId, type, data }); },
        };
      },
      pageError(pageId, code, detail) { window.__testHost.errors.push({ pageId, code, detail }); },
    };
  });
}

// Appends an iframe for p/<id>/, waits for it to load, returns its Frame.
async function openFrame(page, id) {
  await page.evaluate((pid) => new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.dataset.pageId = pid;
    f.src = `p/${encodeURIComponent(pid)}/`;
    f.addEventListener('load', () => resolve(), { once: true });
    f.addEventListener('error', () => reject(new Error('iframe error')), { once: true });
    document.body.append(f);
  }), id);
  const frame = page.frames().find((fr) => fr.url().includes(`/p/${encodeURIComponent(id)}/`));
  assert.ok(frame, `frame for ${id}`);
  return frame;
}

async function closeFrames(page) {
  await page.evaluate(() => document.querySelectorAll('iframe').forEach((f) => f.remove()));
}

// Stores raw bytes through db.js (seedPage only stores UTF-8 text).
async function addRaw(page, { name, bytes, charset }) {
  return page.evaluate(async (o) => {
    const db = await import(new URL('js/db.js', document.baseURI).href);
    return db.addPage({
      name: o.name, fileName: `${o.name}.html`, tags: [],
      bytes: new Uint8Array(o.bytes).buffer, charset: o.charset,
    });
  }, { name, bytes: [...bytes], charset });
}

async function fetchInPage(page, path) {
  return page.evaluate(async (p) => {
    const res = await fetch(p);
    return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
  }, path);
}

async function cacheNames(page) {
  return page.evaluate(() => caches.keys());
}

async function setup(t) {
  const page = await t.openApp({ boot: false });
  await t.helpers.ensureWorker(page);
  return page;
}

function shellFromSource(src) {
  const m = /const SHELL = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'sw.js has a SHELL array');
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

const LATIN1_TITLE = 'Café crème';
function latin1Bytes(s) { return Buffer.from(s, 'latin1'); }

module.exports = [
  { name: 'build endpoint answers the stamped build', run: async (t) => {
    const page = await setup(t);
    const r = await fetchInPage(page, '__jd/build');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { build: 't1' });
  } },

  { name: 'build endpoint answers dev when unstamped', run: async (t) => {
    t.server.setBuild(null);
    const page = await setup(t);
    const r = await fetchInPage(page, '__jd/build');
    assert.deepEqual(JSON.parse(r.text), { build: 'dev' });
  } },

  { name: 'SHELL lists every app file except sw.js, and is what gets cached', run: async (t) => {
    const src = await (await fetch(t.appUrl + 'sw.js')).text();
    const shell = shellFromSource(src);
    const files = (await t.server.listAppFiles()).filter((f) => f !== 'sw.js');
    assert.deepEqual([...shell].sort(), ['./', ...files].sort());
    const page = await setup(t);
    const keys = await page.evaluate(async () => {
      const c = await caches.open('junk-drawer-shell-t1');
      return (await c.keys()).map((r) => r.url);
    });
    const expected = shell.map((s) => new URL(s, t.appUrl).href);
    assert.deepEqual([...keys].sort(), expected.sort());
  } },

  { name: 'precache busts the CDN with ?v=<build> and stores plain URLs', run: async (t) => {
    // Stand in for a CDN edge that still has the old copy of a file under its
    // plain URL: anything fetched without the build query gets stale bytes.
    const seen = [];
    await t.context.route(`${t.appUrl}**`, (route) => {
      const url = new URL(route.request().url());
      seen.push(url.href);
      if (url.pathname.endsWith('/styles/base.css') && url.searchParams.get('v') !== 't1') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '/* stale */' });
      }
      return route.continue();
    });
    const src = await (await fetch(t.appUrl + 'sw.js')).text();
    const shell = shellFromSource(src);
    const page = await setup(t);
    for (const entry of shell) {
      const busted = new URL(entry, t.appUrl);
      busted.searchParams.set('v', 't1');
      assert.ok(seen.includes(busted.href), `precache fetched ${busted.href}`);
    }
    const got = await page.evaluate(async () => {
      const c = await caches.open('junk-drawer-shell-t1');
      const keys = (await c.keys()).map((r) => r.url);
      const css = await (await c.match(new URL('styles/base.css', document.baseURI).href)).text();
      return { keys, css };
    });
    assert.ok(got.keys.every((k) => !k.includes('?')), JSON.stringify(got.keys));
    assert.notEqual(got.css, '/* stale */');
    await t.context.unrouteAll({ behavior: 'ignoreErrors' });
  } },

  { name: 'a stored page is served with the shim, in standards mode', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const rec = await t.helpers.seedPage(page, {
      name: 'plain', html: '<!doctype html><html lang="en"><head><title>Plain page</title></head><body><p>hi</p></body></html>',
    });
    const frame = await openFrame(page, rec.id);
    const got = await frame.evaluate(() => ({
      mode: document.compatMode,
      title: document.title,
      isStorage: localStorage instanceof Storage,
      lang: document.documentElement.lang,
      scripts: document.scripts.length,
    }));
    assert.deepEqual(got, { mode: 'CSS1Compat', title: 'Plain page', isStorage: true, lang: 'en', scripts: 0 });
    const r = await fetchInPage(page, `p/${rec.id}/`);
    assert.equal(r.status, 200);
    assert.equal(r.type, 'text/html');
    const res = await page.evaluate(async (id) => (await fetch(`p/${id}/?x=1`)).headers.get('cache-control'), rec.id);
    assert.equal(res, 'no-store');
  } },

  { name: 'worked example: one page clearing localStorage leaves the other alone', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const a = await t.helpers.seedPage(page, { name: 'alpha' });
    const b = await t.helpers.seedPage(page, { name: 'beta' });
    const fa = await openFrame(page, a.id);
    await fa.evaluate(() => localStorage.setItem('state', 'alpha-state'));
    const fb = await openFrame(page, b.id);
    await fb.evaluate(() => localStorage.setItem('state', 'beta-state'));
    await fa.evaluate(() => localStorage.clear());
    assert.equal(await fa.evaluate(() => localStorage.getItem('state')), null);
    assert.equal(await fb.evaluate(() => localStorage.getItem('state')), 'beta-state');
    await closeFrames(page);
    const fb2 = await openFrame(page, b.id);
    assert.equal(await fb2.evaluate(() => localStorage.getItem('state')), 'beta-state');
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages.map((p) => p.name).sort(), ['alpha', 'beta']);
    assert.equal(dump.files.length, 2);
    assert.deepEqual(await t.helpers.realStorageKeys(page), { local: [], session: [] });
  } },

  { name: 'two pages with the same IndexedDB name do not share data', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const a = await t.helpers.seedPage(page, { name: 'one' });
    const b = await t.helpers.seedPage(page, { name: 'two' });
    const write = (who) => new Promise((resolve, reject) => {
      const req = indexedDB.open('notes', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('s', 'readwrite');
        tx.objectStore('s').put(who, 'who');
        tx.oncomplete = () => { idb.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const read = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('notes', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const idb = req.result;
        const get = idb.transaction('s').objectStore('s').get('who');
        get.onsuccess = () => { idb.close(); resolve({ who: get.result ?? null, name: idb.name }); };
        get.onerror = () => reject(get.error);
      };
    });
    const fa = await openFrame(page, a.id);
    const fb = await openFrame(page, b.id);
    assert.deepEqual(await fb.evaluate(read), { who: null, name: 'notes' });
    await fa.evaluate(write, 'one');
    assert.deepEqual(await fb.evaluate(read), { who: null, name: 'notes' });
    await fb.evaluate(write, 'two');
    assert.deepEqual(await fa.evaluate(read), { who: 'one', name: 'notes' });
    assert.deepEqual(await fb.evaluate(read), { who: 'two', name: 'notes' });
    const dump = await t.helpers.dbDump(page);
    assert.ok(dump.databases.includes(`junk-drawer:page:${a.id}:notes`), JSON.stringify(dump.databases));
    assert.ok(dump.databases.includes(`junk-drawer:page:${b.id}:notes`), JSON.stringify(dump.databases));
  } },

  { name: 'windows-1252 pages render their accented titles', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const declared = await addRaw(page, {
      name: 'declared', charset: null,
      bytes: latin1Bytes(`<!doctype html><html><head><meta charset="windows-1252"><title>${LATIN1_TITLE}</title></head><body>x</body></html>`),
    });
    const undeclared = await addRaw(page, {
      name: 'undeclared', charset: 'windows-1252',
      bytes: latin1Bytes(`<!doctype html><html><head><title>${LATIN1_TITLE}</title></head><body>x</body></html>`),
    });
    const f1 = await openFrame(page, declared.id);
    assert.equal(await f1.evaluate(() => document.title), LATIN1_TITLE);
    const f2 = await openFrame(page, undeclared.id);
    assert.equal(await f2.evaluate(() => document.title), LATIN1_TITLE);
    assert.equal((await fetchInPage(page, `p/${declared.id}/`)).type, 'text/html');
    assert.equal((await fetchInPage(page, `p/${undeclared.id}/`)).type, 'text/html; charset=windows-1252');
  } },

  { name: 'an unknown page id gets the error document and calls pageError', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const frame = await openFrame(page, 'no-such-page');
    assert.match(await frame.evaluate(() => document.body.textContent), /Junk Drawer couldn't load this page/);
    await page.waitForFunction(() => window.__testHost.errors.length > 0, null, { timeout: 5000 });
    const errors = await page.evaluate(() => window.__testHost.errors);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].pageId, 'no-such-page');
    assert.equal(errors[0].code, 'page-missing');
    assert.equal(typeof errors[0].detail, 'string');
    const r = await fetchInPage(page, 'p/no-such-page/');
    assert.equal(r.status, 404);
    assert.equal(r.type, 'text/html; charset=utf-8');
  } },

  { name: 'other paths under p/ are 404', run: async (t) => {
    const page = await setup(t);
    const rec = await t.helpers.seedPage(page, { name: 'sib' });
    for (const p of [`p/${rec.id}/other.js`, `p/${rec.id}`, 'p/', `p/${rec.id}/sub/`]) {
      const r = await fetchInPage(page, p);
      assert.equal(r.status, 404, p);
      assert.match(r.type, /^text\/plain/, p);
    }
  } },

  { name: 'cross-origin requests from a page are not intercepted', run: async (t) => {
    const seen = [];
    await t.context.route('https://example.test/**', (route) => {
      seen.push({ url: route.request().url(), fromWorker: !!route.request().serviceWorker() });
      return route.fulfill({
        status: 200, body: 'canned answer',
        headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' },
      });
    });
    const page = await setup(t);
    await installHost(page);
    const rec = await t.helpers.seedPage(page, { name: 'net' });
    const frame = await openFrame(page, rec.id);
    const [response, text] = await Promise.all([
      page.waitForResponse((r) => r.url().startsWith('https://example.test/')),
      frame.evaluate(async () => (await fetch('https://example.test/data.txt')).text()),
    ]);
    assert.equal(text, 'canned answer');
    assert.equal(response.fromServiceWorker(), false);
    assert.deepEqual(seen, [{ url: 'https://example.test/data.txt', fromWorker: false }]);
  } },

  { name: 'offline: the app reloads and a stored page still opens', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const rec = await t.helpers.seedPage(page, { name: 'offline', html: '<!doctype html><title>Offline page</title><p>ok</p>' });
    const f = await openFrame(page, rec.id);
    await f.evaluate(() => localStorage.setItem('k', 'v'));
    await t.context.setOffline(true);
    try {
      await page.reload();
      await page.waitForFunction(() => window.__jdReady === true, null, { timeout: 10_000 });
      assert.equal(await page.title(), 'Junk Drawer');
      assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
      await installHost(page);
      const frame = await openFrame(page, rec.id);
      assert.equal(await frame.evaluate(() => document.title), 'Offline page');
      assert.equal(await frame.evaluate(() => localStorage instanceof Storage), true);
    } finally {
      await t.context.setOffline(false);
    }
  } },

  { name: 'update: a new build takes over, drops the old cache, keeps data', run: async (t) => {
    const page = await setup(t);
    await installHost(page);
    const rec = await t.helpers.seedPage(page, { name: 'keep' });
    const f = await openFrame(page, rec.id);
    await f.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('saved', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('s', 'readwrite');
        tx.objectStore('s').put('before update', 'note');
        tx.oncomplete = () => { idb.close(); resolve(); };
      };
    }));
    await closeFrames(page);
    assert.ok((await cacheNames(page)).includes('junk-drawer-shell-t1'));
    const oldCss = (await fetchInPage(page, 'styles/base.css')).text;
    assert.notEqual(oldCss, '/* t2 */');

    t.server.setBuild('t2');
    t.server.override('app/styles/base.css', '/* t2 */');
    await page.evaluate(async () => {
      const changed = new Promise((res) => navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }));
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
      await Promise.race([changed, new Promise((_, no) => setTimeout(() => no(new Error('no controllerchange')), 10_000))]);
      // controllerchange comes as activation starts; the cleanup runs in `activate`.
      const sw = navigator.serviceWorker.controller;
      if (sw.state !== 'activated') {
        await new Promise((res) => sw.addEventListener('statechange', () => sw.state === 'activated' && res()));
      }
    });
    assert.deepEqual(JSON.parse((await fetchInPage(page, '__jd/build')).text), { build: 't2' });
    const names = await cacheNames(page);
    assert.ok(!names.includes('junk-drawer-shell-t1'), JSON.stringify(names));
    assert.ok(names.includes('junk-drawer-shell-t2'), JSON.stringify(names));
    assert.equal((await fetchInPage(page, 'styles/base.css')).text, '/* t2 */');
    const linked = await page.evaluate(async () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'styles/base.css?after';
      await new Promise((res, rej) => { link.onload = res; link.onerror = rej; document.head.append(link); });
      return link.sheet.cssRules.length;
    });
    assert.equal(linked, 0);

    const frame = await openFrame(page, rec.id);
    const note = await frame.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('saved', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const idb = req.result;
        const get = idb.transaction('s').objectStore('s').get('note');
        get.onsuccess = () => { idb.close(); resolve(get.result); };
      };
    }));
    assert.equal(note, 'before update');
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages.map((p) => p.id), [rec.id]);
  } },

  { name: 'activation deletes only old Junk Drawer caches', run: async (t) => {
    const page = await t.openApp({ boot: false });
    await page.evaluate(async () => {
      const other = await caches.open('someone-elses-cache');
      await other.put('https://example.test/thing', new Response('theirs'));
      await caches.open('junk-drawer-shell-old');
    });
    await t.helpers.ensureWorker(page);
    const names = await cacheNames(page);
    assert.ok(names.includes('someone-elses-cache'), JSON.stringify(names));
    assert.ok(!names.includes('junk-drawer-shell-old'), JSON.stringify(names));
    assert.ok(names.includes('junk-drawer-shell-t1'), JSON.stringify(names));
    const kept = await page.evaluate(async () => {
      const c = await caches.open('someone-elses-cache');
      const r = await c.match('https://example.test/thing');
      return r && r.text();
    });
    assert.equal(kept, 'theirs');
  } },

  { name: 'dev build serves an overridden file fresh, and from cache offline', run: async (t) => {
    t.server.setBuild(null);
    const page = await setup(t);
    const first = (await fetchInPage(page, 'styles/base.css')).text;
    assert.notEqual(first, '/* fresh */');
    t.server.override('app/styles/base.css', '/* fresh */');
    assert.equal((await fetchInPage(page, 'styles/base.css')).text, '/* fresh */');
    assert.deepEqual(JSON.parse((await fetchInPage(page, '__jd/build')).text), { build: 'dev' });
    await page.waitForFunction(async () => {
      const c = await caches.open('junk-drawer-shell-dev');
      const r = await c.match('styles/base.css');
      return !!r && (await r.text()) === '/* fresh */';
    }, null, { timeout: 5000 });
    await t.context.setOffline(true);
    try {
      assert.equal((await fetchInPage(page, 'styles/base.css')).text, '/* fresh */');
    } finally {
      await t.context.setOffline(false);
    }
  } },
];
