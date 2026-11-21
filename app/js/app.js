// Boot, wiring, persistent storage and updates (WP11). Exports nothing; sets
// window.__jdReady = true once boot has finished.

import { EVENTS } from './config.js';
import { JdError } from './errors.js';
import { reportError, hasOpenUi } from './ui.js';
import { initLibrary } from './library.js';
import { initViewer, openPage, isViewerOpen, whenSaved } from './viewer.js';
import { addPageFlow, replaceFlow } from './add-flow.js';
import { exportLibraryFlow, importLibraryFlow, exportPageFlow } from './backup-flow.js';

const UPDATE_CHECK_MS = 60_000;
const AFTER_CHANGE_MS = 2000;

let flowsInFlight = 0;
let hadController = false;
let updatePending = false;
let applying = false;
let reloaded = false;
let registration = null;
let lastCheck = 0;
let changeTimer = null;

const fire = (name) => document.dispatchEvent(new CustomEvent(name));

// ---------- 1. nothing fails silently ----------

function listenForErrors() {
  window.addEventListener('error', (e) => {
    reportError(e.error || new Error(e.message || 'script error'), {});
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason === undefined ? new Error('unhandled rejection') : e.reason, {});
  });
}

// ---------- 3. events ----------

function runFlow(fn) {
  if (flowsInFlight > 0) return;
  flowsInFlight++;
  let p;
  try {
    p = Promise.resolve(fn());
  } catch (err) {
    p = Promise.reject(err);
  }
  p.catch((err) => reportError(err, {})).finally(() => {
    flowsInFlight--;
    tryApplyUpdate();
  });
}

function wireEvents() {
  document.addEventListener(EVENTS.addPage, () => runFlow(() => addPageFlow()));
  document.addEventListener(EVENTS.replaceFile, (e) => {
    const id = e.detail.id;
    runFlow(() => replaceFlow(id));
  });
  document.addEventListener(EVENTS.exportLibrary, () => runFlow(() => exportLibraryFlow()));
  document.addEventListener(EVENTS.importLibrary, () => runFlow(() => importLibraryFlow()));
  document.addEventListener(EVENTS.exportPage, (e) => {
    const id = e.detail.id;
    runFlow(() => exportPageFlow(id));
  });
  document.addEventListener(EVENTS.openPage, (e) => {
    const id = e.detail.id;
    openPage(id).catch((err) => reportError(err, {}));
  });
  document.addEventListener(EVENTS.viewerClosed, () => tryApplyUpdate());
  document.addEventListener(EVENTS.libraryChanged, () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(tryApplyUpdate, AFTER_CHANGE_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkForUpdate();
    tryApplyUpdate();
  });
}

// ---------- 4. service worker and updates ----------

const isSafe = () => !isViewerOpen() && !hasOpenUi() && flowsInFlight === 0;

function whenActivated() {
  const c = navigator.serviceWorker.controller;
  if (!c || c.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (c.state === 'activated' || c.state === 'redundant') {
        c.removeEventListener('statechange', done);
        resolve();
      }
    };
    c.addEventListener('statechange', done);
    done();
  });
}

async function tryApplyUpdate() {
  if (!updatePending || applying || reloaded || !isSafe()) return;
  applying = true;
  try {
    await whenActivated();
    await whenSaved();
    if (!isSafe() || reloaded) return;
    reloaded = true;
    location.reload();
  } finally {
    applying = false;
  }
}

function checkForUpdate() {
  if (!registration) return;
  const now = Date.now();
  if (now - lastCheck < UPDATE_CHECK_MS) return;
  lastCheck = now;
  try {
    Promise.resolve(registration.update()).catch(() => {});
  } catch {
    // ignored: the next check tries again
  }
}

// The first worker failing to install leaves no page able to open.
function watchFirstInstall(reg) {
  const watch = (w) => {
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'redundant' && !hadController && !navigator.serviceWorker.controller) {
        reportError(new JdError('sw-failed', {
          detail: 'the first service worker became redundant while installing',
        }), {});
      }
    });
  };
  watch(reg.installing);
  reg.addEventListener('updatefound', () => {
    if (!hadController && !navigator.serviceWorker.controller) watch(reg.installing);
  });
}

function startServiceWorker() {
  const sw = navigator.serviceWorker;
  if (!sw) {
    reportError(new JdError('sw-failed', { detail: 'navigator.serviceWorker is missing' }), {});
    return;
  }
  hadController = Boolean(sw.controller);
  sw.addEventListener('controllerchange', async () => {
    if (hadController) {
      updatePending = true;
      tryApplyUpdate();
      return;
    }
    hadController = true;
    await whenActivated();
    fire(EVENTS.libraryChanged);
  });
  let reg;
  try {
    reg = sw.register('sw.js', { type: 'module', updateViaCache: 'none' });
  } catch (cause) {
    reg = Promise.reject(cause);
  }
  reg.then((r) => {
    registration = r;
    if (!hadController) watchFirstInstall(r);
    checkForUpdate();
  }, (cause) => {
    reportError(new JdError('sw-failed', { cause }), {});
  });
}

// ---------- 5. persistent storage ----------

async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    // a refusal shows as the library's storage warning
  }
  fire(EVENTS.libraryChanged);
}

// ---------- boot ----------

async function boot() {
  listenForErrors();
  await initViewer();
  await initLibrary();
  wireEvents();
  startServiceWorker();
  await askPersist();
  window.__jdReady = true;
}

if (globalThis.__jdTest?.noBoot) {
  window.__jdReady = true;
} else {
  boot().catch((err) => reportError(err, {}));
}
