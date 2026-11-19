// Checks a picked file before Junk Drawer keeps a copy of it. Must not
// import ui.js.

import { JdError } from './errors.js';

const SIGNATURES = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x25, 0x50, 0x44, 0x46], // PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x1f, 0x8b], // gzip
  [0x52, 0x49, 0x46, 0x46], // RIFF
  [0x00, 0x00, 0x00], // ISO media
];

const TAGS = '!doctype|html|head|body|title|meta|script|style|div|p|span|a|img|svg|canvas|main|section|table|form|input|button|ul|ol|pre|h[1-6]';
const LOOKS_LIKE_HTML = new RegExp(`<(?:${TAGS})(?=[\\s>/]|$)`, 'i');

const REF_SELECTORS = [
  'script[src]', 'link[href]', 'img[src]', 'source[src]', 'video[src]', 'video[poster]',
  'audio[src]', 'track[src]', 'iframe[src]', 'embed[src]', 'object[data]', 'input[type=image][src]',
];
const REF_ATTRS = { LINK: 'href', OBJECT: 'data' };
const LINK_RELS = ['stylesheet', 'icon', 'manifest', 'preload', 'modulepreload'];

function startsWith(u8, sig) {
  return u8.length >= sig.length && sig.every((b, i) => u8[i] === b);
}

function utf16ToUtf8Bom(u8) {
  const le = u8[0] === 0xff;
  let text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(u8.subarray(2));
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out.buffer;
}

function declaredEncoding(u8) {
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 4096));
  const m = /<meta\s[^>]*?charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head);
  if (!m) return null;
  try { new TextDecoder(m[1]); return m[1]; } catch { return null; }
}

function decode(u8) {
  if (startsWith(u8, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(u8), charset: null };
  }
  const declared = declaredEncoding(u8);
  if (declared) return { text: new TextDecoder(declared).decode(u8), charset: null };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), charset: null };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(u8), charset: 'windows-1252' };
  }
}

function isLocalRef(value) {
  const v = String(value ?? '').trim();
  return v !== '' && !v.startsWith('#') && !v.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

function siblingRefs(doc) {
  const base = doc.querySelector('base[href]');
  if (base && /^[a-z][a-z0-9+.-]*:/i.test(base.getAttribute('href').trim())) return [];
  const refs = [];
  for (const el of doc.querySelectorAll(REF_SELECTORS.join(','))) {
    const tag = el.tagName;
    if (tag === 'LINK') {
      const rels = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      if (!rels.some((r) => LINK_RELS.includes(r))) continue;
    }
    const values = [];
    if (tag === 'VIDEO') {
      for (const a of ['src', 'poster']) if (el.hasAttribute(a)) values.push(el.getAttribute(a));
    } else {
      values.push(el.getAttribute(REF_ATTRS[tag] || 'src'));
    }
    for (const v of values) {
      if (isLocalRef(v) && !refs.includes(v)) refs.push(v);
    }
  }
  return refs;
}

export async function checkFile(file) {
  const detail = { name: file.name, type: file.type, size: file.size };
  const fail = (code, cause) => new JdError(code, { cause, detail });

  const ext = /\.([^./\\]*)$/.exec(String(file.name ?? ''))?.[1]?.toLowerCase();
  if (ext === 'mhtml' || ext === 'mht') throw fail('mhtml');
  if (ext !== 'html' && ext !== 'htm') throw fail('wrong-type');
  if (file.size === 0) throw fail('empty');

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (cause) {
    throw fail('unreadable', cause);
  }

  let bytes = buffer;
  let u8 = new Uint8Array(buffer);
  if (startsWith(u8, [0xff, 0xfe]) || startsWith(u8, [0xfe, 0xff])) {
    bytes = utf16ToUtf8Bom(u8);
    u8 = new Uint8Array(bytes);
  }

  if (SIGNATURES.some((sig) => startsWith(u8, sig)) || u8.subarray(0, 4096).includes(0)) {
    throw fail('not-html');
  }

  const { text, charset } = decode(u8);

  const head = text.slice(0, 2000);
  if (/^(?:From:|MIME-Version:)/.test(text.replace(/^﻿/, '')) && head.includes('multipart/related')) {
    throw fail('mhtml');
  }
  if (!text.trim()) throw fail('empty');
  if (!LOOKS_LIKE_HTML.test(text)) throw fail('not-html');

  const doc = new DOMParser().parseFromString(text, 'text/html');
  const title = doc.title.trim() || null;
  return { bytes, charset, title, siblingRefs: siblingRefs(doc) };
}
