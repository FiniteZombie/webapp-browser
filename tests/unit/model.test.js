import { test, assert, eq } from './harness.js';
import {
  normaliseTag, parseTags, allTags, matchKey, findSameName, sortPages, filterPages,
  fileStem, SORTS, DEFAULT_SORT,
} from '../../app/js/model.js';

const P = (id, name, o = {}) => ({
  id, name, fileName: `${name}.html`, tags: [], pinned: false, openCount: 0,
  addedAt: 1000, lastOpenedAt: null, replacedAt: null, size: 1, ...o,
});
const ids = (pages) => pages.map((p) => p.id).join(',');

test('normaliseTag trims, lowercases and collapses spaces', () => {
  eq(normaliseTag('  Big   Cats \n'), 'big cats');
  eq(normaliseTag('   '), '');
});

test('parseTags takes a string or an array, drops empties and repeats', () => {
  eq(parseTags('Work, home ,, WORK,  to  do'), ['work', 'home', 'to do']);
  eq(parseTags([' A ', 'b', '', 'a']), ['a', 'b']);
  eq(parseTags(''), []);
});

test('allTags lists tags in use alphabetically', () => {
  eq(allTags([P('1', 'a', { tags: ['b', 'a'] }), P('2', 'b', { tags: ['c', 'a'] })]), ['a', 'b', 'c']);
});

test('matchKey examples', () => {
  eq(matchKey('Tip Splitter (1).html'), 'tip splitter');
  eq(matchKey('tip splitter.htm'), 'tip splitter');
  eq(matchKey('TIP  SPLITTER'), 'tip splitter');
  eq(matchKey('Notes.HTM'), 'notes');
  eq(matchKey('notes'), 'notes');
  eq(matchKey('notes (12)'), 'notes');
  eq(matchKey('notes(3).html'), 'notes');
  eq(matchKey('a (1) (2).html'), 'a');
  eq(matchKey(''), '');
});

test('fileStem drops .html and .htm', () => {
  eq(fileStem('a.b.HTML'), 'a.b');
  eq(fileStem('x.htm'), 'x');
  eq(fileStem('x'), 'x');
});

test('findSameName matches by name, file name and across the two', () => {
  const pages = [P('1', 'Tip Splitter'), P('2', 'Other', { fileName: 'calc (2).html' })];
  eq(ids(findSameName(pages, { name: 'tip splitter', fileName: 'zzz.html' })), '1');
  eq(ids(findSameName(pages, { name: 'New', fileName: 'Tip Splitter (1).html' })), '1');
  eq(ids(findSameName(pages, { name: 'Calc', fileName: 'q.html' })), '2');
  eq(ids(findSameName(pages, { name: 'other', fileName: 'x.html' })), '2');
  eq(ids(findSameName(pages, { name: 'nothing', fileName: 'none.html' })), '');
});

test('findSameName never matches on empty keys', () => {
  const pages = [P('1', '', { fileName: '' }), P('2', '(1)', { fileName: '.html' })];
  eq(findSameName(pages, { name: '', fileName: '' }).length, 0);
  eq(findSameName(pages, { name: '(3)', fileName: '.htm' }).length, 0);
});

test('SORTS and default', () => {
  eq(SORTS.map((s) => s.id), ['name', 'recent-opened', 'recent-added', 'most-opened']);
  assert(SORTS.every((s) => s.label));
  eq(DEFAULT_SORT, 'name');
});

test('sort by name is natural and case-blind', () => {
  const pages = [P('a', 'page 10'), P('b', 'Page 2'), P('c', 'apple')];
  eq(ids(sortPages(pages, 'name')), 'c,b,a');
});

test('pinned pages come first within every sort', () => {
  const pages = [P('a', 'a'), P('b', 'b', { pinned: true, addedAt: 1 }), P('c', 'c', { addedAt: 5000 })];
  eq(ids(sortPages(pages, 'name')), 'b,a,c');
  eq(ids(sortPages(pages, 'recent-added')), 'b,c,a');
});

test('recent-opened uses addedAt for never-opened pages', () => {
  const pages = [
    P('a', 'a', { addedAt: 100, lastOpenedAt: 500 }),
    P('b', 'b', { addedAt: 300 }),
    P('c', 'c', { addedAt: 900 }),
    P('d', 'd', { addedAt: 50, lastOpenedAt: 200 }),
  ];
  eq(ids(sortPages(pages, 'recent-opened')), 'c,a,b,d');
});

test('recent-added is newest first', () => {
  eq(ids(sortPages([P('a', 'a', { addedAt: 1 }), P('b', 'b', { addedAt: 3 }), P('c', 'c', { addedAt: 2 })], 'recent-added')), 'b,c,a');
});

test('most-opened: count, then recent-opened, then name, then id', () => {
  const pages = [
    P('a', 'a', { openCount: 2, lastOpenedAt: 10 }),
    P('b', 'b', { openCount: 5 }),
    P('c', 'c', { openCount: 2, lastOpenedAt: 20 }),
    P('e', 'same', { openCount: 0, addedAt: 7 }),
    P('d', 'same', { openCount: 0, addedAt: 7 }),
  ];
  eq(ids(sortPages(pages, 'most-opened')), 'b,c,a,d,e');
});

test('ties fall back to name then id; unknown sort acts as name', () => {
  const pages = [P('z', 'b'), P('y', 'a'), P('x', 'a')];
  eq(ids(sortPages(pages, 'recent-added')), 'x,y,z');
  eq(ids(sortPages(pages, 'bogus')), 'x,y,z');
});

test('sortPages does not mutate its input', () => {
  const pages = [P('b', 'b'), P('a', 'a')];
  const out = sortPages(pages, 'name');
  eq(ids(pages), 'b,a');
  assert(out !== pages);
});

test('filterPages needs every active tag', () => {
  const pages = [
    P('1', 'a', { tags: ['x', 'y'] }),
    P('2', 'b', { tags: ['x'] }),
    P('3', 'c', { tags: [] }),
  ];
  eq(ids(filterPages(pages, [])), '1,2,3');
  eq(ids(filterPages(pages, ['x'])), '1,2');
  eq(ids(filterPages(pages, ['x', 'y'])), '1');
});
