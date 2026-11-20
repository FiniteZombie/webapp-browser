// JdError, the owner-facing message catalogue and the environment detail.
// Also loads in the service worker (db.js imports it): nothing at the top
// level may touch window, document or navigator.storage.

import { BUILD_PATH, SETTINGS } from './config.js';

export class JdError extends Error {
  code;
  cause;
  detail;

  constructor(code, { cause, detail } = {}) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'JdError';
    this.code = code;
    this.cause = cause;
    this.detail = detail;
  }
}

const quote = (s) => `“${s}”`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Each entry: (names) -> { title, body, next }. names.file / names.page are
// the quoted name, or a plain fallback ("this file", "this page").
const CATALOGUE = {
  'wrong-type': ({ file }) => ({
    title: 'Not an HTML file',
    body: `${cap(file)} isn’t an HTML file. Junk Drawer takes .html or .htm files.`,
    next: 'Pick an .html or .htm file instead.',
  }),
  mhtml: ({ file }) => ({
    title: 'Web archive (MHTML)',
    body: `${cap(file)} is a web archive (MHTML), which Junk Drawer can’t use.`,
    next: 'Download or save the page as HTML instead, then add that file.',
  }),
  unreadable: ({ file }) => ({
    title: 'Couldn’t read the file',
    body: `The phone wouldn’t let Junk Drawer read ${file}.`,
    next: 'Try picking it again.',
  }),
  empty: ({ file }) => ({
    title: 'Empty file',
    body: `${cap(file)} is empty.`,
    next: 'Check that you picked the right file.',
  }),
  'not-html': ({ file }) => ({
    title: 'Not a web page',
    body: `${cap(file)} is named like a web page, but what’s inside isn’t HTML.`,
    next: 'Check that you picked the right file.',
  }),
  'storage-full': ({ subject }) => ({
    title: 'Not enough storage',
    body: `There isn’t enough storage left on this phone to keep a copy of ${subject}. Nothing was changed.`,
    next: 'Free some space and try again.',
  }),
  // Two callers: the viewer (ctx.page, no file) when a page's stored copy is
  // gone, and add-flow (ctx.file, no page) when the page being replaced was
  // removed meanwhile, so there is nothing to replace into.
  'page-missing': ({ page, file, hasFile, hasPage }) => (hasFile && !hasPage ? {
    title: 'Page no longer there',
    body: `The page you were replacing is no longer in Junk Drawer, so ${file} wasn’t added. Nothing was changed.`,
    next: 'Go back to the library and add it as a new page if you still want it.',
  } : {
    title: 'Page copy missing',
    body: `Junk Drawer’s copy of ${page} is missing. Its saved data is still there.`,
    next: 'Replace its file from the library to get it back.',
  }),
  'page-unreadable': ({ page }) => ({
    title: 'Couldn’t load the page',
    body: `Junk Drawer couldn’t load its copy of ${page}.`,
    next: 'Go back and open it again.',
  }),
  'store-refused': ({ page }) => ({
    title: 'Data not saved',
    body: `The phone refused to save the data for ${page}. What you just did in the page may not be remembered.`,
    next: 'Free some space on the phone.',
  }),
  'delete-failed': ({ file }) => ({
    title: 'Downloaded file not deleted',
    body: `The downloaded file ${file} is still on the phone. Junk Drawer couldn’t delete it and won’t offer to again on this phone. The page itself is safely saved in Junk Drawer.`,
    next: 'The footer of the library can turn the offer back on.',
  }),
  'delete-denied': ({ file }) => ({
    title: 'Downloaded file not deleted',
    body: `The downloaded file ${file} is still on the phone because permission to delete it wasn’t given. The page itself is safely saved in Junk Drawer.`,
    next: '',
  }),
  'picker-failed': () => ({
    title: 'File picker didn’t open',
    body: 'The file picker didn’t open.',
    next: 'Tap “add new page” again.',
  }),
  'sw-failed': () => ({
    title: 'Couldn’t set up offline use',
    body: 'Junk Drawer couldn’t set itself up to work offline and open pages.',
    next: 'Close Junk Drawer and open it again while connected to the internet.',
  }),
  unexpected: ({ about }) => ({
    title: 'Something went wrong',
    body: `Something went wrong inside Junk Drawer${about ? ` while working on ${about}` : ''}.`,
    next: 'Copy the details and give them to an agent.',
  }),
};

function isJdError(err) {
  return err instanceof JdError
    || (err != null && err.name === 'JdError' && typeof err.code === 'string');
}

function errorText(e) {
  if (e == null) return String(e);
  if (typeof e === 'object' && ('message' in e || 'name' in e)) {
    return `${e.name || 'Error'}: ${e.message ?? ''}`;
  }
  try { return typeof e === 'string' ? e : JSON.stringify(e); } catch { return String(e); }
}

function stackLines(e) {
  const stack = e && typeof e.stack === 'string' ? e.stack : '';
  return stack.split('\n').slice(1, 7).map((l) => l.trim()).filter(Boolean);
}

function detailText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function describe(err, ctx = {}) {
  const known = isJdError(err) && Object.hasOwn(CATALOGUE, err.code);
  const code = known ? err.code : 'unexpected';
  const file = ctx?.file;
  const page = ctx?.page;
  const fileName = file && file.name ? quote(file.name) : '';
  const pageName = page && page.name ? quote(page.name) : '';
  const names = {
    file: fileName || 'this file',
    page: pageName || 'this page',
    subject: fileName || pageName || 'it',
    about: fileName || pageName,
    hasFile: Boolean(file),
    hasPage: Boolean(page),
  };
  const { title, body, next } = CATALOGUE[code](names);

  const lines = [`code: ${code}`];
  if (isJdError(err) && !known) lines.push(`unknown code: ${err.code}`);
  if (ctx?.caughtBy) lines.push(`caught by: ${ctx.caughtBy}`);
  if (file) {
    lines.push(`file: ${file.name ?? '(no name)'}`);
    lines.push(`type: ${file.type || '(none)'}`);
    lines.push(`size: ${typeof file.size === 'number' ? `${file.size} bytes` : 'unknown'}`);
  }
  if (page) {
    lines.push(`page: ${page.name ?? '(no name)'}`);
    lines.push(`page id: ${page.id ?? '(no id)'}`);
  }
  const cause = isJdError(err) ? err.cause : err;
  if (cause !== undefined) {
    lines.push(`error: ${errorText(cause)}`);
    const stack = stackLines(cause);
    for (const l of stack) lines.push(`  ${l}`);
    if (!stack.length && cause !== null && typeof cause === 'object') lines.push('  (no stack trace)');
  }
  if (isJdError(err)) {
    const d = detailText(err.detail);
    if (d) lines.push(`detail: ${d}`);
  }
  lines.push(`time: ${new Date().toISOString()}`);

  return { title, body, next, detail: lines.join('\n') };
}

let cachedBuild = null;

export async function getBuild() {
  if (cachedBuild) return cachedBuild;
  try {
    const url = new URL(`../${BUILD_PATH}`, import.meta.url);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data = await res.json();
    if (data && typeof data.build === 'string' && data.build) {
      cachedBuild = data.build;
      return cachedBuild;
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

// Resolves to fallback if fn() throws, rejects or takes longer than ms.
async function settle(fn, ms = 3000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => { timer = setTimeout(() => resolve('unknown'), ms); }),
    ]);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

const yesNo = (b) => (b ? 'yes' : 'no');
const show = (v) => (v === undefined ? 'unset' : typeof v === 'string' ? v : JSON.stringify(v));

export async function environmentDetail() {
  try {
    const nav = globalThis.navigator;
    const getSetting = async (key) => {
      const db = await import('./db.js');
      return show(await db.getSetting(key, undefined));
    };
    const lines = await Promise.all([
      settle(async () => `build: ${await getBuild()}`),
      settle(() => `user agent: ${nav.userAgent}`),
      settle(() => {
        const standalone = globalThis.matchMedia('(display-mode: standalone)').matches;
        return `display mode: ${standalone ? 'standalone' : 'browser'}`;
      }),
      settle(async () => `persisted storage: ${yesNo(await nav.storage.persisted())}`),
      settle(() => `showOpenFilePicker: ${yesNo(typeof globalThis.showOpenFilePicker === 'function')}`),
      settle(() => `service worker controls window: ${yesNo(Boolean(nav.serviceWorker && nav.serviceWorker.controller))}`),
      settle(async () => {
        const names = await globalThis.caches.keys();
        return `caches: ${names.length ? names.join(', ') : 'none'}`;
      }),
      settle(async () => `${SETTINGS.deleteBroken}: ${await getSetting(SETTINGS.deleteBroken)}`),
      settle(async () => `${SETTINGS.fsaBroken}: ${await getSetting(SETTINGS.fsaBroken)}`),
      settle(async () => `${SETTINGS.pickerLastError}: ${await getSetting(SETTINGS.pickerLastError)}`),
    ]);
    const labels = ['build', 'user agent', 'display mode', 'persisted storage', 'showOpenFilePicker',
      'service worker controls window', 'caches', SETTINGS.deleteBroken, SETTINGS.fsaBroken,
      SETTINGS.pickerLastError];
    return lines.map((l, i) => (l === 'unknown' ? `${labels[i]}: unknown` : l)).join('\n');
  } catch {
    return 'environment: unknown';
  }
}
