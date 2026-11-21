// Backup: the library as one zip file, and back. No UI: backup-flow.js asks
// and reports. Window only (it opens the pages' own databases).
//
// The zip holds every page's HTML file under pages/, exactly as it was
// added, and one manifest, junk-drawer-backup.json, with each page's row,
// its localStorage data and its own IndexedDB databases. Database values go
// through encodeValue: what JSON can't hold directly gets a {"$jd": …}
// wrapper. Values that don't convert easily (files, images and other
// browser objects) are left out, and the backup says which pages lost what.

import { PAGE_DB_PREFIX } from './config.js';
import { JdError, getBuild } from './errors.js';
import { makeZip, readZip } from './zip.js';
import * as db from './db.js';

export const FORMAT = 'junk-drawer-backup';
export const VERSION = 1;
export const MANIFEST = 'junk-drawer-backup.json';
const TAG = '$jd';

// ---------- values ----------

export class Unsupported extends Error {
  constructor(kind) {
    super(`can’t back up ${kind}`);
    this.name = 'Unsupported';
    this.kind = kind;
  }
}

const VIEWS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
};
if (typeof Float16Array === 'function') VIEWS.Float16Array = Float16Array;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text) {
  const s = atob(String(text));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function kindOf(v) {
  if (typeof Blob === 'function' && v instanceof Blob) return 'files or images';
  const tag = Object.prototype.toString.call(v).slice(8, -1);
  return tag && tag !== 'Object' ? `${tag} values` : 'other values';
}

function isPlain(v) {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// A structured-clone value (what IndexedDB stores) as JSON-safe data.
// Throws Unsupported for what it can't convert.
export function encodeValue(value) {
  const stack = new Set();
  const enc = (v) => {
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return v;
      case 'number':
        if (Number.isNaN(v)) return { [TAG]: 'num', v: 'NaN' };
        if (v === Infinity) return { [TAG]: 'num', v: 'Infinity' };
        if (v === -Infinity) return { [TAG]: 'num', v: '-Infinity' };
        if (Object.is(v, -0)) return { [TAG]: 'num', v: '-0' };
        return v;
      case 'undefined':
        return { [TAG]: 'undef' };
      case 'bigint':
        return { [TAG]: 'bigint', v: v.toString() };
      case 'object':
        break;
      default:
        throw new Unsupported(`${typeof v} values`);
    }
    if (v === null) return null;
    if (stack.has(v)) throw new Unsupported('values that contain themselves');
    stack.add(v);
    try {
      if (Array.isArray(v)) {
        const out = new Array(v.length);
        for (let i = 0; i < v.length; i++) out[i] = enc(v[i]);
        return out;
      }
      if (v instanceof Date) return { [TAG]: 'date', v: Number.isNaN(v.getTime()) ? null : v.getTime() };
      if (v instanceof RegExp) return { [TAG]: 'regexp', source: v.source, flags: v.flags };
      if (v instanceof Map) return { [TAG]: 'map', v: [...v].map(([k, x]) => [enc(k), enc(x)]) };
      if (v instanceof Set) return { [TAG]: 'set', v: [...v].map(enc) };
      if (v instanceof ArrayBuffer) return { [TAG]: 'bytes', v: toBase64(new Uint8Array(v)) };
      if (ArrayBuffer.isView(v)) {
        const type = Object.keys(VIEWS).find((k) => v instanceof VIEWS[k]);
        if (!type) throw new Unsupported(kindOf(v));
        return { [TAG]: 'view', type, v: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      }
      if (!isPlain(v) || Object.prototype.toString.call(v) !== '[object Object]') throw new Unsupported(kindOf(v));
      const out = {};
      for (const k of Object.keys(v)) out[k] = enc(v[k]);
      return Object.hasOwn(v, TAG) ? { [TAG]: 'obj', v: out } : out;
    } finally {
      stack.delete(v);
    }
  };
  return enc(value);
}

// The reverse of encodeValue. Throws on a wrapper it doesn't know.
export function decodeValue(data) {
  const dec = (d) => {
    if (d === null || typeof d !== 'object') return d;
    if (Array.isArray(d)) return d.map(dec);
    if (!Object.hasOwn(d, TAG)) {
      const out = {};
      for (const k of Object.keys(d)) out[k] = dec(d[k]);
      return out;
    }
    switch (d[TAG]) {
      case 'num': return Number(d.v === '-0' ? -0 : d.v);
      case 'undef': return undefined;
      case 'bigint': return BigInt(d.v);
      case 'date': return new Date(d.v === null ? NaN : d.v);
      case 'regexp': return new RegExp(d.source, d.flags);
      case 'map': return new Map(d.v.map(([k, x]) => [dec(k), dec(x)]));
      case 'set': return new Set(d.v.map(dec));
      case 'bytes': return fromBase64(d.v).buffer;
      case 'view': {
        const Ctor = Object.hasOwn(VIEWS, d.type) ? VIEWS[d.type] : null;
        if (!Ctor) throw new Error(`unknown kind of bytes: ${d.type}`);
        const buf = fromBase64(d.v).buffer;
        if (Ctor === DataView) return new DataView(buf);
        return new Ctor(buf);
      }
      case 'obj': {
        const out = {};
        for (const k of Object.keys(d.v)) out[k] = dec(d.v[k]);
        return out;
      }
      default:
        throw new Error(`unknown value wrapper: ${d[TAG]}`);
    }
  };
  return dec(data);
}

// ---------- a page's own databases ----------

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => { /* the abort reports it */ };
  });
}

// Reads one database. Resolves to { database, skipped } where skipped maps
// a kind of value to how many records held one (those records are left out).
async function dumpDatabase(fullName, shortName) {
  const idb = await request(indexedDB.open(fullName));
  const skipped = new Map();
  try {
    const stores = [];
    const names = [...idb.objectStoreNames];
    if (names.length) {
      const tx = idb.transaction(names, 'readonly');
      const finished = done(tx);
      for (const name of names) {
        const store = tx.objectStore(name);
        const out = {
          name,
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: [...store.indexNames].map((n) => {
            const i = store.index(n);
            return { name: n, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry };
          }),
          records: [],
        };
        stores.push(out);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          try {
            const key = store.keyPath === null ? encodeValue(cursor.primaryKey) : null;
            out.records.push([key, encodeValue(cursor.value)]);
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
            skipped.set(e.kind, (skipped.get(e.kind) || 0) + 1);
          }
          cursor.continue();
        };
      }
      await finished;
    }
    return { database: { name: shortName, version: idb.version, stores }, skipped };
  } finally {
    idb.close();
  }
}

// Creates one of a page's databases from a backup. The page's old database
// of that name must already be deleted.
async function restoreDatabase(pageId, database) {
  const fullName = `${PAGE_DB_PREFIX}${pageId}:${database.name}`;
  const version = Number.isInteger(database.version) && database.version > 0 ? database.version : 1;
  const stores = Array.isArray(database.stores) ? database.stores : [];
  const open = indexedDB.open(fullName, version);
  open.onupgradeneeded = () => {
    const idb = open.result;
    for (const s of stores) {
      const store = idb.createObjectStore(s.name, {
        keyPath: s.keyPath ?? null, autoIncrement: Boolean(s.autoIncrement),
      });
      for (const i of s.indexes || []) {
        store.createIndex(i.name, i.keyPath, { unique: Boolean(i.unique), multiEntry: Boolean(i.multiEntry) });
      }
    }
  };
  const idb = await request(open);
  let failed = 0;
  try {
    const names = stores.map((s) => s.name);
    if (!names.length) return { failed };
    const tx = idb.transaction(names, 'readwrite');
    const finished = done(tx);
    for (const s of stores) {
      const store = tx.objectStore(s.name);
      for (const [key, value] of s.records || []) {
        let req;
        try {
          const v = decodeValue(value);
          req = store.keyPath === null ? store.put(v, decodeValue(key)) : store.put(v);
        } catch {
          failed++;
          continue;
        }
        // One bad record mustn't abort the rest.
        req.onerror = (e) => { e.preventDefault(); e.stopPropagation(); failed++; };
      }
    }
    await finished;
    return { failed };
  } finally {
    idb.close();
  }
}

// ---------- building a backup ----------

const BAD_NAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

function safeFileName(name) {
  const clean = String(name ?? '').replace(BAD_NAME, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return clean || 'page.html';
}

function uniquePath(fileName, taken) {
  const clean = safeFileName(fileName);
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let path = `pages/${clean}`;
  for (let n = 2; taken.has(path.toLowerCase()); n++) path = `pages/${stem} (${n})${ext}`;
  taken.add(path.toLowerCase());
  return path;
}

const PAGE_FIELDS = ['id', 'name', 'fileName', 'tags', 'pinned', 'openCount', 'addedAt', 'lastOpenedAt', 'replacedAt'];

// Resolves to { blob, fileName, pageCount, skipped } where skipped is a list
// of { pageId, pageName, what } for the data left out.
export async function buildBackup({ now = new Date() } = {}) {
  const { pages, files, local } = await db.readLibrary();
  const sorted = [...pages].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const taken = new Set();
  const entries = [];
  const out = [];
  const skipped = [];

  for (const page of sorted) {
    const file = files.get(page.id);
    if (!file) {
      skipped.push({ pageId: page.id, pageName: page.name, what: 'the page itself (Junk Drawer’s copy is missing)' });
      continue;
    }
    const path = uniquePath(page.fileName || `${page.name}.html`, taken);
    entries.push({ name: path, data: file.bytes });

    const databases = [];
    let names = [];
    try {
      names = await db.listPageDatabases(page.id);
    } catch {
      skipped.push({ pageId: page.id, pageName: page.name, what: 'its saved databases (they couldn’t be listed)' });
    }
    const prefix = `${PAGE_DB_PREFIX}${page.id}:`;
    for (const fullName of names.sort()) {
      const shortName = fullName.slice(prefix.length);
      try {
        const { database, skipped: lost } = await dumpDatabase(fullName, shortName);
        databases.push(database);
        for (const [kind, count] of lost) {
          skipped.push({
            pageId: page.id,
            pageName: page.name,
            what: `${count} saved ${count === 1 ? 'item' : 'items'} holding ${kind}`,
          });
        }
      } catch (e) {
        skipped.push({
          pageId: page.id,
          pageName: page.name,
          what: `its saved database “${shortName}” (${e && e.name ? e.name : 'it couldn’t be read'})`,
        });
      }
    }

    const row = {};
    for (const k of PAGE_FIELDS) row[k] = page[k] ?? null;
    out.push({ ...row, charset: file.charset ?? null, file: path, local: local.get(page.id) || [], databases });
  }

  const manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: now.toISOString(),
    build: await getBuild(),
    pages: out,
    skipped,
  };
  entries.unshift({ name: MANIFEST, data: JSON.stringify(manifest) });
  const blob = await makeZip(entries, { date: now });
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
  return { blob, fileName: `junk-drawer-backup-${day}.zip`, pageCount: out.length, skipped };
}

// ---------- reading a backup ----------

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v, fallback = null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function pageRecord(p) {
  const tags = Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string' && t) : [];
  return {
    id: p.id,
    name: str(p.name).trim() || str(p.fileName) || 'untitled',
    fileName: str(p.fileName, 'page.html'),
    tags: [...new Set(tags)],
    pinned: p.pinned === true,
    openCount: Math.max(0, Math.floor(num(p.openCount, 0))),
    addedAt: num(p.addedAt, Date.now()),
    lastOpenedAt: num(p.lastOpenedAt),
    replacedAt: num(p.replacedAt),
  };
}

function localEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
    .map(([k, v]) => [k, v]);
}

// file: the picked Blob/File. Resolves to { pages, skipped, unreadable, totalBytes }:
// pages are ready for restoreBackup; unreadable lists names of pages whose
// HTML wasn't in the zip. Throws JdError backup-unreadable, backup-not-ours
// or backup-too-new.
export async function readBackup(file) {
  let entries;
  try {
    entries = await readZip(file);
  } catch (cause) {
    throw new JdError('backup-unreadable', { cause });
  }
  const raw = entries.get(MANIFEST);
  if (!raw) throw new JdError('backup-not-ours', { detail: `no ${MANIFEST} in the zip` });
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } catch (cause) {
    throw new JdError('backup-unreadable', { cause, detail: `${MANIFEST} isn’t valid JSON` });
  }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.pages)) {
    throw new JdError('backup-not-ours', { detail: `format: ${manifest && manifest.format}` });
  }
  if (!Number.isInteger(manifest.version) || manifest.version > VERSION) {
    throw new JdError('backup-too-new', { detail: `backup version ${manifest.version}, this build reads up to ${VERSION}` });
  }

  const pages = [];
  const unreadable = [];
  const seen = new Set();
  let totalBytes = raw.length;
  for (const p of manifest.pages) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    const record = pageRecord(p);
    const bytes = typeof p.file === 'string' ? entries.get(p.file) : undefined;
    if (!bytes) {
      unreadable.push(record.name);
      continue;
    }
    totalBytes += bytes.length;
    pages.push({
      record,
      bytes: bytes.buffer.byteLength === bytes.length ? bytes.buffer : bytes.slice().buffer,
      charset: typeof p.charset === 'string' ? p.charset : null,
      local: localEntries(p.local),
      databases: Array.isArray(p.databases)
        ? p.databases.filter((d) => d && typeof d.name === 'string' && Array.isArray(d.stores))
        : [],
    });
  }
  const skipped = Array.isArray(manifest.skipped)
    ? manifest.skipped.filter((s) => s && typeof s.what === 'string').map((s) => ({ pageName: str(s.pageName, 'a page'), what: s.what }))
    : [];
  return { pages, skipped, unreadable, totalBytes, exportedAt: str(manifest.exportedAt) };
}

// Writes what readBackup returned. Pages and their localStorage data go in
// one transaction; then each page's databases are replaced. Resolves to
// { problems: [text] } for databases that didn't come back whole.
export async function restoreBackup(backup) {
  await db.importPages(backup.pages);
  const problems = [];
  for (const p of backup.pages) {
    await db.removePageDatabases(p.record.id);
    for (const d of p.databases) {
      try {
        const { failed } = await restoreDatabase(p.record.id, d);
        if (failed) problems.push(`“${p.record.name}”: ${failed} saved ${failed === 1 ? 'item' : 'items'} in “${d.name}” couldn’t be put back`);
      } catch (e) {
        problems.push(`“${p.record.name}”: its saved database “${d.name}” couldn’t be put back (${e && e.name ? e.name : 'error'})`);
      }
    }
  }
  return { problems };
}
