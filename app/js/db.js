// Storage layer: the one IndexedDB database `junk-drawer`.
// No DOM and no window: the service worker imports this file too.
// Every operation is one transaction and resolves on the transaction's
// `complete`, so a resolved promise means the data is on disk.
// (No dynamic import() here: service workers can't use it.)

import { DB_NAME, DB_VERSION, PAGE_DB_PREFIX } from './config.js';
import { JdError } from './errors.js';

const PAGES = 'pages';
const FILES = 'files';
const LOCAL = 'pageLocal';
const SETTINGS_STORE = 'settings';

const DELETE_DB_WAIT_MS = 3000;

// ---------- connection ----------

let connection = null;   // Promise<IDBDatabase> | null

function open() {
  if (connection) return connection;
  const attempt = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LOCAL)) db.createObjectStore(LOCAL, { keyPath: ['pageId', 'key'] });
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        if (connection === attempt) connection = null;
      };
      db.onclose = () => {
        if (connection === attempt) connection = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { /* keep waiting for success or error */ };
  });
  connection = attempt;
  attempt.catch(() => {
    if (connection === attempt) connection = null;
  });
  return attempt;
}

// ---------- errors ----------

function isQuota(e) {
  return e != null && e.name === 'QuotaExceededError';
}

// A QuotaExceededError becomes JdError('storage-full'); anything else is
// returned as it came.
function mapError(e) {
  if (e instanceof JdError) return e;
  if (isQuota(e)) return new JdError('storage-full', { cause: e });
  return e;
}

// ---------- transaction helper ----------

// run(stores, mode, work) opens one transaction and calls work(tx, fail).
// work issues its requests (it may do more inside request callbacks, guarded
// with fail) and returns a function that reads the result; that function is
// called after the transaction completes. Any throw, in work or via fail(),
// aborts the transaction, so nothing partial is committed.
async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let failure;
    let tx;
    try {
      tx = db.transaction(stores, mode);
    } catch (e) {
      reject(mapError(e));
      return;
    }
    const fail = (e) => {
      if (failure === undefined) failure = e;
      try { tx.abort(); } catch { /* already finished */ }
    };
    let read = () => undefined;
    tx.oncomplete = () => {
      try { resolve(read()); } catch (e) { reject(e); }
    };
    tx.onabort = () => reject(mapError(failure !== undefined ? failure : (tx.error ?? new Error('transaction aborted'))));
    tx.onerror = () => { /* the abort that follows reports it */ };
    try {
      read = work(tx, fail) || read;
    } catch (e) {
      fail(e);
    }
  });
}

// Runs fn inside a request callback; a throw aborts the transaction.
const guarded = (fail, fn) => (...args) => {
  try { fn(...args); } catch (e) { fail(e); }
};

const missing = (id) => new Error(`no page with id ${id}`);

// ---------- pages ----------

export async function listPages() {
  return run(PAGES, 'readonly', (tx) => {
    const req = tx.objectStore(PAGES).getAll();
    return () => req.result;
  });
}

export async function getPage(id) {
  return run(PAGES, 'readonly', (tx) => {
    const req = tx.objectStore(PAGES).get(id);
    return () => req.result;
  });
}

export async function addPage({ name, fileName, tags, bytes, charset }) {
  const id = crypto.randomUUID();
  const record = {
    id,
    name,
    fileName,
    tags: tags ?? [],
    pinned: false,
    openCount: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
    replacedAt: null,
    size: bytes.byteLength,
  };
  await run([PAGES, FILES], 'readwrite', (tx, fail) => {
    try {
      tx.objectStore(PAGES).put(record);
      tx.objectStore(FILES).put({ id, bytes, charset: charset ?? null });
    } catch (e) {
      fail(e);
    }
  });
  return record;
}

export async function replaceFile(id, { fileName, bytes, charset }) {
  let updated;
  await run([PAGES, FILES], 'readwrite', (tx, fail) => {
    const get = tx.objectStore(PAGES).get(id);
    get.onsuccess = guarded(fail, () => {
      const old = get.result;
      if (!old) { fail(missing(id)); return; }
      updated = { ...old, fileName, size: bytes.byteLength, replacedAt: Date.now() };
      tx.objectStore(PAGES).put(updated);
      tx.objectStore(FILES).put({ id, bytes, charset: charset ?? null });
    });
  });
  return updated;
}

// Reads one page row, lets change() return the new row, writes it back.
async function modifyPage(id, change) {
  let updated;
  await run(PAGES, 'readwrite', (tx, fail) => {
    const get = tx.objectStore(PAGES).get(id);
    get.onsuccess = guarded(fail, () => {
      const old = get.result;
      if (!old) { fail(missing(id)); return; }
      updated = change(old);
      tx.objectStore(PAGES).put(updated);
    });
  });
  return updated;
}

export async function updatePage(id, patch) {
  return modifyPage(id, (old) => {
    const next = { ...old };
    for (const key of ['name', 'tags', 'pinned']) {
      if (patch && Object.hasOwn(patch, key)) next[key] = patch[key];
    }
    return next;
  });
}

export async function recordOpen(id) {
  return modifyPage(id, (old) => ({
    ...old,
    openCount: (old.openCount || 0) + 1,
    lastOpenedAt: Date.now(),
  }));
}

export async function getFile(id) {
  return run(FILES, 'readonly', (tx) => {
    const req = tx.objectStore(FILES).get(id);
    return () => (req.result ? { bytes: req.result.bytes, charset: req.result.charset ?? null } : undefined);
  });
}

// ---------- a page's saved data (localStorage stand-in) ----------

const localRange = (pageId) => IDBKeyRange.bound([pageId], [pageId, []]);

export async function getLocalEntries(pageId) {
  return run(LOCAL, 'readonly', (tx) => {
    const req = tx.objectStore(LOCAL).getAll(localRange(pageId));
    return () => req.result.map((r) => [r.key, r.value]);
  });
}

export async function applyLocalOps(pageId, ops) {
  if (!ops || ops.length === 0) return;
  // The page row is checked in the same transaction: a write that lands
  // after removePage must not leave rows behind, so it does nothing.
  await run([PAGES, LOCAL], 'readwrite', (tx, fail) => {
    try {
      const check = tx.objectStore(PAGES).getKey(pageId);
      check.onsuccess = guarded(fail, () => {
        if (check.result === undefined) return;
        const store = tx.objectStore(LOCAL);
        for (const o of ops) {
          if (o.op === 'set') store.put({ pageId, key: o.key, value: o.value });
          else if (o.op === 'remove') store.delete([pageId, o.key]);
          else if (o.op === 'clear') store.delete(localRange(pageId));
          else throw new Error(`unknown local op: ${o.op}`);
        }
      });
    } catch (e) {
      fail(e);
    }
  });
}

// ---------- a page's own databases ----------

export async function listPageDatabases(pageId) {
  const prefix = `${PAGE_DB_PREFIX}${pageId}:`;
  const all = await indexedDB.databases();
  return all.map((d) => d.name).filter((n) => typeof n === 'string' && n.startsWith(prefix));
}

// Resolves on success, error, or after ms, whichever comes first. A
// `blocked` event is not a failure; we keep waiting up to the limit.
function deleteDatabase(name, ms = DELETE_DB_WAIT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = finish;
      req.onerror = finish;
    } catch {
      finish();
    }
  });
}

// Deletes every database the page made. Never rejects: a database that
// can't be listed or deleted is left behind.
export async function removePageDatabases(id) {
  let names = [];
  try {
    names = await listPageDatabases(id);
  } catch {
    // can't list: nothing more to do
  }
  await Promise.all(names.map((n) => deleteDatabase(n)));
}

export async function removePage(id) {
  await run([PAGES, FILES, LOCAL], 'readwrite', (tx) => {
    tx.objectStore(PAGES).delete(id);
    tx.objectStore(FILES).delete(id);
    tx.objectStore(LOCAL).delete(localRange(id));
  });
  await removePageDatabases(id);
}

// ---------- backup ----------

// Everything in the library, read in one transaction so it's one moment's
// state: { pages, files: Map(id -> { bytes, charset }), local: Map(id -> [[key, value]]) }.
export async function readLibrary() {
  return run([PAGES, FILES, LOCAL], 'readonly', (tx) => {
    const pages = tx.objectStore(PAGES).getAll();
    const files = tx.objectStore(FILES).getAll();
    const local = tx.objectStore(LOCAL).getAll();
    return () => {
      const fileMap = new Map(files.result.map((f) => [f.id, { bytes: f.bytes, charset: f.charset ?? null }]));
      const localMap = new Map();
      for (const r of local.result) {
        if (!localMap.has(r.pageId)) localMap.set(r.pageId, []);
        localMap.get(r.pageId).push([r.key, r.value]);
      }
      return { pages: pages.result, files: fileMap, local: localMap };
    };
  });
}

// Writes pages from a backup in one transaction: each item's row, file and
// localStorage data replace whatever that page id had. items:
// [{ record, bytes, charset, local: [[key, value]] }].
export async function importPages(items) {
  await run([PAGES, FILES, LOCAL], 'readwrite', (tx, fail) => {
    try {
      const pages = tx.objectStore(PAGES);
      const files = tx.objectStore(FILES);
      const local = tx.objectStore(LOCAL);
      for (const { record, bytes, charset, local: entries } of items) {
        const id = record.id;
        pages.put({ ...record, size: bytes.byteLength });
        files.put({ id, bytes, charset: charset ?? null });
        local.delete(localRange(id));
        for (const [key, value] of entries || []) local.put({ pageId: id, key, value });
      }
    } catch (e) {
      fail(e);
    }
  });
}

// ---------- settings ----------

export async function getSetting(key, fallback) {
  return run(SETTINGS_STORE, 'readonly', (tx) => {
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    return () => (req.result ? req.result.value : fallback);
  });
}

export async function setSetting(key, value) {
  await run(SETTINGS_STORE, 'readwrite', (tx, fail) => {
    try {
      tx.objectStore(SETTINGS_STORE).put({ key, value });
    } catch (e) {
      fail(e);
    }
  });
}

// For tests only.
export const _test = { mapError, deleteDatabase };
