import { test, assert, eq } from './harness.js';
import { buildPageParts } from '../../app/js/inject.js';
import { pageShim } from '../../app/js/page-shim.js';
import { HOST_GLOBAL, PAGE_DB_PREFIX, LOCAL_QUOTA_CHARS } from '../../app/js/config.js';

// A fake host: one record per pageId that may connect.
const hosts = new Map();
window[HOST_GLOBAL] = {
  connect(pageId) {
    const rec = hosts.get(pageId);
    if (!rec) return null;
    rec.connects++;
    return {
      entries: rec.entries,
      sessionEntries: rec.sessionEntries,
      apply(...args) { rec.apply.push(args); },
      applySession(...args) { rec.session.push(args); },
      notify(...args) { rec.notify.push(args); },
    };
  },
  pageError() {},
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let counter = 0;
const opened = [];

async function until(check, ms = 3000, what = 'condition') {
  const end = performance.now() + ms;
  for (;;) {
    if (check()) return;
    if (performance.now() > end) throw new Error('timed out waiting for ' + what);
    await delay(20);
  }
}

// html: a whole document, or a function run in the page as fn(R, arg) from
// a script in its <head>.
function pageHtml(fn, arg) {
  return '<!doctype html><html lang="xx"><head><meta charset="utf-8"><title>t</title><script>' +
    'window.R = {}; try { (' + fn.toString() + ')(window.R, ' + JSON.stringify(arg === undefined ? null : arg) + '); }' +
    ' catch (e) { window.R.error = String((e && e.stack) || e); }' +
    '</scr' + 'ipt></head><body><p>page</p></body></html>';
}

async function load(html, opts = {}) {
  const pageId = opts.pageId || 'shimtest' + (++counter) + Math.random().toString(36).slice(2, 8);
  const rec = {
    entries: opts.entries || [],
    sessionEntries: opts.sessionEntries || [],
    apply: [], session: [], notify: [], connects: 0,
  };
  if (opts.host !== false) hosts.set(pageId, rec);
  const boot = {
    pageId,
    hostGlobal: opts.hostGlobal || HOST_GLOBAL,
    dbPrefix: PAGE_DB_PREFIX + pageId + ':',
    quotaChars: opts.quota === undefined ? LOCAL_QUOTA_CHARS : opts.quota,
  };
  const bytes = new TextEncoder().encode(typeof html === 'function' ? pageHtml(html, opts.arg) : html);
  const parts = buildPageParts(bytes, pageShim.toString(), boot);
  const url = URL.createObjectURL(new Blob(parts, { type: 'text/html' }));
  const frame = document.createElement('iframe');
  const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
  frame.src = url;
  document.body.append(frame);
  const f = { frame, url, rec, boot, pageId, get win() { return frame.contentWindow; } };
  opened.push(f);
  if (opts.waitLoad !== false) await Promise.race([loaded, delay(5000)]);
  if (f.win && f.win.R && f.win.R.error) throw new Error('page script failed: ' + f.win.R.error);
  return f;
}

async function cleanup() {
  const names = new Set();
  for (const f of opened.splice(0)) {
    f.frame.remove();
    URL.revokeObjectURL(f.url);
    hosts.delete(f.pageId);
    names.add(f.boot.dbPrefix);
  }
  const all = await indexedDB.databases();
  for (const d of all) {
    if ([...names].some((p) => d.name.startsWith(p))) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => r();
      });
    }
  }
}

function realStorageEmpty() {
  eq(window.localStorage.length, 0, 'real localStorage length');
  eq(window.sessionStorage.length, 0, 'real sessionStorage length');
}

function within(name, fn) {
  test(name, async () => {
    try { await fn(); } finally { await cleanup(); }
  });
}

within('standards mode kept, injected script removed, ready sent', async () => {
  const f = await load((R) => {
    R.mode = document.compatMode;
    R.scripts = document.scripts.length;
    R.lang = document.documentElement.lang;
  });
  const R = f.win.R;
  eq(R.mode, 'CSS1Compat');
  eq(R.scripts, 1, 'scripts seen by the page');
  eq(R.lang, 'xx', '<html> attributes kept');
  const doc = f.frame.contentDocument;
  eq(doc.scripts.length, 1, 'scripts after load');
  assert(!doc.documentElement.outerHTML.includes('pageShim'), 'shim left in the DOM');
  eq(doc.title, 't');
  eq(f.rec.connects, 1);
  eq(f.rec.notify, [['ready']]);
});

within('a doctype after a 3000-character comment still gives standards mode', async () => {
  const comment = '<!--' + ' licence '.repeat(334) + '-->\n';
  assert(comment.length > 3000, 'comment too short');
  const f = await load(comment + '<!DOCTYPE html><html><head><script>window.R = { mode: document.compatMode }</scr' + 'ipt></head></html>');
  eq(f.win.R.mode, 'CSS1Compat');
  const q = await load('<html><head><script>window.R = { mode: document.compatMode }</scr' + 'ipt></head></html>');
  eq(q.win.R.mode, 'BackCompat', 'control: no doctype');
  eq(q.rec.notify, [['ready']], 'shim ran without a doctype');
});

within('localStorage: behaviour of the stand-in', async () => {
  const f = await load((R) => {
    const ls = localStorage;
    R.same = window.localStorage === ls && self.localStorage === ls;
    R.inst = ls instanceof Storage;
    R.tag = Object.prototype.toString.call(ls);
    R.init = ls.getItem('init');
    ls.setItem('a', 1);
    R.a = ls.getItem('a');
    ls.b = 2;
    R.b = ls.b;
    R.inB = 'b' in ls;
    R.inZ = 'zz' in ls;
    R.z = ls.getItem('zz');
    R.zProp = ls.zz === undefined;
    R.len = ls.length;
    R.keys = Object.keys(ls);
    R.json = JSON.stringify(ls);
    R.forin = [];
    for (const k in ls) R.forin.push(k);
    ls.setItem('getItem', 'g');
    ls.setItem('length', 'L');
    R.getItemType = typeof ls.getItem;
    R.getItemVal = ls.getItem('getItem');
    R.lenType = typeof ls.length;
    R.lenVal = ls.getItem('length');
    R.len2 = ls.length;
    R.keys2 = Object.keys(ls);
    R.key0 = ls.key(0);
    R.key4 = ls.key(4);
    R.key99 = ls.key(99);
    R.delB = delete ls.b;
    R.bAfter = ls.getItem('b');
    R.inBAfter = 'b' in ls;
    ls.removeItem('a');
    ls.removeItem('never-there');
    ls.setItem({ toString() { return 'obj'; } }, null);
    R.obj = ls.getItem('obj');
    R.objProp = ls.obj;
    ls.clear();
    R.lenClear = ls.length;
    R.keysClear = Object.keys(ls);
  }, { entries: [['init', 'v']] });
  const R = f.win.R;
  eq(R.same, true, 'same object everywhere');
  eq(R.inst, true, 'instanceof Storage');
  eq(R.tag, '[object Storage]');
  eq(R.init, 'v', 'initial entry');
  eq(R.a, '1');
  eq(R.b, '2');
  eq(R.inB, true);
  eq(R.inZ, false);
  eq(R.z, null);
  eq(R.zProp, true);
  eq(R.len, 3);
  eq(R.keys, ['init', 'a', 'b']);
  eq(JSON.parse(R.json), { init: 'v', a: '1', b: '2' });
  for (const k of ['init', 'a', 'b']) assert(R.forin.includes(k), 'for...in misses ' + k);
  eq(R.getItemType, 'function', 'getItem shadowed');
  eq(R.getItemVal, 'g');
  eq(R.lenType, 'number', 'length shadowed');
  eq(R.lenVal, 'L');
  eq(R.len2, 5);
  eq(R.keys2, ['init', 'a', 'b'], 'method-named keys are not properties');
  eq(R.key0, 'init');
  eq(R.key4, 'length');
  eq(R.key99, null);
  eq(R.delB, true);
  eq(R.bAfter, null);
  eq(R.inBAfter, false);
  eq(R.obj, 'null');
  eq(R.objProp, 'null');
  eq(R.lenClear, 0);
  eq(R.keysClear, []);
  eq(f.rec.apply, [
    ['set', 'a', '1'],
    ['set', 'b', '2'],
    ['set', 'getItem', 'g'],
    ['set', 'length', 'L'],
    ['remove', 'b'],
    ['remove', 'a'],
    ['set', 'obj', 'null'],
    ['clear'],
  ]);
  eq(f.rec.session, []);
  realStorageEmpty();
});

within('localStorage: quota refuses, changes nothing and notifies', async () => {
  const f = await load((R) => {
    const ls = localStorage;
    ls.setItem('x', 'y'.repeat(10));   // 6 + 11 = 17 of 20
    function attempt(fn) {
      try { fn(); return null; } catch (e) { return { name: e.name, dom: e instanceof DOMException }; }
    }
    R.e1 = attempt(() => ls.setItem('big', 'z'.repeat(50)));
    R.e2 = attempt(() => { ls.big2 = 'z'.repeat(50); });
    R.e3 = attempt(() => ls.setItem('x', 'y'.repeat(20)));
    R.big = ls.getItem('big');
    R.big2 = ls.getItem('big2');
    R.x = ls.getItem('x');
    R.len = ls.length;
    R.e4 = attempt(() => ls.setItem('x', 'w'));   // smaller: fine
    R.x2 = ls.getItem('x');
  }, { entries: [['k', '12345']], quota: 20 });
  const R = f.win.R;
  for (const e of [R.e1, R.e2, R.e3]) {
    assert(e, 'no error thrown');
    eq(e.name, 'QuotaExceededError');
    eq(e.dom, true, 'a DOMException');
  }
  eq(R.big, null);
  eq(R.big2, null);
  eq(R.x, 'y'.repeat(10));
  eq(R.len, 2);
  eq(R.e4, null);
  eq(R.x2, 'w');
  eq(f.rec.apply, [['set', 'x', 'y'.repeat(10)], ['set', 'x', 'w']]);
  const refused = f.rec.notify.filter((n) => n[0] === 'store-refused');
  eq(refused.length, 3);
  for (const n of refused) {
    eq(n[1].api, 'localStorage');
    assert(typeof n[1].detail === 'string' && n[1].detail.length > 0, 'detail');
  }
  realStorageEmpty();
});

within('sessionStorage: starts from the host and reports to applySession', async () => {
  const f = await load((R) => {
    const ss = sessionStorage;
    R.inst = ss instanceof Storage;
    R.distinct = ss !== localStorage;
    R.s = ss.getItem('s');
    R.localS = localStorage.getItem('s');
    ss.setItem('t', 2);
    ss.removeItem('s');
    ss.u = 'x';
    R.keys = Object.keys(ss);
    R.big = (() => { try { ss.setItem('big', 'z'.repeat(5000)); return 'ok'; } catch (e) { return e.name; } })();
  }, { sessionEntries: [['s', '1']], quota: 100 });
  const R = f.win.R;
  eq(R.inst, true);
  eq(R.distinct, true);
  eq(R.s, '1');
  eq(R.localS, null);
  eq(R.keys, ['t', 'u']);
  eq(R.big, 'ok', 'no quota on sessionStorage');
  eq(f.rec.session, [['set', 't', '2'], ['remove', 's'], ['set', 'u', 'x'], ['set', 'big', 'z'.repeat(5000)]]);
  eq(f.rec.apply, []);
  realStorageEmpty();
});

within('a failing host never throws into the page', async () => {
  const pageId = 'shimthrow' + Date.now();
  const html = pageHtml((R) => {
    localStorage.setItem('a', '1');
    sessionStorage.setItem('b', '2');
    R.a = localStorage.getItem('a');
    R.ok = true;
  });
  const saved = window[HOST_GLOBAL].connect;
  window[HOST_GLOBAL].connect = (id) => (id !== pageId ? null : {
    entries: [], sessionEntries: [],
    apply() { throw new Error('host broke'); },
    applySession() { throw new Error('host broke'); },
    notify() { throw new Error('host broke'); },
  });
  try {
    const f = await load(html, { pageId, host: false });
    eq(f.win.R.ok, true);
    eq(f.win.R.a, '1');
  } finally {
    window[HOST_GLOBAL].connect = saved;
  }
});

function idbPage(R, value) {
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  let db;
  R.done = (async () => {
    const open = indexedDB.open('d', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('s');
    db = await req(open);
    R.name = db.name;
    R.version = db.version;
    const tx = db.transaction('s', 'readwrite');
    tx.objectStore('s').put(value, 'k');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const v3 = await req(indexedDB.open('v', 3));
    R.v3 = v3.version;
    v3.close();
    await req(indexedDB.deleteDatabase('v'));
    return true;
  })();
  R.read = async () => {
    const tx = db.transaction('s');
    const v = await req(tx.objectStore('s').get('k'));
    const list = await indexedDB.databases();
    return { v, list: list.map((d) => d.name + '@' + d.version) };
  };
  R.del = async () => {
    db.close();
    await req(indexedDB.deleteDatabase('d'));
    return (await indexedDB.databases()).map((d) => d.name);
  };
}

within('indexedDB: each page has its own databases under prefixed names', async () => {
  const a = await load(idbPage, { arg: 'from A' });
  await a.win.R.done;
  const b = await load(idbPage, { arg: 'from B' });
  await b.win.R.done;
  eq(a.win.R.name, 'd', 'db.name in A');
  eq(b.win.R.name, 'd', 'db.name in B');
  eq(a.win.R.version, 1);
  eq(a.win.R.v3, 3, 'version argument passed through');
  eq(await a.win.R.read(), { v: 'from A', list: ['d@1'] });
  eq(await b.win.R.read(), { v: 'from B', list: ['d@1'] });
  const real = (await indexedDB.databases()).map((d) => d.name);
  assert(real.includes(a.boot.dbPrefix + 'd'), 'A real name: ' + real);
  assert(real.includes(b.boot.dbPrefix + 'd'), 'B real name: ' + real);
  assert(!real.includes('d'), 'an unprefixed database exists');
  eq(await a.win.R.del(), [], 'A after deleting');
  eq(await b.win.R.read(), { v: 'from B', list: ['d@1'] }, 'B after A deleted');
  const after = (await indexedDB.databases()).map((d) => d.name);
  assert(!after.includes(a.boot.dbPrefix + 'd'), 'A still exists');
  assert(after.includes(b.boot.dbPrefix + 'd'), 'B gone');
  // The test window's own realm is untouched.
  const own = await new Promise((res, rej) => {
    const r = indexedDB.open('shimtest-own');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  eq(own.name, 'shimtest-own');
  own.close();
  await new Promise((r) => { const q = indexedDB.deleteDatabase('shimtest-own'); q.onsuccess = q.onerror = () => r(); });
});

within('no host: the page never runs', async () => {
  window.__shimNoHostRan = false;
  const body = '<!doctype html><html><head><script>parent.__shimNoHostRan = true; window.R = 1;</scr' + 'ipt></head>' +
    '<body onload="parent.__shimNoHostRan = true"><p>page text</p><script>parent.__shimNoHostRan = true;</scr' + 'ipt></body></html>';
  for (const opts of [{ host: false }, { host: false, hostGlobal: '__noSuchJunkDrawerHost' }]) {
    const f = await load(body, { ...opts, waitLoad: false });
    await until(() => {
      const d = f.frame.contentDocument;
      return d && d.body && d.body.textContent.includes('open this page from Junk Drawer');
    }, 4000, 'the no-host message');
    await delay(200);
    eq(window.__shimNoHostRan, false, 'page script ran');
    eq(f.win.R, undefined);
    assert(!f.frame.contentDocument.body.textContent.includes('page text'), 'page content shown');
  }
});

within('navigation: other sites and missing files are stopped, hashes are not', async () => {
  const f = await load((R) => {
    R.go = (u) => { setTimeout(() => { location.href = u; }, 0); };
  });
  const url = f.win.location.href;
  const win = f.win;
  win.R.go('https://example.test/');
  await until(() => f.rec.notify.some((n) => n[0] === 'external-nav'), 3000, 'external-nav');
  eq(f.rec.notify.find((n) => n[0] === 'external-nav')[1], { url: 'https://example.test/' });
  await delay(100);
  eq(f.win, win, 'same window');
  eq(f.win.location.href, url, 'still on the page');

  const missing = location.origin + '/tests/unit/no-such-file.html';
  win.R.go(missing);
  await until(() => f.rec.notify.some((n) => n[0] === 'missing-file'), 3000, 'missing-file');
  eq(f.rec.notify.find((n) => n[0] === 'missing-file')[1], { url: missing });
  await delay(100);
  eq(f.win.location.href, url, 'still on the page after missing-file');
  assert(f.win.R && typeof f.win.R.go === 'function', 'page state kept');

  const count = f.rec.notify.length;
  win.R.go('#here');
  await until(() => f.win.location.hash === '#here', 3000, 'the hash change');
  await delay(100);
  eq(f.rec.notify.length, count, 'hash change intercepted');
  assert(f.win.R && typeof f.win.R.go === 'function', 'page state kept after hash');
});
