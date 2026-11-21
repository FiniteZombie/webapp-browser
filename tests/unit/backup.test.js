import { test, assert, eq, rejects } from './harness.js';
import * as db from '../../app/js/db.js';
import { PAGE_DB_PREFIX } from '../../app/js/config.js';
import {
  encodeValue, decodeValue, Unsupported, buildBackup, readBackup, restoreBackup, MANIFEST,
} from '../../app/js/backup.js';
import { makeZip, readZip } from '../../app/js/zip.js';

const bytesOf = (text) => new TextEncoder().encode(text).buffer;
const textOf = (buf) => new TextDecoder().decode(buf);

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Makes a page database the way the page itself would (through the prefix).
async function makePageDb(pageId, name, version, upgrade, fill) {
  const open = indexedDB.open(`${PAGE_DB_PREFIX}${pageId}:${name}`, version);
  open.onupgradeneeded = () => upgrade(open.result);
  const idb = await req(open);
  if (fill) {
    const tx = idb.transaction([...idb.objectStoreNames], 'readwrite');
    fill(tx);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  }
  idb.close();
}

async function readPageDb(pageId, name) {
  const idb = await req(indexedDB.open(`${PAGE_DB_PREFIX}${pageId}:${name}`));
  const out = { version: idb.version, stores: {} };
  for (const s of idb.objectStoreNames) {
    const tx = idb.transaction(s);
    const store = tx.objectStore(s);
    const keys = await req(store.getAllKeys());
    const values = await req(store.getAll());
    out.stores[s] = {
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: [...store.indexNames].map((n) => {
        const i = store.index(n);
        return [n, i.keyPath, i.unique, i.multiEntry];
      }),
      keys,
      values,
    };
  }
  idb.close();
  return out;
}

async function wipe() {
  for (const p of await db.listPages()) await db.removePage(p.id);
}

// ---------- values ----------

test('encodeValue/decodeValue round-trip what JSON alone loses', () => {
  const value = {
    s: 'text \ud800 lone surrogate', n: 1.5, t: true, z: null,
    nan: NaN, inf: Infinity, ninf: -Infinity, nz: -0, u: undefined, big: 12345678901234567890n,
    d: new Date(1700000000000), bad: new Date(NaN), r: /a+b/gi,
    m: new Map([[1, 'one'], ['k', { deep: [1, 2] }]]), set: new Set(['a', 3]),
    buf: new Uint8Array([1, 2, 255]).buffer, f32: new Float32Array([1.5, -2]),
    dv: new DataView(new Uint8Array([9, 8]).buffer),
    arr: [1, 'two', [3]], tricky: { $jd: 'date', v: 5 },
  };
  const json = JSON.parse(JSON.stringify(encodeValue(value)));
  const back = decodeValue(json);
  eq(back.s, value.s);
  assert(Number.isNaN(back.nan)); eq(back.inf, Infinity); eq(back.ninf, -Infinity);
  assert(Object.is(back.nz, -0), '-0 kept');
  assert('u' in back && back.u === undefined, 'undefined kept');
  eq(back.big, 12345678901234567890n);
  assert(back.d instanceof Date && back.d.getTime() === 1700000000000);
  assert(Number.isNaN(back.bad.getTime()));
  assert(back.r instanceof RegExp && back.r.source === 'a+b' && back.r.flags === 'gi');
  assert(back.m instanceof Map && back.m.get(1) === 'one');
  eq(back.m.get('k'), { deep: [1, 2] });
  assert(back.set instanceof Set && back.set.has('a') && back.set.has(3));
  assert(back.buf instanceof ArrayBuffer);
  eq([...new Uint8Array(back.buf)], [1, 2, 255]);
  assert(back.f32 instanceof Float32Array);
  eq([...back.f32], [1.5, -2]);
  assert(back.dv instanceof DataView && back.dv.getUint8(1) === 8);
  eq(back.arr, [1, 'two', [3]]);
  eq(back.tricky, { $jd: 'date', v: 5 }, 'an object that happens to use the tag key stays an object');
});

test('encodeValue refuses files, images and self-references', async () => {
  const e1 = (() => { try { encodeValue({ pic: new Blob(['x']) }); } catch (e) { return e; } })();
  assert(e1 instanceof Unsupported); eq(e1.kind, 'files or images');
  const e2 = (() => { try { encodeValue([new File(['x'], 'a.png')]); } catch (e) { return e; } })();
  assert(e2 instanceof Unsupported); eq(e2.kind, 'files or images');
  const loop = { a: 1 }; loop.self = loop;
  const e3 = (() => { try { encodeValue(loop); } catch (e) { return e; } })();
  assert(e3 instanceof Unsupported);
  const shared = { x: 1 };
  eq(decodeValue(encodeValue({ a: shared, b: shared })), { a: { x: 1 }, b: { x: 1 } }, 'shared, not looping, is fine');
});

// ---------- whole backups ----------

test('a backup round-trips pages, localStorage and page databases', async () => {
  await wipe();
  const a = await db.addPage({ name: 'Alpha', fileName: 'alpha.html', tags: ['x', 'y'], bytes: bytesOf('<p>alpha</p>'), charset: null });
  const b = await db.addPage({ name: 'Beta', fileName: 'alpha.html', tags: [], bytes: new Uint8Array([0x3c, 0x70, 0x3e, 0xe9]).buffer, charset: 'windows-1252' });
  await db.updatePage(b.id, { pinned: true });
  await db.recordOpen(b.id);
  await db.applyLocalOps(a.id, [{ op: 'set', key: 'score', value: '42' }, { op: 'set', key: 'emoji', value: '🙂' }]);

  await makePageDb(a.id, 'notes', 3, (idb) => {
    const s = idb.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
    s.createIndex('byTag', 'tags', { multiEntry: true });
    s.createIndex('byTitle', 'title', { unique: true });
    idb.createObjectStore('kv');
  }, (tx) => {
    const notes = tx.objectStore('notes');
    notes.put({ title: 'one', tags: ['a', 'b'], when: new Date(5) });
    notes.put({ title: 'two', tags: [], pic: new Blob(['png']) });   // left out: holds a Blob
    notes.put({ title: 'three', tags: ['c'] });
    const kv = tx.objectStore('kv');
    kv.put({ deep: new Map([[1, 2]]) }, 'settings');
    kv.put('dated', new Date(10));
    kv.put(new Uint8Array([7]).buffer, [1, 'compound']);
  });

  const built = await buildBackup({ now: new Date(2026, 10, 21, 9, 30) });
  eq(built.fileName, 'junk-drawer-backup-2026-11-21.zip');
  eq(built.pageCount, 2);
  eq(built.skipped.length, 1);
  eq(built.skipped[0].pageName, 'Alpha');
  assert(/1 saved item holding files or images/.test(built.skipped[0].what), built.skipped[0].what);

  const entries = await readZip(built.blob);
  eq([...entries.keys()].sort(), ['junk-drawer-backup.json', 'pages/alpha (2).html', 'pages/alpha.html']);
  eq(textOf(entries.get('pages/alpha.html')), '<p>alpha</p>', 'the HTML is in the zip as it was added');

  // Change things after the backup, so the restore has to put them back.
  await db.updatePage(a.id, { name: 'Renamed', tags: [] });
  await db.applyLocalOps(a.id, [{ op: 'clear' }, { op: 'set', key: 'later', value: 'x' }]);
  await makePageDb(a.id, 'extra', 1, (idb) => idb.createObjectStore('s'));
  await db.removePage(b.id);
  const c = await db.addPage({ name: 'Gamma', fileName: 'gamma.html', tags: [], bytes: bytesOf('<p>c</p>') });

  const backup = await readBackup(new File([built.blob], built.fileName));
  eq(backup.pages.length, 2);
  eq(backup.unreadable, []);
  eq(backup.skipped.length, 1);
  const { problems } = await restoreBackup(backup);
  eq(problems, []);

  const pages = await db.listPages();
  eq(pages.map((p) => p.name).sort(), ['Alpha', 'Beta', 'Gamma'], 'pages not in the backup stay');
  const a2 = await db.getPage(a.id);
  eq(a2, a, 'row is back as it was');
  const b2 = await db.getPage(b.id);
  eq(b2.pinned, true); eq(b2.openCount, 1); eq(b2.fileName, 'alpha.html'); eq(b2.size, 4);
  const fb = await db.getFile(b.id);
  eq(fb.charset, 'windows-1252');
  eq([...new Uint8Array(fb.bytes)], [0x3c, 0x70, 0x3e, 0xe9]);
  eq(await db.getLocalEntries(a.id), [['emoji', '🙂'], ['score', '42']]);
  assert(await db.getPage(c.id), 'Gamma untouched');

  eq(await db.listPageDatabases(a.id), [`${PAGE_DB_PREFIX}${a.id}:notes`], 'the database made after the backup is gone');
  const notes = await readPageDb(a.id, 'notes');
  eq(notes.version, 3);
  const ns = notes.stores.notes;
  eq(ns.keyPath, 'id'); eq(ns.autoIncrement, true);
  eq(ns.indexes.sort(), [['byTag', 'tags', false, true], ['byTitle', 'title', true, false]]);
  eq(ns.values.map((v) => v.title), ['one', 'three']);
  assert(ns.values[0].when instanceof Date && ns.values[0].when.getTime() === 5);
  eq(ns.keys, [1, 3]);
  const kv = notes.stores.kv;
  eq(kv.keyPath, null);
  eq(kv.keys.length, 3);
  const byKey = new Map(kv.keys.map((k, i) => [JSON.stringify(k), kv.values[i]]));
  assert(byKey.get('"settings"').deep instanceof Map);
  eq(byKey.get(JSON.stringify(new Date(10))), 'dated', 'a Date key comes back as a Date key');
  assert(kv.keys.some((k) => k instanceof Date && k.getTime() === 10));
  eq([...new Uint8Array(byKey.get('[1,"compound"]'))], [7]);

  // The key generator carries on after the restored keys.
  const idb = await req(indexedDB.open(`${PAGE_DB_PREFIX}${a.id}:notes`));
  const tx = idb.transaction('notes', 'readwrite');
  const key = await req(tx.objectStore('notes').put({ title: 'four', tags: [] }));
  idb.close();
  eq(key, 4);
});

test('readBackup: not a zip, a zip that isn’t ours, a newer backup', async () => {
  await rejects(readBackup(new File(['<p>hi</p>'], 'x.zip')), 'backup-unreadable');
  await rejects(readBackup(await makeZip([{ name: 'other.txt', data: 'x' }])), 'backup-not-ours');
  await rejects(readBackup(await makeZip([{ name: MANIFEST, data: '{"format":"something-else","version":1,"pages":[]}' }])), 'backup-not-ours');
  await rejects(readBackup(await makeZip([{ name: MANIFEST, data: 'not json' }])), 'backup-unreadable');
  await rejects(readBackup(await makeZip([{ name: MANIFEST, data: '{"format":"junk-drawer-backup","version":99,"pages":[]}' }])), 'backup-too-new');
});

test('readBackup: a page whose HTML is missing is listed, and bad fields are cleaned', async () => {
  const manifest = {
    format: 'junk-drawer-backup',
    version: 1,
    pages: [
      { id: 'p1', name: 'Has file', fileName: 'a.html', tags: ['ok', 3, 'ok'], pinned: 'yes', openCount: -4, file: 'pages/a.html', local: [['k', 'v'], ['bad', 1]] },
      { id: 'p2', name: 'No file', file: 'pages/missing.html' },
      { name: 'No id', file: 'pages/a.html' },
    ],
  };
  const blob = await makeZip([{ name: MANIFEST, data: JSON.stringify(manifest) }, { name: 'pages/a.html', data: '<p>a</p>' }]);
  const backup = await readBackup(blob);
  eq(backup.pages.length, 1);
  eq(backup.unreadable, ['No file']);
  const r = backup.pages[0].record;
  eq(r.tags, ['ok']); eq(r.pinned, false); eq(r.openCount, 0);
  eq(backup.pages[0].local, [['k', 'v']]);
  eq(textOf(backup.pages[0].bytes), '<p>a</p>');
});
