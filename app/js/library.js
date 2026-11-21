// The library view: header, controls, list, footer. Renders into #library
// and re-renders on the libraryChanged event. Talks to other views only
// through events (contracts section 3).

import {
  listPages, updatePage, removePage, getSetting, setSetting,
} from './db.js';
import {
  SORTS, DEFAULT_SORT, allTags, parseTags, sortPages, filterPages,
} from './model.js';
import {
  actionSheet, confirmDialog, detailsDialog, copyButton, reportError,
} from './ui.js';
import { EVENTS, SETTINGS } from './config.js';
import { getBuild } from './errors.js';

const HOLD_MS = 500;
const HOLD_SLOP = 10;

let started = null;

export function initLibrary() {
  if (!started) started = start();
  return started;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, cls, onClick) {
  const b = el('button', `ui-btn ${cls || ''}`.trim(), label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

async function start() {
  const root = document.getElementById('library');
  if (!root) return;

  let sort = DEFAULT_SORT;
  try {
    const saved = await getSetting(SETTINGS.sort, DEFAULT_SORT);
    if (SORTS.some((s) => s.id === saved)) sort = saved;
  } catch (err) {
    reportError(err, {});
  }
  const active = new Set();
  let pages = [];
  let seq = 0;
  let sheetOpen = false;
  let suppressClick = false;

  const changed = () => document.dispatchEvent(new CustomEvent(EVENTS.libraryChanged));

  // ---------- skeleton, built once ----------

  const header = el('header', 'lib-header');
  header.appendChild(el('h1', 'lib-title', 'junk drawer'));
  const addTop = button('add new page', 'ui-btn-primary', () => {
    document.dispatchEvent(new CustomEvent(EVENTS.addPage));
  });
  header.appendChild(addTop);

  const warning = el('p', 'lib-warning',
    'this phone may clear your pages and their saved data when it runs short of space. ' +
    'installing junk drawer to the home screen usually fixes this.');
  warning.setAttribute('role', 'note');
  warning.hidden = true;

  const controls = el('div', 'lib-controls');
  const sortWrap = el('div', 'lib-sort');
  const sortLabel = el('label', 'ui-label', 'sort by');
  sortLabel.htmlFor = 'lib-sort-select';
  const select = el('select', 'ui-input');
  select.id = 'lib-sort-select';
  for (const s of SORTS) {
    const o = el('option', '', s.label);
    o.value = s.id;
    select.appendChild(o);
  }
  select.value = sort;
  select.addEventListener('change', async () => {
    sort = select.value;
    try {
      await setSetting(SETTINGS.sort, sort);
    } catch (err) {
      reportError(err, {});
    }
    renderList();
  });
  sortWrap.append(sortLabel, select);
  const chips = el('div', 'ui-chips lib-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'filter by tag');
  controls.append(sortWrap, chips);

  const list = el('ul', 'lib-list');
  const none = el('p', 'lib-none', 'no pages have all of those tags');
  none.hidden = true;

  const empty = el('section', 'lib-empty');
  empty.append(
    el('p', '', 'junk drawer is a place for the HTML web apps Claude or Gemini made you.'),
    el('p', '', 'add one and it keeps its own copy, so you can find it and use it here.'),
  );
  const addEmpty = button('add new page', 'ui-btn-primary', () => {
    document.dispatchEvent(new CustomEvent(EVENTS.addPage));
  });
  empty.appendChild(addEmpty);

  const footer = el('footer', 'lib-footer');
  const hint = el('p', 'lib-hint', 'press and hold a page for more');
  const backupRow = el('div', 'lib-backup');
  const exportBtn = button('export library', '', () => {
    document.dispatchEvent(new CustomEvent(EVENTS.exportLibrary));
  });
  const importBtn = button('import library', '', () => {
    document.dispatchEvent(new CustomEvent(EVENTS.importLibrary));
  });
  backupRow.append(exportBtn, importBtn);
  const trouble = el('div', 'lib-trouble');
  const buildLine = el('p', 'lib-build');
  const diag = copyButton({ label: 'copy diagnostics', getText: () => 'diagnostics' });
  const pickerRow = el('div', 'lib-picker');
  const pickerText = el('p', 'lib-picker-text');
  const pickerBtn = button('', '');
  pickerBtn.addEventListener('click', async () => {
    try {
      const broken = await getSetting(SETTINGS.fsaBroken, false);
      await setSetting(SETTINGS.fsaBroken, !broken);
      changed();
    } catch (err) {
      reportError(err, {});
    }
  });
  pickerRow.append(pickerText, pickerBtn);
  pickerRow.hidden = typeof window.showOpenFilePicker !== 'function';
  const deleteBtn = button('offer to delete downloaded files again', '');
  deleteBtn.hidden = true;
  deleteBtn.addEventListener('click', async () => {
    try {
      await setSetting(SETTINGS.deleteBroken, false);
      changed();
    } catch (err) {
      reportError(err, {});
    }
  });
  trouble.append(buildLine, diag, pickerRow, deleteBtn);
  footer.append(hint, backupRow, trouble);

  root.replaceChildren(header, warning, controls, list, none, empty, footer);

  // ---------- rendering ----------

  function renderList() {
    const tags = allTags(pages);
    for (const t of [...active]) if (!tags.includes(t)) active.delete(t);

    const isEmpty = pages.length === 0;
    controls.hidden = isEmpty;
    empty.hidden = !isEmpty;
    addTop.hidden = isEmpty;
    hint.hidden = isEmpty;
    exportBtn.hidden = isEmpty;
    select.value = sort;

    chips.replaceChildren(...tags.map((tag) => {
      const chip = el('button', 'ui-chip');
      chip.type = 'button';
      const on = active.has(tag);
      chip.setAttribute('aria-pressed', String(on));
      const mark = el('span', 'lib-chip-mark', '✓');
      mark.setAttribute('aria-hidden', 'true');
      mark.hidden = !on;
      chip.append(mark, el('span', '', tag));
      chip.addEventListener('click', () => {
        if (active.has(tag)) active.delete(tag); else active.add(tag);
        renderList();
      });
      return chip;
    }));

    const shown = sortPages(filterPages(pages, [...active]), sort);
    list.replaceChildren(...shown.map(row));
    none.hidden = isEmpty || shown.length > 0;
  }

  function row(p) {
    const li = el('li', 'lib-item');
    const b = el('button', 'lib-row');
    b.type = 'button';
    b.dataset.id = p.id;
    const nameLine = el('span', 'lib-name-line');
    if (p.pinned) {
      const pin = el('span', 'lib-pin', '📌');
      pin.setAttribute('aria-hidden', 'true');
      nameLine.append(pin, el('span', 'lib-sr', 'pinned'));
    }
    nameLine.appendChild(el('span', 'lib-name', p.name));
    b.appendChild(nameLine);
    if (p.tags.length) b.appendChild(el('span', 'lib-tags', p.tags.join(', ')));

    b.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      document.dispatchEvent(new CustomEvent(EVENTS.openPage, { detail: { id: p.id } }));
    });

    let timer = null;
    let sx = 0;
    let sy = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    b.addEventListener('pointerdown', (e) => {
      suppressClick = false;
      cancel();
      if (e.pointerType !== 'touch') return;
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        if (openSheet(p)) suppressClick = true;
      }, HOLD_MS);
    });
    b.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > HOLD_SLOP) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(type, cancel);
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancel();
      if (openSheet(p)) suppressClick = true;
    });
    li.appendChild(b);
    return li;
  }

  window.addEventListener('scroll', () => { /* a scroll cancels a pending hold */
    for (const r of list.querySelectorAll('.lib-row')) r.dispatchEvent(new Event('pointercancel'));
  }, { passive: true });

  async function render() {
    const mine = ++seq;
    let fresh;
    let persisted = true;
    let build = 'unknown';
    let fsaBroken = false;
    let deleteBroken = false;
    try {
      fresh = await listPages();
      fsaBroken = await getSetting(SETTINGS.fsaBroken, false);
      deleteBroken = await getSetting(SETTINGS.deleteBroken, false);
      try {
        if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
      } catch { persisted = true; }
      build = await getBuild();
    } catch (err) {
      reportError(err, {});
      return;
    }
    if (mine !== seq) return;
    pages = fresh;
    warning.hidden = persisted !== false;
    buildLine.textContent = `build ${build}`;
    pickerText.textContent = fsaBroken
      ? 'file picker: simple'
      : 'file picker: full (can delete the download afterwards)';
    pickerBtn.textContent = fsaBroken ? 'use the full picker' : 'use the simple picker';
    deleteBtn.hidden = deleteBroken !== true;
    renderList();
  }

  // ---------- the action sheet ----------

  // Returns true when it opened a sheet, false when one is already open.
  function openSheet(p) {
    if (sheetOpen) return false;
    sheetOpen = true;
    runSheet(p).finally(() => { sheetOpen = false; });
    return true;
  }

  async function runSheet(p) {
    try {
      const choice = await actionSheet({
        title: p.name,
        actions: [
          { id: 'pin', label: p.pinned ? 'unpin' : 'pin' },
          { id: 'edit', label: 'edit name and tags' },
          { id: 'replace', label: 'replace file' },
          { id: 'remove', label: 'remove', danger: true },
        ],
      });
      if (choice === 'pin') {
        await updatePage(p.id, { pinned: !p.pinned });
        changed();
      } else if (choice === 'edit') {
        const res = await detailsDialog({
          title: 'edit name and tags', name: p.name, tags: p.tags, allTags: allTags(pages),
        });
        if (res) {
          await updatePage(p.id, { name: res.name, tags: parseTags(res.tags) });
          changed();
        }
      } else if (choice === 'replace') {
        document.dispatchEvent(new CustomEvent(EVENTS.replaceFile, { detail: { id: p.id } }));
      } else if (choice === 'remove') {
        const ok = await confirmDialog({
          title: 'remove this page?',
          body: `“${p.name}” and its saved data will be deleted for good.`,
          confirmLabel: 'remove',
          cancelLabel: 'keep it',
          danger: true,
        });
        if (ok) {
          await removePage(p.id);
          changed();
        }
      }
    } catch (err) {
      reportError(err, { page: { id: p.id, name: p.name } });
    }
  }

  document.addEventListener(EVENTS.libraryChanged, () => { render(); });
  await render();
}
