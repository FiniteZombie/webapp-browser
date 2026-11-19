// The page shim (WP4). pageShim is turned into text with toString() and
// injected by the service worker straight after the page's doctype, so it
// must stay self-contained: no imports, nothing from outside its own body.
// Plain ES2020, ASCII only, and the source never contains a closing script
// tag or an HTML comment opener.

export function pageShim(boot) {
  'use strict';

  var win = window;
  var doc = document;

  // Calls into the host must never throw into the page's own code.
  function safe(fn) {
    try { fn(); } catch (e) { /* the host failed; the page carries on */ }
  }

  // 1. Find the host.
  var host = null;
  try {
    if (win.parent && win.parent !== win) {
      var hostObj = win.parent[boot.hostGlobal];
      if (hostObj && typeof hostObj.connect === 'function') {
        host = hostObj.connect(boot.pageId);
      }
    }
  } catch (e) {
    host = null;
  }
  if (!host) {
    try { win.stop(); } catch (e) { /* keep going: the throw below still stops this script */ }
    try {
      doc.documentElement.innerHTML =
        '<head><meta charset="utf-8"><title>Junk Drawer</title></head>' +
        '<body><p>open this page from Junk Drawer</p></body>';
    } catch (e) { /* nothing more to do */ }
    throw new Error('Junk Drawer: no host for this page');
  }

  function notify(type, data) {
    safe(function () {
      if (data === undefined) host.notify(type);
      else host.notify(type, data);
    });
  }

  function readEntries(list) {
    var out = [];
    try {
      if (list && typeof list.length === 'number') {
        for (var i = 0; i < list.length; i++) {
          var pair = list[i];
          if (pair) out.push([String(pair[0]), String(pair[1])]);
        }
      }
    } catch (e) { /* start from what was read */ }
    return out;
  }

  var StorageProto = win.Storage.prototype;
  var hasOwn = Object.prototype.hasOwnProperty;

  // 2 and 3. A stand-in for localStorage or sessionStorage.
  // report(op, key, value) tells the host; quota is null for no limit.
  function makeStorage(entries, report, quota, apiName) {
    var map = new Map();
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      var k0 = entries[i][0];
      var v0 = entries[i][1];
      if (map.has(k0)) total -= k0.length + map.get(k0).length;
      map.set(k0, v0);
      total += k0.length + v0.length;
    }

    function quotaError(message) {
      var QE = win.QuotaExceededError;
      if (typeof QE === 'function') {
        try { return new QE(message); } catch (e) { /* fall back below */ }
      }
      return new win.DOMException(message, 'QuotaExceededError');
    }

    var methods = {
      getItem: function getItem(key) {
        if (arguments.length < 1) throw new TypeError("Failed to execute 'getItem' on 'Storage': 1 argument required, but only 0 present.");
        key = String(key);
        return map.has(key) ? map.get(key) : null;
      },
      setItem: function setItem(key, value) {
        if (arguments.length < 2) throw new TypeError("Failed to execute 'setItem' on 'Storage': 2 arguments required, but only " + arguments.length + ' present.');
        key = String(key);
        value = String(value);
        var old = map.has(key) ? map.get(key) : null;
        var next = total - (old === null ? 0 : key.length + old.length) + key.length + value.length;
        if (quota !== null && next > quota && next > total) {
          var detail = 'setItem refused: key "' + (key.length > 80 ? key.slice(0, 80) + '...' : key) +
            '" with ' + value.length + ' value chars would bring the total to ' + next +
            ' chars, over the limit of ' + quota;
          notify('store-refused', { api: apiName, detail: detail });
          throw quotaError("Failed to execute 'setItem' on 'Storage': Setting the value of '" + key + "' exceeded the quota.");
        }
        map.set(key, value);
        total = next;
        report('set', key, value);
      },
      removeItem: function removeItem(key) {
        if (arguments.length < 1) throw new TypeError("Failed to execute 'removeItem' on 'Storage': 1 argument required, but only 0 present.");
        key = String(key);
        if (!map.has(key)) return;
        total -= key.length + map.get(key).length;
        map.delete(key);
        report('remove', key);
      },
      clear: function clear() {
        if (map.size === 0) return;
        map.clear();
        total = 0;
        report('clear');
      },
      key: function key(index) {
        if (arguments.length < 1) throw new TypeError("Failed to execute 'key' on 'Storage': 1 argument required, but only 0 present.");
        var n = Number(index);
        n = isFinite(n) ? Math.trunc(n) : 0;
        // WebIDL unsigned long: wrap modulo 2^32.
        n = ((n % 4294967296) + 4294967296) % 4294967296;
        if (n >= map.size) return null;
        var i2 = 0;
        var found = null;
        map.forEach(function (v, k) {
          if (i2 === n) found = k;
          i2++;
        });
        return found;
      },
    };

    var target = Object.create(StorageProto);

    // A stored key is visible as a property only when nothing on the
    // prototype chain has that name (as with the real Storage).
    function visible(prop) {
      return typeof prop === 'string' && map.has(prop) && !(prop in target);
    }

    var proxy = new Proxy(target, {
      get: function (t, prop, receiver) {
        if (typeof prop === 'string') {
          if (hasOwn.call(methods, prop)) return methods[prop];
          if (prop === 'length') return map.size;
          if (visible(prop)) return map.get(prop);
          if (!(prop in t)) return undefined;
        }
        return Reflect.get(t, prop, receiver === proxy ? t : receiver);
      },
      set: function (t, prop, value) {
        if (typeof prop === 'string') {
          methods.setItem(prop, value);
          return true;
        }
        return Reflect.set(t, prop, value);
      },
      defineProperty: function (t, prop, desc) {
        if (typeof prop === 'string') {
          if (desc && 'value' in desc) methods.setItem(prop, desc.value);
          return true;
        }
        return Reflect.defineProperty(t, prop, desc);
      },
      deleteProperty: function (t, prop) {
        if (visible(prop)) {
          methods.removeItem(prop);
          return true;
        }
        return Reflect.deleteProperty(t, prop);
      },
      has: function (t, prop) {
        if (typeof prop === 'string' && map.has(prop)) return true;
        return Reflect.has(t, prop);
      },
      ownKeys: function (t) {
        var keys = [];
        map.forEach(function (v, k) {
          if (!(k in t)) keys.push(k);
        });
        var own = Reflect.ownKeys(t);
        for (var j = 0; j < own.length; j++) {
          if (keys.indexOf(own[j]) < 0) keys.push(own[j]);
        }
        return keys;
      },
      getOwnPropertyDescriptor: function (t, prop) {
        if (visible(prop)) {
          return { value: map.get(prop), writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, prop);
      },
    });
    return proxy;
  }

  var local = makeStorage(
    readEntries(host.entries),
    function (op, key, value) {
      safe(function () {
        if (op === 'clear') host.apply(op);
        else if (op === 'remove') host.apply(op, key);
        else host.apply(op, key, value);
      });
    },
    typeof boot.quotaChars === 'number' ? boot.quotaChars : null,
    'localStorage'
  );
  Object.defineProperty(win, 'localStorage', {
    get: function () { return local; },
    configurable: true,
  });

  var session = makeStorage(
    readEntries(host.sessionEntries),
    function (op, key, value) {
      safe(function () {
        if (op === 'clear') host.applySession(op);
        else if (op === 'remove') host.applySession(op, key);
        else host.applySession(op, key, value);
      });
    },
    null,
    'sessionStorage'
  );
  Object.defineProperty(win, 'sessionStorage', {
    get: function () { return session; },
    configurable: true,
  });

  // 4. indexedDB: the real thing, every name prefixed.
  var prefix = String(boot.dbPrefix);
  try {
    var Factory = win.IDBFactory && win.IDBFactory.prototype;
    var DbProto = win.IDBDatabase && win.IDBDatabase.prototype;
    if (Factory && DbProto) {
      var realOpen = Factory.open;
      var realDelete = Factory.deleteDatabase;
      var realDatabases = Factory.databases;
      var nameDesc = Object.getOwnPropertyDescriptor(DbProto, 'name');
      var slice = Array.prototype.slice;
      var noticed = new WeakSet();

      var refused = function (where, err) {
        notify('store-refused', {
          api: 'indexedDB',
          detail: where + ': ' + String(err && err.name) + ': ' + String(err && err.message),
        });
      };

      // Bubbled up to the database from a request or transaction.
      var onDbProblem = function (event) {
        try {
          var t = event.target;
          var err = t && t.error;
          if (!err || err.name !== 'QuotaExceededError') return;
          var tx = t.transaction || t;
          if (noticed.has(tx)) return;
          noticed.add(tx);
          refused('transaction ' + event.type, err);
        } catch (e) { /* never interfere with the page */ }
      };

      var watchDb = function (req) {
        try {
          var db = req.result;
          if (db) {
            // The same listener function is only ever added once per target.
            db.addEventListener('error', onDbProblem);
            db.addEventListener('abort', onDbProblem);
          }
        } catch (e) { /* not ready yet */ }
      };

      var renamed = function (args) {
        var a = slice.call(args);
        if (a.length > 0) a[0] = prefix + String(a[0]);
        return a;
      };

      Factory.open = function open(name) {
        var req = realOpen.apply(this, renamed(arguments));
        try {
          req.addEventListener('error', function () {
            try {
              var err = req.error;
              if (err && err.name === 'QuotaExceededError') refused('open', err);
            } catch (e) { /* ignore */ }
          });
          req.addEventListener('upgradeneeded', function () { watchDb(req); });
          req.addEventListener('success', function () { watchDb(req); });
        } catch (e) { /* the request still goes to the page */ }
        return req;
      };

      Factory.deleteDatabase = function deleteDatabase(name) {
        return realDelete.apply(this, renamed(arguments));
      };

      if (typeof realDatabases === 'function') {
        Factory.databases = function databases() {
          return realDatabases.apply(this, arguments).then(function (list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
              var info = list[i];
              if (info && typeof info.name === 'string' && info.name.indexOf(prefix) === 0) {
                out.push({ name: info.name.slice(prefix.length), version: info.version });
              }
            }
            return out;
          });
        };
      }

      if (nameDesc && typeof nameDesc.get === 'function') {
        var realName = nameDesc.get;
        Object.defineProperty(DbProto, 'name', {
          get: function name() {
            var n = realName.call(this);
            return typeof n === 'string' && n.indexOf(prefix) === 0 ? n.slice(prefix.length) : n;
          },
          enumerable: nameDesc.enumerable,
          configurable: true,
        });
      }
    }
  } catch (e) { /* leave indexedDB as it is rather than break the page */ }

  // 5. Leaving the page.
  try {
    var nav = win.navigation;
    if (nav && typeof nav.addEventListener === 'function') {
      nav.addEventListener('navigate', function (event) {
        try {
          if (event.hashChange) return;
          if (event.downloadRequest !== null && event.downloadRequest !== undefined) return;
          var dest = event.destination;
          if (!dest || dest.sameDocument) return;
          var url = new URL(dest.url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
          var here = new URL(win.location.href);
          var sameOrigin = url.origin === win.location.origin;
          if (sameOrigin && url.pathname === here.pathname) return;
          if (!event.cancelable) return;
          event.preventDefault();
          var href = url.href;
          if (sameOrigin) {
            notify('missing-file', { url: href });
          } else if (event.userInitiated) {
            safe(function () { win.open(href, '_blank', 'noopener'); });
          } else {
            notify('external-nav', { url: href });
          }
        } catch (e) { /* let the navigation be */ }
      });
    }
  } catch (e) { /* no Navigation API: nothing to guard */ }

  // 6.
  notify('ready');
}
