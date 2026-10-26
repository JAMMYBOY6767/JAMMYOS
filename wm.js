/* JammyOS window helper: dragging, focus order and maximise for the Files and Terminal windows. */
(() => {
  'use strict';
  const wins = [];

  function front(win) {
    wins.forEach((w) => { w.style.zIndex = w === win ? 9 : 8; });
  }
  const isFront = (win) => win.style.zIndex === '9' || wins.length === 1;

  function setup(win, bar) {
    wins.push(win);
    win.addEventListener('pointerdown', () => front(win), true);
    bar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) win.classList.toggle('max');
    });
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || win.classList.contains('max')) return;
      const r = win.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        win.style.left = Math.min(Math.max(0, ev.clientX - dx), innerWidth - 120) + 'px';
        win.style.top = Math.min(Math.max(0, ev.clientY - dy), innerHeight - 60) + 'px';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
      e.preventDefault();
    });
    return {
      front: () => front(win),
      isFront: () => isFront(win),
      place(w, h, offset) {
        const width = Math.min(w, innerWidth - 32), height = Math.min(h, innerHeight - 120);
        win.style.width = width + 'px';
        win.style.height = height + 'px';
        win.style.left = Math.max(16, (innerWidth - width) / 2 + (offset || 0)) + 'px';
        win.style.top = Math.max(16, (innerHeight - height - 80) / 2 + Math.abs(offset || 0) / 2) + 'px';
      }
    };
  }

  window.JammyWM = { setup };
})();
