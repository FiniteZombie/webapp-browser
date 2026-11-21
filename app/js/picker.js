// Getting a file from the owner, and deleting the downloaded original.
// Deleting in Downloads is unproven on the owner's phone, so everything here
// detects, tries and falls back. Nothing assumes the picked file is HTML:
// Chrome on Android may ignore the type filter; checkFile decides.

import { EVENTS, SETTINGS } from './config.js';
import { JdError } from './errors.js';
import { getSetting, setSetting } from './db.js';

const PICKER_OPTIONS = {
  multiple: false,
  excludeAcceptAllOption: false,
  types: [{ description: 'HTML pages', accept: { 'text/html': ['.html', '.htm'] } }],
};

// Errors that say nothing about whether the full picker works (a double tap
// gives NotAllowedError), so they never latch fsaBroken.
const TRANSIENT = new Set(['NotAllowedError', 'SecurityError']);

function libraryChanged() {
  document.dispatchEvent(new CustomEvent(EVENTS.libraryChanged));
}

async function safeSet(key, value) {
  try { await setSetting(key, value); } catch (e) { console.error(e); }
}

export async function pickFile() {
  const seam = globalThis.__jdTest?.pickFile;
  if (typeof seam === 'function') return seam();

  if (typeof window.showOpenFilePicker === 'function' && (await getSetting(SETTINGS.fsaBroken, false)) !== true) {
    try {
      const [handle] = await window.showOpenFilePicker(PICKER_OPTIONS);
      if (!handle) return null;
      const file = await handle.getFile();
      return { file, handle };
    } catch (cause) {
      if (cause?.name === 'AbortError') return null;
      await safeSet(SETTINGS.pickerLastError, `${cause?.name ?? 'Error'}: ${cause?.message ?? String(cause)}`);
      if (!TRANSIENT.has(cause?.name)) {
        await safeSet(SETTINGS.fsaBroken, true);
        libraryChanged();
      }
      throw new JdError('picker-failed', { cause });
    }
  }

  return pickWithInput(HTML_ACCEPT);
}

// Picking a backup zip: always the plain file input, which on Android also
// offers Drive and other apps' files. Resolves to { file, handle: null } or
// null when cancelled. Tests use the same seam as pickFile.
export async function pickBackup() {
  const seam = globalThis.__jdTest?.pickFile;
  if (typeof seam === 'function') return seam();
  return pickWithInput(ZIP_ACCEPT);
}

// How long after the page gets focus back (or becomes visible) a pick with no
// file counts as cancelled. Chrome fires `cancel` on the input, but some
// Android versions close the chooser without it; `change` can also arrive a
// moment after focus, hence the wait.
const RETURN_GRACE_MS = 1500;
const HTML_ACCEPT = '.html,.htm,text/html';
const ZIP_ACCEPT = '.zip,application/zip,application/x-zip-compressed';

function pickWithInput(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    let done = false;
    let timer = 0;
    const chosen = () => {
      const file = input.files && input.files[0];
      return file ? { file, handle: null } : null;
    };
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      input.remove();
      resolve(value);
    };
    // Never stay pending: a pending pick would hold the app's flow lock (no
    // add, no update) for the rest of the session.
    function onReturn() {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => finish(chosen()), RETURN_GRACE_MS);
    }
    input.addEventListener('change', () => finish(chosen()));
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    document.body.appendChild(input);
    input.click();
  });
}

export async function canDeleteOriginal(handle) {
  if (!handle || typeof handle.remove !== 'function') return false;
  return (await getSetting(SETTINGS.deleteBroken, false)) !== true;
}

// Call straight from the tap handler: the permission prompt needs the tap.
export async function deleteOriginal(handle) {
  if (typeof handle?.requestPermission === 'function') {
    let state;
    try {
      state = await handle.requestPermission({ mode: 'readwrite' });
    } catch (cause) {
      if (cause?.name === 'NotAllowedError') throw new JdError('delete-denied', { cause });
      return broken(cause);
    }
    if (state !== 'granted') throw new JdError('delete-denied', { detail: `permission: ${state}` });
  }
  try {
    await handle.remove();
  } catch (cause) {
    return broken(cause);
  }
}

// Deleting failed for a reason other than the owner saying no: stop offering
// it on this phone (the library footer can turn it back on).
async function broken(cause) {
  await safeSet(SETTINGS.deleteBroken, true);
  libraryChanged();
  throw new JdError('delete-failed', { cause });
}
