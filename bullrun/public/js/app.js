// Application controller: boot, routing, time control, order flow and event delegation.
import { S, co, save, chName, chColor } from './state.js';
import { api, req, auth } from './api.js';
import { $, toast, debounce, uid, inr, inr0, num, tickLabel, dayOf } from './util.js';
import * as V from './views.js';
import { drawPrice, drawLines } from './charts.js';
import { setCustomAnchors, setAnchorLook, stopSpeaking } from './anchors.js';
import { liveHooks, liveReset, liveSync, liveSkip, livePause, liveReplay, liveBackToLive, liveRestartSpeech, liveNeedsAir } from './live.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shell = false, tapeSig = '', lastRoute = null, lastPreviewTick = -1, loopRunning = false, previewSeq = 0;

// ---------- view merging: candles and index points are incremental, everything else is replaced ----------
function applyView(nv) {
  const old = S.view;
  if (old && old.id === nv.id) {
    for (const c of nv.companies) {
      const o = old.companies.find((x) => x.id === c.id); if (!o) continue;
      const first = c.candles.length ? c.candles[0].t : Infinity;
      c.candles = o.candles.filter((k) => k.t < first).concat(c.candles);
    }
    const f = nv.index.hist.length ? nv.index.hist[0].t : Infinity;
    nv.index.hist = old.index.hist.filter((h) => h.t < f).concat(nv.index.hist);
  }
  S.view = nv; liveSync();
}
const routeFromHash = () => { const h = location.hash.replace(/^#\/?/, '').split('?')[0]; return V.ROUTES.includes(h) ? h : 'home'; };
function go(r) { if (location.hash === '#/' + r) { S.route = r; render(); } else location.hash = '#/' + r; }
window.addEventListener('hashchange', () => { S.route = routeFromHash(); if (S.view) render(); });

// ---------- rendering ----------
function focusSnap() { const a = document.activeElement; return a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null; }
function focusRestore(f) { if (!f) return; const el = document.getElementById(f.id); if (!el) return; el.focus(); try { el.setSelectionRange(f.s, f.e); } catch (_) { /* number inputs */ } }
function mountShell() {
  $('#app').innerHTML = `<a class="skip" href="#page">Skip to main content</a><div class="shell"><nav class="rail" id="rail" aria-label="Main"></nav><div class="main"><header class="top"><div class="clockbar" id="clockbar"></div><div class="tape" id="tape" aria-label="Live headlines"></div></header><main class="page" id="page" tabindex="-1"></main></div></div><div id="overlay"></div><div id="coach"></div>`;
  shell = true; tapeSig = '';
}
const PAGES = { home: V.home, terminal: V.terminal, news: V.news, portfolio: V.portfolio, companies: V.companies, learn: V.learn, history: V.history, ipo: V.ipo, truth: V.truth, board: V.board, report: V.report };
function render() {
  const f = focusSnap();
  if (!S.view && S.landing && !S.loadingMsg) { shell = false; stopSpeaking(); $('#app').innerHTML = V.landing(); document.title = 'BullRun · Learn the market by running one'; startLandingLoop(); observeReveal(); return; }
  stopLandingLoop();
  if (!S.view || S.starting) { shell = false; $('#app').innerHTML = V.startScreen(); document.title = 'Start a game · BullRun'; focusRestore(f); return; }
  if (!shell) mountShell();
  if (S.route === 'news') { S.seenNews[S.view.id] = S.view.newsTotal; save('seenNews', S.seenNews); }
  $('#rail').innerHTML = V.railHtml(); $('#clockbar').innerHTML = V.clockHtml();
  const sig = V.tapeSig(); if (sig !== tapeSig) { $('#tape').innerHTML = V.tapeHtml(); tapeSig = sig; }
  const page = $('#page'); const scroll = window.scrollY; page.innerHTML = PAGES[S.route]();
  $('#overlay').innerHTML = V.modalHtml(); $('#coach').innerHTML = V.coachHtml();
  if (lastRoute !== S.route) {
    window.scrollTo(0, 0); const first = lastRoute === null; lastRoute = S.route;
    document.title = `${V.routeLabel(S.route)} · BullRun`; if (!first) page.focus({ preventScroll: true }); enterPage(page);
  } else window.scrollTo(0, scroll);
  focusRestore(f); drawCharts(); flashPrices(); tweenCounts(); if (S.route === 'truth') ensureTruth(); queueNotices();
  if (S.route === 'terminal' && S.view.tick !== lastPreviewTick) { lastPreviewTick = S.view.tick; if (S.preview || Number(S.ticket.qty) >= 1) runPreview(); }
}
let landTimer = null, landIdx = 0;
function stopLandingLoop() { clearInterval(landTimer); landTimer = null; }
function startLandingLoop() {
  stopLandingLoop(); if (reduced()) return;
  landTimer = setInterval(() => { const el = $('#landstage'); if (!el) return stopLandingLoop(); landIdx = (landIdx + 1) % V.LAND_SCENES.length; el.dataset.ch = V.LAND_SCENES[landIdx].ch; el.innerHTML = V.landStageInner(landIdx); }, 7000);
}
function observeReveal() {
  const els = document.querySelectorAll('.reveal'); if (!('IntersectionObserver' in window) || reduced()) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }); els.forEach((e) => io.observe(e));
}
// Truth Mode data is refetched whenever the reveal point can have moved: a new day, the close, or the end of the session.
async function ensureTruth() {
  const v = S.view; if (!v) return; const key = `${v.id}:${v.day}:${v.phase}:${v.status}`; if (S.truthKey === key || S.truthBusy) return;
  S.truthBusy = true;
  try { const r = await api.truth(v.id); S.truth = r.truth; S.truthKey = key; if (S.truthStory && !r.truth.stories.some((x) => x.seq === S.truthStory)) S.truthStory = null; }
  catch (e) { S.truth = null; handleErr(e); } finally { S.truthBusy = false; if (S.route === 'truth') render(); }
}
// ---------- achievement-style popups (IPO opens, allotment result, listing) ----------
// They come from the server as per-player notices, so they appear on whatever page you are on. Seen notices are remembered per game.
let achvCur = null, achvTimer = null, actx = null; const achvQ = [];
const seenKey = () => 'bullrun.notices.' + S.view.id;
function queueNotices() {
  const v = S.view; if (!v || !v.notices) return;
  if (S.noticeSession !== v.id) { S.noticeSession = v.id; let raw = null; try { raw = localStorage.getItem(seenKey()); } catch (_) { /* private mode */ } S.seenN = new Set(raw ? JSON.parse(raw) : v.notices.map((n) => n.id)); }
  let added = false; for (const n of v.notices) if (!S.seenN.has(n.id)) { S.seenN.add(n.id); achvQ.push(n); added = true; }
  if (added || !localStorage.getItem(seenKey())) { try { localStorage.setItem(seenKey(), JSON.stringify([...S.seenN])); } catch (_) { /* private mode */ } }
  if (added) pumpAchv();
}
function toAchv(n) {
  const v = S.view; const i = (v.ipos || []).find((x) => x.id === n.ipoId); if (!i) return null; const rs = (x) => '\u20B9' + Math.round(x).toLocaleString('en-IN');
  if (n.type === 'ipo_open') return { tone: 'open', kicker: 'IPO ALERT', title: 'New IPO', sub: `${i.name} opens for bidding at ${rs(i.issuePrice)} a share`, ipoId: i.id };
  if (n.type === 'ipo_result') return n.won
    ? { tone: 'win', kicker: 'ALLOTMENT RESULT', title: 'Congratulations! You got the IPO', sub: `${n.shares} shares of ${i.name} at ${rs(i.issuePrice)}. ${n.refund > 0 ? rs(n.refund) + ' comes back at listing.' : ''}`, ipoId: i.id, confetti: true }
    : { tone: 'lose', kicker: 'ALLOTMENT RESULT', title: "Sorry, you didn't get the IPO", sub: `${i.name} was oversubscribed ${i.sub.toFixed(1)} times. Your ${rs(n.refund)} comes back when it lists.`, ipoId: i.id };
  if (n.type === 'ipo_listed') { const mine = i.you && i.you.shares > 0; const gain = (n.gain * 100).toFixed(1); const up = n.gain >= 0;
    return { tone: up ? 'win' : 'lose', kicker: 'NOW TRADING', title: `${i.name} is now listed`, sub: `${up ? '+' : ''}${gain}% on debut at ${rs(n.price)}.${mine ? ` Your ${i.you.shares} shares ${up ? 'are up' : 'are down'} ${rs(Math.abs(i.you.shares * (n.price - i.issuePrice)))}.` : i.you ? ' Your refund has arrived.' : ''}`, ipoId: i.id, confetti: up && mine }; }
  return null;
}
function chime(tone) {
  if (!S.studio.sound) return;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const t0 = actx.currentTime; const notes = tone === 'win' ? [523.25, 659.25, 783.99, 1046.5] : tone === 'lose' ? [392, 329.63] : [659.25, 880];
    notes.forEach((f, k) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f; const at = t0 + k * 0.11; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.15, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5); o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + 0.55); }); } catch (_) { /* audio blocked */ }
}
function pumpAchv() {
  if (achvCur) return; const n = achvQ.shift(); const box = $('#achv'); if (!n || !box) return; const a = toAchv(n); if (!a) return pumpAchv();
  achvCur = a; box.innerHTML = V.achvHtml(a); chime(a.tone); clearTimeout(achvTimer); achvTimer = setTimeout(closeAchv, 14000);
}
function closeAchv() { const box = $('#achv'); const w = box && box.firstElementChild; clearTimeout(achvTimer); if (!w) { achvCur = null; return; } w.classList.add('out'); setTimeout(() => { box.innerHTML = ''; achvCur = null; pumpAchv(); }, 320); }
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function enterPage(page) {
  if (reduced()) return; Array.from(page.children).slice(0, 12).forEach((el, i) => el.style.setProperty('--i', i));
  page.classList.remove('enter'); void page.offsetWidth; page.classList.add('enter'); clearTimeout(enterPage.t); enterPage.t = setTimeout(() => page.classList.remove('enter'), 900);
}
const lastPx = {}, lastCount = {};
function flashPrices() {
  if (!reduced()) document.querySelectorAll('[data-px]').forEach((el) => { const p = lastPx[el.dataset.px], v = Number(el.dataset.v); if (p !== undefined && v !== p) el.classList.add(v > p ? 'fl-up' : 'fl-down'); });
  S.view.companies.forEach((c) => { lastPx[c.id] = c.price; });
}
function tweenCounts() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const k = el.dataset.count, to = Number(el.dataset.v), from = lastCount[k]; lastCount[k] = to; if (from === undefined || from === to || reduced()) return;
    const t0 = performance.now(), d = 650; const f = (t) => { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = inr0(from + (to - from) * e); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f);
  });
}
function paintTicket() { const el = $('#ticket'); if (!el) return; const f = focusSnap(); el.innerHTML = V.ticketHtml(); focusRestore(f); }
function paintOverlay() { $('#overlay').innerHTML = V.modalHtml(); $('#coach').innerHTML = V.coachHtml(); }
function drawCharts() {
  const v = S.view; const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  if (S.route === 'home') {
    const cv = $('#idxchart'); if (!cv) return; const h = v.index.hist.slice(-84);
    drawLines(cv, { series: [{ name: 'Index', color: h[h.length - 1].v >= h[0].v ? css('--up') : css('--down'), values: h.map((x) => x.v), fill: true }], labels: h.map((x) => tickLabel(x.t)), fmt: (x) => num(x) });
  }
  if (S.route === 'terminal') {
    const cv = $('#pricechart'); if (!cv) return; const c = co(S.selected); const ch = S.chart; const hold = v.portfolio.holdings.find((x) => x.companyId === c.id);
    const markers = v.news.filter((n) => n.tags.companies.includes(c.id) && n.treatment !== 'background' && n.tick > 0).map((n) => ({ t: n.tick, color: chColor(n.channel), label: `${chName(n.channel)}: ${n.headline}` }));
    drawPrice(cv, { candles: c.candles, type: ch.type, range: ch.range, ind: ch.ind, costLine: hold ? hold.avgCost : null, markers });
  }
  if (S.route === 'board' && (v.room || v.rivals)) {
    const cv = $('#boardchart'); if (!cv) return; const b = (v.room || { board: v.rivals }).board; const PAL = ['#2fd28f', '#4da3ff', '#ffb020', '#b07cff', '#ff7ab6', '#38d9d9', '#ff9f5a', '#c7d36f'];
    const rows = b.rows.slice().sort((x, y) => (y.you ? 1 : 0) - (x.you ? 1 : 0));
    const series = rows.map((r, i) => ({ name: r.you ? r.name + ' (you)' : r.name, color: PAL[i % PAL.length], values: r.curve.map((x) => (x === null ? 100 : x)) }));
    series.push({ name: 'Market', color: '#8793ad', values: b.market.map((x) => (x === null ? 100 : x)) });
    drawLines(cv, { series, labels: b.curveT.map((t) => (t <= 0 ? 'Start' : 'Day ' + dayOf(t))), fmt: (x) => x.toFixed(1), base: 100 });
  }
  if (S.route === 'portfolio' || S.route === 'report') {
    const cv = $('#eqchart'); if (!cv) return; const e = v.equity; if (e.length < 2) { cv.outerHTML = '<div class="empty"><b>Nothing to chart yet</b>Press Play and your results appear here.</div>'; return; }
    const i0 = e[0].idx; drawLines(cv, { series: [{ name: 'You', color: css('--signal'), values: e.map((x) => (x.nw / v.portfolio.startCash) * 100), fill: true }, { name: 'Market', color: '#8793ad', values: e.map((x) => (x.idx / i0) * 100) }], labels: e.map((x) => (x.t <= 0 ? 'Start' : 'Day ' + dayOf(x.t))), fmt: (x) => x.toFixed(1), base: 100 });
  }
}
window.addEventListener('resize', debounce(() => { if (S.view && !S.starting) drawCharts(); }, 150));

// ---------- time ----------
async function advanceOne() {
  const v = S.view; const held = new Set(v.portfolio.holdings.map((h) => h.companyId)); const txBefore = v.transactions.length, newsBefore = v.newsTotal;
  const r = await api.advance(v.id, 1, v.tick, false); applyView(r.view); const nv = S.view; let pause = false;
  const newTx = nv.transactions.slice(0, nv.transactions.length - txBefore);
  if (newTx.length) { const t = newTx[0]; S.alert = { kind: 'fill', title: `${t.orderType === 'stop' ? 'Stop-loss' : 'Limit order'} filled`, text: `${t.side === 'buy' ? 'Bought' : 'Sold'} ${num(t.qty)} ${t.ticker} at ${inr(t.price)}. Fees ${inr(t.fee)}.`, go: 'portfolio', goLabel: 'View portfolio' }; pause = true; }
  nv.portfolio.holdings.forEach((h) => held.add(h.companyId));
  const hit = nv.news.filter((n) => n.seq > newsBefore).find((n) => n.breaking && n.tags.companies.some((id) => held.has(id)));
  if (hit && !pause) { S.alert = { kind: 'news', title: `Breaking on ${chName(hit.channel)}`, text: hit.headline, go: 'news', goLabel: 'Read it' }; pause = true; }
  return { pause };
}
async function step(n) {
  if (S.view && S.view.room) return;
  if (S.busy || !S.view || S.view.status !== 'active') return;
  S.busy = true; S.alert = null; const before = S.view.phase;
  try {
    for (let i = 0; i < n; i++) {
      const r = await advanceOne(); if (n > 1 && i < n - 1) { render(); await sleep(110); }
      if (r.pause) { S.playing = false; break; } if (S.view.status !== 'active') break;
      if (S.view.phase === 'closed' || (before === 'preopen' && S.view.phase === 'open')) break; // stop at the open so you can trade, and at the close
    }
    if (S.view.phase === 'closed') { S.playing = false; toast(`The market closed at ${S.view.hours.close}. Review your portfolio, then press Next day.`, 'info', 7000); }
    else if (before === 'preopen' && S.view.phase === 'open') { S.playing = false; toast(`The market is open (${S.view.hours.open}). You can buy and sell now. Press Play to run the day.`, 'ok', 6500); }
  } catch (e) { S.playing = false; handleErr(e); } finally { S.busy = false; render(); if (S.view && S.view.status === 'complete') { S.playing = false; toast('The session has finished. Your report is ready.', 'ok'); go('report'); } }
}
// News comes first: the market clock waits (up to 10 s) until the latest published story has been read out on air.
async function waitForNews() { const t0 = Date.now(); while (S.playing && S.view && Date.now() - t0 < 10000 && liveNeedsAir()) await sleep(250); }
async function nextDay() {
  if (S.busy || !S.view || S.view.room || S.view.phase !== 'closed') return;
  S.busy = true; S.playing = false; S.alert = null; render();
  try { const r = await api.nextDay(S.view.id, S.view.tick); applyView(r.view); toast(`Day ${S.view.day}, ${S.view.clock}. The market opens in one hour (${S.view.hours.open}). Read the news, then press Play.`, 'info', 7000); }
  catch (e) { handleErr(e); } finally { S.busy = false; render(); }
}
async function runLoop() {
  if (loopRunning) return; loopRunning = true;
  try {
    while (S.playing && S.view && S.view.status === 'active' && S.view.phase !== 'closed') {
      while (S.modal && S.modal.type === 'confirm' && S.playing) await sleep(300);
      if (!S.playing) break; if (S.studio.sync) await waitForNews(); if (!S.playing) break; await step(1); if (!S.playing) break; await sleep({ 1: 2600, 2: 1300, 4: 550 }[S.speed] || 2600);
    }
  } finally { loopRunning = false; render(); }
}
function setPlaying(on) {
  if (S.view && S.view.room) return; if (on && S.view && S.view.phase === 'closed') { toast('The market is closed for today. Press Next day first.', 'info'); return; } S.playing = on; S.alert = on ? null : S.alert; render(); if (on) runLoop(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNow(); if (document.hidden && S.playing) { S.playing = false; if (S.view) render(); } });
function handleErr(e) {
  if (e.kind === 'auth') { S.user = null; S.view = null; S.starting = false; render(); return; }
  toast(e.message || 'Something went wrong. Your game is safe.', 'err', 6000);
}

// ---------- rooms: shared clock polling ----------
let polling = false;
function ingest(nv) {
  const old = S.view; const prevStatus = old && old.room ? old.room.status : null;
  const held = new Set(old ? old.portfolio.holdings.map((h) => h.companyId) : []); const txBefore = old ? old.transactions.length : 0, newsBefore = old ? old.newsTotal : 0;
  applyView(nv); const v = S.view;
  if (v.transactions.length > txBefore && txBefore >= 0 && old) { const t = v.transactions[0]; if (t && (t.orderType === 'limit' || t.orderType === 'stop')) S.alert = { kind: 'fill', title: `${t.orderType === 'stop' ? 'Stop-loss' : 'Limit order'} filled`, text: `${t.side === 'buy' ? 'Bought' : 'Sold'} ${num(t.qty)} ${t.ticker} at ${inr(t.price)}. Fees ${inr(t.fee)}.`, go: 'portfolio', goLabel: 'View portfolio' }; }
  v.portfolio.holdings.forEach((h) => held.add(h.companyId));
  const hit = v.news.filter((n) => n.seq > newsBefore).find((n) => n.breaking && n.tags.companies.some((id) => held.has(id)));
  if (hit && !S.alert) S.alert = { kind: 'news', title: `Breaking on ${chName(hit.channel)}`, text: hit.headline, go: 'news', goLabel: 'Read it' };
  if (prevStatus === 'lobby' && v.room && v.room.status === 'running') toast('The market is open. Good luck!', 'ok');
  if (v.status === 'complete' && !S.doneNotified[v.id]) { S.doneNotified[v.id] = true; toast('The session has finished. Your report is ready.', 'ok'); go('report'); refreshSessions(); }
}
async function pollNow() {
  const v = S.view; if (!v || !v.room || polling || S.starting || document.hidden || v.status === 'complete') return;
  polling = true;
  try { const r = await api.poll(v.id, v.tick, v.rev); S.offline = 0; if (!r.unchanged) { const f = focusSnap(); ingest(r.view); if (!S.busy) render(); focusRestore(f); } else if (S.offline === 0 && false) render(); }
  catch (e) { if (e.kind === 'auth') return handleErr(e); S.offline++; if (S.offline === 2) render(); }
  finally { polling = false; }
}
setInterval(pollNow, 1200);

// ---------- BullRun Live (24/7 newsroom) ----------
let tickSig = '';
function paintLive() {
  const mini = $('#onair'); if (mini) mini.innerHTML = V.onAirMini();
  if (S.route !== 'news') return; const el = $('#live'); if (!el) return;
  const rail = $('#lrail'); const top = rail ? rail.scrollTop : 0; el.innerHTML = V.liveHtml(); const r2 = $('#lrail'); if (r2) r2.scrollTop = top;
}
liveHooks({
  paint: paintLive,
  caption: (text, frac) => {
    if (S.route !== 'news') return; const p = document.getElementById('prompter'); if (p) p.textContent = text;
    const b = document.getElementById('lprogi'); if (b) { b.style.transform = `scaleX(${frac})`; if (b.parentElement) b.parentElement.setAttribute('aria-valuenow', Math.round(frac * 100)); }
  },
});

// ---------- orders ----------
const orderBody = () => { const t = S.ticket; return { companyId: S.selected, side: t.side, type: t.type, qty: Number(t.qty), limit: t.type === 'limit' ? Number(t.limit) : undefined, stop: t.type === 'stop' ? Number(t.stop) : undefined }; };
const runPreview = debounce(async () => {
  if (!S.view || S.route !== 'terminal') return; const t = S.ticket; const seq = ++previewSeq;
  if (S.view.status !== 'active') return;
  if (S.view.phase !== 'open') { S.preview = null; S.previewErr = null; return paintTicket(); }
  if (!(Number(t.qty) >= 1)) { S.preview = null; S.previewErr = null; return paintTicket(); }
  if (t.type === 'limit' && !(Number(t.limit) > 0)) { S.preview = null; S.previewErr = 'Enter the price you are willing to trade at.'; return paintTicket(); }
  if (t.type === 'stop' && !(Number(t.stop) > 0)) { S.preview = null; S.previewErr = 'Enter the price at which you want to sell automatically.'; return paintTicket(); }
  try { const r = await api.preview(S.view.id, orderBody()); if (seq !== previewSeq) return; S.preview = r.preview.ok ? r.preview : null; S.previewErr = r.preview.ok ? null : r.preview.error; } catch (e) { if (seq !== previewSeq) return; S.preview = null; S.previewErr = e.message; }
  paintTicket();
}, 250);
async function placeOrder() {
  let started = false; const firstTrade = S.view.transactions.length === 0; const t = S.ticket; if (!t.key) t.key = uid(); S.busy = true; paintTicket();
  try {
    const r = await api.order(S.view.id, { ...orderBody(), key: t.key }, S.view.tick); applyView(r.view);
    if (r.duplicate) toast('That order was already placed.', 'info');
    else if (r.tx) { toast(`${r.tx.side === 'buy' ? 'Bought' : 'Sold'} ${num(r.tx.qty)} ${r.tx.ticker} at ${inr(r.tx.price)}. Fees ${inr(r.tx.fee)}.`, 'ok'); S.lastTrade = r.review ? { summary: r.review.summary, flags: r.review.flags } : null; }
    else { toast(`${r.order.type === 'stop' ? 'Stop-loss' : 'Limit order'} placed for ${num(r.order.qty)} ${r.order.ticker}. It fills only if the price gets there.`, 'ok'); S.lastTrade = null; }
    S.ticket.qty = ''; S.ticket.limit = ''; S.ticket.stop = ''; t.key = null; S.preview = null; S.previewErr = null; S.modal = null; started = !r.duplicate && !S.view.room && firstTrade && S.view.status === 'active' && S.view.phase === 'open';
  } catch (e) { handleErr(e); runPreview(); } finally { S.busy = false; render(); }
  if (started) { toast('Your first trade is in, so the market clock is running. Press Pause any time.', 'info', 5200); setPlaying(true); }
}
function maxQty() {
  const c = co(S.selected), pf = S.view.portfolio;
  if (S.ticket.side === 'sell') { const h = pf.holdings.find((x) => x.companyId === c.id); return h ? h.qty - h.reserved : 0; }
  const px = S.ticket.type === 'limit' && Number(S.ticket.limit) > 0 ? Number(S.ticket.limit) : c.ask * 1.02; return Math.max(0, Math.floor((pf.available * 0.985) / (px * 1.0015)));
}

// ---------- session lifecycle ----------
function adoptView(view) {
  S.view = view; S.selected = view.companies[0].id; S.ticket = { side: 'buy', type: 'market', qty: '', limit: '', stop: '', key: null }; S.preview = null; S.previewErr = null; S.lastTrade = null; S.alert = null; S.playing = false; S.explain = {}; S.modal = null; S.newsCompany = ''; S.newsChannel = 'all'; S.newsLimit = 40;
  stopSpeaking(); S.offline = 0; S.starting = false; S.loadingMsg = null; lastPreviewTick = -1; shell = false; localStorage.setItem('bullrun.last', view.id); try { sessionStorage.setItem('bullrun.tab', '1'); } catch (_) { /* private mode */ } liveReset(); S.truth = null; S.truthKey = ''; S.truthStory = null; S.truthCo = null;
  if (S.tour === null) S.tourStep = 0;
}
async function refreshSessions() { try { S.sessions = (await api.sessions()).sessions; } catch (_) { /* keep old */ } }
async function loadGame(id, report) {
  S.loadingMsg = 'Loading your game'; render();
  try { const r = await api.get(id); adoptView(r.view); S.route = report || r.view.status === 'complete' ? 'report' : routeFromHash(); location.hash = '#/' + S.route; await refreshSessions(); } catch (e) { S.loadingMsg = null; S.netError = e.message; localStorage.removeItem('bullrun.last'); } render();
}
async function startNew() {
  if (!S.user) {
    const name = (S.startName || '').trim(); if (!/^[\w .'-]{2,24}$/.test(name)) return toast('Enter a name of 2 to 24 letters or numbers.', 'warn');
    try { const r = await api.login(name); auth.set(r.token); S.user = r.user; } catch (e) { S.netError = e.message; return render(); }
  }
  S.loadingMsg = 'Building your market'; S.netError = null; render();
  try { const r = await api.create(S.startDur || 'standard', (S.startSeed || '').trim(), S.startBots); adoptView(r.view); S.route = 'home'; location.hash = '#/home'; await refreshSessions(); } catch (e) { S.loadingMsg = null; S.netError = e.message; }
  render();
}
async function ensureUser() {
  if (S.user) return true;
  const name = (S.startName || '').trim(); if (!/^[\w .'-]{2,24}$/.test(name)) { toast('Enter a name of 2 to 24 letters or numbers.', 'warn'); return false; }
  try { const r = await api.login(name); auth.set(r.token); S.user = r.user; return true; } catch (e) { S.netError = e.message; render(); return false; }
}
async function enterRoom(call) {
  if (!(await ensureUser())) return;
  S.loadingMsg = 'Opening the room'; S.netError = null; render();
  try { const r = await call(); adoptView(r.view); S.route = 'home'; history.replaceState(null, '', location.pathname + '#/home'); await refreshSessions(); }
  catch (e) { S.loadingMsg = null; S.netError = e.message; }
  render();
}
async function boot() {
  S.route = routeFromHash();
  const inv = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); if (inv) S.startCode = inv;
  try { S.health = await api.health(); setCustomAnchors(S.health.anchors || {}); setAnchorLook(S.studio.look === 'photo'); } catch (e) { S.netError = e.message; }
  let sameTab = false; try { sameTab = sessionStorage.getItem('bullrun.tab') === '1'; } catch (_) { /* private mode */ }
  S.landing = !inv && !sameTab; if (inv) S.startMode = 'join'; // a refresh in the middle of a game resumes it; a fresh visit starts on the landing page
  if (auth.token && !inv) {
    try { S.user = (await req('/api/me')).user; await refreshSessions(); const last = localStorage.getItem('bullrun.last'); const found = S.sessions.find((s) => s.id === last);
      if (found && sameTab) return loadGame(found.id, false); } catch (e) { if (e.kind !== 'auth') S.netError = e.message; }
  }
  if (inv && auth.token) { try { S.user = (await req('/api/me')).user; } catch (_) { /* sign in below */ } }
  render();
}

// ---------- events ----------
const A = {
  nav: (t) => { if (t.dataset.ch) S.newsChannel = t.dataset.ch; S.modal = null; if (t.dataset.to === 'history') refreshSessions().then(() => S.route === 'history' && render()); go(t.dataset.to); },
  nextday: () => nextDay(), step: (t) => step(Number(t.dataset.n)), play: () => setPlaying(!S.playing),
  speed: (t) => { S.speed = Number(t.dataset.n); save('speed', S.speed); render(); },
  dismiss: () => { S.alert = null; render(); },
  select: (t) => { S.selected = t.dataset.id; S.ticket.qty = ''; S.ticket.limit = ''; S.ticket.stop = ''; S.ticket.key = null; S.preview = null; S.previewErr = null; S.lastTrade = null; render(); },
  trade: (t) => { S.selected = t.dataset.id; S.modal = null; S.preview = null; S.previewErr = null; S.ticket.qty = ''; go('terminal'); },
  openco: (t) => { S.modal = { type: 'company', id: t.dataset.id }; paintOverlay(); },
  closemodal: () => { S.modal = null; paintOverlay(); }, backdrop: () => A.closemodal(),
  side: (t) => { S.ticket.side = t.dataset.v; if (S.ticket.side === 'buy' && S.ticket.type === 'stop') S.ticket.type = 'market'; S.ticket.key = null; paintTicket(); runPreview(); },
  qty: (t) => { S.ticket.qty = t.dataset.n === 'max' ? String(maxQty()) : t.dataset.n; S.ticket.key = null; paintTicket(); runPreview(); },
  submit: () => { const pv = S.preview; if (!pv || !pv.ok) return; if (pv.confirmRequired) { S.modal = { type: 'confirm', preview: pv }; paintOverlay(); } else placeOrder(); },
  confirm: () => placeOrder(),
  cancel: async (t) => { try { const r = await api.cancel(S.view.id, t.dataset.id, S.view.tick); applyView(r.view); toast('Order cancelled. Your cash or shares are free again.', 'ok'); } catch (e) { handleErr(e); } render(); },
  ind: (t) => { S.chart.ind[t.dataset.k] = !S.chart.ind[t.dataset.k]; save('cind', S.chart.ind); render(); },
  ctype: (t) => { S.chart.type = t.dataset.v; save('ctype', S.chart.type); render(); },
  crange: (t) => { S.chart.range = t.dataset.v === 'all' ? 'all' : Number(t.dataset.v); save('crange', S.chart.range); render(); },
  learnmode: (t) => { S.chart.learn = t.dataset.v === '1'; save('clearn', S.chart.learn); if (S.chart.learn) { S.chart.ind = { ...S.chart.ind, ma: false, bb: false, rsi: false, macd: false, sr: false, trend: false }; } render(); },
  guess: (t) => { S.chart.guess[t.dataset.key] = t.dataset.v; render(); },
  newsch: (t) => { S.newsChannel = t.dataset.v; S.newsLimit = 40; liveSkip(); render(); }, morenews: () => { S.newsLimit += 40; render(); },
  learntab: (t) => { S.learnTab = t.dataset.v; render(); },
  explain: async (t) => { const id = t.dataset.id; S.busy = true; render(); try { const r = await api.explain(S.view.id, id); S.explain[id] = { text: r.text, notice: r.notice, source: r.source }; } catch (e) { S.explain[id] = { text: 'Another explanation is not available right now. The one above still applies.' }; } S.busy = false; render(); },
  achvclose: () => closeAchv(),
  achvsee: (t) => { S.ipoSel = t.dataset.ipo; S.ipoLots = 0; closeAchv(); go('ipo'); },
  iposel: (t) => { S.ipoSel = t.dataset.id; S.ipoLots = 0; render(); },
  ipolots: (t) => { const i = (S.view.ipos || []).find((x) => x.id === S.ipoSel) || {}; S.ipoLots = Math.max(1, Math.min(10, (S.ipoLots || (i.you ? i.you.lots : 1)) + Number(t.dataset.d))); render(); },
  ipobid: async () => { const i = (S.view.ipos || []).find((x) => x.id === S.ipoSel) || (S.view.ipos || []).find((x) => x.status === 'open'); if (!i || S.busy) return; const lots = S.ipoLots || (i.you ? i.you.lots : 1);
    try { const r = await api.ipoBid(S.view.id, i.id, lots); applyView(r.view); S.ipoLots = 0; toast(`Bid placed: ${lots} lot${lots > 1 ? 's' : ''}, \u20B9${Math.round(r.result.amount).toLocaleString('en-IN')} blocked until the draw.`, 'ok', 5200); } catch (e) { handleErr(e); } render(); },
  ipocancel: async () => { const i = (S.view.ipos || []).find((x) => x.id === S.ipoSel); if (!i) return; try { const r = await api.ipoBid(S.view.id, i.id, 0); applyView(r.view); toast('Bid cancelled. Your money is back.', 'info'); } catch (e) { handleErr(e); } render(); },
  startbots: (t) => { if (t.dataset.m === 'room') S.startRoomBots = Number(t.dataset.v); else S.startBots = Number(t.dataset.v); render(); },
  truthpick: (t) => { S.truthStory = Number(t.dataset.seq); render(); const el = document.querySelector('.tstory'); if (el && window.innerWidth < 900) el.scrollIntoView({ block: 'nearest' }); },
  truthspoil: () => { S.truthConfirm = !S.truthConfirm; render(); },
  truthspoilyes: async () => { try { await api.spoil(S.view.id); S.truthConfirm = false; S.truthKey = ''; S.truth = null; render(); toast('Spoiler mode is on. Truth Mode now shows everything.', 'info'); } catch (e) { handleErr(e); } },
  truthmine: () => { S.truthMine = !S.truthMine; render(); }, truthbots: () => { S.truthBots = !S.truthBots; render(); }, truthmore: () => { S.truthLimit += 30; render(); },
  enter: (t) => { S.landing = false; if (t.dataset.m) S.startMode = t.dataset.m === 'friends' ? 'host' : 'solo'; window.scrollTo(0, 0); render(); const u = $('#uname'); if (u) u.focus({ preventScroll: true }); },
  landhome: () => { S.landing = true; render(); window.scrollTo(0, 0); },
  startmode: (t) => { S.startMode = t.dataset.v; render(); },
  scrollto: (t) => { const el = document.getElementById('land-' + t.dataset.to); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); },
  newgame: () => { S.starting = true; S.playing = false; S.netError = null; render(); }, cancelstart: () => { S.starting = false; render(); },
  loadgame: (t) => loadGame(t.dataset.id, t.dataset.done === 'true'),
  endgame: () => { S.modal = { type: 'end' }; paintOverlay(); },
  endconfirm: async () => { S.modal = null; S.playing = false; try { const r = S.view.room ? await api.control(S.view.id, 'end') : await api.finish(S.view.id, S.view.tick); ingest(r.view); await refreshSessions(); go('report'); } catch (e) { handleErr(e); } render(); },
  dur: (t) => { S.startDur = t.dataset.v; render(); }, start: () => startNew(),
  retry: async () => { S.netError = null; try { S.health = await api.health(); } catch (e) { S.netError = e.message; } render(); },
  logout: () => { auth.clear(); localStorage.removeItem('bullrun.last'); try { sessionStorage.removeItem('bullrun.tab'); } catch (_) { /* private mode */ } S.landing = true; S.user = null; S.view = null; S.sessions = []; S.starting = false; render(); },
  rctl: async (t) => { try { const r = await api.control(S.view.id, t.dataset.v); ingest(r.view); } catch (e) { handleErr(e); } render(); },
  rspeed: async (t) => { try { const r = await api.control(S.view.id, 'speed', t.dataset.v); ingest(r.view); } catch (e) { handleErr(e); } render(); },
  startspeed: (t) => { S.startSpeed = t.dataset.v; render(); },
  roomcreate: () => enterRoom(() => api.createRoom(S.startDur || 'standard', (S.startSeed || '').trim(), S.startSpeed, S.startRoomBots)),
  roomjoin: () => { const c = (S.startCode || '').trim().toUpperCase(); if (c.length < 4) return toast('Type the room code your friend shared.', 'warn'); enterRoom(() => api.joinRoom(c)); },
  copyinvite: async () => { const url = `${location.origin}/?room=${S.view.room.code}`; try { await navigator.clipboard.writeText(url); toast('Invite link copied. Send it to your friends.', 'ok'); } catch (_) { toast('Share this code: ' + S.view.room.code, 'info', 6000); } },
  boardtab: (t) => { S.boardTab = t.dataset.v; render(); },
  newssync: () => { S.studio.sync = !S.studio.sync; save('newssync', S.studio.sync); paintLive(); },
  look: () => { S.studio.look = S.studio.look === 'photo' ? 'art' : 'photo'; save('look', S.studio.look); setAnchorLook(S.studio.look === 'photo'); paintLive(); },
  livepause: () => livePause(), liveskip: () => liveSkip(), livelive: () => liveBackToLive(), livereplay: (t) => liveReplay(t.dataset.key),
  voice: () => { S.studio.voice = S.studio.voice === 'browser' ? 'ai' : 'browser'; save('voice', S.studio.voice); liveRestartSpeech(); paintLive(); },
  sound: () => { S.studio.sound = !S.studio.sound; save('sound', S.studio.sound); if (!S.studio.sound) stopSpeaking(); else liveRestartSpeech(); paintLive(); },
  tour: () => { S.tour = null; S.tourStep = 0; save('tour', null); paintOverlay(); },
  tourskip: () => { S.tour = 'skipped'; save('tour', 'skipped'); paintOverlay(); },
  tourback: () => { S.tourStep = Math.max(0, S.tourStep - 1); paintOverlay(); },
  tournext: () => { if (S.tourStep >= 4) { S.tour = 'done'; save('tour', 'done'); } else S.tourStep++; paintOverlay(); },
};
document.addEventListener('click', (e) => { const t = e.target.closest('[data-act]'); if (!t) return; if (t.dataset.act === 'backdrop' && e.target !== t) return; const fn = A[t.dataset.act]; if (fn) fn(t, e); });
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.in; if (!k) return; const v = e.target.value;
  if (['qty', 'limit', 'stop'].includes(k)) { S.ticket[k] = v; S.ticket.key = null; runPreview(); }
  else if (k === 'type') { S.ticket.type = v; S.ticket.key = null; paintTicket(); runPreview(); }
  else if (k === 'ncompany') { S.newsCompany = v; render(); }
  else if (k === 'truthco') { S.truthCo = v; S.truthStory = null; render(); }
  else if (k === 'code') S.startCode = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  else if (k === 'uname') S.startName = v; else if (k === 'seed') S.startSeed = v;
});
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.dataset && d.dataset.k) S.open[d.dataset.k] = d.open; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) A.closemodal();
  if (e.key === 'Enter' && e.target.dataset && ['qty', 'limit', 'stop'].includes(e.target.dataset.in)) { e.preventDefault(); A.submit(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g[data-act], tr[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (e.key === 'Enter' && e.target.id === 'uname') startNew();
  if (e.key === 'Enter' && e.target.id === 'codein') A.roomjoin();
});
boot();
