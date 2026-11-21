// Zip files, written and read by hand (no dependencies). Pure: no DOM, no
// storage. Writing compresses with the browser's own deflate
// (CompressionStream 'deflate-raw') and stores an entry as-is when that
// isn't smaller or isn't there. Reading takes stored and deflated entries,
// which covers zips made by Junk Drawer and by the usual zip tools. Not
// supported: zip64 (archives or entries of 4 GB or more), encryption,
// archives split over several files.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const MAX_U32 = 0xffffffff;

// ---------- CRC-32 ----------

let table = null;

function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- errors ----------

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

// ---------- helpers ----------

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new TypeError('zip entry data must be bytes or a string');
}

async function throughStream(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canDeflate = () => typeof CompressionStream === 'function';
const canInflate = () => typeof DecompressionStream === 'function';

async function deflate(bytes) {
  if (!canDeflate()) return null;
  try {
    return await throughStream(bytes, new CompressionStream('deflate-raw'));
  } catch {
    return null;   // 'deflate-raw' not supported here: store instead
  }
}

function dosTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// ---------- writing ----------

// entries: [{ name, data }] where data is bytes or a string. Names use '/'
// between folders. Resolves to a Blob of type application/zip.
export async function makeZip(entries, { date = new Date() } = {}) {
  const encoder = new TextEncoder();
  const { time, date: day } = dosTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  const seen = new Set();

  for (const entry of entries) {
    const name = String(entry.name);
    if (!name || seen.has(name)) throw new ZipError(`duplicate or empty entry name: ${name}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const raw = toBytes(entry.data);
    const crc = crc32(raw);
    const packed = raw.length ? await deflate(raw) : null;
    const useDeflate = packed !== null && packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? DEFLATED : STORED;
    if (raw.length >= MAX_U32 || offset + 30 + nameBytes.length + body.length >= MAX_U32) {
      throw new ZipError('the backup is too big for a zip file (4 GB)');
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_SIG, true);
    local.setUint16(4, 20, true);              // version needed: 2.0
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);              // extra field length
    parts.push(local.buffer, nameBytes, body);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, CENTRAL_SIG, true);
    cen.setUint16(4, 20, true);                // made by: 2.0, MS-DOS attributes
    cen.setUint16(6, 20, true);
    cen.setUint16(8, UTF8_FLAG, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameBytes.length, true);
    // 30 extra, 32 comment, 34 disk, 36 internal attrs, 38 external attrs: 0
    cen.setUint32(42, offset, true);
    central.push(cen.buffer, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
  if (entries.length > 0xffff) throw new ZipError('too many files for a zip file');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_SIG, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- reading ----------

function findEnd(view) {
  // The end record is 22 bytes plus a comment of up to 65535 bytes.
  const stop = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === END_SIG) return i;
  }
  return -1;
}

// data: Blob, ArrayBuffer or bytes. Resolves to a Map of entry name to
// Uint8Array (folders left out). Throws ZipError when it isn't a zip it can
// read.
export async function readZip(data) {
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : toBytes(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new ZipError('too short to be a zip file');
  const endAt = findEnd(view);
  if (endAt < 0) throw new ZipError('not a zip file (no end record)');
  const count = view.getUint16(endAt + 10, true);
  const centralSize = view.getUint32(endAt + 12, true);
  const centralAt = view.getUint32(endAt + 16, true);
  if (count === 0xffff || centralAt === MAX_U32 || centralSize === MAX_U32) {
    throw new ZipError('zip64 files are not supported');
  }
  if (centralAt + centralSize > endAt) throw new ZipError('the zip file is damaged (central directory)');

  const utf8 = new TextDecoder('utf-8');
  const latin = new TextDecoder('latin1');
  const out = new Map();
  let p = centralAt;
  for (let i = 0; i < count; i++) {
    if (p + 46 > endAt || view.getUint32(p, true) !== CENTRAL_SIG) {
      throw new ZipError('the zip file is damaged (central entry)');
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const packedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const nameRaw = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & UTF8_FLAG ? utf8 : latin).decode(nameRaw);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;   // a folder
    if (flags & 0x0001) throw new ZipError(`${name} is encrypted`);
    if (packedSize === MAX_U32 || size === MAX_U32 || localAt === MAX_U32) {
      throw new ZipError('zip64 files are not supported');
    }
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL_SIG) {
      throw new ZipError(`the zip file is damaged (${name})`);
    }
    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (start + packedSize > bytes.length) throw new ZipError(`the zip file is damaged (${name})`);
    const body = bytes.subarray(start, start + packedSize);

    let content;
    if (method === STORED) {
      content = body.slice();
    } else if (method === DEFLATED) {
      if (!canInflate()) throw new ZipError('this browser can’t unpack compressed zip files');
      try {
        content = await throughStream(body, new DecompressionStream('deflate-raw'));
      } catch (e) {
        throw new ZipError(`the zip file is damaged (${name}: ${e && e.message})`);
      }
    } else {
      throw new ZipError(`${name} uses a compression method Junk Drawer can’t read (${method})`);
    }
    if (content.length !== size || crc32(content) !== crc) {
      throw new ZipError(`the zip file is damaged (${name} doesn’t match its checksum)`);
    }
    out.set(name, content);
  }
  return out;
}
