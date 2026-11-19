'use strict';
// WP10: the viewer (app/js/viewer.js) and the host object it defines.

const assert = require('assert/strict');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAIN = (text) => `<!doctype html><html><head><title>${text}</title></head><body><p id="x">${text}</p></body></html>`;

async function init(t, page, { library = false } = {}) {
  await t.helpers.ensureWorker(page);
  await page.evaluate(async (lib) => {
    const v = await import('./js/viewer.js');
    window.__v = v;
    await v.initViewer();
    if (lib) {
      const l = await import('./js/library.js');
      document.addEventListener('jd:open-page', (e) => v.openPage(e.detail.id));
      await l.initLibrary();
    }
  }, library);
}

async function setup(t, opts) {
  const page = await t.openApp({ boot: false });
  await init(t, page, opts);
  return page;
}

const seed = (t, page, o) => t.helpers.seedPage(page, o);
const open = (page, id) => page.evaluate((id) => window.__v.openPage(id), id);
const isOpen = (page) => page.evaluate(() => window.__v.isViewerOpen());
const state = (page) => page.evaluate(() => history.state && history.state.jd);
const navIndex = (page) => page.evaluate(() => navigation.currentEntry.index);
const libraryBtn = (page) => page.locator('#viewer').getByRole('button', { name: 'library', exact: true });
const getPage = (page, id) => page.evaluate((id) => import('./js/db.js').then((m) => m.getPage(id)), id);
const whenSaved = (page) => page.evaluate(() => window.__v.whenSaved());

async function frameOf(t, page) {
  for (let i = 0; i < 200; i++) {
    const f = t.helpers.viewerFrame(page);
    if (f) {
      await f.waitForLoadState('load');
      return f;
    }
    await sleep(25);
  }
  throw new Error('no viewer frame appeared');
}

async function openAndWait(t, page, id) {
  await open(page, id);
  return frameOf(t, page);
}

async function waitClosed(page) {
  await page.waitForFunction(() => !window.__v.isViewerOpen() && document.getElementById('viewer').hidden, null, { timeout: 5000 });
}

async function closeWithButton(page) {
  await libraryBtn(page).click();
  await waitClosed(page);
}

async function closeWithBack(page) {
  await page.evaluate(() => history.back());
  await waitClosed(page);
}

async function localRows(t, page, id) {
  const dump = await t.helpers.dbDump(page);
  return Object.fromEntries(dump.local.filter((r) => r.pageId === id).map((r) => [r.key, r.value]));
}

async function routeExample(t) {
  await t.context.route('https://example.test/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>example</title><p>example site</p>',
  }));
}

module.exports = [
  { name: 'bar shows the name and a library button; the frame shows the page; the open is counted', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'Tip splitter', html: PLAIN('hello tip'), openCount: 4 });
    const before = await state(page);
    assert.equal(before, 'library');
    const f = await openAndWait(t, page, rec.id);
    assert.equal(await f.locator('#x').innerText(), 'hello tip');
    assert.equal(await page.locator('#viewer .view-name').innerText(), 'Tip splitter');
    assert.equal(await libraryBtn(page).isVisible(), true);
    assert.equal(await page.locator('#library').getAttribute('inert'), '');
    assert.equal(await state(page), 'view');
    const box = await page.locator('#viewer').boundingBox();
    assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 412, 915]);
    const frameBox = await page.locator('#viewer iframe').boundingBox();
    assert.ok(frameBox.height > 915 - 120, `frame height ${frameBox.height}`);
    const after = await getPage(page, rec.id);
    assert.equal(after.openCount, 5);
    assert.equal(typeof after.lastOpenedAt, 'number');
    assert.deepEqual(await t.helpers.realStorageKeys(page), { local: [], session: [] });
  } },

  { name: 'saved data persists across views and app reloads; sessionStorage lasts one view', run: async (t) => {
    let page = await setup(t);
    const rec = await seed(t, page, { name: 'notes', html: PLAIN('notes') });
    let f = await openAndWait(t, page, rec.id);
    await f.evaluate(() => {
      localStorage.setItem('k', 'v');
      sessionStorage.setItem('s', 'one');
      window.__mark = 1;
      setTimeout(() => location.reload(), 0);
    });
    await f.waitForFunction(() => !window.__mark && document.readyState === 'complete');
    assert.equal(await f.evaluate(() => sessionStorage.getItem('s')), 'one');
    assert.equal(await f.evaluate(() => localStorage.getItem('k')), 'v');
    await closeWithButton(page);

    f = await openAndWait(t, page, rec.id);
    assert.equal(await f.evaluate(() => localStorage.getItem('k')), 'v');
    assert.equal(await f.evaluate(() => sessionStorage.getItem('s')), null);
    await closeWithBack(page);
    await whenSaved(page);

    await page.reload();
    await page.waitForFunction(() => window.__jdReady === true);
    await init(t, page);
    f = await openAndWait(t, page, rec.id);
    assert.equal(await f.evaluate(() => localStorage.getItem('k')), 'v');
    assert.deepEqual(await t.helpers.realStorageKeys(page), { local: [], session: [] });
  } },

  { name: 'a page that sets a value and reloads itself sees it (counter reaches 3)', run: async (t) => {
    const page = await setup(t);
    const html = `<!doctype html><title>counter</title><p id="n"></p><script>
      var n = Number(localStorage.getItem('n') || 0);
      if (n < 3) { localStorage.setItem('n', String(n + 1)); location.reload(); }
      else document.getElementById('n').textContent = 'done ' + n;
    </script>`;
    const rec = await seed(t, page, { name: 'counter', html });
    await open(page, rec.id);
    const f = await frameOf(t, page);
    await f.waitForFunction(() => document.getElementById('n') && document.getElementById('n').textContent === 'done 3');
    await whenSaved(page);
    assert.deepEqual(await localRows(t, page, rec.id), { n: '3' });
  } },

  { name: 'the spec\'s worked example: clear() in one page leaves the other and the library alone', run: async (t) => {
    const page = await setup(t);
    const workout = await seed(t, page, { name: 'workout tracker', html: PLAIN('workout') });
    const tips = await seed(t, page, { name: 'tip splitter', html: PLAIN('tips') });
    let f = await openAndWait(t, page, workout.id);
    await f.evaluate(() => localStorage.setItem('state', 'workout history'));
    await closeWithButton(page);

    f = await openAndWait(t, page, tips.id);
    assert.equal(await f.evaluate(() => localStorage.getItem('state')), null);
    await f.evaluate(() => { localStorage.setItem('state', 'tips'); localStorage.clear(); });
    assert.equal(await f.evaluate(() => localStorage.length), 0);
    await closeWithButton(page);

    f = await openAndWait(t, page, workout.id);
    assert.equal(await f.evaluate(() => localStorage.getItem('state')), 'workout history');
    const list = await page.evaluate(() => import('./js/db.js').then((m) => m.listPages()));
    assert.deepEqual(list.map((p) => p.name).sort(), ['tip splitter', 'workout tracker']);
    await whenSaved(page);
    assert.deepEqual(await localRows(t, page, tips.id), {});
    assert.deepEqual(await localRows(t, page, workout.id), { state: 'workout history' });
  } },

  { name: 'IndexedDB data written by a page is there on reopen', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'idb', html: PLAIN('idb') });
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open('mydb', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    let f = await openAndWait(t, page, rec.id);
    await f.evaluate(async (src) => {
      const db = await (0, eval)(src)();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put('kept', 'a');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, `(${openDb})`);
    await closeWithButton(page);

    f = await openAndWait(t, page, rec.id);
    const got = await f.evaluate(async (src) => {
      const db = await (0, eval)(src)();
      const v = await new Promise((resolve) => {
        const req = db.transaction('kv').objectStore('kv').get('a');
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      return { v, name: db.name };
    }, `(${openDb})`);
    assert.deepEqual(got, { v: 'kept', name: 'mydb' });
    const names = (await t.helpers.dbDump(page)).databases;
    assert.ok(names.includes(`junk-drawer:page:${rec.id}:mydb`), names.join(', '));
  } },

  { name: 'closing keeps the library\'s scroll, sort and filter (button and back)', run: async (t) => {
    const page = await setup(t, { library: true });
    for (let i = 0; i < 40; i++) {
      await seed(t, page, { name: `page ${String(i).padStart(2, '0')}`, tags: i % 10 === 9 ? ['other'] : ['main'], addedAt: 1000 + i });
    }
    await page.locator('#lib-sort-select').selectOption('recent-added');
    await page.locator('.lib-chips .ui-chip').filter({ hasText: /^\s*✓?\s*main$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.lib-row').length === 36);
    await page.evaluate(() => window.scrollTo(0, 600));
    await sleep(100);
    const snap = () => page.evaluate(() => ({
      y: Math.round(window.scrollY),
      sort: document.getElementById('lib-sort-select').value,
      pressed: [...document.querySelectorAll('.lib-chips .ui-chip[aria-pressed="true"]')].map((c) => c.textContent.replace('✓', '').trim()),
      rows: document.querySelectorAll('.lib-row').length,
    }));
    const before = await snap();
    assert.ok(before.y >= 500, `scrollY ${before.y}`);
    assert.deepEqual(before.pressed, ['main']);

    // open from a row the owner can see, without letting Playwright scroll
    await page.evaluate(() => document.elementFromPoint(200, 450).closest('.lib-row').click());
    await frameOf(t, page);
    await closeWithButton(page);
    await sleep(200);
    assert.deepEqual(await snap(), before);

    await page.evaluate(() => document.elementFromPoint(200, 450).closest('.lib-row').click());
    await frameOf(t, page);
    await closeWithBack(page);
    await sleep(200);
    assert.deepEqual(await snap(), before);
    assert.equal(await state(page), 'library');
  } },

  { name: 'back steps through the page\'s hash history first; the library button closes in one step', run: async (t) => {
    const page = await setup(t);
    const html = '<!doctype html><title>hash</title><a id="a1" href="#one">one</a> <a id="a2" href="#two">two</a>';
    const rec = await seed(t, page, { name: 'hash', html });
    const index0 = await navIndex(page);
    const f = await openAndWait(t, page, rec.id);
    await f.click('#a1');
    await f.click('#a2');
    assert.equal(await f.evaluate(() => location.hash), '#two');
    await page.evaluate(() => history.back());
    await f.waitForFunction(() => location.hash === '#one');
    await sleep(100);
    assert.equal(await isOpen(page), true);
    assert.equal(await page.locator('#viewer').isVisible(), true);
    await closeWithButton(page);
    assert.equal(await state(page), 'library');
    assert.equal(await navIndex(page), index0);
  } },

  { name: 'reload while viewing returns to the library; the next open closes in one step', run: async (t) => {
    const page = await setup(t);
    const html = '<!doctype html><title>hash</title><a id="a1" href="#one">one</a> <a id="a2" href="#two">two</a>';
    const rec = await seed(t, page, { name: 'hash', html });
    let f = await openAndWait(t, page, rec.id);
    await f.click('#a1');
    await f.click('#a2');
    await page.reload();
    await page.waitForFunction(() => window.__jdReady === true);
    await init(t, page);
    assert.equal(await state(page), 'library');
    assert.equal(await page.locator('#viewer').isHidden(), true);
    assert.equal(await isOpen(page), false);

    const index0 = await navIndex(page);
    f = await openAndWait(t, page, rec.id);
    await f.click('#a1');
    await closeWithButton(page);
    assert.equal(await state(page), 'library');
    assert.equal(await navIndex(page), index0);
  } },

  { name: 'the library button still closes when navigation.traverseTo rejects or hangs', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'fallback', html: PLAIN('fallback') });
    await openAndWait(t, page, rec.id);
    await page.evaluate(() => { navigation.traverseTo = () => Promise.reject(new Error('stubbed')); });
    await closeWithButton(page);
    assert.equal(await state(page), 'library');

    await openAndWait(t, page, rec.id);
    await page.evaluate(() => {
      const never = new Promise(() => {});
      navigation.traverseTo = () => ({ committed: never, finished: never });
    });
    await closeWithButton(page);
    assert.equal(await state(page), 'library');
  } },

  { name: 'two openPage calls in the same tick make one iframe and one history entry', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'once', html: PLAIN('once') });
    const r = await page.evaluate(async (id) => {
      const before = navigation.entries().length;
      await Promise.all([window.__v.openPage(id), window.__v.openPage(id)]);
      return { added: navigation.entries().length - before, frames: document.querySelectorAll('#viewer iframe').length };
    }, rec.id);
    assert.deepEqual(r, { added: 1, frames: 1 });
    await frameOf(t, page);
    assert.equal((await getPage(page, rec.id)).openCount, 1);
  } },

  { name: 'a link to a file beside the page shows the missing-file notice and stays put', run: async (t) => {
    const page = await setup(t);
    const html = '<!doctype html><title>links</title><a id="l" href="about.html">about</a>';
    const rec = await seed(t, page, { name: 'links', html });
    let newPages = 0;
    t.context.on('page', () => { newPages++; });
    const f = await openAndWait(t, page, rec.id);
    await f.click('#l');
    const notice = page.locator('.ui-notice').filter({ hasText: 'about.html' });
    await notice.waitFor();
    assert.match(await notice.innerText(), /“links” links to a file that was beside it/);
    // the notice now covers the link, so tap it from the page's side
    await f.evaluate(() => document.getElementById('l').click());
    await sleep(300);
    assert.equal(await notice.count(), 1);
    assert.ok(f.url().endsWith(`/p/${rec.id}/`), f.url());
    assert.equal(newPages, 0);
  } },

  { name: '500 setItem calls are all stored in far fewer transactions', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'many', html: PLAIN('many') });
    const f = await openAndWait(t, page, rec.id);
    await page.evaluate(() => {
      window.__tx = 0;
      const real = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
        const list = typeof names === 'string' ? [names] : [...names];
        if (mode === 'readwrite' && list.includes('pageLocal')) window.__tx++;
        return real.call(this, names, mode, ...rest);
      };
    });
    await f.evaluate(() => { for (let i = 0; i < 500; i++) localStorage.setItem(`k${i}`, String(i)); });
    await whenSaved(page);
    const rows = await localRows(t, page, rec.id);
    assert.equal(Object.keys(rows).length, 500);
    assert.equal(rows.k499, '499');
    const tx = await page.evaluate(() => window.__tx);
    assert.ok(tx >= 1 && tx <= 5, `transactions: ${tx}`);
  } },

  { name: 'every open is fresh: window state does not carry over', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'fresh', html: PLAIN('fresh') });
    let f = await openAndWait(t, page, rec.id);
    await f.evaluate(() => { window.__left = 'over'; });
    await closeWithButton(page);
    assert.equal(await page.locator('#viewer iframe').count(), 0);
    f = await openAndWait(t, page, rec.id);
    assert.equal(await f.evaluate(() => window.__left), undefined);
  } },

  { name: 'top.location from the page leaves Junk Drawer in place', run: async (t) => {
    await routeExample(t);
    const page = await setup(t);
    const html = `<!doctype html><title>top</title><button id="b" onclick="
      try { top.location = 'https://example.test/'; document.body.dataset.r = 'no error'; }
      catch (e) { document.body.dataset.r = e.name; }">go</button>`;
    const rec = await seed(t, page, { name: 'top', html });
    const url = page.url();
    const f = await openAndWait(t, page, rec.id);
    await f.click('#b');
    await sleep(300);
    assert.equal(await f.evaluate(() => document.body.dataset.r), 'SecurityError');
    assert.equal(page.url(), url);
    assert.equal(await isOpen(page), true);
    assert.ok(t.helpers.viewerFrame(page));
  } },

  { name: 'a tapped link to another site opens a browser page; a scripted one shows a notice', run: async (t) => {
    await routeExample(t);
    const page = await setup(t);
    const html = '<!doctype html><title>ext</title><a id="ext" href="https://example.test/hello">elsewhere</a>';
    const rec = await seed(t, page, { name: 'ext', html });
    const f = await openAndWait(t, page, rec.id);
    const [popup] = await Promise.all([t.context.waitForEvent('page'), f.click('#ext')]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://example.test/hello');
    await popup.close();
    assert.ok(f.url().endsWith(`/p/${rec.id}/`), f.url());
    assert.equal(await f.locator('#ext').count(), 1);

    await f.evaluate(() => { location.href = 'https://example.test/scripted'; });
    const notice = page.locator('.ui-notice').filter({ hasText: 'https://example.test/scripted' });
    await notice.waitFor();
    assert.match(await notice.innerText(), /“ext” tried to go to another site/);
    assert.equal(await notice.getByRole('link', { name: 'open in browser' }).getAttribute('href'), 'https://example.test/scripted');
    await sleep(200);
    assert.ok(f.url().endsWith(`/p/${rec.id}/`), f.url());
    assert.equal(await f.locator('#ext').count(), 1);
  } },

  { name: 'alert() from the page shows a dialog', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'alerts', html: PLAIN('alerts') });
    const f = await openAndWait(t, page, rec.id);
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog'),
      f.evaluate(() => { setTimeout(() => alert('hello from the page'), 0); }),
    ]);
    assert.equal(dialog.type(), 'alert');
    assert.equal(dialog.message(), 'hello from the page');
    await dialog.accept();
  } },

  { name: 'a missing stored copy shows the in-place error with copy details; the open is not counted', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'gone', html: PLAIN('gone') });
    await page.evaluate((id) => new Promise((resolve, reject) => {
      const req = indexedDB.open('junk-drawer');
      req.onsuccess = () => {
        const tx = req.result.transaction('files', 'readwrite');
        tx.objectStore('files').delete(id);
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }), rec.id);
    await open(page, rec.id);
    const panel = page.locator('#viewer .view-error');
    await panel.waitFor();
    assert.match(await panel.innerText(), /Junk Drawer’s copy of “gone” is missing/);
    assert.equal(await panel.getByRole('button', { name: 'copy details' }).isVisible(), true);
    assert.equal(await page.locator('#viewer iframe').count(), 0);
    assert.equal(await libraryBtn(page).isVisible(), true);
    assert.equal((await getPage(page, rec.id)).openCount, 0);
    await closeWithButton(page);
    assert.equal(await state(page), 'library');
  } },

  { name: 'the service worker\'s error document shows the in-place error', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'broken', html: PLAIN('broken') });
    const f = await openAndWait(t, page, rec.id);
    // the stored copy vanishes, then the page reloads itself
    await page.evaluate((id) => new Promise((resolve, reject) => {
      const req = indexedDB.open('junk-drawer');
      req.onsuccess = () => {
        const tx = req.result.transaction('files', 'readwrite');
        tx.objectStore('files').delete(id);
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }), rec.id);
    await f.evaluate(() => { setTimeout(() => location.reload(), 0); });
    const panel = page.locator('#viewer .view-error');
    await panel.waitFor();
    assert.match(await panel.innerText(), /Junk Drawer’s copy of “broken” is missing/);
    assert.equal(await page.locator('#viewer iframe').count(), 0);
    assert.equal(await libraryBtn(page).isVisible(), true);
  } },

  { name: 'a page that never starts gets page-unreadable in place', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'silent', html: PLAIN('silent') });
    // a host that never hears "ready": the frame's load event trips the watchdog
    await page.evaluate(() => {
      const host = window.__junkDrawerHost;
      const real = host.connect;
      host.connect = (id) => {
        const c = real(id);
        if (!c) return c;
        return { ...c, notify: (type, data) => { if (type !== 'ready') c.notify(type, data); } };
      };
    });
    await open(page, rec.id);
    const panel = page.locator('#viewer .view-error');
    await panel.waitFor();
    assert.match(await panel.innerText(), /Couldn’t load the page/);
    assert.equal(await panel.getByRole('button', { name: 'copy details' }).count(), 1);
  } },

  { name: 'an unknown id shows a notice and no viewer', run: async (t) => {
    const page = await setup(t);
    await open(page, 'no-such-page');
    await page.locator('.ui-notice').waitFor();
    assert.equal(await page.locator('#viewer').isHidden(), true);
    assert.equal(await isOpen(page), false);
    assert.equal(await state(page), 'library');
    assert.equal(await page.locator('#library').getAttribute('inert'), null);
  } },

  { name: 'filling localStorage past the quota throws QuotaExceededError and shows one notice', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'hog', html: PLAIN('hog') });
    const f = await openAndWait(t, page, rec.id);
    const r = await f.evaluate(() => {
      const big = 'x'.repeat(1_000_000);
      const names = [];
      for (let i = 0; i < 8; i++) {
        try { localStorage.setItem(`b${i}`, big); } catch (e) { names.push(e.name); }
      }
      return names;
    });
    assert.ok(r.length >= 2, r.join(','));
    assert.ok(r.every((n) => n === 'QuotaExceededError'), r.join(','));
    await whenSaved(page);
    await sleep(200);
    assert.equal(await page.locator('.ui-notice').filter({ hasText: 'Data not saved' }).count(), 1);
    assert.match(await page.locator('.ui-notice').innerText(), /“hog”/);
  } },

  { name: 'a write made in the same tick the viewer closes is stored', run: async (t) => {
    const page = await setup(t);
    const rec = await seed(t, page, { name: 'late', html: PLAIN('late') });
    await openAndWait(t, page, rec.id);
    await page.evaluate(() => {
      const w = document.querySelector('#viewer iframe').contentWindow;
      window.addEventListener('popstate', () => { w.localStorage.setItem('late', 'yes'); }, { once: true });
      history.back();
    });
    await waitClosed(page);
    await whenSaved(page);
    assert.deepEqual(await localRows(t, page, rec.id), { late: 'yes' });
    assert.equal(await page.locator('.ui-notice').count(), 0);
    const f = await openAndWait(t, page, rec.id);
    assert.equal(await f.evaluate(() => localStorage.getItem('late')), 'yes');
  } },

  { name: 'the page URL opened top-level says to open it from Junk Drawer and runs nothing', run: async (t) => {
    const page = await setup(t);
    const html = '<!doctype html><title>own</title><script>document.title = "ran"; localStorage.setItem("ran", "1");</script><p>own</p>';
    const rec = await seed(t, page, { name: 'own', html });
    const tab = await t.context.newPage();
    await tab.goto(new URL(`p/${rec.id}/`, t.appUrl).href, { waitUntil: 'commit' });
    await tab.waitForFunction(() => /open this page from Junk Drawer/.test(document.body ? document.body.innerText : ''));
    await sleep(200);
    assert.notEqual(await tab.title(), 'ran');
    assert.deepEqual(await t.helpers.realStorageKeys(tab), { local: [], session: [] });
    await tab.close();
  } },
];
