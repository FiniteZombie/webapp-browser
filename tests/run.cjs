'use strict';
// Headless test runner. See tests/README.md.
//   node tests/run.cjs [--only a,b] [--unit | --e2e] [--verbose]

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./server.cjs');
const helpers = require('./e2e/helpers.cjs');

const UNIT_DIR = path.join(__dirname, 'unit');
const E2E_DIR = path.join(__dirname, 'e2e');
const UNIT_TIMEOUT = 30_000;
const E2E_TIMEOUT = 20_000;
const PARALLEL = 4;
const MAX_FAILS = 10;
const MAX_WALL = 8 * 60_000;
const HARD_WALL = MAX_WALL + 60_000;
const ERROR_LINES = 12;
const PAGE_ERRORS = 5;
const VIEWPORT = { width: 412, height: 915 };

function parseArgs(argv) {
  const a = { only: [], unit: false, e2e: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--only') a.only.push(...String(argv[++i] ?? '').split(','));
    else if (v.startsWith('--only=')) a.only.push(...v.slice(7).split(','));
    else if (v === '--unit') a.unit = true;
    else if (v === '--e2e') a.e2e = true;
    else if (v === '--verbose') a.verbose = true;
    else { console.error(`unknown argument: ${v}`); process.exit(2); }
  }
  a.only = a.only.map((s) => s.trim()).filter(Boolean);
  if (!a.unit && !a.e2e) { a.unit = true; a.e2e = true; }
  return a;
}

function discover(args) {
  const list = (dir, suffix, kind) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => f.endsWith(suffix)).sort()
    .map((f) => ({ kind, name: f, rel: `${kind}/${f}` }));
  let files = [];
  if (args.unit) files.push(...list(UNIT_DIR, '.test.js', 'unit'));
  if (args.e2e) files.push(...list(E2E_DIR, '.e2e.cjs', 'e2e'));
  if (args.only.length) files = files.filter((f) => args.only.some((o) => f.name.includes(o)));
  return files;
}

const firstLine = (s) => String(s).split('\n')[0].slice(0, 300);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const state = { total: 0, failed: 0, stopped: '', browser: null, servers: new Set(), finished: false };
  const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

  const stopCheck = () => {
    if (state.stopped) return true;
    if (state.failed >= MAX_FAILS) state.stopped = `${MAX_FAILS} failed tests`;
    else if (Date.now() - t0 > MAX_WALL) state.stopped = '8 minutes of wall time';
    return Boolean(state.stopped);
  };

  const report = (file, name, ok, error, pageErrors = []) => {
    state.total++;
    if (ok) {
      if (args.verbose) console.log(`ok   ${file}: ${name}`);
      return;
    }
    state.failed++;
    const lines = [`FAIL ${file}: ${name}`];
    const errLines = String(error ?? 'failed').split('\n').filter((l) => l.trim() !== '');
    if (errLines.length > ERROR_LINES) {
      lines.push(...errLines.slice(0, ERROR_LINES - 1).map((l) => `  ${l}`));
      lines.push(`  … ${errLines.length - ERROR_LINES + 1} more lines`);
    } else {
      lines.push(...errLines.map((l) => `  ${l}`));
    }
    if (pageErrors.length) {
      lines.push('  page errors:');
      lines.push(...pageErrors.slice(0, PAGE_ERRORS).map((l) => `    ${firstLine(l)}`));
    }
    console.log(lines.join('\n'));
  };

  const newServer = async () => {
    const s = await start();
    state.servers.add(s);
    return s;
  };
  const closeServer = async (s) => {
    state.servers.delete(s);
    await s.close().catch(() => {});
  };

  const newContext = async () => {
    const context = await state.browser.newContext({ viewport: VIEWPORT });
    const errors = [];
    context.on('weberror', (e) => errors.push(`uncaught: ${e.error()?.stack || e.error()}`));
    context.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    return { context, errors };
  };

  const withTimeout = (promise, ms, what) => {
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(`timed out after ${ms / 1000} s: ${what}`);
        e.stack = e.message;
        reject(e);
      }, ms);
    });
    promise.catch(() => {});
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  };

  async function runUnit(f) {
    const server = await newServer();
    const { context, errors } = await newContext();
    try {
      const page = await context.newPage();
      const url = `${server.url}tests/unit/index.html?file=${encodeURIComponent(f.name)}`;
      let done;
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.__done, null, { timeout: UNIT_TIMEOUT });
        done = await page.evaluate(() => window.__done);
      } catch (e) {
        const partial = await page.evaluate(() => ({ results: window.__results || [], current: window.__current }))
          .catch(() => ({ results: [], current: null }));
        for (const r of partial.results) report(f.rel, r.name, r.ok, r.error, r.ok ? [] : errors);
        const where = partial.current ? ` (in test "${partial.current}")` : '';
        report(f.rel, partial.current || '(file)', false,
          /Timeout/i.test(String(e?.message)) ? `timed out after ${UNIT_TIMEOUT / 1000} s${where}` : String(e?.stack || e), errors);
        return;
      }
      for (const r of done.results) report(f.rel, r.name, r.ok, r.error, r.ok ? [] : errors);
    } finally {
      await context.close().catch(() => {});
      await closeServer(server);
    }
  }

  async function runE2e(f) {
    let tests;
    try {
      const mod = path.join(E2E_DIR, f.name);
      delete require.cache[require.resolve(mod)];
      tests = require(mod);
      if (!Array.isArray(tests)) throw new Error('module.exports is not an array of tests');
    } catch (e) {
      report(f.rel, '(load)', false, String(e?.stack || e));
      return;
    }
    for (const test of tests) {
      if (stopCheck()) return;
      const name = test?.name || '(unnamed)';
      const server = await newServer();
      const { context, errors } = await newContext();
      try {
        const t = {
          context, server, appUrl: server.appUrl, helpers,
          openApp: (opts) => helpers.openApp(context, server.appUrl, opts),
        };
        await withTimeout(Promise.resolve().then(() => test.run(t)), E2E_TIMEOUT, name);
        report(f.rel, name, true);
      } catch (e) {
        report(f.rel, name, false, String(e?.stack || e), errors);
      } finally {
        await withTimeout(context.close(), 5000, 'closing the context').catch(() => {});
        await closeServer(server);
      }
    }
  }

  async function cleanup() {
    const servers = [...state.servers];
    state.servers.clear();
    await Promise.all(servers.map((s) => s.close().catch(() => {})));
    if (state.browser) {
      const b = state.browser;
      state.browser = null;
      await withTimeout(b.close(), 10_000, 'closing the browser').catch(() => {});
    }
  }

  function finish(extra) {
    if (state.finished) return;
    state.finished = true;
    const stopped = state.stopped || extra;
    const pass = !stopped && state.failed === 0 && state.total > 0;
    const suffix = stopped ? ` (stopped early: ${stopped})` : state.total === 0 ? ' (no tests found)' : '';
    console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'} ${pass ? `${state.total}/${state.total}` : `${state.failed}/${state.total}`} (${elapsed()})${suffix}`);
    process.exitCode = pass ? 0 : 1;
  }

  const hard = setTimeout(async () => {
    state.stopped = state.stopped || 'hard time limit';
    await cleanup();
    finish();
    process.exit(1);
  }, HARD_WALL);
  hard.unref();

  const onSignal = async (sig) => {
    state.stopped = state.stopped || `interrupted (${sig})`;
    await cleanup();
    finish();
    process.exit(1);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  (async () => {
    try {
      const files = discover(args);
      if (!files.length) {
        console.log(`no test files matched${args.only.length ? ` --only ${args.only.join(',')}` : ''}`);
        return;
      }
      state.browser = await chromium.launch();
      const queue = [...files];
      const worker = async () => {
        while (queue.length && !stopCheck()) {
          const f = queue.shift();
          try {
            if (f.kind === 'unit') await runUnit(f);
            else await runE2e(f);
          } catch (e) {
            report(f.rel, '(runner)', false, String(e?.stack || e));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
    } catch (e) {
      console.log(`runner crashed: ${e?.stack || e}`);
      state.stopped = state.stopped || 'runner crashed';
    } finally {
      await cleanup();
      clearTimeout(hard);
      finish();
    }
  })();
}

main();
