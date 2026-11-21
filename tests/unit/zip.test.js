import { test, assert, eq, rejects } from './harness.js';
import { makeZip, readZip, crc32, ZipError } from '../../app/js/zip.js';

const text = (b) => new TextDecoder().decode(b);
const bytesOf = (s) => new TextEncoder().encode(s);

// Made by Python's zipfile (ZIP_DEFLATED): "hello.txt" deflated,
// "dir/" a folder, "dir/ünï.txt" stored with the UTF-8 flag.
const PYTHON_ZIP = 'UEsDBBQAAAAIAAAAIQA/+6QnEQAAABIAAAAJAAAAaGVsbG8udHh0y0jNyclXKM8vyklRyACxuQBQSwMEFAAAAAAAAAAhAAAAAAAAAAAAAAAAAAQAAABkaXIvUEsDBBQAAAgAAAAAIQA996p2AwAAAAMAAAANAAAAZGlyL8O8bsOvLnR4dG9rIVBLAQIUAxQAAAAIAAAAIQA/+6QnEQAAABIAAAAJAAAAAAAAAAAAAACAAQAAAABoZWxsby50eHRQSwECFAMUAAAAAAAAACEAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAgAE4AAAAZGlyL1BLAQIUAxQAAAgAAAAAIQA996p2AwAAAAMAAAANAAAAAAAAAAAAAACAAVoAAABkaXIvw7xuw68udHh0UEsFBgAAAAADAAMApAAAAIgAAAAAAA==';

const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

test('crc32 matches the standard check value', () => {
  eq(crc32(bytesOf('123456789')), 0xcbf43926);
  eq(crc32(new Uint8Array(0)), 0);
});

test('round trip: text, binary, empty, unicode names', async () => {
  const bin = new Uint8Array(3000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 7919) & 0xff;
  const big = 'x'.repeat(50_000);
  const blob = await makeZip([
    { name: 'a.txt', data: 'hello' },
    { name: 'pages/über (2).html', data: `<p>${big}</p>` },
    { name: 'bin.dat', data: bin },
    { name: 'empty', data: new Uint8Array(0) },
  ]);
  assert(blob instanceof Blob);
  eq(blob.type, 'application/zip');
  assert(blob.size < 10_000, `repetitive text should compress, got ${blob.size}`);
  const m = await readZip(blob);
  eq([...m.keys()], ['a.txt', 'pages/über (2).html', 'bin.dat', 'empty']);
  eq(text(m.get('a.txt')), 'hello');
  eq(text(m.get('pages/über (2).html')), `<p>${big}</p>`);
  eq([...m.get('bin.dat')], [...bin]);
  eq(m.get('empty').length, 0);
});

test('reads a zip made by another tool (deflated, folder, UTF-8 name)', async () => {
  const m = await readZip(fromBase64(PYTHON_ZIP));
  eq([...m.keys()].sort(), ['dir/ünï.txt', 'hello.txt']);
  eq(text(m.get('hello.txt')), 'hello world hello\n');
  eq(text(m.get('dir/ünï.txt')), 'ok!');
});

test('duplicate names are refused', async () => {
  await rejects(makeZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]), ZipError);
});

test('not a zip, truncated, or corrupted: ZipError', async () => {
  await rejects(readZip(bytesOf('<!doctype html><p>not a zip</p>')), ZipError);
  await rejects(readZip(new Uint8Array(5)), ZipError);
  const good = new Uint8Array(await (await makeZip([{ name: 'a.txt', data: 'hello hello hello hello' }])).arrayBuffer());
  await rejects(readZip(good.slice(0, good.length - 30)), ZipError);
  const bad = good.slice();
  bad[35] ^= 0xff;   // inside the first entry's data
  await rejects(readZip(bad), ZipError);
});
