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

  return pickWithInput();
}

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.hidden = true;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      finish(file ? { file, handle: null } : null);
    });
    input.addEventListener('cancel', () => finish(null));
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
