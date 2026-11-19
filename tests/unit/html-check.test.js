import { test, assert, eq, rejects } from './harness.js';
import { checkFile } from '../../app/js/html-check.js';

const enc = (s) => new TextEncoder().encode(s);
const file = (parts, name = 'a.html', type = 'text/html') => new File(parts, name, { type });
const html = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const cat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
};

test('extension: mhtml, mht, wrong type', async () => {
  await rejects(() => checkFile(file([html('x')], 'a.mhtml')), 'mhtml');
  await rejects(() => checkFile(file([html('x')], 'a.MHT')), 'mhtml');
  await rejects(() => checkFile(file([html('x')], 'a.txt')), 'wrong-type');
  await rejects(() => checkFile(file([html('x')], 'noext')), 'wrong-type');
});

test('accepts .HTM in any case', async () => {
  const r = await checkFile(file([html('x')], 'A.HTM'));
  eq(r.charset, null);
});

test('empty file', async () => {
  await rejects(() => checkFile(file([], 'a.html')), 'empty');
});

test('whitespace-only file is empty', async () => {
  await rejects(() => checkFile(file(['  \n\t '], 'a.html')), 'empty');
});

test('PNG renamed .html is not-html', async () => {
  const png = cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), enc('<div>'));
  await rejects(() => checkFile(file([png], 'pic.html')), 'not-html');
});

test('NUL byte is not-html', async () => {
  await rejects(() => checkFile(file([cat(enc('<div>'), new Uint8Array([0]), enc('x'))])), 'not-html');
});

test('MHTML content named .html', async () => {
  const m = 'From: <saved>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="x"\r\n\r\n--x\r\n<html></html>';
  await rejects(() => checkFile(file([m])), 'mhtml');
});

test('plain text with no tags is not-html', async () => {
  await rejects(() => checkFile(file(['just some words, no markup'])), 'not-html');
});

test('unreadable file carries the cause', async () => {
  const f = file([html('x')]);
  const boom = new Error('denied');
  Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.reject(boom) });
  const err = await rejects(() => checkFile(f), 'unreadable');
  assert(err.cause === boom);
});

test('errors carry file name, type and size', async () => {
  const err = await rejects(() => checkFile(file(['hello'], 'x.html', 'text/html')), 'not-html');
  eq(err.detail, { name: 'x.html', type: 'text/html', size: 5 });
});

test('title: from <title>, whitespace-collapsed, null without one', async () => {
  eq((await checkFile(file([html('x', '<title>  My   Page \n</title>')]))).title, 'My Page');
  eq((await checkFile(file([html('x')]))).title, null);
  eq((await checkFile(file([html('x', '<title>   </title>')]))).title, null);
});

test('declared windows-1252 gives the title and charset null', async () => {
  const bytes = cat(
    enc('<!doctype html><meta charset="windows-1252"><title>Caf'),
    new Uint8Array([0xe9]),
    enc('</title><p>x'),
  );
  const r = await checkFile(file([bytes]));
  eq(r.title, 'Café');
  eq(r.charset, null);
});

test('undeclared windows-1252 gives charset windows-1252', async () => {
  const bytes = cat(enc('<!doctype html><title>Caf'), new Uint8Array([0xe9]), enc('</title><p>x'));
  const r = await checkFile(file([bytes]));
  eq(r.title, 'Café');
  eq(r.charset, 'windows-1252');
});

test('undeclared valid UTF-8 gives charset null', async () => {
  const r = await checkFile(file([enc('<!doctype html><title>Café ✓</title><p>x')]));
  eq(r.title, 'Café ✓');
  eq(r.charset, null);
});

test('UTF-8 BOM file keeps its bytes', async () => {
  const bytes = cat(new Uint8Array([0xef, 0xbb, 0xbf]), enc('<!doctype html><title>B</title>'));
  const r = await checkFile(file([bytes]));
  eq(r.title, 'B');
  eq(new Uint8Array(r.bytes).length, bytes.length);
});

test('UTF-16LE file is converted to UTF-8 with a BOM', async () => {
  const text = '<!doctype html><title>Wide ✓</title><p>x';
  const u16 = new Uint8Array(2 + text.length * 2);
  u16[0] = 0xff; u16[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    u16[2 + i * 2] = c & 255;
    u16[3 + i * 2] = c >> 8;
  }
  const r = await checkFile(file([u16]));
  eq(r.title, 'Wide ✓');
  eq(r.charset, null);
  const out = new Uint8Array(r.bytes);
  eq([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  eq(new TextDecoder().decode(out.subarray(3)), text);
});

test('unconverted files keep identical bytes', async () => {
  const bytes = enc(html('x'));
  const r = await checkFile(file([bytes]));
  eq([...new Uint8Array(r.bytes)], [...bytes]);
});

test('sibling references: found in order, de-duplicated', async () => {
  const head = '<link rel="stylesheet" href="./css/a.css"><link rel="icon" href="/fav.png">'
    + '<link rel="alternate" href="feed.xml"><script src="app.js"></script>';
  const body = '<img src="pic.png"><img src="pic.png"><video src="v.mp4" poster="p.jpg"></video>'
    + '<audio src="a.mp3"></audio><iframe src="f.html"></iframe><object data="o.swf"></object>'
    + '<input type="image" src="btn.png"><source src="s.webm"><embed src="e.bin"><track src="t.vtt">';
  const r = await checkFile(file([html(body, head)]));
  eq(r.siblingRefs, ['./css/a.css', '/fav.png', 'app.js', 'pic.png', 'v.mp4', 'p.jpg', 'a.mp3',
    'f.html', 'o.swf', 'btn.png', 's.webm', 'e.bin', 't.vtt']);
});

test('sibling references ignore absolute, data, blob, # and // values', async () => {
  const body = '<img src="https://x.test/a.png"><img src="data:image/png;base64,AA=="><img src="blob:abc">'
    + '<img src="#frag"><img src="//cdn.test/x.js"><img src="  "><script src="mailto:a@b"></script>';
  eq((await checkFile(file([html(body)]))).siblingRefs, []);
});

test('an absolute <base href> gives no sibling references', async () => {
  const r = await checkFile(file([html('<img src="a.png">', '<base href="https://example.test/"><script src="app.js"></script>')]));
  eq(r.siblingRefs, []);
});

test('a relative <base href> still lists them', async () => {
  const r = await checkFile(file([html('<img src="a.png">', '<base href="sub/">')]));
  eq(r.siblingRefs, ['a.png']);
});
