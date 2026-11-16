// Small helpers shared by every view.
export const TPD = 7;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const inr = (x, d = 2) => '₹' + Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const inr0 = (x) => inr(x, 0);
export const cr = (x) => '₹' + Math.round(x).toLocaleString('en-IN') + ' cr';
export const num = (x) => Math.round(x).toLocaleString('en-IN');
export const pct = (x, d = 1, sign = true) => (sign && x > 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
export const cls = (x) => (x > 0.00005 ? 'up' : x < -0.00005 ? 'down' : 'flat');
export const dayOf = (t) => Math.floor((t - 1) / TPD) + 1;
export const slotOf = (t) => (((t - 1) % TPD) + TPD) % TPD;
// Indian equity hours: tick 1 of each day is the hour before the open (8:15 to 9:15), ticks 2 to 7 are trading (last one ends 3:30 PM).
export const PRE_MIN = 8 * 60 + 15, OPEN_MIN = 9 * 60 + 15, CLOSE_MIN = 15 * 60 + 30;
export const fmtMin = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${h > 12 ? h - 12 : h}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
export const hoursLeft = (m) => { const h = Math.floor(m / 60), mm = m % 60; return h && mm ? `${h}h ${mm}m` : h ? `${h} hour${h > 1 ? 's' : ''}` : `${mm} min`; };
export function clockOf(t, minute = 0) { // time at which tick t begins, plus minutes into it
  if (t <= 0) return 'Pre-open';
  return fmtMin(PRE_MIN + 60 * slotOf(t) + minute);
}
export const stamp = (t, minute = 0) => (t <= 0 ? 'Before the open' : `Day ${dayOf(t)}, ${clockOf(t, minute)}`);
export const tickLabel = (t) => (t <= 0 ? `${-t + 1}h before start` : `Day ${dayOf(t)} ${clockOf(t)}`);
const ICONS = {
  rocket: 'M12 3c3.2 2 5 5.2 5 9.2l-2.2 3.3H9.2L7 12.2C7 8.2 8.8 5 12 3Zm-3 12.5L6.5 20l3.6-1.2m4.9-3.3 2.5 4.5-3.6-1.2M12 10.5h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  bot: 'M12 4v3M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm3 5h.01M15 13h.01M9 17h6',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10',
  terminal: 'M3 18h18M5 14l4-5 3.5 3L19 6',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-2 2M7.5 9h6M7.5 12.5h6M7.5 16h3.5',
  portfolio: 'M4 8h16v11H4V8Zm5-3h6v3H9V5ZM4 13h16',
  companies: 'M4 20V6l7-3v17M11 9l9 3v8M7.5 8.5h.01M7.5 12h.01M7.5 15.5h.01M15 15h.01M15 18h.01',
  learn: 'M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3ZM9.5 19h5M10.5 21.5h3',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5M12 8v4.5l3 1.8',
  play: 'M7 4.5v15l12-7.5-12-7.5Z', pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z', step: 'M5 5v14l9-7-9-7Zm10 0v14h3V5h-3Z',
  close: 'M6 6l12 12M18 6 6 18', info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', chevron: 'M8 10l4 4 4-4', check: 'M5 12.5l4.5 4.5L19 7.5',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19a5.5 5.5 0 0 1 11 0M16 11a2.5 2.5 0 1 0 0-5M17.5 14.2A5 5 0 0 1 21 19',
  copy: 'M9 9h10v11H9V9ZM5 15V4h10',
  volume: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM16 9.5l5 5M21 9.5l-5 5',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z', shield: 'M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6l-7-3Z', refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5',
};
export const icon = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ''}"/></svg>`;
export function toast(msg, kind = 'info', ms = 4200) {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
