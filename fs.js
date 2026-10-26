/* JammyOS file system.
   A tree of folders and text documents, saved as one record in chrome.storage.local
   (falls back to localStorage when the page isn't running as an extension).
   Shared by the Files app and the terminal. */
(() => {
  'use strict';

  const KEY = 'jammyosFS';
  const HOME = '/home/jammy';
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const me = Math.random().toString(36).slice(2);   // tells this tab's writes apart from other tabs'
  const listeners = [];
  let root = null, timer = null, dirty = false;

  const now = () => Date.now();
  const newDir = () => ({ t: 'd', c: {}, m: now() });
  const newFile = (d) => ({ t: 'f', d: d || '', m: now() });
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const bytes = (s) => new TextEncoder().encode(s).length;

  function fail(path, msg) { throw new Error(path + ': ' + msg); }

  /* ---------- paths ---------- */
  function parts(path, cwd) {
    let p = String(path == null ? '' : path).trim();
    if (!p) p = '.';
    if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
    if (p[0] !== '/') p = (cwd || HOME) + '/' + p;
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop(); else out.push(s);
    }
    return out;
  }
  const abs = (segs) => '/' + segs.join('/');
  function walk(segs) {
    let n = root;
    for (const s of segs) {
      if (n.t !== 'd' || !has(n.c, s)) return null;
      n = n.c[s];
    }
    return n;
  }
  function validName(n) { return !!n && n !== '.' && n !== '..' && n !== '__proto__' && !/[\\/\0]/.test(n); }
  function checkName(n, path) { if (!validName(n)) fail(path, 'that name is not allowed'); }
  function need(path, cwd) {
    const segs = parts(path, cwd), node = walk(segs);
    if (!node) fail(path, 'no such file or directory');
    return { segs, node };
  }
  function info(segs, n) {
    return {
      name: segs.length ? segs[segs.length - 1] : '/',
      path: abs(segs),
      type: n.t === 'd' ? 'dir' : 'file',
      size: n.t === 'f' ? bytes(n.d) : undefined,
      count: n.t === 'd' ? Object.keys(n.c).length : undefined,
      mtime: n.m
    };
  }
  const byKind = (a, b) => a.type === b.type
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : (a.type === 'dir' ? -1 : 1);
  const isInside = (child, parent) => child.length >= parent.length && parent.every((x, i) => child[i] === x);

  /* ---------- saving ---------- */
  function persistNow() {
    clearTimeout(timer);
    dirty = false;
    const payload = { root, writer: me, rev: now() };
    try {
      if (hasChrome) chrome.storage.local.set({ [KEY]: payload });
      else localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (e) { console.warn('JammyFS save failed', e); }
  }
  function changed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(persistNow, 250);
    listeners.slice().forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }
  window.addEventListener('pagehide', () => { if (dirty) persistNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) persistNow(); });

  // another new-tab page changed the files: take its version
  if (hasChrome && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch[KEY]) return;
      const v = ch[KEY].newValue;
      if (!v || v.writer === me || !v.root || v.root.t !== 'd') return;
      root = v.root;
      listeners.slice().forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    });
  }

  /* ---------- first run ---------- */
  function seed() {
    const r = newDir();
    const home = newDir();
    r.c.home = newDir();
    r.c.home.c.jammy = home;
    home.c.Documents = newDir();
    home.c.Notes = newDir();
    home.c.Documents.c['welcome.txt'] = newFile(
      'Welcome to JammyOS.\n\n' +
      'This is a small file system that lives inside your browser. Documents you save here stay in this browser profile, even after a restart.\n\n' +
      'Things to try:\n' +
      '  - Open Files from the taskbar and make a new document.\n' +
      '  - Open Terminal and type help.\n' +
      '  - Back everything up with Export backup in Settings.\n'
    );
    return r;
  }
  function ensureHome() {
    let n = root;
    for (const s of ['home', 'jammy', 'Documents']) {
      if (!has(n.c, s) || n.c[s].t !== 'd') n.c[s] = newDir();
      n = n.c[s];
    }
    const h = walk(['home', 'jammy']);
    if (!has(h.c, 'Notes')) h.c.Notes = newDir();
  }

  const ready = (async () => {
    let saved = null;
    try {
      if (hasChrome) saved = (await chrome.storage.local.get(KEY))[KEY];
      else saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) { console.warn('JammyFS load failed', e); }
    if (saved && saved.root && saved.root.t === 'd') root = saved.root;
    else { root = seed(); persistNow(); }
    ensureHome();
  })();

  /* ---------- public API ---------- */
  const api = {
    HOME, ready,
    onChange(fn) { listeners.push(fn); },

    resolve(path, cwd) { return abs(parts(path, cwd)); },
    stat(path, cwd) {
      const segs = parts(path, cwd), n = walk(segs);
      return n ? info(segs, n) : null;
    },
    list(path, cwd) {
      const { segs, node } = need(path, cwd);
      if (node.t !== 'd') fail(path, 'not a directory');
      return Object.keys(node.c).map((k) => info(segs.concat(k), node.c[k])).sort(byKind);
    },
    read(path, cwd) {
      const { node } = need(path, cwd);
      if (node.t === 'd') fail(path, 'is a directory');
      return node.d;
    },
    write(path, text, opts, cwd) {
      const segs = parts(path, cwd);
      if (!segs.length) fail(path, 'is a directory');
      const name = segs[segs.length - 1];
      checkName(name, path);
      const parent = walk(segs.slice(0, -1));
      if (!parent) fail(path, 'no such file or directory');
      if (parent.t !== 'd') fail(path, 'not a directory');
      const ex = has(parent.c, name) ? parent.c[name] : null;
      if (ex && ex.t === 'd') fail(path, 'is a directory');
      text = String(text);
      if (ex) { ex.d = opts && opts.append ? ex.d + text : text; ex.m = now(); }
      else parent.c[name] = newFile(text);
      parent.m = now();
      changed();
    },
    touch(path, cwd) {
      const st = api.stat(path, cwd);
      if (!st) return api.write(path, '', {}, cwd);
      const { node } = need(path, cwd);
      node.m = now();
      changed();
    },
    mkdir(path, opts, cwd) {
      const segs = parts(path, cwd);
      if (!segs.length) fail(path, 'already exists');
      const parents = opts && opts.parents;
      let n = root;
      segs.forEach((s, i) => {
        const last = i === segs.length - 1;
        if (has(n.c, s)) {
          if (n.c[s].t !== 'd') fail(path, 'not a directory');
          if (last && !parents) fail(path, 'already exists');
        } else {
          if (!last && !parents) fail(path, 'no such file or directory (use -p to create parent folders)');
          checkName(s, path);
          n.c[s] = newDir();
          n.m = now();
        }
        n = n.c[s];
      });
      changed();
    },
    remove(path, opts, cwd) {
      const { segs, node } = need(path, cwd);
      if (!segs.length) fail(path, 'the root folder cannot be removed');
      if (node.t === 'd' && !(opts && opts.recursive)) fail(path, 'is a directory (use -r)');
      const parent = walk(segs.slice(0, -1));
      delete parent.c[segs[segs.length - 1]];
      parent.m = now();
      ensureHome();
      changed();
    },
    rename(path, newName, cwd) {
      const { segs } = need(path, cwd);
      if (!segs.length) fail(path, 'the root folder cannot be renamed');
      checkName(newName, newName);
      const parent = walk(segs.slice(0, -1));
      const old = segs[segs.length - 1];
      if (newName === old) return;
      if (has(parent.c, newName)) fail(newName, 'already exists');
      parent.c[newName] = parent.c[old];
      delete parent.c[old];
      parent.c[newName].m = now();
      ensureHome();
      changed();
    },
    move(src, dst, cwd) {
      const s = need(src, cwd);
      if (!s.segs.length) fail(src, 'the root folder cannot be moved');
      const d = parts(dst, cwd), dn = walk(d);
      const target = dn && dn.t === 'd' ? d.concat(s.segs[s.segs.length - 1]) : d;
      if (target.join('/') === s.segs.join('/')) return;
      if (s.node.t === 'd' && isInside(target, s.segs)) fail(dst, 'a folder cannot be moved into itself');
      if (!target.length) fail(dst, 'already exists');
      const name = target[target.length - 1];
      checkName(name, dst);
      const parent = walk(target.slice(0, -1));
      if (!parent) fail(dst, 'no such file or directory');
      if (parent.t !== 'd') fail(dst, 'not a directory');
      if (has(parent.c, name)) fail(dst, 'already exists');
      const from = walk(s.segs.slice(0, -1));
      delete from.c[s.segs[s.segs.length - 1]];
      parent.c[name] = s.node;
      from.m = parent.m = now();
      ensureHome();
      changed();
    },
    copy(src, dst, opts, cwd) {
      const s = need(src, cwd);
      if (s.node.t === 'd' && !(opts && opts.recursive)) fail(src, 'is a directory (use -r)');
      const d = parts(dst, cwd), dn = walk(d);
      const target = dn && dn.t === 'd' ? d.concat(s.segs[s.segs.length - 1] || 'copy') : d;
      if (s.node.t === 'd' && isInside(target, s.segs)) fail(dst, 'a folder cannot be copied into itself');
      if (!target.length) fail(dst, 'already exists');
      const name = target[target.length - 1];
      checkName(name, dst);
      const parent = walk(target.slice(0, -1));
      if (!parent) fail(dst, 'no such file or directory');
      if (parent.t !== 'd') fail(dst, 'not a directory');
      if (has(parent.c, name)) fail(dst, 'already exists');
      const copy = JSON.parse(JSON.stringify(s.node));
      copy.m = now();
      parent.c[name] = copy;
      parent.m = now();
      changed();
    },
    unique(dirPath, name, cwd) {
      const { node } = need(dirPath, cwd);
      if (node.t !== 'd') fail(dirPath, 'not a directory');
      if (!has(node.c, name)) return name;
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      let i = 2, n;
      do { n = base + ' (' + (i++) + ')' + ext; } while (has(node.c, n));
      return n;
    },
    usage() {
      let files = 0, dirs = 0, size = 0;
      (function count(n) {
        Object.keys(n.c).forEach((k) => {
          const c = n.c[k];
          if (c.t === 'd') { dirs++; count(c); } else { files++; size += bytes(c.d); }
        });
      })(root);
      return { files, dirs, bytes: size };
    },
    validName,

    dump() { return root; },
    restore(tree) {
      if (!tree || tree.t !== 'd' || typeof tree.c !== 'object') throw new Error('That backup has no documents in it.');
      root = tree;
      ensureHome();
      changed();
    }
  };

  window.JammyFS = api;
})();
