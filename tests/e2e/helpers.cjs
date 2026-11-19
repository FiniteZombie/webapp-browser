'use strict';
// E2E helpers, available as t.helpers. Frozen after stage 2: ask the
// orchestrator for additions. Every function that runs code in the page
// passes it a self-contained function (Playwright serialises it).

const READY_TIMEOUT = 10_000;

async function openApp(context, appUrl, { boot = true } = {}) {
  const page = await context.newPage();
  if (!boot) {
    await page.addInitScript(() => {
      try { if (window !== window.top) return; } catch { return; }
      globalThis.__jdTest = Object.assign(globalThis.__jdTest || {}, { noBoot: true });
    });
  }
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__jdReady === true, null, { timeout: READY_TIMEOUT });
  return page;
}

async function ensureWorker(page) {
  await page.evaluate(async () => {
    const sw = navigator.serviceWorker;
    if (!sw) throw new Error('ensureWorker: no navigator.serviceWorker here');
    const reg = await sw.getRegistration();
    if (!reg) await sw.register('sw.js', { type: 'module', updateViaCache: 'none' });
    const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => {
      setTimeout(() => no(new Error(`ensureWorker: ${what} within ${ms} ms`)), ms);
    })]);
    await within(sw.ready, 10_000, 'no active service worker');
    if (!sw.controller) {
      await within(new Promise((res) => {
        if (sw.controller) return res();
        sw.addEventListener('controllerchange', () => res(), { once: true });
      }), 10_000, 'the service worker did not take control of the page');
    }
  });
}

async function seedPage(page, opts = {}) {
  return page.evaluate(async (o) => {
    const base = document.baseURI;
    const db = await import(new URL('js/db.js', base).href);
    const config = await import(new URL('js/config.js', base).href);
    const name = o.name ?? 'test page';
    const html = o.html ?? `<!doctype html><title>${name}</title><p>${name}</p>`;
    const bytes = new TextEncoder().encode(html).buffer;
    const rec = await db.addPage({
      name, fileName: o.fileName ?? `${name}.html`, tags: o.tags ?? [], bytes, charset: null,
    });
    if (o.pinned !== undefined) await db.updatePage(rec.id, { pinned: o.pinned });
    const extra = {};
    for (const k of ['openCount', 'addedAt', 'lastOpenedAt']) if (o[k] !== undefined) extra[k] = o[k];
    if (Object.keys(extra).length) {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(config.DB_NAME);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction('pages', 'readwrite');
          const store = tx.objectStore('pages');
          const get = store.get(rec.id);
          get.onsuccess = () => store.put({ ...get.result, ...extra });
          tx.oncomplete = () => { idb.close(); resolve(); };
          tx.onerror = () => { idb.close(); reject(tx.error); };
          tx.onabort = () => { idb.close(); reject(tx.error); };
        };
      });
    }
    const out = await db.getPage(rec.id);
    document.dispatchEvent(new CustomEvent(config.EVENTS.libraryChanged));
    return out;
  }, opts);
}

async function setNextPick(page, opts = {}) {
  const o = { ...opts };
  if (o.bytes !== undefined) o.bytes = Array.from(o.bytes instanceof ArrayBuffer ? new Uint8Array(o.bytes) : o.bytes);
  await page.evaluate((o) => {
    const t = (globalThis.__jdTest = globalThis.__jdTest || {});
    if (!Array.isArray(t.handleLog)) t.handleLog = [];
    const name = o.name ?? 'page.html';
    const type = o.type ?? 'text/html';
    const contents = o.bytes !== undefined ? new Uint8Array(o.bytes) : (o.html ?? '<!doctype html><title>picked</title><p>picked</p>');
    t.pickFile = async () => {
      const file = new File([contents], name, { type, lastModified: Date.now() });
      if (!o.withHandle) return { file, handle: null };
      const log = t.handleLog;
      const permission = o.permission ?? 'granted';
      const handle = {
        kind: 'file',
        name,
        async getFile() { return file; },
        async queryPermission(desc) { log.push({ method: 'queryPermission', mode: desc?.mode }); return permission; },
        async requestPermission(desc) { log.push({ method: 'requestPermission', mode: desc?.mode }); return permission; },
        async remove() {
          log.push({ method: 'remove' });
          if (o.removeFails) throw new DOMException('remove failed (test)', 'NoModificationAllowedError');
        },
        async isSameEntry(other) { return other === handle; },
      };
      return { file, handle };
    };
  }, o);
}

function viewerFrame(page) {
  return page.frames().find((f) => f.url().includes('/p/')) || null;
}

async function dbDump(page) {
  return page.evaluate(async () => {
    const config = await import(new URL('js/config.js', document.baseURI).href);
    const databases = (await indexedDB.databases()).map((d) => d.name).sort();
    const out = { pages: [], files: [], local: [], settings: {}, databases };
    if (!databases.includes(config.DB_NAME)) return out;   // opening it would create it empty
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(config.DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const all = (store) => new Promise((resolve, reject) => {
        if (!idb.objectStoreNames.contains(store)) return resolve([]);
        const req = idb.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      out.pages = await all('pages');
      out.files = (await all('files')).map((f) => ({
        id: f.id, size: f.bytes ? f.bytes.byteLength : 0, charset: f.charset ?? null,
      }));
      out.local = await all('pageLocal');
      for (const s of await all('settings')) out.settings[s.key] = s.value;
    } finally {
      idb.close();
    }
    return out;
  });
}

async function realStorageKeys(page) {
  return page.evaluate(() => {
    const keys = (s) => { const k = []; for (let i = 0; i < s.length; i++) k.push(s.key(i)); return k.sort(); };
    return { local: keys(window.localStorage), session: keys(window.sessionStorage) };
  });
}

module.exports = {
  openApp, ensureWorker, seedPage, setNextPick, viewerFrame, dbDump, realStorageKeys,
};
