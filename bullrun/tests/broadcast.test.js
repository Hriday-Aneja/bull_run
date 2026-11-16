'use strict';
// Tests for the anchor script writer, the speech-text normaliser and the ad rules. Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const { CHANNELS, compose } = require('../server/news');
const load = () => import('../public/js/broadcast.js');

test('shouted words and channel names are spoken as words, never spelled out', async () => {
  const B = await load();
  const out = B.spokenForm('THE UNDERCURRENT and FLASHWIRE and MARKETLINE report. UNDERSTANDABLE news from DAILY PULSE.');
  assert.ok(!/[A-Z]{2,}/.test(out), out);
  assert.match(out, /Under current/); assert.match(out, /Flash wire/); assert.match(out, /Market line/);
});

test('real acronyms and tickers are spelled on purpose, numbers become spoken words', async () => {
  const B = await load();
  const out = B.spokenForm('AGRX is up +2.35% at ₹1,23,456.50, an IPO at 9:15 AM, turnover 1,234 cr.', { tickers: new Set(['AGRX']) });
  assert.match(out, /A G R X/); assert.match(out, /I P O/); assert.match(out, /up two point three five percent/);
  assert.match(out, /one lakh twenty three thousand four hundred fifty six rupees fifty paise/); assert.match(out, /nine fifteen A M/);
  assert.match(out, /one thousand two hundred thirty four crore/); assert.ok(!/\d/.test(out), out);
});

test('Indian number words', async () => {
  const B = await load();
  assert.strictEqual(B.intWords(0), 'zero'); assert.strictEqual(B.intWords(100000), 'one lakh');
  assert.strictEqual(B.intWords(12345678), 'one crore twenty three lakh forty five thousand six hundred seventy eight');
});

test('chunks stay short enough for browser voices and keep all the words', async () => {
  const B = await load();
  const long = 'The company said that profits rose sharply, helped by strong demand, lower costs, and a weaker rupee, while analysts warned that the gains may not last if oil prices keep climbing through the rest of the year, which would hurt margins.';
  const parts = B.chunksOf(long, 120);
  assert.ok(parts.length >= 2); assert.ok(parts.every((p) => p.length <= 130), parts.map((p) => p.length).join());
  assert.strictEqual(parts.join(' ').replace(/\s+/g, ' '), long);
});

test('delivery varies: first line slower and higher, last line falls, questions rise', async () => {
  const B = await load(); const base = { rate: 1, pitch: 1 };
  const a = B.prosody(base, 'Shares fell today.', 0, 3), z = B.prosody(base, 'Shares fell today.', 2, 3), q = B.prosody(base, 'Shares fell today?', 1, 3);
  assert.ok(a.pitch > z.pitch); assert.ok(a.rate < 1.05 && z.pitch < 1); assert.ok(q.pitch > B.prosody(base, 'Shares fell today.', 1, 3).pitch);
});

const fakeEvent = { text: { fact: 'Karnex Foods reports a fire at its main plant', rumor: 'the plant may be shut for a month', deny: 'the fire was small and production continues', ctx: 'Analysts expect a short disruption.' }, dir: -1, coName: 'Karnex Foods', industries: ['Food'], kind: 'company', links: {} };
const TREATS = { flashwire: ['exaggerated', 'misleading', 'unverified', 'retraction', 'general', 'default'], marketline: ['denial', 'general', 'default'], undercurrent: ['leak', 'echo', 'misread_over', 'misread_wrong', 'default'], dailypulse: ['general', 'chatter', 'default'] };

test('every channel and treatment becomes a natural script with no spelled-out words', async () => {
  const B = await load(); let rot = 0;
  for (const ch of Object.keys(CHANNELS)) for (const tr of TREATS[ch]) {
    const n = compose(ch, tr, fakeEvent);
    const it = { kind: 'story', ch, label: n.label, breaking: n.label === 'Breaking', raw: { headline: n.headline, body: n.body }, text: n.headline };
    const plan = B.planItem(it, { rot: rot++, tickers: new Set(['KARN']) });
    assert.ok(plan.chunks.length >= 1, ch + tr); assert.ok(plan.chunks.every((c) => c.say.length <= 175), ch + tr);
    for (const c of plan.chunks) { assert.ok(!/[A-Z]{2,}/.test(c.say.replace(/\b(?:[A-Z] ){1,}[A-Z]\b/g, '')), `${ch}/${tr}: ${c.say}`); assert.ok(!/["\u201c\u201d]/.test(c.say)); }
    if (ch !== 'dailypulse') assert.ok(!plan.display.includes(n.headline.toUpperCase()), 'the shouted headline is not read out as well as the body');
  }
});

test('anchors hand over to each other and open with a lead-in', async () => {
  const B = await load();
  const n = compose('flashwire', 'default', fakeEvent);
  const it = { kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true, raw: { headline: n.headline, body: n.body }, text: '' };
  const plan = B.planItem(it, { handoff: B.handoffLine('Meera', 0), rot: 0 });
  assert.match(plan.chunks[0].say, /^Thanks, Meera\./); assert.ok(plan.chunks.some((c) => /Breaking news/.test(c.say)));
});

test('DAILY PULSE is a two-voice conversation', async () => {
  const B = await load();
  const n = compose('dailypulse', 'general', fakeEvent);
  const plan = B.planItem({ kind: 'story', ch: 'dailypulse', label: 'General', raw: { headline: n.headline, body: n.body }, text: '' }, { rot: 0 });
  const who = new Set(plan.chunks.map((c) => c.who)); assert.ok(who.has('sunny') && who.has('tara'), [...who].join());
});

test('ads: never while news waits, only after a dry spell, rarely, and a small share of airtime', async () => {
  const B = await load(); const now = 1e6; const base = { queued: false, dry: 2, lastAdAt: now - 400000, adMs: 0, airMs: 300000 };
  assert.strictEqual(B.adDue(base, now), true);
  assert.strictEqual(B.adDue({ ...base, queued: true }, now), false, 'news waiting');
  assert.strictEqual(B.adDue({ ...base, dry: 1 }, now), false, 'not a dry spell yet');
  assert.strictEqual(B.adDue({ ...base, lastAdAt: now - 60000 }, now), false, 'too soon after the last ad');
  assert.strictEqual(B.adDue({ ...base, adMs: 30000 }, now), false, 'over the airtime cap');
  for (let i = 0; i < B.AD_SPOTS.length; i++) { const it = B.adItem(i, i, 'marketline'); const p = B.planItem(it, {}); assert.ok(p.estMs < B.AD_RULES.maxMs + 2500, `${it.brand} is ${p.estMs}ms`); assert.ok(p.chunks.every((c) => c.who === 'announcer')); }
});
