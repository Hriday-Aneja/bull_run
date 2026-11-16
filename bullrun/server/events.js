'use strict';
// Events hold the ACTUAL TRUTH. News plans are separate: what each channel will say about it, and when.
const { RNG } = require('./rng');
const D = require('./data');
const { CHANNELS, compose } = require('./news');

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rd = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const mid = (a) => (a[0] + a[1]) / 2;
const fill = (t, vars) => (t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
const byId = (state, id) => state.companies.find((c) => c.id === id);

// Company-specific vulnerability: debt, thin cash and weak management make bad news hurt more; quality and growth amplify good news.
function modifier(c, base) {
  const debtR = c.fund.debt / Math.max(1, c.fund.revenue), cashR = c.fund.cash / Math.max(1, c.fund.revenue);
  const m = c.hid.mgmt, g = c.hid.growth;
  return base < 0 ? clamp(1 + debtR * 0.4 - cashR * 0.5 - (m - 0.5) * 0.5, 0.55, 1.6) : clamp(1 + (m - 0.5) * 0.5 + g * 1.0, 0.6, 1.5);
}
function newEvent(state, o) {
  const id = 'E' + String(state.nextEventId++).padStart(3, '0');
  const ev = Object.assign({ id, kind: 'general', category: 'General', tick: 1, dir: 1, tag: '', text: {}, coName: '', companies: [], industries: [], impact: {}, claim: {},
    lag: 1, dur: 3, realized: {}, belief: {}, hidden: false, confirmed: false, denied: false, real: true, done: false, material: false }, o);
  ev.material = Object.values(ev.impact).some((v) => Math.abs(v) >= 0.02);
  return ev;
}

function companyEvent(state, rng, spec, c, tick, isRumor) {
  const mag = rng.range(spec.imp[0], spec.imp[1]);
  const vars = { co: c.name };
  const ev = newEvent(state, { kind: isRumor ? 'rumor' : 'company', category: 'Company', typeId: spec.id, tick, dir: spec.dir, tag: spec.tag, coName: c.name,
    text: { fact: fill(spec.fact, vars), rumor: fill(spec.rumor, vars), deny: fill(spec.deny, vars), ctx: spec.ctx },
    companies: [c.id], industries: [c.industry], real: !isRumor, hidden: !isRumor && rng.chance(spec.hid || 0),
    lag: rng.int(spec.lag[0], spec.lag[1]), dur: rng.int(spec.dur[0], spec.dur[1]) });
  if (isRumor) { ev.claim[c.id] = rd(spec.dir * mid(spec.imp)); ev.material = true; }
  else { ev.impact[c.id] = rd(spec.dir * mag * modifier(c, spec.dir)); ev.claim[c.id] = ev.impact[c.id]; ev.material = Math.abs(ev.impact[c.id]) >= 0.02; }
  return ev;
}
// Stage 1 of a "too good to be true" arc: a big claim. The price rises on belief alone, so the event has a claim but no real impact.
function hypeEvent(state, rng, arc, c, tick) {
  const spec = arc.hype; const mag = rng.range(spec.imp[0], spec.imp[1]); const vars = { co: c.name };
  const ev = newEvent(state, { kind: 'company', category: 'Company', typeId: 'hype_' + arc.id, tick, dir: 1, tag: spec.tag, coName: c.name,
    text: { fact: fill(spec.fact, vars), rumor: fill(spec.rumor, vars), deny: fill(spec.deny, vars), ctx: spec.ctx }, companies: [c.id], industries: [c.industry], hidden: false,
    lag: 1, dur: 3, hype: true, arc: { id: arc.id, stage: 1 } });
  ev.claim[c.id] = rd(mag); ev.material = false; ev.confirmed = true; // nothing real behind it (no impact), yet the market takes the company at its word, so the belief lingers until the exposure
  return ev;
}
// Stage 2: the government or a regulator finds the claim was a scam, and the price falls hard. Often hinted at first by a leak.
function fraudFallEvent(state, rng, arc, c, tick, hype) {
  const spec = arc.fall; const mag = rng.range(spec.imp[0], spec.imp[1]); const vars = { co: c.name };
  const ev = newEvent(state, { kind: 'company', category: 'Company', typeId: 'fraud_' + arc.id, tick, dir: -1, tag: spec.tag, coName: c.name,
    text: { fact: fill(spec.fact, vars), rumor: fill(spec.rumor, vars), deny: fill(spec.deny, vars), ctx: spec.ctx }, companies: [c.id], industries: [c.industry], hidden: rng.chance(0.7),
    lag: rng.int(0, 1), dur: rng.int(2, 3), refutes: hype.id, arc: { id: arc.id, stage: 2 } });
  // a fraud finding hits every company hard, strong balance sheet or not
  ev.impact[c.id] = rd(-Math.min(0.7, mag * Math.max(1, modifier(c, -1))));
  ev.claim[c.id] = ev.impact[c.id]; ev.material = true;
  return ev;
}
function macroEvent(state, rng, spec, tick) {
  const mag = rng.range(spec.mag[0], spec.mag[1]);
  const ev = newEvent(state, { kind: 'macro', category: 'Economy', typeId: spec.id, tick, dir: spec.d, tag: spec.tag, text: { fact: spec.fact, rumor: spec.rumor, deny: spec.deny, ctx: spec.ctx },
    lag: rng.int(1, 4), dur: rng.int(4, 10), macroDelta: spec.f ? { f: spec.f, delta: rd(spec.d * mag * 0.35) } : null });
  if (spec.f) {
    for (const c of state.companies) {
      const base = D.INDUSTRIES[c.industry].sens[spec.f] * spec.d * mag * 0.07;
      if (Math.abs(base) < 0.004) continue;
      ev.claim[c.id] = rd(base); ev.impact[c.id] = rd(base * modifier(c, base)); ev.companies.push(c.id);
    }
    ev.industries = [...new Set(ev.companies.map((id) => byId(state, id).industry))];
  }
  ev.material = Object.values(ev.impact).some((v) => Math.abs(v) >= 0.02);
  return ev;
}
function industryEvent(state, rng, spec, ind, tick) {
  const mag = rng.range(spec.imp[0], spec.imp[1]);
  const ev = newEvent(state, { kind: 'industry', category: 'Industry', typeId: spec.id, tick, dir: spec.dir, tag: spec.tag, industries: [ind],
    text: { fact: fill(spec.fact, { ind }), rumor: fill(spec.rumor, { ind }), deny: fill(spec.deny, { ind }), ctx: spec.ctx }, lag: rng.int(1, 4), dur: rng.int(3, 8) });
  for (const c of state.companies.filter((x) => x.industry === ind)) {
    ev.claim[c.id] = rd(spec.dir * mid(spec.imp)); ev.impact[c.id] = rd(spec.dir * mag * modifier(c, spec.dir)); ev.companies.push(c.id);
  }
  ev.material = Object.values(ev.impact).some((v) => Math.abs(v) >= 0.02);
  return ev;
}
function generalEvent(state, rng, spec, tick) {
  const ev = newEvent(state, { kind: 'general', category: 'General', typeId: 'general', tick, tag: spec.tag, text: { fact: spec.fact, rumor: spec.fact, deny: spec.fact, ctx: '' }, lag: rng.int(1, 3), dur: rng.int(2, 5), links: {} });
  for (const [ind, v] of Object.entries(spec.links)) {
    const cos = state.companies.filter((c) => c.industry === ind); if (!cos.length) continue;
    ev.links[ind] = v; ev.industries.push(ind);
    for (const c of cos) { const x = rd(v * rng.range(0.8, 1.2)); ev.impact[c.id] = x; ev.claim[c.id] = x; ev.companies.push(c.id); }
  }
  ev.dir = Object.values(ev.impact).reduce((a, b) => a + b, 0) >= 0 ? 1 : -1;
  ev.material = Object.values(ev.impact).some((v) => Math.abs(v) >= 0.02);
  return ev;
}
function policyEvent(state, rng, tick) {
  const m = state.macro; const infl = m.inflation, r = m.rates;
  const pUp = 0.15 + 0.35 * Math.max(0, infl) + 0.15 * Math.max(0, r), pDn = 0.12 + 0.35 * Math.max(0, -infl) + 0.2 * Math.max(0, -r);
  const x = rng.next();
  if (x < pUp) return macroEvent(state, rng, D.MACRO_EVENTS.find((e) => e.id === 'rates_up'), tick);
  if (x < pUp + pDn) return macroEvent(state, rng, D.MACRO_EVENTS.find((e) => e.id === 'rates_down'), tick);
  return newEvent(state, { kind: 'macro', category: 'Economy', typeId: 'rates_hold', tick, dir: 0, tag: 'Interest rates',
    text: { fact: 'The central bank holds its key interest rate steady, as widely expected', rumor: 'The central bank is expected to leave rates unchanged', deny: 'The central bank says rates are unchanged', ctx: 'A pause means borrowing costs stay where they are. Markets mostly expected it, so the reaction is usually small.' } });
}

// ---- News planning: decide who reports what, when, and how accurately -------------------------------------------------
// Remembers each event's news so a later story can refute an earlier one (the scam exposure refutes the hype).
function planNews(state, ev, rng) {
  const pubs = planNewsCore(state, ev, rng);
  if (state._pubsByEvent) state._pubsByEvent[ev.id] = pubs;
  if (ev.refutes) { const old = (state._pubsByEvent && state._pubsByEvent[ev.refutes]) || []; for (const p of pubs) { p.refutes = ev.refutes; p.corrects = (p.corrects || []).concat(old.filter((o) => o.channel === 'flashwire' || o.channel === 'undercurrent').map((o) => o.id)); } } // only the loud channels get marked as wrong
  return pubs;
}
function planNewsCore(state, ev, rng) {
  const total = state.totalTicks; const pubs = []; const T = ev.tick;
  const mk = (channel, tick, treat, factor, o = {}) => {
    const t = clamp(Math.round(tick), 0, total + 6);
    const claim = {}; if (factor !== null) for (const c in ev.claim) claim[c] = rd(ev.claim[c] * factor);
    const content = compose(channel, treat, ev);
    const pub = { id: `${ev.id}-${channel}-${treat}`, eventId: ev.id, channel, tick: t, minute: rng.int(0, 59), treatment: treat, headline: content.headline, body: content.body, label: content.label,
      tags: { companies: ev.companies.slice(), industries: ev.industries.slice(), category: ev.category, tag: ev.tag }, claim, corrects: o.corrects || [],
      weight: o.weight || CHANNELS[channel].reach, breaking: !!o.breaking, confirms: o.confirms || null };
    pubs.push(pub); return pub;
  };
  const isCo = ev.kind === 'company' || ev.kind === 'earnings';
  const maxClaim = Math.max(0, ...Object.values(ev.claim).map(Math.abs));
  if (ev.kind === 'rumor') {
    const f = mk('flashwire', T, 'unverified', 1.6, { breaking: true });
    const u = rng.chance(0.5) ? mk('undercurrent', T + rng.int(1, 2), 'echo', 0.7) : null;
    if (rng.chance(0.2)) mk('dailypulse', T + rng.int(1, 3), 'chatter', 0.2);
    const dTick = T + rng.int(3, 7);
    mk('marketline', dTick, 'denial', 0, { corrects: [f.id].concat(u ? [u.id] : []), weight: 0.85, confirms: 'no', breaking: true });
    if (rng.chance(0.35)) mk('flashwire', dTick + rng.int(2, 4), 'retraction', 0, { corrects: [f.id], weight: 0.7, confirms: 'no' });
    return pubs;
  }
  if (ev.kind === 'general') {
    mk('dailypulse', T, 'general', 1, { confirms: 'yes' });
    if (rng.chance(0.25)) mk('flashwire', T, 'general', 1);
    if (Object.keys(ev.claim).length && rng.chance(0.25)) mk('marketline', T + 2, 'general', 1);
    return pubs;
  }
  if (ev.hype) { // MARKETLINE only reports what it can verify, so it stays silent on a big claim; the loud channels run with it, which is the warning sign players can learn to spot
    const treat = rng.chance(0.55) ? 'exaggerated' : 'accurate';
    mk('flashwire', T + (rng.chance(0.7) ? 0 : 1), treat, treat === 'exaggerated' ? 1.7 : 1.2, { breaking: true });
    mk('dailypulse', T + rng.int(1, 3), 'casual', 0.5);
    return pubs;
  }
  let flash = null;
  const pF = isCo ? 0.75 : ev.kind === 'macro' ? 0.6 : 0.5;
  if (ev.material && rng.chance(pF) && ev.typeId !== 'rates_hold') {
    const treat = rng.weighted(['accurate', 'exaggerated', 'misleading', 'unverified'], (t) => ({ accurate: 0.5, exaggerated: 0.25, misleading: 0.12, unverified: 0.13 }[t]));
    const fac = { accurate: 1, exaggerated: 1.8, misleading: 1.3, unverified: 0.9 }[treat];
    flash = mk('flashwire', T + (rng.chance(0.7) ? 0 : 1), treat, fac, { breaking: true });
    if (treat === 'exaggerated' || treat === 'misleading') ev.flashExag = true;
  }
  if (ev.material && ev.kind !== 'earnings' && rng.chance(ev.hidden ? 0.85 : isCo ? 0.55 : 0.35)) {
    if (ev.hidden && ev.kind === 'company') mk('undercurrent', T - rng.int(2, 6), 'leak', 0.8);
    else { const r = rng.next(); const tk = T + rng.int(1, 3); if (r < 0.7) mk('undercurrent', tk, 'sources', 0.9); else if (r < 0.88) mk('undercurrent', tk, 'misread_over', 1.5); else mk('undercurrent', tk, 'misread_wrong', -0.4); }
  }
  if (ev.material || rng.chance(0.5)) {
    const delay = ev.kind === 'earnings' ? rng.int(0, 1) : isCo ? rng.int(2, 5) : rng.int(1, 3);
    const corrects = ev.flashExag && flash ? [flash.id] : [];
    mk('marketline', T + delay, ev.material ? 'accurate' : 'general', 1, { corrects, weight: corrects.length ? 0.85 : 0.6, confirms: 'yes', breaking: maxClaim >= 0.06 });
  }
  if (rng.chance(isCo ? 0.3 : ev.kind === 'macro' ? 0.65 : 0.5)) mk('dailypulse', T + rng.int(1, 4), 'casual', 0.3);
  if (!pubs.length) mk('marketline', T + 1, 'general', 1, { confirms: 'yes' });
  return pubs;
}

// ---- Earnings resolve at the moment they happen (uses the company's hidden quality + what has happened since the start) ----
function resolveEarnings(state, ev) {
  const c = byId(state, ev.companies[0]); const rng = RNG.derive(state.seed, 'earn', ev.id);
  const drift = clamp(Math.log(c.fv / c.fv0), -0.1, 0.1);
  const s = clamp((c.hid.health - 0.55) * 0.10 + (c.hid.mgmt - 0.5) * 0.06 + c.hid.growth * 0.15 + rng.normal() * 0.035 + drift * 0.2, -0.14, 0.14);
  const base = Math.max(Math.abs(c.fund.profit), c.fund.revenue * 0.02);
  const expected = c.fund.profit + (base * c.hid.growth) / 4;
  const reported = expected + base * s * 2.5;
  const revNew = c.fund.revenue * (1 + c.hid.growth / 4 + s * 0.8);
  const f0 = (x) => Math.round(x).toLocaleString('en-IN');
  const word = s > 0.015 ? 'beating' : s < -0.015 ? 'missing' : 'in line with';
  const pTxt = reported >= 0 ? `profit of ₹${f0(reported)} crore` : `a loss of ₹${f0(-reported)} crore`;
  ev.dir = s >= 0 ? 1 : -1;
  ev.text = { fact: `${c.name} reports ${pTxt}, ${word} expectations of ₹${f0(expected)} crore`,
    rumor: `${c.name} results may ${s >= 0 ? 'beat' : 'disappoint'}, say analysts`, deny: `${c.name} results are in line with expectations`,
    ctx: `Revenue came in at ₹${f0(revNew)} crore. ${s > 0.015 ? 'Management pointed to strong demand and cost control.' : s < -0.015 ? 'Management blamed higher costs and slower demand.' : 'Management reiterated its outlook.'} Markets react to results versus expectations, not just the numbers.` };
  ev.impact[c.id] = rd(s); ev.claim[c.id] = rd(s); ev.lag = 0; ev.dur = 3; ev.material = Math.abs(s) >= 0.02;
  ev.earnings = { revenue: Math.round(revNew), profit: Math.round(reported), expected: Math.round(expected), surprise: rd(s) };
  c.fund.prevRevenue = c.fund.revenue; c.fund.prevProfit = c.fund.profit;
  c.fund.revenue = Math.round(revNew); c.fund.profit = Math.round(reported); c.fund.cash = Math.max(1, Math.round(c.fund.cash + reported * 0.25));
  c.lastEarnings = { tick: ev.tick, surprise: rd(s), reported: Math.round(reported), expected: Math.round(expected) };
  return planNews(state, ev, rng);
}

function scheduleStories(state, r) {
  const days = state.days, total = state.totalTicks; const out = []; const T = () => r.int(2, Math.max(3, total - 3));
  for (let i = 0, n = Math.round(days * 0.5); i < n; i++) { // scandals and good press about a company's leaders and reputation
    const c = r.pick(state.companies); const specs = D.PEOPLE_EVENTS.filter((s) => !s.inds || s.inds.includes(c.industry));
    out.push(companyEvent(state, r, r.weighted(specs, (s) => s.w), c, T(), false));
  }
  const used = new Set(); const nArc = Math.floor(days / 15) + (r.chance(0.55) ? 1 : 0);
  for (let i = 0; i < nArc; i++) { // hype, then the government exposes it as a scam
    const options = []; for (const arc of D.FRAUD_ARCS) for (const c of state.companies) if (!used.has(c.id) && (!arc.inds || arc.inds.includes(c.industry))) options.push([arc, c]);
    if (!options.length) break; const [arc, c] = r.pick(options); used.add(c.id);
    const gap = r.int(8, 20); const t1 = r.int(3, Math.max(3, total - gap - 7)); if (t1 + gap > total - 6) continue;
    const hype = hypeEvent(state, r, arc, c, t1); out.push(hype, fraudFallEvent(state, r, arc, c, t1 + gap, hype));
  }
  return out;
}

// ---- Schedule an entire session of events from the seed -------------------------------------------------------------
function scheduleEvents(state, rng) {
  const days = state.days, total = state.totalTicks, theme = state.theme; const bias = theme.bias || {};
  const present = [...new Set(state.companies.map((c) => c.industry))];
  const T = () => rng.int(2, Math.max(3, total - 3));
  const out = [];
  const nCo = Math.round(days * 1.1), nMacro = Math.round(days * 0.5) + 1, nInd = Math.round(days * 0.4), nRum = Math.round(days * 0.45), nGen = Math.round(days * 1.2);
  for (let i = 0; i < nCo; i++) {
    const c = rng.pick(state.companies);
    const specs = D.CO_EVENTS.filter((s) => !s.inds || s.inds.includes(c.industry));
    const spec = rng.weighted(specs, (s) => s.w * (bias[s.id] || 1) * (s.dir < 0 ? 1 : (theme.mood > 0 ? 1.2 : 0.9)));
    out.push(companyEvent(state, rng, spec, c, T(), false));
  }
  for (let i = 0; i < nMacro; i++) out.push(macroEvent(state, rng, rng.weighted(D.MACRO_EVENTS, (s) => bias[s.id] || 1), T()));
  for (let i = 0; i < nInd; i++) {
    const specs = D.INDUSTRY_EVENTS.filter((s) => (s.only ? present.includes(s.only) : true));
    const spec = rng.weighted(specs, (s) => bias[s.id] || 1);
    const pool = spec.only ? [spec.only] : (spec.inds ? present.filter((x) => spec.inds.includes(x)) : present);
    if (!pool.length) continue;
    out.push(industryEvent(state, rng, spec, rng.pick(pool), T()));
  }
  for (let i = 0; i < nRum; i++) {
    const c = rng.pick(state.companies);
    const specs = D.CO_EVENTS.filter((s) => !s.inds || s.inds.includes(c.industry));
    out.push(companyEvent(state, rng, rng.weighted(specs, (s) => s.w), c, rng.int(2, Math.max(3, total - 9)), true));
  }
  for (let i = 0; i < nGen; i++) out.push(generalEvent(state, rng, rng.pick(D.GENERAL), T()));
  // Policy meetings every 5 trading days, earnings every ~10 days per company: both public on the calendar.
  for (let d = 5; d <= days; d += 5) { const tk = (d - 1) * D.TPD + 4; const ev = policyEvent(state, rng, tk); out.push(ev); state.calendar.push({ tick: tk, kind: 'policy', label: 'Central bank policy decision', eventId: ev.id }); }
  const rounds = Math.floor(days / 10);
  for (const c of state.companies) for (let k = 1; k <= rounds; k++) {
    const day = k * 10 - rng.int(1, 4), tk = (day - 1) * D.TPD + rng.int(1, D.TPD);
    const ev = newEvent(state, { kind: 'earnings', category: 'Company', typeId: 'earnings', tick: tk, tag: 'Earnings', coName: c.name, companies: [c.id], industries: [c.industry] });
    out.push(ev); state.calendar.push({ tick: tk, kind: 'earnings', companyId: c.id, label: `${c.name} quarterly results`, eventId: ev.id });
  }
  // Everyday people news and "too good to be true" scam arcs. They use their own random stream, so the events above are unchanged, and they vary in every game.
  out.push(...scheduleStories(state, RNG.derive(state.seed, 'stories')));
  out.sort((a, b) => a.tick - b.tick);
  state.events = out;
  state.calendar.sort((a, b) => a.tick - b.tick);
  // Plan news for everything except earnings (resolved when they happen).
  const pubs = []; state._pubsByEvent = {};
  for (const ev of out) if (ev.kind !== 'earnings') pubs.push(...planNews(state, ev, RNG.derive(state.seed, 'news', ev.id)));
  delete state._pubsByEvent;
  return pubs;
}
module.exports = { scheduleEvents, resolveEarnings, planNews, clamp, rd, byId };
