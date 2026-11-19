import { test, assert, eq } from './harness.js';
import { doctypeEnd, escapeForInlineScript, inlineScript, buildPageParts } from '../../app/js/inject.js';
import { pageShim } from '../../app/js/page-shim.js';

const enc = (s) => new TextEncoder().encode(s);
const latin = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (u8) => new TextDecoder().decode(u8);

function throws(fn, what) {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert(err, `expected a throw: ${what}`);
}

test('doctypeEnd: plain doctype', () => {
  eq(doctypeEnd(enc('<!doctype html><html></html>')), 15);
});

test('doctypeEnd: uppercase', () => {
  eq(doctypeEnd(enc('<!DOCTYPE HTML>\n<p>')), 15);
});

test('doctypeEnd: leading whitespace', () => {
  eq(doctypeEnd(enc(' \n\t\r\n<!doctype html><p>')), 20);
});

test('doctypeEnd: leading comment', () => {
  const s = '<!-- licence: MIT -->\n<!doctype html>';
  eq(doctypeEnd(enc(s + '<p>x</p>')), s.length);
});

test('doctypeEnd: several comments with a dash inside', () => {
  const s = '<!-- a - b --> <!-- c -->\n<!DocType html>';
  eq(doctypeEnd(enc(s + '<p>')), s.length);
});

test('doctypeEnd: BOM plus doctype', () => {
  const b = latin('\xEF\xBB\xBF<!doctype html><p>');
  eq(doctypeEnd(b), 18);
});

test('doctypeEnd: BOM and no doctype', () => {
  eq(doctypeEnd(latin('\xEF\xBB\xBF<html><p>hi')), 3);
});

test('doctypeEnd: no doctype', () => {
  eq(doctypeEnd(enc('<html><body>hi</body></html>')), 0);
  eq(doctypeEnd(enc('<!-- comment --><html>')), 0);
  eq(doctypeEnd(enc('')), 0);
});

test('doctypeEnd: a legacy long doctype', () => {
  const d = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
  eq(doctypeEnd(enc(d + '\n<html>')), d.length);
});

test('doctypeEnd: doctype after a long comment, ArrayBuffer input', () => {
  const s = '<!--' + 'x'.repeat(30000) + '-->\n<!doctype html>';
  eq(doctypeEnd(enc(s + '<p>').buffer), s.length);
});

test('doctypeEnd: unterminated comment, no doctype, is quick', () => {
  const t0 = performance.now();
  eq(doctypeEnd(enc('<!-- a --> '.repeat(5000) + '<html>')), 0);
  eq(doctypeEnd(enc('<!-- never closed <!doctype html>')), 0);
  assert(performance.now() - t0 < 1000, 'too slow');
});

test('doctypeEnd: a Uint8Array view with an offset', () => {
  const whole = enc('JUNK<!doctype html><p>');
  eq(doctypeEnd(whole.subarray(4)), 15);
});

test('escapeForInlineScript escapes < and non-ASCII', () => {
  const out = escapeForInlineScript({ a: '</script><!-- é   \u{1F600}' });
  assert(!out.includes('<'), 'has <');
  assert(/^[\x00-\x7f]*$/.test(out), 'not ASCII');
  eq(JSON.parse(out), { a: '</script><!-- é   \u{1F600}' });
});

test('inlineScript: shape, escapes </script> inside a value and non-ASCII', () => {
  const boot = { pageId: 'x</script><script>alert(1)</script>', name: 'café' };
  const u8 = inlineScript('function (b) { window.B = b; }', boot);
  assert(u8 instanceof Uint8Array, 'not a Uint8Array');
  const s = text(u8);
  for (const b of u8) assert(b < 0x80, 'non-ASCII byte');
  assert(s.startsWith('<script>(function (b) { window.B = b; })('), 'start: ' + s);
  assert(s.endsWith(');document.currentScript.remove()</script>'), 'end: ' + s);
  eq(s.match(/<\/script/gi).length, 1, 'closing tags');
  eq(s.match(/</g).length, 2, 'only the two tags have <');
  const json = s.slice(s.indexOf(')(') + 2, s.lastIndexOf(');document'));
  eq(JSON.parse(json), boot);
});

test('inlineScript throws on a bad shim source', () => {
  throws(() => inlineScript('function () { "</script>" }', {}), '</script');
  throws(() => inlineScript('function () { "</SCRIPT" }', {}), '</SCRIPT');
  throws(() => inlineScript('function () { "é" }', {}), 'non-ASCII');
  throws(() => inlineScript('function () { "<!--" }', {}), '<!--');
});

test('pageShim.toString() passes the check and is ASCII', () => {
  const src = pageShim.toString();
  assert(/^[\x00-\x7f]*$/.test(src), 'shim is not ASCII');
  const u8 = inlineScript(src, { pageId: 'p', hostGlobal: '__junkDrawerHost', dbPrefix: 'junk-drawer:page:p:', quotaChars: 10 });
  assert(u8.length > src.length, 'too short');
});

test('buildPageParts splits at the doctype', () => {
  const html = '<!doctype html><title>é</title>';
  const parts = buildPageParts(enc(html).buffer, 'function () {}', { a: 1 });
  eq(parts.length, 3);
  eq(text(parts[0]), '<!doctype html>');
  assert(text(parts[1]).startsWith('<script>(function () {})({"a":1})'), 'script');
  eq(text(parts[2]), '<title>é</title>');
  const none = buildPageParts(enc('<p>x'), 'function () {}', {});
  eq(none[0].length, 0);
  eq(text(none[2]), '<p>x');
});
