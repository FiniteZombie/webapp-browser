'use strict';
// WP8: pickFile() in app/js/picker.js: the full picker, its fallback to the
// plain file input, and which errors latch the fallback.

const assert = require('assert/strict');

const FSA = 'picker.fsaBroken';
const LAST = 'picker.lastError';

// Replaces showOpenFilePicker before the app loads. `kind`: 'remove', or the
// DOMException/TypeError name to throw.
async function stubPicker(t, kind) {
  await t.context.addInitScript((k) => {
    if (k === 'remove') { delete window.showOpenFilePicker; return; }
    window.__fsaCalls = 0;
    window.showOpenFilePicker = async () => {
      window.__fsaCalls++;
      if (k === 'TypeError') throw new TypeError('picker broke (test)');
      throw new DOMException(`${k} (test)`, k);
    };
  }, kind);
  const page = await t.openApp({ boot: false });
  await page.evaluate(async () => {
    window.__picker = await import('./js/picker.js');
    window.__changed = 0;
    document.addEventListener('jd:library-changed', () => { window.__changed++; });
  });
  return page;
}

// Calls pickFile(); resolves to { value } or { error: { name, code } }.
function callPick(page) {
  return page.evaluate(() => window.__picker.pickFile().then(
    (v) => ({ value: v && { name: v.file.name, type: v.file.type, text: null, handle: v.handle } }),
    (e) => ({ error: { name: e.name, code: e.code, cause: e.cause && e.cause.name } }),
  ));
}

// Starts pickFile() and answers the file chooser with a file.
async function pickThroughInput(page, file) {
  const [chooser, got] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.evaluate(() => {
      window.__pick = window.__picker.pickFile().then(async (v) => v && ({
        name: v.file.name, text: await v.file.text(), handle: v.handle,
      }));
      return true;
    }),
  ]);
  assert.equal(got, true);
  assert.equal(chooser.isMultiple(), false);
  const accept = await chooser.element().getAttribute('accept');
  assert.equal(accept, '.html,.htm,text/html');
  await chooser.setFiles(file);
  return page.evaluate(() => window.__pick);
}

// Starts pickFile() through the input, waits for the chooser, leaves it open.
async function openChooser(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.evaluate(() => {
      window.__settled = false;
      window.__pick = window.__picker.pickFile().then(
        (v) => { window.__settled = true; return v === null ? 'null' : 'value'; },
        (e) => { window.__settled = true; return 'error:' + e.name; },
      );
      return true;
    }),
  ]);
  return chooser;
}

// Waits up to `ms` for pickFile() to settle; 'pending' if it never does.
function settledWithin(page, ms) {
  return page.evaluate((ms) => Promise.race([
    window.__pick,
    new Promise((r) => setTimeout(() => r('pending'), ms)),
  ]), ms);
}

const settings = async (t, page) => (await t.helpers.dbDump(page)).settings;

module.exports = [
  { name: 'without showOpenFilePicker, pickFile uses the file input', run: async (t) => {
    const page = await stubPicker(t, 'remove');
    assert.equal(await page.evaluate(() => typeof window.showOpenFilePicker), 'undefined');
    const html = '<!doctype html><title>Input pick</title><p>x</p>';
    const res = await pickThroughInput(page, { name: 'input-pick.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    assert.deepEqual(res, { name: 'input-pick.html', text: html, handle: null });
    assert.equal(await page.locator('input[type=file]').count(), 0, 'the input is removed afterwards');
  } },

  { name: 'AbortError from the full picker means cancelled: null', run: async (t) => {
    const page = await stubPicker(t, 'AbortError');
    assert.deepEqual(await callPick(page), { value: null });
    assert.equal(await page.evaluate(() => window.__fsaCalls), 1);
    const s = await settings(t, page);
    assert.equal(s[FSA], undefined);
    assert.equal(s[LAST], undefined);
  } },

  { name: 'a TypeError: picker-failed, fsaBroken set, error saved, next call uses the input', run: async (t) => {
    const page = await stubPicker(t, 'TypeError');
    const res = await callPick(page);
    assert.deepEqual(res.error, { name: 'JdError', code: 'picker-failed', cause: 'TypeError' });
    const s = await settings(t, page);
    assert.equal(s[FSA], true);
    assert.equal(s[LAST], 'TypeError: picker broke (test)');
    assert.ok(await page.evaluate(() => window.__changed) >= 1, 'libraryChanged dispatched');

    const res2 = await pickThroughInput(page, { name: 'second.htm', mimeType: 'text/html', buffer: Buffer.from('<p>2</p>') });
    assert.deepEqual(res2, { name: 'second.htm', text: '<p>2</p>', handle: null });
    assert.equal(await page.evaluate(() => window.__fsaCalls), 1, 'the full picker was not tried again');
  } },

  { name: 'NotAllowedError: picker-failed, fsaBroken not set', run: async (t) => {
    const page = await stubPicker(t, 'NotAllowedError');
    const res = await callPick(page);
    assert.deepEqual(res.error, { name: 'JdError', code: 'picker-failed', cause: 'NotAllowedError' });
    const s = await settings(t, page);
    assert.equal(s[FSA], undefined);
    assert.equal(s[LAST], 'NotAllowedError: NotAllowedError (test)');
    assert.deepEqual(await callPick(page), res, 'the full picker is still used');
    assert.equal(await page.evaluate(() => window.__fsaCalls), 2);
  } },

  { name: 'the full picker returns the file and its handle', run: async (t) => {
    await t.context.addInitScript(() => {
      window.showOpenFilePicker = async (opts) => {
        window.__opts = opts;
        const file = new File(['<p>fsa</p>'], 'fsa.html', { type: 'text/html' });
        return [{ kind: 'file', name: 'fsa.html', getFile: async () => file, remove: async () => {} }];
      };
    });
    const page = await t.openApp({ boot: false });
    const res = await page.evaluate(async () => {
      const m = await import('./js/picker.js');
      const v = await m.pickFile();
      return { name: v.file.name, text: await v.file.text(), handleName: v.handle.name, can: await m.canDeleteOriginal(v.handle), none: await m.canDeleteOriginal(null) };
    });
    assert.deepEqual(res, { name: 'fsa.html', text: '<p>fsa</p>', handleName: 'fsa.html', can: true, none: false });
    const opts = await page.evaluate(() => window.__opts);
    assert.deepEqual(opts, {
      multiple: false, excludeAcceptAllOption: false,
      types: [{ description: 'HTML pages', accept: { 'text/html': ['.html', '.htm'] } }],
    });
  } },

  { name: 'cancelling the file input (cancel event) resolves null and removes the input', run: async (t) => {
    const page = await stubPicker(t, 'remove');
    const chooser = await openChooser(page);
    await chooser.element().dispatchEvent('cancel');
    assert.equal(await settledWithin(page, 3000), 'null');
    assert.equal(await page.locator('input[type=file]').count(), 0, 'the input is removed afterwards');
  } },

  { name: 'cancelled with no cancel event: focus coming back settles null after a grace period', run: async (t) => {
    const page = await stubPicker(t, 'remove');
    await openChooser(page);
    // Some Android versions close the chooser without firing cancel; all the
    // page sees is the window getting focus back.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.__settled), false, 'not settled at once: change may still be on its way');
    assert.equal(await settledWithin(page, 5000), 'null', 'pickFile must not stay pending forever');
    assert.equal(await page.locator('input[type=file]').count(), 0, 'the input is removed afterwards');
  } },

  { name: 'cancelled with no cancel event: the page becoming visible again settles null', run: async (t) => {
    const page = await stubPicker(t, 'remove');
    await openChooser(page);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await settledWithin(page, 5000), 'null');
  } },

  { name: 'a file chosen just after focus returns still comes back', run: async (t) => {
    const page = await stubPicker(t, 'remove');
    const chooser = await openChooser(page);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await chooser.setFiles({ name: 'late.html', mimeType: 'text/html', buffer: Buffer.from('<p>late</p>') });
    assert.equal(await settledWithin(page, 5000), 'value');
  } },
];
