'use strict';
// WP9: the library view (app/js/library.js).

const assert = require('assert/strict');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;

async function open(t, init) {
  const page = await t.openApp({ boot: false });
  if (init) await init(page);
  await page.evaluate(() => {
    window.__ev = [];
    for (const type of ['jd:open-page', 'jd:add-page', 'jd:replace-file']) {
      document.addEventListener(type, (e) => window.__ev.push({ type, detail: e.detail || null }));
    }
  });
  await page.evaluate(() => import('./js/library.js').then((m) => m.initLibrary()));
  return page;
}

const events = (page) => page.evaluate(() => window.__ev);
const names = (page) => page.locator('.lib-row .lib-name').allTextContents();
const row = (page, name) => page.locator('.lib-row').filter({ has: page.locator('.lib-name', { hasText: new RegExp(`^${name}$`) }) });
const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const chip = (page, tag) => page.locator('.lib-chips .ui-chip').filter({ hasText: new RegExp(`^\\s*✓?\\s*${tag}$`) });
const sheet = (page) => page.locator('dialog[open]');

async function seedAll(t, page, list) {
  for (const o of list) await t.helpers.seedPage(page, o);
}

async function pick(page, id) {
  await page.locator('#lib-sort-select').selectOption(id);
  await page.waitForTimeout(100);
}

async function longPress(page, locator, { ms, move = 0 }) {
  const box = await locator.boundingBox();
  const x = box.x + 20;
  const y = box.y + box.height / 2;
  await locator.evaluate((node, a) => {
    const mk = (type, dx) => new PointerEvent(type, {
      pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true, cancelable: true,
      clientX: a.x + dx, clientY: a.y,
    });
    node.dispatchEvent(mk('pointerdown', 0));
    if (a.move) node.dispatchEvent(mk('pointermove', a.move));
  }, { x, y, move });
  await sleep(ms);
}

module.exports = [
  { name: 'empty library explains itself, offers add, hides controls', run: async (t) => {
    const page = await open(t);
    await page.locator('.lib-empty').waitFor();
    assert.match(await page.locator('.lib-empty').innerText(), /web apps/);
    assert.equal(await page.locator('.lib-controls').isVisible(), false);
    await btn(page, 'add new page').click();
    assert.deepEqual((await events(page)).map((e) => e.type), ['jd:add-page']);
  } },

  { name: 'rows show name and tags; a tap opens the page', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'alpha', tags: ['games', 'fun'] });
    const b = await t.helpers.seedPage(page, { name: 'beta', tags: ['tools'] });
    await page.locator('.lib-row').nth(1).waitFor();
    assert.deepEqual(await names(page), ['alpha', 'beta']);
    assert.match(await row(page, 'alpha').innerText(), /games, fun/);
    await row(page, 'beta').click();
    const ev = await events(page);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].type, 'jd:open-page');
    assert.equal(ev[0].detail.id, b.id);
  } },

  { name: 'pinned pages come first under every sort and say pinned', run: async (t) => {
    const page = await open(t);
    const now = Date.now();
    await seedAll(t, page, [
      { name: 'a', addedAt: now - 1 * DAY, openCount: 9, lastOpenedAt: now - 1 * DAY },
      { name: 'z', pinned: true, addedAt: now - 9 * DAY, openCount: 0, lastOpenedAt: null },
      { name: 'm', addedAt: now - 5 * DAY, openCount: 1, lastOpenedAt: now - 2 * DAY },
    ]);
    await page.locator('.lib-row').nth(2).waitFor();
    for (const s of ['name', 'recent-opened', 'recent-added', 'most-opened']) {
      await pick(page, s);
      assert.equal((await names(page))[0], 'z', s);
    }
    assert.match(await row(page, 'z').innerText(), /pinned/);
    assert.doesNotMatch(await row(page, 'a').innerText(), /pinned/);
  } },

  { name: 'each sort gives the expected order', run: async (t) => {
    const page = await open(t);
    const now = Date.now();
    await seedAll(t, page, [
      { name: 'carrot', addedAt: now - 3 * DAY, openCount: 5, lastOpenedAt: now - 3 * DAY },
      { name: 'apple', addedAt: now - 1 * DAY, openCount: 1, lastOpenedAt: now - 10 * DAY },
      { name: 'banana', addedAt: now - 2 * DAY, openCount: 3, lastOpenedAt: null },
    ]);
    await page.locator('.lib-row').nth(2).waitFor();
    assert.deepEqual(await names(page), ['apple', 'banana', 'carrot']);
    await pick(page, 'recent-opened');
    // banana was never opened: counts by its added date (2 days ago)
    assert.deepEqual(await names(page), ['banana', 'carrot', 'apple']);
    await pick(page, 'recent-added');
    assert.deepEqual(await names(page), ['apple', 'banana', 'carrot']);
    await pick(page, 'most-opened');
    assert.deepEqual(await names(page), ['carrot', 'banana', 'apple']);
  } },

  { name: 'the sort survives a reload; the tag filter does not', run: async (t) => {
    const page = await open(t);
    const now = Date.now();
    await seedAll(t, page, [
      { name: 'a', tags: ['x'], addedAt: now - 3 * DAY },
      { name: 'b', tags: ['y'], addedAt: now - 1 * DAY },
    ]);
    await page.locator('.lib-row').nth(1).waitFor();
    await pick(page, 'recent-added');
    await chip(page, 'x').click();
    assert.deepEqual(await names(page), ['a']);
    await page.reload();
    await page.waitForFunction(() => window.__jdReady === true);
    await page.evaluate(() => import('./js/library.js').then((m) => m.initLibrary()));
    await page.locator('.lib-row').nth(1).waitFor();
    assert.equal(await page.locator('#lib-sort-select').inputValue(), 'recent-added');
    assert.deepEqual(await names(page), ['b', 'a']);
    assert.equal(await page.locator('.ui-chip[aria-pressed="true"]').count(), 0);
  } },

  { name: 'tag chips filter, hide non-matching pins, and show state', run: async (t) => {
    const page = await open(t);
    await seedAll(t, page, [
      { name: 'p1', tags: ['games'], pinned: true },
      { name: 'p2', tags: ['games', 'fun'] },
      { name: 'p3', tags: ['fun'] },
    ]);
    await page.locator('.lib-row').nth(2).waitFor();
    assert.deepEqual(await page.locator('.lib-chips .ui-chip').allInnerTexts().then((a) => a.map((s) => s.replace('✓', '').trim())), ['fun', 'games']);
    const games = chip(page, 'games');
    const fun = chip(page, 'fun');
    assert.equal(await games.getAttribute('aria-pressed'), 'false');
    assert.equal(await games.locator('.lib-chip-mark').isVisible(), false);
    await games.click();
    assert.equal(await games.getAttribute('aria-pressed'), 'true');
    assert.equal(await games.locator('.lib-chip-mark').isVisible(), true);
    assert.deepEqual(await names(page), ['p1', 'p2']);
    await fun.click();
    assert.deepEqual(await names(page), ['p2']);
    await games.click();
    await fun.click();
    await chip(page, 'games').click();
    await chip(page, 'fun').click();
    assert.equal(await page.locator('.lib-none').isVisible(), false);
    // p1 (pinned, games only) is hidden when both are on
    assert.deepEqual(await names(page), ['p2']);
    await chip(page, 'games').click();
    await chip(page, 'fun').click();
    assert.deepEqual(await names(page), ['p1', 'p2', 'p3']);
  } },

  { name: 'a filter with no matches says so', run: async (t) => {
    const page = await open(t);
    await seedAll(t, page, [{ name: 'a', tags: ['x'] }, { name: 'b', tags: ['y'] }]);
    await page.locator('.lib-row').nth(1).waitFor();
    await chip(page, 'x').click();
    await chip(page, 'y').click();
    assert.equal(await page.locator('.lib-row').count(), 0);
    assert.match(await page.locator('.lib-none').innerText(), /no pages have all of those tags/);
  } },

  { name: 'right-click opens the sheet and does not open the page', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'alpha' });
    await row(page, 'alpha').click({ button: 'right' });
    await sheet(page).waitFor();
    assert.equal(await sheet(page).count(), 1);
    assert.deepEqual(await events(page), []);
  } },

  { name: 'a 600 ms touch hold opens the sheet once and swallows the click', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'alpha' });
    const r = row(page, 'alpha');
    await r.waitFor();
    await longPress(page, r, { ms: 600 });
    await sheet(page).waitFor();
    // a contextmenu right behind the hold must not open a second one
    await r.evaluate((n) => n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await sleep(100);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await r.evaluate((n) => n.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.deepEqual(await events(page), []);
  } },

  { name: 'a touch hold that moves 30px does not open the sheet', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'alpha' });
    const r = row(page, 'alpha');
    await r.waitFor();
    await longPress(page, r, { ms: 700, move: 30 });
    assert.equal(await page.locator('dialog[open]').count(), 0);
  } },

  { name: 'pin then unpin through the sheet', run: async (t) => {
    const page = await open(t);
    await seedAll(t, page, [{ name: 'a' }, { name: 'b' }]);
    await page.locator('.lib-row').nth(1).waitFor();
    await row(page, 'b').click({ button: 'right' });
    await btn(sheet(page), 'pin').click();
    await page.waitForFunction(() => document.querySelector('.lib-row .lib-name').textContent === 'b');
    assert.match(await row(page, 'b').innerText(), /pinned/);
    await row(page, 'b').click({ button: 'right' });
    await btn(sheet(page), 'unpin').click();
    await page.waitForFunction(() => document.querySelector('.lib-row .lib-name').textContent === 'a');
    assert.doesNotMatch(await row(page, 'b').innerText(), /pinned/);
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.every((p) => p.pinned === false), true);
  } },

  { name: 'edit renames, retags, and drops a tag nobody uses', run: async (t) => {
    const page = await open(t);
    await seedAll(t, page, [{ name: 'a', tags: ['solo'] }, { name: 'b', tags: ['shared'] }, { name: 'c', tags: ['shared'] }]);
    await page.locator('.lib-row').nth(2).waitFor();
    await chip(page, 'solo').click();
    assert.deepEqual(await names(page), ['a']);
    await row(page, 'a').click({ button: 'right' });
    await btn(sheet(page), 'edit name and tags').click();
    const dlg = sheet(page);
    await dlg.getByLabel('name').fill('renamed');
    await dlg.getByRole('button', { name: /solo/ }).click(); // turn it off
    await dlg.getByLabel('new tags, separated by commas').fill('Games, games , FUN');
    await btn(dlg, 'save').click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    // the filter on "solo" is dropped, so all three pages show
    await page.locator('.lib-row').nth(2).waitFor();
    assert.deepEqual(await names(page), ['b', 'c', 'renamed']);
    assert.equal(await chip(page, 'solo').count(), 0);
    assert.equal(await page.locator('.ui-chip[aria-pressed="true"]').count(), 0);
    const dump = await t.helpers.dbDump(page);
    const rec = dump.pages.find((p) => p.name === 'renamed');
    assert.deepEqual([...rec.tags].sort(), ['fun', 'games']);
  } },

  { name: 'replace file dispatches replaceFile with the id', run: async (t) => {
    const page = await open(t);
    const rec = await t.helpers.seedPage(page, { name: 'alpha' });
    await row(page, 'alpha').click({ button: 'right' });
    await btn(sheet(page), 'replace file').click();
    const ev = await events(page);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].type, 'jd:replace-file');
    assert.equal(ev[0].detail.id, rec.id);
  } },

  { name: 'remove confirms by name; cancel keeps, confirm deletes everything', run: async (t) => {
    const page = await open(t);
    const rec = await t.helpers.seedPage(page, { name: 'alpha' });
    await t.helpers.seedPage(page, { name: 'beta' });
    await page.evaluate((id) => import('./js/db.js').then((db) =>
      db.applyLocalOps(id, [{ op: 'set', key: 'k', value: 'v' }])), rec.id);
    await row(page, 'alpha').click({ button: 'right' });
    await btn(sheet(page), 'remove').click();
    assert.match(await sheet(page).innerText(), /“alpha” and its saved data will be deleted for good/);
    await btn(sheet(page), 'keep it').click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.equal(await page.locator('.lib-row').count(), 2);

    await row(page, 'alpha').click({ button: 'right' });
    await btn(sheet(page), 'remove').click();
    await btn(sheet(page), 'remove').click();
    await page.waitForFunction(() => document.querySelectorAll('.lib-row').length === 1);
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.some((p) => p.id === rec.id), false);
    assert.equal(dump.files.some((f) => f.id === rec.id), false);
    assert.equal(dump.local.some((r) => r.pageId === rec.id), false);
  } },

  { name: 'a re-render keeps the scroll position', run: async (t) => {
    const page = await open(t);
    for (let i = 0; i < 40; i++) await t.helpers.seedPage(page, { name: `page ${String(i).padStart(2, '0')}` });
    await page.waitForFunction(() => document.querySelectorAll('.lib-row').length === 40);
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);
    assert.ok(before > 300, `scrolled ${before}`);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:library-changed')));
    await sleep(300);
    assert.equal(await page.evaluate(() => window.scrollY), before);
  } },

  { name: 'the storage warning follows navigator.storage.persisted()', run: async (t) => {
    for (const value of [false, true]) {
      const page = await t.context.newPage();
      await page.addInitScript((v) => {
        window.__jdTest = { noBoot: true };
        Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: () => Promise.resolve(v) });
      }, value);
      await page.goto(t.appUrl);
      await page.evaluate(() => import('./js/library.js').then((m) => m.initLibrary()));
      await page.locator('.lib-footer').waitFor();
      assert.equal(await page.locator('.lib-warning').isVisible(), !value, `persisted=${value}`);
      if (!value) assert.match(await page.locator('.lib-warning').innerText(), /clear your pages/);
      await page.close();
    }
  } },

  { name: 'the footer shows the build and the troubleshooting buttons', run: async (t) => {
    const page = await open(t);
    assert.match(await page.locator('.lib-build').innerText(), /^build \S+/);
    await btn(page, 'offer to delete downloaded files again').waitFor({ state: 'hidden' });
    await page.evaluate(() => import('./js/db.js').then((db) => db.setSetting('deleteOriginal.broken', true)));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('jd:library-changed')));
    const again = btn(page, 'offer to delete downloaded files again');
    await again.waitFor();
    await again.click();
    await again.waitFor({ state: 'hidden' });
    assert.equal((await t.helpers.dbDump(page)).settings['deleteOriginal.broken'], false);
  } },

  { name: 'the picker switch flips fsaBroken and its wording follows', run: async (t) => {
    const page = await open(t, (p) => p.addInitScript(() => {
      window.showOpenFilePicker = window.showOpenFilePicker || (() => Promise.reject(new Error('stub')));
    }));
    await page.locator('.lib-picker-text').waitFor();
    assert.match(await page.locator('.lib-picker-text').innerText(), /^file picker: full \(can delete the download afterwards\)$/);
    await btn(page, 'use the simple picker').click();
    await btn(page, 'use the full picker').waitFor();
    assert.equal(await page.locator('.lib-picker-text').innerText(), 'file picker: simple');
    assert.equal((await t.helpers.dbDump(page)).settings['picker.fsaBroken'], true);
    await btn(page, 'use the full picker').click();
    await btn(page, 'use the simple picker').waitFor();
    assert.equal((await t.helpers.dbDump(page)).settings['picker.fsaBroken'], false);
  } },

  { name: 'no picker line without showOpenFilePicker', run: async (t) => {
    const page = await t.context.newPage();
    await page.addInitScript(() => {
      window.__jdTest = { noBoot: true };
      delete window.showOpenFilePicker;
    });
    await page.goto(t.appUrl);
    await page.evaluate(() => import('./js/library.js').then((m) => m.initLibrary()));
    await page.locator('.lib-footer').waitFor();
    assert.equal(await page.locator('.lib-picker').isVisible(), false);
    assert.equal(await page.locator('.lib-picker-text').isVisible(), false);
  } },

  { name: 'a page name with markup renders as text', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => { window.__alerts = 0; window.alert = () => { window.__alerts++; }; });
    await t.helpers.seedPage(page, { name: '<img src=x onerror=alert(1)>', tags: ['<b>x</b>'] });
    await page.locator('.lib-row').waitFor();
    assert.equal(await page.locator('.lib-row .lib-name').innerText(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#library img').count(), 0);
    assert.equal(await page.locator('#library b').count(), 0);
    await sleep(200);
    assert.equal(await page.evaluate(() => window.__alerts), 0);
  } },
];
