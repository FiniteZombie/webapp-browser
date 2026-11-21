// Export library, import library, export page: the asking and the
// reporting around backup.js. Each flow is run by app.js (one flow at a
// time, no update reload meanwhile).

import { EVENTS } from './config.js';
import { JdError } from './errors.js';
import * as db from './db.js';
import { buildBackup, readBackup, restoreBackup } from './backup.js';
import { pickBackup } from './picker.js';
import {
  actionSheet, choiceDialog, confirmDialog, messageDialog, reportError, showNotice,
} from './ui.js';

const SPACE_MARGIN = 1_000_000;
const REVOKE_MS = 60_000;

const quote = (s) => `“${s}”`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const changed = () => document.dispatchEvent(new CustomEvent(EVENTS.libraryChanged));

function sizeText(bytes) {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

// ---------- getting a file out: share sheet or Downloads ----------

function canShare(file) {
  try {
    return typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function download(file) {
  const seam = globalThis.__jdTest?.download;
  if (typeof seam === 'function') { seam(file); return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

// Call straight from a tap: the share sheet needs it. If the share sheet
// won't open, the file goes to Downloads instead and a notice says so.
async function share(file, title) {
  try {
    await navigator.share({ files: [file], title });
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // the owner closed the share sheet
    download(file);
    showNotice({
      title: 'Saved to Downloads instead',
      body: `The share sheet didn’t open, so ${quote(file.name)} was saved to Downloads.`,
    });
    console.error(err);
  }
}

// ---------- export library ----------

export async function exportLibraryFlow() {
  const working = showNotice({ title: 'Making the backup…' });
  let built;
  try {
    built = await buildBackup();
  } finally {
    working.dismiss();
  }
  const { blob, fileName, pageCount, skipped } = built;
  const file = new File([blob], fileName, { type: 'application/zip' });
  const shareable = canShare(file);

  const lines = skipped.map((s) => `${quote(s.pageName)}: ${s.what}`);
  const choice = await choiceDialog({
    title: 'backup ready',
    body: `${plural(pageCount, 'page')}, ${sizeText(file.size)}.`
      + (lines.length ? ' Some saved data couldn’t go in the backup and was left out:' : ''),
    list: lines,
    choices: [
      ...(shareable ? [{ id: 'share', label: 'share…' }] : []),
      { id: 'download', label: 'save to downloads' },
    ],
  });
  if (choice === 'share') await share(file, 'Junk Drawer backup');
  else if (choice === 'download') download(file);
  return { status: choice ? 'exported' : 'cancelled', fileName };
}

// ---------- import library ----------

async function checkSpace(byteLength) {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.estimate !== 'function') return;
  let est;
  try {
    est = await storage.estimate();
  } catch {
    return;
  }
  const quota = Number(est?.quota);
  const usage = Number(est?.usage) || 0;
  if (!Number.isFinite(quota)) return;
  if (quota - usage < byteLength + SPACE_MARGIN) {
    throw new JdError('storage-full', { detail: `quota: ${quota}, usage: ${usage}, needed: ${byteLength}` });
  }
}

export async function importLibraryFlow() {
  let picked;
  try {
    picked = await pickBackup();
  } catch (err) {
    reportError(err, {});
    return { status: 'refused' };
  }
  if (!picked || !picked.file) return { status: 'cancelled' };
  const ctx = { file: picked.file };
  try {
    return await runImport(picked.file);
  } catch (err) {
    reportError(err, ctx);
    return { status: 'refused' };
  }
}

async function runImport(file) {
  const backup = await readBackup(file);
  if (!backup.pages.length) {
    await messageDialog({
      title: 'nothing to import',
      body: `${quote(file.name)} has no pages in it. Nothing was changed.`,
    });
    return { status: 'cancelled' };
  }

  const here = new Set((await db.listPages()).map((p) => p.id));
  const replacing = backup.pages.filter((p) => here.has(p.record.id)).length;
  const adding = backup.pages.length - replacing;
  const parts = [];
  if (replacing) parts.push(`${plural(replacing, 'page')} will replace the same ${replacing === 1 ? 'page' : 'pages'} already here, saved data included.`);
  if (adding) parts.push(`${plural(adding, 'page')} will be added.`);
  if (here.size) parts.push('Pages that aren’t in the backup stay as they are.');
  const ok = await confirmDialog({
    title: 'import this backup?',
    body: `${quote(file.name)} has ${plural(backup.pages.length, 'page')}. ${parts.join(' ')}`,
    confirmLabel: 'import',
    cancelLabel: 'cancel',
    danger: replacing > 0,
  });
  if (!ok) return { status: 'cancelled' };

  await checkSpace(backup.totalBytes);
  let problems;
  try {
    ({ problems } = await restoreBackup(backup));
  } finally {
    changed();
  }
  try {
    const p = navigator.storage?.persist?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* the library reports persistence */ }

  const notes = [
    ...backup.unreadable.map((name) => `${quote(name)}: its HTML file is missing from the zip, so it wasn’t imported`),
    ...backup.skipped.map((s) => `${quote(s.pageName)}: ${s.what} (left out when the backup was made)`),
    ...problems,
  ];
  const counts = [];
  if (replacing) counts.push(`${replacing} replaced`);
  if (adding) counts.push(`${adding} added`);
  await messageDialog({
    title: `imported ${plural(backup.pages.length, 'page')}`,
    body: `${counts.join(', ')}.${notes.length ? ' Not everything came across:' : ''}`,
    list: notes,
  });
  return { status: 'imported', replaced: replacing, added: adding };
}

// ---------- export page ----------

export async function exportPageFlow(pageId) {
  const page = await db.getPage(pageId);
  const stored = page ? await db.getFile(pageId) : undefined;
  if (!page || !stored) {
    reportError(new JdError('page-missing', { detail: `export: page id ${pageId}` }), { page: { id: pageId, name: page?.name } });
    return { status: 'refused' };
  }
  const fileName = page.fileName || `${page.name}.html`;
  const file = new File([stored.bytes], fileName, { type: 'text/html' });
  if (!canShare(file)) {
    download(file);
    return { status: 'exported' };
  }
  const choice = await actionSheet({
    title: `export ${quote(page.name)}`,
    actions: [
      { id: 'share', label: 'share…' },
      { id: 'download', label: 'save to downloads' },
    ],
  });
  if (choice === 'share') await share(file, page.name);
  else if (choice === 'download') download(file);
  return { status: choice ? 'exported' : 'cancelled' };
}
