'use strict';
// WP8: the add and replace flow in app/js/add-flow.js, driven through
// __jdTest.pickFile (helpers.setNextPick) and answered through the DOM.

const assert = require('assert/strict');

const BOX = 'delete the downloaded file from this phone';
const DELETE_LAST = 'deleteOriginal.last';
const DELETE_BROKEN = 'deleteOriginal.broken';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4];
const MHTML = [
  'From: <Saved by Blink>',
  'Snapshot-Content-Location: https://example.test/',
  'Subject: Saved',
  'MIME-Version: 1.0',
  'Content-Type: multipart/related; type="text/html"; boundary="----x"',
  '',
  '------x',
  'Content-Type: text/html',
  '',
  '<html><body>saved</body></html>',
  '------x--',
].join('\r\n');

async function open(t) {
  const page = await t.openApp({ boot: false });
  await page.evaluate(async () => {
    window.__flow = await import('./js/add-flow.js');
    window.__db = await import('./js/db.js');
    window.__opened = [];
    window.__changed = 0;
    document.addEventListener('jd:open-page', (e) => window.__opened.push(e.detail));
    document.addEventListener('jd:library-changed', () => { window.__changed++; });
  });
  return page;
}

// Starts addPageFlow() (or replaceFlow(id)) without waiting.
async function start(page, replaceId) {
  await page.evaluate((id) => {
    window.__res = undefined;
    const p = id ? window.__flow.replaceFlow(id) : window.__flow.addPageFlow();
    p.then((v) => { window.__res = { v }; }, (e) => { window.__res = { thrown: String(e) }; });
  }, replaceId || null);
}

async function result(page) {
  await page.waitForFunction(() => window.__res !== undefined, null, { timeout: 8000 });
  const r = await page.evaluate(() => window.__res);
  assert.equal(r.thrown, undefined, `the flow threw: ${r.thrown}`);
  return r.v;
}

// The open dialog whose text contains `text`.
async function dialog(page, text) {
  const dlg = page.locator('#dialogs dialog[open]', { hasText: text });
  await dlg.waitFor({ timeout: 5000 });
  return dlg;
}

const btn = (scope, name) => scope.getByRole('button', { name, exact: true });

// Fills the details step. Returns the prefilled name.
async function details(page, { name, chips = [], typed } = {}) {
  const dlg = await dialog(page, 'add a page');
  const input = dlg.getByLabel('name', { exact: true });
  const prefilled = await input.inputValue();
  if (name !== undefined) await input.fill(name);
  for (const c of chips) await dlg.locator('.ui-chip', { hasText: c }).click();
  if (typed !== undefined) await dlg.getByLabel('new tags, separated by commas').fill(typed);
  await dlg.locator('button[type=submit]').click();
  return prefilled;
}

// Answers the added sheet. box: true/false ticks or unticks it; action:
// 'back' | 'open' | 'escape'. Returns { title, hasBox, boxWas }.
async function sheet(page, { box, action = 'back' } = {}) {
  const dlg = await dialog(page, 'back to library');
  const title = await dlg.locator('h2').innerText();
  const cb = dlg.getByLabel(BOX);
  const hasBox = (await cb.count()) > 0;
  const boxWas = hasBox ? await cb.isChecked() : null;
  if (box === true) await cb.check();
  if (box === false) await cb.uncheck();
  if (action === 'escape') await page.keyboard.press('Escape');
  else await btn(dlg, action === 'open' ? 'open' : 'back to library').click();
  await page.waitForFunction(() => !document.querySelector('#dialogs dialog[open]'));
  return { title, hasBox, boxWas };
}

// One add from pick to sheet. Returns { result, prefilled, sheet }.
async function addThrough(t, page, pick, { detailsOpts, sheetOpts } = {}) {
  await t.helpers.setNextPick(page, pick);
  await start(page);
  const prefilled = await details(page, detailsOpts);
  const s = await sheet(page, sheetOpts);
  return { result: await result(page), prefilled, sheet: s };
}

const storedBytes = (page, id) => page.evaluate(async (id) => {
  const f = await window.__db.getFile(id);
  return f ? Array.from(new Uint8Array(f.bytes)) : null;
}, id);

const noticeText = async (page) => {
  const n = page.locator('#notices .ui-notice');
  await n.first().waitFor({ timeout: 5000 });
  return n.allInnerTexts().then((a) => a.join('\n---\n'));
};

const dismissNotices = async (page) => {
  const n = page.locator('#notices .ui-notice');
  while (await n.count()) await btn(n.first(), 'dismiss').click();
};

const bytesOf = (s) => Array.from(Buffer.from(s));

module.exports = [
  { name: 'happy path: name from <title>, bytes stored, no checkbox without a handle', run: async (t) => {
    const page = await open(t);
    const html = '<!doctype html><title>Tip Splitter</title><p>split</p>';
    const { result: r, prefilled, sheet: s } = await addThrough(t, page, { name: 'tips.html', html });
    assert.equal(prefilled, 'Tip Splitter');
    assert.equal(r.status, 'added');
    assert.equal(s.title, 'added “Tip Splitter”');
    assert.equal(s.hasBox, false);
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.pages[0].id, r.pageId);
    assert.equal(dump.pages[0].name, 'Tip Splitter');
    assert.equal(dump.pages[0].fileName, 'tips.html');
    assert.deepEqual(dump.pages[0].tags, []);
    assert.deepEqual(dump.files, [{ id: r.pageId, size: Buffer.byteLength(html), charset: null }]);
    assert.deepEqual(await storedBytes(page, r.pageId), bytesOf(html));
    assert.equal(dump.settings[DELETE_LAST], undefined, 'no box, nothing remembered');
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
    assert.ok(await page.evaluate(() => window.__changed) >= 1);
  } },

  { name: 'name from the file name when there is no title', run: async (t) => {
    const page = await open(t);
    const { result: r, prefilled } = await addThrough(t, page, { name: 'my-thing.htm', html: '<p>no title here</p>' });
    assert.equal(prefilled, 'my-thing');
    assert.equal((await t.helpers.dbDump(page)).pages[0].name, 'my-thing');
    assert.equal(r.status, 'added');
  } },

  { name: 'edited name and tags are stored, tags lowercased', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'other', html: '<p>o</p>', tags: ['games'] });
    const { result: r } = await addThrough(t, page, { name: 'x.html', html: '<title>X</title><p>x</p>' }, {
      detailsOpts: { name: 'My Calculator', chips: ['games'], typed: 'Money, Home  Tools ,games' },
    });
    const rec = (await t.helpers.dbDump(page)).pages.find((p) => p.id === r.pageId);
    assert.equal(rec.name, 'My Calculator');
    assert.deepEqual([...rec.tags].sort(), ['games', 'home tools', 'money']);
  } },

  { name: 'cancelling the details step adds nothing', run: async (t) => {
    const page = await open(t);
    await t.helpers.setNextPick(page, { name: 'a.html', html: '<title>A</title>' });
    await start(page);
    const dlg = await dialog(page, 'add a page');
    await btn(dlg, 'cancel').click();
    assert.deepEqual(await result(page), { status: 'cancelled' });
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages, []);
    assert.deepEqual(dump.files, []);
  } },

  { name: 'each refusal: a notice naming the file, refused, database unchanged', run: async (t) => {
    const page = await open(t);
    await t.helpers.seedPage(page, { name: 'kept', html: '<p>kept</p>' });
    const before = await t.helpers.dbDump(page);
    const cases = [
      [{ name: 'notes.txt', html: '<p>text</p>', type: 'text/plain' }, /Not an HTML file/],
      [{ name: 'saved.mhtml', html: MHTML, type: 'multipart/related' }, /MHTML/],
      [{ name: 'empty.html', bytes: [] }, /Empty file/],
      [{ name: 'photo.html', bytes: PNG }, /Not a web page/],
      [{ name: 'archive.html', html: MHTML }, /MHTML/],
    ];
    for (const [pick, title] of cases) {
      await t.helpers.setNextPick(page, pick);
      await start(page);
      assert.deepEqual(await result(page), { status: 'refused' }, pick.name);
      const text = await noticeText(page);
      assert.match(text, title, pick.name);
      assert.ok(text.includes(`“${pick.name}”`), `${pick.name}: ${text}`);
      assert.equal(await page.locator('#dialogs dialog[open]').count(), 0, 'no dialog was shown');
      await dismissNotices(page);
      const after = await t.helpers.dbDump(page);
      assert.deepEqual(after.pages, before.pages, pick.name);
      assert.deepEqual(after.files, before.files, pick.name);
    }
  } },

  { name: 'storage full: the storage notice, nothing added', run: async (t) => {
    await t.context.addInitScript(() => {
      StorageManager.prototype.estimate = async () => ({ quota: 2_000_000, usage: 1_500_000 });
    });
    const page = await open(t);
    await t.helpers.setNextPick(page, { name: 'big.html', html: '<title>Big</title><p>big</p>' });
    await start(page);
    await details(page);
    assert.deepEqual(await result(page), { status: 'refused' });
    const text = await noticeText(page);
    assert.match(text, /Not enough storage/);
    assert.ok(text.includes('“big.html”'), text);
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.pages, []);
    assert.deepEqual(dump.files, []);
  } },

  { name: 'sibling files: listed; cancel adds nothing; add anyway continues', run: async (t) => {
    const page = await open(t);
    const html = '<!doctype html><title>Sib</title><link rel="stylesheet" href="style.css"><script src="app.js"></script><p>x</p>';
    await t.helpers.setNextPick(page, { name: 'sib.html', html });
    await start(page);
    let dlg = await dialog(page, 'add anyway');
    const items = (await dlg.locator('li').allInnerTexts()).join('\n');
    assert.match(items, /style\.css/);
    assert.match(items, /app\.js/);
    await btn(dlg, 'cancel').click();
    assert.deepEqual(await result(page), { status: 'cancelled' });
    assert.deepEqual((await t.helpers.dbDump(page)).pages, []);

    await start(page);
    dlg = await dialog(page, 'add anyway');
    await btn(dlg, 'add anyway').click();
    await details(page);
    await sheet(page);
    const r = await result(page);
    assert.equal(r.status, 'added');
    assert.equal((await t.helpers.dbDump(page)).pages.length, 1);
  } },

  { name: 'same name: replace keeps name, tags, pin, count and dates and swaps the bytes', run: async (t) => {
    const page = await open(t);
    const old = await t.helpers.seedPage(page, {
      name: 'tip splitter', html: '<p>old</p>', tags: ['money'], pinned: true, openCount: 5, addedAt: 1000, lastOpenedAt: 2000,
    });
    const html = '<!doctype html><title>Tip Splitter Two</title><p>new and longer</p>';
    await t.helpers.setNextPick(page, { name: 'Tip Splitter (1).html', html });
    await start(page);
    const dlg = await dialog(page, 'add as a new page');
    assert.deepEqual(await dlg.locator('button').allInnerTexts(), ['replace “tip splitter”', 'add as a new page', 'cancel']);
    await btn(dlg, 'replace “tip splitter”').click();
    const s = await sheet(page);
    assert.equal(s.title, 'replaced the file for “tip splitter”');
    assert.deepEqual(await result(page), { status: 'replaced', pageId: old.id });
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    const rec = dump.pages[0];
    for (const k of ['id', 'name', 'tags', 'pinned', 'openCount', 'addedAt', 'lastOpenedAt']) {
      assert.deepEqual(rec[k], old[k], k);
    }
    assert.deepEqual(await storedBytes(page, old.id), bytesOf(html));
  } },

  { name: 'same name: add as a new page makes a second page; cancel changes nothing', run: async (t) => {
    const page = await open(t);
    const old = await t.helpers.seedPage(page, { name: 'tip splitter', html: '<p>old</p>' });
    await t.helpers.setNextPick(page, { name: 'Tip Splitter (1).html', html: '<p>new</p>' });

    await start(page);
    let dlg = await dialog(page, 'add as a new page');
    await btn(dlg, 'cancel').click();
    assert.deepEqual(await result(page), { status: 'cancelled' });
    let dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.deepEqual(await storedBytes(page, old.id), bytesOf('<p>old</p>'));

    await start(page);
    dlg = await dialog(page, 'add as a new page');
    await btn(dlg, 'add as a new page').click();
    const prefilled = await details(page);
    assert.equal(prefilled, 'Tip Splitter (1)');
    await sheet(page);
    const r = await result(page);
    assert.equal(r.status, 'added');
    assert.notEqual(r.pageId, old.id);
    dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 2);
    assert.deepEqual(await storedBytes(page, old.id), bytesOf('<p>old</p>'));
  } },

  { name: 'replaceFlow: bytes replaced, name kept, saved data untouched; a refused replacement keeps the old bytes', run: async (t) => {
    const page = await open(t);
    const old = await t.helpers.seedPage(page, { name: 'calc', html: '<title>calc</title><p>v1</p>', tags: ['math'] });
    await page.evaluate((id) => window.__db.applyLocalOps(id, [{ op: 'set', key: 'total', value: '42' }]), old.id);
    const html = '<!doctype html><title>Completely Different</title><p>v2</p>';
    await t.helpers.setNextPick(page, { name: 'other.html', html });
    await start(page, old.id);
    const s = await sheet(page);
    assert.equal(s.title, 'replaced the file for “calc”');
    assert.deepEqual(await result(page), { status: 'replaced', pageId: old.id });
    let dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.pages[0].name, 'calc');
    assert.deepEqual(dump.pages[0].tags, ['math']);
    assert.deepEqual(await storedBytes(page, old.id), bytesOf(html));
    assert.deepEqual(dump.local, [{ pageId: old.id, key: 'total', value: '42' }]);

    await t.helpers.setNextPick(page, { name: 'broken.html', bytes: PNG });
    await start(page, old.id);
    assert.deepEqual(await result(page), { status: 'refused' });
    assert.match(await noticeText(page), /Not a web page/);
    dump = await t.helpers.dbDump(page);
    assert.deepEqual(await storedBytes(page, old.id), bytesOf(html));
    assert.equal(dump.pages[0].name, 'calc');
    assert.deepEqual(dump.local, [{ pageId: old.id, key: 'total', value: '42' }]);
  } },

  { name: 'added sheet: box deletes, open dispatches, position remembered, Escape changes nothing', run: async (t) => {
    const page = await open(t);
    const log = () => page.evaluate(() => window.__jdTest.handleLog.map((e) => e.method + (e.mode ? `:${e.mode}` : '')));
    const clearLog = () => page.evaluate(() => { window.__jdTest.handleLog.length = 0; });

    // 1. box off by default; tick it, back to library: remove() is called.
    let a = await addThrough(t, page, { name: 'one.html', html: '<title>one</title>', withHandle: true }, { sheetOpts: { box: true, action: 'back' } });
    assert.equal(a.sheet.hasBox, true);
    assert.equal(a.sheet.boxWas, false);
    assert.equal(a.result.status, 'added');
    assert.deepEqual(await log(), ['requestPermission:readwrite', 'remove']);
    assert.equal((await t.helpers.dbDump(page)).settings[DELETE_LAST], true);
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
    await clearLog();

    // 2. Escape: nothing deleted, nothing opened, position unchanged.
    a = await addThrough(t, page, { name: 'two.html', html: '<title>two</title>', withHandle: true }, { sheetOpts: { action: 'escape' } });
    assert.equal(a.sheet.boxWas, true, 'remembered ticked');
    assert.equal(a.result.status, 'added');
    assert.deepEqual(await log(), []);
    assert.equal((await t.helpers.dbDump(page)).settings[DELETE_LAST], true);
    assert.deepEqual(await page.evaluate(() => window.__opened), []);

    // 3. untick, open: no delete, openPage dispatched, unticked remembered.
    a = await addThrough(t, page, { name: 'three.html', html: '<title>three</title>', withHandle: true }, { sheetOpts: { box: false, action: 'open' } });
    assert.equal(a.sheet.boxWas, true);
    assert.deepEqual(await log(), []);
    assert.deepEqual(await page.evaluate(() => window.__opened), [{ id: a.result.pageId }]);
    assert.equal((await t.helpers.dbDump(page)).settings[DELETE_LAST], false);

    // 4. the next sheet starts unticked.
    a = await addThrough(t, page, { name: 'four.html', html: '<title>four</title>', withHandle: true }, { sheetOpts: { action: 'back' } });
    assert.equal(a.sheet.boxWas, false);
    assert.deepEqual(await log(), []);
    assert.equal((await t.helpers.dbDump(page)).pages.length, 4);
    assert.equal(await page.locator('#notices .ui-notice').count(), 0);
  } },

  { name: 'an undeclared windows-1252 file is stored with that charset', run: async (t) => {
    const page = await open(t);
    const bytes = Buffer.from('<!doctype html><title>Caf\xe9</title><p>na\xefve r\xe9sum\xe9</p>', 'latin1');
    const { result: r, prefilled } = await addThrough(t, page, { name: 'cafe.html', bytes });
    assert.equal(prefilled, 'Café');
    const dump = await t.helpers.dbDump(page);
    assert.deepEqual(dump.files, [{ id: r.pageId, size: bytes.length, charset: 'windows-1252' }]);
    assert.deepEqual(await storedBytes(page, r.pageId), Array.from(bytes));
  } },

  { name: 'delete fails: notice, page added, deleteBroken set, next add has no box', run: async (t) => {
    const page = await open(t);
    const a = await addThrough(t, page, { name: 'del.html', html: '<title>del</title>', withHandle: true, removeFails: true }, { sheetOpts: { box: true } });
    assert.equal(a.result.status, 'added');
    const text = await noticeText(page);
    assert.match(text, /Downloaded file not deleted/);
    assert.match(text, /“del\.html” is still on the phone/);
    assert.match(text, /won’t offer to again/);
    let dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.settings[DELETE_BROKEN], true);
    await dismissNotices(page);

    const b = await addThrough(t, page, { name: 'next.html', html: '<title>next</title>', withHandle: true });
    assert.equal(b.sheet.hasBox, false);
    dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 2);
  } },

  { name: 'permission denied: notice, page added, deleteBroken not set', run: async (t) => {
    const page = await open(t);
    const a = await addThrough(t, page, { name: 'deny.html', html: '<title>deny</title>', withHandle: true, permission: 'denied' }, { sheetOpts: { box: true } });
    assert.equal(a.result.status, 'added');
    const text = await noticeText(page);
    assert.match(text, /permission to delete it wasn’t given/);
    assert.ok(text.includes('“deny.html”'));
    const methods = await page.evaluate(() => window.__jdTest.handleLog.map((e) => e.method));
    assert.ok(!methods.includes('remove'), methods.join());
    const dump = await t.helpers.dbDump(page);
    assert.equal(dump.pages.length, 1);
    assert.equal(dump.settings[DELETE_BROKEN], undefined);
    await dismissNotices(page);
    const b = await addThrough(t, page, { name: 'again.html', html: '<title>again</title>', withHandle: true });
    assert.equal(b.sheet.hasBox, true, 'the offer stays');
  } },

  { name: 'a picker error is reported and refused; a cancelled pick is cancelled', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
      window.__jdTest.pickFile = async () => { throw new (class extends Error { name = 'TypeError'; })('boom'); };
    });
    await start(page);
    assert.deepEqual(await result(page), { status: 'refused' });
    assert.ok((await noticeText(page)).length > 0);
    await page.evaluate(() => { window.__jdTest.pickFile = async () => null; });
    await start(page);
    assert.deepEqual(await result(page), { status: 'cancelled' });
    assert.deepEqual((await t.helpers.dbDump(page)).pages, []);
  } },
];
