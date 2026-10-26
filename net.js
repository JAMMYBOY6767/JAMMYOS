/* JammyOS network indicator.
   Browsers can't read real Wi-Fi signal strength or the network name, so the bars are
   estimated from what the browser does report: online/offline, connection class, latency. */
(() => {
  'use strict';

  const btn = document.getElementById('netBtn');
  const LABELS = ['Offline', 'Weak', 'Fair', 'Good', 'Excellent'];
  const conn = () => navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

  function level(o) {
    if (!o.online) return 0;
    switch (o.type) {
      case 'slow-2g':
      case '2g': return 1;
      case '3g': return 2;
      case '4g':
        // Chrome calls anything faster than ~0.7 Mbps "4g", so grade by the numbers too
        if ((o.rtt && o.rtt > 200) || (o.down && o.down < 1)) return 2;
        if ((o.rtt && o.rtt > 100) || (o.down && o.down < 5)) return 3;
        return 4;
      default: return 4;          // browser doesn't say, but we are online
    }
  }

  function info() {
    const c = conn();
    const o = {
      online: navigator.onLine,
      type: c && c.effectiveType ? c.effectiveType : null,
      down: c && c.downlink > 0 ? c.downlink : null,
      rtt: c && c.rtt > 0 ? c.rtt : null,
      saveData: !!(c && c.saveData)
    };
    o.level = level(o);
    o.label = LABELS[o.level];
    return o;
  }

  function summary(o) {
    if (!o.online) return 'Offline. Check your Wi-Fi or cable.';
    const bits = ['Online, ' + o.label.toLowerCase() + ' connection'];
    if (o.down) bits.push('about ' + o.down + ' Mbps');
    if (o.rtt) bits.push(o.rtt + ' ms latency');
    return bits.join(', ');
  }

  function paint() {
    if (!btn) return;
    const o = info();
    btn.dataset.level = o.level;
    btn.classList.toggle('off', !o.online);
    btn.querySelectorAll('.wf').forEach((el, i) => el.classList.toggle('on', i < o.level));
    const text = summary(o);
    btn.title = text + '. Click for details.';
    btn.setAttribute('aria-label', 'Network: ' + text);
  }

  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  const c = conn();
  if (c && c.addEventListener) c.addEventListener('change', paint);
  setInterval(paint, 15000);
  paint();

  if (btn) {
    btn.addEventListener('click', () => {
      if (window.JammyOS && window.JammyOS.terminal) window.JammyOS.terminal('wifi');
    });
  }

  window.JammyNet = { info, summary, LABELS };
})();
