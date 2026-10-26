/* JammyOS Files: browse, create and edit the documents in the JammyOS file system (see fs.js). */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const win = $('#explorer'), dock = $('#filesBtn');
  if (!win || !dock || !window.JammyFS || !window.JammyWM) return;

  const FS = window.JammyFS;
  const wm = window.JammyWM.setup(win, $('#fxTitle'));
  const grid = $('#fxGrid'), empty = $('#fxEmpty'), main = $('#fxMain'), viewerEl = $('#fxViewer');

  const PLACES = [
    { name: 'Home', path: FS.HOME },
    { name: 'Documents', path: FS.HOME + '/Documents' },
    { name: 'Notes', path: FS.HOME + '/Notes' },
    { name: 'All files', path: '/' }
  ];
  const FOLDER = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 13a4 4 0 0 1 4-4h10.5a3 3 0 0 1 2.4 1.2L23 13h17a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z" fill="currentColor"/></svg>';
  const SMALL_FOLDER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"/></svg>';
  const TO_GRID = '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>';
  const TO_LIST = '<path d="M5 6h14M5 12h14M5 18h14"/>';

  let cwd = localStorage.getItem('jammyosFilesDir') || FS.HOME;
  let selected = null;           // path of the selected item
  let backStack = [];
  let listView = localStorage.getItem('jammyosFilesView') === 'list';
  let viewer = null;             // { path, ta, timer, saved }
  let items = [];

  /* ---------------- helpers ---------------- */
  const parentOf = (p) => p.replace(/\/[^/]+$/, '') || '/';
  const joinPath = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  }
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const extOf = (n) => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : '');

  let sayTimer;
  function say(text, bad) {
    const s = $('#fxStatus');
    s.textContent = text;
    s.classList.toggle('bad', !!bad);
    clearTimeout(sayTimer);
    sayTimer = setTimeout(updateStatus, 4500);
  }
  function updateStatus() {
    const s = $('#fxStatus');
    s.classList.remove('bad');
    const sel = selected && items.find((i) => i.path === selected);
    if (sel) s.textContent = sel.type === 'dir' ? sel.name + ', ' + plural(sel.count, 'item') : sel.name + ', ' + fmtSize(sel.size);
    else {
      const d = items.filter((i) => i.type === 'dir').length;
      s.textContent = plural(d, 'folder') + ', ' + plural(items.length - d, 'document');
    }
  }
  const fail = (e) => say((e && e.message) || 'Something went wrong.', true);

  /* ---------------- name / confirm dialog ---------------- */
  const dlg = $('#askDialog');
  function ask({ title, message = '', value = null, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      $('#askTitle').textContent = title;
      const msg = $('#askMsg');
      msg.textContent = message;
      msg.hidden = !message;
      const input = $('#askInput');
      input.hidden = value === null;
      input.value = value === null ? '' : value;
      const okBtn = $('#askOk');
      okBtn.textContent = ok;
      okBtn.className = danger ? 'danger-solid' : 'primary';
      let done = false;
      const finish = (v) => { if (done) return; done = true; if (dlg.open) dlg.close(); resolve(v); };
      $('#askForm').onsubmit = (e) => {
        e.preventDefault();
        if (value === null) return finish(true);
        finish(input.value.trim() || null);
      };
      $('#askCancel').onclick = () => finish(null);
      dlg.onclose = () => finish(null);
      dlg.showModal();
      if (value !== null) {
        input.focus();
        const dot = input.value.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
      }
    });
  }

  /* ---------------- navigation ---------------- */
  function go(path, push = true) {
    closeViewer(true);
    if (push && path !== cwd) backStack.push(cwd);
    cwd = path;
    selected = null;
    localStorage.setItem('jammyosFilesDir', cwd);
    render();
  }
  const goUp = () => { if (cwd !== '/') go(parentOf(cwd)); };
  function goBack() {
    if (!backStack.length) return;
    closeViewer(true);
    cwd = backStack.pop();
    selected = null;
    render();
  }
  function openItem(it) { if (it.type === 'dir') go(it.path); else openFile(it.path); }

  /* ---------------- drawing ---------------- */
  function renderPlaces() {
    const box = $('#fxPlaces');
    box.textContent = '';
    PLACES.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fx-place' + (cwd === p.path ? ' on' : '');
      b.dataset.drop = p.path;
      b.innerHTML = SMALL_FOLDER;
      const t = document.createElement('span');
      t.textContent = p.name;
      b.append(t);
      b.addEventListener('click', () => go(p.path));
      box.append(b);
    });
  }

  function renderCrumbs() {
    const nav = $('#fxCrumbs');
    nav.textContent = '';
    const underHome = cwd === FS.HOME || cwd.startsWith(FS.HOME + '/');
    const base = underHome ? { label: 'Home', path: FS.HOME } : { label: 'All files', path: '/' };
    const rest = cwd.slice(base.path === '/' ? 1 : base.path.length).split('/').filter(Boolean);
    const trail = [base].concat(rest.map((s, i) => ({ label: s, path: joinPath(base.path === '/' ? '' : base.path, rest.slice(0, i + 1).join('/')) })));
    trail.forEach((seg, i) => {
      if (i) { const sl = document.createElement('span'); sl.className = 'sl'; sl.textContent = '/'; nav.append(sl); }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = seg.label;
      b.dataset.drop = seg.path;
      if (i === trail.length - 1) b.className = 'here';
      else b.addEventListener('click', () => go(seg.path));
      nav.append(b);
    });
    nav.scrollLeft = nav.scrollWidth;
    $('#fxBack').disabled = !backStack.length;
    $('#fxUp').disabled = cwd === '/';
    $('#fxView svg').innerHTML = listView ? TO_GRID : TO_LIST;
    $('#fxView').title = listView ? 'Show as icons' : 'Show as list';
  }

  function render() {
    if (!FS.stat(cwd) || FS.stat(cwd).type !== 'dir') { cwd = FS.HOME; backStack = []; }
    renderPlaces();
    renderCrumbs();
    items = FS.list(cwd);
    if (selected && !items.some((i) => i.path === selected)) selected = null;
    grid.className = 'fx-grid' + (listView ? ' list' : '');
    grid.textContent = '';
    empty.hidden = items.length > 0;
    grid.hidden = !items.length;
    if (!items.length) {
      empty.textContent = '';
      const h = document.createElement('strong');
      h.textContent = 'This folder is empty';
      const p = document.createElement('p');
      p.textContent = 'Use New document or New folder in the toolbar, or drag a document in from another folder.';
      empty.append(h, p);
    }
    items.forEach((it) => {
      const el = document.createElement('div');
      el.className = 'fx-item' + (it.path === selected ? ' sel' : '');
      el.tabIndex = 0;
      el.draggable = true;
      el.dataset.path = it.path;
      if (it.type === 'dir') el.dataset.drop = it.path;
      const ico = document.createElement('div');
      ico.className = 'fx-ico';
      if (it.type === 'dir') ico.innerHTML = FOLDER;
      else {
        const doc = document.createElement('div');
        doc.className = 'fx-doc';
        const lab = document.createElement('span');
        lab.textContent = extOf(it.name).slice(0, 4);
        doc.append(lab);
        ico.append(doc);
      }
      const name = document.createElement('div');
      name.className = 'fx-name';
      name.textContent = it.name;
      name.title = it.name;
      const mod = document.createElement('div');
      mod.className = 'fx-mod';
      mod.textContent = fmtDate(it.mtime);
      const size = document.createElement('div');
      size.className = 'fx-size';
      size.textContent = it.type === 'dir' ? plural(it.count, 'item') : fmtSize(it.size);
      el.append(ico, name, mod, size);
      grid.append(el);
    });
    updateStatus();
  }

  function select(el) {
    grid.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    if (el) { el.classList.add('sel'); selected = el.dataset.path; } else selected = null;
    updateStatus();
  }
  const itemFor = (path) => items.find((i) => i.path === path);

  /* ---------------- actions ---------------- */
  async function newFolder() {
    const name = await ask({ title: 'New folder', value: FS.unique(cwd, 'New folder'), ok: 'Create' });
    if (!name) return;
    try { FS.mkdir(joinPath(cwd, name)); selected = joinPath(cwd, name); say('Created ' + name); } catch (e) { fail(e); }
  }
  async function newDocument() {
    const name = await ask({ title: 'New document', value: FS.unique(cwd, 'Untitled.txt'), ok: 'Create' });
    if (!name) return;
    try {
      const path = joinPath(cwd, name);
      if (FS.stat(path)) throw new Error(name + ' already exists.');
      FS.write(path, '');
      openFile(path);
    } catch (e) { fail(e); }
  }
  async function renameItem(it) {
    const name = await ask({ title: 'Rename', value: it.name, ok: 'Rename' });
    if (!name || name === it.name) return;
    try { FS.rename(it.path, name); selected = joinPath(cwd, name); say('Renamed to ' + name); } catch (e) { fail(e); }
  }
  async function deleteItem(it) {
    const ok = await ask({
      title: 'Delete ' + it.name + '?',
      message: (it.type === 'dir' ? 'This folder and everything inside it' : 'This document') + ' will be deleted. You can\'t undo this.',
      ok: 'Delete', danger: true
    });
    if (!ok) return;
    try { FS.remove(it.path, { recursive: true }); selected = null; say('Deleted ' + it.name); } catch (e) { fail(e); }
  }
  function download(path) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([FS.read(path)], { type: 'text/plain' }));
      a.download = path.split('/').pop();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { fail(e); }
  }
  async function importFiles(files) {
    let ok = 0, skipped = 0;
    for (const f of files) {
      try {
        if (f.size > 5e6) { skipped++; continue; }
        const text = await f.text();
        if (text.indexOf('\u0000') !== -1) { skipped++; continue; }
        FS.write(joinPath(cwd, FS.unique(cwd, f.name)), text);
        ok++;
      } catch (e) { skipped++; }
    }
    say(plural(ok, 'document') + ' imported' + (skipped ? ', ' + skipped + ' skipped (only text files under 5 MB work)' : ''), !!skipped && !ok);
  }
  function moveInto(src, destDir) {
    if (parentOf(src) === destDir) return;
    try { FS.move(src, destDir); say('Moved ' + src.split('/').pop()); } catch (e) { fail(e); }
  }

  /* ---------------- editor ---------------- */
  const vstate = (t) => { $('#fxVState').textContent = t; };
  function flush() {
    if (!viewer) return;
    clearTimeout(viewer.timer);
    if (viewer.saved) return;
    try { FS.write(viewer.path, viewer.ta.value); viewer.saved = true; vstate('Saved'); }
    catch (e) { vstate("Couldn't save: this document was moved or deleted"); }
  }
  function closeViewer(silent) {
    if (!viewer) return;
    flush();
    viewer = null;
    viewerEl.hidden = true;
    $('#fxVBody').textContent = '';
    if (!silent) render();
  }
  function openFile(path) {
    let text;
    try { text = FS.read(path); } catch (e) { return fail(e); }
    closeViewer(true);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Document text');
    const body = $('#fxVBody');
    body.textContent = '';
    body.append(ta);
    viewer = { path, ta, timer: null, saved: true };
    $('#fxVTitle').textContent = path.split('/').pop();
    $('#fxVTitle').title = path;
    vstate('Saved');
    ta.addEventListener('input', () => {
      viewer.saved = false;
      vstate('Saving…');
      clearTimeout(viewer.timer);
      viewer.timer = setTimeout(flush, 500);
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); }
    });
    viewerEl.hidden = false;
    open();
    ta.focus();
  }

  /* ---------------- wiring ---------------- */
  grid.addEventListener('click', (e) => select(e.target.closest('.fx-item')));
  grid.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.fx-item');
    if (el && itemFor(el.dataset.path)) openItem(itemFor(el.dataset.path));
  });
  main.addEventListener('click', (e) => { if (e.target === main || e.target === grid || e.target === empty) select(null); });
  main.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target.closest('.fx-item');
    const it = el && itemFor(el.dataset.path);
    if (it) {
      select(el);
      window.JammyOS.showMenu(e.clientX, e.clientY, [
        { label: it.type === 'dir' ? 'Open folder' : 'Open', fn: () => openItem(it) },
        ...(it.type === 'file' ? [{ label: 'Download a copy', fn: () => download(it.path) }] : []),
        { label: 'Rename', fn: () => renameItem(it) },
        { hr: true },
        { label: 'Delete', danger: true, fn: () => deleteItem(it) }
      ]);
    } else {
      select(null);
      window.JammyOS.showMenu(e.clientX, e.clientY, [
        { label: 'New document', fn: newDocument },
        { label: 'New folder', fn: newFolder },
        { label: 'Import documents', fn: () => $('#fxFile').click() }
      ]);
    }
  });
  win.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea, input')) return;
    const it = selected && itemFor(selected);
    if (e.key === 'Enter' && it) openItem(it);
    else if (e.key === 'Delete' && it) deleteItem(it);
    else if (e.key === 'F2' && it) renameItem(it);
    else if (e.key === 'Backspace') goUp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !win.hidden && viewer && !dlg.open) closeViewer();
  });

  // drag a document onto a folder, a place or a breadcrumb to move it
  grid.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.fx-item');
    if (!el) return;
    e.dataTransfer.setData('application/x-jammy-path', el.dataset.path);
    e.dataTransfer.effectAllowed = 'move';
  });
  win.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('application/x-jammy-path')) return;
    const t = e.target.closest('[data-drop]');
    if (!t) return;
    e.preventDefault();
    t.classList.add('drop-on');
  });
  win.addEventListener('dragleave', (e) => { const t = e.target.closest('[data-drop]'); if (t) t.classList.remove('drop-on'); });
  win.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-drop]');
    const src = e.dataTransfer && e.dataTransfer.getData('application/x-jammy-path');
    if (!t || !src) return;
    e.preventDefault();
    t.classList.remove('drop-on');
    moveInto(src, t.dataset.drop);
  });

  $('#fxBack').addEventListener('click', goBack);
  $('#fxUp').addEventListener('click', goUp);
  $('#fxNewFolder').addEventListener('click', newFolder);
  $('#fxNewFile').addEventListener('click', newDocument);
  $('#fxUpload').addEventListener('click', () => $('#fxFile').click());
  $('#fxFile').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; importFiles(f); });
  $('#fxView').addEventListener('click', () => {
    listView = !listView;
    localStorage.setItem('jammyosFilesView', listView ? 'list' : 'grid');
    render();
  });
  $('#fxVBack').addEventListener('click', () => closeViewer());
  $('#fxVDown').addEventListener('click', () => { if (viewer) { flush(); download(viewer.path); } });

  // keep the window in step with changes from the terminal or another tab
  FS.onChange(() => { if (!win.hidden && !viewer) render(); });
  // capture phase so this runs before the file system's own save-on-exit handler
  window.addEventListener('pagehide', flush, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }, true);

  /* ---------------- window ---------------- */
  let placed = false;
  function open() {
    if (win.hidden) {
      win.hidden = false;
      dock.classList.add('active');
      if (!placed) { placed = true; wm.place(840, 540, -40); }
      FS.ready.then(render);
    }
    wm.front();
  }
  function close() {
    closeViewer(true);
    win.hidden = true;
    dock.classList.remove('active');
  }
  dock.addEventListener('click', () => {
    if (win.hidden) open();
    else if (!wm.isFront()) wm.front();
    else close();
  });
  $('#fxClose').addEventListener('click', close);
  $('#fxMax').addEventListener('click', () => win.classList.toggle('max'));

  // open Files at a folder, or straight into a document
  window.JammyOS = Object.assign(window.JammyOS || {}, {
    openFiles(path) {
      open();
      FS.ready.then(() => {
        const st = path && FS.stat(path);
        if (st && st.type === 'dir') go(st.path);
        else if (st) { go(parentOf(st.path)); openFile(st.path); }
      });
    }
  });
})();
