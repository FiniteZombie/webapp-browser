// Tiny unit-test harness. Test files import { test, assert, eq, rejects }.
// index.html imports the file named in ?file=, then calls run().

const tests = [];

export function test(name, fn) {
  tests.push({ name: String(name), fn });
}

function show(v) {
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = 'not equal') {
  const objects = (actual !== null && typeof actual === 'object')
    || (expected !== null && typeof expected === 'object');
  const same = objects
    ? show(actual) === show(expected)
    : Object.is(actual, expected);
  if (!same) throw new Error(`${msg}: expected ${show(expected)}, got ${show(actual)}`);
}

// check: a function (err) => boolean | void (false or a throw fails), a
// string (matches err.code, or is contained in err.message), or a class.
export async function rejects(promise, check) {
  let err;
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (e) {
    err = e;
  }
  if (err === undefined) throw new Error('expected a rejection, but it resolved');
  if (typeof check === 'string') {
    if (err?.code !== check && !String(err?.message ?? '').includes(check)) {
      throw new Error(`rejected with ${err?.name}: ${err?.message} (code ${err?.code}), expected ${check}`);
    }
  } else if (typeof check === 'function' && check.prototype instanceof Error || check === Error) {
    if (!(err instanceof check)) throw new Error(`rejected with ${err?.name}, expected ${check.name}`);
  } else if (typeof check === 'function') {
    if (check(err) === false) throw new Error(`rejection didn't pass the check: ${err?.name}: ${err?.message}`);
  }
  return err;
}

function errorString(e) {
  if (e && e.stack) return String(e.stack);
  return String(e);
}

export async function run(file) {
  const results = [];
  window.__results = results;
  for (const t of tests) {
    window.__current = t.name;
    try {
      await t.fn();
      results.push({ name: t.name, ok: true, error: null });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: errorString(e) });
    }
  }
  window.__current = null;
  if (!tests.length) results.push({ name: `${file}: no tests`, ok: false, error: 'the file registered no tests' });
  window.__done = { results };
}
