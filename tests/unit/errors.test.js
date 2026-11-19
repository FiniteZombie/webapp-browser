import { test, assert, eq } from './harness.js';
import { JdError, describe, getBuild, environmentDetail } from '../../app/js/errors.js';

const CODES = ['wrong-type', 'mhtml', 'unreadable', 'empty', 'not-html', 'storage-full',
  'page-missing', 'page-unreadable', 'store-refused', 'delete-failed', 'delete-denied',
  'picker-failed', 'sw-failed', 'unexpected'];
const FILE_CODES = ['wrong-type', 'mhtml', 'unreadable', 'empty', 'not-html', 'storage-full',
  'delete-failed', 'delete-denied'];
const PAGE_CODES = ['page-missing', 'page-unreadable', 'store-refused'];

const file = { name: 'notes.png', type: 'image/png', size: 1234 };
const page = { id: 'abc-123', name: 'Tip calculator' };

test('JdError carries code, cause and detail', () => {
  const cause = new Error('inner');
  const e = new JdError('empty', { cause, detail: 'more' });
  assert(e instanceof Error, 'is an Error');
  eq(e.code, 'empty');
  eq(e.cause, cause);
  eq(e.detail, 'more');
  eq(e.name, 'JdError');
});

test('every code has a non-empty title and body, and a string next', () => {
  for (const code of CODES) {
    for (const ctx of [{}, { file }, { page }, undefined]) {
      const d = describe(new JdError(code), ctx);
      assert(typeof d.title === 'string' && d.title.trim(), `${code}: title`);
      assert(typeof d.body === 'string' && d.body.trim(), `${code}: body`);
      assert(typeof d.next === 'string', `${code}: next`);
      assert(typeof d.detail === 'string' && d.detail.includes(`code: ${code}`), `${code}: detail`);
      assert(!/undefined|null|\[object/.test(d.title + d.body + d.next), `${code}: no leaked values`);
    }
  }
});

test('codes have their own messages', () => {
  const bodies = new Set(CODES.map((c) => describe(new JdError(c), {}).body));
  eq(bodies.size, CODES.length, 'distinct bodies');
});

test('describe names the file in body and gives name, type and size in detail', () => {
  for (const code of FILE_CODES) {
    const d = describe(new JdError(code), { file });
    assert(d.body.includes('“notes.png”'), `${code}: body names the file: ${d.body}`);
    assert(d.detail.includes('notes.png'), `${code}: detail name`);
    assert(d.detail.includes('image/png'), `${code}: detail type`);
    assert(d.detail.includes('1234'), `${code}: detail size`);
  }
  const real = new File(['x'], 'a.htm', { type: 'text/html' });
  const d = describe(new JdError('not-html'), { file: real });
  assert(d.body.includes('a.htm') && d.detail.includes('text/html') && d.detail.includes('1 bytes'), 'works with a File');
});

test('wrong-type and mhtml say what they must', () => {
  const w = describe(new JdError('wrong-type'), { file });
  assert(/isn’t an HTML file/.test(w.body) && w.body.includes('.html') && w.body.includes('.htm'), w.body);
  const m = describe(new JdError('mhtml'), { file: { name: 'x.mhtml', type: '', size: 9 } });
  assert(m.body.includes('MHTML') && /HTML instead/.test(m.next), m.body + ' / ' + m.next);
});

test('page messages name the page and detail has its id', () => {
  for (const code of PAGE_CODES) {
    const d = describe(new JdError(code), { page });
    assert(d.body.includes('“Tip calculator”'), `${code}: ${d.body}`);
    assert(d.detail.includes('abc-123'), `${code}: page id`);
  }
});

test('a cause and a detail appear in detail', () => {
  const cause = new DOMException('quota hit', 'QuotaExceededError');
  const d = describe(new JdError('storage-full', { cause, detail: { tried: 5 } }), { file });
  assert(d.detail.includes('QuotaExceededError: quota hit'), d.detail);
  assert(d.detail.includes('"tried":5'), d.detail);
  assert(/time: \d{4}-/.test(d.detail), 'has a time');
});

test('a plain TypeError is described as unexpected with its message in detail', () => {
  const err = new TypeError('x is not a function');
  const d = describe(err, {});
  const u = describe(new JdError('unexpected'), {});
  eq(d.title, u.title);
  eq(d.body, u.body);
  eq(d.next, u.next);
  assert(d.detail.includes('code: unexpected'), d.detail);
  assert(d.detail.includes('TypeError: x is not a function'), d.detail);
});

test('non-errors and unknown codes are unexpected', () => {
  for (const v of ['a string', null, undefined, 42, { odd: true }, new JdError('no-such-code')]) {
    const d = describe(v, {});
    assert(d.detail.includes('code: unexpected'), `${String(v)}: ${d.detail}`);
  }
});

test('getBuild answers unknown when no worker serves the build', async () => {
  eq(await getBuild(), 'unknown');
});

test('environmentDetail resolves to multi-line text', async () => {
  const text = await environmentDetail();
  for (const label of ['build:', 'user agent:', 'display mode:', 'persisted storage:', 'showOpenFilePicker:',
    'service worker controls window:', 'caches:', 'deleteOriginal.broken:', 'picker.fsaBroken:', 'picker.lastError:']) {
    assert(text.includes(label), `missing ${label}\n${text}`);
  }
  assert(text.includes(navigator.userAgent), 'has the user agent');
});

test('delete messages are true after an add and after a replace', () => {
  for (const code of ['delete-failed', 'delete-denied']) {
    const d = describe(new JdError(code), { file: { name: 'tip.html', type: 'text/html', size: 10 } });
    assert(!/was added|was replaced/.test(d.body + d.next), `${code}: names one flow: ${d.body}`);
    assert(/still on the phone/.test(d.body), `${code}: says the file is still there: ${d.body}`);
    assert(/safely saved in Junk Drawer/.test(d.body), `${code}: says the page is safe: ${d.body}`);
  }
});

test('page-missing reads sensibly in the viewer and when replacing', () => {
  const viewer = describe(new JdError('page-missing'), { page });
  assert(/copy of “Tip calculator” is missing/.test(viewer.body), viewer.body);
  assert(/saved data is still there/.test(viewer.body), viewer.body);
  assert(/Replace its file/.test(viewer.next), viewer.next);

  const replace = describe(new JdError('page-missing', { detail: 'page id: gone-1' }),
    { file: { name: 'tip.html', type: 'text/html', size: 10 } });
  assert(/no longer in Junk Drawer/.test(replace.body), replace.body);
  assert(replace.body.includes('“tip.html”') && /Nothing was changed/.test(replace.body), replace.body);
  assert(!/saved data is still there|Replace its file/.test(replace.body + replace.next), 'no viewer advice');
  assert(/add it as a new page/.test(replace.next), replace.next);
  assert(replace.detail.includes('code: page-missing') && replace.detail.includes('gone-1'), replace.detail);
  assert(replace.title !== viewer.title, 'distinct titles');
});
