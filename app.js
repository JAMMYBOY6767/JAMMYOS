(() => {
  'use strict';

  const KEY = 'browosState';
  const GRID_W = 100, GRID_H = 110, PAD = 24, BOTTOM_RESERVE = 110;

  const GRADIENTS = {
    tide:  'radial-gradient(70% 60% at 85% 0%,rgba(86,176,160,.45),transparent 62%),radial-gradient(60% 70% at 0% 100%,rgba(18,70,92,.65),transparent 65%),linear-gradient(160deg,#0a1f24,#0d2b2f 55%,#123a38)',
    dusk:  'radial-gradient(80% 60% at 10% 0%,rgba(214,128,96,.32),transparent 60%),radial-gradient(70% 70% at 100% 100%,rgba(98,64,120,.4),transparent 62%),linear-gradient(165deg,#16111a,#1c1418 60%,#291a1a)',
    ink:   'radial-gradient(60% 50% at 70% 10%,rgba(70,90,140,.28),transparent 62%),linear-gradient(170deg,#07080c,#0d1017 60%,#141926)',
    moss:  'radial-gradient(70% 60% at 20% 0%,rgba(150,170,80,.30),transparent 60%),linear-gradient(160deg,#0d140e,#16211a 55%,#22301f)',
    ember: 'radial-gradient(70% 60% at 80% 100%,rgba(230,90,50,.38),transparent 62%),linear-gradient(165deg,#140b0a,#241210 60%,#3a1a12)',
    slate: 'radial-gradient(70% 60% at 50% 0%,rgba(120,140,160,.30),transparent 62%),linear-gradient(160deg,#12161b,#1c232b 55%,#2a343e)'
  };

  const defaults = () => ({
    settings: {
      showClock: true, showDate: true, hour24: false, seconds: false,
      showSearch: true, engine: 'brave', showMusic: true, clockPos: 'center',
      accent: '#ff5c80', radius: 20, blur: 16, glass: 50, icon: 56, showLabels: true,
      bgColor: '#0d2b2f', dim: 12, bgBlur: 0
    },
    bg: { type: 'gradient', gradient: 'tide', image: '' },
    desktop: [
      { id: uid(), name: 'YouTube', url: 'https://www.youtube.com/', col: 0, row: 0 },
      { id: uid(), name: 'GitHub',  url: 'https://github.com/',      col: 0, row: 1 },
      { id: uid(), name: 'Reddit',  url: 'https://www.reddit.com/',  col: 0, row: 2 }
    ],
    pins: [
      { id: uid(), name: 'Gmail',   url: 'https://mail.google.com/' },
      { id: uid(), name: 'YouTube', url: 'https://www.youtube.com/' },
      { id: uid(), name: 'GitHub',  url: 'https://github.com/' }
    ]
  });

  let state = defaults();
  let dragMoved = false;

  const $ = (s) => document.querySelector(s);
  function uid() { return Math.random().toString(36).slice(2, 9); }

  /* ---------------- storage ---------------- */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  async function load() {
    try {
      let saved;
      if (hasChrome) saved = (await chrome.storage.local.get(KEY))[KEY];
      else saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) merge(saved);
    } catch (e) { console.warn('load failed', e); }
  }
  function merge(saved) {
    const d = defaults();
    state = {
      settings: Object.assign(d.settings, saved.settings || {}),
      bg: Object.assign(d.bg, saved.bg || {}),
      desktop: Array.isArray(saved.desktop) ? saved.desktop : d.desktop,
      pins: Array.isArray(saved.pins) ? saved.pins : d.pins
    };
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (hasChrome) chrome.storage.local.set({ [KEY]: state });
        else localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) { console.warn('save failed', e); }
    }, 150);
  }

  /* ---------------- helpers ---------------- */
  function normUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try {
      const p = new URL(u);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    } catch { return ''; }
  }
  function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
  function faviconUrl(url) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostOf(url)) + '&sz=128';
  }
  function iconInto(parent, item, letterClass) {
    const img = document.createElement('img');
    img.src = faviconUrl(item.url);
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', () => {
      const l = document.createElement('span');
      l.className = letterClass;
      l.textContent = (item.name || hostOf(item.url) || '?').trim().charAt(0);
      img.replaceWith(l);
    });
    parent.append(img);
  }

  /* ---------------- theme + background ---------------- */
  function applyTheme() {
    const s = state.settings, r = document.documentElement.style;
    r.setProperty('--accent', s.accent);
    r.setProperty('--radius', s.radius + 'px');
    r.setProperty('--blur', s.blur + 'px');
    r.setProperty('--glass', (s.glass / 100).toString());
    r.setProperty('--icon', s.icon + 'px');
    document.body.classList.toggle('no-labels', !s.showLabels);
    document.body.classList.toggle('clock-corner', s.clockPos === 'corner');
    $('#bigClock').hidden = !s.showClock;
    $('#bigDate').hidden = !s.showDate;
    $('#tbDate').hidden = !s.showDate;
    $('#searchForm').hidden = !s.showSearch;
    $('#music').hidden = !s.showMusic;
    updateEngine();
    tick();
  }

  function renderBg() {
    const b = state.bg, s = state.settings, el = $('#bg');
    if (b.type === 'image' && b.image) {
      el.style.backgroundColor = '#000';
      el.style.backgroundImage = 'url("' + b.image.replace(/"/g, '%22') + '")';
    } else if (b.type === 'color') {
      el.style.backgroundImage = 'none';
      el.style.backgroundColor = s.bgColor;
    } else {
      el.style.backgroundColor = '#000';
      el.style.backgroundImage = GRADIENTS[b.gradient] || GRADIENTS.tide;
    }
    el.style.filter = 'blur(' + s.bgBlur + 'px)';
    $('#dim').style.opacity = (s.dim / 100).toString();
    document.querySelectorAll('.preset').forEach((p) => {
      p.classList.toggle('sel', b.type === 'gradient' && p.dataset.name === b.gradient);
    });
  }

  /* ---------------- clock ---------------- */
  let lastBig = '';
  function renderBigTime(now) {
    const s = state.settings;
    const fmt = { hour: s.hour24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !s.hour24 };
    if (s.seconds) fmt.second = '2-digit';
    const parts = new Intl.DateTimeFormat([], fmt).formatToParts(now);
    const key = parts.map((p) => p.value).join('|');
    if (key === lastBig) return;
    lastBig = key;
    const box = $('#bigTime');
    box.textContent = '';
    parts.forEach((p) => {
      const el = document.createElement('span');
      if (p.type === 'literal') {
        if (p.value.indexOf(':') === -1) return;
        el.className = 'c'; el.textContent = ':';
      } else if (p.type === 'dayPeriod') {
        el.className = 'p'; el.textContent = p.value;
      } else {
        el.className = 'd'; el.textContent = p.value;
      }
      box.append(el);
    });
  }

  function tick() {
    const s = state.settings, now = new Date();
    const opts = { hour: '2-digit', minute: '2-digit', hour12: !s.hour24 };
    if (s.seconds) opts.second = '2-digit';
    const time = now.toLocaleTimeString([], opts);
    const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const short = now.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    renderBigTime(now);
    $('#bigDate').textContent = date;
    $('#tbTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !s.hour24 });
    $('#tbDate').textContent = short;
    document.title = 'New Tab';
  }
  setInterval(tick, 1000);

  /* ---------------- desktop ---------------- */
  function maxCols() { return Math.max(1, Math.floor((innerWidth - PAD * 2) / GRID_W)); }
  function maxRows() { return Math.max(1, Math.floor((innerHeight - PAD - BOTTOM_RESERVE) / GRID_H)); }
  function occupied(col, row, exceptId) {
    return state.desktop.some((i) => i.id !== exceptId && i.col === col && i.row === row);
  }
  function freeCell() {
    const rows = maxRows(), cols = maxCols();
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (!occupied(c, r)) return { col: c, row: r };
    return { col: 0, row: 0 };
  }
  function place(el, item) {
    el.style.left = PAD + Math.min(item.col, maxCols() - 1) * GRID_W + 'px';
    el.style.top = PAD + Math.min(item.row, maxRows() - 1) * GRID_H + 'px';
  }

  function renderDesktop() {
    const d = $('#desktop');
    d.textContent = '';
    state.desktop.forEach((item) => {
      const a = document.createElement('a');
      a.className = 'icon';
      a.href = item.url;
      a.draggable = false;
      const tile = document.createElement('div');
      tile.className = 'tile';
      iconInto(tile, item, 'letter');
      const label = document.createElement('span');
      label.textContent = item.name;
      a.append(tile, label);
      place(a, item);
      d.append(a);

      a.addEventListener('click', (e) => { if (dragMoved) e.preventDefault(); });
      a.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showMenu(e.clientX, e.clientY, [
          { label: 'Open in new tab', fn: () => window.open(item.url, '_blank', 'noopener') },
          { label: 'Edit', fn: () => siteDialog('Edit shortcut', item, (v) => { Object.assign(item, v); save(); renderDesktop(); }) },
          { label: 'Pin to taskbar', fn: () => { state.pins.push({ id: uid(), name: item.name, url: item.url }); save(); renderPins(); } },
          { hr: true },
          { label: 'Remove', danger: true, fn: () => { state.desktop = state.desktop.filter((i) => i.id !== item.id); save(); renderDesktop(); } }
        ]);
      });
      enableIconDrag(a, item);
    });
  }

  function enableIconDrag(el, item) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      const ox = parseFloat(el.style.left), oy = parseFloat(el.style.top);
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        if (!moved) { moved = true; el.classList.add('dragging'); }
        el.style.left = ox + dx + 'px';
        el.style.top = oy + dy + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        if (!moved) return;
        el.classList.remove('dragging');
        dragMoved = true;
        setTimeout(() => { dragMoved = false; }, 0);
        const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
        const col = Math.max(0, Math.min(maxCols() - 1, Math.round((x - PAD) / GRID_W)));
        const row = Math.max(0, Math.min(maxRows() - 1, Math.round((y - PAD) / GRID_H)));
        if (!occupied(col, row, item.id)) { item.col = col; item.row = row; save(); }
        place(el, item);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });
  }

  /* ---------------- taskbar pins ---------------- */
  function renderPins() {
    const wrap = $('#pins');
    wrap.textContent = '';
    state.pins.forEach((pin, idx) => {
      const a = document.createElement('a');
      a.className = 'pin';
      a.href = pin.url;
      a.title = pin.name;
      a.draggable = true;
      iconInto(a, pin, 'letter');
      wrap.append(a);

      a.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showMenu(e.clientX, e.clientY, [
          { label: 'Open in new tab', fn: () => window.open(pin.url, '_blank', 'noopener') },
          { label: 'Edit', fn: () => siteDialog('Edit taskbar item', pin, (v) => { Object.assign(pin, v); save(); renderPins(); }) },
          { label: 'Add to desktop', fn: () => { const c = freeCell(); state.desktop.push({ id: uid(), name: pin.name, url: pin.url, col: c.col, row: c.row }); save(); renderDesktop(); } },
          { hr: true },
          { label: 'Unpin', danger: true, fn: () => { state.pins = state.pins.filter((p) => p.id !== pin.id); save(); renderPins(); } }
        ]);
      });

      // reorder by dragging
      a.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; });
      a.addEventListener('dragover', (e) => { e.preventDefault(); a.classList.add('drag-over'); });
      a.addEventListener('dragleave', () => a.classList.remove('drag-over'));
      a.addEventListener('drop', (e) => {
        e.preventDefault();
        a.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(from) || from === idx) return;
        const [moved] = state.pins.splice(from, 1);
        state.pins.splice(idx, 0, moved);
        save(); renderPins();
      });
    });
  }

  /* ---------------- context menu ---------------- */
  const menu = $('#menu');
  function showMenu(x, y, items, above) {
    menu.textContent = '';
    items.forEach((it) => {
      if (it.hr) { menu.append(document.createElement('hr')); return; }
      const b = document.createElement('button');
      b.textContent = it.label;
      if (it.danger) b.className = 'danger';
      b.addEventListener('click', () => { hideMenu(); it.fn(); });
      menu.append(b);
    });
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(above ? y - h : y, innerHeight - h - 8)) + 'px';
  }
  function hideMenu() { menu.hidden = true; }
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  const generalMenu = () => [
    { label: 'Add shortcut to desktop', fn: () => addToDesktop() },
    { label: 'Add to taskbar', fn: () => addPin() },
    { hr: true },
    { label: 'Files', fn: () => window.JammyOS.openFiles && window.JammyOS.openFiles() },
    { label: 'Terminal', fn: () => window.JammyOS.openTerminal && window.JammyOS.openTerminal() },
    { label: 'Open Spotify', fn: () => openSpotify() },
    { label: 'Settings and wallpaper', fn: () => toggleSettings(true) }
  ];
  $('#desktop').addEventListener('contextmenu', (e) => {
    if (e.target !== $('#desktop')) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, generalMenu());
  });
  $('#startBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 10, generalMenu(), true);
  });

  /* ---------------- add / edit dialog ---------------- */
  const dlg = $('#siteDialog');
  let dlgCb = null;
  function siteDialog(title, item, cb) {
    $('#siteTitle').textContent = title;
    $('#siteName').value = item ? item.name : '';
    $('#siteUrl').value = item ? item.url : '';
    $('#siteErr').hidden = true;
    dlgCb = cb;
    dlg.showModal();
    $('#siteUrl').focus();
  }
  $('#siteCancel').addEventListener('click', () => dlg.close());
  $('#siteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normUrl($('#siteUrl').value);
    if (!url) { $('#siteErr').hidden = false; return; }
    const name = $('#siteName').value.trim() || hostOf(url).replace(/^www\./, '');
    dlg.close();
    if (dlgCb) dlgCb({ name, url });
  });
  function addToDesktop() {
    siteDialog('Add to desktop', null, (v) => {
      const c = freeCell();
      state.desktop.push({ id: uid(), name: v.name, url: v.url, col: c.col, row: c.row });
      save(); renderDesktop();
    });
  }
  function addPin() {
    siteDialog('Add to taskbar', null, (v) => { state.pins.push({ id: uid(), name: v.name, url: v.url }); save(); renderPins(); });
  }
  $('#addPinBtn').addEventListener('click', addPin);

  /* ---------------- music (Spotify web player) ---------------- */
  // Finds an open open.spotify.com tab, reads what is playing and presses its buttons.
  const SPOTIFY_MATCH = '*://open.spotify.com/*';
  const music = $('#music'), mArt = $('#m-art'), mTitle = $('#m-title'), mArtist = $('#m-artist');
  const hasTabs = typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.scripting;

  async function findSpotifyTab() {
    // prefer the tab that is actually making sound, otherwise any Spotify tab
    let tabs = await chrome.tabs.query({ url: SPOTIFY_MATCH, audible: true });
    if (!tabs.length) tabs = await chrome.tabs.query({ url: SPOTIFY_MATCH });
    return tabs[0] || null;
  }

  // runs inside the Spotify page, so it must be fully self-contained
  function readPlayerState() {
    const q = (s) => document.querySelector(s);
    const toggle = q('[data-testid="control-button-playpause"]');
    if (!toggle) return null;
    const title = q('[data-testid="context-item-link"]');
    const artist = q('[data-testid="context-item-info-artist"]') ||
      q('[data-testid="now-playing-widget"] a[href*="/artist/"]');
    const art = q('[data-testid="cover-art-image"]') || q('[data-testid="now-playing-widget"] img');
    return {
      playing: /pause/i.test(toggle.getAttribute('aria-label') || ''),
      title: title ? title.textContent.trim() : '',
      artist: artist ? artist.textContent.trim() : '',
      art: art ? art.src : ''
    };
  }

  // runs inside the Spotify page
  function pressButton(action) {
    const ids = { toggle: 'control-button-playpause', next: 'control-button-skip-forward', prev: 'control-button-skip-back' };
    const b = document.querySelector('[data-testid="' + ids[action] + '"]');
    if (b) b.click();
  }

  function setMusicState(s) {
    music.dataset.state = s;
    if (s === 'idle') {
      music.classList.remove('playing');
      mTitle.textContent = 'Press play in Spotify';
      mArtist.textContent = '';
    }
  }

  function renderMusic(info, tab) {
    let title = info.title, artist = info.artist;
    // fallback: while playing, the tab title reads "Song • Artist"
    if (!title && tab && tab.title && tab.title.indexOf(' • ') > -1) {
      const parts = tab.title.split(' • ');
      title = parts[0]; artist = artist || parts.slice(1).join(' • ');
    }
    setMusicState('ready');
    music.classList.toggle('playing', info.playing);
    mTitle.textContent = title || 'Nothing playing';
    mArtist.textContent = artist || '';
    if (info.art && mArt.getAttribute('src') !== info.art) mArt.src = info.art;
    mArt.hidden = !info.art;
    music.style.setProperty('--art', info.art ? 'url("' + info.art.replace(/"/g, '%22') + '")' : 'none');
  }

  async function refreshMusic() {
    if (document.hidden || !state.settings.showMusic) return;
    try {
      const tab = await findSpotifyTab();
      if (!tab) return setMusicState('none');
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPlayerState });
      const info = res && res.result;
      if (!info) return setMusicState('idle');
      renderMusic(info, tab);
    } catch (err) {
      setMusicState('idle'); // tab still loading, discarded, or not allowed yet
    }
  }

  async function controlMusic(action) {
    try {
      const tab = await findSpotifyTab();
      if (tab) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pressButton, args: [action] });
        setTimeout(refreshMusic, 250);
      }
    } catch (err) { /* ignore */ }
    if (state.settings.showSearch) qInput.focus(); // hand the cursor back to the search box
  }

  async function openSpotify() {
    try {
      const tab = await findSpotifyTab();
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: 'https://open.spotify.com/' });
      }
    } catch (err) {
      window.open('https://open.spotify.com/', '_blank');
    }
  }

  $('#m-prev').addEventListener('click', () => controlMusic('prev'));
  $('#m-toggle').addEventListener('click', () => controlMusic('toggle'));
  $('#m-next').addEventListener('click', () => controlMusic('next'));
  $('#m-open').addEventListener('click', openSpotify);
  $('#spBtn').addEventListener('click', openSpotify);
  if (hasTabs) {
    document.addEventListener('visibilitychange', refreshMusic);
    refreshMusic();
    setInterval(refreshMusic, 1500);
  }

  /* ---------------- settings panel ---------------- */
  const panel = $('#settings');
  function toggleSettings(force) {
    panel.hidden = typeof force === 'boolean' ? !force : !panel.hidden;
    if (!panel.hidden) syncControls();
  }
  $('#setBtn').addEventListener('click', () => toggleSettings());
  $('#setClose').addEventListener('click', () => toggleSettings(false));

  function syncControls() {
    panel.querySelectorAll('[data-key]').forEach((el) => {
      const v = state.settings[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    $('#bgColor').value = state.settings.bgColor;
    renderBg();
  }
  panel.querySelectorAll('[data-key]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.key;
      state.settings[k] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value);
      save(); applyTheme(); renderBg();
    });
  });

  // presets
  Object.keys(GRADIENTS).forEach((name) => {
    const b = document.createElement('button');
    b.className = 'preset';
    b.dataset.name = name;
    b.title = name;
    b.style.backgroundImage = GRADIENTS[name];
    b.addEventListener('click', () => { state.bg.type = 'gradient'; state.bg.gradient = name; save(); renderBg(); });
    $('#presets').append(b);
  });
  $('#bgColor').addEventListener('input', (e) => {
    state.settings.bgColor = e.target.value; state.bg.type = 'color'; save(); renderBg();
  });

  // image upload (downscaled so storage stays small)
  $('#uploadBtn').addEventListener('click', () => $('#bgFile').click());
  $('#bgFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 2560, scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        state.bg.type = 'image'; state.bg.image = c.toDataURL('image/jpeg', 0.88);
        save(); renderBg();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  $('#bgUrlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normUrl($('#bgUrl').value);
    if (!url) return;
    state.bg.type = 'image'; state.bg.image = url;
    $('#bgUrl').value = '';
    save(); renderBg();
  });
  $('#clearImgBtn').addEventListener('click', () => {
    state.bg.image = ''; state.bg.type = 'gradient'; save(); renderBg();
  });

  // data
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Object.assign({}, state, { files: window.JammyFS ? window.JammyFS.dump() : undefined }), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'jammyos-backup.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      merge(data);
      if (data.files && window.JammyFS) window.JammyFS.restore(data.files);
      save(); renderAll(); syncControls();
    }
    catch { alert('That file could not be imported.'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Reset settings, shortcuts and wallpaper? Your documents are not touched.')) return;
    state = defaults(); save(); renderAll(); syncControls();
  });

  /* ---------------- search ---------------- */
  const ENGINES = {
    brave:  'https://search.brave.com/search?q=',
    google: 'https://www.google.com/search?q=',
    ddg:    'https://duckduckgo.com/?q=',
    bing:   'https://www.bing.com/search?q='
  };
  const qInput = $('#q');
  const ENGINE_NAMES = { brave: 'Brave', google: 'Google', ddg: 'DuckDuckGo', bing: 'Bing' };
  function updateEngine() {
    const b = $('#engineBtn'), name = ENGINE_NAMES[state.settings.engine] || 'Brave';
    b.textContent = name;
    b.title = 'Searching with ' + name + '. Click to switch.';
  }
  $('#engineBtn').addEventListener('click', () => {
    const keys = Object.keys(ENGINES), i = keys.indexOf(state.settings.engine);
    state.settings.engine = keys[(i + 1) % keys.length];
    save(); updateEngine(); qInput.focus();
    const sel = panel.querySelector('[data-key="engine"]');
    if (sel) sel.value = state.settings.engine;
  });
  function looksLikeUrl(text) {
    if (/^https?:\/\//i.test(text)) return true;
    if (/\s/.test(text)) return false;
    return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text) || /^localhost(:\d+)?(\/.*)?$/i.test(text);
  }
  function focusSearch() {
    if (state.settings.showSearch && !qInput.closest('[hidden]') &&
        (!document.activeElement || document.activeElement === document.body)) qInput.focus();
  }
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = qInput.value.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      location.href = /^https?:\/\//i.test(text) ? text : 'https://' + text;
    } else {
      location.href = (ENGINES[state.settings.engine] || ENGINES.brave) + encodeURIComponent(text);
    }
  });
  // keep the cursor in the search box, and let typing anywhere start a search
  window.addEventListener('load', focusSearch);
  window.addEventListener('focus', focusSearch);
  setTimeout(focusSearch, 50);
  setTimeout(focusSearch, 250);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (document.activeElement === document.body) focusSearch();
  });

  /* ---------------- misc ---------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideMenu(); if (!panel.hidden) toggleSettings(false); }
  });
  window.addEventListener('resize', () => { renderDesktop(); });

  function renderAll() {
    applyTheme(); renderBg(); renderDesktop(); renderPins();
  }

  /* ---------------- shared with the other JammyOS apps ---------------- */
  window.JammyOS = Object.assign(window.JammyOS || {}, {
    showMenu, hideMenu, openSpotify,
    settings: () => state.settings,
    setSetting: (k, v) => { state.settings[k] = v; save(); applyTheme(); renderBg(); },
    wallpapers: () => Object.keys(GRADIENTS),
    setWallpaper: (name) => {
      if (!GRADIENTS[name]) return false;
      state.bg.type = 'gradient'; state.bg.gradient = name; save(); renderBg();
      return true;
    },
    resolveQuery: (text) => looksLikeUrl(text)
      ? (/^https?:\/\//i.test(text) ? text : 'https://' + text)
      : (ENGINES[state.settings.engine] || ENGINES.brave) + encodeURIComponent(text)
  });

  load().then(() => {
    renderAll(); focusSearch();
    requestAnimationFrame(() => document.body.classList.add('ready'));
  });
  setTimeout(() => document.body.classList.add('ready'), 800);
})();
