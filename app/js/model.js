// Library logic: tags, same-name matching, sorting, filtering. Pure: no DOM,
// no storage, no imports from ui.js.

export const SORTS = [
  { id: 'name', label: 'name' },
  { id: 'recent-opened', label: 'recently opened' },
  { id: 'recent-added', label: 'recently added' },
  { id: 'most-opened', label: 'most opened' },
];
export const DEFAULT_SORT = 'name';

export function normaliseTag(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseTags(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(',');
  const out = [];
  for (const part of parts) {
    const tag = normaliseTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function allTags(pages) {
  const set = new Set();
  for (const page of pages || []) for (const tag of page.tags || []) set.add(tag);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

export function matchKey(s) {
  let key = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = key
      .replace(/\.html?$/, '')
      .replace(/\s*\(\d+\)$/, '')
      .trim();
    if (next === key) return key;
    key = next;
  }
}

export function fileStem(fileName) {
  return String(fileName ?? '').replace(/\.html?$/i, '');
}

export function findSameName(pages, { name, fileName } = {}) {
  const wanted = [matchKey(name), matchKey(fileName)].filter(Boolean);
  if (!wanted.length) return [];
  return (pages || []).filter((page) => {
    const keys = [matchKey(page.name), matchKey(page.fileName)];
    return keys.some((k) => k && wanted.includes(k));
  });
}

const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const opened = (p) => p.lastOpenedAt ?? p.addedAt ?? 0;

const COMPARES = {
  name: () => 0,
  'recent-opened': (a, b) => opened(b) - opened(a),
  'recent-added': (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0),
  'most-opened': (a, b) => ((b.openCount ?? 0) - (a.openCount ?? 0)) || (opened(b) - opened(a)),
};

export function sortPages(pages, sortId) {
  const primary = COMPARES[Object.hasOwn(COMPARES, sortId) ? sortId : DEFAULT_SORT];
  return [...(pages || [])].sort((a, b) =>
    (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    || primary(a, b)
    || byText(a.name, b.name)
    || byId(a, b));
}

export function filterPages(pages, activeTags) {
  const active = activeTags || [];
  if (!active.length) return [...(pages || [])];
  return (pages || []).filter((p) => active.every((t) => (p.tags || []).includes(t)));
}
