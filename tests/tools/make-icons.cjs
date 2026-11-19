'use strict';
// Renders app/icons/icon.svg to the three placeholder PNGs. No arguments.
//   node tests/tools/make-icons.cjs

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', '..', 'app', 'icons');

// Maskable: the whole square is filled and the letters stay inside the
// central 80% (the "JD" is about 55% of the width).
const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#8a8a8a"/>
  <text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="700" font-size="190" fill="#ffffff">JD</text>
</svg>`;

async function render(browser, svg, size, file) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const html = `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  await page.setContent(html);
  await page.screenshot({ path: file, omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

(async () => {
  const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    await render(browser, svg, 192, path.join(DIR, 'icon-192.png'));
    await render(browser, svg, 512, path.join(DIR, 'icon-512.png'));
    await render(browser, MASKABLE_SVG, 512, path.join(DIR, 'icon-maskable-512.png'));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
