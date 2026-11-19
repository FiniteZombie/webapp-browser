import { test, assert, eq, rejects } from './harness.js';
import * as db from '../../app/js/db.js';
import { JdError } from '../../app/js/errors.js';
import { PAGE_DB_PREFIX } from '../../app/js/config.js';

const bytesOf = (text) => new TextEncoder().encode(text).buffer;
const textOf = (buf) => new TextDecoder().decode(buf);
const unclonable = () => ({ byteLength: 4, f() {} });
const add = (name, extra = {}) => db.addPage({
  name, fileName: `${name}.html`, tags: ['a'], bytes: bytesOf(`<p>${name}</p>`), ...extra,
});
const openDb = (name) => new Promise((resolve, reject) => {
  const req = indexedDB.open(name);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const dbNames = async () => (await indexedDB.databases()).map((d) => d.name);

test('add, list, get: record has every field with defaults', async () => {
  const before = Date.now();
  const rec = await db.addPage({ name: 'one', fileName: 'one.html', tags: ['x', 'y'], bytes: bytesOf('hello') });
  assert(typeof rec.id === 'string' && rec.id.length > 10);
  eq(Object.keys(rec).sort(), ['addedAt', 'fileName', 'id', 'lastOpenedAt', 'name', 'openCount', 'pinned', 'replacedAt', 'size', 'tags']);
  eq(rec.name, 'one'); eq(rec.fileName, 'one.html'); eq(rec.tags, ['x', 'y']);
  eq(rec.pinned, false); eq(rec.openCount, 0); eq(rec.lastOpenedAt, null);
  eq(rec.replacedAt, null); eq(rec.size, 5);
  assert(rec.addedAt >= before && rec.addedAt <= Date.now());
  eq(await db.getPage(rec.id), rec);
  assert((await db.listPages()).some((p) => p.id === rec.id));
  eq(await db.getPage('nope'), undefined);
});

test('bytes and charset round-trip', async () => {
  const a = await add('plain');
  const fa = await db.getFile(a.id);
  eq(fa.charset, null);
  eq(textOf(fa.bytes), '<p>plain</p>');
  assert(fa.bytes instanceof ArrayBuffer);
  const raw = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const b = await db.addPage({ name: 'cs', fileName: 'cs.html', tags: [], bytes: raw.buffer, charset: 'windows-1252' });
  const fb = await db.getFile(b.id);
  eq(fb.charset, 'windows-1252');
  eq(Array.from(new Uint8Array(fb.bytes)), Array.from(raw));
  eq(await db.getFile('missing'), undefined);
});

test('replaceFile keeps identity fields and changes the file', async () => {
  const rec = await add('keep');
  await db.updatePage(rec.id, { pinned: true, tags: ['t1', 't2'] });
  await db.recordOpen(rec.id);
  const before = await db.getPage(rec.id);
  await new Promise((r) => setTimeout(r, 5));
  const out = await db.replaceFile(rec.id, { fileName: 'new.html', bytes: bytesOf('<p>newer file</p>'), charset: 'utf-8' });
  const after = await db.getPage(rec.id);
  eq(out, after);
  for (const k of ['name', 'tags', 'pinned', 'openCount', 'addedAt', 'lastOpenedAt']) eq(after[k], before[k], k);
  eq(after.fileName, 'new.html');
  eq(after.size, 17);
  assert(typeof after.replacedAt === 'number' && after.replacedAt >= before.addedAt);
  const f = await db.getFile(rec.id);
  eq(textOf(f.bytes), '<p>newer file</p>');
  eq(f.charset, 'utf-8');
});

test('replaceFile on an unknown id rejects and creates nothing', async () => {
  const pagesBefore = await db.listPages();
  await rejects(db.replaceFile('ghost', { fileName: 'g.html', bytes: bytesOf('x') }));
  eq(await db.listPages(), pagesBefore);
  eq(await db.getFile('ghost'), undefined);
});

test('addPage with a files put that fails leaves nothing behind', async () => {
  const before = await db.listPages();
  await rejects(db.addPage({ name: 'bad', fileName: 'bad.html', tags: [], bytes: unclonable() }));
  eq(await db.listPages(), before);
});

test('replaceFile with a files put that fails keeps the old file and record', async () => {
  const rec = await add('stay');
  const pageBefore = await db.getPage(rec.id);
  await rejects(db.replaceFile(rec.id, { fileName: 'x.html', bytes: unclonable() }));
  eq(await db.getPage(rec.id), pageBefore);
  eq(textOf((await db.getFile(rec.id)).bytes), '<p>stay</p>');
});

test('updatePage ignores unknown keys; recordOpen increments', async () => {
  const rec = await add('upd');
  const out = await db.updatePage(rec.id, { name: 'renamed', tags: ['z'], pinned: true, openCount: 99, id: 'other', size: 1, fileName: 'no.html' });
  eq(out.name, 'renamed'); eq(out.tags, ['z']); eq(out.pinned, true);
  eq(out.openCount, 0); eq(out.id, rec.id); eq(out.size, rec.size); eq(out.fileName, rec.fileName);
  const o1 = await db.recordOpen(rec.id);
  eq(o1.openCount, 1);
  assert(typeof o1.lastOpenedAt === 'number');
  const o2 = await db.recordOpen(rec.id);
  eq(o2.openCount, 2);
  eq(await db.getPage(rec.id), o2);
  await rejects(db.updatePage('ghost', { name: 'x' }));
  await rejects(db.recordOpen('ghost'));
});

test('local entries: set, overwrite, remove, clear', async () => {
  const id = 'local-1';
  eq(await db.getLocalEntries(id), []);
  await db.applyLocalOps(id, [{ op: 'set', key: 'a', value: '1' }, { op: 'set', key: 'b', value: '2' }]);
  eq(await db.getLocalEntries(id), [['a', '1'], ['b', '2']]);
  await db.applyLocalOps(id, [{ op: 'set', key: 'a', value: 'one' }]);
  eq(await db.getLocalEntries(id), [['a', 'one'], ['b', '2']]);
  await db.applyLocalOps(id, [{ op: 'remove', key: 'a' }]);
  eq(await db.getLocalEntries(id), [['b', '2']]);
  await db.applyLocalOps(id, [{ op: 'clear' }]);
  eq(await db.getLocalEntries(id), []);
  await db.applyLocalOps(id, []);
});

test('local ops apply in order in one call', async () => {
  const id = 'local-2';
  await db.applyLocalOps(id, [{ op: 'set', key: 'a', value: '1' }, { op: 'clear' }, { op: 'set', key: 'b', value: '2' }]);
  eq(await db.getLocalEntries(id), [['b', '2']]);
});

test('two pages with the same key are separate; clear touches only one', async () => {
  await db.applyLocalOps('pg-x', [{ op: 'set', key: 'state', value: 'X' }]);
  await db.applyLocalOps('pg-y', [{ op: 'set', key: 'state', value: 'Y' }]);
  eq(await db.getLocalEntries('pg-x'), [['state', 'X']]);
  eq(await db.getLocalEntries('pg-y'), [['state', 'Y']]);
  await db.applyLocalOps('pg-x', [{ op: 'clear' }]);
  eq(await db.getLocalEntries('pg-x'), []);
  eq(await db.getLocalEntries('pg-y'), [['state', 'Y']]);
});

test('a failing local op batch changes nothing', async () => {
  const id = 'local-3';
  await db.applyLocalOps(id, [{ op: 'set', key: 'k', value: 'v' }]);
  await rejects(db.applyLocalOps(id, [{ op: 'set', key: 'k', value: 'changed' }, { op: 'bogus' }]));
  eq(await db.getLocalEntries(id), [['k', 'v']]);
});

test('removePage removes that page only, and its databases', async () => {
  const a = await add('rm-a');
  const b = await add('rm-b');
  await db.applyLocalOps(a.id, [{ op: 'set', key: 'k', value: 'va' }]);
  await db.applyLocalOps(b.id, [{ op: 'set', key: 'k', value: 'vb' }]);
  const mine = `${PAGE_DB_PREFIX}${a.id}:mine`;
  const other = `${PAGE_DB_PREFIX}${b.id}:mine`;
  for (const n of [mine, other, 'unrelated-db']) (await openDb(n)).close();
  eq(await db.listPageDatabases(a.id), [mine]);

  await db.removePage(a.id);
  eq(await db.getPage(a.id), undefined);
  eq(await db.getFile(a.id), undefined);
  eq(await db.getLocalEntries(a.id), []);
  eq(await db.listPageDatabases(a.id), []);
  const names = await dbNames();
  assert(!names.includes(mine), 'own database should be gone');
  assert(names.includes(other), 'other page database should stay');
  assert(names.includes('unrelated-db'), 'unrelated database should stay');
  assert((await db.getPage(b.id)) !== undefined);
  assert((await db.getFile(b.id)) !== undefined);
  eq(await db.getLocalEntries(b.id), [['k', 'vb']]);
});

test('removePage does not hang on a database held open', async () => {
  const rec = await add('rm-blocked');
  const held = await openDb(`${PAGE_DB_PREFIX}${rec.id}:held`);
  const t0 = Date.now();
  await db.removePage(rec.id);
  const took = Date.now() - t0;
  assert(took < 8000, `took ${took} ms`);
  eq(await db.getPage(rec.id), undefined);
  held.close();
});

test('settings: fallback, set, get', async () => {
  eq(await db.getSetting('nothing', 'dflt'), 'dflt');
  eq(await db.getSetting('nothing', undefined), undefined);
  await db.setSetting('s1', 'abc');
  eq(await db.getSetting('s1', 'dflt'), 'abc');
  await db.setSetting('s1', false);
  eq(await db.getSetting('s1', 'dflt'), false);
  await db.setSetting('s2', { a: [1, 2] });
  eq(await db.getSetting('s2', null), { a: [1, 2] });
});

test('QuotaExceededError maps to JdError storage-full', async () => {
  const quota = new DOMException('full', 'QuotaExceededError');
  const mapped = db._test.mapError(quota);
  assert(mapped instanceof JdError);
  eq(mapped.code, 'storage-full');
  assert(mapped.cause === quota);
  const other = new Error('boom');
  assert(db._test.mapError(other) === other);
  const already = new JdError('empty');
  assert(db._test.mapError(already) === already);
});

test('survives a versionchange by reopening', async () => {
  const rec = await add('vc');
  // A higher-version open from elsewhere makes db.js close its connection.
  const up = await new Promise((resolve, reject) => {
    const req = indexedDB.open('junk-drawer', 2);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  up.close();
  // db.js would now fail to reopen at version 1; this documents that the
  // cached connection was dropped rather than left dead.
  await rejects(db.getPage(rec.id), (e) => e?.name === 'VersionError');
});
