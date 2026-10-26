/* JammyOS terminal. Commands work on the same file system as the Files app (see fs.js). */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const win = $('#terminal'), dock = $('#termBtn');
  if (!win || !dock || !window.JammyFS || !window.JammyWM) return;

  const FS = window.JammyFS;
  const wm = window.JammyWM.setup(win, $('#tmTitle'));
  const screen = $('#tmScreen'), out = $('#tmOut'), input = $('#tmIn'), promptEl = $('#tmPrompt');
  const USER = 'jammy', HOST = 'jammyos';
  const started = Date.now();

  let cwd = FS.HOME, oldcwd = FS.HOME;
  const history = [];
  let hpos = 0, draft = '', lastTab = '';

  /* ---------------- output ---------------- */
  const A = (t, c) => ({ t, c });
  const plain = (p) => (typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.t)).join(''));
  function lineEl(parts) {
    const d = document.createElement('div');
    d.className = 'tm-line';
    if (typeof parts === 'string') d.textContent = parts;
    else parts.forEach((p) => {
      if (typeof p === 'string') d.append(p);
      else { const s = document.createElement('span'); s.className = p.c || ''; s.textContent = p.t; d.append(s); }
    });
    return d;
  }
  function print(parts) {
    out.append(lineEl(parts));
    screen.scrollTop = screen.scrollHeight;
  }
  const printErr = (m) => print([A(m, 'tm-err')]);
  const dim = (t) => [A(t, 'tm-dim')];

  const short = (p) => (p === FS.HOME ? '~' : p.startsWith(FS.HOME + '/') ? '~' + p.slice(FS.HOME.length) : p);
  const promptParts = () => [A(USER + '@' + HOST, 'tm-user'), ':', A(short(cwd), 'tm-path'), '$ '];
  function setPrompt() {
    promptEl.textContent = '';
    promptParts().forEach((p) => {
      if (typeof p === 'string') promptEl.append(p);
      else { const s = document.createElement('span'); s.className = p.c; s.textContent = p.t; promptEl.append(s); }
    });
  }

  /* ---------------- small helpers ---------------- */
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function hsize(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }
  const fmtTime = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const toLines = (text) => { const l = text.split('\n'); if (l.length && l[l.length - 1] === '') l.pop(); return l; };
  const dur = (ms) => {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s % 60) + 's' : s + 's';
  };
  const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  const notFound = (p) => new Error(p + ': no such file or directory');

  function flags(args, known) {
    const f = new Set(), rest = [];
    let stop = false;
    args.forEach((a) => {
      if (!stop && a === '--') { stop = true; return; }
      if (!stop && /^-[a-zA-Z]+$/.test(a)) {
        for (const ch of a.slice(1)) {
          if (!known.includes(ch)) throw new Error('unknown option -' + ch);
          f.add(ch);
        }
      } else rest.push(a);
    });
    return { f, rest };
  }
  // reads "-n 5" or "-5"
  function numOpt(args, fallback) {
    const rest = []; let n = fallback;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1] !== undefined) { n = parseInt(args[++i], 10); if (!(n >= 0)) throw new Error('that is not a valid number'); }
      else if (/^-\d+$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
      else rest.push(args[i]);
    }
    return { n, rest };
  }
  function allFiles(path, recursive) {
    const st = FS.stat(path, cwd);
    if (!st) throw notFound(path);
    if (st.type === 'file') return [{ shown: path, path: st.path }];
    if (!recursive) throw new Error(path + ': is a directory (use -r)');
    const res = [];
    (function walk(p, shown) {
      FS.list(p, '/').forEach((e) => {
        const s = (shown === '.' ? '.' : shown) + '/' + e.name;
        if (e.type === 'dir') walk(e.path, s); else res.push({ shown: s, path: e.path });
      });
    })(st.path, path === '.' ? '.' : path.replace(/\/$/, ''));
    return res;
  }
  function expand(arg) {
    const i = arg.lastIndexOf('/');
    const dirPart = i >= 0 ? arg.slice(0, i + 1) : '';
    const base = arg.slice(i + 1);
    if (/[*?]/.test(dirPart) || !/[*?]/.test(base)) return [arg];
    try {
      const re = globRe(base);
      const hits = FS.list(dirPart || '.', cwd)
        .filter((e) => re.test(e.name) && !(e.name.startsWith('.') && !base.startsWith('.')))
        .map((e) => dirPart + e.name);
      return hits.length ? hits : [arg];
    } catch (e) { return [arg]; }
  }

  /* ---------------- commands ---------------- */
  const cmds = {};
  const alias = { ll: ['ls', '-l'], cls: ['clear'], nano: ['edit'], vi: ['edit'], vim: ['edit'], search: ['open'], man: ['help'], quit: ['exit'], dir: ['ls'], type: ['cat'] };
  const def = (name, usage, desc, fn) => { cmds[name] = { usage, desc, fn }; };

  def('help', 'help [command]', 'Show what you can do here', (args) => {
    if (args[0]) {
      const name = alias[args[0]] ? alias[args[0]][0] : args[0];
      const c = cmds[name];
      if (!c) throw new Error(args[0] + ': no such command');
      return [[A('Usage  ', 'tm-key'), c.usage], c.desc];
    }
    const lines = [dim('Type a command and press Enter. Tab completes names, the arrow keys bring back old commands.'), ''];
    Object.keys(cmds).forEach((n) => lines.push([A(n.padEnd(11), 'tm-key'), cmds[n].desc]));
    lines.push('', dim('Use > and >> to send output into a file, for example: echo hello > notes.txt'));
    return lines;
  });

  def('ls', 'ls [-l] [-a] [folder or file...]', 'List what is in a folder', (args) => {
    const { f, rest } = flags(args, 'la');
    const targets = rest.length ? rest : ['.'];
    const lines = [];
    targets.forEach((t, i) => {
      const st = FS.stat(t, cwd);
      if (!st) throw notFound(t);
      let entries = st.type === 'dir' ? FS.list(t, cwd) : [st];
      if (!f.has('a')) entries = entries.filter((e) => !e.name.startsWith('.'));
      if (targets.length > 1) { if (i) lines.push(''); lines.push(t + ':'); }
      if (f.has('l')) {
        entries.forEach((e) => lines.push([
          e.type === 'dir' ? 'd  ' : '-  ',
          A((e.type === 'dir' ? plural(e.count, 'item') : hsize(e.size)).padStart(10), 'tm-dim'), '  ',
          A(fmtTime(e.mtime), 'tm-dim'), '  ',
          A(e.name + (e.type === 'dir' ? '/' : ''), e.type === 'dir' ? 'tm-dir' : '')
        ]));
      } else if (entries.length) {
        const parts = [];
        entries.forEach((e, k) => { if (k) parts.push('   '); parts.push(A(e.name + (e.type === 'dir' ? '/' : ''), e.type === 'dir' ? 'tm-dir' : '')); });
        lines.push(parts);
      }
    });
    return lines;
  });

  def('cd', 'cd [folder]', 'Go to a folder (cd alone goes home, cd - goes back)', (args) => {
    let t = args[0];
    if (t === undefined) t = FS.HOME; else if (t === '-') t = oldcwd;
    const st = FS.stat(t, cwd);
    if (!st) throw notFound(t);
    if (st.type !== 'dir') throw new Error(t + ': not a folder');
    oldcwd = cwd; cwd = st.path; setPrompt();
  });
  def('pwd', 'pwd', 'Show which folder you are in', () => [cwd]);

  def('cat', 'cat <file...>', 'Show what is inside a file', (args) => {
    if (!args.length) throw new Error('usage: cat <file...>');
    const lines = [];
    args.forEach((a) => lines.push(...toLines(FS.read(a, cwd))));
    return lines;
  });
  def('echo', 'echo [text]', 'Print text (try echo hi > file.txt)', (args) => [args.join(' ')]);
  def('touch', 'touch <file...>', 'Make an empty file', (args) => {
    if (!args.length) throw new Error('usage: touch <file...>');
    args.forEach((a) => FS.touch(a, cwd));
  });
  def('mkdir', 'mkdir [-p] <folder...>', 'Make a folder (-p makes parent folders too)', (args) => {
    const { f, rest } = flags(args, 'p');
    if (!rest.length) throw new Error('usage: mkdir [-p] <folder...>');
    rest.forEach((a) => FS.mkdir(a, { parents: f.has('p') }, cwd));
  });
  def('rm', 'rm [-r] [-f] <file or folder...>', 'Delete files (-r for folders). There is no undo.', (args) => {
    const { f, rest } = flags(args, 'rf');
    if (!rest.length) throw new Error('usage: rm [-r] [-f] <file or folder...>');
    rest.forEach((a) => {
      try { FS.remove(a, { recursive: f.has('r') }, cwd); }
      catch (e) { if (!f.has('f') || !/no such file/.test(e.message)) throw e; }
    });
  });
  def('rmdir', 'rmdir <folder...>', 'Delete empty folders', (args) => {
    if (!args.length) throw new Error('usage: rmdir <folder...>');
    args.forEach((a) => {
      const st = FS.stat(a, cwd);
      if (!st) throw notFound(a);
      if (st.type !== 'dir') throw new Error(a + ': not a folder');
      if (st.count) throw new Error(a + ': folder is not empty');
      FS.remove(a, { recursive: true }, cwd);
    });
  });
  function twoArg(name, args, fn, known) {
    const { f, rest } = flags(args, known || '');
    if (rest.length < 2) throw new Error('usage: ' + name + ' <from...> <to>');
    const dst = rest[rest.length - 1], srcs = rest.slice(0, -1);
    if (srcs.length > 1) {
      const st = FS.stat(dst, cwd);
      if (!st || st.type !== 'dir') throw new Error(dst + ': not a folder');
    }
    srcs.forEach((s) => fn(s, dst, f));
  }
  def('mv', 'mv <from...> <to>', 'Move or rename files and folders', (args) => twoArg('mv', args, (s, d) => FS.move(s, d, cwd)));
  def('cp', 'cp [-r] <from...> <to>', 'Copy files (-r for folders)', (args) => twoArg('cp', args, (s, d, f) => FS.copy(s, d, { recursive: f.has('r') }, cwd), 'r'));

  def('tree', 'tree [folder]', 'Show folders and files as a tree', (args) => {
    const root = args[0] || '.';
    const st = FS.stat(root, cwd);
    if (!st) throw notFound(root);
    if (st.type !== 'dir') throw new Error(root + ': not a folder');
    const lines = [[A(root, 'tm-dir')]];
    let dirs = 0, files = 0;
    (function walk(p, prefix) {
      const es = FS.list(p, '/');
      es.forEach((e, i) => {
        const last = i === es.length - 1;
        lines.push([prefix + (last ? '└── ' : '├── '), A(e.name + (e.type === 'dir' ? '/' : ''), e.type === 'dir' ? 'tm-dir' : '')]);
        if (e.type === 'dir') { dirs++; walk(e.path, prefix + (last ? '    ' : '│   ')); } else files++;
      });
    })(st.path, '');
    lines.push('', dim(plural(dirs, 'folder') + ', ' + plural(files, 'file')));
    return lines;
  });

  def('grep', 'grep [-i] [-n] [-r] <pattern> [file...]', 'Search inside files for matching lines', (args) => {
    const { f, rest } = flags(args, 'inr');
    if (!rest.length) throw new Error('usage: grep [-i] [-n] [-r] <pattern> [file...]');
    const pat = rest[0];
    let re;
    try { re = new RegExp(pat, f.has('i') ? 'i' : ''); }
    catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.has('i') ? 'i' : ''); }
    let targets = rest.slice(1);
    if (!targets.length) { if (!f.has('r')) throw new Error('no file given (or use -r to search this folder)'); targets = ['.']; }
    const files = [];
    targets.forEach((t) => files.push(...allFiles(t, f.has('r'))));
    const lines = [];
    files.forEach((file) => {
      toLines(FS.read(file.path, '/')).forEach((text, i) => {
        if (!re.test(text)) return;
        const row = [];
        if (files.length > 1) row.push(A(file.shown, 'tm-path'), ':');
        if (f.has('n')) row.push(A(String(i + 1), 'tm-dim'), ':');
        row.push(text);
        lines.push(row);
      });
    });
    if (!lines.length) lines.push(dim('No matches.'));
    return lines;
  });

  def('wc', 'wc <file...>', 'Count lines, words and characters', (args) => {
    if (!args.length) throw new Error('usage: wc <file...>');
    return args.map((a) => {
      const t = FS.read(a, cwd);
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      return String(toLines(t).length).padStart(7) + String(words).padStart(7) + String(t.length).padStart(8) + ' ' + a;
    });
  });
  def('head', 'head [-n 10] <file>', 'Show the first lines of a file', (args) => {
    const { n, rest } = numOpt(args, 10);
    if (!rest[0]) throw new Error('usage: head [-n 10] <file>');
    return toLines(FS.read(rest[0], cwd)).slice(0, n);
  });
  def('tail', 'tail [-n 10] <file>', 'Show the last lines of a file', (args) => {
    const { n, rest } = numOpt(args, 10);
    if (!rest[0]) throw new Error('usage: tail [-n 10] <file>');
    const l = toLines(FS.read(rest[0], cwd));
    return n ? l.slice(-n) : [];
  });
  def('find', 'find [folder] [-name pattern]', 'Find files and folders by name', (args) => {
    let pattern = null, root = '.';
    for (let i = 0; i < args.length; i++) { if (args[i] === '-name') pattern = args[++i]; else root = args[i]; }
    if (args.includes('-name') && !pattern) throw new Error('-name needs a pattern, for example: find . -name "*.txt"');
    const st = FS.stat(root, cwd);
    if (!st) throw notFound(root);
    const re = pattern ? globRe(pattern) : null;
    const lines = [];
    (function walk(p, shown) {
      FS.list(p, '/').forEach((e) => {
        const s = shown + '/' + e.name;
        if (!re || re.test(e.name)) lines.push([A(s, e.type === 'dir' ? 'tm-dir' : '')]);
        if (e.type === 'dir') walk(e.path, s);
      });
    })(st.path, root.replace(/\/$/, '') || '/');
    if (!lines.length) lines.push(dim('Nothing found.'));
    return lines;
  });
  def('du', 'du', 'Show how much space your documents use', () => {
    const u = FS.usage();
    return [plural(u.files, 'document') + ', ' + plural(u.dirs, 'folder') + ', ' + hsize(u.bytes) + ' of text'];
  });

  def('edit', 'edit <file>', 'Open a file in the editor (a new name makes a new file)', (args) => {
    if (!args[0]) throw new Error('usage: edit <file>');
    const st = FS.stat(args[0], cwd);
    if (st && st.type === 'dir') throw new Error(args[0] + ': is a folder');
    if (!st) FS.write(args[0], '', {}, cwd);
    window.JammyOS.openFiles(FS.resolve(args[0], cwd));
    return [dim('Opened ' + args[0] + ' in Files')];
  });
  def('files', 'files [folder]', 'Open the Files app', (args) => {
    window.JammyOS.openFiles(args[0] ? FS.resolve(args[0], cwd) : cwd);
    return [dim('Opened Files')];
  });

  def('open', 'open <address or search words>', 'Open a website, or search the web, in a new tab', (args) => {
    if (!args.length) throw new Error('usage: open <address or search words>');
    const url = window.JammyOS.resolveQuery(args.join(' '));
    window.open(url, '_blank');
    return [dim('Opening ' + url)];
  });
  def('spotify', 'spotify', 'Open Spotify', () => { window.JammyOS.openSpotify(); return [dim('Opening Spotify')]; });
  def('accent', 'accent <#rrggbb>', 'Change the accent colour', (args) => {
    if (!args[0]) return ['Now ' + window.JammyOS.settings().accent, dim('Try: accent #7c9cff')];
    const m = /^#?([0-9a-f]{6})$/i.exec(args[0]);
    if (!m) throw new Error('use a six-digit colour such as #ff5c80');
    window.JammyOS.setSetting('accent', '#' + m[1].toLowerCase());
    return [dim('Accent set to #' + m[1].toLowerCase())];
  });
  def('wallpaper', 'wallpaper [name]', 'List or change the wallpaper', (args) => {
    const names = window.JammyOS.wallpapers();
    if (!args[0]) return ['Available: ' + names.join(', '), dim('Try: wallpaper dusk')];
    if (!window.JammyOS.setWallpaper(args[0])) throw new Error(args[0] + ': no such wallpaper (' + names.join(', ') + ')');
    return [dim('Wallpaper set to ' + args[0])];
  });
  def('clock', 'clock <center|corner>', 'Move the big clock', (args) => {
    if (!['center', 'corner'].includes(args[0])) throw new Error('usage: clock <center|corner>');
    window.JammyOS.setSetting('clockPos', args[0]);
    return [dim('Clock moved')];
  });

  def('wifi', 'wifi', 'Show your connection', () => {
    const o = window.JammyNet.info();
    const bars = '▂▄▆█'.split('').map((b, i) => A(b, i < o.level ? 'tm-accent' : 'tm-dim'));
    const row = (k, v) => [A(k.padEnd(13), 'tm-key'), v];
    return [
      row('Status', o.online ? 'online' : 'offline'),
      row('Signal', [...bars, '  ' + o.label + ' (' + o.level + ' of 4)'].reduce((a, b) => a.concat([b]), [])),
      row('Connection', o.type || 'not reported'),
      row('Speed', o.down ? 'about ' + o.down + ' Mbps' : 'not reported'),
      row('Latency', o.rtt ? o.rtt + ' ms' : 'not reported'),
      row('Data saver', o.saveData ? 'on' : 'off'),
      '',
      dim("Browsers can't read Wi-Fi signal strength or the network name. The bars are estimated from the speed and latency your browser reports."),
      dim('Try ping to time a real request.')
    ].map((l) => (Array.isArray(l) && Array.isArray(l[1]) ? [l[0], ...l[1]] : l));
  });

  def('ping', 'ping [website]', 'Time four requests to a website', async (args, ctx) => {
    const host = (args[0] || 'cloudflare.com').replace(/^https?:\/\//i, '').split('/')[0];
    if (!/^[\w.-]+(:\d+)?$/.test(host)) throw new Error(host + ': that is not a website name');
    ctx.live(['Timing requests to ' + host + ' (each time includes the secure connection setup)']);
    const times = [];
    for (let i = 1; i <= 4; i++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const t0 = performance.now();
      try {
        await fetch('https://' + host + '/?jammy=' + Date.now() + i, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
        const ms = Math.round(performance.now() - t0);
        times.push(ms);
        ctx.live(['  ' + i + ': ' + ms + ' ms']);
      } catch (e) {
        ctx.live([A('  ' + i + ': ' + (ctl.signal.aborted ? 'no answer after 5 seconds' : 'could not connect'), 'tm-err')]);
      } finally { clearTimeout(timer); }
    }
    if (!times.length) throw new Error(host + ': no replies. Check the address and your connection.');
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    return [dim(times.length + ' of 4 replied, average ' + avg + ' ms, fastest ' + Math.min(...times) + ' ms')];
  });

  def('neofetch', 'neofetch', 'Show a summary of this system', () => {
    const art = ['   ██████████ ', '       ██     ', '       ██     ', '       ██     ', '  ██   ██     ', '   ████████   '];
    const ver = (window.chrome && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : 'dev';
    const m = /(Chrome|Chromium|Edg|Brave)\/(\d+)/.exec(navigator.userAgent);
    const u = FS.usage(), o = window.JammyNet.info();
    const row = (k, v) => [A(k + ': ', 'tm-key'), v];
    const info = [
      [A(USER + '@' + HOST, 'tm-key')],
      dim('─────────────'),
      row('OS', 'JammyOS ' + ver),
      row('Browser', m ? m[1] + ' ' + m[2] : 'unknown'),
      row('Window', window.innerWidth + 'x' + window.innerHeight),
      row('CPU', (navigator.hardwareConcurrency || '?') + ' threads'),
      row('Memory', navigator.deviceMemory ? 'at least ' + navigator.deviceMemory + ' GB' : 'not reported'),
      row('Network', o.online ? 'online, ' + o.label.toLowerCase() : 'offline'),
      row('Files', plural(u.files, 'document') + ', ' + hsize(u.bytes)),
      row('Uptime', dur(Date.now() - started))
    ];
    const lines = [];
    for (let i = 0; i < Math.max(art.length, info.length); i++) {
      lines.push([A((art[i] || '').padEnd(16), 'tm-accent'), ...(info[i] || [])]);
    }
    return lines;
  });

  def('date', 'date', 'Show the date and time', () => [new Date().toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })]);
  def('uptime', 'uptime', 'How long this tab has been open', () => ['up ' + dur(Date.now() - started)]);
  def('whoami', 'whoami', 'Show your user name', () => [USER]);
  def('uname', 'uname', 'Show the system name', () => ['JammyOS']);
  def('history', 'history', 'Show commands you have run', () => history.map((h, i) => String(i + 1).padStart(4) + '  ' + h));
  def('clear', 'clear', 'Clear the screen', (a, ctx) => { ctx.clear(); });
  def('exit', 'exit', 'Close the terminal', () => { setTimeout(close, 0); });
  def('reboot', 'reboot', 'Reload this tab (your documents are kept)', () => { setTimeout(() => location.reload(), 250); return [dim('Restarting...')]; });
  def('sudo', 'sudo', 'Nice try', () => ['There is only one user here, and it is you. You already have the keys.']);

  /* ---------------- parsing and running ---------------- */
  function tokenize(s) {
    const toks = [];
    let cur = '', has = false, quoted = false, q = null;
    const flush = () => { if (has) toks.push({ v: cur, quoted }); cur = ''; has = false; quoted = false; };
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === q) q = null; else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; has = true; quoted = true; continue; }
      if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; quoted = true; continue; }
      if (/\s/.test(ch)) { flush(); continue; }
      if (ch === '>') {
        flush();
        if (s[i + 1] === '>') { toks.push({ op: '>>' }); i++; } else toks.push({ op: '>' });
        continue;
      }
      cur += ch; has = true;
    }
    if (q) throw new Error('missing closing quote');
    flush();
    return toks;
  }

  async function run(text) {
    const toks = tokenize(text);
    let redirect = null;
    const words = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.op) {
        const target = toks[i + 1];
        if (!target || target.op) throw new Error('expected a file name after ' + t.op);
        redirect = { mode: t.op, path: target.v };
        i++;
      } else words.push(t);
    }
    if (!words.length) return;
    let name = words[0].v;
    let args = [];
    words.slice(1).forEach((w) => { args.push(...(!w.quoted && /[*?]/.test(w.v) ? expand(w.v) : [w.v])); });
    if (alias[name]) { args = alias[name].slice(1).concat(args); name = alias[name][0]; }
    const cmd = cmds[name];
    if (!cmd) throw new Error(name + ': command not found. Type help to see what you can run.');
    const ctx = { live: print, clear: () => { out.textContent = ''; } };
    let lines;
    try { lines = await cmd.fn(args, ctx); }
    catch (e) { throw new Error(name + ': ' + (e.message || e)); }
    lines = lines || [];
    if (redirect) {
      try {
        FS.write(redirect.path, lines.length ? lines.map(plain).join('\n') + '\n' : '', { append: redirect.mode === '>>' }, cwd);
      } catch (e) { throw new Error(e.message); }
    } else lines.forEach(print);
  }

  async function submit(text) {
    print([...promptParts(), text]);
    const t = text.trim();
    if (t && history[history.length - 1] !== t) history.push(t);
    hpos = history.length; draft = '';
    if (!t) return;
    try { await run(t); } catch (e) { printErr(e.message || String(e)); }
    setPrompt();
  }

  /* ---------------- Tab completion ---------------- */
  function commonPrefix(list) {
    let p = list[0];
    list.forEach((s) => { while (!s.startsWith(p)) p = p.slice(0, -1); });
    return p;
  }
  function complete() {
    const pos = input.selectionStart, v = input.value;
    const before = v.slice(0, pos), after = v.slice(pos);
    const m = /(?:^|\s)((?:\\.|\S)*)$/.exec(before);
    const raw = m ? m[1] : '';
    const word = raw.replace(/\\(.)/g, '$1');
    const start = pos - raw.length;
    const first = before.slice(0, start).trim() === '';
    let cands = [];
    if (first && !word.includes('/')) {
      cands = [...Object.keys(cmds), ...Object.keys(alias)].filter((n) => n.startsWith(word)).sort();
    } else {
      const i = word.lastIndexOf('/');
      const dirPart = word.slice(0, i + 1), prefix = word.slice(i + 1);
      try {
        cands = FS.list(dirPart || '.', cwd)
          .filter((e) => e.name.toLowerCase().startsWith(prefix.toLowerCase()))
          .map((e) => dirPart + e.name + (e.type === 'dir' ? '/' : ''));
      } catch (e) { /* not a folder */ }
    }
    if (!cands.length) return;
    const common = cands.length === 1 ? cands[0] : commonPrefix(cands);
    if (common.length > word.length || cands.length === 1) {
      let ins = common.replace(/ /g, '\\ ');
      if (cands.length === 1 && !ins.endsWith('/')) ins += ' ';
      input.value = v.slice(0, start) + ins + after;
      input.selectionStart = input.selectionEnd = start + ins.length;
      lastTab = '';
    } else if (lastTab === v) {
      print(cands.map((c) => c.replace(/\/$/, '') ).join('   '));
    }
    lastTab = input.value === v ? v : '';
  }

  /* ---------------- input ---------------- */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = input.value;
      input.value = '';
      submit(t);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hpos === history.length) draft = input.value;
      if (hpos > 0) input.value = history[--hpos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hpos < history.length) { hpos++; input.value = hpos === history.length ? draft : history[hpos]; }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      out.textContent = '';
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      print([...promptParts(), input.value + '^C']);
      input.value = '';
    }
  });
  screen.addEventListener('mouseup', () => { if (!String(getSelection())) input.focus(); });

  /* ---------------- window ---------------- */
  let placed = false, greeted = false;
  function open() {
    if (win.hidden) {
      win.hidden = false;
      dock.classList.add('active');
      if (!placed) { placed = true; wm.place(720, 440, 60); }
      if (!greeted) {
        greeted = true;
        print([A('JammyOS terminal', 'tm-key')]);
        print(dim('Type help to see the commands. Your documents are in ' + short(FS.HOME) + '.'));
        print('');
      }
      setPrompt();
    }
    wm.front();
    input.focus();
  }
  function close() {
    win.hidden = true;
    dock.classList.remove('active');
  }
  dock.addEventListener('click', () => {
    if (win.hidden) open();
    else if (!wm.isFront()) { wm.front(); input.focus(); }
    else close();
  });
  $('#tmClose').addEventListener('click', close);
  $('#tmMax').addEventListener('click', () => { win.classList.toggle('max'); input.focus(); });

  FS.ready.then(setPrompt);
  window.JammyOS = Object.assign(window.JammyOS || {}, {
    openTerminal: open,
    terminal(cmd) { open(); if (cmd) submit(cmd); }
  });
})();
