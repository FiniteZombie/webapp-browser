'use strict';
// WP5: notices, dialogs, sheets and copyButton in app/js/ui.js.

const assert = require('assert/strict');

async function open(t) {
  await t.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await t.openApp({ boot: false });
  await page.evaluate(async () => { window.__ui = await import('./js/ui.js'); });
  return page;
}

// Starts a dialog function without waiting; the result lands in window.__res.
async function launch(page, fn, arg) {
  await page.evaluate(([f, a]) => {
    window.__res = undefined;
    window.__ui[f](a).then((v) => { window.__res = { v }; });
  }, [fn, arg]);
  await page.locator('dialog[open]').waitFor();
}

async function result(page) {
  await page.waitForFunction(() => window.__res !== undefined);
  return page.evaluate(() => window.__res.v);
}

const notice = (page, text) => page.evaluate((a) => window.__ui.showNotice(a), text);
const btn = (scope, name) => scope.getByRole('button', { name, exact: true });
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const rejectClipboard = (page) => page.evaluate(() => {
  Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true,
    value: () => Promise.reject(new Error('refused')),
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = [
  { name: 'a notice shows its text, stays, and dismisses', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => window.__ui.showNotice({ title: 'T-title', body: 'B-body', next: 'N-next' }));
    const card = page.locator('#notices .ui-notice');
    assert.match(await card.innerText(), /T-title/);
    assert.match(await card.innerText(), /B-body/);
    assert.match(await card.innerText(), /N-next/);
    assert.equal(await btn(card, 'copy details').count(), 0, 'no detail, no copy button');
    await sleep(3000);
    assert.equal(await card.count(), 1);
    await btn(card, 'dismiss').click();
    assert.equal(await card.count(), 0);
  } },

  { name: 'a notice without next shows no next line, and actions work', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
      window.__clicked = 0;
      window.__ui.showNotice({
        title: 'A', body: 'b', next: '',
        actions: [{ label: 'do it', onClick: () => { window.__clicked++; } }, { label: 'go', href: 'https://example.test/x' }],
      });
    });
    const card = page.locator('#notices .ui-notice');
    assert.equal(await card.locator('.ui-next').count(), 0);
    await btn(card, 'do it').click();
    assert.equal(await page.evaluate(() => window.__clicked), 1);
    const link = card.getByRole('link', { name: 'go' });
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await card.count(), 1, 'actions do not dismiss');
  } },

  { name: 'copy details copies the detail and the environment lines', run: async (t) => {
    const page = await open(t);
    await notice(page, { title: 'T', body: 'b', detail: 'code: thing\nfile: a.html' });
    const card = page.locator('#notices .ui-notice');
    await btn(card, 'copy details').click();
    await page.waitForFunction(() => document.querySelector('#notices button')?.textContent === 'copied');
    const text = await clipboard(page);
    assert.ok(text.startsWith('code: thing\nfile: a.html\n\n'), text);
    assert.match(text, /^build: /m);
    assert.match(text, /^user agent: /m);
    assert.match(text, /^display mode: /m);
    await page.waitForFunction(() => document.querySelector('#notices button')?.textContent === 'copy details', null, { timeout: 4000 });
  } },

  { name: 'copy details with the clipboard refused shows a selected textarea', run: async (t) => {
    const page = await open(t);
    await rejectClipboard(page);
    await notice(page, { title: 'T', body: 'b', detail: 'code: thing' });
    const card = page.locator('#notices .ui-notice');
    await btn(card, 'copy details').click();
    const area = card.locator('textarea');
    await area.waitFor();
    assert.equal(await area.evaluate((a) => a.readOnly), true);
    assert.match(await area.inputValue(), /^code: thing\n\nbuild: /);
    assert.equal(await area.evaluate((a) => document.activeElement === a), true);
    assert.equal(await area.evaluate((a) => a.selectionStart === 0 && a.selectionEnd === a.value.length), true);
    assert.equal(await area.evaluate((a) => a.previousElementSibling.textContent), 'copy details');
  } },

  { name: 'copyButton on its own copies getText plus the environment', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
      const b = window.__ui.copyButton({ label: 'copy it', getText: async () => 'hello text' });
      b.id = 'cb';
      document.getElementById('library').appendChild(b);
    });
    await page.click('#cb');
    await page.waitForFunction(() => document.getElementById('cb').textContent === 'copied');
    const text = await clipboard(page);
    assert.ok(text.startsWith('hello text\n\n'));
    assert.match(text, /^user agent: /m);
    await page.waitForFunction(() => document.getElementById('cb').textContent === 'copy it', null, { timeout: 4000 });
  } },

  { name: 'a notice raised under an open dialog is visible at the top and dismissable', run: async (t) => {
    const page = await open(t);
    await launch(page, 'confirmDialog', { title: 'Sure?', body: 'x' });
    await notice(page, { title: 'Under', body: 'raised while open' });
    const card = page.locator('#notices .ui-notice');
    await card.waitFor();
    const box = await card.boundingBox();
    assert.ok(box.y < 40, `top of the screen, got y=${box.y}`);
    assert.ok(box.width > 300);
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.getElementById('notices'))), true);
    await btn(card, 'dismiss').click();
    assert.equal(await card.count(), 0);
    assert.equal(await page.locator('dialog[open]').count(), 1, 'dialog still open');
    await btn(page.locator('dialog'), 'cancel').click();
    assert.equal(await result(page), false);
    assert.equal(await page.evaluate(() => document.getElementById('notices').parentNode === document.body), true);
  } },

  { name: 'a notice raised before a dialog survives it opening and closing', run: async (t) => {
    const page = await open(t);
    await notice(page, { title: 'Before', body: 'raised first' });
    await launch(page, 'confirmDialog', { title: 'Sure?' });
    const card = page.locator('#notices .ui-notice');
    assert.equal(await card.isVisible(), true);
    const box = await card.boundingBox();
    assert.ok(box.y < 40);
    await btn(card, 'copy details').count(); // no detail: just reachable
    await btn(page.locator('dialog'), 'ok').click();
    assert.equal(await result(page), true);
    assert.equal(await card.count(), 1);
    assert.equal(await card.isVisible(), true);
    assert.equal(await page.evaluate(() => document.getElementById('notices').parentNode === document.body), true);
    await btn(card, 'dismiss').click();
    assert.equal(await card.count(), 0);
  } },

  { name: 'a notice raised before a dialog can be dismissed while it is open', run: async (t) => {
    const page = await open(t);
    await notice(page, { title: 'Before', body: 'raised first' });
    await launch(page, 'actionSheet', { title: 'S', actions: [{ id: 'a', label: 'A' }] });
    const card = page.locator('#notices .ui-notice');
    await btn(card, 'dismiss').click();
    assert.equal(await card.count(), 0);
    assert.equal(await page.locator('dialog[open]').count(), 1, 'dismissing a notice does not dismiss the sheet');
    await page.keyboard.press('Escape');
    assert.equal(await result(page), null);
  } },

  { name: 'a sheet ignores activations until it has its own pointerdown', run: async (t) => {
    const page = await open(t);
    await launch(page, 'actionSheet', { title: 'Sheet', actions: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] });
    await page.evaluate(() => {
      const d = document.querySelector('dialog');
      d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      d.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      d.querySelector('button').click();
    });
    await sleep(100);
    assert.equal(await page.evaluate(() => window.__res), undefined);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await btn(page.locator('dialog'), 'Two').click();
    assert.equal(await result(page), 'two');
    assert.equal(await page.locator('dialog').count(), 0, 'element removed');
  } },

  { name: 'a sheet that was pressed on can be dismissed from its backdrop', run: async (t) => {
    const page = await open(t);
    await launch(page, 'actionSheet', { title: 'Sheet', actions: [{ id: 'one', label: 'One' }] });
    await page.evaluate(() => document.querySelector('dialog').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(50);
    assert.equal(await page.evaluate(() => window.__res), undefined);
    await page.mouse.click(200, 30);
    assert.equal(await result(page), null);
  } },

  { name: 'a press that starts inside a sheet and ends on the backdrop does not dismiss it', run: async (t) => {
    const page = await open(t);
    await launch(page, 'actionSheet', { title: 'Sheet', actions: [{ id: 'one', label: 'One' }] });
    const b = await btn(page.locator('dialog'), 'One').boundingBox();
    await page.mouse.move(b.x + 10, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(200, 30);
    await page.mouse.up();
    await sleep(100);
    assert.equal(await page.evaluate(() => window.__res), undefined);
    await page.keyboard.press('Escape');
    assert.equal(await result(page), null);
  } },

  { name: 'a sheet is full width at the bottom and does not use transform', run: async (t) => {
    const page = await open(t);
    await launch(page, 'actionSheet', { title: 'Sheet', actions: [{ id: 'one', label: 'One' }] });
    const info = await page.evaluate(() => {
      const r = document.querySelector('dialog').getBoundingClientRect();
      const cs = getComputedStyle(document.querySelector('dialog'));
      return { l: r.left, w: r.width, b: r.bottom, vh: innerHeight, vw: innerWidth, transform: cs.transform, filter: cs.filter };
    });
    assert.equal(info.l, 0);
    assert.equal(info.w, info.vw);
    assert.equal(info.b, info.vh);
    assert.equal(info.transform, 'none');
    assert.equal(info.filter, 'none');
    const rows = await page.locator('dialog button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
    assert.ok(rows.every((h) => h >= 48));
    await page.keyboard.press('Escape');
    await result(page);
  } },

  { name: 'reportError with a wrong-type JdError shows the file name', run: async (t) => {
    const page = await open(t);
    await page.evaluate(async () => {
      const { JdError } = await import('./js/errors.js');
      window.__ui.reportError(new JdError('wrong-type'), { file: { name: 'notes.txt', type: 'text/plain', size: 5 } });
    });
    const card = page.locator('#notices .ui-notice');
    assert.match(await card.innerText(), /“notes\.txt”/);
    assert.equal(await btn(card, 'copy details').count(), 1);
    await btn(card, 'copy details').click();
    await page.waitForFunction(() => document.querySelector('#notices button')?.textContent === 'copied');
    assert.match(await clipboard(page), /file: notes\.txt/);
  } },

  { name: 'confirmDialog resolves true and false from its buttons, false on Escape', run: async (t) => {
    const page = await open(t);
    await launch(page, 'confirmDialog', { title: 'Delete?', body: 'really', confirmLabel: 'yes delete', cancelLabel: 'keep', danger: true });
    const dlg = page.locator('dialog');
    assert.match(await dlg.innerText(), /Delete\?/);
    assert.match(await dlg.innerText(), /really/);
    assert.match(await btn(dlg, 'yes delete').getAttribute('class'), /ui-btn-danger/);
    await btn(dlg, 'yes delete').click();
    assert.equal(await result(page), true);

    await launch(page, 'confirmDialog', { title: 'Q' });
    await btn(page.locator('dialog'), 'cancel').click();
    assert.equal(await result(page), false);

    await launch(page, 'confirmDialog', { title: 'Q', cancelLabel: 'no' });
    await btn(page.locator('dialog'), 'no').click();
    assert.equal(await result(page), false);

    await launch(page, 'confirmDialog', { title: 'Q' });
    await page.keyboard.press('Escape');
    assert.equal(await result(page), false);
    assert.equal(await page.locator('dialog').count(), 0);
  } },

  { name: 'choiceDialog lists items, caps at 10 and resolves the id', run: async (t) => {
    const page = await open(t);
    const list = Array.from({ length: 13 }, (_, i) => `item-${i + 1}`);
    await launch(page, 'choiceDialog', {
      title: 'Which?', body: 'pick', list,
      choices: [{ id: 'a', label: 'Add anyway' }, { id: 'r', label: 'Replace it', danger: true }],
    });
    const dlg = page.locator('dialog');
    const items = await dlg.locator('li').allInnerTexts();
    assert.equal(items.length, 11);
    assert.equal(items[9], 'item-10');
    assert.equal(items[10], 'and 3 more');
    const labels = await dlg.locator('button').allInnerTexts();
    assert.deepEqual(labels, ['Add anyway', 'Replace it', 'cancel']);
    await btn(dlg, 'Replace it').click();
    assert.equal(await result(page), 'r');

    await launch(page, 'choiceDialog', { title: 'Few', list: ['x', 'y'], choices: [{ id: 'a', label: 'A' }] });
    assert.deepEqual(await page.locator('dialog li').allInnerTexts(), ['x', 'y']);
    await btn(page.locator('dialog'), 'cancel').click();
    assert.equal(await result(page), null);

    await launch(page, 'choiceDialog', { title: 'None', choices: [{ id: 'a', label: 'A' }] });
    assert.equal(await page.locator('dialog ul').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await result(page), null);
  } },

  { name: 'actionSheet resolves the tapped id and null on a backdrop tap', run: async (t) => {
    const page = await open(t);
    await launch(page, 'actionSheet', { title: 'Page', actions: [{ id: 'rename', label: 'Rename' }, { id: 'del', label: 'Delete', danger: true }] });
    assert.match(await page.locator('dialog').innerText(), /Page/);
    await btn(page.locator('dialog'), 'Delete').click();
    assert.equal(await result(page), 'del');

    await launch(page, 'actionSheet', { title: 'Page', actions: [{ id: 'rename', label: 'Rename' }] });
    await page.mouse.click(200, 40);
    assert.equal(await result(page), null);
    assert.equal(await page.locator('dialog').count(), 0);
  } },

  { name: 'detailsDialog prefills and refuses an empty name', run: async (t) => {
    const page = await open(t);
    await launch(page, 'detailsDialog', { title: 'Details', name: 'My page', tags: ['b'], allTags: ['a', 'b', 'c'], submitLabel: 'add' });
    const dlg = page.locator('dialog');
    const name = dlg.getByLabel('name', { exact: true });
    assert.equal(await name.inputValue(), 'My page');
    const err = dlg.getByText('give the page a name');
    assert.equal(await err.isVisible(), false);
    await name.fill('   ');
    await btn(dlg, 'add').click();
    assert.equal(await err.isVisible(), true);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => window.__res), undefined);
    await name.fill('  Renamed  ');
    assert.equal(await err.isVisible(), false);
    await btn(dlg, 'add').click();
    assert.deepEqual(await result(page), { name: 'Renamed', tags: ['b'] });
  } },

  { name: 'detailsDialog chips toggle and typed tags follow them, trimmed', run: async (t) => {
    const page = await open(t);
    await launch(page, 'detailsDialog', { title: 'Details', name: 'P', tags: ['b'], allTags: ['a', 'b', 'c'], submitLabel: 'add' });
    const dlg = page.locator('dialog');
    const chip = (n) => dlg.locator('.ui-chip', { hasText: n });
    assert.equal(await chip('a').getAttribute('aria-pressed'), 'false');
    assert.equal(await chip('b').getAttribute('aria-pressed'), 'true');
    assert.match(await chip('b').innerText(), /^✓\s*b$/);
    assert.doesNotMatch(await chip('a').innerText(), /✓/);
    await chip('c').click();
    await chip('a').click();
    await chip('a').click();
    assert.equal(await chip('a').getAttribute('aria-pressed'), 'false');
    assert.equal(await chip('c').getAttribute('aria-pressed'), 'true');
    await dlg.getByLabel('new tags, separated by commas').fill(' x ,, y y,  ,B, x');
    await btn(dlg, 'add').click();
    assert.deepEqual(await result(page), { name: 'P', tags: ['b', 'c', 'x', 'y y', 'B', 'x'] });
  } },

  { name: 'detailsDialog: Enter submits, cancel and Escape give null', run: async (t) => {
    const page = await open(t);
    await launch(page, 'detailsDialog', { title: 'D', name: 'P', tags: [], allTags: [], submitLabel: 'save' });
    assert.equal(await page.locator('dialog .ui-chip').count(), 0);
    await page.locator('dialog').getByLabel('new tags, separated by commas').fill('q');
    await page.keyboard.press('Enter');
    assert.deepEqual(await result(page), { name: 'P', tags: ['q'] });

    await launch(page, 'detailsDialog', { title: 'D', name: 'P', tags: [], allTags: ['a'], submitLabel: 'save' });
    await btn(page.locator('dialog'), 'cancel').click();
    assert.equal(await result(page), null);

    await launch(page, 'detailsDialog', { title: 'D', name: 'P', tags: [], allTags: ['a'], submitLabel: 'save' });
    await page.keyboard.press('Escape');
    assert.equal(await result(page), null);
  } },

  { name: 'addedSheet has no checkbox when canDelete is false', run: async (t) => {
    const page = await open(t);
    await launch(page, 'addedSheet', { title: 'Added', canDelete: false, deleteDefault: true });
    const dlg = page.locator('dialog');
    assert.equal(await dlg.locator('input[type=checkbox]').count(), 0);
    assert.deepEqual(await dlg.locator('button').allInnerTexts(), ['back to library', 'open']);
    await btn(dlg, 'open').click();
    assert.deepEqual(await result(page), { deleteOriginal: false, open: true });

    await launch(page, 'addedSheet', { title: 'Added', canDelete: false });
    await btn(page.locator('dialog'), 'back to library').click();
    assert.deepEqual(await result(page), { deleteOriginal: false, open: false });
  } },

  { name: 'addedSheet buttons report the checkbox, Escape gives null', run: async (t) => {
    const page = await open(t);
    const label = 'delete the downloaded file from this phone';
    await launch(page, 'addedSheet', { title: 'Added', canDelete: true, deleteDefault: true });
    let box = page.locator('dialog').getByLabel(label);
    assert.equal(await box.isChecked(), true);
    await btn(page.locator('dialog'), 'back to library').click();
    assert.deepEqual(await result(page), { deleteOriginal: true, open: false });

    await launch(page, 'addedSheet', { title: 'Added', canDelete: true, deleteDefault: true });
    await page.locator('dialog').getByLabel(label).uncheck();
    await btn(page.locator('dialog'), 'open').click();
    assert.deepEqual(await result(page), { deleteOriginal: false, open: true });

    await launch(page, 'addedSheet', { title: 'Added', canDelete: true, deleteDefault: false });
    box = page.locator('dialog').getByLabel(label);
    assert.equal(await box.isChecked(), false);
    await box.check();
    await btn(page.locator('dialog'), 'open').click();
    assert.deepEqual(await result(page), { deleteOriginal: true, open: true });

    await launch(page, 'addedSheet', { title: 'Added', canDelete: true, deleteDefault: true });
    await page.keyboard.press('Escape');
    assert.equal(await result(page), null);
  } },

  { name: 'only one dialog shows at a time; the second waits', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
      window.__r = [];
      window.__ui.confirmDialog({ title: 'First' }).then((v) => window.__r.push(['first', v]));
      window.__ui.confirmDialog({ title: 'Second' }).then((v) => window.__r.push(['second', v]));
    });
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('dialog').count(), 1);
    assert.match(await page.locator('dialog').innerText(), /First/);
    await btn(page.locator('dialog'), 'ok').click();
    await page.getByRole('heading', { name: 'Second' }).waitFor();
    assert.equal(await page.locator('dialog').count(), 1);
    await btn(page.locator('dialog'), 'cancel').click();
    await page.waitForFunction(() => window.__r.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__r), [['first', true], ['second', false]]);
  } },

  { name: 'page names and error text render as text, never as markup', run: async (t) => {
    const page = await open(t);
    const evil = '<img src=x onerror="window.__pwned=1">';
    await launch(page, 'detailsDialog', { title: evil, name: evil, tags: [evil], allTags: [evil], submitLabel: evil });
    assert.equal(await page.locator('dialog img').count(), 0);
    assert.equal(await page.locator('dialog').getByLabel('name', { exact: true }).inputValue(), evil);
    assert.match(await page.locator('dialog h2').innerText(), /<img/);
    await page.locator('dialog button[type=submit]').click();
    assert.deepEqual(await result(page), { name: evil, tags: [evil] });

    await launch(page, 'choiceDialog', { title: evil, body: evil, list: [evil], choices: [{ id: 'a', label: evil }] });
    assert.equal(await page.locator('dialog img').count(), 0);
    await page.keyboard.press('Escape');
    await result(page);

    await page.evaluate(async (e) => {
      const { JdError } = await import('./js/errors.js');
      window.__ui.reportError(new JdError('wrong-type'), { file: { name: e, type: '', size: 1 } });
    }, evil);
    assert.equal(await page.locator('#notices img').count(), 0);
    assert.match(await page.locator('#notices .ui-notice').innerText(), /<img src=x/);
    await sleep(200);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
  } },

  { name: 'hasOpenUi follows notices and dialogs', run: async (t) => {
    const page = await open(t);
    const has = () => page.evaluate(() => window.__ui.hasOpenUi());
    assert.equal(await has(), false);
    await page.evaluate(() => { window.__n = window.__ui.showNotice({ title: 'n', body: 'b' }); });
    assert.equal(await has(), true);
    await page.evaluate(() => window.__n.dismiss());
    assert.equal(await has(), false);
    await launch(page, 'confirmDialog', { title: 'Q' });
    assert.equal(await has(), true);
    await btn(page.locator('dialog'), 'ok').click();
    await result(page);
    assert.equal(await has(), false);
    await launch(page, 'confirmDialog', { title: 'Q' });
    await notice(page, { title: 'n', body: 'b' });
    await btn(page.locator('dialog'), 'ok').click();
    await result(page);
    assert.equal(await has(), true, 'the notice is still showing');
    await btn(page.locator('#notices'), 'dismiss').click();
    assert.equal(await has(), false);
  } },

  { name: 'ui.js creates #notices and #dialogs when missing', run: async (t) => {
    const page = await open(t);
    await page.evaluate(() => { document.getElementById('notices').remove(); document.getElementById('dialogs').remove(); });
    await page.evaluate(() => window.__ui.showNotice({ title: 'x', body: 'y' }));
    assert.equal(await page.locator('#notices .ui-notice').count(), 1);
    await launch(page, 'confirmDialog', { title: 'Q' });
    assert.equal(await page.locator('#dialogs dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await result(page), false);
  } },
];
