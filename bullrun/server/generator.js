'use strict';
// Builds a complete fictional market from a seed. No network, no AI required.
const { RNG } = require('./rng');
const D = require('./data');
const { scheduleEvents, clamp, rd } = require('./events');
const { compose } = require('./news');

const PREFIX = ['Aurelia', 'Veridian', 'Sundara', 'Halcyon', 'Meridian', 'Kestrel', 'Solara', 'Nordhaven', 'Zephyr', 'Lumina', 'Tarkhan', 'Ostrava'];
const SUFFIX = ['Exchange', 'Stock Exchange', 'Securities Market', 'Bourse'];
const START_CASH = 100000;

function makeTicker(name, used) {
  const base = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  let t = base.slice(0, 4).padEnd(4, 'X'); let i = 2;
  while (used.has(t)) { t = base.slice(0, 3) + String(i++); }
  used.add(t); return t;
}
function genCompany(rng, ind, idx, usedNames, usedTickers) {
  const spec = D.INDUSTRIES[ind];
  let name = rng.pick(spec.names); let guard = 0;
  while (usedNames.has(name) && guard++ < 30) name = rng.pick(spec.names);
  usedNames.add(name);
  const price = Math.round(Math.exp(rng.range(Math.log(70), Math.log(460))) * 20) / 20;
  const shares = rd(rng.range(2, 25), 2);                       // crore shares
  const mcap = price * shares;                                  // Rs crore
  const loss = rng.chance(spec.lossP);
  let revenue, profit;
  if (loss) { revenue = mcap / rng.range(1.5, 4); profit = -revenue * rng.range(0.02, 0.12); }
  else { const pe = rng.range(spec.pe[0], spec.pe[1]); profit = mcap / pe; revenue = profit / rng.range(spec.margin[0], spec.margin[1]); }
  const debtR = rng.range(spec.debt[0], spec.debt[1]), cashR = rng.range(0.05, 0.3);
  const mgmt = rng.range(0.25, 0.9);
  const growth = rd(rng.range(-0.03, 0.2) + (['Technology', 'Electric Vehicles'].includes(ind) ? 0.04 : 0), 3);
  const margin = profit / revenue;
  const health = clamp(0.5 + 0.8 * margin - 0.15 * debtR + 0.4 * cashR + 0.25 * (mgmt - 0.5) + rng.normal() * 0.08, 0.1, 0.95);
  const turn = Math.exp(rng.range(Math.log(0.0002), Math.log(0.003)));
  const liquidity = turn < 0.0007 ? 'Low' : turn < 0.0016 ? 'Medium' : 'High';
  const spread = { Low: 0.006, Medium: 0.003, High: 0.0012 }[liquidity] * rng.range(0.85, 1.2);
  const vol = spec.vol * rng.range(0.8, 1.35) * (1 + debtR * 0.15 + (loss ? 0.2 : 0));
  const rs = (vol - 0.011) / 0.012 + debtR * 0.4 + (loss ? 0.4 : 0);
  return {
    id: 'c' + idx, ticker: makeTicker(name, usedTickers), name, fullName: name.includes(' ') ? name : `${name} ${spec.word}`, industry: ind,
    description: rng.pick(spec.desc).replace('{name}', name),
    shares, price, fv: price * Math.exp(rng.normal() * 0.04), advTick: Math.round(shares * 1e7 * turn), liquidity, spread: rd(spread, 5), vol: rd(vol, 5), beta: rd(spec.beta * rng.range(0.85, 1.15), 3),
    risk: rs < 0.45 ? 'Low' : rs < 0.9 ? 'Medium' : 'High', marketShare: rd(rng.range(2, 32), 1),
    fund: { revenue: Math.round(revenue), profit: Math.round(profit), debt: Math.round(revenue * debtR), cash: Math.round(revenue * cashR) },
    hid: { mgmt: rd(mgmt, 3), growth, health: rd(health, 3) },
    pressure: 0, volMult: 1, candles: [], lastEarnings: null,
  };
}
function genHistory(rng, c, market, n) {
  const mu = rng.range(-0.0018, 0.0018); let p = 100; const raw = [];
  for (let i = 0; i < n; i++) {
    const r = mu + c.beta * market[i] + c.vol * rng.normal() * 0.85;
    const o = p, cl = p * Math.exp(r);
    const h = Math.max(o, cl) * Math.exp(Math.abs(rng.normal()) * c.vol * 0.5), l = Math.min(o, cl) * Math.exp(-Math.abs(rng.normal()) * c.vol * 0.5);
    raw.push({ o, h, l, c: cl, v: Math.round(c.advTick * rng.range(0.6, 1.4) * (1 + 3 * Math.abs(r) / c.vol * 0.3)) }); p = cl;
  }
  const k = c.price / raw[n - 1].c;
  return raw.map((x, i) => ({ t: i - n + 1, o: rd(x.o * k, 2), h: rd(x.h * k, 2), l: rd(x.l * k, 2), c: rd(x.c * k, 2), v: x.v }));
}
function makePlayer(id, name, userId) {
  return { id, name, userId, cash: START_CASH, startCash: START_CASH, reserved: 0, holdings: {}, orders: [], orderKeys: {}, transactions: [], realized: 0, fees: 0, equity: [], reviews: [], concepts: {}, seq: 0, situations: [], sitSeq: 0, result: null };
}
function macroDisplay(m) {
  return { inflation: rd(5.2 + 2.2 * m.inflation, 1), rate: rd(6.5 + 1.0 * m.rates, 2), oil: rd(82 + 22 * m.oil, 1), consumer: Math.round(100 + 14 * m.consumer),
    rupee: rd(83 - 3 * m.currency, 2), trade: m.trade, regulation: m.regulation, tech: m.tech };
}


// ---- IPO plan: a few new companies come to market during the session. Hidden truth (quality, real value, demand, listing gain) is decided
// here from its own seed stream, so existing seeds keep producing exactly the same market. Nothing hidden is ever sent to the player.
const IPO_USE = ['to build a new plant and add capacity', 'to repay part of its debt', 'to launch new products', 'to open new regions', 'to fund research and technology', 'to buy back loans and strengthen its balance sheet'];
function planIpos(state) {
  const rng = new RNG('ipo:' + state.seed); const days = state.days; const count = days >= 40 ? 5 : days >= 20 ? 3 : days >= 10 ? 1 : 0;
  const lo = 3, hi = days - 3; if (!count || hi < lo) return [];
  const gap = Math.max(4, Math.floor((hi - lo + 1) / count)); let prevDay = 0; const usedNames = new Set(state.companies.map((c) => c.name)), usedTickers = new Set(state.companies.map((c) => c.ticker)); const out = [];
  for (let i = 0; i < count; i++) {
    const a = lo + i * gap; if (a > hi) break; const day = Math.max(rng.int(a, Math.min(hi, a + gap - 1)), prevDay + 3); if (day > hi) break; prevDay = day; // at least three days apart
    const ind = rng.pick(D.INDUSTRY_LIST); const c = genCompany(rng, ind, state.companies.length + i, usedNames, usedTickers);
    const r = rng.range(0, 1); const kind = r < 0.6 ? 'good' : r < 0.88 ? 'fair' : 'poor';
    const issuePrice = Math.max(40, Math.round(c.price / 5) * 5);
    if (kind === 'good' && c.fund.profit <= 0) c.fund.profit = Math.round(c.fund.revenue * rng.range(0.06, 0.14));
    if (kind === 'poor') { c.fund.profit = Math.round(c.fund.profit * 0.3); c.fund.debt = Math.round(c.fund.debt * 1.8); c.hid.health = Math.min(c.hid.health, 0.38); c.risk = 'High'; }
    const edge = kind === 'good' ? 0.05 + rng.normal() * 0.06 : kind === 'fair' ? rng.normal() * 0.07 : -0.14 + rng.normal() * 0.06;
    const finalSub = Math.exp((kind === 'good' ? Math.log(6) + rng.normal() * 0.8 : kind === 'fair' ? Math.log(2.5) + rng.normal() * 0.7 : Math.log(1.1) + rng.normal() * 0.5));
    const hype = 0.075 * Math.log(1 + finalSub); const listGain = Math.exp(edge + hype) - 1; const gmp = listGain * 0.75 + rng.normal() * 0.04;
    c.price = issuePrice; c.fv = issuePrice * Math.exp(edge); c.fv0 = c.fv; c.candles = []; c.ipo = true; c.issuePrice = issuePrice; c.listTick = (day - 1) * D.TPD + 1 + D.TPD;
    out.push({ id: 'ipo' + (i + 1), status: 'scheduled', openTick: (day - 1) * D.TPD + 1, closeTick: (day - 1) * D.TPD + D.TPD, listTick: (day - 1) * D.TPD + 1 + D.TPD, company: c,
      issuePrice, lotSize: issuePrice < 100 ? 40 : issuePrice < 180 ? 25 : issuePrice < 280 ? 15 : 10, lotsOffered: rng.int(8000, 24000), issueCr: Math.round(issuePrice * c.shares * rng.range(0.12, 0.25)), use: rng.pick(IPO_USE),
      kind, edge: rd(edge, 4), hype: rd(hype, 4), finalSub: rd(finalSub, 2), listGain: rd(listGain, 4), gmp: rd(gmp, 4), sub: 0, bids: {} });
  }
  return out;
}
function generateSession({ id, seed, duration = 'standard', nCompanies }, flavor = null) {
  const rng = new RNG('gen:' + seed);
  const dur = D.DURATIONS[duration] || D.DURATIONS.standard;
  const days = dur.days, total = days * D.TPD;
  const mkName = `${rng.pick(PREFIX)} ${rng.pick(SUFFIX)}`;
  const theme = rng.pick(D.THEMES);
  const n = nCompanies || rng.int(5, 10);
  // choose industries, making sure the theme's winners and losers are present
  let inds = [...new Set([...rng.shuffle(theme.hurt).slice(0, 2), ...rng.shuffle(theme.boost).slice(0, 2)])];
  const rest = rng.shuffle(D.INDUSTRY_LIST.filter((x) => !inds.includes(x)));
  while (inds.length < n && rest.length) inds.push(rest.shift());
  inds = rng.shuffle(inds).slice(0, n);
  const usedNames = new Set(), usedTickers = new Set();
  const companies = inds.map((ind, i) => genCompany(rng, ind, i, usedNames, usedTickers));
  const macro = {}; for (const f of D.FACTORS) macro[f] = rd(clamp(theme.macro[f] + rng.normal() * 0.12, -1, 1), 3);
  let title = theme.title;
  let bullets = theme.bullets.map((b) => b.replace(/\{coOf:([^}]+)\}/g, (m, ind) => (companies.find((c) => c.industry === ind) || { name: 'A leading firm' }).name));
  if (flavor) { // cosmetic only: names, descriptions, scenario wording. Never numbers.
    if (flavor.scenarioTitle) title = flavor.scenarioTitle;
    if (flavor.scenarioBullets) bullets = flavor.scenarioBullets;
    const used = new Set();
    for (const c of companies) {
      const f = (flavor.companies || []).find((x) => x.industry === c.industry && !used.has(x));
      if (f) { used.add(f); c.name = f.name; c.fullName = f.name; c.description = f.description; }
    }
    const tk = new Set(); for (const c of companies) c.ticker = makeTicker(c.name, tk);
  }
  // pre-game history (60 hours) so charts and indicators have something to analyse
  const HN = 60, market = []; { let m = 0; for (let i = 0; i < HN; i++) { m = m * 0.6 + rng.normal() * 0.004; market.push(m); } }
  for (const c of companies) { c.candles = genHistory(rng, c, market, HN); c.fv0 = c.fv; }
  const state = {
    v: 1, id, seed: String(seed), duration, days, totalTicks: total, tpd: D.TPD, tick: 0, status: 'active',
    marketName: mkName, indexName: mkName.split(' ')[0] + ' ' + n, theme: { title, bias: theme.bias, mood: theme.mood }, scenario: { title, bullets },
    macro, macro0: Object.assign({}, macro), companies, events: [], calendar: [], pubQueue: [], news: [], nextEventId: 1, mood: theme.mood, disputed: {},
    situations: [], index: { hist: [] }, flavor: flavor ? true : false, fallback: { active: false, reason: '', code: '' }, createdAt: Date.now(),
    players: { p1: makePlayer('p1', 'You', null) }, mode: 'solo', room: null, rev: 0,
  };
  // index history (cap weighted, base 1000 at start of play)
  const capAt = (i) => companies.reduce((s, c) => s + c.candles[i].c * c.shares, 0); const base = capAt(HN - 1);
  state.index.hist = Array.from({ length: HN }, (_, i) => ({ t: i - HN + 1, v: rd((1000 * capAt(i)) / base, 2) }));
  // events + news
  const pubs = scheduleEvents(state, rng);
  // opening background stories at tick 0
  const chans = ['marketline', 'dailypulse', 'undercurrent', 'flashwire'];
  bullets.forEach((b, i) => {
    const ch = chans[i % 4]; const fake = { kind: 'general', dir: 0, text: { fact: b }, links: {}, industries: [], coName: '' };
    let content = compose(ch === 'undercurrent' ? 'marketline' : ch, 'general', fake);
    if (ch === 'undercurrent') content = { label: 'Analysis', headline: `Behind the headlines: ${b.replace(/\.$/, '')}`, body: `Nadia Voss: "We have been tracking this for weeks. ${b}"` };
    pubs.push({ id: `init-${i}`, eventId: null, channel: ch, tick: 0, minute: rng.int(0, 59), treatment: 'background', headline: content.headline, body: content.body, label: 'Background',
      tags: { companies: [], industries: [], category: 'Economy', tag: 'Background' }, claim: {}, corrects: [], weight: 0, breaking: false, confirms: null });
  });
  pubs.sort((a, b) => a.tick - b.tick || a.minute - b.minute);
  state.pubQueue = pubs;
  state.ipos = planIpos(state);
  return state;
}
module.exports = { generateSession, macroDisplay, makePlayer, START_CASH, makeTicker };
