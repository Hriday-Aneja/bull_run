'use strict';
// The simulation engine is the single source of truth. Prices, orders, portfolios and news timing live here and never call any AI service.
const { RNG } = require('./rng');
const D = require('./data');
const { resolveEarnings, clamp, rd } = require('./events');
const L = require('./learn');
const { macroDisplay, makePlayer } = require('./generator');
const BOTS = require('./bots'); const TRUTH = require('./truth'); const IPO = require('./ipo');
const TPD = D.TPD;
const r2 = (x) => Math.round(x * 100) / 100;
const dayOf = (t) => Math.floor((t - 1) / TPD) + 1;
const slotOf = (t) => (((t - 1) % TPD) + TPD) % TPD;
// Indian equity hours (NSE/BSE): normal session 9:15 AM to 3:30 PM IST, pre-open from 9:00 AM. One simulated day is TPD ticks:
// tick 1 is the hour before the open (8:15 to 9:15, closed, overnight gap and pre-open news), ticks 2 to 7 are trading
// (the last one runs 2:15 to 3:30 PM). Orders are accepted only while the market is open.
const PRE_MIN = 8 * 60 + 15, OPEN_MIN = 9 * 60 + 15, CLOSE_MIN = 15 * 60 + 30;
const fmtMin = (m) => { const h = Math.floor(m / 60), mm = m % 60; const hh = h > 12 ? h - 12 : h; return `${hh}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const startMin = (t) => PRE_MIN + 60 * slotOf(t);                                         // when tick t begins
const endMin = (t) => (slotOf(t) === TPD - 1 ? CLOSE_MIN : PRE_MIN + 60 * (slotOf(t) + 1)); // when tick t ends
// Label for a moment inside tick t (used for news stamps and calendar events). View clock uses clockNow().
function clock(t, minute = 0) { if (t <= 0) return 'Pre-open'; return fmtMin(startMin(t) + minute); }
const clockNow = (t) => (t <= 0 ? fmtMin(PRE_MIN) : fmtMin(endMin(t)));
// 'preopen' (closed, before 9:15), 'open' (orders accepted), 'closed' (after 3:30 PM, until Next day) or 'done'.
// Tick used for 'today' calculations: after Next day it is the first tick of the new day, so today's change starts from zero.
const dayT = (state) => (state.status === 'active' && state.tick > 0 && state.tick % TPD === 0 && state.dayRolled ? state.tick + 1 : state.tick);
function phaseOf(state) {
  if (state.status !== 'active') return 'done'; const t = state.tick;
  if (t <= 0) return 'preopen';
  if (t % TPD === 0) return state.dayRolled ? 'preopen' : 'closed';
  return 'open';
}
const candleAt = (c, t) => c.candles[t - c.candles[0].t] || c.candles[c.candles.length - 1];
const evCache = new WeakMap();
function evById(state, id) {
  let m = evCache.get(state.events); if (!m) { m = new Map(state.events.map((e) => [e.id, e])); evCache.set(state.events, m); }
  return m.get(id);
}
const co = (state, id) => state.companies.find((c) => c.id === id);

// ---- Setup -----------------------------------------------------------------------------------------------------------
function start(state) {
  for (const c of state.companies) c.truth = [{ t: 0, fv: r2(c.fv), bv: r2(c.fv) }];
  state.idxBase = state.companies.reduce((s, c) => s + c.price * c.shares, 0);
  publishDue(state); publishPreOpen(state);
  recordEquity(state);
  return state;
}
function recordEquity(state, only) {
  const idx = state.index.hist[state.index.hist.length - 1].v;
  for (const p of only ? [only] : Object.values(state.players)) p.equity.push({ t: state.tick, nw: r2(L.netWorth(state, p)), idx });
}
// Rooms: a late joiner (only allowed before the market opens) starts with the same cash and an equity record at the current tick.
function addPlayer(state, pid, name, userId) {
  if (state.players[pid]) return state.players[pid];
  const p = makePlayer(pid, name, userId); state.players[pid] = p; recordEquity(state, p); return p;
}

// ---- News delivery ---------------------------------------------------------------------------------------------------
// Stories scheduled for the pre-open hour are published when that hour begins (8:15 AM), so players can read them before the open.
function publishPreOpen(state) {
  if (slotOf(state.tick + 1) !== 0) return;
  while (state.pubQueue.length && state.pubQueue[0].tick <= state.tick + 1) publish(state, state.pubQueue.shift());
}
// "Next day": move from the close to 8:15 AM the next morning, one hour before the open. No orders can be placed until 9:15.
function nextDay(state) {
  if (state.status !== 'active') return { ok: false, error: 'This session has finished.' };
  if (phaseOf(state) !== 'closed') return { ok: false, error: 'The trading day is still in progress.' };
  state.dayRolled = true; publishPreOpen(state); return { ok: true };
}
function publishDue(state) {
  while (state.pubQueue.length && state.pubQueue[0].tick <= state.tick) publish(state, state.pubQueue.shift());
}
function publish(state, pub) {
  const item = Object.assign({}, pub, { seq: state.news.length + 1, disputed: !!state.disputed[pub.id] });
  state.news.push(item);
  const ev = pub.eventId ? evById(state, pub.eventId) : null;
  if (ev && pub.weight > 0) {
    for (const cid in pub.claim) { const b = ev.belief[cid] || 0; ev.belief[cid] = b + (pub.claim[cid] - b) * pub.weight; }
    if (pub.confirms === 'yes') ev.confirmed = true;
    if (pub.confirms === 'no') ev.denied = true;
    if (pub.refutes) { const old = evById(state, pub.refutes); if (old) { old.denied = true; old.confirmed = false; } } // a scam exposure ends the belief the hype built
    const cl = Object.values(pub.claim); if (ev.kind === 'macro' && cl.length) state.mood = clamp(state.mood + (cl.reduce((a, b) => a + b, 0) / cl.length) * pub.weight * 6, -1, 1);
  }
  for (const id of pub.corrects || []) { state.disputed[id] = true; const it = state.news.find((n) => n.id === id); if (it) it.disputed = true; }
  if (pub.channel === 'flashwire' && pub.treatment === 'unverified' && pub.tags.companies.length === 1) L.unverifiedSituation(state, pub, co(state, pub.tags.companies[0]));
  if (ev && ev.arc && pub.tags.companies.length === 1 && ['flashwire', 'marketline'].includes(pub.channel)) L.arcSituation(state, pub, ev, co(state, pub.tags.companies[0]));
}
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function progressEvents(state, t) {
  const pending = new Set(state.pubQueue.map((p) => p.eventId));
  for (const ev of state.events) {
    if (ev.done) continue;
    const hasBelief = Object.keys(ev.belief).length > 0;
    if (ev.tick > t && !hasBelief) continue;
    if (ev.tick <= t) {
      if (ev.kind === 'earnings' && !ev.resolved) {
        const pubs = resolveEarnings(state, ev); ev.resolved = true;
        for (const p of pubs) p.tick = Math.max(p.tick, t);
        state.pubQueue.push(...pubs); state.pubQueue.sort((a, b) => a.tick - b.tick || a.minute - b.minute);
        L.earningsSituation(state, ev);
      }
      if (!ev.applied) { ev.applied = true; if (ev.macroDelta) state.macro[ev.macroDelta.f] = clamp(state.macro[ev.macroDelta.f] + ev.macroDelta.delta, -1, 1); }
      for (const cid in ev.impact) {
        const prog = smooth((t - (ev.tick + ev.lag)) / Math.max(1, ev.dur)); const target = ev.impact[cid] * prog; const prev = ev.realized[cid] || 0;
        if (target !== prev) { co(state, cid).fv *= Math.exp(target - prev); ev.realized[cid] = target; }
      }
    }
    const rate = ev.denied ? 0.15 : ev.confirmed ? 0.03 : 0.07; let gap = 0;
    for (const cid of new Set([...Object.keys(ev.belief), ...Object.keys(ev.impact)])) {
      const b = ev.belief[cid] || 0, r = ev.realized[cid] || 0; ev.belief[cid] = b + (r - b) * rate; gap = Math.max(gap, Math.abs(ev.belief[cid] - r));
    }
    if (t > ev.tick + ev.lag + ev.dur + 2 && !pending.has(ev.id) && gap < 5e-4) ev.done = true;
  }
}
function sentimentMap(state) {
  const s = {};
  for (const ev of state.events) {
    if (ev.done) continue;
    for (const cid of new Set([...Object.keys(ev.belief), ...Object.keys(ev.impact)])) s[cid] = (s[cid] || 0) + (ev.belief[cid] || 0) - (ev.realized[cid] || 0);
  }
  return s;
}

// ---- Prices ----------------------------------------------------------------------------------------------------------
function stepPrices(state, t, sent) {
  const rng = RNG.derive(state.seed, 'tick', t);
  const Zm = rng.normal(); const gap = slotOf(t) === 0; const marketVol = 0.004 * (gap ? 1.5 : 1) * (1 + Math.abs(state.mood) * 0.5);
  for (const c of state.companies) {
    if (c.listTick === t) continue; // an IPO company lists this tick at its listing price; normal trading starts next tick
    const logP = Math.log(c.price); const s = sent[c.id] || 0;
    c.fv *= Math.exp(c.hid.growth / 1750);
    (c.truth = c.truth || []).push({ t, fv: r2(c.fv), bv: r2(c.fv * Math.exp(s)) }); // Truth Mode: real value and what the market believed
    const logT = Math.log(c.fv) + s + c.beta * state.mood * 0.01;
    c.pressure *= 0.5;
    const noise = c.beta * marketVol * Zm + c.vol * c.volMult * (gap ? 1.4 : 1) * rng.normal() * 0.85;
    let move = 0.25 * (logT - logP) + noise + clamp(c.pressure, -0.03, 0.03) + 0.1 * (c.lastMove || 0);
    move = clamp(move, -0.09, 0.09);
    const o = c.price, cl = Math.max(1, r2(o * Math.exp(move)));
    const h = r2(Math.max(o, cl) * Math.exp(Math.abs(rng.normal()) * c.vol * 0.45)), l = r2(Math.max(0.5, Math.min(o, cl) * Math.exp(-Math.abs(rng.normal()) * c.vol * 0.45)));
    const ds = Math.abs(s - (c.lastSent || 0));
    const v = Math.round(c.advTick * rng.range(0.7, 1.3) * (1 + Math.min(4, (Math.abs(move) / c.vol) * 0.8)) * (1 + Math.min(2, ds * 8)));
    c.volMult = 1 + (c.volMult - 1) * 0.85 + Math.min(1.5, ds * 10); c.lastSent = s; c.lastMove = move;
    c.candles.push({ t, o, h, l, c: cl, v }); c.price = cl;
  }
  const v = rd((1000 * state.companies.filter((c) => !c.ipo).reduce((a, c) => a + c.price * c.shares, 0)) / state.idxBase, 2); // IPO listings do not enter the index
  const prev = state.index.hist[state.index.hist.length - 1].v;
  state.index.hist.push({ t, v });
  state.mood = clamp(state.mood * 0.96 + clamp((v / prev - 1) / 0.012, -1, 1) * 0.06, -1, 1);
}

// ---- Orders ----------------------------------------------------------------------------------------------------------
const feeFn = (side, value) => r2(Math.max(10, value * 0.0012) + (side === 'sell' ? value * 0.001 : 0));
const quote = (c) => ({ bid: r2(c.price * (1 - c.spread / 2)), ask: r2(c.price * (1 + c.spread / 2)) });
const slipOf = (c, qty) => Math.min(0.06, (0.25 * qty) / c.advTick);
const heldShares = (p, cid) => (p.holdings[cid] ? p.holdings[cid].qty : 0);
const reservedShares = (p, cid) => p.orders.filter((o) => o.status === 'open' && o.companyId === cid && o.side === 'sell').reduce((s, o) => s + o.qty, 0);
const inr = (x) => '₹' + x.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function previewOrder(state, pid, req) {
  const out = { ok: false, error: null, warnings: [] };
  if (state.status !== 'active') { out.error = 'This session has finished.'; return out; }
  const ph = phaseOf(state);
  if (ph !== 'open') { out.error = ph === 'closed' ? 'The market is closed for today. Trading runs from 9:15 AM to 3:30 PM. Press Next day to prepare for tomorrow.' : 'The market has not opened yet. Trading runs from 9:15 AM to 3:30 PM. Press Play to reach the open.'; out.closed = true; return out; }
  const c = co(state, req.companyId); const p = state.players[pid];
  if (!c) { out.error = 'Choose a company first.'; return out; }
  const side = req.side, type = req.type || 'market', qty = Math.floor(Number(req.qty));
  if (!['buy', 'sell'].includes(side)) { out.error = 'Choose buy or sell.'; return out; }
  if (!['market', 'limit', 'stop'].includes(type)) { out.error = 'Unknown order type.'; return out; }
  if (!(qty >= 1)) { out.error = 'Enter a quantity of at least 1 share.'; return out; }
  if (qty > c.advTick * 3) { out.error = `That is more than ${c.ticker} typically trades in three hours. Try a smaller order.`; return out; }
  const q = quote(c); const slip = slipOf(c, qty); let est, limit = null, stop = null;
  if (type === 'market') est = side === 'buy' ? q.ask * (1 + slip) : q.bid * (1 - slip);
  else if (type === 'limit') {
    limit = Number(req.limit); if (!(limit > 0) || limit < c.price * 0.7 || limit > c.price * 1.3) { out.error = `Limit price must be within 30% of the current price (${inr(c.price)}).`; return out; } est = limit;
  } else {
    if (side !== 'sell') { out.error = 'Stop-loss orders protect shares you own, so they are sell orders.'; return out; }
    stop = Number(req.stop); if (!(stop > 0) || stop >= c.price || stop < c.price * 0.4) { out.error = `A stop-loss must be below the current price (${inr(c.price)}).`; return out; } est = stop;
  }
  est = r2(est); const value = r2(qty * est); const fee = feeFn(side, value); const nw = L.netWorth(state, p); const avail = r2(p.cash - p.reserved);
  const h = p.holdings[c.id]; const curVal = h ? h.qty * c.price : 0;
  if (side === 'buy') {
    const worst = type === 'market' ? r2(q.ask * (1 + slip * 1.15)) : est; const needed = r2(qty * worst + feeFn('buy', qty * worst));
    if (needed > avail) { out.error = `Not enough cash. This order needs about ${inr(needed)} but you have ${inr(avail)} available.`; return out; }
  } else {
    const avs = heldShares(p, c.id) - reservedShares(p, c.id);
    if (qty > avs) { out.error = avs <= 0 ? `You have no ${c.ticker} shares available to sell${reservedShares(p, c.id) ? ' (they are reserved by open orders)' : ''}.` : `You only have ${avs} ${c.ticker} shares available to sell.`; return out; }
  }
  const weightAfter = (curVal + (side === 'buy' ? value : -value)) / nw;
  if (side === 'buy' && weightAfter > 0.4) out.warnings.push(`This would put ${Math.round(weightAfter * 100)}% of your portfolio in ${c.ticker}. One bad surprise would hit hard.`);
  if (qty > 0.2 * c.advTick) out.warnings.push('This is large compared with normal trading volume, so expect extra slippage.');
  if (side === 'buy' && type === 'market' && (avail - value - fee) / nw < 0.05) out.warnings.push('You would have almost no cash left for new opportunities.');
  Object.assign(out, { ok: true, side, type, qty, companyId: c.id, name: c.name, ticker: c.ticker, refPrice: c.price, bid: q.bid, ask: q.ask, estPrice: est, limit, stop, value, fee,
    total: side === 'buy' ? r2(value + fee) : r2(value - fee), cashAfter: type === 'market' ? r2(p.cash + (side === 'buy' ? -(value + fee) : value - fee)) : r2(p.cash),
    pctOfPortfolio: Math.round((value / nw) * 1000) / 10, weightAfter: Math.round(weightAfter * 1000) / 10, availableCash: avail, spreadPct: rd(c.spread * 100, 2), slipPct: rd(slip * 100, 2),
    confirmRequired: type !== 'stop' && value / nw >= 0.15, reservesCash: type === 'limit' && side === 'buy' });
  return out;
}
function applyFill(state, p, o, price) {
  const c = co(state, o.companyId); const value = r2(o.qty * price); const fee = feeFn(o.side, value); const nwBefore = L.netWorth(state, p); let realized = null;
  if (o.side === 'buy') {
    p.cash = r2(p.cash - value - fee); const h = p.holdings[c.id] || { qty: 0, cost: 0 }; h.qty += o.qty; h.cost = r2(h.cost + value + fee); p.holdings[c.id] = h;
  } else {
    const h = p.holdings[c.id]; const costOut = (h.cost / h.qty) * o.qty; realized = r2(value - fee - costOut);
    h.qty -= o.qty; h.cost = r2(h.cost - costOut); if (h.qty === 0) delete p.holdings[c.id];
    p.cash = r2(p.cash + value - fee); p.realized = r2(p.realized + realized);
  }
  p.fees = r2(p.fees + fee); c.pressure += (o.side === 'buy' ? 1 : -1) * (o.qty / c.advTick) * 0.15;
  const tx = { id: 'T' + (p.transactions.length + 1), tick: state.tick, orderId: o.id, companyId: c.id, ticker: c.ticker, side: o.side, qty: o.qty, price, value, fee, realized, cashAfter: p.cash, orderType: o.type };
  p.transactions.push(tx); tx.reviewId = L.evaluateTrade(state, p, tx, c, nwBefore, o.type).id;
  o.status = 'filled'; o.filledTick = state.tick; o.fillPrice = price; o.fee = fee;
  return tx;
}
function placeOrder(state, pid, req) {
  const p = state.players[pid];
  if (req.key && p.orderKeys[req.key]) return { ok: true, duplicate: true, order: p.orders.find((o) => o.id === p.orderKeys[req.key]) };
  const pv = previewOrder(state, pid, req); if (!pv.ok) return { ok: false, error: pv.error };
  const c = co(state, pv.companyId); const q = quote(c);
  p.orderSeq = (p.orderSeq || 0) + 1;
  const o = { id: 'O' + p.orderSeq, key: req.key || null, companyId: c.id, ticker: c.ticker, side: pv.side, type: pv.type, qty: pv.qty, limit: pv.limit, stop: pv.stop, status: 'open', createdTick: state.tick, reserved: 0 };
  let tx = null;
  if (pv.type === 'market') {
    const r = RNG.derive(state.seed, 'order', pid, o.id); const slip = slipOf(c, o.qty) * r.range(0.85, 1.15);
    const price = pv.side === 'buy' ? r2(q.ask * (1 + slip)) : r2(q.bid * (1 - slip));
    if (pv.side === 'buy' && r2(o.qty * price + feeFn('buy', o.qty * price)) > r2(p.cash - p.reserved)) return { ok: false, error: 'Not enough cash at the executed price. Try a smaller order.' };
    tx = applyFill(state, p, o, price);
  } else if (pv.side === 'buy') { o.reserved = r2(o.qty * o.limit + feeFn('buy', o.qty * o.limit)); p.reserved = r2(p.reserved + o.reserved); }
  if (pv.type === 'stop') L.unlock(p, 'stop_loss', state.tick);
  p.orders.push(o); if (req.key) p.orderKeys[req.key] = o.id;
  return { ok: true, order: o, tx, review: tx ? p.reviews.find((r) => r.id === tx.reviewId) : null };
}
function cancelOrder(state, pid, oid) {
  const p = state.players[pid]; const o = p.orders.find((x) => x.id === oid);
  if (!o || o.status !== 'open') return { ok: false, error: 'That order is no longer open.' };
  p.reserved = r2(Math.max(0, p.reserved - o.reserved)); o.reserved = 0; o.status = 'cancelled'; return { ok: true };
}
function checkOrders(state, p) {
  for (const o of p.orders.filter((x) => x.status === 'open')) {
    const c = co(state, o.companyId); const k = c.candles[c.candles.length - 1];
    if (o.type === 'limit' && o.side === 'buy' && k.l <= o.limit) { p.reserved = r2(Math.max(0, p.reserved - o.reserved)); o.reserved = 0; applyFill(state, p, o, r2(Math.min(o.limit, k.o))); }
    else if (o.type === 'limit' && o.side === 'sell' && k.h >= o.limit) applyFill(state, p, o, r2(Math.max(o.limit, k.o)));
    else if (o.type === 'stop' && k.l <= o.stop) applyFill(state, p, o, r2(Math.min(o.stop, k.o) * (1 - slipOf(c, o.qty) * 2 - c.spread / 2)));
  }
}

// What a bot may use: the same order rules as a human, plus public company numbers.
const botApi = { ipoBid: (st, pid, req) => IPO.bid(st, pid, req), botBids: (st, ipo) => BOTS.ipoBids(st, ipo, botApi), placeOrder: (...a) => placeOrder(...a), cancelOrder: (...a) => cancelOrder(...a), phaseOf: (st) => phaseOf(st), co: (st, id) => co(st, id), pub: (st, c) => publicCompany(st, c, 1e9) };
function addBots(state, n) { BOTS.addBots(state, n, makePlayer); for (const p of Object.values(state.players)) if (p.bot && !p.equity.length) recordEquity(state, p); }
function spoil(state, pid) { if (state.room) return { ok: false, error: 'Spoilers are not available in a room.' }; state.players[pid].spoiled = true; return { ok: true }; }
function truthView(state, pid) { return TRUTH.truthView(state, pid, { phaseOf, dayOf, dayT, co, evById }); }

// ---- Time ------------------------------------------------------------------------------------------------------------
function advance(state) {
  if (state.status !== 'active') return { ok: false, error: 'This session has finished.' };
  state.dayRolled = false; state.tick++; const t = state.tick;
  publishDue(state);
  IPO.tick(state, t, botApi); progressEvents(state, t); publishDue(state);
  stepPrices(state, t, sentimentMap(state));
  const players = Object.values(state.players); const filledBy = {};
  for (const p of players) { const before = p.transactions.length; checkOrders(state, p); filledBy[p.id] = p.transactions.length - before; }
  BOTS.act(state, botApi);
  L.detectSituations(state);
  for (const p of players) L.updateReviews(state, p, false);
  recordEquity(state);
  if (t >= state.totalTicks) finish(state);
  return { ok: true, filled: filledBy.p1 || 0, filledBy };
}
function finish(state) {
  if (state.status !== 'active') return;
  for (const p of Object.values(state.players)) { for (const o of p.orders) if (o.status === 'open') { o.status = 'cancelled'; o.reserved = 0; } p.reserved = 0; }
  state.status = 'complete'; state.finishedTick = state.tick; if (state.room) state.room.status = 'complete';
  for (const p of Object.values(state.players)) { L.updateReviews(state, p, true); p.result = report(state, p.id); }
}

// ---- Portfolio & report ------------------------------------------------------------------------------------------------
function portfolio(state, pid = 'p1') {
  const p = state.players[pid]; const rows = [];
  let invested = 0, unreal = 0;
  for (const [cid, h] of Object.entries(p.holdings)) {
    const c = co(state, cid); const value = h.qty * c.price; const u = value - h.cost; invested += value; unreal += u;
    rows.push({ companyId: cid, ticker: c.ticker, name: c.name, industry: c.industry, qty: h.qty, avgCost: r2(h.cost / h.qty), price: c.price, value: r2(value), unrealized: r2(u), unrealizedPct: rd(u / h.cost, 4), reserved: reservedShares(p, cid) });
  }
  const blk = IPO.blocked(state, p); const nw = r2(p.cash + blk + invested); rows.forEach((r) => { r.weight = rd(r.value / nw, 4); });
  return { cash: p.cash, blocked: blk, reserved: p.reserved, available: r2(p.cash - p.reserved), invested: r2(invested), netWorth: nw, startCash: p.startCash, unrealized: r2(unreal), realized: p.realized, fees: p.fees,
    returnPct: rd(nw / p.startCash - 1, 4), cashPct: rd(p.cash / nw, 4), holdings: rows.sort((a, b) => b.value - a.value) };
}
function report(state, pid = 'p1') {
  const p = state.players[pid]; const pf = portfolio(state, pid); const idx = state.index.hist[state.index.hist.length - 1].v; const bench = idx / 1000 - 1;
  let peak = 0, mdd = 0;
  for (const e of p.equity) { peak = Math.max(peak, e.nw); mdd = Math.max(mdd, 1 - e.nw / peak); }
  const sells = p.transactions.filter((t) => t.side === 'sell'); const wins = sells.filter((t) => t.realized > 0).length;
  const best = sells.slice().sort((a, b) => b.realized - a.realized)[0] || null, worst = sells.slice().sort((a, b) => a.realized - b.realized)[0] || null;
  const reviews = p.reviews; const proc = reviews.length ? Math.round(reviews.reduce((s, r) => s + r.process, 0) / reviews.length) : null;
  const count = (id) => reviews.filter((r) => r.verdict && r.verdict.id === id).length;
  const maxW = pf.holdings.length ? Math.max(...pf.holdings.map((h) => h.weight)) : 0;
  const ret = pf.returnPct;
  const retScore = clamp(50 + (ret - bench) * 150, 0, 100), riskScore = clamp(100 - mdd * 250, 0, 100);
  const skill = Math.round(0.5 * (proc === null ? 60 : proc) + 0.3 * retScore + 0.2 * riskScore);
  const grade = skill >= 85 ? 'A' : skill >= 72 ? 'B' : skill >= 58 ? 'C' : skill >= 45 ? 'D' : 'E';
  const insights = [];
  insights.push(ret >= bench ? `You beat the market index by ${((ret - bench) * 100).toFixed(1)} percentage points.` : `The market index finished ${((bench - ret) * 100).toFixed(1)} points ahead of you. Many professionals struggle to beat it, so this is a useful benchmark.`);
  if (p.fees > p.startCash * 0.01) insights.push(`You paid ${inr(p.fees)} in transaction costs (${((p.fees / p.startCash) * 100).toFixed(1)}% of your starting capital). Fewer, more deliberate trades keep more of your returns.`);
  if (!p.transactions.length) insights.push('You did not trade at all. Holding cash avoids risk but also misses opportunities; that trade-off is called opportunity cost.');
  if (maxW > 0.5) insights.push(`Your largest holding was ${Math.round(maxW * 100)}% of the portfolio at the end. Spreading risk across industries makes results less dependent on one company.`);
  if (mdd > 0.12) insights.push(`Your portfolio fell as much as ${(mdd * 100).toFixed(1)}% from its peak at one point. Position sizing and stop-losses are tools for limiting that.`);
  if (count('unlucky')) insights.push(`${count('unlucky')} of your trades were sound decisions with unlucky outcomes. Keep the process; do not overreact to the result.`);
  if (count('lucky')) insights.push(`${count('lucky')} of your trades made money despite process gaps. Treat these as luck, not as a strategy.`);
  if (count('lesson')) insights.push(`${count('lesson')} trades were costly lessons. Review them in Decision Intelligence.`);
  return { netWorth: pf.netWorth, startCash: p.startCash, returnPct: ret, benchmarkPct: rd(bench, 4), maxDrawdown: rd(mdd, 4), trades: p.transactions.length, fees: p.fees, realized: p.realized, unrealized: pf.unrealized,
    winRate: sells.length ? rd(wins / sells.length, 3) : null, best, worst, processScore: proc, skill, grade, insights, holdingsAtEnd: pf.holdings.length, largestWeight: maxW,
    verdicts: { unlucky: count('unlucky'), skill: count('skill'), lucky: count('lucky'), lesson: count('lesson') }, concepts: Object.keys(p.concepts).map(L.concept), equity: p.equity, days: state.days };
}

// ---- Public view (hidden attributes are never sent) --------------------------------------------------------------------
function dayClose(c, t) { return candleAt(c, (dayOf(t) - 1) * TPD).c; }
function publicCompany(state, c, since) {
  const t = state.tick, dt = dayT(state); const prev = c.ipo && c.issuePrice && dayOf(dt) === dayOf(c.listTick) ? c.issuePrice : dayClose(c, dt); const q = quote(c); const f = c.fund; // on listing day an IPO's change is measured from its issue price
  const dayKs = c.candles.filter((k) => k.t > (dayOf(dt) - 1) * TPD);
  const eps = f.profit / c.shares; const debtR = f.debt / Math.max(1, f.revenue), cashR = f.cash / Math.max(1, f.revenue);
  const next = state.calendar.find((e) => e.kind === 'earnings' && e.companyId === c.id && e.tick > t);
  return { id: c.id, ipo: !!c.ipo, issuePrice: c.issuePrice || null, ticker: c.ticker, name: c.name, fullName: c.fullName, industry: c.industry, description: c.description, price: c.price, bid: q.bid, ask: q.ask, spreadPct: rd(c.spread * 100, 2),
    prevClose: prev, change: r2(c.price - prev), changePct: rd(c.price / prev - 1, 4), marketCap: Math.round(c.price * c.shares), shares: c.shares, pe: f.profit > 0 ? rd(c.price / eps, 1) : null, eps: rd(eps, 2),
    fund: { revenue: f.revenue, profit: f.profit, debt: f.debt, cash: f.cash, prevRevenue: f.prevRevenue || null, prevProfit: f.prevProfit === undefined ? null : f.prevProfit, marketShare: c.marketShare, margin: rd(f.profit / Math.max(1, f.revenue), 3) },
    balance: debtR < 0.35 && cashR > 0.12 ? 'Strong' : debtR > 0.8 || (f.profit < 0 && cashR < 0.1) ? 'Stretched' : 'Fair', liquidity: c.liquidity, risk: c.risk,
    volumeToday: dayKs.reduce((s, k) => s + k.v, 0), turnoverCr: rd(dayKs.reduce((s, k) => s + k.v * k.c, 0) / 1e7, 2), dayHigh: dayKs.length ? Math.max(...dayKs.map((k) => k.h)) : c.price, dayLow: dayKs.length ? Math.min(...dayKs.map((k) => k.l)) : c.price,
    lastEarnings: c.lastEarnings, nextEarnings: next ? next.tick : null, candles: c.candles.filter((k) => k.t > since) };
}
function view(state, { since = -1e9, newsSeq = 0, pid = 'p1' } = {}) {
  const t = state.tick, dt = dayT(state); const p = state.players[pid]; const pf = portfolio(state, pid);
  const companies = state.companies.map((c) => publicCompany(state, c, since));
  const hist = state.index.hist; const ix = hist[hist.length - 1].v; const ixPrev = (hist.find((h) => h.t === (dayOf(dt) - 1) * TPD) || hist[0]).v;
  const sectors = {}; for (const c of companies) (sectors[c.industry] = sectors[c.industry] || []).push(c.changePct);
  const sorted = companies.slice().sort((a, b) => b.changePct - a.changePct);
  const mood = state.mood; const moodLabel = mood < -0.55 ? 'Fear' : mood < -0.15 ? 'Cautious' : mood < 0.15 ? 'Neutral' : mood < 0.55 ? 'Optimistic' : 'Greed';
  const lastNews = state.news.slice(-12);
  return {
    id: state.id, seed: state.seed, status: state.status, tick: t, totalTicks: state.totalTicks, day: Math.max(1, dayOf(dt)), days: state.days, tpd: TPD, clock: dt !== t ? fmtMin(PRE_MIN) : clockNow(t), slot: t <= 0 ? 0 : slotOf(t), phase: phaseOf(state), hours: { preOpen: fmtMin(PRE_MIN), open: fmtMin(OPEN_MIN), close: fmtMin(CLOSE_MIN), preMin: PRE_MIN, openMin: OPEN_MIN, closeMin: CLOSE_MIN, nowMin: t <= 0 ? PRE_MIN : state.status === 'active' && t % TPD === 0 && state.dayRolled ? PRE_MIN : endMin(t) },
    marketName: state.marketName, indexName: state.indexName, scenario: state.scenario, macro: macroDisplay(state.macro), duration: state.duration, mood: rd(mood, 3), moodLabel,
    index: { value: ix, change: rd(ix / ixPrev - 1, 4), hist: hist.filter((h) => h.t > since) }, marketStatus: phaseOf(state) === 'open' ? 'OPEN' : 'CLOSED', ipos: IPO.viewList(state, pid), notices: (p.notices || []).slice(-40), rivals: !state.room && Object.keys(state.players).length > 1 ? leaderboard(state, pid) : null, spoiled: !!p.spoiled,
    gainers: sorted.slice(0, 3).map((c) => c.id), losers: sorted.slice(-3).reverse().map((c) => c.id), sectors: Object.entries(sectors).map(([name, a]) => ({ name, changePct: rd(a.reduce((x, y) => x + y, 0) / a.length, 4) })),
    turnoverCr: rd(companies.reduce((s, c) => s + c.turnoverCr, 0), 1), companies,
    news: state.news.filter((n) => n.seq > newsSeq).map(({ claim, weight, corrects, confirms, ...n }) => n), newsTotal: state.news.length,
    channelStats: channelStats(state), ticker: lastNews.map((n) => ({ id: n.id, channel: n.channel, headline: n.headline, breaking: n.breaking })),
    upcoming: state.calendar.filter((e) => e.tick > t).slice(0, 8).map((e) => ({ tick: e.tick, day: dayOf(e.tick), clock: clock(e.tick), kind: e.kind, label: e.label, companyId: e.companyId || null })),
    portfolio: pf, orders: p.orders.slice(-60).reverse(), transactions: p.transactions.slice().reverse(), reviews: p.reviews.slice().reverse(), situations: p.situations.slice().reverse(),
    concepts: Object.keys(p.concepts).map(L.concept), equity: p.equity, fallback: state.fallback, flavor: state.flavor, result: p.result || null, mode: state.mode || 'solo', rev: state.rev || 0, you: pid, playerName: p.name, room: state.mode === 'room' ? roomView(state, pid) : null,
  };
}
// ---- Multiplayer: leaderboard metrics ------------------------------------------------------------------------------------
const downsample = (arr, n) => { if (arr.length <= n) return arr.slice(); const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]); return out; };
function metrics(state, p) {
  const e = p.equity; const start = p.startCash; const nw = e.length ? e[e.length - 1].nw : start; let peak = 0, mdd = 0; const rets = [];
  e.forEach((x, i) => { peak = Math.max(peak, x.nw); mdd = Math.max(mdd, 1 - x.nw / peak); if (i && e[i - 1].nw > 0) rets.push(x.nw / e[i - 1].nw - 1); });
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const risk = sd > 1e-7 ? clamp((mean / sd) * Math.sqrt(rets.length), -9, 9) : 0;   // return per unit of ups and downs
  return { nw, ret: nw / start - 1, mdd, risk };
}
function leaderboard(state, viewerPid) {
  const bench = state.index.hist[state.index.hist.length - 1].v / 1000 - 1; const ref = state.players.p1.equity; const idxs = downsample(ref.map((_, i) => i), 60);
  const rows = Object.values(state.players).map((p) => {
    const m = metrics(state, p); const proc = p.reviews.length ? Math.round(p.reviews.reduce((s, r) => s + r.process, 0) / p.reviews.length) : null;
    return { pid: p.id, name: p.name, bot: p.bot ? p.bot.style : null, you: p.id === viewerPid, netWorth: r2(m.nw), returnPct: rd(m.ret, 4), beatMarket: m.ret > bench, maxDrawdown: rd(m.mdd, 4), risk: rd(m.risk, 2), process: proc, trades: p.transactions.length,
      grade: p.result ? p.result.grade : null, skill: p.result ? p.result.skill : null, curve: idxs.map((i) => (p.equity[i] ? rd((p.equity[i].nw / p.startCash) * 100, 2) : null)) };
  });
  return { rows, benchmarkPct: rd(bench, 4), curveT: idxs.map((i) => (ref[i] ? ref[i].t : 0)), market: idxs.map((i) => (ref[i] ? rd((ref[i].idx / ref[0].idx) * 100, 2) : null)) };
}
function roomView(state, pid) {
  const r = state.room; const host = state.players[r.hostPid];
  return { code: r.code, host: pid === r.hostPid, hostName: host ? host.name : '', status: r.status, speed: r.speed, maxPlayers: r.maxPlayers || 8,
    members: Object.values(state.players).map((p) => ({ pid: p.id, name: p.name, bot: p.bot ? p.bot.style : null, host: p.id === r.hostPid, you: p.id === pid })), board: leaderboard(state, pid) };
}
function channelStats(state) {
  const out = {};
  for (const ch of Object.keys(require('./news').CHANNELS)) {
    const items = state.news.filter((n) => n.channel === ch && n.treatment !== 'background' && n.treatment !== 'general');
    const disputed = items.filter((n) => n.disputed).length;
    out[ch] = { reports: items.length, disputed, record: items.length ? Math.round((1 - disputed / items.length) * 100) : null };
  }
  return out;
}
module.exports = { start, addPlayer, addBots, truthView, spoil, ipoBid: (state, pid, req) => IPO.bid(state, pid, req), advance, nextDay, phaseOf, finish, leaderboard, previewOrder, placeOrder, cancelOrder, portfolio, report, view, clock, dayOf, feeFn, quote, evById };
