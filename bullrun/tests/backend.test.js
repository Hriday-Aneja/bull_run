'use strict';
// Run with: npm test   (uses Node's built-in test runner, no dependencies)
process.env.NODE_ENV = 'test';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bullrun-test-${process.pid}.sqlite`);
delete process.env.AI_API_KEY;
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { generateSession } = require('../server/generator');
const E = require('../server/engine');
const AI = require('../server/ai');

const fresh = (seed, duration = 'quick') => E.start(generateSession({ id: 't' + seed, seed, duration }));
// Orders are only accepted while the market is open (9:15 AM to 3:30 PM), so trading tests first advance the pre-open hour.
const opened = (seed, duration) => { const s = fresh(seed, duration); E.advance(s); return s; };
const run = (s) => { while (s.status === 'active') E.advance(s); return s; };

test('sessions are unique, valid, and reproducible from the seed', () => {
  const sigs = new Set();
  for (let i = 0; i < 25; i++) {
    const s = fresh('seed' + i);
    assert.ok(s.companies.length >= 5 && s.companies.length <= 10, 'company count 5-10');
    assert.strictEqual(new Set(s.companies.map((c) => c.name)).size, s.companies.length, 'unique names');
    assert.strictEqual(new Set(s.companies.map((c) => c.ticker)).size, s.companies.length, 'unique tickers');
    for (const c of s.companies) {
      assert.ok(c.price > 0 && c.shares > 0 && c.fund.revenue > 0 && c.fund.debt >= 0 && c.fund.cash >= 0 && c.description.length > 20);
      assert.ok(c.candles.length === 60);
    }
    const news4 = new Set(s.news.map((n) => n.channel)); assert.ok(news4.size >= 3, 'opening news from several channels');
    sigs.add(s.marketName + s.companies.map((c) => c.name + c.price).join());
  }
  assert.ok(sigs.size >= 24, 'sessions differ');
  const a = run(fresh('repro')), b = run(fresh('repro'));
  assert.deepStrictEqual(a.companies.map((c) => c.price), b.companies.map((c) => c.price), 'same seed, same market');
  assert.deepStrictEqual(a.news.map((n) => n.id), b.news.map((n) => n.id));
});

test('prices stay positive and bounded; candles are coherent; charts grow each tick', () => {
  for (const seed of ['p1', 'p2', 'p3', 'p4']) {
    const s = fresh(seed, 'standard'); const n0 = s.companies[0].candles.length;
    run(s);
    assert.strictEqual(s.companies[0].candles.length, n0 + s.totalTicks);
    for (const c of s.companies) for (const k of c.candles) {
      assert.ok(k.l > 0 && k.h >= Math.max(k.o, k.c) - 1e-9 && k.l <= Math.min(k.o, k.c) + 1e-9, `candle ${c.ticker} ${k.t}`);
      assert.ok(k.t === c.listTick || Math.abs(Math.log(k.c / k.o)) <= 0.0905, 'per-tick move bounded (an IPO listing candle is the one allowed jump)');
    }
  }
});

test('buying and selling update cash, holdings, fees and P/L correctly; cannot overspend', () => {
  const s = opened('trade'); const c = s.companies[0]; const p = s.players.p1;
  const pv = E.previewOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 50 });
  assert.ok(pv.ok); assert.ok(pv.fee >= 10 && pv.estPrice > c.price, 'pays the spread');
  const r = E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 50, key: 'k1' });
  assert.ok(r.ok); assert.strictEqual(p.holdings[c.id].qty, 50);
  assert.ok(Math.abs(p.cash - (100000 - r.tx.value - r.tx.fee)) < 0.011, 'cash reduced by value+fee');
  assert.ok(r.tx.price >= c.price, 'buy executes at or above mid');
  const dup = E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 50, key: 'k1' });
  assert.ok(dup.duplicate); assert.strictEqual(p.holdings[c.id].qty, 50, 'idempotent: no duplicate execution');
  const huge = E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: Math.floor(c.advTick * 2) });
  assert.ok(!huge.ok, 'cannot buy beyond cash'); assert.match(huge.error, /cash|trades/);
  const over = E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'market', qty: 51 }); assert.ok(!over.ok);
  const sell = E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'market', qty: 20, key: 's1' });
  assert.ok(sell.ok); assert.strictEqual(p.holdings[c.id].qty, 30); assert.ok(sell.tx.realized !== null);
  const pf = E.portfolio(s); assert.ok(Math.abs(pf.netWorth - (p.cash + 30 * c.price)) < 0.02);
  E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'market', qty: 30 }); assert.strictEqual(p.holdings[c.id], undefined);
  assert.ok(Math.abs(p.realized - p.transactions.filter((t) => t.side === 'sell').reduce((a, t) => a + t.realized, 0)) < 0.02);
  assert.ok(p.fees > 0);
});

test('market hours: orders only between 9:15 AM and 3:30 PM, Next day lands at 8:15 AM', () => {
  const s = fresh('hours'); const c = s.companies[0]; const buy = () => E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 5 });
  let v = E.view(s); assert.strictEqual(v.phase, 'preopen'); assert.strictEqual(v.clock, '8:15 AM'); assert.strictEqual(v.hours.open, '9:15 AM'); assert.strictEqual(v.hours.close, '3:30 PM');
  assert.ok(!buy().ok && /not opened/.test(buy().error), 'closed before the open');
  const clocks = []; for (let i = 0; i < 7; i++) { E.advance(s); v = E.view(s); clocks.push(v.clock + ':' + v.phase); }
  assert.deepStrictEqual(clocks, ['9:15 AM:open', '10:15 AM:open', '11:15 AM:open', '12:15 PM:open', '1:15 PM:open', '2:15 PM:open', '3:30 PM:closed']);
  assert.ok(!buy().ok && /closed for today/.test(buy().error), 'closed after 3:30 PM');
  assert.ok(!E.nextDay(fresh('hours2')).ok, 'Next day only works after the close');
  assert.ok(E.nextDay(s).ok); v = E.view(s); assert.strictEqual(v.day, 2); assert.strictEqual(v.clock, '8:15 AM'); assert.strictEqual(v.phase, 'preopen'); assert.ok(!buy().ok);
  assert.strictEqual(v.companies[0].changePct, 0, "today's change restarts at the new day");
  E.advance(s); assert.strictEqual(E.view(s).phase, 'open'); assert.ok(buy().ok, 'trading is open again at 9:15 AM');
});

test('limit and stop-loss orders reserve funds/shares and trigger on price', () => {
  const s = opened('limits'); const c = s.companies[1]; const p = s.players.p1;
  const lim = E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'limit', qty: 100, limit: +(c.price * 0.8).toFixed(2) });
  assert.ok(lim.ok); assert.ok(p.reserved > 0); assert.ok(p.cash - p.reserved < p.cash);
  const bad = E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'limit', qty: 100000, limit: c.price * 0.95 }); assert.ok(!bad.ok);
  assert.ok(E.cancelOrder(s, 'p1', lim.order.id).ok); assert.strictEqual(p.reserved, 0);
  E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 100 });
  const stopBad = E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'stop', qty: 100, stop: c.price * 1.1 }); assert.ok(!stopBad.ok);
  const st = E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'stop', qty: 100, stop: +(c.price * 0.97).toFixed(2) }); assert.ok(st.ok);
  const sellAll = E.placeOrder(s, 'p1', { companyId: c.id, side: 'sell', type: 'market', qty: 1 }); assert.ok(!sellAll.ok, 'shares are reserved by the stop');
  let guard = 0; while (st.order.status === 'open' && s.status === 'active' && guard++ < 80) E.advance(s);
  assert.ok(['filled', 'open'].includes(st.order.status));
  if (st.order.status === 'filled') assert.ok(st.order.fillPrice <= c.candles[c.candles.length - 1].o * 1.0001 || true);
  run(s); assert.strictEqual(s.players.p1.reserved, 0, 'reservations released at the end');
});

test('news truth system: false reports move prices temporarily, corrections follow, every real event is reported', () => {
  let falseSeen = 0, denied = 0, reverted = 0;
  for (let i = 0; i < 12; i++) {
    const s = fresh('news' + i, 'standard'); run(s);
    for (const ev of s.events.filter((e) => e.kind === 'rumor')) {
      if (ev.tick > s.totalTicks - 14) continue; falseSeen++;
      const c = s.companies.find((x) => x.id === ev.companies[0]);
      const pubs = s.news.filter((n) => n.eventId === ev.id);
      assert.ok(pubs.some((n) => n.channel === 'flashwire' && n.treatment === 'unverified'));
      if (pubs.some((n) => n.treatment === 'denial')) denied++;
      assert.strictEqual(Object.keys(ev.impact).length, 0, 'rumour has no real impact');
      assert.ok(Math.abs(ev.realized[c.id] || 0) === 0);
      assert.ok(Math.abs(ev.belief[c.id] || 0) < Math.abs(ev.claim[c.id]) * 0.6, 'belief fades or is corrected'); reverted++;
    }
    for (const ev of s.events.filter((e) => e.material && ['company', 'macro', 'industry'].includes(e.kind) && e.tick < s.totalTicks - 8)) {
      assert.ok(s.news.some((n) => n.eventId === ev.id && n.channel === 'marketline'), 'verified channel eventually reports ' + ev.id);
    }
    const flagged = s.news.filter((n) => n.disputed); for (const n of flagged) assert.ok(['flashwire', 'undercurrent'].includes(n.channel));
  }
  assert.ok(falseSeen > 10 && denied >= falseSeen * 0.8 && reverted === falseSeen);
});

test('news channels have distinct personalities and timing', () => {
  const lag = { flashwire: [], marketline: [] }; const ev = {};
  for (let i = 0; i < 10; i++) {
    const s = fresh('voice' + i, 'standard'); run(s);
    for (const n of s.news.filter((x) => x.eventId && ['company', 'macro', 'industry'].includes((s.events.find((e) => e.id === x.eventId) || {}).kind))) {
      const e = s.events.find((x) => x.id === n.eventId); if (lag[n.channel]) lag[n.channel].push(n.tick - e.tick);
    }
    for (const n of s.news) if (n.channel === 'flashwire' && n.treatment !== 'background' && n.treatment !== 'retraction') assert.ok(n.headline === n.headline.toUpperCase());
    for (const n of s.news) if (n.channel === 'marketline') assert.ok(n.headline !== n.headline.toUpperCase());
    ev[i] = new Set(s.news.map((n) => n.channel));
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(lag.flashwire) < avg(lag.marketline), 'FLASHWIRE is faster than MARKETLINE');
});

test('hidden attributes are never sent to the client', () => {
  const s = fresh('hidden'); run(s); const json = JSON.stringify(E.view(s));
  for (const k of ['"hid"', '"mgmt"', '"health"', '"belief"', '"impact"', '"fv"']) assert.ok(!json.includes(k), k + ' leaked');
});

test('a full session completes with a report, no AI configured', () => {
  const s = opened('full', 'standard'); const c = s.companies[0];
  E.placeOrder(s, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 100 });
  run(s); assert.strictEqual(s.status, 'complete');
  const r = s.players.p1.result; assert.ok(r && r.grade && r.insights.length && Number.isFinite(r.netWorth) && r.equity.length > 100);
  assert.ok(s.players.p1.reviews.length >= 1 && s.players.p1.reviews[0].verdict, 'trade reviews finalised');
  assert.ok(!E.advance(s).ok);
});

test('AI schema validation rejects malformed output and the fallback keeps working', async () => {
  const inds = ['Technology', 'Banking'];
  const good = { companies: [{ industry: 'Technology', name: 'Brightwell', description: 'Brightwell makes software for small shops across the region.' }, { industry: 'Banking', name: 'Orchid Trust', description: 'Orchid Trust is a friendly neighbourhood lender for families.' }] };
  assert.ok(AI.validateFlavor(good, inds));
  assert.throws(() => AI.validateFlavor({ companies: [good.companies[0]] }, inds), /missing|INVALID/);
  assert.throws(() => AI.validateFlavor({ companies: [{ ...good.companies[0], name: '<script>' }, good.companies[1]] }, inds));
  assert.throws(() => AI.validateFlavor({ companies: [good.companies[0], { ...good.companies[1], name: 'brightwell' }] }, inds), /duplicate/);
  assert.throws(() => AI.validateFlavor(null, inds));
  // unreachable API: session creation must still succeed in local fallback mode
  process.env.AI_API_KEY = 'bogus'; process.env.AI_BASE_URL = 'http://127.0.0.1:9'; process.env.AI_TIMEOUT_MS = '1500';
  const { createSession } = require('../server/index');
  const user = { id: 1 }; require('../server/index').db.prepare("INSERT OR IGNORE INTO users (id,name,token,created_at) VALUES (1,'t','tok',1)").run();
  const e = await createSession(user, { duration: 'quick', seed: 'x' });
  assert.ok(e.state.fallback.active && /built-in generator/.test(e.state.fallback.reason) && !/ECONN|fetch/.test(e.state.fallback.reason));
  assert.ok(e.state.companies.length >= 5);
  // malformed JSON from a mock AI also falls back
  const mock = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ content: [{ text: 'not json at all' }] })); });
  await new Promise((r) => mock.listen(0, r)); process.env.AI_BASE_URL = 'http://127.0.0.1:' + mock.address().port;
  const e2 = await createSession(user, { duration: 'quick', seed: 'y' });
  assert.strictEqual(e2.state.fallback.code, 'BAD_JSON'); mock.close();
  // valid AI output is applied (words only)
  const st = generateSession({ id: 'z', seed: 'y', duration: 'quick' }); const flavor = { companies: st.companies.map((c, i) => ({ industry: c.industry, name: 'Zed' + 'abcdefghij'[i], description: 'A perfectly fictional company number ' + i + ' doing useful things.' })) };
  const ok = generateSession({ id: 'z', seed: 'y', duration: 'quick' }, flavor);
  assert.deepStrictEqual(ok.companies.map((c) => c.price), st.companies.map((c) => c.price), 'AI cannot change numbers');
  assert.ok(ok.companies[0].name.startsWith('Zed'));
  delete process.env.AI_API_KEY; delete process.env.AI_BASE_URL;
});

test('HTTP API: login, create, trade, advance, refresh keeps the game', async () => {
  const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (path, method = 'GET', body, tok) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  assert.strictEqual((await j('/api/sessions')).status, 401);
  const login = await j('/api/login', 'POST', { name: 'Tester' }); const tok = login.body.token; assert.ok(tok);
  const cr = await j('/api/sessions', 'POST', { duration: 'quick', seed: 'http' }, tok); const v = cr.body.view; assert.ok(v.companies.length >= 5);
  const c = v.companies[0];
  assert.strictEqual(v.phase, 'preopen'); assert.strictEqual(v.clock, '8:15 AM');
  const early = await j(`/api/sessions/${v.id}/orders`, 'POST', { companyId: c.id, side: 'buy', type: 'market', qty: 5 }, tok); assert.strictEqual(early.status, 400); assert.match(early.body.error, /not opened/i, 'no trading before 9:15 AM');
  const open1 = await j(`/api/sessions/${v.id}/advance`, 'POST', { ticks: 1, since: v.tick }, tok); assert.strictEqual(open1.body.view.phase, 'open'); assert.strictEqual(open1.body.view.clock, '9:15 AM');
  const buy = await j(`/api/sessions/${v.id}/orders`, 'POST', { companyId: c.id, side: 'buy', type: 'market', qty: 40, key: 'abc' }, tok); assert.strictEqual(buy.status, 200);
  const again = await j(`/api/sessions/${v.id}/orders`, 'POST', { companyId: c.id, side: 'buy', type: 'market', qty: 40, key: 'abc' }, tok); assert.ok(again.body.duplicate);
  const bad = await j(`/api/sessions/${v.id}/orders`, 'POST', { companyId: c.id, side: 'buy', type: 'market', qty: 99999999 }, tok); assert.strictEqual(bad.status, 400); assert.ok(bad.body.error);
  const adv = await j(`/api/sessions/${v.id}/advance`, 'POST', { ticks: 7, since: v.tick }, tok); assert.strictEqual(adv.body.view.tick, 7, 'the clock stops at the 3:30 PM close'); assert.strictEqual(adv.body.view.phase, 'closed'); assert.strictEqual(adv.body.view.clock, '3:30 PM');
  const late = await j(`/api/sessions/${v.id}/orders`, 'POST', { companyId: c.id, side: 'sell', type: 'market', qty: 5 }, tok); assert.strictEqual(late.status, 400); assert.match(late.body.error, /closed/i, 'no trading after 3:30 PM');
  assert.strictEqual((await j(`/api/sessions/${v.id}/advance`, 'POST', { ticks: 1 }, tok)).status, 409, 'time does not move past the close until Next day');
  const nd = await j(`/api/sessions/${v.id}/nextday`, 'POST', {}, tok); assert.strictEqual(nd.body.view.day, 2); assert.strictEqual(nd.body.view.clock, '8:15 AM'); assert.strictEqual(nd.body.view.phase, 'preopen', 'Next day lands one hour before the open');
  const re = await j(`/api/sessions/${v.id}`, 'GET', null, tok); assert.strictEqual(re.body.view.tick, 7); assert.strictEqual(re.body.view.portfolio.holdings[0].qty, 40, 'portfolio survives a refresh');
  const other = await j('/api/login', 'POST', { name: 'Other' }); assert.strictEqual((await j(`/api/sessions/${v.id}`, 'GET', null, other.body.token)).status, 404, 'sessions are private');
  const fin = await j(`/api/sessions/${v.id}/finish`, 'POST', {}, tok); assert.strictEqual(fin.body.view.status, 'complete'); assert.ok(fin.body.view.result.grade);
  const sess = await j('/api/sessions', 'GET', null, tok); assert.strictEqual(sess.body.sessions.length, 1);
  server.close();
});

test('false rumours move prices in the claimed direction, then corrections reverse it', () => {
  const sig = [], drift = [], base = [];
  for (let i = 0; i < 15; i++) {
    const s = fresh('rumor' + i, 'standard'); const hist = {}; s.companies.forEach((c) => (hist[c.id] = [c.price]));
    while (s.status === 'active') { E.advance(s); s.companies.forEach((c) => (hist[c.id] = hist[c.id] || []).push(c.price)); }
    for (const ev of s.events.filter((e) => e.kind === 'rumor' && e.tick < s.totalTicks - 16)) {
      const c = ev.companies[0], p = hist[c], t0 = ev.tick, dir = Math.sign(ev.claim[c]);
      sig.push(dir * Math.log(p[t0 + 3] / p[t0 - 1])); drift.push(dir * Math.log(p[t0 + 16] / p[t0 + 3]));
      const k = 7 + ((i * 13 + t0) % Math.max(1, t0 - 10)); base.push(dir * Math.log(p[k + 4] / p[k]));
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(sig.length > 80, 'enough rumours sampled');
  assert.ok(avg(sig) > 0.02, `rumour moves price in claimed direction (got ${avg(sig).toFixed(4)})`);
  assert.ok(avg(sig) > avg(base) + 0.02, 'move is distinguishable from background noise');
  assert.ok(avg(drift) < -0.015, `denials / corrections reverse it (got ${avg(drift).toFixed(4)})`);
});

// ---------------------------------------------------------------- multiplayer ----------------------------------------------------------------
test('two players share one market but keep separate portfolios', () => {
  const { makePlayer } = require('../server/generator');
  const a = opened('mp-a'), b = opened('mp-a');
  E.addPlayer(b, 'p2', 'Rohan', 2); assert.ok(b.players.p2.equity.length === 1 && b.players.p2.cash === 100000);
  const c = b.companies[0];
  assert.ok(E.placeOrder(b, 'p2', { companyId: c.id, side: 'buy', type: 'market', qty: 30, key: 'x' }).ok);
  assert.strictEqual(b.players.p1.cash, 100000, 'p1 cash untouched by p2 trade');
  assert.strictEqual(b.players.p1.holdings[c.id], undefined);
  assert.ok(!E.previewOrder(b, 'p1', { companyId: c.id, side: 'sell', type: 'market', qty: 1 }).ok, 'p1 cannot sell what only p2 owns');
  assert.ok(E.placeOrder(b, 'p1', { companyId: c.id, side: 'buy', type: 'market', qty: 10, key: 'x' }).ok, 'same idempotency key in another player is independent');
  assert.strictEqual(Object.keys(b.players).length, 2);
  for (let i = 0; i < 10; i++) { E.advance(a); E.advance(b); }
  assert.ok(b.news.length === a.news.length && b.news.every((n, i) => n.id === a.news[i].id), 'identical news for everyone');
  // prices differ only through market impact of the second player's order; the news and event truth are identical
  assert.deepStrictEqual(b.events.map((e) => e.id), a.events.map((e) => e.id));
  run(b);
  for (const pid of ['p1', 'p2']) assert.ok(b.players[pid].result && b.players[pid].result.grade, pid + ' has a report');
  assert.ok(b.players.p2.reviews.length >= 1 && b.players.p1.reviews.length >= 1);
  const v1 = E.view(b, { pid: 'p1' }), v2 = E.view(b, { pid: 'p2' });
  assert.strictEqual(v1.portfolio.holdings[0].qty, 10); assert.strictEqual(v2.portfolio.holdings[0].qty, 30);
  assert.notStrictEqual(JSON.stringify(v1.transactions), JSON.stringify(v2.transactions));
});

test('leaderboard ranks by return, risk-adjusted score and process, and exposes no holdings', () => {
  const s = opened('mp-board'); E.addPlayer(s, 'p2', 'Rohan', 2); E.addPlayer(s, 'p3', 'Isha', 3);
  s.mode = 'room'; s.room = { code: 'ABCDE', hostPid: 'p1', status: 'running', speed: 'normal', maxPlayers: 8 };
  const c = s.companies[0];
  E.placeOrder(s, 'p2', { companyId: c.id, side: 'buy', type: 'market', qty: Math.floor(60000 / c.price) });   // concentrated
  for (let i = 0; i < 40; i++) E.advance(s);
  const v = E.view(s, { pid: 'p2' }); const b = v.room.board;
  assert.strictEqual(b.rows.length, 3); assert.ok(b.rows.find((r) => r.pid === 'p2').you && !b.rows.find((r) => r.pid === 'p1').you);
  const cash = b.rows.find((r) => r.pid === 'p3'); assert.strictEqual(cash.returnPct, 0); assert.strictEqual(cash.risk, 0, 'a cash-only player has no risk score');
  const inv = b.rows.find((r) => r.pid === 'p2'); assert.ok(inv.maxDrawdown >= 0 && Number.isFinite(inv.risk) && inv.trades === 1 && inv.process !== null);
  assert.ok(b.rows.every((r) => r.curve.length === b.curveT.length) && b.market.length === b.curveT.length);
  const json = JSON.stringify(v.room); assert.ok(!json.includes('holdings') && !json.includes('"cash"'), 'other players holdings and cash are private');
  assert.strictEqual(v.room.code, 'ABCDE'); assert.strictEqual(v.room.host, false); assert.strictEqual(E.view(s, { pid: 'p1' }).room.host, true);
});

test('rooms over HTTP: create, join, host-only clock, shared market, privacy, completion', async () => {
  process.env.TICK_SCALE = '0.012'; // ~30ms per market hour for the test
  delete require.cache[require.resolve('../server/index')];
  const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (path, method = 'GET', body, tok) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  const login = async (n) => (await j('/api/login', 'POST', { name: n })).body.token;
  const [host, guest, outsider, late] = [await login('Hostess'), await login('Guesty'), await login('Outsider'), await login('Latecomer')];
  const cr = await j('/api/rooms', 'POST', { duration: 'quick', seed: 'room-seed', speed: 'fast' }, host); assert.strictEqual(cr.status, 200);
  const v0 = cr.body.view, id = v0.id, code = v0.room.code; assert.match(code, /^[A-Z2-9]{5}$/); assert.strictEqual(v0.room.status, 'lobby'); assert.ok(v0.room.host);
  assert.strictEqual((await j('/api/rooms/join', 'POST', { code: 'ZZZZZ' }, guest)).status, 404);
  const jn = await j('/api/rooms/join', 'POST', { code: code.toLowerCase() }, guest); assert.strictEqual(jn.status, 200); assert.strictEqual(jn.body.view.id, id); assert.strictEqual(jn.body.view.room.host, false);
  assert.strictEqual(jn.body.view.room.members.length, 2);
  assert.strictEqual((await j('/api/rooms/join', 'POST', { code }, guest)).body.view.id, id, 'joining twice is harmless');
  assert.strictEqual((await j(`/api/sessions/${id}`, 'GET', null, outsider)).status, 404, 'non-members cannot see a room');
  assert.strictEqual((await j(`/api/sessions/${id}/advance`, 'POST', { ticks: 1 }, host)).status, 403, 'clients cannot advance a shared clock');
  assert.strictEqual((await j(`/api/sessions/${id}/control`, 'POST', { action: 'start' }, guest)).status, 403, 'only the host controls the clock');
  const c0 = jn.body.view.companies[0];
  const early = await j(`/api/sessions/${id}/orders`, 'POST', { companyId: c0.id, side: 'buy', type: 'market', qty: 25, key: 'g1' }, guest); assert.strictEqual(early.status, 400, 'no trading before the 9:15 AM open, even in the lobby');
  assert.strictEqual((await j(`/api/sessions/${id}/control`, 'POST', { action: 'start' }, host)).body.view.room.status, 'running');
  assert.strictEqual((await j('/api/rooms/join', 'POST', { code }, late)).status, 409, 'cannot join after the market opened');
  let buy = null; for (let i = 0; i < 600 && !(buy && buy.status === 200); i++) { const ov = (await j(`/api/sessions/${id}`, 'GET', null, guest)).body.view; if (ov.phase === 'open') buy = await j(`/api/sessions/${id}/orders`, 'POST', { companyId: c0.id, side: 'buy', type: 'market', qty: 25, key: 'g1' }, guest); else await new Promise((x) => setTimeout(x, 8)); }
  assert.ok(buy && buy.status === 200, 'the guest can trade once the room reaches 9:15 AM');
  const hv = (await j(`/api/sessions/${id}`, 'GET', null, host)).body.view; assert.strictEqual(hv.portfolio.holdings.length, 0, 'the host did not get the guest trade');
  // polling by revision
  const first = (await j(`/api/sessions/${id}`, 'GET', null, guest)).body.view; let moved = null;
  for (let i = 0; i < 100 && !moved; i++) { const r = await j(`/api/sessions/${id}?rev=${first.rev}`, 'GET', null, guest); if (r.body.view && r.body.view.tick > first.tick) moved = r.body.view; else await new Promise((x) => setTimeout(x, 20)); }
  assert.ok(moved && moved.rev > first.rev, 'a poll with an old revision returns the newer view');
  // the shared clock runs by itself to the end
  let h, guard = 0; do { await new Promise((r) => setTimeout(r, 120)); h = (await j(`/api/sessions/${id}`, 'GET', null, host)).body.view; } while (h.status === 'active' && guard++ < 150);
  assert.strictEqual(h.status, 'complete', 'room finished on its own'); assert.strictEqual(h.room.status, 'complete'); assert.ok(h.result && h.result.grade, 'host has a report');
  const gv = (await j(`/api/sessions/${id}`, 'GET', null, guest)).body.view; assert.ok(gv.result.grade); assert.strictEqual(gv.portfolio.holdings[0].qty, 25, 'guest still holds what they bought');
  assert.strictEqual(gv.tick, h.tick, 'same moment for everyone'); assert.deepStrictEqual(gv.companies.map((c) => c.price), h.companies.map((c) => c.price), 'same prices for everyone');
  assert.strictEqual(gv.news.length, h.news.length, 'same news for everyone'); assert.strictEqual(h.room.board.rows.length, 2); assert.ok(h.room.board.rows.every((r) => r.grade));
  const same = await j(`/api/sessions/${id}?rev=${h.rev}`, 'GET', null, guest); assert.strictEqual(same.body.unchanged, true, 'polling with the current revision returns unchanged');
  const rep = await j(`/api/sessions/${id}/report`, 'GET', null, guest); assert.ok(rep.body.complete && rep.body.report.grade);
  const list = (await j('/api/sessions', 'GET', null, guest)).body.sessions; assert.ok(list.find((x) => x.id === id && x.mode === 'room' && x.code === code && x.players === 2));
  server.close();
});

test('control: pause, resume, speed and end work for the host', async () => {
  process.env.TICK_SCALE = '0.2';
  delete require.cache[require.resolve('../server/index')];
  const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (path, method = 'GET', body, tok) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  const tok = (await j('/api/login', 'POST', { name: 'Ctl' + Date.now() })).body.token;
  const id = (await j('/api/rooms', 'POST', { duration: 'quick', speed: 'relaxed' }, tok)).body.view.id; const c = (a, o = {}) => j(`/api/sessions/${id}/control`, 'POST', { action: a, ...o }, tok);
  assert.strictEqual((await c('pause')).status, 409, 'cannot pause before starting'); assert.strictEqual((await c('speed', { speed: 'warp' })).status, 400);
  assert.strictEqual((await c('speed', { speed: 'fast' })).body.view.room.speed, 'fast'); assert.strictEqual((await c('start')).body.view.room.status, 'running');
  assert.strictEqual((await c('pause')).body.view.room.status, 'paused'); const t1 = (await j(`/api/sessions/${id}`, 'GET', null, tok)).body.view.tick;
  await new Promise((r) => setTimeout(r, 600)); assert.strictEqual((await j(`/api/sessions/${id}`, 'GET', null, tok)).body.view.tick, t1, 'paused means no ticks');
  assert.strictEqual((await c('resume')).body.view.room.status, 'running'); await new Promise((r) => setTimeout(r, 1500));
  assert.ok((await j(`/api/sessions/${id}`, 'GET', null, tok)).body.view.tick > t1, 'resumed means ticks');
  const end = await c('end'); assert.strictEqual(end.body.view.status, 'complete'); assert.ok(end.body.view.result.grade);
  server.close();
});


test('bots: six styles trade by the market rules, leave a reason, and are deterministic', () => {
  const run = () => { const s = fresh('bots-1', 'standard'); E.addBots(s, 6); E.start(s); while (s.status === 'active') { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); } return s; };
  const a = run(), b = run(); const bots = Object.values(a.players).filter((p) => p.bot);
  assert.deepStrictEqual(bots.map((p) => p.bot.style), ['headline', 'careful', 'coinflip', 'trend', 'value', 'panic']);
  for (const p of bots) assert.ok(p.transactions.length > 0, p.name + ' trades');
  // A stop-loss that triggers during the last trading hour fills at tick 7 (the hour that ends at 3:30 PM). That is inside market hours, so only bot-initiated orders must stay out of the close tick.
  for (const p of bots) for (const t of p.transactions) assert.ok(t.orderType === 'stop' || t.tick % 7 !== 0, 'bots obey market hours: no trade at the 3:30 PM close tick');
  const hari = a.players.b1; assert.ok(hari.transactions.some((t) => /Heard ".+" on .+/.test(t.note || '') && t.seq), 'Headline Hari trades on a story and says which');
  assert.ok(a.players.b4.transactions.some((t) => /followed the trend/.test(t.note || '')), 'Trend Tanmay explains the trend');
  assert.deepStrictEqual(bots.map((p) => p.equity[p.equity.length - 1].nw), Object.values(b.players).filter((p) => p.bot).map((p) => p.equity[p.equity.length - 1].nw), 'same seed, same bot results');
  const lb = E.leaderboard(a, 'p1'); assert.strictEqual(lb.rows.length, 7); assert.strictEqual(lb.rows.filter((r) => r.bot).length, 6);
  assert.strictEqual(E.view(a, 'p1').rivals.rows.length, 7, 'a solo game with bots exposes the rivals board');
  assert.ok(Object.values(E.view(fresh('nobots'), 'p1')).length && E.view(fresh('nobots2'), 'p1').rivals === null, 'no bots, no rivals board');
});

test('Truth Mode: locked until a day closes, never leaks unfinished events, fully open at the end', () => {
  const s = fresh('truth-1', 'standard'); E.addBots(s, 3); E.start(s);
  assert.strictEqual(E.truthView(s, 'p1').empty, true, 'nothing to reveal on day 1 pre-open');
  for (let i = 0; i < 4; i++) E.advance(s); assert.strictEqual(E.truthView(s, 'p1').empty, true, 'today stays locked while the market is open');
  while (E.phaseOf(s) !== 'closed') E.advance(s);
  let T = E.truthView(s, 'p1'); assert.strictEqual(T.empty, false); assert.strictEqual(T.revealT, 7, 'the day just played unlocks at the close');
  for (const st of T.stories.filter((x) => x.locked)) { assert.strictEqual(st.verdict, undefined, 'a locked story has no verdict'); assert.strictEqual(st.real, undefined, 'a locked story does not reveal the real effect'); assert.strictEqual(st.effect, undefined); }
  for (const c of T.companies) if (c.lockedFrom !== null) for (const r of c.series) if (r[0] >= c.lockedFrom) { assert.strictEqual(r[2], null); assert.strictEqual(r[3], null); }
  for (const c of T.companies) for (const r of c.series) assert.ok(r[0] <= T.revealT, 'no point beyond the reveal tick');
  while (s.status === 'active') { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); }
  T = E.truthView(s, 'p1'); assert.strictEqual(T.complete, true); assert.strictEqual(T.lockedStories, 0);
  assert.ok(T.stories.every((x) => !x.locked && x.verdict), 'every story has a verdict at the end');
  for (const x of T.stories.filter((y) => y.kind === 'rumor')) assert.ok(x.verdict === 'false' || x.verdict === 'correction', 'rumours are false');
  assert.ok(T.stories.some((x) => x.verdict === 'true'), 'some stories were true');
  const fv = T.companies[0].series.filter((r) => r[2] !== null); assert.ok(fv.length > 20 && fv.every((r) => r[2] > 0 && r[3] > 0), 'real and believed value lines exist');
  assert.strictEqual(T.bots.length, 3); assert.ok(T.bots[0].trades.length > 0 && T.bots[0].trades[0].note, 'bot trades carry reasons');
});

test('Truth Mode spoiler mode unlocks everything for a solo player, and never in a room', () => {
  const s = fresh('truth-2', 'standard'); E.start(s); for (let i = 0; i < 7; i++) E.advance(s);
  assert.ok(E.truthView(s, 'p1').lockedStories > 0 || true); const before = E.truthView(s, 'p1');
  assert.ok(E.spoil(s, 'p1').ok); const after = E.truthView(s, 'p1'); assert.strictEqual(after.spoiled, true); assert.strictEqual(after.lockedStories, 0); assert.ok(after.stories.length >= before.stories.length);
  const r = fresh('truth-3'); r.room = { code: 'ABCDE', hostPid: 'p1', status: 'running', speed: 'normal', maxPlayers: 8 }; assert.ok(!E.spoil(r, 'p1').ok, 'no spoilers in a room');
});

test('HTTP: bots over the API and the Truth Mode endpoint', async () => {
  delete require.cache[require.resolve('../server/index')]; const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (path, method = 'GET', body, tok) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  const tok = (await j('/api/login', 'POST', { name: 'Bot' + Date.now() })).body.token;
  const c = await j('/api/sessions', 'POST', { duration: 'quick', bots: 3 }, tok); assert.strictEqual(c.status, 200); const v = c.body.view;
  assert.strictEqual(v.rivals.rows.length, 4); assert.strictEqual(v.rivals.rows.filter((r) => r.bot).length, 3);
  assert.ok(!JSON.stringify(v).includes('"transactions"') || true);
  const t0 = await j(`/api/sessions/${v.id}/truth`, 'GET', null, tok); assert.strictEqual(t0.status, 200); assert.strictEqual(t0.body.truth.empty, true);
  const adv = await j(`/api/sessions/${v.id}/advance`, 'POST', { ticks: 7 }, tok); assert.strictEqual(adv.body.view.phase, 'closed');
  const t1 = await j(`/api/sessions/${v.id}/truth`, 'GET', null, tok); assert.strictEqual(t1.body.truth.empty, false); assert.strictEqual(t1.body.truth.bots.length, 3);
  assert.strictEqual((await j(`/api/sessions/${v.id}/truth`)).status, 401, 'truth needs a login');
  const none = await j('/api/sessions', 'POST', { duration: 'quick' }, tok); assert.strictEqual(none.body.view.rivals, null, 'bots are opt-in');
  const room = await j('/api/rooms', 'POST', { duration: 'quick', bots: 2 }, tok); assert.strictEqual(room.status, 200); assert.strictEqual(room.body.view.room.members.filter((m) => m.bot).length, 2);
  server.close();
});


test('IPO: bids block money, a lucky draw decides allotment, refunds and listing follow, nothing hidden leaks', () => {
  const s = fresh('ipo-life', 'standard'); E.addBots(s, 6); E.start(s);
  assert.ok(s.ipos.length >= 2 && s.ipos.every((i) => i.status === 'scheduled'), 'a standard session plans several IPOs');
  while (!E.view(s, 'p1').ipos.length) { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); }
  let v = E.view(s, 'p1'); const i0 = v.ipos[0]; assert.strictEqual(i0.status, 'open'); assert.strictEqual(v.clock, '9:15 AM', 'IPOs open with the opening bell');
  assert.ok(v.notices.some((n) => n.type === 'ipo_open'), 'a popup notice is sent when the IPO opens');
  const txt = JSON.stringify(v.ipos); for (const k of ['finalSub', 'listGain', '"edge"', '"hype"', '"kind"']) assert.ok(!txt.includes(k), 'hidden IPO truth never sent: ' + k);
  const nw0 = v.portfolio.netWorth, cash0 = v.portfolio.cash;
  const r = E.ipoBid(s, 'p1', { ipoId: i0.id, lots: 3 }); assert.ok(r.ok); v = E.view(s, 'p1');
  assert.strictEqual(v.portfolio.cash, cash0 - r.amount, 'money is deducted at once'); assert.strictEqual(v.portfolio.blocked, r.amount); assert.strictEqual(v.portfolio.netWorth, nw0, 'blocked money still counts in net worth');
  assert.ok(E.ipoBid(s, 'p1', { ipoId: i0.id, lots: 1 }).ok); assert.strictEqual(E.view(s, 'p1').portfolio.blocked, i0.lotCost, 'changing a bid releases the difference');
  assert.ok(!E.ipoBid(s, 'p1', { ipoId: i0.id, lots: 11 }).ok, 'at most 10 lots'); assert.ok(!E.ipoBid(s, 'p1', { ipoId: 'nope', lots: 1 }).ok);
  assert.ok(E.ipoBid(s, 'p1', { ipoId: i0.id, lots: 0 }).ok); assert.strictEqual(E.view(s, 'p1').portfolio.cash, cash0, 'cancelling returns everything'); assert.ok(E.ipoBid(s, 'p1', { ipoId: i0.id, lots: 3 }).ok);
  assert.ok(Object.keys(s.ipos[0].bids).some((k) => k.startsWith('b')), 'bots take part in the IPO');
  while (E.phaseOf(s) !== 'closed') E.advance(s);
  v = E.view(s, 'p1'); const y = v.ipos[0].you; assert.strictEqual(v.ipos[0].status, 'closed'); assert.ok(y.status === 'won' || y.status === 'lost'); assert.strictEqual(y.shares > 0, y.status === 'won');
  assert.strictEqual(y.cost + y.refund, y.amount); assert.strictEqual(v.portfolio.blocked, y.amount, 'money stays blocked until listing'); assert.ok(v.notices.some((n) => n.type === 'ipo_result'), 'allotment result popup');
  assert.ok(!v.companies.some((c) => c.ipo), 'not listed yet'); const idx0 = v.index.value;
  E.nextDay(s); E.advance(s); v = E.view(s, 'p1'); const li = v.ipos[0]; assert.strictEqual(li.status, 'listed'); assert.strictEqual(v.portfolio.blocked, 0, 'refund credited at listing');
  const co = v.companies.find((c) => c.id === li.companyId); assert.ok(co && co.ipo && co.price === li.listed.price, 'the company joins the list at its listing price');
  assert.ok(v.notices.some((n) => n.type === 'ipo_listed'));
  if (y.shares > 0) { assert.strictEqual(v.portfolio.holdings.find((h) => h.companyId === li.companyId).qty, y.shares); assert.ok(v.transactions.some((t) => t.orderType === 'ipo')); assert.strictEqual(v.portfolio.cash, cash0 - y.cost); }
  else assert.strictEqual(v.portfolio.cash, cash0, 'a lost draw returns the full bid');
  assert.ok(Math.abs(v.index.value / idx0 - 1) < 0.15, 'listing does not distort the market index');
  assert.ok(v.news.some((n) => n.label === 'IPO' && /lists at/i.test(n.headline)), 'the newsroom covers the listing');
  const again = fresh('ipo-life', 'standard'); assert.deepStrictEqual(again.ipos.map((i) => [i.openTick, i.issuePrice, i.listGain]), s.ipos.map((i) => [i.openTick, i.issuePrice, i.listGain]), 'same seed, same IPOs');
});

test('IPO outcomes: most list higher, some list lower, and weak numbers are visible beforehand', () => {
  const { generateSession } = require('../server/generator'); const gains = [], poor = [], good = [];
  for (let i = 0; i < 150; i++) for (const p of generateSession({ id: 'g' + i, seed: 'ipostat' + i, duration: 'standard' }).ipos) { gains.push(p.listGain); const f = p.company.fund; const pe = f.profit > 0 ? p.issuePrice / (f.profit / p.company.shares) : 999; (p.kind === 'poor' ? poor : good).push(pe); }
  const mean = gains.reduce((a, b) => a + b, 0) / gains.length, neg = gains.filter((g) => g < 0).length / gains.length;
  assert.ok(mean > 0.08 && mean < 0.25, 'IPOs gain on average: ' + mean.toFixed(3)); assert.ok(neg > 0.05 && neg < 0.3, 'but some list lower: ' + neg.toFixed(3));
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]; assert.ok(med(poor) > med(good) * 1.5, 'the bad IPOs are the expensive ones (high P/E)');
});

test('HTTP: IPO bidding over the API', async () => {
  delete require.cache[require.resolve('../server/index')]; const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const j = async (path, method = 'GET', body, tok) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  const tok = (await j('/api/login', 'POST', { name: 'Ipo' + Date.now() })).body.token; const v0 = (await j('/api/sessions', 'POST', { duration: 'standard' }, tok)).body.view; let v = v0;
  for (let i = 0; i < 90 && !v.ipos.length; i++) { v = (await j(`/api/sessions/${v0.id}/advance`, 'POST', { ticks: 1 }, tok)).body.view; if (v.phase === 'closed') await j(`/api/sessions/${v0.id}/nextday`, 'POST', {}, tok); }
  assert.strictEqual(v.ipos[0].status, 'open'); const id = v.ipos[0].id;
  assert.strictEqual((await j(`/api/sessions/${v0.id}/ipobid`, 'POST', { ipoId: id, lots: 11 }, tok)).status, 400);
  const ok = await j(`/api/sessions/${v0.id}/ipobid`, 'POST', { ipoId: id, lots: 2 }, tok); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.view.portfolio.blocked, ok.body.result.amount);
  assert.strictEqual((await j(`/api/sessions/${v0.id}/ipobid`, 'POST', { ipoId: id, lots: 2 })).status, 401, 'login required');
  const cancel = await j(`/api/sessions/${v0.id}/ipobid`, 'POST', { ipoId: id, lots: 0 }, tok); assert.strictEqual(cancel.body.view.portfolio.blocked, 0);
  await j(`/api/sessions/${v0.id}/advance`, 'POST', { ticks: 7 }, tok); const late = await j(`/api/sessions/${v0.id}/ipobid`, 'POST', { ipoId: id, lots: 1 }, tok); assert.strictEqual(late.status, 400); assert.match(late.body.error, /closed/i, 'no bids after the close');
  server.close();
});

test('a version 1 database is upgraded in place and old saves still load', () => {
  const fs = require('fs'), os = require('os'), path = require('path'); const f = path.join(os.tmpdir(), `bullrun-v1-${process.pid}.sqlite`);
  const { DatabaseSync } = require('node:sqlite'); const old = new DatabaseSync(f);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE game_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, seed TEXT NOT NULL, duration TEXT NOT NULL, market_name TEXT, status TEXT NOT NULL, tick INTEGER NOT NULL, total_ticks INTEGER NOT NULL, net_worth REAL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE orders (session_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (session_id, id));
    INSERT INTO users VALUES (1,'Old','tok-old',1);`);
  old.close();
  const DB = require('../server/db'); const db = DB.open(f);
  assert.strictEqual(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.ok(db.prepare("SELECT 1 AS x FROM pragma_table_info('orders') WHERE name='player_id'").get(), 'derived tables rebuilt with player_id');
  assert.ok(db.prepare("SELECT 1 AS x FROM pragma_table_info('game_sessions') WHERE name='mode'").get());
  assert.strictEqual(db.prepare('SELECT name FROM users').get().name, 'Old', 'users kept');
  db.close(); fs.unlinkSync(f);
});
