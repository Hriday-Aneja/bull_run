'use strict';
// Truth Mode: the hidden layer behind every price move. Real market simulators use live data, so they cannot tell you why a price moved.
// BullRun invents the market, so it knows: which stories were true, which were rumours, what each company was really worth, and when the
// real effect arrived. This module turns that into a view the player can study, WITHOUT leaking anything about the future:
//  - today's ticks stay locked until the market closes (and everything unlocks when the session ends);
//  - a story is revealed only when its event has fully played out (and any denial has aired);
//  - the "real value" and "believed value" lines are cut off where an unresolved event begins to influence a company.
const TPD = 7;
const CH = { flashwire: 'Flashwire', marketline: 'Marketline', undercurrent: 'The Undercurrent', dailypulse: 'Daily Pulse' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const r2 = (x) => Math.round(x * 100) / 100, rd = (x, d = 4) => { const k = 10 ** d; return Math.round(x * k) / k; };

function revealTick(state, api, spoiled) {
  if (state.status === 'complete' || spoiled) return state.tick;
  if (api.phaseOf(state) === 'closed') return state.tick;
  return Math.max(0, (api.dayOf(api.dayT(state)) - 1) * TPD);
}
function evEnd(state, ev) {
  let end = ev.tick + ev.lag + ev.dur + 1;
  for (const n of state.news) if (n.eventId === ev.id) end = Math.max(end, n.tick);
  for (const q of state.pubQueue) if (q.eventId === ev.id) end = Math.max(end, q.tick);
  return end;
}
const evCompanies = (ev) => [...new Set([...Object.keys(ev.impact || {}), ...Object.keys(ev.claim || {}), ...Object.keys(ev.belief || {})])];

function verdictOf(n, ev) {
  if (!ev || n.treatment === 'background') return { v: 'noise' };
  if (ev.hype) return { v: 'false' }; // the claim was a scam: there was nothing real behind the price rise
  if (ev.kind === 'rumor') return { v: n.treatment === 'denial' || n.treatment === 'retraction' ? 'correction' : 'false' };
  if (!ev.material) return { v: 'noise' };
  let best = null;
  for (const cid in n.claim || {}) { const i = (ev.impact || {})[cid]; if (i === undefined) continue; if (!best || Math.abs(i) > Math.abs(best.i)) best = { cid, i, c: n.claim[cid] }; }
  if (!best || !best.c) return { v: n.treatment === 'denial' ? 'correction' : 'noise' };
  const ratio = best.c / best.i; let v = 'true'; if (ratio < 0) v = 'wrong'; else if (ratio > 1.2) v = 'exaggerated';
  return { v, late: n.tick > ev.tick + ev.lag, early: n.tick < ev.tick, real: best.i, claimed: best.c, cid: best.cid };
}
const GOOD = new Set(['true']); const BAD = new Set(['false', 'wrong', 'exaggerated']);

function truthView(state, pid, api) {
  const spoiled = !!(state.players[pid] && state.players[pid].spoiled); const rt = revealTick(state, api, spoiled); const complete = state.status === 'complete' || spoiled;
  const out = { revealT: rt, day: rt > 0 ? api.dayOf(rt) : 0, complete, spoiled, canSpoil: false, empty: rt <= 0, closed: api.phaseOf(state) === 'closed', hours: null };
  if (rt <= 0) return out;
  // 1. which events are still playing out (their truth stays locked)
  const lockT = {}; const unresolved = new Set();
  for (const ev of state.events) {
    if (complete || evEnd(state, ev) <= rt) continue; unresolved.add(ev.id);
    const firstPub = Math.min(ev.tick, ...state.news.filter((n) => n.eventId === ev.id).map((n) => n.tick));
    for (const cid of evCompanies(ev)) lockT[cid] = Math.min(lockT[cid] === undefined ? 1e9 : lockT[cid], firstPub);
  }
  // 2. stories
  const stories = []; const byseq = {};
  for (const n of state.news) {
    if (n.tick > rt) continue; const ev = n.eventId ? api.evById(state, n.eventId) : null;
    const locked = !!(ev && unresolved.has(ev.id)); const v = locked ? null : verdictOf(n, ev);
    const cos = [...new Set([...(n.tags && n.tags.companies ? n.tags.companies : []), ...Object.keys(n.claim || {})])];
    const item = { seq: n.seq, tick: n.tick, minute: n.minute || 0, channel: n.channel, headline: n.headline, treatment: n.treatment, label: n.label, breaking: !!n.breaking, companies: cos, locked,
      claims: Object.keys(n.claim || {}).filter((c) => Math.abs(n.claim[c]) > 0.002).map((c) => ({ cid: c, pct: rd(n.claim[c]) })), kind: ev ? ev.kind : 'none', hype: !!(ev && ev.hype), exposed: !!(ev && ev.arc && ev.arc.stage === 2) };
    if (v) {
      item.verdict = v.v; item.late = !!v.late; item.early = !!v.early;
      if (ev && ev.kind !== 'rumor') item.real = Object.keys(ev.impact || {}).filter((c) => Math.abs(ev.impact[c]) > 0.002).map((c) => ({ cid: c, pct: rd(ev.impact[c]) }));
      if (ev) { item.effect = { start: ev.tick + ev.lag, full: ev.tick + ev.lag + ev.dur }; item.denied = !!ev.denied; }
      const cid = v.cid || item.claims[0] && item.claims[0].cid; const co = cid && api.co(state, cid);
      if (co) {
        const k0 = co.candles.find((k) => k.t === n.tick); const p0 = k0 ? k0.o : null; const at = (d) => { const k = co.candles.find((x) => x.t === n.tick + d); return k && p0 && n.tick + d <= rt ? rd(k.c / p0 - 1) : null; };
        if (p0) item.moves = { cid, m1: at(1), m3: at(3), m6: at(6) };
      }
    }
    stories.push(item); byseq[n.seq] = item;
  }
  // 3. price and value lines per company
  const companies = state.companies.map((c) => {
    const tr = {}; for (const x of c.truth || []) tr[x.t] = x; const lock = lockT[c.id]; const series = [];
    for (const k of c.candles) { if (k.t < 0 || k.t > rt) continue; const x = tr[k.t]; const open = !(lock !== undefined && k.t >= lock); series.push([k.t, k.c, open && x ? x.fv : null, open && x ? x.bv : null]); }
    return { id: c.id, ticker: c.ticker, name: c.name, lockedFrom: lock === undefined ? null : lock, series };
  });
  // 4. trades (yours and the bots'), each linked to the story that most plausibly caused it
  const linkStory = (tx) => { for (let i = stories.length - 1; i >= 0; i--) { const s = stories[i]; if (s.tick < tx.tick - 3) break; if (s.tick <= tx.tick && s.companies.includes(tx.companyId) && s.treatment !== 'background' && s.treatment !== 'denial' && s.treatment !== 'retraction') return s; } return null; };
  const shape = (p, tx) => { const s = tx.seq && byseq[tx.seq] ? byseq[tx.seq] : linkStory(tx); return { id: tx.id, t: tx.tick, cid: tx.companyId, ticker: tx.ticker, side: tx.side, qty: tx.qty, price: tx.price, note: tx.note || null, seq: s ? s.seq : null, verdict: s && !s.locked ? s.verdict : s ? 'locked' : null }; };
  const stat = (trades) => {
    const linked = trades.filter((t) => t.seq && t.verdict && t.verdict !== 'locked'); const by = {}; for (const t of linked) by[t.verdict] = (by[t.verdict] || 0) + 1;
    return { trades: trades.length, onNews: linked.length, good: linked.filter((t) => GOOD.has(t.verdict)).length, bad: linked.filter((t) => BAD.has(t.verdict) && t.side === 'buy').length, byVerdict: by };
  };
  const equityAt = (p) => { let e = p.equity[0]; for (const x of p.equity) { if (x.t <= rt) e = x; else break; } return e ? { nw: e.nw, ret: rd(e.nw / p.startCash - 1) } : { nw: p.startCash, ret: 0 }; };
  const me = state.players[pid]; const myTrades = me.transactions.filter((t) => t.tick <= rt).map((t) => shape(me, t));
  out.you = Object.assign({ name: me.name, trades: myTrades }, equityAt(me), { stats: stat(myTrades) });
  out.bots = Object.values(state.players).filter((p) => p.bot).map((p) => { const tr = p.transactions.filter((t) => t.tick <= rt).map((t) => shape(p, t)); return Object.assign({ pid: p.id, name: p.name, style: p.bot.style, trades: tr }, equityAt(p), { stats: stat(tr) }); });
  // 5. channel track record and plain-English lessons
  const ch = {}; for (const s of stories) { if (s.locked || !s.verdict || s.verdict === 'noise' || s.verdict === 'correction') continue; const c = (ch[s.channel] = ch[s.channel] || { reports: 0, right: 0, wrong: 0 }); c.reports++; if (GOOD.has(s.verdict)) c.right++; else if (BAD.has(s.verdict)) c.wrong++; }
  out.canSpoil = !state.room && !complete && stories.some((x) => x.locked) ; out.channels = ch; out.stories = stories; out.companies = companies; out.lockedStories = stories.filter((s) => s.locked).length;
  const lessons = []; const y = out.you.stats;
  if (y.onNews) lessons.push(`You traded within three hours of ${plural(y.onNews, 'story', 'stories')}. ${y.good} turned out true${y.bad ? ` and you bought after ${y.bad} that were false, exaggerated or wrong` : ''}.`);
  else lessons.push('You have not traded on a headline yet. That is a valid choice. Truth Mode shows what each story really did, so you can decide next time.');
  const worst = Object.entries(ch).filter(([, c]) => c.reports >= 2).sort((a, b) => a[1].right / a[1].reports - b[1].right / b[1].reports)[0];
  if (worst && worst[1].wrong) lessons.push(`${CH[worst[0]] || worst[0]} was right on ${worst[1].right} of ${plural(worst[1].reports, 'story', 'stories')} so far. Check it against another channel before you act.`);
  const fooled = out.bots.filter((b) => b.stats.bad > 0).sort((a, b) => b.stats.bad - a.stats.bad)[0];
  if (fooled) lessons.push(`${fooled.name} bought after ${plural(fooled.stats.bad, 'story', 'stories')} that were false or overstated.`);
  out.lessons = lessons;
  return out;
}
module.exports = { truthView };
