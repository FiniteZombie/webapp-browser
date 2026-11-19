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

  // Taken before the page's own code can replace any of them.
  var selfSource = '';
  try { selfSource = String(pageShim); } catch (e) { /* no rewrapping then */ }
  var RealXHR = win.XMLHttpRequest;
  var RealBlob = win.Blob;
  var makeUrl = win.URL.createObjectURL;
  var RealURL = win.URL;
  var loc = win.location;
  var later = win.setTimeout;
  var MARK = typeof Symbol === 'function' ? Symbol('junkDrawerShim') : '__junkDrawerShim';

  function warn(text) {
    try { win.console.warn('Junk Drawer: ' + text); } catch (e) { /* no console */ }
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

    // One stand-in per realm (the page, and any blank window it opens), all
    // over the same entries, so instanceof Storage holds in each.
    var views = [];
    return function viewFor(proto) {
      for (var vi = 0; vi < views.length; vi++) {
        if (views[vi][0] === proto) return views[vi][1];
      }
      var made = makeView(proto);
      views.push([proto, made]);
      return made;
    };

    function makeView(proto) {
      var target = Object.create(proto);

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
  }

  var localFor = makeStorage(
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

  var sessionFor = makeStorage(
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

  // Puts the stand-ins in place of w's own storage (w is this window or a
  // blank window the page opened, whose realm has its own Storage).
  function installStorage(w) {
    var proto = w.Storage.prototype;
    var l = localFor(proto);
    var ss = sessionFor(proto);
    Object.defineProperty(w, 'localStorage', { get: function () { return l; }, configurable: true });
    Object.defineProperty(w, 'sessionStorage', { get: function () { return ss; }, configurable: true });
  }
  installStorage(win);

  // 4. indexedDB: the real thing, every name prefixed. patchIdb(w) does it
  // in w's realm, once.
  var prefix = String(boot.dbPrefix);
  function patchIdb(w) {
    var Factory = w.IDBFactory && w.IDBFactory.prototype;
    var DbProto = w.IDBDatabase && w.IDBDatabase.prototype;
    if (Factory && DbProto && !hasOwn.call(Factory, MARK)) {
      Object.defineProperty(Factory, MARK, { value: true });
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
  }
  try { patchIdb(win); } catch (e) { /* leave indexedDB as it is rather than break the page */ }

  // 5. Leaving the page.
  //
  // A blob:, about: or filesystem: URL gives a document with this page's
  // origin and no shim: the real localStorage, sessionStorage and the
  // unprefixed indexedDB (Junk Drawer's own database included). None of
  // them may load without the shim, in this frame or in a window the page
  // opens. An HTML blob in this frame is reloaded with the shim put in;
  // the rest are stopped.
  var realWinOpen = win.open;

  function schemeOf(href) {
    try { return new RealURL(href).protocol; } catch (e) { return ''; }
  }
  function ownOrigin(scheme) {
    return scheme === 'blob:' || scheme === 'about:' || scheme === 'filesystem:';
  }

  function latin1(u8, from, to) {
    var out = '';
    for (var i = from; i < to && i < u8.length; i += 8192) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(to, u8.length, i + 8192)));
    }
    return out;
  }

  // The same scan as doctypeEnd in inject.js (this function can't import).
  function doctypeAt(u8) {
    var head = latin1(u8, 0, 65536);
    var start = head.slice(0, 3) === '\xEF\xBB\xBF' ? 3 : 0;
    var opener = '\x3c!--';
    var i = start;
    for (;;) {
      var c = head.charAt(i);
      if (c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' ') { i++; continue; }
      if (head.slice(i, i + 4) === opener) {
        var close = head.indexOf('-->', i + 4);
        if (close < 0) return start;
        i = close + 3;
        continue;
      }
      break;
    }
    if (head.slice(i, i + 9).toLowerCase() !== '<!doctype') return start;
    var gt = head.indexOf('>', i + 9);
    return gt < 0 ? start : gt + 1;
  }

  // Reads a blob: URL while the event is still being handled (the page may
  // revoke it straight after). null when it can't be read.
  function readBlob(href) {
    try {
      var x = new RealXHR();
      x.open('GET', href, false);
      x.overrideMimeType('text/plain; charset=x-user-defined');
      x.send();
      if (x.status !== 200) return null;
      var t = x.responseText;
      var u8 = new Uint8Array(t.length);
      for (var i = 0; i < t.length; i++) u8[i] = t.charCodeAt(i) & 255;
      return { bytes: u8, type: String(x.getResponseHeader('content-type') || '') };
    } catch (e) {
      return null;
    }
  }

  var shimHead = '<script>(' + selfSource + ')(';

  // 'allow' (already has the shim, or can't run scripts), 'wrap' (HTML that
  // needs the shim) or 'stop'.
  function blobVerdict(blob) {
    if (!blob) return 'stop';
    var at = doctypeAt(blob.bytes);
    if (selfSource && latin1(blob.bytes, at, at + shimHead.length) === shimHead) return 'allow';
    var mime = blob.type.split(';')[0].replace(/^\s+|\s+$/g, '').toLowerCase();
    if (mime === '' || mime === 'text/html') return selfSource ? 'wrap' : 'stop';
    // XHTML, SVG and other XML can run scripts and can't take the shim.
    if (mime.indexOf('xml') >= 0 || mime.indexOf('html') >= 0) return 'stop';
    return 'allow';
  }

  function withShim(blob) {
    var json = JSON.stringify(boot).replace(/[<\u0080-\uffff]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
    var script = shimHead + json + ');document.currentScript.remove()<' + '/script>';
    var at = doctypeAt(blob.bytes);
    var parts = [blob.bytes.subarray(0, at), script, blob.bytes.subarray(at)];
    return makeUrl.call(RealURL, new RealBlob(parts, { type: blob.type }));
  }

  // A link to blob:, about: or filesystem: that would open in another
  // window (or anywhere, with anyTarget).
  function linkToOtherWindow(el, event, anyTarget) {
    try {
      if (!el || (el.localName !== 'a' && el.localName !== 'area')) return false;
      var raw = el.getAttribute('href');
      if (raw === null || el.hasAttribute('download')) return false;
      if (!ownOrigin(schemeOf(new RealURL(raw, el.baseURI).href))) return false;
      if (anyTarget) return true;
      var target = el.getAttribute('target');
      if (target === null) {
        var base = el.ownerDocument.querySelector('base[target]');
        target = base ? base.getAttribute('target') : '';
      }
      target = String(target).toLowerCase();
      if (event && (event.type === 'auxclick' || event.ctrlKey || event.shiftKey || event.metaKey)) return true;
      return target !== '' && target !== '_self' && target !== '_parent' && target !== '_top';
    } catch (e) {
      return false;
    }
  }

  // Applied to this window and to every blank window the page opens.
  function guardWindow(w, own) {
    if (hasOwn.call(w, MARK)) return;
    Object.defineProperty(w, MARK, { value: true });
    if (!own) {
      installStorage(w);
      patchIdb(w);
    }

    var openIn = own ? realWinOpen : w.open;
    if (typeof openIn === 'function') {
      w.open = function open(url) {
        var target = arguments.length > 1 && arguments[1] !== undefined ? String(arguments[1]).toLowerCase() : '_blank';
        if (target === '_self' || target === '_parent' || target === '_top') return openIn.apply(w, arguments);
        var raw = url === undefined ? '' : String(url);
        var scheme = raw === '' ? 'about:' : '';
        if (!scheme) {
          try { scheme = new RealURL(raw, w.document.baseURI).protocol; } catch (e) { return openIn.apply(w, arguments); }
        }
        if (scheme === 'blob:' || scheme === 'filesystem:') {
          warn('a ' + scheme + ' window would run without private storage, so it was not opened');
          return null;
        }
        var opened = openIn.apply(w, arguments);
        if (opened && scheme === 'about:') {
          try {
            guardWindow(opened, false);
          } catch (e) {
            try { opened.close(); } catch (e2) { /* nothing more to do */ }
            warn('a blank window could not be given private storage, so it was closed');
            return null;
          }
        }
        return opened;
      };
    }

    var refuseLink = function (event) {
      try {
        var el = event.target;
        while (el && el.localName !== 'a' && el.localName !== 'area') el = el.parentNode;
        if (el && linkToOtherWindow(el, event, !own)) {
          event.preventDefault();
          warn('a link to ' + schemeOf(el.href) + ' in another window was not followed');
        }
      } catch (e) { /* let it be */ }
    };
    w.addEventListener('click', refuseLink, true);
    w.addEventListener('auxclick', refuseLink, true);
    var EP = w.HTMLElement && w.HTMLElement.prototype;
    if (EP && typeof EP.click === 'function') {
      var realClick = EP.click;
      // A link that was never added to the document: no event reaches w.
      EP.click = function click() {
        if ((!own || !this.isConnected) && linkToOtherWindow(this, null, !own)) {
          warn('a link to ' + schemeOf(this.href) + ' in another window was not followed');
          return;
        }
        return realClick.apply(this, arguments);
      };
    }

    // No navigate guard for a blank window: Chrome fires no navigate event
    // in a window that started as the initial about:blank, even after
    // document.open(). So a script that sends it to blob: isn't stopped.
  }

  try { guardWindow(win, true); } catch (e) { /* no window.open guard */ }

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
          if (ownOrigin(url.protocol)) {
            var blob = url.protocol === 'blob:' ? readBlob(url.href) : null;
            var verdict = url.protocol === 'blob:' ? blobVerdict(blob) : 'stop';
            if (verdict === 'allow' || !event.cancelable) return;
            event.preventDefault();
            if (verdict === 'wrap') {
              var wrapped = withShim(blob);
              var replace = event.navigationType !== 'push';
              later.call(win, function () {
                try {
                  if (replace) loc.replace(wrapped);
                  else loc.assign(wrapped);
                } catch (e) { /* the page stays */ }
              }, 0);
            } else {
              warn('a ' + url.protocol + ' document would run without private storage, so it was not opened');
            }
            return;
          }
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
            safe(function () { realWinOpen.call(win, href, '_blank', 'noopener'); });
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
