// Notices, dialogs and sheets (WP5). Everything is built with DOM methods
// and textContent; nothing the owner or a file supplied goes through
// innerHTML. Imports nothing from model.js.

import { describe, environmentDetail } from './errors.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function button(label, cls, onClick) {
  const b = el('button', `ui-btn${cls ? ` ${cls}` : ''}`, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function host(id) {
  let h = document.getElementById(id);
  if (!h) {
    h = document.createElement('div');
    h.id = id;
    document.body.appendChild(h);
  }
  return h;
}

// ---------- copy button ----------

export function copyButton({ label, getText }) {
  const btn = button(label, '');
  let timer = null;
  let area = null;
  btn.addEventListener('click', async () => {
    let text;
    try {
      text = `${await getText()}\n\n${await environmentDetail()}`;
    } catch (err) {
      text = `(couldn’t build the details: ${err && err.message ? err.message : err})`;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (area) { area.remove(); area = null; }
      btn.textContent = 'copied';
      clearTimeout(timer);
      timer = setTimeout(() => { btn.textContent = label; }, 2000);
    } catch {
      if (area) area.remove();
      area = el('textarea', 'ui-copy-text');
      area.readOnly = true;
      area.value = text;
      area.setAttribute('aria-label', 'details to copy by hand');
      btn.after(area);
      area.focus();
      area.select();
    }
  });
  return btn;
}

// ---------- notices ----------

export function showNotice({ title, body, next, detail, actions } = {}) {
  const box = host('notices');
  const card = el('section', 'ui-notice');
  card.setAttribute('role', 'group');
  if (title) card.appendChild(el('h2', 'ui-title', title));
  if (body) card.appendChild(el('p', 'ui-text', body));
  if (next) card.appendChild(el('p', 'ui-text ui-next', next));
  const row = el('div', 'ui-notice-actions');
  if (detail) row.appendChild(copyButton({ label: 'copy details', getText: () => detail }));
  for (const a of actions || []) {
    if (a.href) {
      const link = el('a', 'ui-btn', a.label);
      link.href = a.href;
      link.target = '_blank';
      link.rel = 'noopener';
      row.appendChild(link);
    } else {
      row.appendChild(button(a.label, '', () => { if (a.onClick) a.onClick(); }));
    }
  }
  const dismiss = () => card.remove();
  row.appendChild(button('dismiss', '', dismiss));
  card.appendChild(row);
  box.appendChild(card);
  return { dismiss };
}

export function reportError(err, ctx) {
  showNotice(describe(err, ctx));
  console.error(err);
}

// ---------- dialog plumbing ----------

let queue = Promise.resolve();
let pending = 0;
let noticesNext = null;

function moveNoticesInto(dlg) {
  const n = host('notices');
  if (n.parentNode === dlg) return;
  noticesNext = n.parentNode === document.body ? n.nextSibling : null;
  dlg.appendChild(n);
}

function moveNoticesBack() {
  const n = document.getElementById('notices');
  if (!n || n.parentNode === document.body) return;
  if (noticesNext && noticesNext.parentNode === document.body) document.body.insertBefore(n, noticesNext);
  else document.body.appendChild(n);
  noticesNext = null;
}

export function hasOpenUi() {
  const n = document.getElementById('notices');
  return pending > 0 || Boolean(n && n.querySelector('.ui-notice'));
}

const inNotices = (e) => Boolean(e.target && e.target.closest && e.target.closest('#notices'));

// build(dlg, finish) fills the dialog; the promise resolves once, with the
// value passed to finish or cancelValue if the dialog is dismissed.
function openDialog({ sheet = false, cancelValue, build }) {
  pending++;
  const run = () => new Promise((resolve, reject) => {
    const dlg = el('dialog', sheet ? 'ui-dialog ui-sheet' : 'ui-dialog');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      moveNoticesBack();
      try { dlg.close(); } catch { /* already closed */ }
      dlg.remove();
      pending--;
      resolve(value);
    };
    try {
      dlg.addEventListener('cancel', () => finish(cancelValue));
      dlg.addEventListener('close', () => finish(cancelValue));
      if (sheet) {
        // A sheet opened by a long press must survive the finger lifting:
        // ignore activations until it has seen its own pointerdown/keydown.
        let armed = false;
        let downOnBackdrop = false;
        dlg.addEventListener('pointerdown', (e) => {
          if (inNotices(e)) return;
          armed = true;
          downOnBackdrop = e.target === dlg;
        }, true);
        dlg.addEventListener('keydown', (e) => { if (!inNotices(e)) armed = true; }, true);
        dlg.addEventListener('click', (e) => {
          if (inNotices(e)) return;
          if (!armed) { e.preventDefault(); e.stopPropagation(); return; }
          if (e.target === dlg) {
            const hit = downOnBackdrop;
            downOnBackdrop = false;
            e.stopPropagation();
            if (hit) finish(cancelValue);
          }
        }, true);
      }
      build(dlg, finish);
      host('dialogs').appendChild(dlg);
      moveNoticesInto(dlg);
      dlg.showModal();
    } catch (err) {
      if (!done) { done = true; pending--; moveNoticesBack(); dlg.remove(); }
      reject(err);
    }
  });
  const result = queue.then(run);
  queue = result.then(() => {}, () => {});
  return result;
}

function heading(dlg, title) {
  const h = el('h2', 'ui-title', title || '');
  h.id = nextId('ui-h');
  dlg.setAttribute('aria-labelledby', h.id);
  dlg.appendChild(h);
}

function paragraph(dlg, body) {
  if (body) dlg.appendChild(el('p', 'ui-text', body));
}

// ---------- the dialogs ----------

export function confirmDialog({ title, body, confirmLabel = 'ok', cancelLabel = 'cancel', danger = false } = {}) {
  return openDialog({
    cancelValue: false,
    build(dlg, finish) {
      heading(dlg, title);
      paragraph(dlg, body);
      const row = el('div', 'ui-row-buttons');
      row.appendChild(button(cancelLabel, '', () => finish(false)));
      row.appendChild(button(confirmLabel, danger ? 'ui-btn-danger' : 'ui-btn-primary', () => finish(true)));
      dlg.appendChild(row);
    },
  });
}

export function choiceDialog({ title, body, list, choices = [] } = {}) {
  return openDialog({
    cancelValue: null,
    build(dlg, finish) {
      heading(dlg, title);
      paragraph(dlg, body);
      if (list && list.length) {
        const ul = el('ul', 'ui-list');
        for (const item of list.slice(0, 10)) ul.appendChild(el('li', '', item));
        if (list.length > 10) ul.appendChild(el('li', '', `and ${list.length - 10} more`));
        dlg.appendChild(ul);
      }
      const stack = el('div', 'ui-stack');
      for (const c of choices) {
        stack.appendChild(button(c.label, c.danger ? 'ui-btn-danger' : '', () => finish(c.id)));
      }
      stack.appendChild(button('cancel', '', () => finish(null)));
      dlg.appendChild(stack);
    },
  });
}

export function actionSheet({ title, actions = [] } = {}) {
  return openDialog({
    sheet: true,
    cancelValue: null,
    build(dlg, finish) {
      heading(dlg, title);
      const stack = el('div', 'ui-stack');
      for (const a of actions) {
        stack.appendChild(button(a.label, `ui-sheet-row${a.danger ? ' ui-btn-danger' : ''}`, () => finish(a.id)));
      }
      dlg.appendChild(stack);
    },
  });
}

export function detailsDialog({ title, name = '', tags = [], allTags = [], submitLabel = 'save' } = {}) {
  return openDialog({
    cancelValue: null,
    build(dlg, finish) {
      const form = el('form');
      form.noValidate = true;
      heading(dlg, title);

      const nameField = el('div', 'ui-field');
      const nameId = nextId('ui-name');
      const errId = nextId('ui-err');
      const nameLabel = el('label', 'ui-label', 'name');
      nameLabel.htmlFor = nameId;
      const nameInput = el('input', 'ui-input');
      nameInput.type = 'text';
      nameInput.id = nameId;
      nameInput.value = name;
      nameInput.autocomplete = 'off';
      nameInput.setAttribute('aria-describedby', errId);
      const err = el('p', 'ui-error', 'give the page a name');
      err.id = errId;
      err.hidden = true;
      nameInput.addEventListener('input', () => {
        err.hidden = true;
        nameInput.removeAttribute('aria-invalid');
      });
      nameField.append(nameLabel, nameInput, err);
      form.appendChild(nameField);

      const on = new Set(tags);
      const chips = [];
      if (allTags.length) {
        const wrap = el('div', 'ui-chips');
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'tags');
        for (const tag of allTags) {
          const chip = el('button', 'ui-chip');
          chip.type = 'button';
          const mark = el('span', 'ui-chip-mark', '✓');
          mark.setAttribute('aria-hidden', 'true');
          chip.append(mark, el('span', '', tag));
          const sync = () => {
            const pressed = on.has(tag);
            chip.setAttribute('aria-pressed', String(pressed));
            mark.hidden = !pressed;
          };
          chip.addEventListener('click', () => {
            if (on.has(tag)) on.delete(tag); else on.add(tag);
            sync();
          });
          sync();
          chips.push({ tag, chip });
          wrap.appendChild(chip);
        }
        form.appendChild(wrap);
      }

      const tagField = el('div', 'ui-field');
      const tagId = nextId('ui-tags');
      const tagLabel = el('label', 'ui-label', 'new tags, separated by commas');
      tagLabel.htmlFor = tagId;
      const tagInput = el('input', 'ui-input');
      tagInput.type = 'text';
      tagInput.id = tagId;
      tagInput.autocomplete = 'off';
      tagField.append(tagLabel, tagInput);
      form.appendChild(tagField);

      const row = el('div', 'ui-row-buttons');
      row.appendChild(button('cancel', '', () => finish(null)));
      const submit = el('button', 'ui-btn ui-btn-primary', submitLabel);
      submit.type = 'submit';
      row.appendChild(submit);
      form.appendChild(row);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const trimmed = nameInput.value.trim();
        if (!trimmed) {
          err.hidden = false;
          nameInput.setAttribute('aria-invalid', 'true');
          nameInput.focus();
          return;
        }
        const result = chips.filter((c) => on.has(c.tag)).map((c) => c.tag);
        for (const piece of tagInput.value.split(',')) {
          const t = piece.trim();
          if (t) result.push(t);
        }
        finish({ name: trimmed, tags: result });
      });
      dlg.appendChild(form);
    },
  });
}

export function addedSheet({ title, canDelete = false, deleteDefault = false } = {}) {
  return openDialog({
    sheet: true,
    cancelValue: null,
    build(dlg, finish) {
      heading(dlg, title);
      let box = null;
      if (canDelete) {
        const wrap = el('label', 'ui-check');
        box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(deleteDefault);
        wrap.append(box, el('span', '', 'delete the downloaded file from this phone'));
        dlg.appendChild(wrap);
      }
      const result = (open) => ({ deleteOriginal: Boolean(canDelete && box && box.checked), open });
      const row = el('div', 'ui-row-buttons');
      row.appendChild(button('back to library', '', () => finish(result(false))));
      row.appendChild(button('open', 'ui-btn-primary', () => finish(result(true))));
      dlg.appendChild(row);
    },
  });
}
