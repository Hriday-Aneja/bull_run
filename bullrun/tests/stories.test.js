'use strict';
// Everyday people news (scandals, good press) and "too good to be true" scam arcs (hype, then the government exposes it).
// These must appear at random in real games, not be fixed to one company, and must move prices the way the story says.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bullrun-stories-${process.pid}.sqlite`);
delete process.env.AI_API_KEY;
const test = require('node:test');
const assert = require('node:assert');
const { generateSession } = require('../server/generator');
const E = require('../server/engine');
const D = require('../server/data');

const DUR = ['quick', 'standard', 'extended'];
const fresh = (seed, duration = 'standard') => E.start(generateSession({ id: 's' + seed, seed, duration }));
const PEOPLE = new Set(D.PEOPLE_EVENTS.map((e) => e.id));
const arcsOf = (s) => s.events.filter((e) => e.hype).map((h) => ({ h, f: s.events.find((e) => e.refutes === h.id) }));
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };

test('everyday people stories appear in every game, vary by company and type, and cost or help a little', () => {
  const types = new Set(), companies = new Set(); let games = 0; const bad = [], good = [];
  for (let i = 0; i < 30; i++) {
    const s = fresh('ppl' + i, DUR[i % 3]); games++; const here = s.events.filter((e) => PEOPLE.has(e.typeId));
    assert.ok(here.length >= Math.round(s.days * 0.5) - 1, `game ${i} has people stories`);
    for (const e of here) { types.add(e.typeId); companies.add(s.seed + e.companies[0]); const v = Object.values(e.impact)[0]; (e.dir < 0 ? bad : good).push(Math.abs(v)); assert.strictEqual(e.dir < 0, v < 0, 'direction matches the story'); assert.ok(Math.abs(v) <= 0.14, 'a scandal costs a little, not a crash: ' + e.typeId + ' ' + v); }
  }
  assert.ok(types.size >= 8, 'many different stories, saw ' + [...types].join(', ')); assert.ok(companies.size > 60, 'spread over many companies');
  assert.ok(median(bad) < 0.07 && median(good) < 0.05, `typical size is small: bad ${median(bad)}, good ${median(good)}`);
});

test('scam arcs happen at random in real games: different companies, types, timing and size each time', () => {
  let withArc = 0; const types = new Set(), inds = new Set(), gaps = new Set(); const hit = new Set();
  for (let i = 0; i < 40; i++) {
    const s = fresh('arc' + i, DUR[i % 3]); const arcs = arcsOf(s); if (arcs.length) withArc++;
    for (const { h, f } of arcs) {
      assert.ok(f, 'every hype has its exposure'); types.add(f.typeId); const c = s.companies.find((x) => x.id === h.companies[0]); inds.add(c.industry); gaps.add(f.tick - h.tick); hit.add(s.seed + c.id);
      assert.strictEqual(f.companies[0], h.companies[0], 'same company'); const gap = f.tick - h.tick; assert.ok(gap >= 8 && gap <= 20, 'a day or two later: ' + gap); assert.ok(f.tick <= s.totalTicks - 6, 'the exposure happens inside the game');
      const arc = D.FRAUD_ARCS.find((a) => a.id === h.arc.id); assert.ok(!arc.inds || arc.inds.includes(c.industry), 'the claim fits the industry');
    }
  }
  assert.ok(withArc >= 28, 'most games have one, saw ' + withArc + ' of 40'); assert.ok(types.size >= 5, 'varied: ' + [...types].join(', ')); assert.ok(inds.size >= 6 && gaps.size >= 8 && hit.size >= 40, 'not fixed to one company or one timing');
});

test('the hype has no real value behind it and the exposure is a big real hit', () => {
  let n = 0;
  for (let i = 0; i < 25; i++) {
    const s = fresh('arc' + i, DUR[i % 3]);
    for (const { h, f } of arcsOf(s)) {
      n++; const cid = h.companies[0];
      assert.deepStrictEqual(h.impact, {}, 'hype changes nothing real'); assert.ok(h.claim[cid] >= 0.05 && h.claim[cid] <= 0.1, 'hype claims a rise'); assert.strictEqual(h.material, false);
      assert.ok(f.impact[cid] <= -0.3 && f.impact[cid] >= -0.7, 'exposure is a drastic real loss: ' + f.impact[cid]); assert.strictEqual(f.claim[cid], f.impact[cid], 'the news tells the truth about it'); assert.ok(f.material);
    }
  }
  assert.ok(n > 20);
});

test('news: loud channels run with the hype, MARKETLINE stays silent, the exposure is reported and the hype is marked wrong', () => {
  let n = 0, leaked = 0;
  for (let i = 0; i < 25; i++) {
    const s = fresh('arc' + i, DUR[i % 3]);
    for (const { h, f } of arcsOf(s)) {
      n++; const all = s.pubQueue.concat(s.news); const hp = all.filter((p) => p.eventId === h.id), fp = all.filter((p) => p.eventId === f.id);
      assert.ok(hp.length >= 1 && hp.every((p) => ['flashwire', 'dailypulse'].includes(p.channel)), 'only the loud channels run with the claim: ' + hp.map((p) => p.channel));
      assert.ok(fp.some((p) => p.channel === 'marketline' && p.claim[f.companies[0]] < 0), 'the verified channel reports the exposure'); assert.ok(fp.some((p) => p.channel === 'flashwire' || p.channel === 'marketline'));
      for (const p of fp) { assert.strictEqual(p.refutes, h.id); assert.ok(p.corrects.every((id) => [...hp, ...fp].find((x) => x.id === id && ['flashwire', 'undercurrent'].includes(x.channel))), 'only loud-channel stories are ever marked wrong'); }
      if (fp.some((p) => p.channel === 'undercurrent' && p.tick < f.tick)) leaked++;
      assert.ok(hp.filter((p) => p.channel === 'flashwire').every((p) => fp.some((q) => q.corrects.includes(p.id))), 'the exposure marks the loud hype as wrong');
    }
  }
  assert.ok(n > 20 && leaked >= n * 0.3, `careful readers often get a warning first: ${leaked}/${n}`);
});

test('prices: the hype lifts the stock, the exposure crashes it, and the market moves the way the story says', () => {
  const pump = [], hold = []; let n = 0;
  for (let i = 0; i < 40; i++) {
    const s = fresh('story' + i, DUR[i % 3]); const arcs = arcsOf(s); if (!arcs.length) continue; const px = {}; arcs.forEach((a) => { px[a.h.id] = []; });
    while (s.status === 'active') { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); for (const a of arcs) px[a.h.id].push([s.tick, s.companies.find((c) => c.id === a.h.companies[0]).price]); }
    for (const a of arcs) {
      if (a.f.tick + 10 > s.totalTicks) continue; const P = px[a.h.id]; const at = (t) => (P.find((p) => p[0] === t) || P[P.length - 1])[1];
      const peak = Math.max(...P.filter((p) => p[0] >= a.h.tick && p[0] <= a.f.tick).map((p) => p[1])); const low = Math.min(...P.filter((p) => p[0] >= a.f.tick && p[0] <= a.f.tick + 10).map((p) => p[1]));
      pump.push(peak / at(a.h.tick - 1) - 1); hold.push(low / at(a.f.tick - 1) - 1); n++;
    }
  }
  assert.ok(n >= 40, 'enough arcs to judge: ' + n); assert.ok(median(pump) >= 0.05, 'the hype lifts the price: ' + median(pump)); assert.ok(median(hold) <= -0.25, 'a holder at the exposure loses a lot: ' + median(hold));
  assert.ok(hold.filter((x) => x <= -0.2).length >= n * 0.8, 'almost every exposure is a drastic fall');
});

test('Truth Mode and the Learn tab explain it: the hype was false, the exposure was real, players get the lesson', () => {
  let seen = 0;
  for (let i = 0; i < 12 && !seen; i++) {
    const s = fresh('arc' + i, 'standard'); const arcs = arcsOf(s); if (!arcs.length) continue; while (s.status === 'active') { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); }
    const T = E.truthView(s, 'p1'); assert.strictEqual(T.complete, true); const a = arcs[0];
    const hs = T.stories.filter((x) => s.news.find((n) => n.seq === x.seq).eventId === a.h.id); const fs = T.stories.filter((x) => s.news.find((n) => n.seq === x.seq).eventId === a.f.id);
    assert.ok(hs.length && hs.every((x) => x.verdict === 'false' && x.hype === true && (x.real || []).length === 0), 'the hype is shown as false with nothing real behind it');
    assert.ok(fs.some((x) => x.exposed === true && x.verdict === 'true' && x.real.length === 1 && x.real[0].pct <= -0.3), 'the exposure is true and a big real loss');
    const kinds = s.players.p1.situations.map((x) => x.kind); assert.ok(kinds.includes('hype') && kinds.includes('fraud'), 'learn situations: ' + kinds.join(',')); seen++;
  }
  assert.ok(seen >= 1);
});

test('stories are deterministic for a seed and do not disturb the older event schedule', () => {
  const a = generateSession({ id: 'a', seed: 'same-seed', duration: 'standard' }), b = generateSession({ id: 'b', seed: 'same-seed', duration: 'standard' });
  const sig = (s) => s.events.map((e) => [e.typeId, e.tick, e.companies.join('+'), JSON.stringify(e.impact)].join(':')).join('|'); assert.strictEqual(sig(a), sig(b));
  const o = (s) => s.events.filter((e) => !PEOPLE.has(e.typeId) && !e.arc).map((e) => e.id + e.typeId + e.tick).join('|'); assert.strictEqual(o(a), o(b));
  const other = generateSession({ id: 'c', seed: 'other-seed', duration: 'standard' }); assert.notStrictEqual(sig(a), sig(other), 'a different seed gives different stories');
});

test('the anchors can say the new stories: compose works for every new story type on every channel', async () => {
  const { compose, CHANNELS } = require('../server/news'); const B = await import('../public/js/broadcast.js');
  const specs = [...D.PEOPLE_EVENTS.map((s) => ({ s, text: s })), ...D.FRAUD_ARCS.flatMap((a) => [{ s: a.hype, text: a.hype }, { s: a.fall, text: a.fall }])];
  for (const { s } of specs) {
    const ev = { text: { fact: s.fact.replace('{co}', 'Karnex Foods'), rumor: s.rumor.replace('{co}', 'Karnex Foods'), deny: s.deny.replace('{co}', 'Karnex Foods'), ctx: s.ctx }, dir: s.imp ? 0 : 1, coName: 'Karnex Foods', industries: ['Retail'], kind: 'company', links: {} };
    for (const ch of Object.keys(CHANNELS)) for (const tr of ['default', 'exaggerated', 'unverified', 'leak', 'denial', 'general', 'casual', 'accurate']) {
      let n; try { n = compose(ch, tr, ev); } catch (e) { assert.fail(`${ch}/${tr}: ${e.message}`); }
      const plan = B.planItem({ kind: 'story', ch, label: n.label, raw: { headline: n.headline, body: n.body }, text: '' }, { rot: 0 }); assert.ok(plan.chunks.length >= 1 && plan.chunks.every((c) => !/[A-Z]{2,}/.test(c.say.replace(/\b(?:[A-Z] ){1,}[A-Z]\b/g, ''))), `${ch}/${tr}`);
    }
  }
});
