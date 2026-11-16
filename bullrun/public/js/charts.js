// Dependency-free charting: indicators, chart analysis ("Chart Intelligence") and canvas renderers.
import { inr, tickLabel, num, pct } from './util.js';

// ---------- indicators ----------
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export const sma = (v, n) => v.map((_, i) => (i < n - 1 ? null : avg(v.slice(i - n + 1, i + 1))));
export function ema(v, n) { const k = 2 / (n + 1); const out = []; let p = null; v.forEach((x, i) => { p = i === 0 ? x : x * k + p * (1 - k); out.push(i < n - 1 ? null : p); }); return out; }
export function bollinger(v, n = 20, k = 2) {
  const mid = sma(v, n); const up = [], lo = [];
  v.forEach((_, i) => { if (mid[i] === null) { up.push(null); lo.push(null); return; } const w = v.slice(i - n + 1, i + 1); const sd = Math.sqrt(avg(w.map((x) => (x - mid[i]) ** 2))); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd); });
  return { mid, up, lo };
}
export function rsi(v, n = 14) {
  const out = v.map(() => null); if (v.length <= n) return out; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) { const d = v[i] - v[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  return out;
}
export function macd(v) {
  const e12 = ema(v, 12), e26 = ema(v, 26); const line = v.map((_, i) => (e12[i] !== null && e26[i] !== null ? e12[i] - e26[i] : null));
  const first = line.findIndex((x) => x !== null); const sig = line.map(() => null); const k = 2 / 10; let p = null;
  for (let i = first; i < line.length; i++) { p = p === null ? line[i] : line[i] * k + p * (1 - k); if (i >= first + 8) sig[i] = p; }
  return { line, sig, hist: line.map((x, i) => (x !== null && sig[i] !== null ? x - sig[i] : null)) };
}
export function pivots(c, w = 3) {
  const hi = [], lo = [];
  for (let i = w; i < c.length - w; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= w; j++) { if (c[i].h < c[i - j].h || c[i].h < c[i + j].h) isH = false; if (c[i].l > c[i - j].l || c[i].l > c[i + j].l) isL = false; }
    if (isH) hi.push({ i, p: c[i].h }); if (isL) lo.push({ i, p: c[i].l });
  }
  return { hi, lo };
}
// Cluster pivots into price zones, return nearest support below and resistance above the last price.
export function levels(c, lookback = 90) {
  const base = Math.max(0, c.length - lookback); const sl = c.slice(base); const pv = pivots(sl, 3); const last = c[c.length - 1].c;
  const clusters = (pts) => { const out = []; for (const p of pts.sort((a, b) => a.p - b.p)) { const g = out.find((x) => Math.abs(x.p - p.p) / x.p < 0.012); if (g) { g.n++; g.p = (g.p * (g.n - 1) + p.p) / g.n; g.last = Math.max(g.last, p.i + base); } else out.push({ p: p.p, n: 1, last: p.i + base }); } return out; };
  const all = clusters([...pv.lo, ...pv.hi]);
  const sup = all.filter((x) => x.p < last * 0.998).sort((a, b) => b.p - a.p)[0] || null;
  const res = all.filter((x) => x.p > last * 1.002).sort((a, b) => a.p - b.p)[0] || null;
  return { support: sup, resistance: res };
}
export function trend(c, n = 30) {
  const k = Math.min(n, c.length); const ys = c.slice(-k).map((x) => x.c); const xs = ys.map((_, i) => i);
  const mx = avg(xs), my = avg(ys); let nu = 0, de = 0; xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; });
  const m = nu / de; const b = my - m * mx; const startI = c.length - k;
  return { i0: startI, y0: b, i1: c.length - 1, y1: b + m * (k - 1), slopePct: (m * (k - 1)) / ys[0] };
}

// ---------- Chart Intelligence: explains the situation, never says buy or sell ----------
export const PATTERNS = {
  uptrend: 'An uptrend', downtrend: 'A downtrend', range: 'A sideways range', reversal_up: 'A possible turn upward', reversal_down: 'A possible turn downward',
};
export function analyze(c, name = 'This stock') {
  const n = c.length; const cl = c.map((x) => x.c); const last = cl[n - 1];
  const m20 = sma(cl, 20), m50 = sma(cl, 50), r = rsi(cl), md = macd(cl), bb = bollinger(cl); const L = levels(c);
  const ch20 = last / cl[Math.max(0, n - 21)] - 1, prior = cl[Math.max(0, n - 11)] / cl[Math.max(0, n - 26)] - 1, recent = last / cl[Math.max(0, n - 9)] - 1;
  const rNow = r[n - 1], rBack = r[n - 6]; const v5 = avg(c.slice(-5).map((x) => x.v)), v20 = avg(c.slice(-25, -5).map((x) => x.v)); const vr = v5 / (v20 || 1);
  let pattern = 'range';
  if (m50[n - 1] !== null && m20[n - 1] > m50[n - 1] && last > m20[n - 1] && ch20 > 0.02) pattern = 'uptrend';
  else if (m50[n - 1] !== null && m20[n - 1] < m50[n - 1] && last < m20[n - 1] && ch20 < -0.02) pattern = 'downtrend';
  if (prior < -0.05 && recent > 0.015 && rNow !== null && rBack !== null && rNow > rBack + 5 && rNow < 62) pattern = 'reversal_up';
  if (prior > 0.05 && recent < -0.015 && rNow !== null && rBack !== null && rNow < rBack - 5 && rNow > 38) pattern = 'reversal_down';
  const bullets = [];
  const ma = m20[n - 1] !== null && m50[n - 1] !== null ? (m20[n - 1] > m50[n - 1] ? 'above' : 'below') : null;
  bullets.push(`Over the last 20 hours the price moved ${pct(ch20)}${ma ? `, and the short-term average sits ${ma} the longer-term one` : ''}.`);
  if (L.support) bullets.push(`Price has bounced near ${inr(L.support.p, 0)} ${L.support.n >= 2 ? `${L.support.n} times` : 'once'}, so that area may act as support.`);
  if (L.resistance) bullets.push(`Price has struggled around ${inr(L.resistance.p, 0)} ${L.resistance.n >= 2 ? `${L.resistance.n} times` : 'before'}, so that area may act as resistance.`);
  bullets.push(vr > 1.25 ? `Trading volume over the last 5 hours is ${Math.round((vr - 1) * 100)}% above normal, so more people are taking part in this move.` : vr < 0.8 ? `Volume is ${Math.round((1 - vr) * 100)}% below normal, so the recent move has limited participation behind it.` : 'Trading volume is close to normal.');
  if (rNow !== null) bullets.push(rNow > 70 ? `RSI is ${Math.round(rNow)}: buying has been strong and the stock may be stretched.` : rNow < 30 ? `RSI is ${Math.round(rNow)}: selling has been heavy and the stock may be oversold.` : `RSI is ${Math.round(rNow)}, inside its normal range, so momentum is not extreme.`);
  const h = md.hist[n - 1], hp = md.hist[n - 4]; if (h !== null && hp !== null) bullets.push(h > 0 ? (h > hp ? 'MACD momentum is positive and strengthening.' : 'MACD momentum is positive but fading.') : (h < hp ? 'MACD momentum is negative and strengthening.' : 'MACD momentum is negative but easing.'));
  const meaning = {
    uptrend: `${name} has been making higher prices on average. Trends can persist, but they also end, especially when news or valuation changes.`,
    downtrend: `${name} has been drifting lower. A falling price is not automatically a bargain; it may reflect real problems or just fear.`,
    range: `${name} is moving sideways without a clear direction. Ranges often end with a breakout, but the direction is hard to know in advance.`,
    reversal_up: `${name} fell earlier but is now recovering with improving momentum. It may be trying to turn upward, though many such attempts fail.`,
    reversal_down: `${name} rose earlier but is now losing steam. It may be starting to turn downward, though many pullbacks are short-lived.`,
  }[pattern];
  const consider = ['Is the volume strong enough to trust this move?', 'Is there news pending that could change the picture?', pattern.startsWith('reversal') ? 'What price would prove this interpretation wrong?' : 'What would make you change your mind about this reading?', 'How much money are you willing to risk if you are wrong?'];
  return { pattern, label: PATTERNS[pattern], bullets: bullets.slice(0, 5), meaning, consider, caveat: 'Chart patterns describe the past. They are not guarantees about what happens next.', L, rsi: rNow, volRatio: vr };
}

// ---------- canvas helpers ----------
function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); const w = canvas.clientWidth || 600, h = canvas.clientHeight || 300;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h };
}
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const palette = () => ({ up: css('--up'), down: css('--down'), text: css('--text'), muted: css('--muted'), line: css('--line'), panel: css('--panel'), sig: css('--signal'), amber: '#f5b942', violet: '#a98bff' });
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1; const raw = span / n; const mag = 10 ** Math.floor(Math.log10(raw)); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v); return out;
}
const fmtP = (v) => (v >= 1000 ? num(v) : v.toFixed(2));

export function drawPrice(canvas, cfg) {
  const P = palette(); const { candles: all, type = 'candle', range = 60, ind = {}, costLine = null, markers = [] } = cfg;
  const cl = all.map((x) => x.c);
  const calc = { m20: sma(cl, 20), m50: sma(cl, 50), bb: bollinger(cl), r: rsi(cl), md: macd(cl) };
  const nShow = range === 'all' ? all.length : Math.min(range, all.length); const off = all.length - nShow; const bars = all.slice(off);
  let hover = -1;
  function paint() {
    const { ctx, w, h } = fit(canvas); ctx.clearRect(0, 0, w, h); ctx.font = '11px IBM Plex Sans, system-ui, sans-serif';
    const L = 8, R = 58, axisH = 20, gap = 8; const rsiH = ind.rsi ? 64 : 0, macdH = ind.macd ? 72 : 0; const subs = (rsiH ? rsiH + gap : 0) + (macdH ? macdH + gap : 0);
    const mainH = h - axisH - subs; const plotW = w - L - R; const bw = plotW / bars.length; const X = (i) => L + (i + 0.5) * bw;
    let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
    if (ind.bb) for (let i = 0; i < bars.length; i++) { const u = calc.bb.up[off + i], l = calc.bb.lo[off + i]; if (u !== null) { hi = Math.max(hi, u); lo = Math.min(lo, l); } }
    if (costLine) { lo = Math.min(lo, costLine); hi = Math.max(hi, costLine); }
    const padV = (hi - lo) * 0.08 || 1; lo -= padV; hi += padV; const volH = ind.vol ? mainH * 0.2 : 0;
    const Y = (p) => 4 + (mainH - 8 - volH * 0.0) * (1 - (p - lo) / (hi - lo));
    // grid
    ctx.strokeStyle = P.line; ctx.fillStyle = P.muted; ctx.lineWidth = 1; ctx.textAlign = 'left';
    for (const t of niceTicks(lo, hi, 5)) { const y = Math.round(Y(t)) + 0.5; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(fmtP(t), w - R + 6, y + 4); }
    const step = Math.max(1, Math.round(bars.length / Math.max(2, Math.floor(plotW / 110))));
    ctx.textAlign = 'center'; for (let i = Math.floor(step / 2); i < bars.length; i += step) { ctx.fillText(tickLabel(bars[i].t), X(i), h - 5); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(Math.round(X(i)) + 0.5, 0); ctx.lineTo(Math.round(X(i)) + 0.5, mainH + (subs || 0)); ctx.stroke(); ctx.globalAlpha = 1; }
    // volume
    if (ind.vol) { const mv = Math.max(...bars.map((b) => b.v)); bars.forEach((b, i) => { const vh = (b.v / mv) * volH; ctx.fillStyle = b.c >= b.o ? P.up : P.down; ctx.globalAlpha = 0.28; ctx.fillRect(X(i) - bw * 0.35, mainH - vh, bw * 0.7, vh); ctx.globalAlpha = 1; }); }
    // bollinger band fill
    if (ind.bb) { ctx.beginPath(); let started = false; for (let i = 0; i < bars.length; i++) { const u = calc.bb.up[off + i]; if (u === null) continue; started ? ctx.lineTo(X(i), Y(u)) : ctx.moveTo(X(i), Y(u)); started = true; } for (let i = bars.length - 1; i >= 0; i--) { const l = calc.bb.lo[off + i]; if (l === null) continue; ctx.lineTo(X(i), Y(l)); } ctx.closePath(); ctx.fillStyle = P.sig; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; }
    const polyline = (arr, color, wd = 1.4, dash = []) => { ctx.beginPath(); let s = false; for (let i = 0; i < bars.length; i++) { const v = arr[off + i]; if (v === null || v === undefined) continue; s ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); s = true; } ctx.strokeStyle = color; ctx.lineWidth = wd; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); };
    if (ind.bb) { polyline(calc.bb.up, P.sig, 1, [3, 3]); polyline(calc.bb.lo, P.sig, 1, [3, 3]); }
    // S/R + trend + cost
    const tags = []; const tag = (txt, y, color) => tags.push({ txt, y, color });
    if (ind.sr) { const lv = levels(all); for (const [z, c, t] of [[lv.support, P.up, 'Support'], [lv.resistance, P.down, 'Resistance']]) { if (!z) continue; const y = Y(z.p); ctx.strokeStyle = c; ctx.globalAlpha = 0.7; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; tag(`${t} ${fmtP(z.p)}`, y, c); } }
    if (ind.trend) { const t = trend(all, 30); const i0 = Math.max(0, t.i0 - off), i1 = t.i1 - off; if (i1 >= 0) { ctx.strokeStyle = P.amber; ctx.lineWidth = 1.6; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(X(i0), Y(t.y0 + (t.y1 - t.y0) * ((off + i0 - t.i0) / (t.i1 - t.i0)))); ctx.lineTo(X(i1), Y(t.y1)); ctx.stroke(); ctx.setLineDash([]); } }
    if (costLine) { const y = Y(costLine); ctx.strokeStyle = P.sig; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.setLineDash([]); tag('Your average cost ' + fmtP(costLine), y, P.sig); }
    // price series
    if (type === 'line') {
      ctx.beginPath(); bars.forEach((b, i) => (i ? ctx.lineTo(X(i), Y(b.c)) : ctx.moveTo(X(i), Y(b.c)))); const up = bars[bars.length - 1].c >= bars[0].c; const col = up ? P.up : P.down;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(); ctx.lineTo(X(bars.length - 1), mainH); ctx.lineTo(X(0), mainH); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, mainH); g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.fill();
    } else {
      bars.forEach((b, i) => { const upc = b.c >= b.o; const col = upc ? P.up : P.down; const x = X(i); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(b.h)); ctx.lineTo(Math.round(x) + 0.5, Y(b.l)); ctx.stroke(); const top = Y(Math.max(b.o, b.c)), bh = Math.max(1.5, Math.abs(Y(b.o) - Y(b.c))); ctx.fillRect(x - Math.max(1, bw * 0.32), top, Math.max(2, bw * 0.64), bh); });
    }
    if (ind.ma) { polyline(calc.m20, P.amber, 1.3); polyline(calc.m50, P.violet, 1.3); }
    for (const t of tags) { ctx.font = '10.5px IBM Plex Sans, system-ui, sans-serif'; const tw = ctx.measureText(t.txt).width; ctx.fillStyle = P.panel; ctx.globalAlpha = 0.85; ctx.fillRect(w - R - tw - 12, t.y - 15, tw + 8, 14); ctx.globalAlpha = 1; ctx.textAlign = 'right'; ctx.fillStyle = t.color; ctx.fillText(t.txt, w - R - 8, t.y - 4); ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; }
    // news markers
    for (const m of markers) { const i = bars.findIndex((b) => b.t === m.t); if (i < 0) continue; ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(X(i), mainH - 5, 3.2, 0, 7); ctx.fill(); }
    // last price tag
    const lastB = bars[bars.length - 1]; const ly = Y(lastB.c); ctx.fillStyle = lastB.c >= lastB.o ? P.up : P.down; ctx.fillRect(w - R + 2, ly - 9, R - 4, 18); ctx.fillStyle = '#06101f'; ctx.textAlign = 'center'; ctx.font = 'bold 11px IBM Plex Sans, system-ui, sans-serif'; ctx.fillText(fmtP(lastB.c), w - R / 2 + 1, ly + 4); ctx.font = '11px IBM Plex Sans, system-ui, sans-serif';
    // sub panes
    let top = mainH + gap;
    const pane = (hh, title, lo2, hi2, body) => { const Y2 = (v) => top + hh * (1 - (v - lo2) / (hi2 - lo2)); ctx.strokeStyle = P.line; ctx.strokeRect(L + 0.5, top + 0.5, plotW, hh); ctx.fillStyle = P.muted; ctx.textAlign = 'left'; ctx.fillText(title, L + 6, top + 13); body(Y2); top += hh + gap; };
    if (rsiH) pane(rsiH, 'RSI 14', 0, 100, (Y2) => { for (const v of [30, 70]) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(L, Y2(v)); ctx.lineTo(w - R, Y2(v)); ctx.stroke(); ctx.setLineDash([]); ctx.textAlign = 'left'; ctx.fillText(v, w - R + 6, Y2(v) + 4); } ctx.beginPath(); let s = false; for (let i = 0; i < bars.length; i++) { const v = calc.r[off + i]; if (v === null) continue; s ? ctx.lineTo(X(i), Y2(v)) : ctx.moveTo(X(i), Y2(v)); s = true; } ctx.strokeStyle = P.violet; ctx.lineWidth = 1.5; ctx.stroke(); });
    if (macdH) { const hs = calc.md.hist.slice(off).filter((x) => x !== null), ls = calc.md.line.slice(off).filter((x) => x !== null); const mx = Math.max(0.0001, ...hs.map(Math.abs), ...ls.map(Math.abs)); pane(macdH, 'MACD 12, 26, 9', -mx, mx, (Y2) => { const z = Y2(0); bars.forEach((b, i) => { const v = calc.md.hist[off + i]; if (v === null) return; ctx.fillStyle = v >= 0 ? P.up : P.down; ctx.globalAlpha = 0.5; ctx.fillRect(X(i) - bw * 0.35, Math.min(z, Y2(v)), bw * 0.7, Math.abs(Y2(v) - z)); ctx.globalAlpha = 1; }); for (const [arr, col] of [[calc.md.line, P.sig], [calc.md.sig, P.amber]]) { ctx.beginPath(); let s = false; for (let i = 0; i < bars.length; i++) { const v = arr[off + i]; if (v === null) continue; s ? ctx.lineTo(X(i), Y2(v)) : ctx.moveTo(X(i), Y2(v)); s = true; } ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke(); } }); }
    // crosshair + readout
    const hb = hover >= 0 ? bars[hover] : lastB; const hi_ = hover >= 0 ? hover : bars.length - 1;
    if (hover >= 0) { ctx.strokeStyle = P.muted; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(Math.round(X(hover)) + 0.5, 0); ctx.lineTo(Math.round(X(hover)) + 0.5, h - axisH); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    ctx.textAlign = 'left'; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; ctx.fillStyle = P.muted;
    let txt = `${tickLabel(hb.t)}   O ${fmtP(hb.o)}  H ${fmtP(hb.h)}  L ${fmtP(hb.l)}  C ${fmtP(hb.c)}  Vol ${num(hb.v)}`;
    if (ind.ma && calc.m20[off + hi_] !== null) txt += `   MA20 ${fmtP(calc.m20[off + hi_])}`;
    ctx.fillStyle = P.text; ctx.globalAlpha = 0.85; ctx.fillText(txt, L + 6, 14); ctx.globalAlpha = 1;
    if (hover >= 0) { const mk = markers.find((m) => m.t === hb.t); if (mk) { ctx.fillStyle = mk.color; ctx.fillText('● ' + mk.label, L + 6, 30); } }
  }
  const onMove = (e) => { const rect = canvas.getBoundingClientRect(); const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left; const plotW = rect.width - 66; const i = Math.floor(((x - 8) / plotW) * bars.length); hover = i >= 0 && i < bars.length ? i : -1; paint(); };
  const onLeave = () => { hover = -1; paint(); };
  canvas.onmousemove = onMove; canvas.onmouseleave = onLeave; canvas.ontouchmove = onMove; canvas.ontouchend = onLeave;
  paint(); return { repaint: paint };
}

// Multi-series line chart (portfolio vs index, index history). series: [{name,color,values,fill}]
export function drawLines(canvas, { series, labels = null, fmt = (v) => v.toFixed(1), base = null }) {
  const P = palette(); let hover = -1;
  function paint() {
    const { ctx, w, h } = fit(canvas); ctx.clearRect(0, 0, w, h); ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; const L = 6, R = 52, B = 18, T = 8;
    const n = Math.max(...series.map((s) => s.values.length)); const all = series.flatMap((s) => s.values); let lo = Math.min(...all), hi = Math.max(...all); if (base !== null) { lo = Math.min(lo, base); hi = Math.max(hi, base); } const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const X = (i) => L + (i / Math.max(1, n - 1)) * (w - L - R), Y = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
    ctx.strokeStyle = P.line; ctx.fillStyle = P.muted; ctx.textAlign = 'left';
    for (const t of niceTicks(lo, hi, 4)) { const y = Math.round(Y(t)) + 0.5; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillText(fmt(t), w - R + 6, y + 4); }
    if (base !== null) { ctx.setLineDash([4, 4]); ctx.strokeStyle = P.muted; ctx.beginPath(); ctx.moveTo(L, Y(base)); ctx.lineTo(w - R, Y(base)); ctx.stroke(); ctx.setLineDash([]); }
    if (labels) {
      ctx.textAlign = 'center'; const lw = Math.max(...labels.map((x) => ctx.measureText(x || '').width), 10); const per = (w - L - R) / Math.max(1, n - 1);
      const k = Math.max(1, Math.ceil((lw + 18) / per)); const half = lw / 2 + 2;
      let prev = null; for (let i = n - 1; i >= 0; i -= k) { const t = labels[i] ?? ''; if (t === prev) continue; prev = t; ctx.fillText(t, Math.min(Math.max(X(i), L + half), w - R - half), h - 4); }
    }
    series.forEach((s, si) => {
      ctx.beginPath(); s.values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.strokeStyle = s.color; ctx.lineWidth = si === 0 ? 2 : 1.6; ctx.lineJoin = 'round'; ctx.stroke();
      if (s.fill) { ctx.lineTo(X(s.values.length - 1), h - B); ctx.lineTo(X(0), h - B); ctx.closePath(); const g = ctx.createLinearGradient(0, T, 0, h - B); g.addColorStop(0, s.color + '33'); g.addColorStop(1, s.color + '00'); ctx.fillStyle = g; ctx.fill(); }
    });
    const idx = hover >= 0 ? hover : -1;
    if (idx >= 0) { ctx.strokeStyle = P.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(idx), T); ctx.lineTo(X(idx), h - B); ctx.stroke(); ctx.setLineDash([]); let x = L + 4; ctx.textAlign = 'left'; ctx.font = '11px IBM Plex Sans, system-ui, sans-serif'; for (const s of series) { if (s.values[idx] === undefined) continue; const t = `${s.name} ${fmt(s.values[idx])}`; ctx.fillStyle = s.color; ctx.fillText('● ' + t, x, 12); x += ctx.measureText('● ' + t).width + 14; } if (labels) { ctx.fillStyle = P.muted; ctx.fillText(labels[idx] || '', x, 12); } }
  }
  const move = (e) => { const r = canvas.getBoundingClientRect(); const n = Math.max(...series.map((s) => s.values.length)); const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; hover = Math.max(0, Math.min(n - 1, Math.round(((x - 6) / (r.width - 58)) * (n - 1)))); paint(); };
  canvas.onmousemove = move; canvas.ontouchmove = move; canvas.onmouseleave = () => { hover = -1; paint(); }; canvas.ontouchend = canvas.onmouseleave;
  paint();
}
export function spark(canvas, values, color) {
  const { ctx, w, h } = fit(canvas); ctx.clearRect(0, 0, w, h); const lo = Math.min(...values), hi = Math.max(...values); const X = (i) => 1 + (i / (values.length - 1)) * (w - 2), Y = (v) => 2 + (h - 4) * (1 - (v - lo) / (hi - lo || 1));
  ctx.beginPath(); values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
}
