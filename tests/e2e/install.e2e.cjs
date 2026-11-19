'use strict';
// WP6: manifest, icons and the manifest link.

const assert = require('assert/strict');

async function manifest(t) {
  const res = await fetch(t.appUrl + 'manifest.webmanifest');
  assert.equal(res.status, 200);
  return JSON.parse(await res.text());
}

module.exports = [
  { name: 'manifest is valid and installable in shape', run: async (t) => {
    const m = await manifest(t);
    assert.equal(m.name, 'Junk Drawer');
    assert.equal(m.display, 'standalone');
    for (const key of ['start_url', 'scope']) {
      assert.equal(typeof m[key], 'string', key);
      assert.ok(!/^([a-z][a-z0-9+.-]*:|\/)/i.test(m[key]), `${key} is relative: ${m[key]}`);
    }
    assert.ok(!('share_target' in m), 'no share_target yet');
  } },

  { name: 'every manifest icon is a PNG of the size it claims', run: async (t) => {
    const m = await manifest(t);
    assert.ok(m.icons.length >= 3);
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'has a maskable icon');
    const page = await t.openApp({ boot: false });
    for (const icon of m.icons) {
      assert.ok(!/^([a-z][a-z0-9+.-]*:|\/)/i.test(icon.src), `relative src: ${icon.src}`);
      const url = new URL(icon.src, t.appUrl + 'manifest.webmanifest').href;
      const res = await fetch(url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type') || '', /image\/png/, url);
      const sig = Buffer.from(await res.arrayBuffer()).subarray(0, 8);
      assert.deepEqual([...sig], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${url} is a PNG`);
      const [w, h] = icon.sizes.split('x').map(Number);
      const got = await page.evaluate((u) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('image failed to load'));
        img.src = u;
      }), url);
      assert.deepEqual(got, { w, h }, icon.src);
    }
  } },

  { name: 'index.html links the manifest with a relative URL', run: async (t) => {
    const page = await t.openApp({ boot: false });
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
    assert.equal(href, 'manifest.webmanifest');
  } },
];
