'use strict';
// IPO lifecycle, per the real process but compressed:
//   OPEN   at the opening bell (9:15 AM) of the IPO day: players may bid for lots. The bid amount is deducted from cash straight away.
//   CLOSE  at 3:30 PM the same day: bidding stops. If demand is higher than supply, a lucky draw decides who is allotted (the more
//          oversubscribed, the lower the odds). Unallotted money and any unused part of a bid is refunded at listing.
//   LIST   at the next morning's opening bell: refunds are credited, allotted shares arrive, and the company starts trading at its
//          listing price. Most IPOs list higher than the issue price, some list lower, and the hype fades over the following days.
const { RNG } = require('./rng'); const D = require('./data');
const r2 = (x) => Math.round(x * 100) / 100, rd = (x, d = 4) => { const k = 10 ** d; return Math.round(x * k) / k; };
const MAX_LOTS = 10;
const find = (state, id) => (state.ipos || []).find((i) => i.id === id);
const humans = (state) => Object.values(state.players).filter((p) => !p.bot);
const lotCost = (ipo) => r2(ipo.lotSize * ipo.issuePrice);
const pctTxt = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
function notify(state, p, n) { (p.notices = p.notices || []).push(Object.assign({ id: `${p.id}-${p.notices.length + 1}`, tick: state.tick }, n)); }
function news(state, ipo, channel, label, headline, body, withCompany) {
  const item = { id: `${ipo.id}-${state.news.length + 1}`, tick: state.tick, minute: 5, channel, label, headline, body, treatment: 'ipo', claim: {}, weight: 0, tags: { companies: withCompany ? [ipo.company.id] : [], industries: [ipo.company.industry] }, eventId: null, corrects: [], confirms: null, breaking: false };
  state.news.push(Object.assign(item, { seq: state.news.length + 1, disputed: false }));
}

function open(state, ipo, t, api) {
  ipo.status = 'open'; ipo.sub = rd(ipo.finalSub * Math.pow(1 / 7, 1.8), 2); const c = ipo.company;
  news(state, ipo, 'dailypulse', 'IPO', `New IPO: ${c.name} opens for bidding at \u20B9${ipo.issuePrice} a share`,
    `${c.name}, a ${c.industry.toLowerCase()} company, is raising about \u20B9${ipo.issueCr} crore ${ipo.use}. Bidding is open until the closing bell today, in lots of ${ipo.lotSize} shares. More investors than shares usually means a lucky draw.`, false);
  for (const p of humans(state)) notify(state, p, { type: 'ipo_open', ipoId: ipo.id });
  if (api.botBids) api.botBids(state, ipo);
}
function close(state, ipo, t) {
  ipo.status = 'closed'; ipo.sub = ipo.finalSub; const S = ipo.finalSub;
  for (const [pid, b] of Object.entries(ipo.bids)) {
    const rng = RNG.derive(state.seed, 'ipo', ipo.id, 'draw', pid);
    const won = S <= 1 || rng.chance(Math.max(0.12, Math.min(0.96, 2.2 / (1 + S)))); // more demand, lower odds (hot IPO about 1 in 5)
    const lots = won ? (S <= 2 ? b.lots : Math.max(1, Math.round(b.lots * Math.min(1, 2 / S)))) : 0;
    b.shares = lots * ipo.lotSize; b.cost = r2(b.shares * ipo.issuePrice); b.refund = r2(b.amount - b.cost); b.status = won ? 'won' : 'lost'; b.lotsWon = lots;
    const p = state.players[pid]; if (p && !p.bot) notify(state, p, { type: 'ipo_result', ipoId: ipo.id, won, shares: b.shares, cost: b.cost, refund: b.refund });
  }
  news(state, ipo, 'marketline', 'IPO', `${ipo.company.name} IPO subscribed ${S.toFixed(1)} times`, `Bidding for ${ipo.company.name} closed with demand ${S.toFixed(1)} times the shares on offer. ${S > 1 ? 'Because it was oversubscribed, shares were allotted by lucky draw.' : 'Everyone who bid received their shares.'} The stock lists at tomorrow's opening bell.`, false);
}
function list(state, ipo, t) {
  const c = ipo.company; const price = r2(ipo.issuePrice * Math.exp(ipo.edge + ipo.hype)); c.price = price; c.listTick = t; c.ipo = true; c.issuePrice = ipo.issuePrice; c.lastMove = 0; c.pressure = 0;
  const hi = r2(Math.max(price, ipo.issuePrice) * 1.004), lo = r2(Math.min(price, ipo.issuePrice) * 0.996);
  c.candles = [{ t, o: ipo.issuePrice, h: hi, l: lo, c: price, v: Math.round(c.advTick * 3) }]; c.truth = [{ t, fv: r2(c.fv), bv: r2(c.fv * Math.exp(ipo.hype)) }];
  state.companies.push(c); ipo.status = 'listed'; ipo.listPrice = price; ipo.listGainReal = rd(price / ipo.issuePrice - 1, 4);
  for (const [pid, b] of Object.entries(ipo.bids)) {
    const p = state.players[pid]; if (!p) continue;
    p.cash = r2(p.cash + b.refund);
    if (b.shares > 0) {
      const h = p.holdings[c.id] || { qty: 0, cost: 0 }; h.qty += b.shares; h.cost = r2(h.cost + b.cost); p.holdings[c.id] = h;
      p.transactions.push({ id: 'T' + (p.transactions.length + 1), tick: t, orderId: null, companyId: c.id, ticker: c.ticker, side: 'buy', qty: b.shares, price: ipo.issuePrice, value: b.cost, fee: 0, realized: null, cashAfter: p.cash, orderType: 'ipo', note: 'Allotted in the IPO' });
    }
    b.status = 'done';
  }
  const gain = ipo.listGainReal;
  news(state, ipo, 'flashwire', 'IPO', `${c.name} lists at \u20B9${price}, ${gain >= 0 ? 'up' : 'down'} ${Math.abs(gain * 100).toFixed(1)}% on debut`.toUpperCase() + '!', `${c.name} began trading at \u20B9${price} against an issue price of \u20B9${ipo.issuePrice} (${pctTxt(gain)}). ${gain < 0 ? 'Not every IPO pops.' : 'Early gains can fade, so watch the next few sessions.'}`, true);
  for (const p of humans(state)) notify(state, p, { type: 'ipo_listed', ipoId: ipo.id, price, gain, companyId: c.id });
}
// Called once per tick after the clock moves.
function tick(state, t, api) {
  for (const ipo of state.ipos || []) {
    if (ipo.status === 'scheduled' && t >= ipo.openTick) open(state, ipo, t, api);
    else if (ipo.status === 'open') { ipo.sub = rd(ipo.finalSub * Math.pow(Math.min(1, (t - ipo.openTick + 1) / 7), 1.8), 2); if (t >= ipo.closeTick) close(state, ipo, t); }
    if (ipo.status === 'closed' && t >= ipo.listTick) list(state, ipo, t);
  }
}
// Place, change or cancel a bid (lots = 0 cancels). The money leaves the cash balance immediately.
function bid(state, pid, req) {
  const ipo = find(state, req.ipoId); if (!ipo) return { ok: false, error: 'That IPO does not exist.' };
  if (ipo.status !== 'open') return { ok: false, error: ipo.status === 'scheduled' ? 'This IPO has not opened yet.' : 'Bidding for this IPO has closed.' };
  const p = state.players[pid]; const lots = Math.floor(Number(req.lots)); const prev = ipo.bids[pid] ? ipo.bids[pid].amount : 0;
  if (!Number.isFinite(lots) || lots < 0 || lots > MAX_LOTS) return { ok: false, error: `You can bid for 1 to ${MAX_LOTS} lots.` };
  if (lots === 0) { if (!prev) return { ok: true }; p.cash = r2(p.cash + prev); delete ipo.bids[pid]; return { ok: true, cancelled: true }; }
  const amount = r2(lots * lotCost(ipo)); const need = r2(amount - prev);
  if (need > r2(p.cash - p.reserved)) return { ok: false, error: `You need \u20B9${amount.toLocaleString('en-IN')} for ${lots} lot${lots > 1 ? 's' : ''} but only \u20B9${r2(p.cash - p.reserved + prev).toLocaleString('en-IN')} is free.` };
  p.cash = r2(p.cash - need); ipo.bids[pid] = { lots, amount, status: 'bid', bidTick: state.tick, shares: 0, cost: 0, refund: 0 };
  return { ok: true, amount, lots };
}
const healthLabel = (h) => (h >= 0.62 ? 'Strong' : h >= 0.45 ? 'Fair' : 'Weak');
// What a player is allowed to know. Quality, real value, final demand and the true listing gain stay hidden until the stock lists.
function viewList(state, pid) {
  return (state.ipos || []).filter((i) => i.status !== 'scheduled').map((i) => {
    const c = i.company; const f = c.fund; const eps = f.profit / c.shares; const b = i.bids[pid]; const listed = i.status === 'listed';
    const live = listed ? state.companies.find((x) => x.id === c.id) : null;
    return { id: i.id, status: i.status, name: c.name, fullName: c.fullName, ticker: c.ticker, companyId: c.id, industry: c.industry, description: c.description, use: i.use,
      fund: { revenue: f.revenue, profit: f.profit, debt: f.debt, cash: f.cash, margin: rd(f.profit / Math.max(1, f.revenue), 3) }, pe: f.profit > 0 ? rd(i.issuePrice / eps, 1) : null, balance: (f.debt / Math.max(1, f.revenue) < 0.35 && f.cash / Math.max(1, f.revenue) > 0.12) ? 'Strong' : (f.debt / Math.max(1, f.revenue) > 0.8 || (f.profit < 0 && f.cash / Math.max(1, f.revenue) < 0.1)) ? 'Stretched' : 'Fair', risk: c.risk, marketCap: Math.round(i.issuePrice * c.shares),
      peTypical: (D.INDUSTRIES[c.industry] || {}).pe || null, issuePrice: i.issuePrice, lotSize: i.lotSize, lotCost: lotCost(i), maxLots: MAX_LOTS, issueCr: i.issueCr, lotsOffered: i.lotsOffered, sub: i.sub, gmp: i.status === 'listed' ? null : i.gmp,
      openTick: i.openTick, closeTick: i.closeTick, listTick: i.listTick,
      you: b ? { lots: b.lots, amount: b.amount, status: b.status, shares: b.shares, cost: b.cost, refund: b.refund } : null,
      listed: listed ? { price: i.listPrice, gain: i.listGainReal, now: live ? live.price : i.listPrice } : null };
  });
}
function blocked(state, p) { let s = 0; for (const i of state.ipos || []) { const b = i.bids && i.bids[p.id]; if (b && b.status !== 'done') s += b.amount; } return r2(s); }
module.exports = { tick, bid, viewList, blocked, MAX_LOTS };
