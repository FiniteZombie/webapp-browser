// Where to inject the shim, and building the served bytes (WP4). Pure, sync.

const WINDOW = 65536;
const SPACE = new Set(['\t', '\n', '\f', '\r', ' ']);

function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Uint8Array(bytes);
}

function latin1(u8) {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return s;
}

export function doctypeEnd(bytes) {
  const u8 = toBytes(bytes);
  const head = latin1(u8.subarray(0, WINDOW));
  const start = head.startsWith('\xEF\xBB\xBF') ? 3 : 0;
  // A scan rather than one regex: a regex over comments backtracks badly
  // when there is no doctype after them.
  let i = start;
  for (;;) {
    if (SPACE.has(head[i])) { i++; continue; }
    if (head.startsWith('<!--', i)) {
      const close = head.indexOf('-->', i + 4);
      if (close < 0) return start;
      i = close + 3;
      continue;
    }
    break;
  }
  if (head.slice(i, i + 9).toLowerCase() !== '<!doctype') return start;
  const gt = head.indexOf('>', i + 9);
  return gt < 0 ? start : gt + 1;
}

export function escapeForInlineScript(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new TypeError('escapeForInlineScript: value has no JSON form');
  return json.replace(/[<\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function inlineScript(shimSource, boot) {
  const src = String(shimSource);
  if (/[^\x00-\x7f]/.test(src)) throw new Error('inlineScript: the shim source has a non-ASCII character');
  if (/<\/script/i.test(src)) throw new Error('inlineScript: the shim source contains a closing script tag');
  if (src.includes('<!--')) throw new Error('inlineScript: the shim source contains an HTML comment opener');
  const text = '<script>(' + src + ')(' + escapeForInlineScript(boot) + ');document.currentScript.remove()</script>';
  return new TextEncoder().encode(text);
}

export function buildPageParts(bytes, shimSource, boot) {
  const u8 = toBytes(bytes);
  const end = doctypeEnd(u8);
  return [u8.subarray(0, end), inlineScript(shimSource, boot), u8.subarray(end)];
}
