// HTML builders for every screen. Pure functions of state; all interaction goes through data-act attributes handled in app.js.
import { S, co, CHANNELS, chOrder, chColor, chName } from './state.js';
import { esc, inr, inr0, cr, num, pct, cls, icon, stamp, clockOf, dayOf, fmtMin, hoursLeft, PRE_MIN, OPEN_MIN, CLOSE_MIN } from './util.js';
import { analyze } from './charts.js';
import { portrait, figure, ANCHORS, canSpeak, hasPhotos } from './anchors.js';
import { liveQueue, liveCaptionText } from './live.js';

const NAV = [['home', 'Market Home', 'home'], ['terminal', 'Trading Terminal', 'terminal'], ['news', 'BullRun Live', 'news'], ['portfolio', 'My Portfolio', 'portfolio'], ['companies', 'Companies', 'companies'], ['ipo', 'IPOs', 'rocket'], ['learn', 'Decision Intelligence', 'learn'], ['truth', 'Truth Mode', 'eye'], ['history', 'Game History', 'history']];
export const ROUTES = NAV.map((n) => n[0]).concat(['board', 'report']);
export const routeLabel = (r) => (r === 'news' ? 'BullRun Live' : (NAV.find((n) => n[0] === r) || [r, { board: 'Leaderboard', report: 'Your report' }[r] || 'BullRun'])[1]);
const coChip = (c) => `<button class="chip sig" data-act="openco" data-id="${c.id}" title="${esc(c.name)}">${esc(c.ticker)}</button>`;
const chTag = (id) => `<span class="cname" data-ch="${id}">${esc(chName(id))}</span>`;
const emptyBox = (t, s) => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;
const holdingsSet = () => new Set(S.view.portfolio.holdings.map((h) => h.companyId));

// ---------- shell ----------
export function railHtml() {
  const v = S.view; const open = v.orders.filter((o) => o.status === 'open').length;
  const unseen = Math.max(0, v.newsTotal - (S.seenNews[v.id] || 0)); const ipoOpen = (v.ipos || []).filter((i) => i.status === 'open' && !i.you).length;
  return `<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#15181E"/><path d="M7 21.5l6-7 5 4 7.5-9" fill="none" stroke="#3DDC97" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>BullRun</span></div>` +
    (v.room || v.rivals ? NAV.concat([['board', 'Leaderboard', 'trophy']]) : NAV).map(([id, label, ic]) => `<button class="nav" data-act="nav" data-to="${id}" ${S.route === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(label)}</span>${id === 'news' && unseen > 0 && S.route !== 'news' ? `<span class="badge" aria-label="${unseen} new stories">${unseen > 99 ? '99+' : unseen}</span>` : ''}${id === 'portfolio' && open ? `<span class="badge" aria-label="${open} open orders">${open}</span>` : ''}${id === 'ipo' && ipoOpen ? `<span class="badge" aria-label="IPO open for bidding">${ipoOpen}</span>` : ''}</button>`).join('') +
    `<div class="onair-wrap" id="onair">${onAirMini()}</div><div class="sim">Everything here is fictional. Prices, companies and money are simulated.<br><button class="chip" data-act="tour" style="margin-top:8px">Take the tour</button></div>`;
}
export function clockHtml() {
  const v = S.view; const done = v.status === 'complete'; const pf = v.portfolio; const rm = v.room; const H = v.hours; const ph = v.phase;
  const span = H.closeMin - H.preMin, pct100 = (m) => (((m - H.preMin) / span) * 100).toFixed(2);
  const left = ph === 'open' ? H.closeMin - H.nowMin : ph === 'preopen' ? H.openMin - H.nowMin : 0;
  const stateTxt = done ? 'Session finished' : ph === 'open' ? `Market open · closes ${H.close} (${hoursLeft(left)} left)` : ph === 'preopen' ? `Market closed · opens ${H.open} (in ${hoursLeft(left)})` : `Market closed for today · reopens ${H.open} tomorrow`;
  const marks = [H.preMin, H.openMin, 615, 675, 735, 795, 855, H.closeMin];
  const dayline = `<div class="dayline ${ph}" role="img" aria-label="Trading day timeline. Pre-open ${fmtMin(H.preMin)} to ${H.open}, trading ${H.open} to ${H.close}. Now ${esc(v.clock)}.">
    <div class="dl-track"><i class="dl-pre" style="width:${pct100(H.openMin)}%"></i><i class="dl-open" style="left:${pct100(H.openMin)}%;right:0"></i><i class="dl-done" style="width:${pct100(Math.max(H.preMin, H.nowMin))}%"></i><b class="dl-now" style="left:${pct100(H.nowMin)}%"></b></div>
    <div class="dl-labels" aria-hidden="true">${marks.map((m, i) => `<span class="${i === 1 || i === 7 ? 'key' : ''}" style="left:${pct100(m)}%">${fmtMin(m).replace(' AM', '').replace(' PM', '')}</span>`).join('')}</div></div>`;
  const segs = Array.from({ length: v.days }, (_, i) => { const d = i + 1; return `<i class="${done || d < v.day || (d === v.day && ph === 'closed') ? 'done' : d === v.day ? 'now' : ''}"></i>`; }).join('');
  const remaining = ph === 'open' ? v.tpd - (v.tick % v.tpd) : v.tpd;
  let ctl;
  if (done) ctl = `<button class="btn primary" data-act="nav" data-to="report">See your report</button>`;
  else if (rm) ctl = roomCtl(rm);
  else if (ph === 'closed') ctl = `<div class="ctl"><button class="btn primary nextday" data-act="nextday" ${S.busy ? 'disabled' : ''}>${icon('step')}Next day <span class="faint">· ${H.preOpen}</span></button></div>`;
  else ctl = `
    <div class="ctl">
      <button class="btn iconbtn" data-act="step" data-n="1" title="Advance one hour" aria-label="Advance one hour" ${S.busy ? 'disabled' : ''}>${icon('step')}</button>
      <button class="btn sm" data-act="step" data-n="${remaining}" title="Run until the market closes at ${H.close}" ${S.busy ? 'disabled' : ''}>Finish day</button>
      <button class="btn ${S.playing ? '' : 'primary'}" data-act="play" aria-pressed="${S.playing}">${icon(S.playing ? 'pause' : 'play')}${S.playing ? 'Pause' : 'Play'}</button>
      <div class="seg" role="group" aria-label="Speed">${[1, 2, 4].map((n) => `<button data-act="speed" data-n="${n}" aria-pressed="${S.speed === n}">${n}x</button>`).join('')}</div>
    </div>`;
  const head = rm && v.tick === 0 ? (rm.status === 'lobby' ? 'In the lobby' : 'Paused before the open') : `Day ${v.day} of ${v.days}`;
  return `<div class="clk"><span class="dayno">${esc(head)}</span><b>${esc(v.clock)}</b><span class="mkt ${done ? 'closed' : ph}"><i aria-hidden="true"></i>${esc(stateTxt)}</span></div>
    <div class="dlwrap">${dayline}<div class="days" role="img" aria-label="Day ${v.day} of ${v.days}">${segs}</div></div>${ctl}
    ${rm ? `<button class="chip sig" data-act="nav" data-to="board" title="Open the leaderboard">${icon('users', 14)} Room ${esc(rm.code)} · ${rm.members.length}</button>` : ''}
    <div class="cash"><b>${inr0(pf.netWorth)}</b><span class="${cls(pf.returnPct)}">${pct(pf.returnPct, 2)} · cash ${inr0(pf.available)}</span></div>
    ${S.offline >= 2 ? '<span class="chip warn" role="status">Reconnecting</span>' : ''}
    <span class="chip" title="${esc(v.fallback.active ? v.fallback.reason || 'Built-in generator' : 'AI scenario text is active')}">${v.fallback.active ? 'Built-in generator' : 'AI scenario'}</span>`;
}
export const tapeSig = () => S.view.ticker.map((t) => t.id).join('|');
export function tapeHtml() {
  const items = S.view.ticker; if (!items.length) return '';
  return `<div class="track" style="--dur:${Math.max(70, items.length * 11)}s">${items.map((t) => `<button class="it" data-act="nav" data-to="news" data-ch="${t.channel}"><em>${esc(chName(t.channel))}</em>${t.breaking ? '<span class="live" aria-label="Breaking"></span>' : ''}<span>${esc(t.headline)}</span></button>`).join('')}</div>`;
}
export function alertHtml() {
  const a = S.alert; if (!a) return '';
  return `<div class="banner ${a.kind === 'fill' ? 'info' : 'warn'}" role="status"><span>${icon(a.kind === 'fill' ? 'check' : 'bolt')}</span><div style="flex:1"><b>${esc(a.title)}</b><div class="sub">${esc(a.text)}</div></div>${a.go ? `<button class="btn sm" data-act="nav" data-to="${a.go}">${esc(a.goLabel || 'Open')}</button>` : ''}<button class="btn sm ghost" data-act="dismiss" aria-label="Dismiss">${icon('close', 14)}</button></div>`;
}

// ---------- home ----------
function nextSteps() {
  const v = S.view, pf = v.portfolio, out = []; const hs = holdingsSet();
  for (const i of (v.ipos || [])) if (i.status === 'open' && !i.you) out.push(['rocket', 'ipo', `IPO open: ${i.name}`, `Bidding closes at ${v.hours.close} today. Read the numbers, then decide whether to bid.`, 'ipo']);
  if (v.phase === 'preopen' && !v.room) out.push(['play', 'play', `Reach the ${v.hours.open} open`, `It is ${v.clock} and the market is closed. Read the news, then press Play. Trading runs ${v.hours.open} to ${v.hours.close}.`, 'play']);
  if (v.phase === 'closed' && !v.room) out.push(['nextday', 'step', 'Plan tomorrow', `The market closed at ${v.hours.close}. Review your portfolio, then press Next day to reach ${v.hours.preOpen} tomorrow.`, 'step']);
  if (v.room && v.room.status === 'lobby') out.push(['users', 'board', 'Invite your friends', 'Share the room code. The host starts the market when everyone has joined.', 'nav']);
  if (!hs.size) out.push(['companies', 'companies', 'Get to know a company first', 'Read what each company does and how healthy it is before you put money in.', 'companies']);
  const unv = v.situations.find((s) => s.kind === 'unverified' && v.tick - s.tick <= 6);
  if (unv) out.push(['info', 'news', unv.title, 'Compare channels. Has a careful source confirmed this, or denied it?', 'news']);
  const big = pf.holdings.find((h) => h.weight > 0.4); if (big) out.push(['shield', 'portfolio', `${big.ticker} is ${Math.round(big.weight * 100)}% of your portfolio`, 'One company dominating your money means one surprise decides your result.', 'portfolio']);
  if (v.tick >= 14 && pf.cashPct > 0.8 && !hs.size) out.push(['info', 'terminal', 'Your money is all in cash', 'Cash is safe, but it does not grow. Staying out has a cost too.', 'terminal']);
  const e = v.upcoming.find((u) => u.kind === 'earnings' && u.day <= v.day + 1); if (e) out.push(['news', 'companies', e.label, `Results arrive on day ${e.day} around ${e.clock}. Prices often move on results versus expectations.`, 'companies']);
  out.push(['terminal', 'terminal', 'Open the Trading Terminal', 'Look at a chart and practise placing a small order.', 'terminal']);
  out.push(['news', 'news', 'Watch BullRun Live', 'A news channel that never stops. Four anchors, four personalities, and not all of them are equally reliable.', 'news']);
  return out.slice(0, 4);
}
export function home() {
  const v = S.view, pf = v.portfolio, bench = v.index.value / 1000 - 1; const rows = v.companies.slice().sort((a, b) => b.changePct - a.changePct);
  const moodPos = Math.round(((v.mood + 1) / 2) * 100); const sec = v.sectors.slice().sort((a, b) => b.changePct - a.changePct); const maxS = Math.max(0.01, ...sec.map((s) => Math.abs(s.changePct)));
  const latest = v.news.filter((n) => n.treatment !== 'background' || v.tick === 0).slice(-6).reverse();
  return `<div class="pagehead"><div><h1>${esc(v.marketName)}</h1><p>A fictional market. Today's backdrop is <b>${esc(v.scenario.title.toLowerCase().replace(/^the /, ''))}</b>.</p></div></div>
  ${alertHtml()}
  ${lobbyHtml()}
  <section class="panel hero">
    <div class="l"><div class="lbl">Your portfolio</div><div class="big" data-count="networth" data-v="${pf.netWorth}">${inr0(pf.netWorth)}</div>
      <div class="${cls(pf.returnPct)}" style="margin-top:4px;font-size:15px">${pf.netWorth >= pf.startCash ? '+' : '−'}${inr0(Math.abs(pf.netWorth - pf.startCash))} · ${pct(pf.returnPct, 2)} since the start</div>
      <div class="stats"><div><span>Cash to spend</span><b>${inr0(pf.available)}</b></div><div><span>Invested</span><b>${inr0(pf.invested)}</b></div>${pf.blocked ? `<div><span>In IPO bids</span><b>${inr0(pf.blocked)}</b></div>` : ''}<div><span>Market index</span><b class="${cls(bench)}">${pct(bench, 2)}</b></div></div>
      <div class="sub" style="margin-top:14px">You start with ₹1,00,000 of virtual money. Nothing here is real, so make your mistakes now.</div></div>
    <div class="r"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(v.indexName)} index <span style="font-weight:400;font-size:22px">${num(v.index.value)}</span> <span class="${cls(v.index.change)}">${pct(v.index.change, 2)}</span></b><span class="sub">Market mood: <b style="color:var(--text)">${esc(v.moodLabel)}</b></span></div>
      <canvas id="idxchart" aria-label="Market index chart" role="img"></canvas><div class="mood" aria-hidden="true"><i style="left:${moodPos}%"></i></div></div>
  </section>
  <div class="grid2">
    <section class="panel"><div class="ph"><h2>Companies</h2><span class="sub sp">Tap a row to open it in the terminal</span></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Company</th><th>Industry</th><th>Price</th><th>Today</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-act="trade" data-id="${c.id}"><td><span class="tk">${esc(c.ticker)}</span>${c.ipo ? ' <span class="chip sig ipotag">IPO</span>' : ''} <span class="sub">${esc(c.name)}</span></td><td class="sub">${esc(c.industry)}</td><td data-px="${c.id}" data-v="${c.price}">${inr(c.price)}</td><td class="${cls(c.changePct)}">${pct(c.changePct, 2)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pad sub">Top gainer <b class="up">${esc(co(v.gainers[0]).ticker)}</b> · Top loser <b class="down">${esc(co(v.losers[0]).ticker)}</b> · Turnover ₹${num(v.turnoverCr)} cr today</div></section>
    <div style="display:grid;gap:22px;align-content:start">
      <section class="panel"><div class="ph"><h2>What you can do next</h2></div><div class="pad next">${nextSteps().map(([ic, to, t, s, act]) => `<button data-act="${act === 'play' ? 'play' : 'nav'}" data-to="${to}">${icon(ic === 'play' ? 'play' : ic)}<span><b>${esc(t)}</b><br><span class="sub">${esc(s)}</span></span></button>`).join('')}</div></section>
      <section class="panel scen pad"><div class="lbl">Today's scenario</div><h3>${esc(v.scenario.title)}</h3><ul>${v.scenario.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        <div class="sub" style="margin-top:10px">Inflation ${v.macro.inflation}% · Policy rate ${v.macro.rate}% · Oil $${v.macro.oil} · Consumer confidence ${v.macro.consumer}</div></section>
    </div>
  </div>
  <div class="grid2">
    ${rivalsPanel()}
    <section class="panel"><div class="ph"><h2>Latest news</h2><button class="btn sm sp" data-act="nav" data-to="news">Open BullRun Live</button></div>
      ${latest.length ? latest.map((n) => `<button class="newsline" data-ch="${n.channel}" data-act="nav" data-to="news"><span class="cdot"></span><span><span class="cname">${esc(chName(n.channel))}</span> <span class="sub">${esc(stamp(n.tick, n.minute))}</span><br>${esc(n.headline)}</span></button>`).join('') : emptyBox('No news yet', 'Stories arrive as the market clock moves.')}</section>
    <div style="display:grid;gap:22px;align-content:start">
      <section class="panel"><div class="ph"><h2>Industry performance</h2></div><div style="padding:8px 0">${sec.map((s) => `<div class="sector"><span style="width:120px">${esc(s.name)}</span><span class="bar"><i style="${s.changePct >= 0 ? 'left:50%' : `right:50%`};width:${Math.round((Math.abs(s.changePct) / maxS) * 50)}%;background:var(--${s.changePct >= 0 ? 'up' : 'down'})"></i></span><span class="${cls(s.changePct)}" style="width:56px;text-align:right">${pct(s.changePct, 1)}</span></div>`).join('')}</div></section>
      <section class="panel"><div class="ph"><h2>Coming up</h2></div>${v.upcoming.length ? v.upcoming.slice(0, 5).map((u) => `<div class="sector"><span class="chip">Day ${u.day}</span><span>${esc(u.label)}</span><span class="sub" style="margin-left:auto">${esc(u.clock)}</span></div>`).join('') : emptyBox('Nothing scheduled', 'No more scheduled events this session.')}</section>
    </div>
  </div>`;
}

// ---------- terminal ----------
export function ticketHtml() {
  const v = S.view; const c = co(S.selected); const t = S.ticket; const pf = v.portfolio; const h = pf.holdings.find((x) => x.companyId === c.id);
  const pv = S.preview; const finished = v.status !== 'active'; const shut = !finished && v.phase !== 'open';
  const open = v.orders.filter((o) => o.status === 'open' && o.companyId === c.id);
  const verb = t.side === 'buy' ? 'Buy' : 'Sell';
  let rc = '';
  if (pv && pv.ok) {
    rc = `<div class="receipt"><h4>${verb.toUpperCase()} ORDER${pv.type === 'limit' ? ' · LIMIT' : pv.type === 'stop' ? ' · STOP-LOSS' : ''}</h4><div>${esc(pv.name)}</div>
      <div class="r"><span>${pv.type === 'market' ? 'Expected price' : pv.type === 'limit' ? 'Limit price' : 'Triggers at'}</span><span>${inr(pv.estPrice)}</span></div>
      <div class="r"><span>Quantity</span><span>${num(pv.qty)}</span></div><div class="r"><span>Order value</span><span>${inr(pv.value)}</span></div>
      <div class="r"><span>Transaction charges</span><span>${inr(pv.fee)}</span></div>
      <div class="r tot"><span>${t.side === 'buy' ? 'Total payable' : 'You receive'}</span><span>${inr(pv.total)}</span></div>
      <div class="r"><span>${pv.reservesCash ? 'Cash reserved' : 'Cash after execution'}</span><span>${pv.reservesCash ? inr(pv.total) : inr(pv.cashAfter)}</span></div>
      <div class="r"><span>Share of your portfolio</span><span>${pv.pctOfPortfolio}%</span></div>
      ${pv.type === 'market' ? `<div class="sub">Includes a ${pv.spreadPct}% spread and about ${pv.slipPct}% slippage for this size.</div>` : pv.type === 'limit' ? '<div class="sub">Fills only at your price or better. It may not fill at all.</div>' : '<div class="sub">Sells automatically if the price falls to this level. In a fast fall it can fill lower.</div>'}</div>
      ${pv.warnings.length ? `<ul class="warnl">${pv.warnings.map((w) => `<li>${icon('info', 16)}<span>${esc(w)}</span></li>`).join('')}</ul>` : ''}`;
  } else if (S.previewErr && (t.qty || t.limit)) rc = `<div class="banner warn">${icon('info')}<span>${esc(S.previewErr)}</span></div>`;
  else rc = `<div class="sub">Enter a quantity to see exactly what this order will cost, before you commit.</div>`;
  const label = pv && pv.ok ? (pv.confirmRequired ? `Review large ${t.side} order` : `${verb} ${num(pv.qty)} ${c.ticker}`) : `${verb} ${c.ticker}`;
  return `<div class="ph"><h2>Order ticket</h2><span class="sub sp">${esc(c.ticker)} · ${inr(c.price)}</span></div><div class="body">
    ${shut ? `<div class="banner info closedbn" role="status">${icon('clock')}<span><b>Market closed.</b> You can buy and sell from ${v.hours.open} to ${v.hours.close}. ${v.phase === 'closed' ? 'Press Next day, then Play, to trade tomorrow.' : `It is ${esc(v.clock)}. Press Play to reach the open.`}</span></div>` : ''}
    <div style="display:flex;gap:10px;align-items:center"><div class="seg ${t.side}" role="group" aria-label="Side"><button data-act="side" data-v="buy" aria-pressed="${t.side === 'buy'}">Buy</button><button data-act="side" data-v="sell" aria-pressed="${t.side === 'sell'}">Sell</button></div>
      <select id="otype" data-in="type" aria-label="Order type"><option value="market" ${t.type === 'market' ? 'selected' : ''}>Market</option><option value="limit" ${t.type === 'limit' ? 'selected' : ''}>Limit</option>${t.side === 'sell' ? `<option value="stop" ${t.type === 'stop' ? 'selected' : ''}>Stop-loss</option>` : ''}</select></div>
    <div class="sub">${t.type === 'market' ? 'Buys or sells now at the best available price, which includes the spread.' : t.type === 'limit' ? 'Set the price you are willing to trade at. It waits until the market reaches it.' : 'Protects shares you own by selling if the price drops to your level.'}</div>
    <div class="field"><label for="oqty">Quantity${h ? ` <span class="faint">(you hold ${num(h.qty)})</span>` : ''}</label><input id="oqty" data-in="qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(t.qty)}" placeholder="Number of shares">
      <div class="qbtns">${[10, 25, 50, 100].map((n) => `<button data-act="qty" data-n="${n}">${n}</button>`).join('')}<button data-act="qty" data-n="max">${t.side === 'buy' ? 'Max with cash' : 'All shares'}</button></div></div>
    ${t.type === 'limit' ? `<div class="field"><label for="olimit">Limit price (₹)</label><input id="olimit" data-in="limit" type="number" step="0.05" value="${esc(t.limit)}" placeholder="${c.price.toFixed(2)}"></div>` : ''}
    ${t.type === 'stop' ? `<div class="field"><label for="ostop">Sell if price falls to (₹)</label><input id="ostop" data-in="stop" type="number" step="0.05" value="${esc(t.stop)}" placeholder="${(c.price * 0.95).toFixed(2)}"></div>` : ''}
    ${rc}
    <button class="btn block ${t.side}" data-act="submit" ${!pv || !pv.ok || finished || shut || S.busy ? 'disabled' : ''}>${shut ? 'Market closed' : esc(label)}</button>
    <div class="sub">Cash available ${inr(pf.available)}${pf.reserved ? ` (${inr(pf.reserved)} reserved by open orders)` : ''}</div>
    ${S.lastTrade ? `<div class="receipt"><h4>LAST TRADE</h4><div>${esc(S.lastTrade.summary)}</div>${S.lastTrade.flags.map((f) => `<div class="${f.kind === 'good' ? 'up' : ''}" style="${f.kind === 'warn' ? 'color:var(--amber)' : ''}">${f.kind === 'good' ? '✓' : '!'} ${esc(f.text)}</div>`).join('')}<button class="chip sig" data-act="nav" data-to="learn" style="margin-top:4px">Read the full trade review</button></div>` : ''}
    ${open.length ? `<div><div class="lbl" style="margin-bottom:6px">Open orders for ${esc(c.ticker)}</div>${open.map((o) => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line)"><span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side}</span><span>${num(o.qty)} @ ${inr(o.limit || o.stop)} <span class="sub">${o.type === 'stop' ? 'stop-loss' : 'limit'}</span></span><button class="btn sm sp" style="margin-left:auto" data-act="cancel" data-id="${o.id}">Cancel</button></div>`).join('')}</div>` : ''}
  </div>`;
}
function coSnapshot(c) {
  const f = c.fund; const dir = f.profit >= 0;
  const bal = { Strong: 'up', Fair: 'warn', Stretched: 'down' }[c.balance];
  return `<dl class="kv" style="padding:14px 18px"><dt>Market value</dt><dd>${cr(c.marketCap)}</dd><dt>Revenue (last year)</dt><dd>${cr(f.revenue)}</dd><dt>${dir ? 'Profit' : 'Loss'}</dt><dd class="${dir ? 'up' : 'down'}">${cr(Math.abs(f.profit))}</dd><dt>Debt</dt><dd>${cr(f.debt)}</dd><dt>Price vs profit (P/E)</dt><dd>${c.pe ? c.pe + '×' : 'No profit'}</dd><dt>Financial health</dt><dd><span class="chip ${bal}">${esc(c.balance)}</span></dd></dl>
  <details class="more" data-k="fin-${c.id}" ${S.open['fin-' + c.id] ? 'open' : ''}><summary>${icon('chevron', 16)} More financials</summary><div><dl class="kv"><dt>Cash reserves</dt><dd>${cr(f.cash)}</dd><dt>Profit margin</dt><dd>${pct(f.margin, 1, false)}</dd><dt>Earnings per share</dt><dd>${inr(c.eps)}</dd><dt>Market share</dt><dd>${f.marketShare}%</dd><dt>Previous revenue</dt><dd>${f.prevRevenue ? cr(f.prevRevenue) : 'Not yet reported'}</dd><dt>Previous profit</dt><dd>${f.prevProfit === null ? 'Not yet reported' : cr(f.prevProfit)}</dd><dt>Last results</dt><dd>${c.lastEarnings ? (c.lastEarnings.surprise > 0.015 ? 'Beat expectations' : c.lastEarnings.surprise < -0.015 ? 'Missed expectations' : 'In line') : 'None yet'}</dd><dt>Next results</dt><dd>${c.nextEarnings ? `Day ${dayOf(c.nextEarnings)}` : 'None this session'}</dd><dt>Risk level</dt><dd>${esc(c.risk)}</dd><dt>Trading volume</dt><dd>${esc(c.liquidity)} liquidity</dd><dt>Today's range</dt><dd>${inr(c.dayLow)} to ${inr(c.dayHigh)}</dd><dt>Bid / ask</dt><dd>${inr(c.bid)} / ${inr(c.ask)}</dd></dl></div></details>`;
}
function intelHtml(c) {
  const key = `${c.id}:${S.view.tick}`; const a = analyze(c.candles, c.name); const learn = S.chart.learn; const g = S.chart.guess[key];
  const qs = [['uptrend', 'Uptrend'], ['downtrend', 'Downtrend'], ['range', 'Sideways'], ['reversal_up', 'Turning up'], ['reversal_down', 'Turning down']];
  const body = `<div class="ci"><p><b>${esc(c.name)}</b> · ${inr(c.price)} · <span class="chip sig">${esc(a.label)}</span></p><h4>What the chart shows</h4><ul>${a.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    <h4>What this could mean</h4><p>${esc(a.meaning)} <span class="muted">${esc(a.caveat)}</span></p><h4>What should you consider?</h4><ul>${a.consider.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  if (!learn) return `<div class="ph"><h2>Chart Intelligence</h2><button class="btn sm sp" data-act="learnmode" data-v="1">Try learning mode</button></div><div class="pad">${body}</div>`;
  return `<div class="ph"><h2>Chart Intelligence · learning mode</h2><button class="btn sm sp" data-act="learnmode" data-v="0">Turn off</button></div><div class="pad">
    <p><b>What pattern do you think is developing?</b></p><p class="sub">Study the chart above first. Then choose; the explanation unlocks after you answer.</p>
    <div class="quiz" role="group" aria-label="Your guess">${qs.map(([id, l]) => `<button data-act="guess" data-key="${key}" data-v="${id}" ${g ? 'disabled' : ''} class="${g ? (id === a.pattern ? 'right' : id === g ? 'wrong' : '') : ''}">${l}</button>`).join('')}<button data-act="guess" data-key="${key}" data-v="unsure" ${g ? 'disabled' : ''} class="${g === 'unsure' ? 'wrong' : ''}">Not sure</button></div>
    ${g ? `<p style="margin:8px 0">${g === a.pattern ? '<b class="up">Good read.</b> ' : g === 'unsure' ? '<b>That is a fair answer; charts are often unclear.</b> ' : '<b style="color:var(--amber)">Not quite, but this is how you learn.</b> '}The chart looks like <b>${esc(a.label.toLowerCase())}</b>.</p>${body}` : ''}</div>`;
}
export function terminal() {
  const v = S.view; if (!S.selected || !co(S.selected)) S.selected = v.companies[0].id; const c = co(S.selected); const ch = S.chart; const h = v.portfolio.holdings.find((x) => x.companyId === c.id);
  const recent = v.news.filter((n) => n.tags.companies.includes(c.id) && n.treatment !== 'background').slice(-4).reverse();
  const I = (k, l) => `<button data-act="ind" data-k="${k}" aria-pressed="${!!ch.ind[k]}">${l}</button>`;
  return `${alertHtml()}<div class="term">
    <section class="panel clist" aria-label="Companies">${v.companies.map((x) => `<button data-act="select" data-id="${x.id}" ${x.id === c.id ? 'aria-current="true"' : ''}><span><b class="tk">${esc(x.ticker)}</b>${x.ipo ? ' <span class="chip sig ipotag">IPO</span>' : ''}<br><span class="sub">${esc(x.industry)}</span></span><span class="px">${inr(x.price)}<br><span class="${cls(x.changePct)}" style="font-size:12.5px">${pct(x.changePct, 2)}</span></span></button>`).join('')}</section>
    <div style="display:grid;gap:18px;min-width:0">
      <section class="panel"><div class="chead"><div><h1 style="font-size:20px">${esc(c.name)}</h1><div class="sub">${esc(c.ticker)} · ${esc(c.industry)}${h ? ` · you hold ${num(h.qty)}` : ''}</div></div>
        <div><span class="price">${inr(c.price)}</span> <span class="${cls(c.changePct)}">${pct(c.changePct, 2)} <span class="sub">(${c.change >= 0 ? '+' : '−'}${inr(Math.abs(c.change))})</span></span></div><button class="btn sm" style="margin-left:auto" data-act="openco" data-id="${c.id}">About this company</button></div>
        <div class="ctools"><div class="seg" role="group" aria-label="Chart type"><button data-act="ctype" data-v="candle" aria-pressed="${ch.type === 'candle'}">Candles</button><button data-act="ctype" data-v="line" aria-pressed="${ch.type === 'line'}">Line</button></div>
          <div class="seg" role="group" aria-label="Range">${[[30, '30h'], [60, '60h'], [120, '120h'], ['all', 'All']].map(([r, l]) => `<button data-act="crange" data-v="${r}" aria-pressed="${ch.range === r}">${l}</button>`).join('')}</div>
          <div class="inds" role="group" aria-label="Indicators">${I('vol', 'Volume')}${I('ma', 'Moving averages')}</div></div>
        <details class="more" data-k="inds" ${S.open.inds ? 'open' : ''} style="border-top:0"><summary style="padding:2px 18px 8px">${icon('chevron', 16)} More indicators</summary><div style="padding-bottom:6px"><div class="inds">${I('bb', 'Bollinger Bands')}${I('rsi', 'RSI')}${I('macd', 'MACD')}${I('sr', 'Support and resistance')}${I('trend', 'Trendline')}</div></div></details>
        <canvas id="pricechart" class="chart" role="img" aria-label="Price chart for ${esc(c.name)}"></canvas></section>
      <section class="panel" id="intel">${intelHtml(c)}</section>
      <section class="panel"><div class="ph"><h2>${esc(c.name)} at a glance</h2></div><p class="pad muted" style="padding-bottom:0">${esc(c.description)}</p>${coSnapshot(c)}</section>
      <section class="panel"><div class="ph"><h2>Recent news about ${esc(c.ticker)}</h2></div>${recent.length ? recent.map((n) => `<button class="newsline" data-ch="${n.channel}" data-act="nav" data-to="news"><span class="cdot"></span><span><span class="cname">${esc(chName(n.channel))}</span> <span class="sub">${esc(stamp(n.tick, n.minute))}</span>${n.disputed ? ' <span class="chip warn">Disputed</span>' : ''}<br>${esc(n.headline)}</span></button>`).join('') : emptyBox('Nothing yet', `No channel has reported on ${c.name} so far.`)}</section>
    </div>
    <section class="panel ticket" id="ticket">${ticketHtml()}</section></div>`;
}

// ---------- newsroom ----------
const LABEL_CLS = { Unverified: 'warn', Rumour: 'warn', Chatter: 'warn', 'Sources say': 'warn', Verified: 'up', Denial: 'up', Correction: 'sig', Breaking: 'down' };
export function news() {
  const v = S.view; const chs = CHANNELS(); const sel = S.newsChannel; let items = v.news.slice().reverse();
  if (sel !== 'all') items = items.filter((n) => n.channel === sel);
  if (S.newsCompany) items = items.filter((n) => n.tags.companies.includes(S.newsCompany));
  const total = items.length; items = items.slice(0, S.newsLimit);
  return `<div class="pagehead"><div><h1>BullRun Live</h1><p>A newsroom that never switches off. Four AI anchors cover one world and read every story the moment it breaks. Earlier stories stay on the right so you can replay anything you missed.</p></div></div>
  <div class="chsel" role="group" aria-label="Channels"><button class="chbtn" data-act="newsch" data-v="all" aria-pressed="${sel === 'all'}"><b>All channels</b><span>Live mix of every anchor · ${v.newsTotal} stories so far</span></button>${chOrder.map((id) => `<button class="chbtn" data-ch="${id}" data-act="newsch" data-v="${id}" aria-pressed="${sel === id}"><b>${esc(chName(id))}</b><span>${esc((chs[id] || {}).tagline || '')}</span></button>`).join('')}</div>
  <div class="lv" id="live">${liveHtml()}</div>
  <section class="panel" aria-labelledby="archh"><div class="ph"><h2 id="archh">Story archive</h2><span class="sub sp">${total} stor${total === 1 ? 'y' : 'ies'}</span></div>
    <div class="pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label class="sub" for="ncompany">Show stories about</label><select id="ncompany" data-in="ncompany" style="width:auto;min-width:200px"><option value="">Everything</option>${v.companies.map((c) => `<option value="${c.id}" ${S.newsCompany === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    ${items.length ? items.map((n) => storyHtml(n)).join('') : emptyBox('No stories yet', v.tick === 0 ? (v.room ? 'Stories appear once the host starts the market.' : 'Press Play to reach the 9:15 AM open. Stories appear as the market clock moves.') : 'Nothing matches this filter yet.')}
    ${total > items.length ? `<div class="pad" style="text-align:center"><button class="btn" data-act="morenews">Show older stories</button></div>` : ''}</section>`;
}
function storyHtml(n) {
  const cos = n.tags.companies.map((id) => co(id)).filter(Boolean); const shown = cos.length > 3 ? cos.slice(0, 3) : cos;
  return `<article class="story ${n.disputed ? 'disputed' : ''}" data-ch="${n.channel}"><div class="meta">${portrait(n.channel, { crop: true })}<span class="cname">${esc(chName(n.channel))}</span><span>${esc(stamp(n.tick, n.minute))}</span><span class="chip ${LABEL_CLS[n.label] || ''}">${esc(n.label)}</span>${n.disputed ? '<span class="chip warn">Later disputed</span>' : ''}</div>
    <h3>${esc(n.headline)}</h3><p class="script">${esc(n.body)}</p>
    <div class="tags">${shown.map(coChip).join('')}${cos.length > 3 ? `<span class="chip">+${cos.length - 3} more</span>` : ''}${n.tags.tag && n.tags.tag !== 'Background' ? `<span class="chip">${esc(n.tags.tag)}</span>` : ''}${n.tags.category ? `<span class="chip">${esc(n.tags.category)}</span>` : ''}</div></article>`;
}

// ---------- portfolio ----------
const PAL = ['#5b8cff', '#2fd28f', '#f5b942', '#a98bff', '#ff8a5b', '#4dd0e1', '#ff6fa8', '#9ccc65', '#cfd8dc', '#ffd54f'];
export function portfolio() {
  const v = S.view, pf = v.portfolio; const hs = pf.holdings;
  const parts = hs.map((h, i) => ({ l: h.ticker, w: h.weight, c: PAL[i % PAL.length] })).concat([{ l: 'Cash', w: pf.cashPct, c: '#3a4766' }]);
  const open = v.orders.filter((o) => o.status === 'open');
  return `<div class="pagehead"><div><h1>My Portfolio</h1><p>Everything you own, what it cost and where it stands. Losses on paper are real in value, even if you have not sold.</p></div></div>${alertHtml()}
  <section class="panel pad"><div class="grid3" style="gap:18px"><div><div class="lbl">Net worth</div><div style="font-size:28px;font-weight:300">${inr0(pf.netWorth)}</div><div class="${cls(pf.returnPct)}">${pct(pf.returnPct, 2)} since start</div></div>
    <div><div class="lbl">Cash available</div><div style="font-size:28px;font-weight:300">${inr0(pf.available)}</div><div class="sub">${pf.reserved ? `${inr0(pf.reserved)} reserved for open orders` : `${pct(pf.cashPct, 0, false)} of your portfolio`}${pf.blocked ? ` · ${inr0(pf.blocked)} blocked in IPO bids` : ''}</div></div>
    <div><div class="lbl">Profit and loss</div><div style="font-size:28px;font-weight:300" class="${cls(pf.unrealized + pf.realized)}">${pf.unrealized + pf.realized >= 0 ? '+' : '−'}${inr0(Math.abs(pf.unrealized + pf.realized))}</div><div class="sub">Unrealized ${inr0(pf.unrealized)} · Realized ${inr0(pf.realized)} · Fees ${inr0(pf.fees)}</div></div></div>
    <div class="alloc" style="margin-top:18px" role="img" aria-label="Allocation">${parts.map((p) => `<i style="width:${Math.max(0, p.w * 100)}%;background:${p.c}" title="${esc(p.l)} ${Math.round(p.w * 100)}%"></i>`).join('')}</div><div class="legend">${parts.map((p) => `<span><b style="background:${p.c}"></b>${esc(p.l)} ${Math.round(p.w * 100)}%</span>`).join('')}</div></section>
  <section class="panel"><div class="ph"><h2>Holdings</h2></div>${hs.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Company</th><th>Shares</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Profit / loss</th><th>Weight</th><th></th></tr></thead><tbody>${hs.map((h) => `<tr><td><span class="tk">${esc(h.ticker)}</span> <span class="sub">${esc(h.name)}</span></td><td>${num(h.qty)}</td><td>${inr(h.avgCost)}</td><td>${inr(h.price)}</td><td>${inr(h.value)}</td><td class="${cls(h.unrealized)}">${h.unrealized >= 0 ? '+' : '−'}${inr(Math.abs(h.unrealized))} <span class="sub">${pct(h.unrealizedPct, 1)}</span></td><td>${Math.round(h.weight * 100)}%</td><td><button class="btn sm" data-act="trade" data-id="${h.companyId}">Trade</button></td></tr>`).join('')}</tbody></table></div>` : emptyBox('You do not own any shares yet', 'Open the Trading Terminal, choose a company and place your first small order.')}</section>
  ${open.length ? `<section class="panel"><div class="ph"><h2>Open orders</h2></div><div class="scroll"><table class="tbl"><thead><tr><th>Company</th><th>Order</th><th>Quantity</th><th>Price</th><th>Placed</th><th></th></tr></thead><tbody>${open.map((o) => `<tr><td class="tk">${esc(o.ticker)}</td><td><span class="${o.side === 'buy' ? 'up' : 'down'}">${o.side}</span> ${o.type === 'stop' ? 'stop-loss' : o.type}</td><td>${num(o.qty)}</td><td>${inr(o.limit || o.stop)}</td><td class="sub">${esc(stamp(o.createdTick))}</td><td><button class="btn sm" data-act="cancel" data-id="${o.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
  <section class="panel"><div class="ph"><h2>Your trades</h2><span class="sub sp">Newest first</span></div>${v.transactions.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>When</th><th>Company</th><th>Side</th><th>Qty</th><th>Price</th><th>Fees</th><th>Realized</th></tr></thead><tbody>${v.transactions.slice(0, 40).map((t) => `<tr><td class="sub">${esc(stamp(t.tick))}</td><td class="tk">${esc(t.ticker)}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side}</td><td>${num(t.qty)}</td><td>${inr(t.price)}</td><td>${inr(t.fee)}</td><td class="${cls(t.realized || 0)}">${t.realized === null ? '–' : (t.realized >= 0 ? '+' : '−') + inr(Math.abs(t.realized))}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('No trades yet', 'Your executed orders will be listed here with every fee.')}</section>
  <section class="panel"><div class="ph"><h2>You versus the market</h2></div><div class="pad"><canvas id="eqchart" style="width:100%;height:210px;display:block" role="img" aria-label="Portfolio compared with market index"></canvas></div></section>`;
}

// ---------- companies ----------
export function companyDetail(c) {
  const v = S.view; const recent = v.news.filter((n) => n.tags.companies.includes(c.id) && n.treatment !== 'background').slice(-3).reverse();
  return `<p class="muted">${esc(c.description)}</p><div class="kv" style="margin:6px 0"><dt>Price</dt><dd>${inr(c.price)} <span class="${cls(c.changePct)}">${pct(c.changePct, 2)}</span></dd><dt>Industry</dt><dd>${esc(c.industry)}</dd></div>${coSnapshot(c)}
    ${recent.length ? `<div class="lbl" style="margin:8px 0 4px">Recent news</div>${recent.map((n) => `<div style="padding:6px 0;border-top:1px solid var(--line)" data-ch="${n.channel}"><span class="cname">${esc(chName(n.channel))}</span> <span class="sub">${esc(stamp(n.tick, n.minute))}</span><br>${esc(n.headline)}</div>`).join('')}` : ''}`;
}
export function companies() {
  const v = S.view;
  return `<div class="pagehead"><div><h1>Companies</h1><p>${v.companies.length} invented companies in ${new Set(v.companies.map((c) => c.industry)).size} industries. Open any row for the details, and read before you buy.</p></div></div>${alertHtml()}
  <section class="panel">${v.companies.map((c) => `<details class="more" data-k="co-${c.id}" ${S.open['co-' + c.id] ? 'open' : ''} style="border-top:0;border-bottom:1px solid var(--line)"><summary style="padding:14px 18px"><span style="min-width:150px"><b class="tk">${esc(c.ticker)}</b> ${esc(c.name)}</span><span class="sub" style="flex:1">${esc(c.industry)}</span><span>${inr(c.price)}</span><span class="${cls(c.changePct)}" style="min-width:64px;text-align:right">${pct(c.changePct, 2)}</span><span class="chip ${{ Low: 'up', Medium: 'warn', High: 'down' }[c.risk]}">${esc(c.risk)} risk</span>${icon('chevron', 16)}</summary>
    <div>${companyDetail(c)}<button class="btn primary" style="margin-top:10px" data-act="trade" data-id="${c.id}">Open in Trading Terminal</button></div></details>`).join('')}</section>`;
}

// ---------- decision intelligence ----------
export function learn() {
  const v = S.view; const tab = S.learnTab;
  const tabs = [['situations', 'What is happening', v.situations.length], ['reviews', 'Your trade reviews', v.reviews.length], ['concepts', 'Concepts unlocked', v.concepts.length]];
  let body = '';
  if (tab === 'situations') body = v.situations.length ? v.situations.slice(0, 30).map((s) => { const ex = S.explain[s.id]; return `<article class="sit"><div class="meta sub">${esc(stamp(s.tick))}${s.mine ? ' · <span class="chip warn">You own this</span>' : ''}</div><h3>${esc(s.title)}</h3><p class="script" style="max-width:80ch">${esc(s.body)}</p>
    ${s.investigate && s.investigate.length ? `<ul class="ask">${s.investigate.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    ${s.related && s.related.length ? `<div class="tags">${s.related.map((r) => `<span class="chip" data-ch="${r.channel}"><span class="cname">${esc(chName(r.channel))}</span> ${esc(r.headline.slice(0, 60))}</span>`).join('')}</div>` : ''}
    ${(s.concepts || []).map((c) => `<div class="concept"><b>${esc(c.title)}</b>${esc(c.text)}</div>`).join('')}
    <div style="margin-top:10px">${ex ? `<div class="banner info"><span>${icon('info')}</span><div>${esc(ex.text)}${ex.notice ? `<div class="sub">${esc(ex.notice)}</div>` : ''}</div></div>` : `<button class="btn sm" data-act="explain" data-id="${s.id}" ${S.busy ? 'disabled' : ''}>Explain this another way</button>`}</div></article>`; }).join('')
    : emptyBox('Nothing to explain yet', 'When something notable happens, such as a big price move, a results announcement or a market-wide fall, it shows up here with a plain-English explanation.');
  if (tab === 'reviews') body = v.reviews.length ? v.reviews.map((r) => `<article class="rv"><div class="meta sub">${esc(stamp(r.tick))} · <span class="${r.side === 'buy' ? 'up' : 'down'}">${r.side}</span> ${esc(r.ticker)}</div><h3 style="margin:4px 0">Trade review</h3><p>${esc(r.summary)}</p>
    ${r.flags.length ? `<ul class="warnl" style="margin:8px 0">${r.flags.map((f) => `<li style="color:${f.kind === 'good' ? 'var(--up)' : 'var(--amber)'}">${f.kind === 'good' ? icon('check', 16) : icon('info', 16)}<span>${esc(f.text)}</span></li>`).join('')}</ul>` : ''}
    ${r.consider.length ? `<div class="lbl">What could you have considered?</div><ul style="margin:4px 0 8px">${r.consider.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    <div class="meter">Decision process <i><u style="width:${r.process}%"></u></i> ${r.process}/100 <span style="margin-left:14px">Result so far <b class="${cls(r.outcome)}">${r.outcome === null ? '–' : pct(r.outcome, 1)}</b></span></div>
    ${r.verdict ? `<div class="verdict"><b>${esc(r.verdict.title)}</b>${esc(r.verdict.text)}</div>` : `<div class="sub" style="margin-top:8px">Final verdict arrives about 14 hours after the trade, once the result is clearer.</div>`}
    ${r.concepts.length ? `<div class="tags">${r.concepts.map((c) => `<span class="chip sig" title="${esc(c.text)}">Learning unlocked: ${esc(c.title)}</span>`).join('')}</div>` : ''}</article>`).join('')
    : emptyBox('No trades to review yet', 'After each trade you get a short review. It scores your decision process separately from the result, so good decisions are rewarded even when luck goes against you.');
  if (tab === 'concepts') body = v.concepts.length ? `<div class="pad">${v.concepts.map((c) => `<div class="concept"><b>${esc(c.title)}</b>${esc(c.text)}</div>`).join('')}</div>` : emptyBox('Nothing unlocked yet', 'Concepts unlock as you trade and as events happen around you.');
  return `<div class="pagehead"><div><h1>Decision Intelligence</h1><p>Explanations that appear when they matter. Your reviews judge how you decided, not just whether you were lucky.</p></div></div>${alertHtml()}
  <div class="seg" role="group" aria-label="Sections">${tabs.map(([id, l, n]) => `<button data-act="learntab" data-v="${id}" aria-pressed="${tab === id}">${esc(l)} (${n})</button>`).join('')}</div><section class="panel">${body}</section>`;
}

// ---------- history & report ----------
export function history() {
  const v = S.view; const rows = S.sessions;
  const canEnd = v.status === 'active' && (!v.room || v.room.host);
  return `<div class="pagehead"><div><h1>Game History</h1><p>Every market you have played, solo or in a room. Pick one up where you left it, or start a new one.</p></div><button class="btn primary" style="margin-left:auto" data-act="newgame">Start a new market</button></div>${alertHtml()}
  <section class="panel">${rows.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Market</th><th>Mode</th><th>Length</th><th>Progress</th><th>Net worth</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr ${r.id === v.id ? 'class="sel"' : ''}><td>${esc(r.market_name)}${r.id === v.id ? ' <span class="chip sig">Current</span>' : ''}<div class="sub">Seed ${esc(r.seed)}</div></td><td>${r.mode === 'room' ? `<span class="chip sig">${icon('users', 13)} Room ${esc(r.code)} · ${r.players}</span>` : 'Solo'}</td><td>${esc(r.duration)}</td><td>${Math.round((r.tick / r.total_ticks) * 100)}%</td><td>${inr0(r.net_worth || 0)} <span class="${cls(r.net_worth / 100000 - 1)}">${pct(r.net_worth / 100000 - 1, 1)}</span></td><td>${r.status === 'complete' ? 'Finished' : 'In progress'}</td><td><button class="btn sm" data-act="loadgame" data-id="${r.id}" data-done="${r.status === 'complete'}">${r.status === 'complete' ? 'View report' : r.id === v.id ? 'Continue' : 'Resume'}</button></td></tr>`).join('')}</tbody></table></div>` : emptyBox('No games yet', 'Start your first market.')}</section>
  ${canEnd ? `<section class="panel pad" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:240px"><b>${v.room ? 'End the room session for everyone' : 'Finish this session early'}</b><div class="sub">Closes the market now and shows the performance report. This cannot be undone.</div></div><button class="btn" data-act="endgame">End session and see report</button></section>` : ''}
  <section class="panel pad sub">Seed <b style="color:var(--text)">${esc(v.seed)}</b> rebuilds this exact market, so unusual outcomes can be replayed and investigated. Every company, price and event here is fictional, and the money is virtual.</section>`;
}
export function report() {
  const v = S.view; const r = v.result;
  if (!r) return `<div class="pagehead"><div><h1>Performance report</h1><p>Your report appears when the session ends, on day ${v.days}.</p></div></div>${emptyBox('Still trading', `Day ${v.day} of ${v.days}. Keep going, or end the session early from Game History.`)}`;
  const gc = { A: 'up', B: 'up', C: 'warn', D: 'warn', E: 'down' }[r.grade];
  return `<div class="pagehead"><div><h1>Performance report</h1><p>${esc(v.marketName)} · ${esc(v.scenario.title.toLowerCase())}</p></div><button class="btn primary" style="margin-left:auto" data-act="newgame">Start a new market</button></div>
  <section class="panel pad" style="display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center"><div style="text-align:center"><div class="grade ${gc}">${esc(r.grade)}</div><div class="sub">Skill score ${r.skill}/100</div></div>
    <div><div class="big" style="font-size:38px">${inr0(r.netWorth)}</div><div class="${cls(r.returnPct)}" style="font-size:16px">${pct(r.returnPct, 2)} from ${inr0(r.startCash)} · market index ${pct(r.benchmarkPct, 2)}</div>
    <p class="sub" style="margin-top:10px;max-width:70ch">The score blends how well you decided (50%), how you did against the market (30%) and how well you controlled risk (20%). Luck alone cannot earn a top grade.</p></div></section>
  <div class="grid3"><section class="panel pad"><div class="lbl">Decision process</div><div style="font-size:26px;font-weight:300">${r.processScore === null ? 'No trades' : r.processScore + '/100'}</div><div class="sub">${r.verdicts.skill} well-judged and rewarded · ${r.verdicts.unlucky} sound but unlucky · ${r.verdicts.lucky} lucky · ${r.verdicts.lesson} costly lessons</div></section>
    <section class="panel pad"><div class="lbl">Risk</div><div style="font-size:26px;font-weight:300">${pct(r.maxDrawdown, 1, false)} worst fall</div><div class="sub">Largest drop from a peak. Largest holding at the end: ${Math.round(r.largestWeight * 100)}% of the portfolio.</div></section>
    <section class="panel pad"><div class="lbl">Activity</div><div style="font-size:26px;font-weight:300">${r.trades} trade${r.trades === 1 ? '' : 's'}</div><div class="sub">Fees ${inr0(r.fees)} · Realized ${inr0(r.realized)} · Unrealized ${inr0(r.unrealized)}${r.winRate === null ? '' : ` · ${Math.round(r.winRate * 100)}% of sales profitable`}</div></section></div>
  <section class="panel"><div class="ph"><h2>You versus the market</h2></div><div class="pad"><canvas id="eqchart" style="width:100%;height:230px;display:block" role="img" aria-label="Your portfolio compared with the index"></canvas></div></section>
  <section class="panel"><div class="ph"><h2>What stood out</h2></div><div class="pad"><ul style="margin:0;padding-left:18px;display:grid;gap:8px">${r.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div></section>
  ${r.concepts.length ? `<section class="panel"><div class="ph"><h2>Concepts you met</h2></div><div class="pad">${r.concepts.map((c) => `<div class="concept"><b>${esc(c.title)}</b>${esc(c.text)}</div>`).join('')}</div></section>` : ''}
  ${v.room ? standings() : ''}
  <p class="fine">This was a simulation with fictional companies and virtual money. It teaches ideas; it is not investment advice and says nothing about real markets.</p>`;
}

// ---------- overlays ----------
export function modalHtml() {
  const m = S.modal; if (!m) return '';
  const close = `<button class="btn iconbtn ghost" data-act="closemodal" aria-label="Close" style="margin-left:auto">${icon('close')}</button>`;
  if (m.type === 'company') { const c = co(m.id); if (!c) return ''; return `<div class="overlay" data-act="backdrop"><div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(c.name)}"><div class="mh"><h2>${esc(c.name)} <span class="sub">${esc(c.ticker)}</span></h2>${close}</div><div class="mb">${companyDetail(c)}</div><div class="mf"><button class="btn primary" data-act="trade" data-id="${c.id}">Open in Trading Terminal</button></div></div></div>`; }
  if (m.type === 'confirm') { const pv = m.preview; const big = pv.pctOfPortfolio; return `<div class="overlay" data-act="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Confirm order"><div class="mh"><h2>Confirm your ${pv.side} order</h2>${close}</div><div class="mb">
    <p>This order uses <b>${big}%</b> of your whole portfolio. Check it carefully before you commit.</p>
    <div class="receipt"><h4>${pv.side.toUpperCase()} ORDER</h4><div>${esc(pv.name)}</div><div class="r"><span>Share price</span><span>${inr(pv.estPrice)}</span></div><div class="r"><span>Quantity</span><span>${num(pv.qty)}</span></div><div class="r"><span>Order value</span><span>${inr(pv.value)}</span></div><div class="r"><span>Transaction charges</span><span>${inr(pv.fee)}</span></div><div class="r tot"><span>${pv.side === 'buy' ? 'Total payable' : 'You receive'}</span><span>${inr(pv.total)}</span></div><div class="r"><span>${pv.reservesCash ? 'Cash reserved' : 'Cash after execution'}</span><span>${pv.reservesCash ? inr(pv.total) : inr(pv.cashAfter)}</span></div></div>
    ${pv.warnings.length ? `<ul class="warnl">${pv.warnings.map((w) => `<li>${icon('info', 16)}<span>${esc(w)}</span></li>`).join('')}</ul>` : ''}</div>
    <div class="mf"><button class="btn" data-act="closemodal">Go back</button><button class="btn ${pv.side}" data-act="confirm" ${S.busy ? 'disabled' : ''}>Confirm ${pv.side}</button></div></div></div>`; }
  if (m.type === 'end') return `<div class="overlay" data-act="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="End session"><div class="mh"><h2>End this session?</h2>${close}</div><div class="mb"><p>${S.view.room ? 'This ends the session for every player in the room. ' : ''}The market closes at today's prices, open orders are cancelled and reports are generated. You cannot resume afterwards.</p></div><div class="mf"><button class="btn" data-act="closemodal">Keep playing</button><button class="btn primary" data-act="endconfirm">End and see report</button></div></div></div>`;
  return '';
}
const TOUR = [
  ['Welcome to a market that does not exist', 'Every company, price and headline here is invented, and you start with ₹1,00,000 of virtual money. The point is to learn by doing, not to win real money.'],
  ['Time moves when you press Play', 'The market trades 9:15 AM to 3:30 PM, like the NSE and BSE, and you can only buy or sell in those hours. Each step is about an hour. Use Play for continuous time, the step button for one hour, Finish day to reach the close, then Next day to start the next morning at 8:15 AM. Playback pauses when something important happens to a company you own.'],
  ['Four channels, four personalities', 'FLASHWIRE is fast and sometimes wrong. MARKETLINE is slow and careful. THE UNDERCURRENT digs up rumours. DAILY PULSE covers everyday life. The same event can look very different on each.'],
  ['Trade from the Terminal', 'Pick a company, study the chart, and see the full cost of an order before you place it. Market orders fill now; limit and stop-loss orders wait for your price.'],
  ['Learn from every decision', 'Decision Intelligence explains big moves and reviews your trades. It rewards good reasoning even when luck goes against you, so a loss is not always a mistake.'],
];
export function coachHtml() {
  if (S.tour === 'done' || S.tour === 'skipped' || !S.view) return ''; const i = S.tourStep; const [t, b] = S.view.room && i === 1 ? ['The host runs the clock', 'Everyone in the room sees the same market at the same moment. The host starts, pauses and sets the pace. Trade whenever you like: orders fill right away or wait for your price.'] : TOUR[i];
  return `<div class="coach" role="dialog" aria-label="Quick tour"><h3>${esc(t)}</h3><p class="muted">${esc(b)}</p><div class="row"><div class="dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><button class="btn sm ghost" data-act="tourskip">Skip tour</button>${i > 0 ? '<button class="btn sm" data-act="tourback">Back</button>' : ''}<button class="btn sm primary" data-act="tournext">${i === TOUR.length - 1 ? 'Start playing' : 'Next'}</button></div></div>`;
}

// ---------- start screen ----------

// ---------- Landing page: the first thing a visitor sees ----------
const BRAND = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#15181E"/><path d="M7 21.5l6-7 5 4 7.5-9" fill="none" stroke="#3DDC97" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const sampleSpark = (pts) => `<svg class="spk" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map((y, i) => `${((i / (pts.length - 1)) * 100).toFixed(1)},${(22 - y * 20).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
const sampleTile = (t, p, c, pts) => `<div class="gtile ${c.startsWith('-') ? 'down' : 'up'}"><b>${t}</b><span class="gp">${p}</span><span class="gc">${c}</span>${sampleSpark(pts)}</div>`;
export const LAND_SCENES = [
  { ch: 'marketline', tab: 'Verified', headline: 'Gearwell wins a three-year contract from a major customer', caption: 'We have confirmed the deal with the company. Shares are already moving.', tiles: [['Aurelia 6', '1,042', '+0.8%', [.2, .3, .25, .5, .45, .7, .8]], ['GEAR', '₹184.20', '+4.1%', [.1, .15, .3, .25, .55, .7, .9]], ['STAG', '₹96.50', '+1.2%', [.4, .35, .5, .45, .6, .55, .65]]] },
  { ch: 'flashwire', tab: 'Breaking', brk: true, headline: 'BREAKING: Central bank cuts its key rate to support growth', caption: 'Borrowing just got cheaper. Banks and homebuilders are leading the move.', tiles: [['Aurelia 6', '1,058', '+1.6%', [.2, .25, .4, .35, .6, .8, .95]], ['BANK', '₹412.75', '+3.8%', [.2, .3, .25, .5, .6, .8, .9]], ['HOME', '₹138.10', '+2.4%', [.3, .4, .35, .5, .55, .7, .8]]] },
  { ch: 'undercurrent', tab: 'Sources say', headline: 'Sources say Aurelia Power may be hiding a safety problem', caption: 'We have not been able to confirm this yet. Treat it with care.', tiles: [['Aurelia 6', '1,031', '-0.4%', [.7, .65, .7, .5, .55, .4, .35]], ['AURE', '₹221.40', '-3.2%', [.9, .8, .85, .6, .5, .35, .2]], ['GRID', '₹87.95', '-0.9%', [.6, .55, .6, .5, .5, .45, .4]]] },
  { ch: 'dailypulse', tab: 'Your day', headline: 'Your day in a minute: oil is up, airlines are down', caption: 'Fuel costs are squeezing airlines and farms. Here is what to watch today.', tiles: [['Aurelia 6', '1,037', '+0.3%', [.4, .45, .4, .5, .55, .5, .6]], ['CIRR', '₹107.75', '-2.1%', [.8, .7, .75, .55, .5, .4, .3]], ['ENCO', '₹238.55', '+2.8%', [.2, .3, .35, .5, .6, .75, .85]]] },
];
export function landStageInner(i) {
  const sc = LAND_SCENES[i % LAND_SCENES.length]; const a = ANCHORS[sc.ch];
  return `<div class="set"><div class="wall" aria-hidden="true">${Array.from({ length: 18 }, (_, k) => `<i style="animation-delay:-${((k * 1.37) % 7).toFixed(2)}s"></i>`).join('')}<b class="sweep"></b></div><div class="wordmark" aria-hidden="true">BULLRUN<b>LIVE</b></div>
    <div class="bugs"><span class="onair"><i class="live"></i>LIVE</span><span class="chbug">${esc(chName(sc.ch))}</span></div><div class="clockbug" aria-hidden="true">Day 1 · 9:15 AM</div>
    <div class="gfx" aria-hidden="true"><div class="gk">${esc(sc.tab)}</div><div class="gtiles">${sc.tiles.map((t) => sampleTile(...t)).join('')}</div></div>
    ${figure(sc.ch, { speaking: true })}<div class="desk" aria-hidden="true"><span class="plate">${esc(chName(sc.ch))}</span></div>
    <div class="lt enter"><span class="lt-tab${sc.brk ? ' brk' : ''}">${esc(sc.tab)}</span><div class="lt-main"><div class="lt-h">${esc(sc.headline)}</div><div class="lt-s">${esc(a.name)} · ${esc(a.role)}</div></div></div>
    <p class="cc" aria-hidden="true">${esc(sc.caption)}</p></div>
    <div class="ticker" aria-hidden="true"><div class="tk-tab">${icon('news')}Headlines</div><div class="tk-win"><div class="tk-track" style="--dur:70s">${[0, 1].map(() => LAND_SCENES.map((x) => `<span class="tk-i" data-ch="${x.ch}"><em>${esc(chName(x.ch))}</em>${esc(x.headline)}</span>`).join('')).join('')}</div></div></div>`;
}
const FAQ = [
  ['Is this real money?', 'No. Every rupee, share and company in BullRun is fictional. You start with ₹1,00,000 of virtual money, and nothing you do here touches a real account or a real market.'],
  ['Do I need an account?', 'Only a name. There is no password and no email. Your games are saved on the server you run, under that name, so you can come back and continue.'],
  ['Why 9:15 AM to 3:30 PM?', 'Those are the real trading hours of the NSE and BSE. In BullRun you can only buy and sell inside them, just like a real broker app, and each morning starts at 8:15 AM so you can read the news before the open.'],
  ['Are the companies and news real?', 'No. Every game invents a new market: companies, industries, events and stories. Some stories are verified, some are rumours that turn out wrong, and learning to tell them apart is part of the game.'],
  ['Who are the anchors?', 'Four fictional presenters, one for each channel. They read the news aloud as it breaks, using your browser\u2019s built-in voices. You can mute them any time.'],
  ['How do IPOs work in the game?', 'A few times per game a new company announces an IPO, with a popup wherever you are. You bid for lots and the money leaves your cash at once. At the close, a lucky draw decides who gets shares if demand is higher than supply. Winners keep the shares, everyone else is refunded, and the stock lists the next morning. Most IPOs list higher, but some do not.'],
  ['Can I play with friends?', 'Yes. One person hosts a room and shares a 5-letter code. Everyone trades in the same market and sees the same news, with their own portfolio, and the game ranks you at the end.'],
];
export function landing() {
  const resume = S.user && S.sessions.find((x) => x.status === 'active');
  const cta = resume
    ? `<button class="btn primary lg" data-act="loadgame" data-id="${resume.id}">Continue ${esc(resume.market_name)}</button><button class="btn lg" data-act="enter">Start a new game</button>`
    : `<button class="btn primary lg" data-act="enter">Start playing ${icon('step')}</button><button class="btn lg" data-act="scrollto" data-to="newsroom">See the newsroom</button>`;
  const chans = [['flashwire', 'Flashwire', 'Breaking. Fast. Loud.', 'First to every story, and sometimes first to get it wrong.'], ['marketline', 'Marketline', 'Verified. Measured. Analytical.', 'Slower, careful and rarely wrong. Confirms before it reports.'], ['undercurrent', 'The Undercurrent', 'What they are not telling you.', 'Sources, leaks and suspicions. Often early, never certain.'], ['dailypulse', 'Daily Pulse', 'Your day, in a minute.', 'The calm morning show: the economy and the big picture in plain words.']];
  const steps = [['Pick a name and a mode', 'Play solo, host a room for friends, or join one with a code. A brand-new market is built for every game.', 'users'], ['Read before the bell', 'Each day starts at 8:15 AM, an hour before the open. The overnight news is out and the anchors are on air.', 'news'], ['Trade from 9:15 to 3:30', 'Buy and sell only while the market is open. At 3:30 the day closes, and Next day takes you to 8:15 AM.', 'terminal'], ['Review what you did', 'Every trade gets a review, and your final report grades both your returns and your decisions.', 'portfolio']];
  const feats = [['terminal', 'A real trading terminal', 'Candlestick charts with moving averages, RSI, MACD and Bollinger bands. Market, limit and stop-loss orders, with a clear receipt before you commit.'], ['news', 'News that moves prices', 'Prices react when a story airs and again when its effects arrive. Rumours move the price first, then fade if they are false.'], ['eye', 'Truth Mode and rival bots', 'After each day, see which stories were true, what every company was really worth, and what six bots with different styles did about the news.'], ['users', 'Multiplayer rooms', 'One shared market and one shared news desk. Everyone has a private portfolio and a place on the leaderboard.'], ['clock', 'Real market hours', 'NSE and BSE timings, a pre-open morning, a closing bell and a Next day button. Time moves only when you let it.'], ['rocket', 'IPOs with a lucky draw', 'New companies come to market mid-game. Bid for shares, wait for the draw, and find out whether you got in and whether the debut pops or drops.']];
  const H = { pre: 495, open: 555, close: 930 }; const sp = H.close - H.pre; const at = (m) => (((m - H.pre) / sp) * 100).toFixed(2);
  const lab = [[495, '8:15'], [555, '9:15'], [615, '10:15'], [675, '11:15'], [735, '12:15'], [795, '1:15'], [855, '2:15'], [930, '3:30']];
  return `<div class="land"><header class="land-nav"><div class="ln-in"><div class="brand">${BRAND}<span>BullRun</span></div>
    <nav aria-label="Sections"><button data-act="scrollto" data-to="how">How it works</button><button data-act="scrollto" data-to="newsroom">Newsroom</button><button data-act="scrollto" data-to="hours">Market hours</button><button data-act="scrollto" data-to="modes">Ways to play</button><button data-act="scrollto" data-to="faq">FAQ</button></nav>
    <button class="btn primary" data-act="enter">Play now</button></div></header>
  <main id="land-main">
  <section class="l-hero"><div class="l-wrap"><div class="l-copy"><p class="eyebrow"><i class="live" aria-hidden="true"></i>A stock market you cannot lose real money in</p>
    <h1>Learn the market by <em>running one.</em></h1>
    <p class="l-lede">BullRun builds a brand-new fictional market every game. Invented companies, a newsroom that never switches off, real NSE and BSE trading hours, and ₹1,00,000 to trade. Read the news, make your call, and see what really happened.</p>
    <div class="l-cta">${cta}</div>
    <ul class="l-facts"><li><b>9:15 to 3:30</b><span>real market hours</span></li><li><b>4</b><span>AI news anchors</span></li><li><b>₹1,00,000</b><span>virtual money</span></li><li><b>Up to 8</b><span>players per market</span></li></ul></div>
    <div class="l-visual"><div class="stage land-stage" id="landstage" data-ch="${LAND_SCENES[0].ch}" aria-label="Preview of the live studio inside the game" role="img">${landStageInner(0)}</div><p class="l-cap">A peek at the live studio you get inside every game.</p></div></div></section>

  <section id="land-how" class="l-sec"><div class="l-wrap"><div class="l-head reveal"><p class="eyebrow">How it works</p><h2>From the first headline to your final grade</h2></div>
    <ol class="l-steps">${steps.map((st, i) => `<li class="reveal" style="--d:${i}"><span class="l-num">${i + 1}</span><span class="l-ico">${icon(st[2], 22)}</span><h3>${esc(st[0])}</h3><p>${esc(st[1])}</p></li>`).join('')}</ol></div></section>

  <section id="land-newsroom" class="l-sec alt"><div class="l-wrap"><div class="l-head reveal"><p class="eyebrow">The newsroom</p><h2>Four channels. Four anchors. One market that listens.</h2>
    <p class="l-sub">The studio runs around the clock and reads each story the moment it breaks. The channels do not always agree, and the news is not always true. Prices move after the news, so what you hear and when you hear it matters.</p></div>
    <div class="l-chans">${chans.map((c, i) => `<article class="l-chan reveal" data-ch="${c[0]}" style="--d:${i}"><div class="l-face">${portrait(c[0])}</div><h3>${esc(c[1])}</h3><p class="l-tag">${esc(c[2])}</p><p>${esc(c[3])}</p><p class="l-who">${esc(ANCHORS[c[0]].name)} · ${esc(ANCHORS[c[0]].role)}</p></article>`).join('')}</div></div></section>

  <section id="land-hours" class="l-sec"><div class="l-wrap l-split"><div class="reveal"><p class="eyebrow">Real market hours</p><h2>Trade like the real thing</h2>
    <p class="l-sub">Every day follows the NSE and BSE clock. Before the open you can only read and plan. During the session you can buy and sell. After the close the market is shut until tomorrow.</p>
    <ul class="l-list"><li><b>8:15 AM</b> The morning starts. Overnight news is out, the market is closed.</li><li><b>9:15 AM</b> The opening bell. Prices open, sometimes with a gap, and trading begins.</li><li><b>3:30 PM</b> The closing bell. Orders stop until you press Next day.</li></ul></div>
    <div class="l-clock reveal" style="--d:1"><div class="dayline open"><div class="dl-track"><i class="dl-pre" style="width:${at(H.open)}%"></i><i class="dl-open" style="left:${at(H.open)}%;right:0"></i><b class="dl-now" style="left:${at(735)}%"></b></div><div class="dl-labels" aria-hidden="true">${lab.map((l, i) => `<span class="${i === 1 || i === 7 ? 'key' : ''}" style="left:${at(l[0])}%">${l[1]}</span>`).join('')}</div></div>
    <div class="l-legend"><span><i class="k-pre"></i>Pre-open, closed</span><span><i class="k-open"></i>Market open</span></div></div></div></section>

  <section id="land-learn" class="l-sec alt"><div class="l-wrap"><div class="l-head reveal"><p class="eyebrow">Built for learning</p><h2>Everything a beginner needs, nothing that costs money</h2></div>
    <div class="l-feats">${feats.map((f, i) => `<article class="l-feat reveal" style="--d:${i % 3}"><span class="l-ico">${icon(f[0], 22)}</span><h3>${esc(f[1])}</h3><p>${esc(f[2])}</p></article>`).join('')}</div></div></section>

  <section id="land-modes" class="l-sec"><div class="l-wrap"><div class="l-head reveal"><p class="eyebrow">Ways to play</p><h2>Alone, or against your friends</h2></div>
    <div class="l-modes"><article class="l-mode reveal"><span class="l-ico">${icon('terminal', 22)}</span><h3>Solo</h3><p>You against the market, at your own pace. Pause, think, read every story, then act.</p><ul><li>Choose a 10, 20 or 40 day session</li><li>Pause and plan as long as you like</li><li>Race up to 6 bots: a random player, a headline chaser, a careful sceptic and more</li></ul><button class="btn primary" data-act="enter" data-m="solo">Play solo</button></article>
    <article class="l-mode reveal" style="--d:1"><span class="l-ico">${icon('users', 22)}</span><h3>With friends</h3><p>One market, one news desk, your own portfolio. The host runs the shared clock.</p><ul><li>Share a 5-letter room code</li><li>Everyone sees the same news at the same time</li><li>Ranked on returns and on risk-adjusted skill</li></ul><button class="btn primary" data-act="enter" data-m="friends">Host or join a room</button></article></div></div></section>

  <section id="land-faq" class="l-sec alt"><div class="l-wrap l-narrow"><div class="l-head reveal"><p class="eyebrow">Questions</p><h2>Good to know before you start</h2></div>
    <div class="l-faq reveal">${FAQ.map((q) => `<details><summary>${esc(q[0])}${icon('chevron', 18)}</summary><p>${q[1]}</p></details>`).join('')}</div></div></section>

  <section class="l-final"><div class="l-wrap reveal"><h2>Ready for the opening bell?</h2><p>It is 8:15 AM and the market opens in an hour. The news is already on air.</p><button class="btn lg l-light" data-act="enter">Start playing ${icon('step')}</button></div></section></main>
  <footer class="l-foot"><div class="l-wrap"><div class="brand">${BRAND}<span>BullRun</span></div><p>BullRun is a learning game. All companies, news, anchors and money are fictional, and nothing here is investment advice.</p></div></footer></div>`;
}

export function startScreen() {
  const h = S.health; const dur = (h && h.durations) || {}; const sel = S.startDur || 'standard'; const ai = h && h.ai && h.ai.configured;
  const resume = S.sessions.find((s) => s.status === 'active'); const mode = S.startMode || 'solo'; const hasName = !!S.user || (S.startName || '').trim().length > 1;
  if (S.loadingMsg) return `<div class="loading" role="status"><div class="spin"></div><div><b style="color:var(--text)">${esc(S.loadingMsg)}</b><div class="sub">Inventing companies, news and a few surprises.</div></div></div>`;
  const days = (dur[sel] || { days: 20 }).days; const mins = (k) => Math.max(1, Math.round((days * 7 * SPEED_SEC[k]) / 60));
  return `<div class="start"><aside class="startl"><div class="brand"><svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#15181E"/><path d="M7 21.5l6-7 5 4 7.5-9" fill="none" stroke="#3DDC97" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>BullRun</span></div>
    <h1>Learn how markets work by <em>running one.</em></h1><p class="lede">A brand-new fictional market every time: invented companies, four news channels with their own AI anchors that do not always agree, and ₹1,00,000 of virtual money. Play alone, or race your friends in the same market.</p>
    <svg class="startline" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true"><path class="sl-a" d="M0 96 L30 86 L58 92 L92 62 L124 70 L160 40 L196 52 L232 30 L268 44 L304 18 L340 30 L400 8"/><path class="sl-b" d="M0 104 L40 98 L80 102 L120 88 L170 94 L220 78 L270 84 L320 66 L400 60"/></svg>
    <ul class="startpts"><li><b>4</b> news channels, 4 anchors, 1 market</li><li><b>₹1,00,000</b> of virtual money, no real risk</li><li><b>24/7</b> live newsroom that reads every story</li></ul></aside><div class="startr"><div class="card">
    ${S.view && S.starting ? `<button class="btn ghost sm" data-act="cancelstart" style="justify-self:start">${icon('chevron', 14)} Back to my current game</button>` : `<button class="btn ghost sm" data-act="landhome" style="justify-self:start">${icon('chevron', 14)} Back to home</button>`}
    ${S.netError ? `<div class="banner">${icon('info')}<div style="flex:1"><b>${esc(S.netError)}</b></div><button class="btn sm" data-act="retry">Retry</button></div>` : ''}
    <div><h2 class="st-h">Let's get you on the trading floor</h2><ol class="steps3" aria-label="Steps"><li class="on"><b>1</b>Your name</li><li class="${hasName ? 'on' : ''}"><b>2</b>How to play</li><li class="${hasName ? 'on' : ''}"><b>3</b>Set up</li></ol></div>
    ${S.user ? `<p class="st-welcome">Welcome back, <b>${esc(S.user.name)}</b>. <button class="chip" data-act="logout">Not you?</button></p>` : `<div class="field"><label for="uname">What should we call you?</label><input id="uname" data-in="uname" type="text" maxlength="24" autocomplete="nickname" placeholder="Your name" value="${esc(S.startName || '')}"><span class="fine">This is a local demo sign-in. There is no password, and nothing leaves this server. Friends use their own names.</span></div>`}
    ${resume && S.user ? `<button class="btn block" data-act="loadgame" data-id="${resume.id}">Continue ${esc(resume.market_name)}${resume.mode === 'room' ? ` (room ${esc(resume.code)})` : ''} · ${Math.round((resume.tick / resume.total_ticks) * 100)}% done</button>` : ''}
    <div><div class="lbl" style="margin-bottom:8px">How do you want to play?</div><div class="modes" role="group" aria-label="Mode">
      <button class="mode" data-act="startmode" data-v="solo" aria-pressed="${mode === 'solo'}">${icon('terminal', 22)}<b>Solo</b><span>You against the market. Pause and plan as long as you like.</span></button>
      <button class="mode" data-act="startmode" data-v="host" aria-pressed="${mode === 'host'}">${icon('users', 22)}<b>Host a room</b><span>Friends share one market. You run the clock.</span></button>
      <button class="mode" data-act="startmode" data-v="join" aria-pressed="${mode === 'join'}">${icon('step', 22)}<b>Join a room</b><span>Got a 5-letter code from a friend? Jump in.</span></button></div></div>
    ${mode !== 'join' ? `<div><div class="lbl" style="margin-bottom:8px">How long should the session be?</div><div class="opts" role="group">${Object.entries(dur).map(([k, d]) => `<button class="opt" data-act="dur" data-v="${k}" aria-pressed="${sel === k}"><b>${esc(d.label)}</b><span>${d.days} trading days</span></button>`).join('')}</div></div>` : ''}
    ${mode === 'solo' ? `<details class="more" data-k="seed" ${S.open.seed ? 'open' : ''} style="border:0"><summary style="padding:0">${icon('chevron', 16)} Use a specific seed</summary><div style="padding:10px 0 0"><div class="field"><label for="seedin">Seed (optional)</label><input id="seedin" data-in="seed" type="text" maxlength="40" placeholder="Leave empty for a random market" value="${esc(S.startSeed || '')}"><span class="fine">The same seed always builds the same market, so you can replay one.</span></div></div></details>
      <div><div class="lbl" style="margin-bottom:8px">Play against bots</div><div class="seg" role="group" aria-label="Bots">${[[0, 'No bots'], [3, '3 bots'], [6, 'All 6 bots']].map(([n, l]) => `<button data-act="startbots" data-m="solo" data-v="${n}" aria-pressed="${S.startBots === n}">${l}</button>`).join('')}</div><p class="sub" style="margin-top:6px">Computer players with different styles trade in your market. Truth Mode shows what each one did and why.</p></div>
      <button class="btn primary block lg" data-act="start">Start a solo market</button>` : ''}
    ${mode === 'host' ? `<div class="field"><span class="lbl">Pace of the shared clock</span><div class="seg" role="group" aria-label="Pace">${Object.keys(SPEED_LABEL).map((k) => `<button data-act="startspeed" data-v="${k}" aria-pressed="${S.startSpeed === k}">${SPEED_LABEL[k]} · about ${mins(k)} min</button>`).join('')}</div></div>
      <div><div class="lbl" style="margin-bottom:8px">Add bots to the room</div><div class="seg" role="group" aria-label="Bots">${[[0, 'No bots'], [2, '2 bots'], [4, '4 bots']].map(([n, l]) => `<button data-act="startbots" data-m="room" data-v="${n}" aria-pressed="${S.startRoomBots === n}">${l}</button>`).join('')}</div></div>
      <p class="sub">You get a 5-letter code to share. The market starts when you press Start, and everyone sees the same news and prices.</p><button class="btn primary block lg" data-act="roomcreate">Create a room</button>` : ''}
    ${mode === 'join' ? `<div class="field"><label for="codein">Room code</label><div class="rjoin" style="margin-top:0"><input id="codein" data-in="code" type="text" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE" aria-label="Room code" value="${esc(S.startCode)}"><button class="btn primary" data-act="roomjoin">Join room</button></div><span class="fine">Ask the host for the code. You can join until the host starts the market.</span></div>` : ''}
    <p class="fine">${ai ? 'AI-written scenario text is on. If the AI service is unavailable, the built-in generator takes over automatically and nothing is lost.' : 'Running on the built-in generator, so no AI key is needed. Everything works offline.'} All companies, anchors and money are fictional and for learning only.</p></div></div></div>`;
}


// ---------- multiplayer ----------
const SPEED_LABEL = { fast: 'Fast', normal: 'Normal', relaxed: 'Relaxed' };
const SPEED_SEC = { fast: 2.5, normal: 5, relaxed: 9 };
const speedSeg = (cur, act = 'rspeed') => `<div class="seg" role="group" aria-label="Market pace">${Object.keys(SPEED_LABEL).map((k) => `<button data-act="${act}" data-v="${k}" aria-pressed="${cur === k}">${SPEED_LABEL[k]}</button>`).join('')}</div>`;
function roomCtl(rm) {
  if (rm.status === 'lobby') return rm.host ? `<button class="btn primary" data-act="rctl" data-v="start">${icon('play')}Start the market</button>` : `<span class="chip warn" role="status">Waiting for ${esc(rm.hostName)} to start</span>`;
  if (rm.status === 'running') return rm.host ? `<div class="ctl"><button class="btn" data-act="rctl" data-v="pause">${icon('pause')}Pause</button>${speedSeg(rm.speed)}</div>` : `<span class="chip up" role="status"><i class="live" style="background:var(--up)"></i> Live, shared clock</span>`;
  return rm.host ? `<button class="btn primary" data-act="rctl" data-v="resume">${icon('play')}Resume</button>` : `<span class="chip warn" role="status">Paused by ${esc(rm.hostName)}</span>`;
}
export function lobbyHtml() {
  const v = S.view, rm = v.room; if (!rm || rm.status !== 'lobby') return '';
  const mins = Math.max(1, Math.round((v.days * 7 * SPEED_SEC[rm.speed]) / 60));
  return `<section class="panel lobby" aria-label="Room lobby"><div class="lb-l"><div class="lbl">Room code</div><div class="code" aria-label="Room code ${esc(rm.code.split('').join(' '))}">${esc(rm.code)}</div>
      <p class="sub">Friends choose <b>Join room</b> on the start screen and type this code, or open the invite link.</p><button class="btn sm" data-act="copyinvite">${icon('copy', 15)} Copy invite link</button></div>
    <div class="lb-r"><div class="lbl">In the room (${rm.members.filter((m) => !m.bot).length} of ${rm.maxPlayers}${rm.members.some((m) => m.bot) ? ` · ${rm.members.filter((m) => m.bot).length} bots` : ''})</div><div class="who">${rm.members.map((m) => `<span class="chip ${m.you ? 'sig' : ''}">${esc(m.name)}${m.host ? ' · host' : ''}${m.you ? ' · you' : ''}${m.bot ? ' · bot' : ''}</span>`).join('')}</div>
      ${rm.host ? `<div class="lbl" style="margin-top:14px">Pace of the shared clock</div>${speedSeg(rm.speed)}<div class="sub" style="margin-top:6px">About ${mins} minutes for ${v.days} trading days.</div><button class="btn primary" style="margin-top:12px" data-act="rctl" data-v="start">${icon('play')}Start the market</button>`
        : `<p class="sub" style="margin-top:14px">Waiting for <b>${esc(rm.hostName)}</b> to start. You can read the news while you wait. Orders open at 9:15 AM.</p>`}</div></section>`;
}
const TABS = [['return', 'Return', 'Who grew their money the most.'], ['risk', 'Risk-adjusted', 'Return per unit of ups and downs. Steady gains rank above a lucky gamble.'], ['process', 'Decision quality', 'The average score of your trade reviews: checking news, sizing positions, avoiding panic and chasing.']];
function boardTable(rm, tab, grades) {
  const key = { return: (r) => r.returnPct, risk: (r) => r.risk, process: (r) => (r.process === null ? -1 : r.process) }[tab];
  const rows = rm.board.rows.slice().sort((a, b) => key(b) - key(a)); const hl = (k) => (k === tab ? 'style="color:var(--text);font-weight:650"' : '');
  return `<div class="scroll"><table class="tbl"><thead><tr><th>Rank and player</th><th>Net worth</th><th ${hl('return')}>Return</th><th>Versus market</th><th>Worst fall</th><th ${hl('risk')}>Risk-adjusted</th><th ${hl('process')}>Decision quality</th><th>Trades</th>${grades ? '<th>Grade</th>' : ''}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr ${r.you ? 'class="sel"' : ''}><td><span class="rank">${i + 1}</span> <b>${esc(r.name)}</b>${r.you ? ' <span class="chip sig">You</span>' : ''}${r.bot ? ' <span class="chip">Bot</span>' : ''}</td><td>${inr0(r.netWorth)}</td><td class="${cls(r.returnPct)}" ${hl('return')}>${pct(r.returnPct, 2)}</td><td>${r.beatMarket ? '<span class="chip up">Beating it</span>' : '<span class="chip">Behind</span>'}</td><td>${pct(r.maxDrawdown, 1, false)}</td><td ${hl('risk')}>${r.risk.toFixed(2)}</td><td ${hl('process')}>${r.process === null ? '–' : r.process + '/100'}</td><td>${r.trades}</td>${grades ? `<td><b>${r.grade || '–'}</b></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function rivalsPanel() {
  const rows = (S.view.rivals && S.view.rivals.rows) || []; if (!rows.length) return '';
  const sorted = rows.slice().sort((a, b) => b.returnPct - a.returnPct);
  return `<section class="panel"><div class="ph"><h2>Rivals</h2><button class="btn sm sp" data-act="nav" data-to="board">Full leaderboard</button></div>${sorted.map((r, i) => `<div class="sector"><span class="rank">${i + 1}</span><span style="flex:1"><b>${esc(r.name)}</b>${r.you ? ' <span class="chip sig">You</span>' : ''}${r.bot ? ` <span class="chip">${esc(BOTS[r.bot] ? BOTS[r.bot].trait : 'Bot')}</span>` : ''}</span><span class="${cls(r.returnPct)}" style="font-family:var(--mono)">${pct(r.returnPct, 2)}</span></div>`).join('')}<p class="sub pad" style="padding-top:6px">Their trades stay hidden until <button class="chip" data-act="nav" data-to="truth">Truth Mode</button> reveals them.</p></section>`;
}
export function board() {
  const v = S.view; const rm = v.room || (v.rivals ? { solo: true, code: '', members: v.rivals.rows, board: v.rivals, status: 'running' } : null); if (!rm) return emptyBox('Start a game with bots or friends', 'Leaderboards appear when you play against bots or in a room. Choose bots on the start screen, or create a room.');
  const tab = S.boardTab; const info = TABS.find((t) => t[0] === tab)[2];
  return `<div class="pagehead"><div><h1>Leaderboard</h1><p>${rm.solo ? `You against ${rm.members.length - 1} bot${rm.members.length === 2 ? '' : 's'} in the same market. Their trades stay hidden until Truth Mode reveals them.` : `Room ${esc(rm.code)}: ${rm.members.length} player${rm.members.length === 1 ? '' : 's'}, one shared market. Everyone sees the same prices and news; only your portfolio is yours. Other players' holdings stay private.`}</p></div>${rm.status === 'lobby' ? `<button class="btn sm" style="margin-left:auto" data-act="copyinvite">${icon('copy', 15)} Copy invite link</button>` : ''}</div>${alertHtml()}
  <div class="seg" role="group" aria-label="Ranking">${TABS.map(([id, l]) => `<button data-act="boardtab" data-v="${id}" aria-pressed="${tab === id}">${l}</button>`).join('')}</div><p class="sub" style="margin-top:-8px">${esc(info)}</p>
  <section class="panel">${boardTable(rm, tab, v.status === 'complete')}</section>
  <section class="panel"><div class="ph"><h2>Everyone versus the market</h2></div><div class="pad">${rm.board.curveT.length > 1 ? '<canvas id="boardchart" style="width:100%;height:240px;display:block" role="img" aria-label="Portfolio values of every player compared with the index"></canvas>' : emptyBox('Nothing to chart yet', 'Lines appear once the market starts moving.')}</div></section>`;
}
export function standings() {
  const rm = S.view.room; if (!rm) return '';
  return `<section class="panel"><div class="ph"><h2>Final standings in room ${esc(rm.code)}</h2></div>${boardTable(rm, 'return', true)}<div class="pad sub">Ranked by return. See the Leaderboard tab for risk-adjusted and decision-quality rankings.</div></section>`;
}

// ---------- BullRun Live: the always-on studio and the Previously rail ----------
const spark = (c, n = 30) => { const k = (c.candles || []).slice(-n).map((x) => x.c); if (k.length < 2) return ''; const lo = Math.min(...k), r = (Math.max(...k) - lo) || 1; return `<svg class="spk" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${k.map((y, i) => `${((i / (k.length - 1)) * 100).toFixed(1)},${(22 - ((y - lo) / r) * 20).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`; };
const gtile = (c, since) => { const x = since == null ? c.changePct : since; return `<div class="gtile ${cls(x)}"><b>${esc(c.ticker)}</b><span class="gp">${inr(c.price)}</span><span class="gc">${pct(x, 2)}${since == null ? '' : '<small>since story</small>'}</span>${spark(c)}</div>`; };
export function onAirMini() {
  const L = S.live; const cur = L && L.cur; if (!cur) return '';
  return `<div class="onair-mini" data-ch="${cur.ch}"><button class="om-main" data-act="nav" data-to="news" aria-label="Open BullRun Live"><span class="onair sm"><i class="live"></i>LIVE</span><span class="om-h">${esc(cur.headline)}</span></button><button class="btn iconbtn sm" data-act="sound" aria-pressed="${S.studio.sound}" aria-label="${S.studio.sound ? 'Mute the anchors' : 'Unmute the anchors'}">${icon(S.studio.sound ? 'volume' : 'mute')}</button></div>`;
}
export function tickerHtml() {
  const L = S.live; const v = S.view; const items = (L ? L.history : []).slice(0, 12);
  const dur = Math.max(50, items.length * 9);
  const body = items.length ? items.map((h) => `<span class="tk-i" data-ch="${h.ch}"><em>${esc(chName(h.ch))}</em>${esc(h.headline)}</span>`).join('') : `<span class="tk-i"><em>${esc(v.indexName)}</em>${num(v.index.value)} ${pct(v.index.change, 2)}</span>`;
  return `<div class="tk-tab">${icon('news')}Headlines</div><div class="tk-win"><div class="tk-track" style="--dur:${dur}s;animation-delay:-${(performance.now() / 1000) % dur}s">${body}${body}</div></div>`;
}
export function liveHtml() {
  const L = S.live, sel = S.newsChannel, v = S.view; const cur = L && L.cur;
  const ch = cur ? cur.ch : sel === 'all' ? 'marketline' : sel; const a = ANCHORS[ch];
  const speaking = !!cur && !L.capsDone && !L.paused && S.studio.sound; const hist = L ? L.history : []; const q = liveQueue();
  const label = cur ? cur.label : 'Standing by'; const brk = !!(cur && cur.breaking); const paused = !!(L && L.paused);
  const enter = !!cur && L.enterKey !== cur.key; if (cur) L.enterKey = cur.key;
  const caption = cur ? liveCaptionText() : '';
  const cos = cur ? cur.cos.map((id) => co(id)).filter(Boolean).slice(0, 3) : [];
  const movers = [co(v.gainers[0]), co(v.losers[0])].filter(Boolean);
  const sinceTick = cur ? (cur.since != null ? cur.since : cur.kind === 'story' && cur.tick > 0 ? cur.tick : null) : null;
  const sinceOf = (c) => { if (sinceTick == null) return null; const k = (c.candles || []).find((x) => x.t === sinceTick); return k && k.o ? c.price / k.o - 1 : null; };
  const tiles = `<div class="gtile idx ${cls(v.index.change)}"><b>${esc(v.indexName)}</b><span class="gp">${num(v.index.value)}</span><span class="gc">${pct(v.index.change, 2)}</span></div>` + (cos.length ? cos : movers).slice(0, 2).map((c) => gtile(c, cos.length ? sinceOf(c) : null)).join('');
  const isAd = !!cur && cur.kind === 'ad'; const next = q.find((n) => n.breaking) || q[0];
  const adCard = isAd ? `<div class="adcard" role="note"><span class="adtag">${cur.slate ? 'Please stand by' : 'Advertisement'}</span><b class="adbrand">${esc(cur.brand)}</b><span class="adline">${esc(cur.tag)}</span><small>${cur.slate ? 'Back in a moment' : 'Fictional sponsor. The news returns in a moment.'}</small></div>` : '';
  const T = performance.now() / 1000; const ph = (n) => `-${(T % n).toFixed(2)}s`; // keeps looping animations in phase when the studio is repainted
  const state = paused ? 'PAUSED' : cur && cur.replay ? 'REPLAY' : 'LIVE';
  return `<div class="lvmain"><div class="stage${enter ? ' fresh' : ''}" data-ch="${ch}" style="--d52:${ph(5.2)};--d5:${ph(5)};--d18:${ph(1.8)}"><div class="set">
      <div class="wall" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="animation-delay:-${((T + i * 1.37) % 7).toFixed(2)}s"></i>`).join('')}<b class="sweep" style="animation-delay:${ph(9)}"></b></div><div class="wordmark" aria-hidden="true">BULLRUN<b>LIVE</b></div>
      <div class="bugs"><span class="onair${paused ? ' paused' : ''}"><i class="live"></i>${state}</span><span class="chbug">${esc(chName(ch))}</span></div>
      <div class="clockbug" aria-hidden="true">Day ${v.day} · ${esc(v.clock)}${v.phase === 'open' ? '' : ' · closed'}</div>
      <div class="gfx" aria-hidden="true"><div class="gk">${esc(label)}</div><div class="gtiles">${tiles}</div></div>
      ${isAd ? adCard : figure(ch, { speaking })}
      <div class="desk" aria-hidden="true"><span class="plate">${esc(chName(ch))}</span></div>
      <div class="lt${enter ? ' enter' : ''}"><span class="lt-tab${brk ? ' brk' : ''}">${esc(label)}</span><div class="lt-main"><div class="lt-h">${cur ? esc(cur.headline) : 'Standing by'}</div><div class="lt-s">${isAd ? (cur.slate ? 'Back in a moment' : 'Short break, then back to the news') : `${esc(a.name)} · ${esc(a.role)}${cur ? ' · ' + esc(cur.stamp) : ''}${cur && cur.disputed ? ' · later disputed' : ''}`}</div></div></div>
      <p class="cc" id="prompter" aria-live="off">${esc(caption)}</p>
      ${L && L.blocked && S.studio.sound ? `<button class="unmute" data-act="sound">${icon('volume')}Tap to hear the anchors</button>` : ''}
    </div><div class="ticker" id="stageticker">${tickerHtml()}</div></div>
    <div class="stagebar"><div class="deskctl"><button class="btn" data-act="livepause" aria-pressed="${paused}">${icon(paused ? 'play' : 'pause')}${paused ? 'Resume' : 'Pause'}</button>
        <button class="btn" data-act="liveskip">${icon('step')}Next story</button>
        ${cur && cur.replay ? `<button class="btn primary" data-act="livelive">Back to live</button>` : ''}
        <button class="btn" data-act="newssync" aria-pressed="${S.studio.sync}" title="When on, the market clock waits until the latest story has been read out, so you always hear news before prices react">${icon('clock')}Market waits for news: ${S.studio.sync ? 'on' : 'off'}</button>
        ${hasPhotos() ? `<button class="btn" data-act="look">Anchors: ${S.studio.look === 'photo' ? 'realistic' : 'illustrated'}</button>` : ''}
        ${S.health && S.health.tts && S.health.tts.configured ? `<button class="btn" data-act="voice" aria-pressed="${S.studio.voice !== 'browser'}" title="Natural anchor voices from your ${esc(S.health.tts.provider)} key. Switch to the browser voice any time.">Voice: ${S.studio.voice === 'browser' ? 'browser' : 'AI'}</button>` : ''}
        ${canSpeak() || (S.health && S.health.tts && S.health.tts.configured) ? `<button class="btn" data-act="sound" aria-pressed="${S.studio.sound}">${icon(S.studio.sound ? 'volume' : 'mute')}Sound ${S.studio.sound ? 'on' : 'off'}</button>` : ''}</div>
      <div class="upnext"><b>Up next</b> ${next ? `<span class="cname" data-ch="${next.channel}">${esc(chName(next.channel))}</span> ${esc(next.headline)}${q.length > 1 ? ` <span class="sub">+${q.length - 1} more</span>` : ''}` : '<span class="sub">Market wraps, tips and recaps until the next story lands</span>'}</div></div>
      <p class="sr" role="status" aria-live="polite">${cur ? esc(`${chName(ch)}. ${label}. ${cur.headline}`) : ''}</p></div>
    <aside class="lrail panel" aria-labelledby="prevh"><div class="ph"><h2 id="prevh">Previously</h2><span class="sub sp">Tap a story to replay it</span></div>
      <ol class="lhist" id="lrail">${hist.length ? hist.map((h) => `<li><button class="lh${cur && cur.key === h.key ? ' now' : ''}" data-ch="${h.ch}" data-act="livereplay" data-key="${esc(h.key)}"><span class="cdot" aria-hidden="true"></span><span class="lhb"><span class="lhm"><b class="cname">${esc(chName(h.ch))}</b> <span class="sub">${esc(h.stamp)}</span> <span class="chip ${h.breaking ? 'down' : LABEL_CLS[h.label] || ''}">${esc(h.label)}</span>${h.disputed ? ' <span class="chip warn">Later disputed</span>' : ''}</span><span class="lht">${esc(h.headline)}</span></span></button></li>`).join('') : `<li class="sub pad">Stories that have aired will collect here.</li>`}</ol></aside>`;
}

// ---------- Truth Mode ----------
export const BOTS = {
  headline: { title: 'Headline Hari', trait: 'Fast and trusting', color: '#F26B3A', blurb: 'Hears the news and bids straight away. Believes every channel, including the rumours.' },
  careful: { title: 'Careful Kavya', trait: 'Slow and sceptical', color: '#1F6FD1', blurb: 'Acts only on verified Marketline reports, waits an hour, spreads her money and sets a stop-loss.' },
  coinflip: { title: 'Coin-Flip Chintu', trait: 'Random', color: '#7B4FC9', blurb: 'Plays at random. No reading, no plan, just luck.' },
  trend: { title: 'Trend Tanmay', trait: 'Follows the chart', color: '#0A8754', blurb: 'Buys what has been rising and sells what has been falling. Ignores the news.' },
  value: { title: 'Value Vihaan', trait: 'Patient', color: '#B8860B', blurb: 'Buys healthy, reasonably priced companies on day one and holds them.' },
  panic: { title: 'Panic Pooja', trait: 'Nervous', color: '#D6336C', blurb: 'Buys on good news, then sells everything at the first drop.' },
};
const VERDICT = { true: ['True', 'up', '\u2713'], false: ['False rumour', 'down', '\u2715'], exaggerated: ['Overstated', 'warn', '!'], wrong: ['Wrong way', 'down', '\u2715'], correction: ['Correction', 'sig', '\u21BA'], noise: ['No real effect', '', '\u2022'], locked: ['Locked', '', '?'] };
const VCOL = { true: '#0A8754', false: '#CC3340', exaggerated: '#B26A00', wrong: '#CC3340', correction: '#2447D6', noise: '#8A8F99', locked: '#8A8F99' };
const LESSON = {
  true: 'This one was real. The price moved because the company really did change, and the move arrived over the next few hours rather than all at once.',
  false: 'A rumour. Nothing happened. Traders believed it, so the price jumped, then faded once the truth came out. Rumours move prices first, so wait for a source you trust.',
  exaggerated: 'Something real happened, but the story made it sound bigger than it was. The price over-reacted and then settled back.',
  wrong: 'The story pointed the wrong way. The real effect was the opposite, so anyone who traded on the headline lost.',
  correction: 'A correction. It set the record straight about an earlier story, and the price drifted back.',
  noise: 'Background noise. It did not change any company, so it was not worth trading on.',
};
const pc1 = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const coOf = (id) => S.view.companies.find((c) => c.id === id);
function truthChart(T, c) {
  const W = 900, H = 330, L = 56, R = 14, Tp = 22, B = 56; const ser = c.series; if (ser.length < 2) return '';
  const t0 = ser[0][0], t1 = ser[ser.length - 1][0]; const vals = []; for (const r of ser) { vals.push(r[1]); if (r[2] != null) vals.push(r[2], r[3]); }
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  const line = (i) => { let d = '', on = false; for (const r of ser) { if (r[i] == null) { on = false; continue; } d += `${on ? 'L' : 'M'}${X(r[0]).toFixed(1)},${Y(r[i]).toFixed(1)}`; on = true; } return d; };
  let gap = ''; { let seg = []; const flush = () => { if (seg.length > 1) gap += `M${seg.map((r) => `${X(r[0]).toFixed(1)},${Y(r[3]).toFixed(1)}`).join('L')}L${seg.slice().reverse().map((r) => `${X(r[0]).toFixed(1)},${Y(r[2]).toFixed(1)}`).join('L')}Z`; seg = []; }; for (const r of ser) { if (r[2] == null) flush(); else seg.push(r); } flush(); }
  const grid = [0, 1, 2, 3].map((i) => { const v = lo + ((hi - lo) * i) / 3; return `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="tc-grid"/><text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="tc-ax">${Math.round(v)}</text>`; }).join('');
  let days = ''; for (let t = Math.ceil(Math.max(t0, 1) / 7) * 7; t <= t1; t += 7) days += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${Tp}" y2="${H - B}" class="tc-day"/>`;
  for (let d = Math.floor(t0 / 7) + 1; (d - 1) * 7 + 1 <= t1; d += Math.max(1, Math.ceil((t1 / 7) / 12))) days += `<text x="${X(Math.max(t0, (d - 1) * 7)).toFixed(1)}" y="${H - B + 14}" class="tc-ax" text-anchor="start">Day ${d}</text>`;
  const lk = c.lockedFrom != null ? `<rect x="${X(c.lockedFrom).toFixed(1)}" y="${Tp}" width="${Math.max(0, W - R - X(c.lockedFrom)).toFixed(1)}" height="${H - Tp - B}" fill="url(#tcHatch)"/><text x="${(X(c.lockedFrom) + 8).toFixed(1)}" y="${Tp + 16}" class="tc-lock">Truth locked until this story plays out</text>` : '';
  const sts = T.stories.filter((x) => x.companies.includes(c.id) && x.treatment !== 'background' && x.tick >= t0); const slot = {};
  const marks = sts.map((x) => { const k = x.tick; slot[k] = (slot[k] || 0) + 1; const vk = x.locked ? 'locked' : x.verdict; const cx = X(k), cy = H - B + 32 + (slot[k] - 1) * 15; const sel = S.truthStory === x.seq;
    return `<g class="tmk${sel ? ' sel' : ''}" role="button" tabindex="0" data-act="truthpick" data-seq="${x.seq}" aria-label="${esc(x.headline)}. ${esc(VERDICT[vk][0])}"><circle cx="${cx.toFixed(1)}" cy="${cy}" r="${sel ? 8 : 6.5}" fill="${VCOL[vk]}"/><text x="${cx.toFixed(1)}" y="${cy + 3.6}" text-anchor="middle" class="tc-glyph">${VERDICT[vk][2]}</text><title>${esc(x.headline)}</title></g>`; }).join('');
  const px = {}; for (const r of ser) px[r[0]] = r[1];
  const dot = (tr, kind, col) => { if (px[tr.t] == null) return ''; const x = X(tr.t), y = Y(px[tr.t]); const tip = `${kind} ${tr.side === 'buy' ? 'bought' : 'sold'} ${tr.qty} at \u20B9${tr.price}${tr.note ? '. ' + tr.note : ''}`;
    return kind === 'You' ? `<path d="${tr.side === 'buy' ? `M${x - 6},${y + 9} L${x + 6},${y + 9} L${x},${y - 1}Z` : `M${x - 6},${y - 9} L${x + 6},${y - 9} L${x},${y + 1}Z`}" fill="${tr.side === 'buy' ? '#0A8754' : '#CC3340'}" stroke="#fff" stroke-width="1.5"><title>${esc(tip)}</title></path>` : `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" transform="rotate(45 ${x} ${y})" fill="${col}" stroke="#fff" stroke-width="1"><title>${esc(tip)}</title></rect>`; };
  const mine = S.truthMine ? T.you.trades.filter((t) => t.cid === c.id).map((t) => dot(t, 'You')).join('') : '';
  const bots = S.truthBots ? T.bots.map((b) => b.trades.filter((t) => t.cid === c.id).map((t) => dot(t, b.name, (BOTS[b.style] || {}).color || '#555')).join('')).join('') : '';
  return `<svg class="tchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.name)}: price, real value and believed value, with story markers"><defs><pattern id="tcHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#EFEBDF"/><line x1="0" y1="0" x2="0" y2="8" stroke="#D6D1C0" stroke-width="3"/></pattern></defs>
    ${grid}${days}${lk}<path d="${gap}" fill="rgba(178,106,0,.16)"/><path d="${line(3)}" class="tc-bv"/><path d="${line(2)}" class="tc-fv"/><path d="${line(1)}" class="tc-px"/>${bots}${mine}${marks}</svg>`;
}
function truthStoryCard(T, x) {
  if (!x) return `<div class="empty"><b>Pick a story</b>Tap a marker under the chart, or a row in the table, to see what really happened.</div>`;
  const vk = x.locked ? 'locked' : x.verdict; const vv = VERDICT[vk]; const cos = x.claims.map((cl) => { const c = coOf(cl.cid); return c ? `${c.ticker} ${pc1(cl.pct)}` : ''; }).filter(Boolean).join(', ');
  const real = x.locked ? null : x.hype ? 'The claim was false. The price rose on belief alone, and the company was later exposed.' : x.kind === 'rumor' ? 'Nothing. It never happened.' : vk === 'noise' || vk === 'correction' ? 'No company was really affected.' : x.real && x.real.length ? x.real.map((r) => { const c = coOf(r.cid); return c ? `${c.ticker} ${pc1(r.pct)}` : ''; }).filter(Boolean).join(', ') : 'No company was really affected.';
  const m = x.moves; const acted = [...(T.you.trades.filter((t) => t.seq === x.seq).map((t) => ({ who: 'You', t }))), ...T.bots.flatMap((b) => b.trades.filter((t) => t.seq === x.seq).map((t) => ({ who: b.name, t })))];
  return `<div class="tstory" data-ch="${x.channel}"><div class="meta"><span class="cname">${esc(chName(x.channel))}</span><span class="sub">${esc(stamp(x.tick, x.minute))}</span><span class="chip ${vv[1]}">${vv[2]} ${esc(vv[0])}</span>${x.late ? '<span class="chip warn">Late: already priced in</span>' : ''}${x.early ? '<span class="chip sig">Early scoop</span>' : ''}</div>
    <h3>${esc(x.headline)}</h3>
    <div class="tcols"><div><span class="lbl">The story said</span><p>${esc(cos || 'No specific company')}</p></div><div><span class="lbl">What really happened</span><p>${x.locked ? 'Locked. The effect is still playing out, so the truth unlocks after the market closes.' : esc(real)}</p>${!x.locked && x.effect && x.kind !== 'rumor' && !x.hype && vk !== 'noise' && vk !== 'correction' ? `<p class="sub">Real effect began ${esc(clockOf(x.effect.start))} on day ${dayOf(x.effect.start)} and was fully priced by day ${dayOf(x.effect.full)}.</p>` : ''}</div></div>
    ${m ? `<div class="tmoves"><span class="lbl">Price of ${esc((coOf(m.cid) || {}).ticker || '')} after the story</span><span>1 hour <b class="${cls(m.m1 || 0)}">${m.m1 == null ? 'n/a' : pc1(m.m1)}</b></span><span>3 hours <b class="${cls(m.m3 || 0)}">${m.m3 == null ? 'n/a' : pc1(m.m3)}</b></span><span>6 hours <b class="${cls(m.m6 || 0)}">${m.m6 == null ? 'n/a' : pc1(m.m6)}</b></span></div>` : ''}
    ${x.locked ? '' : `<p class="tlesson">${esc(x.hype ? 'A claim that moves a price before anyone can check it is built on belief. Wait for independent proof, and be ready for the opposite move if it fails.' : LESSON[vk] || '')}</p>`}
    ${acted.length ? `<div class="tacted"><span class="lbl">Who traded on it</span>${acted.map((a) => `<span class="chip ${a.who === 'You' ? 'sig' : ''}">${esc(a.who)} ${a.t.side === 'buy' ? 'bought' : 'sold'} ${a.t.qty} ${esc(a.t.ticker)}</span>`).join('')}</div>` : ''}</div>`;
}
export function truth() {
  const v = S.view, T = S.truth;
  const head = `<div class="pagehead"><div><h1>Truth Mode</h1><p>Every price in BullRun has a cause. Here is what really happened behind the headlines: which stories were true, which were rumours, what each company was really worth, and what every bot did about it.</p></div></div>`;
  if (!T) return head + `<div class="loading"><div class="spin" role="status" aria-label="Loading"></div><p>Loading the truth</p></div>`;
  if (T.empty) return head + `<section class="panel"><div class="empty"><b>Truth Mode opens when the first day closes</b>Once the market closes at ${esc(v.hours.close)}, you can study that day: the real value of every company, the stories that were true or false, and what the bots did. Today stays locked so the truth cannot be used to trade it.</div></section>
    <section class="panel"><div class="pad tlegend-big"><h2 class="st-h" style="font-size:22px">How to read it</h2>${legendHtml()}</div></section>`;
  const cid = S.truthCo && T.companies.some((c) => c.id === S.truthCo) ? S.truthCo : (T.you.trades[0] && T.you.trades[0].cid) || T.companies[0].id;
  const c = T.companies.find((x) => x.id === cid); const stories = T.stories.slice().reverse();
  const sel = T.stories.find((x) => x.seq === S.truthStory) || null;
  const rows = stories.filter((x) => x.treatment !== 'background'); const shown = rows.slice(0, S.truthLimit);
  const status = `<div class="tstatus"><span class="chip ${T.complete ? 'up' : 'sig'}">${icon('eye', 14)} ${T.spoiled && v.status !== 'complete' ? 'Spoiler mode: everything is unlocked' : T.complete ? 'Session finished: everything is unlocked' : `Revealed through day ${T.day}`}</span>${T.lockedStories ? `<span class="chip warn">${T.lockedStories} stor${T.lockedStories === 1 ? 'y' : 'ies'} still playing out</span>` : ''}${T.complete ? '' : `<span class="sub">Stories unlock once they have fully played out, so the truth can never be used to trade today.</span>`}${T.canSpoil ? (S.truthConfirm ? `<span class="tspoil" role="alert"><b>Spoilers ahead.</b> You will see the truth about stories that are still unfolding, and your report will note it. <button class="btn sm primary" data-act="truthspoilyes">Yes, reveal everything</button> <button class="btn sm" data-act="truthspoil">Cancel</button></span>` : `<button class="btn sm" data-act="truthspoil">Reveal everything now</button>`) : ''}${T.spoiled && !T.complete ? '' : ''}</div>`;
  const controls = `<div class="tctl"><div class="field" style="min-width:220px"><label for="tco">Company</label><select id="tco" data-in="truthco">${T.companies.map((x) => `<option value="${x.id}" ${x.id === cid ? 'selected' : ''}>${esc(x.ticker)} · ${esc(x.name)}</option>`).join('')}</select></div>
    <div class="tchecks" role="group" aria-label="Show on chart"><button class="chip tog" data-act="truthmine" aria-pressed="${S.truthMine}">${icon('step', 13)} My trades</button>${T.bots.length ? `<button class="chip tog" data-act="truthbots" aria-pressed="${S.truthBots}">${icon('bot', 13)} Bots' trades</button>` : ''}</div></div>`;
  const legend = `<div class="tlegend"><span><i class="lg-px"></i>Price you could trade at</span><span><i class="lg-fv"></i>Real value</span><span><i class="lg-bv"></i>What the market believed</span><span><i class="lg-gap"></i>Hype gap</span><span><i class="lg-b" style="background:#0A8754"></i>You bought</span><span><i class="lg-s" style="background:#CC3340"></i>You sold</span>${T.bots.length ? '<span><i class="lg-d"></i>Bot trades</span>' : ''}</div>`;
  const ledger = `<div class="scroll"><table class="tbl tled"><thead><tr><th>When</th><th>Channel</th><th>Headline</th><th>Said</th><th>Truth</th><th>3h later</th></tr></thead><tbody>${shown.map((x) => { const vk = x.locked ? 'locked' : x.verdict; const vv = VERDICT[vk]; const say = x.claims.slice(0, 2).map((cl) => { const k = coOf(cl.cid); return k ? `${k.ticker} ${pc1(cl.pct)}` : ''; }).filter(Boolean).join(', ') || 'n/a';
    return `<tr class="click ${S.truthStory === x.seq ? 'sel' : ''}" data-act="truthpick" data-seq="${x.seq}" tabindex="0"><td class="sub">${esc(stamp(x.tick, x.minute))}</td><td><span class="cname" data-ch="${x.channel}">${esc(chName(x.channel))}</span></td><td class="tl-h">${esc(x.headline)}</td><td>${esc(say)}</td><td><span class="chip ${vv[1]}">${vv[2]} ${esc(vv[0])}</span></td><td class="${x.moves ? cls(x.moves.m3 || 0) : ''}">${x.moves && x.moves.m3 != null ? pc1(x.moves.m3) : 'n/a'}</td></tr>`; }).join('')}</tbody></table></div>${rows.length > shown.length ? `<div class="pad" style="text-align:center"><button class="btn" data-act="truthmore">Show older stories</button></div>` : ''}`;
  const actor = (name, sub, color, st, trades, you) => `<article class="tbot ${you ? 'you' : ''}"><div class="tb-h"><span class="tb-av" style="background:${color}">${you ? icon('eye', 16) : icon('bot', 16)}</span><div><b>${esc(name)}</b><div class="sub">${esc(sub)}</div></div></div>
    <div class="tb-st"><span><b>${st.ret >= 0 ? '+' : ''}${(st.ret * 100).toFixed(1)}%</b>return</span><span><b>${st.stats.trades}</b>trades</span><span><b>${st.stats.onNews}</b>on news</span><span title="Bought after a story that turned out false, exaggerated or wrong"><b class="${st.stats.bad ? 'down' : ''}">${st.stats.bad}</b>fooled</span></div>
    <details class="more tb-d"><summary>${icon('chevron', 14)} Recent decisions</summary><ul class="tb-l">${trades.slice(-6).reverse().map((t) => `<li><span class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.qty} ${esc(t.ticker)}</span> <span class="sub">${esc(stamp(t.t, 0))}</span>${t.verdict && t.verdict !== 'locked' ? ` <span class="chip ${(VERDICT[t.verdict] || [])[1] || ''}">${esc((VERDICT[t.verdict] || [''])[0])}</span>` : ''}${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}</li>`).join('') || '<li class="sub">No trades yet.</li>'}</ul></details></article>`;
  return `${head}${status}
  <section class="panel"><div class="ph"><h2>The X-ray</h2><span class="sub sp">${esc(c.name)}</span></div><div class="pad">${controls}${truthChart(T, c)}${legend}</div></section>
  <div class="grid2"><section class="panel"><div class="ph"><h2>What really happened</h2></div><div class="pad">${truthStoryCard(T, sel)}</div></section>
    <section class="panel"><div class="ph"><h2>What the truth says about your play</h2></div><div class="pad"><ul class="tless">${T.lessons.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><div class="tchan"><span class="lbl">Channel track record so far</span>${Object.entries(T.channels).map(([k, ch]) => `<div class="tc-row" data-ch="${k}"><span class="cname">${esc(chName(k))}</span><span class="tc-bar"><i style="width:${Math.round((ch.right / ch.reports) * 100)}%"></i></span><span class="sub">${ch.right} of ${ch.reports} true</span></div>`).join('') || '<p class="sub">No stories have played out yet.</p>'}</div></div></section></div>
  <section class="panel"><div class="ph"><h2>Every story, with the truth</h2><span class="sub sp">${rows.length} stories</span></div>${ledger}</section>
  <section class="panel"><div class="ph"><h2>Rival lab</h2><span class="sub sp">What each player did, and why</span></div><div class="pad tbots">${actor(`You (${T.you.name})`, 'Your decisions', '#15181E', T.you, T.you.trades, true)}${T.bots.map((b) => actor(b.name, `${(BOTS[b.style] || {}).trait || 'Bot'}: ${(BOTS[b.style] || {}).blurb || ''}`, (BOTS[b.style] || {}).color || '#555', b, b.trades, false)).join('')}${T.bots.length ? '' : '<p class="sub">Play with bots to see rivals here. Choose bots on the start screen.</p>'}</div></section>`;
}
function legendHtml() {
  return `<div class="tl-grid"><div><i class="lg-px"></i><b>Price</b><p>What you could actually trade at.</p></div><div><i class="lg-fv"></i><b>Real value</b><p>What the company was really worth. Only the game knows this.</p></div><div><i class="lg-bv"></i><b>Believed value</b><p>What traders thought it was worth after reading the news.</p></div><div><i class="lg-gap"></i><b>Hype gap</b><p>The space between belief and reality. A rumour opens it, the truth closes it.</p></div></div>`;
}

// ---------- IPOs ----------
export function achvHtml(n) {
  const conf = n.confetti ? `<div class="achv-conf" aria-hidden="true">${Array.from({ length: 22 }, (_, i) => `<i style="--x:${((i * 37) % 200) - 100}px;--d:${(i % 7) * 0.05}s;--c:${['#F5B301', '#3DDC97', '#fff', '#7FB2FF', '#FF7A7D'][i % 5]}"></i>`).join('')}</div>` : '';
  return `<div class="achv-wrap ${n.tone}"><div class="achv-card"><div class="achv-medal" aria-hidden="true"><svg viewBox="0 0 64 64"><defs><radialGradient id="aG" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="var(--ac2)"/><stop offset="1" stop-color="var(--ac)"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="url(#aG)" stroke="rgba(255,255,255,.5)" stroke-width="2"/><circle cx="32" cy="32" r="23" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-dasharray="2 4"/><path d="M32 14l4.6 10.2 11.1 1.2-8.3 7.5 2.4 10.9L32 38l-9.8 5.8 2.4-10.9-8.3-7.5 11.1-1.2z" fill="#fff"/></svg><i class="achv-shine"></i></div>
    <div class="achv-text"><span class="achv-kicker">${esc(n.kicker)}</span><b>${esc(n.title)}</b><span class="achv-sub">${esc(n.sub)}</span></div><button class="achv-x" data-act="achvclose" aria-label="Dismiss notification">\u00D7</button></div>
    <button class="achv-see" data-act="achvsee" data-ipo="${esc(n.ipoId)}">See ${icon('step', 16)}</button>${conf}</div>`;
}
const IPO_STATUS = { open: ['Open for bidding', 'up'], closed: ['Allotment done, lists tomorrow', 'warn'], listed: ['Listed', 'sig'] };
function ipoTimeline(i) {
  const d = dayOf(i.openTick); const steps = [['Bidding opens', `Day ${d} \u00B7 9:15 AM`], ['Bidding closes', `Day ${d} \u00B7 3:30 PM`], ['Lucky draw', 'At the close'], ['Refund and listing', `Day ${d + 1} \u00B7 9:15 AM`]];
  const at = i.status === 'open' ? 1 : i.status === 'closed' ? 3 : 4;
  return `<ol class="ipo-steps" aria-label="IPO timeline">${steps.map((st, k) => `<li class="${k < at ? 'done' : k === at ? 'now' : ''}"><i>${k < at ? '\u2713' : k + 1}</i><b>${esc(st[0])}</b><span>${esc(st[1])}</span></li>`).join('')}</ol>`;
}
function ipoBidPanel(i) {
  const v = S.view, pf = v.portfolio;
  if (i.status === 'open') {
    const free = pf.available + (i.you ? i.you.amount : 0); const max = Math.max(0, Math.min(i.maxLots, Math.floor(free / i.lotCost)));
    const lots = Math.max(1, Math.min(Math.max(1, max), S.ipoLots || (i.you ? i.you.lots : 1))); const amt = lots * i.lotCost;
    const odds = i.sub <= 1 ? 'Demand is below the shares on offer right now, so everyone who bids is allotted.' : `Demand is ${i.sub.toFixed(1)} times the shares on offer. When it is oversubscribed, a lucky draw picks who gets shares, roughly ${Math.round(Math.max(0.12, Math.min(0.96, 2.2 / (1 + i.sub))) * 100)}% of applicants at this level. Demand keeps rising until the close, so the odds only get worse.`;
    return `<div class="ipo-bid"><h3>Place your bid</h3>
      <div class="ipo-lots"><span class="lbl">Lots (1 lot = ${i.lotSize} shares)</span><div class="stepper"><button class="btn iconbtn" data-act="ipolots" data-d="-1" aria-label="Fewer lots" ${lots <= 1 ? 'disabled' : ''}>\u2212</button><b aria-live="polite">${lots}</b><button class="btn iconbtn" data-act="ipolots" data-d="1" aria-label="More lots" ${lots >= max ? 'disabled' : ''}>+</button></div></div>
      <div class="receipt"><div class="r"><span>Shares</span><span>${lots * i.lotSize}</span></div><div class="r"><span>Price per share</span><span>${inr(i.issuePrice)}</span></div><div class="r tot"><span>Money blocked now</span><span>${inr0(amt)}</span></div><div class="r"><span>Cash left to spend</span><span>${inr0(free - amt)}</span></div></div>
      <p class="sub">${esc(odds)} If you are not allotted, or only get part of your bid, the unused money comes back when the stock lists tomorrow at 9:15 AM. Bidding for more lots does not improve your chance of being picked, only how much you receive if you are.</p>
      ${max < 1 ? '<div class="banner warn">You do not have enough free cash for even one lot.</div>' : i.you ? `<div class="ipo-btns"><button class="btn primary" data-act="ipobid">Update bid to ${lots} lot${lots > 1 ? 's' : ''}</button><button class="btn" data-act="ipocancel">Cancel bid</button></div><p class="sub">Your current bid: ${i.you.lots} lot${i.you.lots > 1 ? 's' : ''}, ${inr0(i.you.amount)} blocked.</p>` : `<button class="btn primary block lg" data-act="ipobid">Bid ${inr0(amt)}</button>`}</div>`;
  }
  if (!i.you) return `<div class="ipo-bid"><h3>${i.status === 'listed' ? 'You did not bid' : 'Bidding has closed'}</h3><p class="sub">${i.status === 'listed' ? `The stock is now trading.` : 'The lucky draw is done and the stock lists tomorrow at 9:15 AM.'}</p>${i.status === 'listed' ? `<button class="btn primary" data-act="trade" data-id="${esc(i.companyId)}">Trade ${esc(i.ticker)}</button>` : ''}</div>`;
  const won = i.you.shares > 0;
  return `<div class="ipo-bid"><div class="ipo-result ${won ? 'win' : 'lose'}"><b>${won ? `Congratulations, you got the IPO` : `Sorry, you did not get the IPO`}</b><span>${won ? `You were allotted ${i.you.shares} shares at ${inr(i.issuePrice)} (${inr0(i.you.cost)}).` : `The IPO was oversubscribed and the lucky draw did not pick you.`}</span></div>
    <div class="receipt"><div class="r"><span>Your bid</span><span>${inr0(i.you.amount)}</span></div><div class="r"><span>Shares allotted</span><span>${i.you.shares}</span></div><div class="r"><span>Money refunded</span><span>${inr0(i.you.refund)}${i.status === 'closed' ? ' (at listing)' : ''}</span></div></div>
    ${i.listed ? `<p class="ipo-perf">${won ? `Your ${i.you.shares} shares are worth ${inr0(i.you.shares * i.listed.now)} now: <b class="${cls(i.listed.now - i.issuePrice)}">${i.listed.now >= i.issuePrice ? '+' : '\u2212'}${inr0(Math.abs(i.you.shares * (i.listed.now - i.issuePrice)))}</b> against what you paid.` : `It listed ${pct(i.listed.gain, 1)} on day one. Missing out is part of IPOs: demand is usually bigger than supply.`}</p><button class="btn primary" data-act="trade" data-id="${esc(i.companyId)}">Trade ${esc(i.ticker)}</button>` : ''}</div>`;
}
function ipoDetail(i) {
  const f = i.fund; const st = IPO_STATUS[i.status]; const pe = i.pe; const rng = i.peTypical;
  const peNote = pe == null ? 'The company is not making a profit yet, so there is no P/E.' : rng ? (pe > rng[1] * 1.15 ? `High for this industry (typically ${rng[0]} to ${rng[1]}). You are paying a lot for each rupee of profit.` : pe < rng[0] * 0.85 ? `Low for this industry (typically ${rng[0]} to ${rng[1]}).` : `In the normal range for this industry (typically ${rng[0]} to ${rng[1]}).`) : '';
  const meter = Math.min(100, (i.sub / 15) * 100);
  return `<section class="panel ipo-main"><div class="pad"><div class="ipo-head"><div><div class="sub">${esc(i.industry)} · ${esc(i.ticker)}</div><h2>${esc(i.fullName || i.name)}</h2></div><span class="chip ${st[1]}">${st[0]}</span></div>${ipoTimeline(i)}
    <p class="ipo-about">${esc(i.description)}</p><p class="sub">It is raising about ${inr0(i.issueCr)} crore ${esc(i.use)}.</p>
    <div class="ipo-offer"><div><span>Issue price</span><b>${inr(i.issuePrice)}</b></div><div><span>1 lot</span><b>${i.lotSize} shares</b><em>${inr0(i.lotCost)}</em></div><div><span>Market value at this price</span><b>${inr0(i.marketCap)} cr</b></div>${i.gmp != null ? `<div><span>Grey market premium</span><b class="${cls(i.gmp)}">${pct(i.gmp, 1)}</b><em>unofficial buzz, can be wrong</em></div>` : `<div><span>Listed at</span><b>${inr(i.listed ? i.listed.price : i.issuePrice)}</b><em class="${cls(i.listed ? i.listed.gain : 0)}">${i.listed ? pct(i.listed.gain, 1) : ''}</em></div>`}</div>
    <div class="ipo-demand"><span class="lbl">Demand</span><div class="ipo-meter" role="img" aria-label="Subscribed ${i.sub.toFixed(1)} times"><i style="width:${meter}%"></i><b style="left:${(1 / 15) * 100}%"></b></div><span class="sub">${i.sub.toFixed(1)}\u00D7 subscribed ${i.status === 'open' ? '(still rising until 3:30 PM)' : ''}. The mark is 1\u00D7: below it everyone gets shares, above it a lucky draw decides.</span></div>
    <h3 class="ipo-h3">The business in numbers</h3>
    <dl class="kv ipo-kv"><dt>Revenue (last year)</dt><dd>${inr0(f.revenue)} cr</dd><dt>Profit</dt><dd class="${cls(f.profit)}">${inr0(f.profit)} cr</dd><dt>Debt</dt><dd>${inr0(f.debt)} cr</dd><dt>Price vs profit (P/E)</dt><dd>${pe == null ? 'n/a' : pe + '\u00D7'}</dd><dt>Balance sheet</dt><dd><span class="chip ${i.balance === 'Strong' ? 'up' : i.balance === 'Stretched' ? 'down' : 'warn'}">${esc(i.balance)}</span></dd><dt>Risk</dt><dd>${esc(i.risk)}</dd></dl>
    <p class="sub">${esc(peNote)}</p>
    <p class="ipo-risk">${icon('info', 16)}<span>Most IPOs list higher than their issue price, because demand is usually bigger than supply. Some do not. Weak numbers and a high price are the usual warning signs, and early gains can fade over the following days.</span></p></div></section>
    <section class="panel">${ipoBidPanel(i)}</section>`;
}
export function ipo() {
  const v = S.view; const list = (v.ipos || []).slice().reverse();
  const head = `<div class="pagehead"><div><h1>IPOs</h1><p>From time to time a company comes to market for the first time. You bid for shares, a lucky draw decides who gets them, and the company joins the market the next morning.</p></div></div>`;
  const how = `<details class="more ipo-how panel" ${list.length ? '' : 'open'}><summary>${icon('chevron', 16)} How an IPO works</summary><div class="ipo-how-g"><div><b>1. Bid</b><p>While bidding is open you choose how many lots you want. The money is taken from your cash straight away.</p></div><div><b>2. Lucky draw</b><p>At the close, if more people wanted shares than exist, a draw picks the winners.</p></div><div><b>3. Allotment and refund</b><p>Winners keep their shares. Everyone else, and any unused part of a bid, gets the money back at listing.</p></div><div><b>4. Listing</b><p>Next morning the stock starts trading. It often opens above the issue price, but not always.</p></div></div></details>`;
  if (!list.length) return head + how + `<section class="panel"><div class="empty"><b>No IPO has opened yet</b>When a company announces one, a popup appears wherever you are in the game. Keep playing, and keep some cash free.</div></section>`;
  const sel = list.find((i) => i.id === S.ipoSel) || list.find((i) => i.status === 'open') || list[0];
  return head + how + `<div class="ipo-grid"><aside class="panel ipo-list"><div class="ph"><h2>All IPOs</h2></div>${list.map((i) => `<button class="ipo-card ${i.id === sel.id ? 'sel' : ''}" data-act="iposel" data-id="${i.id}"><b>${esc(i.name)}</b><span class="chip ${IPO_STATUS[i.status][1]}">${IPO_STATUS[i.status][0]}</span><span class="sub">${esc(i.industry)} · ${inr(i.issuePrice)}${i.listed ? ` · listed ${pct(i.listed.gain, 1)}` : ''}</span>${i.you ? `<span class="sub">${i.you.shares ? `Allotted ${i.you.shares} shares` : i.status === 'open' || i.status === 'closed' && !i.you.shares && i.you.status === 'bid' ? `Your bid: ${i.you.lots} lot${i.you.lots > 1 ? 's' : ''}` : 'Not allotted'}</span>` : ''}</button>`).join('')}</aside><div class="ipo-detail">${ipoDetail(sel)}</div></div>`;
}
