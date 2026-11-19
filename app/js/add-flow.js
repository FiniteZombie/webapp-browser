// Adding a page and replacing a page's file: check, ask, store, then the
// "added" sheet. ingest() takes any { file, handle } (a share target will
// call it later), so nothing in it assumes the file came from a picker.

import { EVENTS, SETTINGS } from './config.js';
import { JdError } from './errors.js';
import { checkFile } from './html-check.js';
import { allTags, fileStem, findSameName, parseTags } from './model.js';
import * as db from './db.js';
import { addedSheet, choiceDialog, detailsDialog, reportError } from './ui.js';
import { canDeleteOriginal, deleteOriginal, pickFile } from './picker.js';

const MAX_REPLACE_CHOICES = 3;
const SPACE_MARGIN = 1_000_000;

const quote = (s) => `“${s}”`;
const fire = (name, detail) => document.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));

export async function addPageFlow() {
  const picked = await pick();
  if (picked.status) return picked;
  return ingest(picked, { mode: 'add' });
}

export async function replaceFlow(pageId) {
  const picked = await pick();
  if (picked.status) return picked;
  return ingest(picked, { mode: 'replace', pageId });
}

async function pick() {
  let picked;
  try {
    picked = await pickFile();
  } catch (err) {
    reportError(err, {});
    return { status: 'refused' };
  }
  if (!picked || !picked.file) return { status: 'cancelled' };
  return picked;
}

export async function ingest({ file, handle = null } = {}, opts = { mode: 'add' }) {
  const ctx = { file };
  try {
    return await run(file, handle, opts, ctx);
  } catch (err) {
    reportError(err, ctx);
    return { status: 'refused' };
  }
}

async function run(file, handle, opts, ctx) {
  let mode = opts?.mode === 'replace' ? 'replace' : 'add';
  let target = null;   // the PageRecord being replaced

  if (mode === 'replace') {
    target = await db.getPage(opts.pageId);
    if (!target) throw new JdError('page-missing', { detail: `page id: ${opts.pageId}` });
    ctx.page = { id: target.id, name: target.name };
  }

  // 1. Check. Nothing is written before this passes.
  const checked = await checkFile(file);
  const { bytes, charset, title, siblingRefs } = checked;

  // 2. Files that sat beside the page.
  if (siblingRefs && siblingRefs.length) {
    const choice = await choiceDialog({
      title: 'this page refers to other files',
      body: 'It refers to files that were beside it when it was downloaded. Junk Drawer doesn’t have them, so the page may not work.',
      list: siblingRefs,
      choices: [{ id: 'add', label: 'add anyway' }],
    });
    if (choice !== 'add') return { status: 'cancelled' };
  }

  const candidate = title || fileStem(file.name) || file.name;
  let name = candidate;
  let tags = [];

  if (mode === 'add') {
    const pages = await db.listPages();

    // 3. Same name.
    const matches = findSameName(pages, { name: candidate, fileName: file.name }).slice(0, MAX_REPLACE_CHOICES);
    if (matches.length) {
      const choice = await choiceDialog({
        title: 'already in the library',
        body: matches.length === 1
          ? `A page called ${quote(matches[0].name)} is already in the library. Replace its file with this one, or add this as a new page?`
          : 'Pages with this name are already in the library. Replace one of their files with this one, or add this as a new page?',
        choices: [
          ...matches.map((p) => ({ id: `replace:${p.id}`, label: `replace ${quote(p.name)}` })),
          { id: 'new', label: 'add as a new page' },
        ],
      });
      if (choice == null) return { status: 'cancelled' };
      if (choice.startsWith('replace:')) {
        target = matches.find((p) => `replace:${p.id}` === choice);
        mode = 'replace';
        ctx.page = { id: target.id, name: target.name };
      }
    }

    // 4. Details.
    if (mode === 'add') {
      const details = await detailsDialog({
        title: 'add a page',
        name: candidate,
        tags: [],
        allTags: allTags(pages),
        submitLabel: 'add',
      });
      if (!details) return { status: 'cancelled' };
      name = String(details.name ?? '').trim() || candidate;
      tags = parseTags(details.tags ?? []);
    }
  }

  // 5. Space.
  await checkSpace(bytes.byteLength);

  // 6. Write: addPage and replaceFile are each one transaction.
  let record;
  if (mode === 'add') {
    record = await db.addPage({ name, fileName: file.name, tags, bytes, charset });
  } else {
    record = await db.replaceFile(target.id, { fileName: file.name, bytes, charset });
  }
  const pageId = record.id;
  const shownName = mode === 'add' ? record.name : target.name;

  // 7.
  askPersist();
  fire(EVENTS.libraryChanged);

  // 8. The added sheet. A failure from here on never undoes the write.
  await afterSheet({ mode, pageId, shownName, handle, ctx });

  return { status: mode === 'add' ? 'added' : 'replaced', pageId };
}

async function checkSpace(byteLength) {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.estimate !== 'function') return;
  let est;
  try {
    est = await storage.estimate();
  } catch {
    return;   // no answer: let the write itself say if space runs out
  }
  const quota = Number(est?.quota);
  const usage = Number(est?.usage) || 0;
  if (!Number.isFinite(quota)) return;
  if (quota - usage < byteLength + SPACE_MARGIN) {
    throw new JdError('storage-full', { detail: `quota: ${quota}, usage: ${usage}, needed: ${byteLength}` });
  }
}

function askPersist() {
  try {
    const p = globalThis.navigator?.storage?.persist?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // nothing to do: the library reports persistence separately
  }
}

async function afterSheet({ mode, pageId, shownName, handle, ctx }) {
  let canDelete = false;
  let deleteDefault = false;
  try {
    canDelete = await canDeleteOriginal(handle);
    if (canDelete) deleteDefault = (await db.getSetting(SETTINGS.deleteLast, false)) === true;
  } catch (err) {
    console.error(err);
    canDelete = false;
  }

  const answer = await addedSheet({
    title: mode === 'add' ? `added ${quote(shownName)}` : `replaced the file for ${quote(shownName)}`,
    canDelete,
    deleteDefault,
  });
  if (!answer) return;   // dismissed: delete nothing, open nothing, remember nothing

  // Start the delete first, while the tap still counts for the permission prompt.
  // It resolves to the error, if any, so no rejection goes unhandled meanwhile.
  const deleting = canDelete && answer.deleteOriginal
    ? deleteOriginal(handle).then(() => null, (err) => err ?? new Error('delete failed'))
    : null;

  if (canDelete) {
    try {
      await db.setSetting(SETTINGS.deleteLast, Boolean(answer.deleteOriginal));
    } catch (err) {
      console.error(err);
    }
  }

  if (deleting) {
    const err = await deleting;
    if (err) reportError(err, { file: ctx.file });
  }

  if (answer.open) fire(EVENTS.openPage, { id: pageId });
}
