'use strict';
// Decision Intelligence. All local and rule-based, so it works with no AI. It judges PROCESS (what you could know at the time)
// separately from OUTCOME (what luck delivered), so a good decision with a bad result is still rewarded.
const D = require('./data');
const TPD = D.TPD;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dayOf = (t) => Math.floor((t - 1) / TPD) + 1;
const candleAt = (c, t) => c.candles[t - c.candles[0].t] || c.candles[c.candles.length - 1];
const evOf = (state, id) => state.events.find((e) => e.id === id);
const fmtINR = (x) => '₹' + Math.round(x).toLocaleString('en-IN');

function unlock(p, id, tick) { if (!p.concepts[id]) p.concepts[id] = { tick }; }
function concept(id) { return { id, title: D.CONCEPTS[id][0], text: D.CONCEPTS[id][1] }; }

const blockedIpo = (state, p) => (state.ipos || []).reduce((a, i) => { const b = i.bids && i.bids[p.id]; return b && b.status !== 'done' ? a + b.amount : a; }, 0);
function netWorth(state, p) { return p.cash + blockedIpo(state, p) + Object.entries(p.holdings).reduce((s, [id, h]) => s + h.qty * state.companies.find((c) => c.id === id).price, 0); }

function evaluateTrade(state, p, tx, c, nwBefore, orderType) {
  const t = state.tick, side = tx.side; const flags = []; let score = 70; const consider = []; const learned = new Set();
  const h = p.holdings[c.id]; const nwAfter = netWorth(state, p);
  const weightAfter = h ? (h.qty * c.price) / nwAfter : 0; const pct = tx.value / Math.max(1, nwBefore);
  const holdingsAfter = Object.keys(p.holdings).length;
  const ret8 = c.price / candleAt(c, t - 8).c - 1, ret6 = c.price / candleAt(c, t - 6).c - 1;
  const recent = state.news.filter((n) => n.tick >= t - 5 && n.tags.companies.includes(c.id) && n.claim && n.claim[c.id] !== undefined && n.treatment !== 'background');
  const dirSign = side === 'buy' ? 1 : -1;
  const unverified = recent.some((n) => ['flashwire', 'undercurrent'].includes(n.channel) && Math.sign(n.claim[c.id]) === dirSign && Math.abs(n.claim[c.id]) >= 0.02 && (() => { const ev = n.eventId && evOf(state, n.eventId); return ev && !ev.confirmed && !ev.denied; })());
  const verified = state.news.some((n) => n.tick >= t - 10 && n.channel === 'marketline' && n.tags.companies.includes(c.id) && ['accurate', 'denial'].includes(n.treatment));
  const confirmedBad = state.news.some((n) => n.tick >= t - 10 && n.channel === 'marketline' && n.treatment === 'accurate' && n.tags.companies.includes(c.id) && n.claim[c.id] < -0.02);
  const tradesToday = p.transactions.filter((x) => dayOf(x.tick) === dayOf(t)).length;
  const add = (kind, id, text, delta, conc, tip) => { flags.push({ kind, id, text }); score += delta; if (conc) learned.add(conc); if (tip) consider.push(tip); };
  if (side === 'buy' && weightAfter > 0.5) add('warn', 'concentration', `After this buy, ${Math.round(weightAfter * 100)}% of your portfolio is in one company.`, -20, 'concentration_risk', 'How much of your portfolio would you be comfortable losing on a single surprise?');
  else if (side === 'buy' && weightAfter > 0.35) add('warn', 'concentration', `This leaves ${Math.round(weightAfter * 100)}% of your portfolio in one company.`, -8, 'concentration_risk', 'Would spreading this across another industry reduce your risk?');
  if (side === 'buy' && pct > 0.6) add('warn', 'size', `This single order was ${Math.round(pct * 100)}% of your whole portfolio.`, -10, 'risk_management', 'What is the most you are willing to lose on this idea?');
  if (unverified) add('warn', 'verification', 'You acted in the direction of a report that no careful source had confirmed yet.', -15, 'verification', 'Did a second source, such as MARKETLINE or the company itself, confirm this story?');
  else if (verified) add('good', 'verified', 'You traded after a verified report was available on this company.', 8, 'verification');
  if (side === 'buy' && ret8 >= 0.1) add('warn', 'fomo', `You bought after the price had already risen ${Math.round(ret8 * 100)}% in a short time.`, -12, 'fomo', 'What has changed in the business, beyond the price? How much of the good news is already priced in?');
  if (side === 'sell' && ret6 <= -0.08 && !confirmedBad) add('warn', 'panic', `You sold after a ${Math.round(-ret6 * 100)}% drop without confirmed bad news about the company.`, -15, 'panic_selling', 'Is the fall explained by company news, or by market mood that may fade?');
  else if (side === 'sell' && confirmedBad) add('good', 'confirmed_exit', 'You sold after the bad news was confirmed, not on a rumour.', 5, null);
  if (tradesToday >= 5) add('warn', 'overtrading', `This was your ${tradesToday}th trade today; fees and spreads add up.`, -10, 'overtrading', 'Would fewer, better-researched trades do the same job at lower cost?');
  if (tx.qty > 0.2 * c.advTick) add('warn', 'liquidity', 'This order was large compared with normal trading volume, so you paid extra for it.', -8, 'liquidity', 'Could you split the order or choose a more liquid stock?');
  if (side === 'buy' && pct <= 0.25 && holdingsAfter >= 3) add('good', 'diversified', 'The order is modest in size and your portfolio spans several companies.', 8, 'diversification');
  if (side === 'buy' && p.cash / nwAfter < 0.05) add('warn', 'cash', 'You have almost no cash left, which limits your options if opportunities or emergencies appear.', -4, 'opportunity_cost', 'Do you want to keep some cash ready for opportunities?');
  if (orderType === 'stop') learned.add('stop_loss');
  learned.add('fees');
  score = clamp(Math.round(score), 0, 100);
  for (const id of learned) unlock(p, id, t);
  const review = { id: 'R' + (p.reviews.length + 1), tick: t, txId: tx.id, side, ticker: c.ticker, companyId: c.id, qty: tx.qty, price: tx.price, value: tx.value,
    pctOfPortfolio: Math.round(pct * 100), flags, consider, concepts: [...learned].filter((x) => x !== 'fees' || flags.length === 0).map(concept),
    process: score, outcome: null, status: 'open', verdict: null, summary: '' };
  review.summary = `You ${side === 'buy' ? 'bought' : 'sold'} ${tx.qty} shares of ${c.name} for ${fmtINR(tx.value)} (${review.pctOfPortfolio}% of your portfolio).` +
    (flags.length ? '' : ' Nothing unusual about the way this trade was set up.');
  p.reviews.push(review);
  return review;
}
function verdictFor(process, outcome) {
  const sound = process >= 65, good = outcome >= 0.01, bad = outcome <= -0.01;
  if (sound && bad) return { id: 'unlucky', title: 'Sound decision, unlucky outcome', text: 'Your reasoning held up with what was knowable at the time. A loss here does not mean the decision was wrong; markets surprise even good decisions. Keep making decisions like this one.' };
  if (sound && good) return { id: 'skill', title: 'Well-judged, and it worked', text: 'A careful setup and a good result. The process deserves the credit, not just the result.' };
  if (!sound && good) return { id: 'lucky', title: 'Profitable, but partly luck', text: 'This worked out, but the setup had gaps. Repeating a risky process usually fails eventually, so do not mistake luck for skill.' };
  if (!sound && bad) return { id: 'lesson', title: 'A costly lesson', text: 'The setup had avoidable weaknesses and the outcome hurt. This is exactly the kind of trade worth reviewing.' };
  return { id: 'flat', title: 'No clear outcome yet', text: sound ? 'The process looked sound and the price has not moved much since.' : 'The price has not moved much since, but the process had gaps worth fixing.' };
}
function updateReviews(state, p, force) {
  for (const r of p.reviews) {
    if (r.status === 'done') continue;
    const c = state.companies.find((x) => x.id === r.companyId);
    const move = c.price / r.price - 1;
    r.outcome = Math.round((r.side === 'buy' ? move : -move) * 1000) / 1000;
    if (state.tick - r.tick >= 14 || force) { r.status = 'done'; r.verdict = verdictFor(r.process, r.outcome); }
  }
}

// ---- Situations: short "what is going on and why" cards, generated as events unfold ----------------------------------
function addSit(p, state, key, o) {
  if (p.situations.some((s) => s.key === key)) return;
  p.sitSeq = (p.sitSeq || 0) + 1;
  p.situations.push(Object.assign({ id: 'S' + p.sitSeq, key, tick: state.tick }, o));
  if (p.situations.length > 80) p.situations.shift();
}
function newsFor(state, c, since) { return state.news.filter((n) => n.tick >= since && n.tags.companies.includes(c.id) && n.treatment !== 'background').slice(-4); }
function detectSituations(state) { for (const p of Object.values(state.players)) detectFor(state, p); }
function detectFor(state, p) {
  const t = state.tick, d = dayOf(t);
  for (const c of state.companies) {
    const prevClose = candleAt(c, (d - 1) * TPD).c; const ch = c.price / prevClose - 1; const mine = !!p.holdings[c.id];
    if (Math.abs(ch) >= 0.1) {
      const down = ch < 0; const related = newsFor(state, c, t - 12);
      addSit(p, state, `move:${c.id}:${d}:${down ? 'd' : 'u'}`, {
        kind: down ? 'drop' : 'surge', companyId: c.id, mine,
        title: `${c.ticker} is ${down ? 'down' : 'up'} ${Math.abs(Math.round(ch * 100))}% today`,
        body: down
          ? 'A drop this size usually has a reason: company news, bad results, an industry shock, or a wave of fear. A falling price does not automatically mean a bargain; it may be the market pricing in something real.'
          : 'A jump this large can mean real good news, or speculation chasing a rising price. Quick gains can reverse just as quickly when excitement cools, especially if the business has not changed.',
        related: related.map((n) => ({ id: n.id, channel: n.channel, headline: n.headline })),
        investigate: down ? ['Read the latest news on this company and compare channels.', 'Check its debt and cash: can it handle a bad patch?', 'Ask what would make you wrong before buying more.']
          : ['Is there verified news behind the rise, or just chatter?', 'How does the price compare with profit (P/E)?', 'Decide where you would take profits or cut losses.'],
        concepts: [down ? concept('falling_knife') : concept('momentum'), concept('sentiment')],
      });
    }
    const h = p.holdings[c.id];
    if (h && c.price / (h.cost / h.qty) - 1 <= -0.15) addSit(p, state, `unreal:${c.id}`, { kind: 'unrealized', companyId: c.id, mine: true, title: `Your ${c.ticker} position is down ${Math.round((1 - c.price / (h.cost / h.qty)) * 100)}%`,
      body: 'This is an unrealized loss: it only becomes final if you sell. The useful question is not "how do I get back to even?" but "would I buy this today at this price?"', related: [], investigate: ['Has the story that made you buy changed?', 'Would you buy it today?'], concepts: [concept('unrealized'), concept('risk_management')] });
    if (h) { const w = (h.qty * c.price) / netWorth(state, p); if (w > 0.6) { addSit(p, state, `conc:${c.id}`, { kind: 'concentration', companyId: c.id, mine: true, title: `${c.ticker} is ${Math.round(w * 100)}% of your portfolio`,
      body: 'When one company dominates your portfolio, its fortunes become yours. A single surprise can swing your total result.', related: [], investigate: ['Would trimming the position let you sleep better?', 'Is another industry worth a small position?'], concepts: [concept('concentration_risk'), concept('diversification')] }); unlock(p, 'concentration_risk', t); } }
  }
  const hist = state.index.hist; const now = hist[hist.length - 1].v, back = (hist[hist.length - 1 - TPD] || hist[0]).v; const ir = now / back - 1;
  if (ir <= -0.04) addSit(p, state, `crash:${Math.floor(t / 10)}`, { kind: 'crash', title: `Market-wide sell-off: the index is down ${Math.abs(ir * 100).toFixed(1)}% this week`,
    body: 'When many stocks fall together, even strong companies drop. Diversification helps less than usual. What matters now is how much of your money is exposed, and whether you are forced to sell at the worst moment.', related: [], investigate: ['What share of your portfolio is in stocks versus cash?', 'Which holdings have the weakest balance sheets?'], concepts: [concept('market_crash'), concept('risk_management'), concept('diversification')] });
  if (ir >= 0.04) addSit(p, state, `rally:${Math.floor(t / 10)}`, { kind: 'rally', title: `Broad rally: the index is up ${(ir * 100).toFixed(1)}% this week`,
    body: 'Rising markets lift most stocks, which can make everyone look skilled. Be careful not to mistake a rising tide for your own judgement.', related: [], investigate: ['How much of your gain is the market, and how much is your picks?'], concepts: [concept('sentiment'), concept('momentum')] });
}
function earningsSituation(state, ev) {
  const c = state.companies.find((x) => x.id === ev.companies[0]); const e = ev.earnings; if (!c || !e) return;
  for (const p of Object.values(state.players)) addSit(p, state, `earn:${ev.id}`, { kind: 'earnings', companyId: c.id, mine: !!p.holdings[c.id], title: `${c.ticker} reports results`,
    body: `Profit came in at ₹${e.profit.toLocaleString('en-IN')} crore against expectations of ₹${e.expected.toLocaleString('en-IN')} crore. Revenue is what a company sells; profit is what is left after costs. Prices move on results versus expectations, so even a profit can disappoint, and a loss can still surprise positively.`,
    related: [], investigate: ['Compare revenue and profit with the previous figures in the company panel.', 'Check debt and cash: how much cushion does it have?'], concepts: [concept('earnings'), concept('debt'), concept('valuation')] });
}
function unverifiedSituation(state, pub, c) {
  for (const p of Object.values(state.players)) addSit(p, state, `unv:${pub.eventId}`, { kind: 'unverified', companyId: c.id, mine: !!p.holdings[c.id], title: `Unconfirmed report about ${c.ticker}`,
    body: 'A channel is reporting something it has not confirmed. Early reports are sometimes right, sometimes exaggerated, sometimes wrong. The price may react anyway, which is exactly why checking matters.',
    related: [{ id: pub.id, channel: pub.channel, headline: pub.headline }], investigate: ['Is a more careful channel reporting the same thing?', 'Has the company confirmed or denied it?', 'What is the cost of waiting an hour for more information?'], concepts: [concept('verification'), concept('sentiment')] });
}
// A big claim, and later the government's finding. Players holding the stock get the lesson at the moment it matters.
function arcSituation(state, pub, ev, c) {
  const stage = ev.arc.stage; const rel = [{ id: pub.id, channel: pub.channel, headline: pub.headline }];
  for (const p of Object.values(state.players)) {
    if (stage === 1) addSit(p, state, `hype:${ev.id}`, { kind: 'hype', companyId: c.id, mine: !!p.holdings[c.id], title: `A big claim from ${c.ticker}`, body: 'A company has announced something amazing. Prices often jump on a claim before anyone has checked it. If the claim is true, the price can hold. If it is false, the price can fall much further than it rose.',
      related: rel, investigate: ['Can anyone independent check this claim?', 'Has a careful channel confirmed the facts, or only repeated what the company said?', 'How much of the rise is belief, and how much is proof?'], concepts: [concept('too_good'), concept('verification')] });
    else addSit(p, state, `fraud:${ev.id}`, { kind: 'fraud', companyId: c.id, mine: !!p.holdings[c.id], title: `${c.ticker}: regulators say the claim was a scam`, body: 'The government or a regulator says the company\'s earlier claim was false. Prices usually fall fast and hard on a fraud finding, because customers, lenders and partners leave.',
      related: rel, investigate: ['Was this the same claim that sent the price up earlier?', 'If you hold it, what is the cost of waiting for more news versus acting now?', 'What warning signs came before this?'], concepts: [concept('too_good'), concept('scandal')] });
  }
}
// ---- Local explanation for a given price move / chart context (used when the AI is unavailable) ------------------------
function explainSituation(sit) {
  return `${sit.body} ${sit.investigate && sit.investigate.length ? 'Questions to ask: ' + sit.investigate.join(' ') : ''}`;
}
module.exports = { evaluateTrade, updateReviews, detectSituations, earningsSituation, unverifiedSituation, arcSituation, explainSituation, concept, unlock, netWorth, dayOf, candleAt };
