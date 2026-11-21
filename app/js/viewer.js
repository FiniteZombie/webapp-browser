// The viewer: shows one stored page in an iframe under a top bar, and is the
// host the page shim and the service worker's error document call
// (contracts sections 5 and 7). Owns everything inside #viewer.

import {
  getPage, getFile, recordOpen, getLocalEntries, applyLocalOps,
} from './db.js';
import { reportError, showNotice, copyButton } from './ui.js';
import { EVENTS, HOST_GLOBAL, PAGE_PATH } from './config.js';
import { JdError, describe } from './errors.js';

const SW_WAIT_MS = 10_000;
const WATCHDOG_MS = 10_000;
const BUTTON_FALLBACK_MS = 500;
const BOOT_TRAVERSE_MS = 3000;

const SANDBOX = 'allow-same-origin allow-scripts allow-forms allow-modals allow-popups '
  + 'allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock '
  + 'allow-orientation-lock allow-presentation '
  + 'allow-top-navigation-to-custom-protocols';
const ALLOW = 'camera; microphone; geolocation; fullscreen; clipboard-read; clipboard-write; '
  + 'autoplay; accelerometer; gyroscope; magnetometer; screen-wake-lock; web-share';

let started = null;
let opening = false;
let current = null;      // the open page: see newSession()
let libraryKey = null;
let parts = null;        // { root, name, body }

// ---------- small helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const quote = (s) => `“${s}”`;
const changed = () => document.dispatchEvent(new CustomEvent(EVENTS.libraryChanged));

// ---------- saving a page's localStorage ----------

// One writer per page: while an applyLocalOps call is in flight, ops pile up
// and go in the next single call.
const writers = new Map();   // pageId -> { pending: [], inFlight: boolean }
let idleWaiters = [];

function isIdle() {
  for (const w of writers.values()) if (w.inFlight || w.pending.length) return false;
  return true;
}

function settleWaiters() {
  if (!isIdle()) return;
  const list = idleWaiters;
  idleWaiters = [];
  for (const resolve of list) resolve();
}

function queueOp(pageId, op) {
  let w = writers.get(pageId);
  if (!w) writers.set(pageId, (w = { pending: [], inFlight: false }));
  w.pending.push(op);
  flush(pageId);
}

function flush(pageId) {
  const w = writers.get(pageId);
  if (!w) return;
  if (w.inFlight) return;
  if (!w.pending.length) {
    writers.delete(pageId);
    settleWaiters();
    return;
  }
  const ops = w.pending;
  w.pending = [];
  w.inFlight = true;
  let p;
  try {
    p = Promise.resolve(applyLocalOps(pageId, ops));
  } catch (err) {
    p = Promise.reject(err);
  }
  p.catch(async (err) => {
    const s = current;
    if (s && s.id === pageId) {
      writeFailed(s, err);
      await resync(s, w);
    } else {
      console.error(err);
    }
  }).finally(() => {
    w.inFlight = false;
    flush(pageId);
  });
}

function replay(map, o) {
  if (o.op === 'set') map.set(o.key, o.value);
  else if (o.op === 'remove') map.delete(o.key);
  else if (o.op === 'clear') map.clear();
}

// After a batch was refused, the open page's Map must match the store again,
// so its own reloads (connect) don't see writes that are gone. Ops still
// waiting to be written are replayed on top, since they'll be tried next.
async function resync(s, w) {
  let entries;
  try {
    entries = await getLocalEntries(s.id);
  } catch (err) {
    console.error(err);
    return;
  }
  s.local.clear();
  for (const [k, v] of entries) s.local.set(k, v);
  for (const o of w.pending) replay(s.local, o);
}

export function whenSaved() {
  if (isIdle()) return Promise.resolve();
  return new Promise((resolve) => { idleWaiters.push(resolve); });
}

// ---------- notices for the open page ----------

function refused(s, api, cause, detail) {
  if (current !== s || s.refused.has(api)) return;
  s.refused.add(api);
  reportError(new JdError('store-refused', { cause, detail: detail || `api: ${api}` }), { page: s.page });
}

// A batch of localStorage writes was refused by the store: once per open, say
// that the recent changes weren't saved.
function writeFailed(s, cause) {
  if (current !== s || s.refused.has('localStorage-write')) return;
  s.refused.add('localStorage-write');
  const err = new JdError('store-refused', { cause, detail: 'api: localStorage (write to Junk Drawer’s store failed)' });
  const d = describe(err, { page: s.page });
  showNotice({
    ...d,
    body: `The phone refused to save the data for ${quote(s.page.name)}. Your recent changes in it weren’t saved and won’t be there the next time you open it.`,
    next: 'Free some space on the phone, then open the page again.',
  });
  console.error(err);
}

function onNotify(s, type, data) {
  if (type === 'ready') {
    s.ready = true;
    clearTimeout(s.watchdog);
    return;
  }
  if (current !== s) return;
  const d = data && typeof data === 'object' ? data : {};
  if (type === 'store-refused') {
    const api = d.api === 'indexedDB' ? 'indexedDB' : 'localStorage';
    refused(s, api, undefined, `api: ${api}${d.detail ? `\n${d.detail}` : ''}`);
  } else if (type === 'external-nav') {
    const url = String(d.url || '');
    showNotice({
      title: `${quote(s.page.name)} tried to go to another site`,
      body: url,
      actions: url ? [{ label: 'open in browser', href: url }] : [],
    });
  } else if (type === 'missing-file') {
    const url = String(d.url || '');
    let path = url;
    try { path = new URL(url).pathname; } catch { /* keep the text */ }
    if (s.missingFiles.has(path)) return;
    s.missingFiles.add(path);
    let fileName = path.split('/').filter(Boolean).pop() || path;
    try { fileName = decodeURIComponent(fileName); } catch { /* keep it encoded */ }
    showNotice({
      title: `${quote(s.page.name)} links to a file that was beside it, which Junk Drawer doesn’t have`,
      body: fileName,
    });
  }
}

// ---------- the host object ----------

function connect(pageId) {
  const s = current;
  if (!s || s.id !== pageId) return null;
  return {
    entries: [...s.local],
    sessionEntries: [...s.session],
    apply(op, key, value) {
      try {
        if (op === 'set') {
          key = String(key); value = String(value);
          s.local.set(key, value);
          queueOp(s.id, { op, key, value });
        } else if (op === 'remove') {
          key = String(key);
          s.local.delete(key);
          queueOp(s.id, { op, key });
        } else if (op === 'clear') {
          s.local.clear();
          queueOp(s.id, { op });
        }
      } catch (err) {
        try { console.error(err); } catch { /* never throw into the page */ }
      }
    },
    applySession(op, key, value) {
      try {
        if (op === 'set') s.session.set(String(key), String(value));
        else if (op === 'remove') s.session.delete(String(key));
        else if (op === 'clear') s.session.clear();
      } catch { /* never throw into the page */ }
    },
    notify(type, data) {
      try { onNotify(s, type, data); } catch (err) {
        try { console.error(err); } catch { /* never throw into the page */ }
      }
    },
  };
}

function pageError(pageId, code, detail) {
  const s = current;
  if (!s || s.id !== pageId) return;
  showError(s, new JdError(String(code), { detail }));
}

// ---------- layout ----------

function build() {
  const root = document.getElementById('viewer');
  root.replaceChildren();
  const bar = el('header', 'view-bar');
  const name = el('h1', 'view-name');
  const back = el('button', 'ui-btn view-library', 'library');
  back.type = 'button';
  back.addEventListener('click', toLibrary);
  const exportBtn = el('button', 'ui-btn view-export', 'export');
  exportBtn.type = 'button';
  exportBtn.setAttribute('aria-label', 'export page');
  exportBtn.addEventListener('click', () => {
    if (!current) return;
    document.dispatchEvent(new CustomEvent(EVENTS.exportPage, { detail: { id: current.id } }));
  });
  bar.append(name, exportBtn, back);
  const body = el('div', 'view-body');
  root.append(bar, body);
  return { root, name, body };
}

function showError(s, err) {
  if (current !== s || s.errorShown) return;
  s.errorShown = true;
  clearTimeout(s.watchdog);
  if (s.frame) { s.frame.remove(); s.frame = null; }
  const { title, body, next, detail } = describe(err, { page: s.page });
  const panel = el('div', 'view-error');
  panel.setAttribute('role', 'alert');
  panel.appendChild(el('h2', 'ui-title', title));
  if (body) panel.appendChild(el('p', 'ui-text', body));
  if (next) panel.appendChild(el('p', 'ui-text ui-next', next));
  const row = el('div', 'ui-row-buttons');
  row.appendChild(copyButton({ label: 'copy details', getText: () => detail }));
  panel.appendChild(row);
  parts.body.replaceChildren(panel);
  console.error(err);
}

// ---------- opening ----------

async function waitForWorker() {
  const sw = navigator.serviceWorker;
  if (!sw) throw new JdError('sw-failed', { detail: 'no navigator.serviceWorker' });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new JdError('sw-failed', {
      detail: `no controlling service worker within ${SW_WAIT_MS} ms`,
    })), SW_WAIT_MS);
  });
  try {
    await Promise.race([(async () => {
      await sw.ready;
      if (sw.controller) return;
      await new Promise((resolve) => {
        sw.addEventListener('controllerchange', resolve, { once: true });
        if (sw.controller) resolve();
      });
    })(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function openPage(id) {
  if (opening || current) return;
  opening = true;
  let s = null;
  try {
    const page = await getPage(id);
    if (!page) {
      reportError(new JdError('page-missing', { detail: `no page with id ${id}` }), { page: { id } });
      return;
    }
    await whenSaved();
    const entries = await getLocalEntries(id);
    s = {
      id,
      page: { id: page.id, name: page.name },
      local: new Map(entries),
      session: new Map(),
      frame: null,
      ready: false,
      errorShown: false,
      watchdog: null,
      refused: new Set(),
      missingFiles: new Set(),
    };

    libraryKey = window.navigation?.currentEntry?.key ?? null;
    history.pushState({ jd: 'view', pageId: id }, '');
    current = s;
    opening = false;
    parts.name.textContent = page.name;
    parts.name.title = page.name;
    parts.body.replaceChildren();
    parts.root.hidden = false;
    document.getElementById('library')?.setAttribute('inert', '');

    try {
      await waitForWorker();
    } catch (err) {
      showError(s, err instanceof JdError ? err : new JdError('sw-failed', { cause: err }));
      return;
    }
    if (current !== s) return;

    const file = await getFile(id);
    if (current !== s) return;
    if (!file) {
      showError(s, new JdError('page-missing', { detail: 'no stored file' }));
      return;
    }

    try {
      await recordOpen(id);
      changed();
    } catch (err) {
      reportError(err, { page: s.page });
    }
    if (current !== s || s.errorShown) return;

    const frame = document.createElement('iframe');
    frame.className = 'view-frame';
    frame.setAttribute('sandbox', SANDBOX);
    frame.setAttribute('allow', ALLOW);
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('title', page.name);
    frame.src = `${PAGE_PATH}${encodeURIComponent(id)}/`;
    frame.addEventListener('load', () => {
      if (current === s && !s.ready) showError(s, new JdError('page-unreadable', { detail: 'the page loaded without Junk Drawer’s script' }));
    });
    s.frame = frame;
    s.watchdog = setTimeout(() => {
      if (current === s && !s.ready) showError(s, new JdError('page-unreadable', { detail: `the page didn’t start within ${WATCHDOG_MS} ms` }));
    }, WATCHDOG_MS);
    parts.body.appendChild(frame);
  } catch (err) {
    if (s && current === s) showError(s, err);
    else reportError(err, s ? { page: s.page } : undefined);
  } finally {
    opening = false;
  }
}

export function isViewerOpen() {
  return opening || current !== null;
}

// ---------- closing ----------

function close() {
  const s = current;
  if (!s) return;
  clearTimeout(s.watchdog);
  if (s.frame) s.frame.remove();
  s.frame = null;
  s.session.clear();
  current = null;
  parts.body.replaceChildren();
  parts.name.textContent = '';
  parts.root.hidden = true;
  document.getElementById('library')?.removeAttribute('inert');
  document.dispatchEvent(new CustomEvent(EVENTS.viewerClosed));
}

function closeDirectly() {
  close();
  history.replaceState({ jd: 'library' }, '');
}

// True when the library entry is the top-level entry just before this one.
// (history.go counts the removed iframe's entries too, so it can't be used.)
function libraryIsJustBehind(key) {
  const nav = window.navigation;
  if (!key || !nav || !nav.currentEntry || typeof nav.entries !== 'function') return false;
  const here = nav.currentEntry.index;
  return here > 0 && nav.entries()[here - 1]?.key === key;
}

function toLibrary() {
  if (!current) return;
  const s = current;
  const key = libraryKey;
  const nav = window.navigation;
  let done = false;
  // rejected: the traverse failed, so nothing else will move history. Then,
  // after closing, step back over the view entry to the library entry so no
  // extra entry is left. Not after the timeout: the traverse may still land,
  // and a second step could leave the app.
  const fallback = (rejected) => {
    if (done) return;
    done = true;
    if (current !== s) return;
    closeDirectly();
    if (!rejected || !libraryIsJustBehind(key)) return;
    // If this fails too, the view entry stays behind as a library entry.
    try {
      const r = nav.back();
      for (const p of [r?.committed, r?.finished]) if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* see above */ }
  };
  const onReject = () => fallback(true);
  setTimeout(() => fallback(false), BUTTON_FALLBACK_MS);
  if (!nav || typeof nav.traverseTo !== 'function') {
    history.back();
    return;
  }
  try {
    if (!key) throw new Error('no library entry key');
    const r = nav.traverseTo(key);
    const finished = r && typeof r === 'object' && 'finished' in r ? r.finished : r;
    if (r && typeof r === 'object' && r.committed) r.committed.catch(onReject);
    Promise.resolve(finished).catch(onReject);
  } catch {
    onReject();
  }
}

function onPopState(e) {
  const jd = e.state && e.state.jd;
  if (jd === 'library') {
    if (current) close();
  } else if (jd === 'view') {
    if (!current && !opening) history.back();
  }
}

// ---------- start ----------

async function bootHistory() {
  const nav = window.navigation;
  if (!(history.state && history.state.jd === 'view')) {
    history.replaceState({ jd: 'library' }, '');
    return;
  }
  if (!nav || !nav.currentEntry) {
    history.back();
    return;
  }
  const i = nav.currentEntry.index;
  if (i > 0) {
    try {
      const r = nav.traverseTo(nav.entries()[i - 1].key);
      let timer;
      await Promise.race([
        Promise.resolve(r && r.finished ? r.finished : r),
        new Promise((resolve) => { timer = setTimeout(resolve, BOOT_TRAVERSE_MS); }),
      ]).finally(() => clearTimeout(timer));
    } catch { /* checked below */ }
    if (!(history.state && history.state.jd === 'library')) history.replaceState({ jd: 'library' }, '');
  } else {
    history.replaceState({ jd: 'library' }, '');
  }
}

async function start() {
  parts = build();
  parts.root.hidden = true;
  window[HOST_GLOBAL] = { connect, pageError };
  window.addEventListener('popstate', onPopState);
  await bootHistory();
}

export function initViewer() {
  if (!started) started = start();
  return started;
}
