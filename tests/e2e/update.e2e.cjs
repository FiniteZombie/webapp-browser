'use strict';
// WP11: picking up a deploy. The app may reload under the test, so state is
// polled from Node with try/catch rather than awaited in one evaluation.

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_CSS = fs.readFileSync(path.join(__dirname, '../../app/styles/base.css'), 'utf8');
const PLAIN = (title, text = title) => `<!doctype html><html><head><title>${title}</title></head><body><p id="x">${text}</p></body></html>`;

const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const openDialog = (page, text) => page.locator('#dialogs dialog[open]', { hasText: text });
const row = (page, name) => page.locator('.lib-row').filter({
  has: page.locator('.lib-name', { hasText: new RegExp(`^${name}$`) }),
});
const libraryBtn = (page) => page.locator('#viewer').getByRole('button', { name: 'library', exact: true });

// Evaluates fn until it returns something truthy; survives reloads.
async function until(page, fn, arg, { timeout = 10_000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

// Opens the app, counts top-level loads, waits until build t1 controls it.
async function boot(t) {
  const loads = { n: 0 };
  const page = await t.context.newPage();
  page.on('load', () => { loads.n++; });
  await page.goto(t.appUrl);
  await until(page, () => window.__jdReady === true, null, { what: 'boot' });
  await until(page, () => {
    const c = navigator.serviceWorker.controller;
    return c && c.state === 'activated';
  }, null, { what: 'the first worker' });
  await footer(page, 't1');
  return { page, loads };
}

const footer = (page, build) => until(page, (b) => {
  const el = document.querySelector('.lib-build');
  return window.__jdReady === true && el && el.textContent === `build ${b}`;
}, build, { what: `footer build ${build}` });

// Deploys build t2 and asks the worker to check for it.
async function deploy(t, page) {
  t.server.setBuild('t2');
  t.server.override('app/styles/base.css', `${BASE_CSS}\n:root { --wp11-build: t2; }\n`);
  await page.evaluate(() => {
    window.__oldController = navigator.serviceWorker.controller;
    return navigator.serviceWorker.getRegistration().then((r) => r.update());
  });
}

// Waits until build t2 controls the window. It polls the worker objects, not
// fetch(): a stream of fetch events keeps the old worker busy, which holds
// back the new one's activation.
const t2Controls = (page) => until(page, () => {
  const c = navigator.serviceWorker.controller;
  return c && c !== window.__oldController && c.state === 'activated';
}, null, { what: 'build t2 to take over' }).then(async () => {
  const build = await page.evaluate(() => fetch('__jd/build', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.build));
  assert.equal(build, 't2');
}, async (err) => {
  const s = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const st = (w) => (w ? w.state : '-');
    const c = navigator.serviceWorker.controller;
    let b = '?';
    try { b = (await (await fetch('__jd/build', { cache: 'no-store' })).json()).build; } catch (e) { b = String(e); }
    return `installing ${st(r.installing)} waiting ${st(r.waiting)} active ${st(r.active)} controller ${st(c)} build ${b}`;
  }).catch((e) => String(e));
  throw new Error(`${err.message} (${s})`);
});

const reloadedTo = async (page, loads, n) => {
  const end = Date.now() + 10_000;
  while (loads.n < n && Date.now() < end) await sleep(100);
  assert.equal(loads.n, n, 'load events');
  await until(page, () => window.__jdReady === true, null, { what: 'boot after reload' });
};

const styleMarker = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wp11-build').trim());

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

async function seed(t, page, name) {
  const rec = await t.helpers.seedPage(page, { name, html: PLAIN(name) });
  await row(page, name).waitFor();
  return rec;
}

module.exports = [
  { name: 'a deploy at the library reloads by itself and keeps pages, saved data and the sort', run: async (t) => {
    const { page, loads } = await boot(t);
    const a = await seed(t, page, 'alpha');
    await seed(t, page, 'beta');
    await page.evaluate((id) => import('./js/db.js').then((db) => db.applyLocalOps(id, [{ op: 'set', key: 'k', value: 'v' }])), a.id);
    await page.locator('#lib-sort-select').selectOption('recent-added');
    await sleep(200);
    assert.equal(await styleMarker(page), '');
    assert.equal(loads.n, 1);
    await deploy(t, page);
    await reloadedTo(page, loads, 2);
    await footer(page, 't2');
    assert.equal(await styleMarker(page), 't2');
    assert.equal(await page.locator('#lib-sort-select').inputValue(), 'recent-added');
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages.map((p) => p.name).sort(), ['alpha', 'beta']);
    assert.deepEqual(dump.local, [{ pageId: a.id, key: 'k', value: 'v' }]);
    assert.equal(dump.settings['library.sort'], 'recent-added');
    await sleep(2500);
    assert.equal(loads.n, 2, 'one reload only');
  } },

  { name: 'no reload while viewing a page; one once the viewer closes', run: async (t) => {
    const { page, loads } = await boot(t);
    await seed(t, page, 'alpha');
    await row(page, 'alpha').click();
    await frameOf(t, page);
    await deploy(t, page);
    await t2Controls(page);
    await sleep(2500);
    assert.equal(loads.n, 1, 'no reload while viewing');
    assert.equal(await page.locator('#viewer').isVisible(), true);
    await libraryBtn(page).click();
    await reloadedTo(page, loads, 2);
    await footer(page, 't2');
  } },

  { name: 'no reload with a dialog open; one after it closes and the next trigger fires', run: async (t) => {
    const { page, loads } = await boot(t);
    await seed(t, page, 'alpha');
    await row(page, 'alpha').click({ button: 'right' });
    await page.locator('#dialogs dialog[open]').waitFor();
    await deploy(t, page);
    await t2Controls(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:library-changed')));
    await sleep(2500);
    assert.equal(loads.n, 1, 'no reload with a dialog open');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:library-changed')));
    await reloadedTo(page, loads, 2);
    await footer(page, 't2');
  } },

  { name: 'an update that lands mid-add does not cut it short', run: async (t) => {
    const { page, loads } = await boot(t);
    await t.helpers.setNextPick(page, { name: 'mid.html', html: PLAIN('mid add') });
    await btn(page, 'add new page').click();
    const details = openDialog(page, 'add a page');
    await details.waitFor();
    await deploy(t, page);
    await t2Controls(page);
    await sleep(500);
    assert.equal(loads.n, 1);
    await details.locator('button[type=submit]').click();
    const sheet = openDialog(page, 'back to library');
    await sheet.waitFor({ timeout: 5000 });
    await sleep(2500);   // past the libraryChanged the add dispatched
    assert.equal(loads.n, 1, 'no reload before the sheet is answered');
    assert.equal(await sheet.isVisible(), true);
    await btn(sheet, 'back to library').click();
    await reloadedTo(page, loads, 2);
    await footer(page, 't2');
    await row(page, 'mid add').waitFor();
    assert.equal((await t.helpers.dbDump(page)).pages.length, 1);
  } },

  { name: 'a localStorage write just before closing survives the update reload after the close', run: async (t) => {
    const { page, loads } = await boot(t);
    const rec = await seed(t, page, 'alpha');
    await row(page, 'alpha').click();
    const f = await frameOf(t, page);
    await deploy(t, page);
    await t2Controls(page);
    await f.evaluate(() => {
      const big = 'x'.repeat(200_000);
      for (let i = 0; i < 20; i++) localStorage.setItem(`k${i}`, big);
      localStorage.setItem('last', 'written');
    });
    await libraryBtn(page).click();
    await reloadedTo(page, loads, 2);
    const dump = await t.helpers.dbDump(page);
    const mine = dump.local.filter((r) => r.pageId === rec.id);
    assert.equal(mine.length, 21);
    assert.equal(mine.find((r) => r.key === 'last').value, 'written');
  } },

  { name: 'a second addPage while a flow is in flight opens no second dialog', run: async (t) => {
    const { page } = await boot(t);
    await t.helpers.setNextPick(page, { name: 'one.html', html: PLAIN('one') });
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('jd:add-page'));
      document.dispatchEvent(new CustomEvent('jd:add-page'));
    });
    await openDialog(page, 'add a page').waitFor();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:add-page')));
    await sleep(500);
    assert.equal(await page.locator('#dialogs dialog').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'));
    await sleep(100);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:add-page')));
    await openDialog(page, 'add a page').waitFor({ timeout: 5000 });
  } },

  { name: 'first install: no reload, and the footer goes from unknown to t1 without one', run: async (t) => {
    await t.context.addInitScript(() => {
      if (window !== window.top) return;
      window.__builds = [];
      new MutationObserver(() => {
        const el = document.querySelector('.lib-build');
        const text = el && el.textContent;
        if (text && window.__builds[window.__builds.length - 1] !== text) window.__builds.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const { page, loads } = await boot(t);
    await sleep(2500);
    assert.equal(loads.n, 1, 'no reload on first install');
    const builds = await page.evaluate(() => window.__builds);
    assert.deepEqual(builds, ['build unknown', 'build t1']);
  } },
];
