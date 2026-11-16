'use strict';
// Computer players. They sit in the same market as the human, see only what a human sees (published news, prices, company numbers),
// trade through the same order rules (market hours, fees, slippage) and appear on the leaderboard. Every trade carries a plain-English
// reason that Truth Mode shows after the fact. Decisions are deterministic for a given seed.
const { RNG } = require('./rng');
const L = require('./learn');
const NEWS = require('./news');

const STYLES = {
  headline: { title: 'Headline Hari', trait: 'Fast and trusting', blurb: 'Hears the news and bids straight away. Believes every channel, including the rumours.' },
  careful: { title: 'Careful Kavya', trait: 'Slow and sceptical', blurb: 'Acts only on verified reports from Marketline, waits an hour, spreads her money and sets a stop-loss.' },
  coinflip: { title: 'Coin-Flip Chintu', trait: 'Random', blurb: 'Plays at random. No reading, no plan, just luck.' },
  trend: { title: 'Trend Tanmay', trait: 'Follows the chart', blurb: 'Buys what has been rising and sells what has been falling. Ignores the news.' },
  value: { title: 'Value Vihaan', trait: 'Patient', blurb: 'Buys healthy, reasonably priced companies on day one and holds them.' },
  panic: { title: 'Panic Pooja', trait: 'Nervous', blurb: 'Buys on good news, then sells everything at the first drop.' },
};
const ORDER = ['headline', 'careful', 'coinflip', 'trend', 'value', 'panic'];
const chName = (ch) => String((NEWS.CHANNELS[ch] && NEWS.CHANNELS[ch].name) || ch).toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const held = (p, c) => (p.holdings[c.id] ? p.holdings[c.id].qty : 0);
const pctTxt = (x) => `${(x * 100).toFixed(1)}%`;

function addBots(state, n, makePlayer) {
  ORDER.slice(0, Math.max(0, Math.min(ORDER.length, n | 0))).forEach((style, i) => {
    const pid = 'b' + (i + 1); if (state.players[pid]) return;
    const p = makePlayer(pid, STYLES[style].title, null); p.bot = { style, seen: 0, queue: [], n: 0, stops: {} }; state.players[pid] = p;
  });
}

// ---- trading helpers -------------------------------------------------------------------------------------------------
function place(state, p, api, req, note, seq) {
  p.bot.n++; const r = api.placeOrder(state, p.id, Object.assign({ type: 'market', key: `${p.id}-${state.tick}-${p.bot.n}` }, req));
  if (r.ok && r.tx) { r.tx.note = note; r.tx.seq = seq || null; }
  return r.ok;
}
function buy(state, p, api, c, frac, note, seq) {
  const nw = L.netWorth(state, p); const room = Math.max(0, nw * 0.3 - held(p, c) * c.price);          // never more than 30% in one company
  const want = Math.min(nw * frac, room, (p.cash - p.reserved) * 0.96); const qty = Math.floor(want / (c.price * 1.02));
  return qty >= 1 && place(state, p, api, { companyId: c.id, side: 'buy', qty }, note, seq);
}
function sell(state, p, api, c, frac, note, seq) {
  const h = p.holdings[c.id]; if (!h) return false;
  const locked = p.orders.filter((o) => o.status === 'open' && o.companyId === c.id && o.side === 'sell').reduce((s, o) => s + o.qty, 0);
  const qty = Math.min(Math.ceil(h.qty * frac), h.qty - locked); if (qty < 1) return false;
  return place(state, p, api, { companyId: c.id, side: 'sell', qty }, note, seq);
}
function fresh(state, p) { const seen = p.bot.seen; const f = state.news.filter((n) => n.seq > seen && n.tick <= state.tick); if (f.length) p.bot.seen = f[f.length - 1].seq; return f; }
const signals = (n) => (n.claim ? Object.keys(n.claim).filter((cid) => Math.abs(n.claim[cid]) >= 0.01 && n.treatment !== 'denial' && n.treatment !== 'retraction') : []);

// ---- the six styles ----------------------------------------------------------------------------------------------------
const STRAT = {
  coinflip(state, p, api, rng) {
    if (!rng.chance(0.35)) return;
    const c = rng.pick(state.companies); const h = held(p, c);
    if (h && rng.chance(0.5)) sell(state, p, api, c, rng.range(0.5, 1), 'Picked a company and a side at random', null);
    else buy(state, p, api, c, rng.range(0.03, 0.09), 'Picked a company and a side at random', null);
  },
  headline(state, p, api) {
    let acts = 0;
    for (const n of fresh(state, p)) {
      if (acts >= 2) break;
      for (const cid of signals(n)) {
        const c = api.co(state, cid); if (!c) continue; const dir = Math.sign(n.claim[cid]);
        const note = `Heard "${n.headline}" on ${chName(n.channel)} and acted at once, without checking the source`;
        if (dir > 0 ? buy(state, p, api, c, 0.1, note, n.seq) : sell(state, p, api, c, 1, note, n.seq)) { acts++; break; }
      }
    }
  },
  careful(state, p, api) {
    for (const n of fresh(state, p)) if (n.channel === 'marketline' && n.treatment === 'accurate' && signals(n).length) p.bot.queue.push({ n, due: state.tick + 1 });
    const open = p.bot.queue.filter((q) => q.due <= state.tick); p.bot.queue = p.bot.queue.filter((q) => q.due > state.tick);
    let acts = 0;
    for (const { n } of open) {
      if (acts >= 2) break;
      for (const cid of signals(n)) {
        const c = api.co(state, cid); if (!c) continue; const dir = Math.sign(n.claim[cid]);
        const note = `Waited an hour after Marketline confirmed: "${n.headline}"`;
        if (dir > 0) { if (buy(state, p, api, c, 0.08, note, n.seq)) { acts++; const h = p.holdings[c.id]; if (h && !p.bot.stops[c.id]) { p.bot.stops[c.id] = true; place(state, p, api, { companyId: c.id, side: 'sell', type: 'stop', qty: h.qty, stop: Math.round(c.price * 0.94 * 100) / 100 }, 'Stop-loss', null); } break; } }
        else if (held(p, c)) { p.orders.filter((o) => o.status === 'open' && o.companyId === c.id && o.type === 'stop').forEach((o) => api.cancelOrder(state, p.id, o.id)); delete p.bot.stops[c.id]; if (sell(state, p, api, c, 1, note, n.seq)) { acts++; break; } }
      }
    }
  },
  trend(state, p, api) {
    const rows = state.companies.map((c) => { const k = c.candles; const r3 = k.length > 4 ? c.price / k[k.length - 4].c - 1 : 0; return { c, r3 }; }).sort((a, b) => b.r3 - a.r3);
    const up = rows[0], dn = rows[rows.length - 1];
    if (dn && held(p, dn.c) && dn.r3 < -0.015) sell(state, p, api, dn.c, 1, `Price fell ${pctTxt(-dn.r3)} in three hours, so followed the trend down`, null);
    if (up && up.r3 > 0.015) buy(state, p, api, up.c, 0.1, `Price rose ${pctTxt(up.r3)} in three hours, so followed the trend up`, null);
  },
  value(state, p, api) {
    const holdingsN = Object.keys(p.holdings).length;
    if (holdingsN >= 4 || (p.cash - p.reserved) < L.netWorth(state, p) * 0.12) return;
    const pick = state.companies.map((c) => ({ c, pub: api.pub(state, c) })).filter((x) => x.pub.pe && x.pub.balance !== 'Stretched' && !held(p, x.c)).sort((a, b) => a.pub.pe - b.pub.pe)[0];
    if (pick) buy(state, p, api, pick.c, 0.22, `Healthy balance sheet and a P/E of ${pick.pub.pe}, so bought to hold`, null);
  },
  panic(state, p, api) {
    for (const [cid, h] of Object.entries(p.holdings)) {
      const c = api.co(state, cid); const down = c.price / (h.cost / h.qty) - 1; const k = c.candles; const last = k.length > 1 ? c.price / k[k.length - 2].c - 1 : 0;
      if (down <= -0.03 || last <= -0.025) { sell(state, p, api, c, 1, `Panicked: the price was ${pctTxt(Math.min(down, last) * -1)} lower, so sold everything`, null); }
    }
    let acts = 0;
    for (const n of fresh(state, p)) {
      if (acts >= 1) break;
      for (const cid of signals(n)) {
        const c = api.co(state, cid); if (!c || n.claim[cid] <= 0) continue;
        if (buy(state, p, api, c, 0.12, `Liked the good news on ${chName(n.channel)}: "${n.headline}"`, n.seq)) { acts++; break; }
      }
    }
  },
};

// Each bot decides at the moment an IPO opens. Headline Hari and Panic Pooja chase the grey-market buzz, Careful Kavya and Value Vihaan read
// the numbers, Chintu flips a coin, Tanmay only joins when the buzz is strong.
function ipoBids(state, ipo, api) {
  const c = ipo.company; const f = c.fund; const pe = f.profit > 0 ? ipo.issuePrice / (f.profit / c.shares) : 99; const debtR = f.debt / Math.max(1, f.revenue);
  for (const p of Object.values(state.players)) {
    if (!p.bot) continue; const rng = RNG.derive(state.seed, 'ipobid', ipo.id, p.id); let lots = 0;
    switch (p.bot.style) {
      case 'headline': lots = ipo.gmp > 0 ? 2 : 0; break;
      case 'careful': lots = c.hid.health >= 0.5 && debtR < 0.6 && ipo.gmp > 0.03 ? 2 : 0; break;
      case 'coinflip': lots = rng.chance(0.5) ? rng.int(1, 3) : 0; break;
      case 'trend': lots = ipo.gmp > 0.08 ? 1 : 0; break;
      case 'value': lots = f.profit > 0 && pe < 25 && c.hid.health >= 0.5 ? 2 : 0; break;
      case 'panic': lots = 2; break;
      default: break;
    }
    if (lots) api.ipoBid(state, p.id, { ipoId: ipo.id, lots });
  }
}

function act(state, api) {
  if (api.phaseOf(state) !== 'open') return;
  for (const p of Object.values(state.players)) { if (!p.bot) continue; const rng = RNG.derive(state.seed, 'bot', p.id, state.tick); try { STRAT[p.bot.style](state, p, api, rng); } catch (_) { /* a bot never breaks the market */ } }
}
module.exports = { STYLES, ORDER, addBots, act, ipoBids };
