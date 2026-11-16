// BullRun Live: a news channel that never stops. When there are fresh stories the anchors read them (breaking news first).
// When there is nothing new, the channel keeps going with market wraps, sector watch, macro desk, tips and recaps built from
// the live game data. Everything that has aired is kept in a "Previously" list the player can replay.
// This module owns the broadcast state (S.live) and timers. Rendering stays in views.js and app.js, wired through liveHooks().
import { S, chName } from './state.js';
import { ANCHORS, scriptOf, speakChunks, stopSpeaking, canSpeak } from './anchors.js';
import { planItem, handoffLine, adDue, adItem, slateItem } from './broadcast.js';
import { lip } from './lipsync.js';
import { speakNeural, neuralSupported } from './neural.js';
import { num, pct, stamp, toast } from './util.js';
import { req } from './api.js';

const HISTORY_MAX = 80, SEED_HISTORY = 15, BACKLOG_MAX = 4, GAP_MS = 250;
let hooks = { paint() {}, caption() {} };
let timer = null, safety = null, run = 0, words = [], seq = 0;

export const liveHooks = (h) => { hooks = Object.assign(hooks, h); };

const claims = (n) => Object.values(n.claim || {}).filter((v) => typeof v === 'number');
const dirOf = (n) => { const t = claims(n).reduce((a, b) => a + b, 0); return t > 0 ? 1 : t < 0 ? -1 : 0; }; // good or bad for prices, as the story claims
const magOf = (n) => claims(n).reduce((m, v) => Math.max(m, Math.abs(v)), 0); // how big the claimed move is (0.05 = 5 percent)
const storyItem = (n, how = 'aired', short = false) => ({
  key: 's' + n.seq, kind: 'story', ch: n.channel, headline: n.headline.replace(/\s+/g, ' '), text: short ? n.headline.replace(/\s+/g, ' ').replace(/[.!?]*$/, '.') : scriptOf(n), full: short ? scriptOf(n) : null,
  label: n.breaking ? 'Breaking' : n.label, breaking: !!n.breaking, stamp: stamp(n.tick, n.minute), tick: n.tick,
  raw: { headline: n.headline, body: n.body }, dir: dirOf(n), mag: magOf(n), short, disputed: !!n.disputed, cos: (n.tags && n.tags.companies) || [], how, material: n.treatment !== 'background' && n.tick > 0, seq: n.seq,
});

// ---------- segments: filler that is still useful, rebuilt from current game data each time ----------
const TIPS = [
  ['Check the source', 'Before you act on a headline, ask who reported it and whether a careful channel has confirmed it. Fast is not the same as right.'],
  ['Do not chase a spike', 'A price that has already jumped has usually priced in the news. Buying after the jump is how many people lose money.'],
  ['Spread your money', 'If one company is most of your portfolio, one surprise decides your whole result. Smaller positions in several companies are safer.'],
  ['Costs add up', 'Every trade has charges. Trading very often can turn a small gain into a loss without the price ever going against you.'],
  ['Use a stop-loss', 'A stop-loss sells automatically if the price falls to a level you chose in advance. It protects you from panic decisions.'],
  ['Decisions versus outcomes', 'A good decision can still lose money, and a lucky bad decision can still win. Judge yourself on your reasoning first.'],
  ['Read the chart in context', 'A chart shows what happened, not what will happen. Combine it with news and the health of the company.'],
  ['Cash is a position too', 'Staying in cash is safe, but it does not grow. Waiting is a choice and it has a cost, just like buying.'],
];
const dir = (x) => (x > 0.0005 ? 'up' : x < -0.0005 ? 'down' : 'flat');
const pc = (x) => String(+(Math.abs(x) * 100).toFixed(2)) + ' percent'; // 3 percent, 4.1 percent, 0.42 percent (no trailing zeros to read out)
const mv = (x) => (Math.abs(x) < 0.0005 ? 'little changed' : `${x > 0 ? 'up' : 'down'} ${pc(x)}`); // "up 2.35 percent", the way an anchor says it
const focusPick = (v) => { const L = S.live; const a = v.companies.slice().sort((x, y) => Math.abs(y.changePct) - Math.abs(x.changePct)); return a[(L.focus++) % Math.max(1, a.length)]; };
const SEGMENTS = [
  (v, sel) => { // market wrap
    const g = v.companies.find((c) => c.id === v.gainers[0]), l = v.companies.find((c) => c.id === v.losers[0]); if (!g || !l) return null;
    return mk('marketline', sel, 'Market wrap', `Let us check the markets. The ${v.indexName} index stands at ${num(v.index.value)}, ${mv(v.index.change)}. ${g.name} leads the board, ${mv(g.changePct)}. ${l.name} is the weakest, ${mv(l.changePct)}. And ${num(v.turnoverCr)} crore rupees has changed hands so far.`);
  },
  () => 'recap',
  (v, sel) => { // sector watch
    const s = v.sectors.slice().sort((a, b) => b.changePct - a.changePct); if (s.length < 2) return null; const b = s[0], w = s[s.length - 1];
    return mk('flashwire', sel, 'Sector watch', `On the sector board, ${b.name} is the strongest industry right now, ${mv(b.changePct)}. ${w.name} is the weakest, ${mv(w.changePct)}. When a whole industry moves together, ask what news is behind it before you blame one company.`);
  },
  (v, sel) => { const t = TIPS[S.live.tip++ % TIPS.length]; return mk('dailypulse', sel, 'Trading tip', `Here is a thought before we go on. ${t[0]}. ${t[1]}`); },
  (v, sel) => mk('marketline', sel, 'Economy desk', `Now to the economy. Inflation is running at ${v.macro.inflation} percent, with the policy rate at ${v.macro.rate} percent. Oil is trading around ${v.macro.oil} dollars a barrel, and consumer confidence reads ${v.macro.consumer}. Higher rates and higher costs tend to weigh on company profits.`),
  () => 'recap',
  (v, sel) => { // coming up
    const u = v.upcoming.slice(0, 3);
    const t = u.length ? `Coming up on the calendar. ${u.map((e) => `${e.label}, on day ${e.day}, around ${e.clock}`).join('. Then ')}. Prices often move on results versus expectations, so keep an eye on the clock.` : 'Nothing is scheduled on the calendar right now, so the news itself will move the market. Stay alert.';
    return mk('marketline', sel, 'Coming up', t);
  },
  (v, sel) => mk('dailypulse', sel, 'The backdrop', `Here is today's backdrop: ${v.scenario.title.replace(/[.!?]+$/, '')}. ${v.scenario.bullets[0] || ''}`),
  (v, sel) => { // stock in focus
    const c = focusPick(v); if (!c) return null; const it = mk('flashwire', sel, 'Stock in focus', `Stock in focus. ${c.name}, a ${String(c.industry).toLowerCase()} company. Its shares are ${mv(c.changePct)} today, trading at ${num(c.price)} rupees. Check the chart and the latest news before you make a move.`); it.cos = [c.id]; return it;
  },
  (v, sel) => mk('dailypulse', sel, 'On air', 'You are watching BullRun Live, market news around the clock. Missed something? Replay it from the Previously list. Stay with us.'),
  (v, sel) => { const m = v.mood; const w = m > 0.3 ? 'optimistic' : m < -0.3 ? 'nervous' : 'mixed'; return mk('undercurrent', sel, 'Mood check', `A quick mood check. Traders feel ${w} at the moment. Remember, a loud headline is not the same as a verified one. Compare the channels before you act.`); },
  () => 'recap',
  (v, sel) => { // viewer portfolio
    const p = v.portfolio; const held = p.holdings.map((h) => h.ticker);
    const t = held.length ? `A word on your own portfolio. You hold ${held.slice(0, 3).join(', ')}${held.length > 3 ? ' and more' : ''}. Your net worth is ${num(p.netWorth)} rupees, ${mv(p.returnPct)} since the start.` : `A word for our viewer. You are fully in cash, with ${num(p.available)} rupees to spend. Read the news, check a chart, and make your first small trade when you are ready.`;
    return mk('flashwire', sel, 'Your portfolio', t);
  },
];
function mk(ch, sel, label, text) {
  const c = sel === 'all' ? ch : sel; const v = S.view; return { key: 'g' + ++seq, kind: 'segment', ch: c, headline: label, label, text, stamp: stamp(v.tick, 0), cos: [] };
}
function reaction(f) {
  const v = S.view, L = S.live; const c = v.companies.find((x) => x.id === f.cid); if (!c || !f.p0) return null;
  const chg = c.price / f.p0 - 1; const n = v.news.find((x) => x.seq === f.seq); const disputed = !!(n && n.disputed);
  const t = Math.abs(chg) < 0.003 ? `Market reaction. Since our report on ${chName(f.ch)}, ${c.name} is little changed at ${num(c.price)} rupees. The market has not reacted yet, so keep watching.`
    : `Market reaction. Since our report on ${chName(f.ch)}, ${c.name} shares are ${dir(chg)} ${pc(chg)}, now at ${num(c.price)} rupees.`;
  const it = mk('marketline', L.sel || 'all', 'Market reaction', t + (disputed ? ' That story has since been disputed, so a reversal is possible.' : ''));
  it.cos = [f.cid]; it.since = f.tick; it.headline = `${c.ticker} after the news`; return it;
}
function recap(sel) {
  const L = S.live; const pool = L.history.filter((h) => h.kind === 'story' && (sel === 'all' || h.ch === sel)).slice(0, 12); if (!pool.length) return null;
  const h = pool[(L.recap++) % pool.length]; if (!h) return null;
  return { key: 'g' + ++seq, kind: 'segment', ch: h.ch, headline: 'Earlier: ' + h.headline, label: 'Recap', text: `A reminder of an earlier story on ${chName(h.ch)}. ${String(h.headline).replace(/[.!?]+$/, '')}. The full report is in the Previously list.`, stamp: h.stamp, cos: h.cos };
}
function welcome(sel) {
  const ch = sel === 'all' ? 'marketline' : sel;
  return { key: 'g' + ++seq, kind: 'segment', ch, headline: 'Welcome to BullRun Live', label: 'Welcome', text: `Welcome to BullRun Live, market news around the clock. ${ANCHORS[ch].intro}`, stamp: stamp(S.view.tick, 0), cos: [] };
}

// ---------- queue ----------
export function liveQueue() {
  const L = S.live; if (!L || !S.view) return [];
  const sel = S.newsChannel; return S.view.news.filter((n) => !L.aired[n.seq] && (sel === 'all' || n.channel === sel));
}
function addHistory(it) { const L = S.live; if (L.history.some((h) => h.key === it.key)) return; L.history.unshift(it); if (L.history.length > HISTORY_MAX) L.history.length = HISTORY_MAX; }
function pick() {
  const L = S.live, v = S.view, sel = S.newsChannel; let q = liveQueue();
  if (q.length > BACKLOG_MAX) { // too many waiting: file the oldest as headline-only so the channel catches up
    q.slice(0, q.length - BACKLOG_MAX).forEach((n) => { L.aired[n.seq] = 1; addHistory(storyItem(n, 'skipped')); }); q = liveQueue();
  }
  const brk = q.find((x) => x.breaking); L.sel = sel;
  if (!brk && L.sinceReact >= 1) { const fi = L.follow.findIndex((f) => f.at <= v.tick); if (fi >= 0) { const r = reaction(L.follow.splice(fi, 1)[0]); if (r) { L.sinceReact = 0; return r; } } }
  const n = brk || q[0];
  if (n) {
    L.sinceReact++; L.dry = 0;
    L.aired[n.seq] = 1;
    if (n.tick > 0 && n.treatment !== 'background') for (const cid of ((n.tags && n.tags.companies) || []).slice(0, 2)) { const c = v.companies.find((x) => x.id === cid); if (!c) continue; const k = (c.candles || []).find((x) => x.t === n.tick); L.follow.push({ cid, seq: n.seq, headline: n.headline, ch: n.channel, p0: k ? k.o : c.price, at: v.tick + 2, tick: n.tick }); }
    return storyItem(n, 'aired', q.length > 1); // several stories waiting: read the headline now, keep the full report in Previously
  }
  const fi = L.follow.findIndex((f) => f.at <= v.tick); if (fi >= 0) { const r = reaction(L.follow.splice(fi, 1)[0]); if (r) { L.dry = 0; return r; } }
  // Content gap: no story is waiting. News and the market segments always come first; an ad is the last resort and stays very short.
  const adCh = sel === 'all' ? (L.lastCh || 'marketline') : sel;
  if (L.recover) { L.recover = false; L.lastAdAt = Date.now(); return slateItem(++seq, adCh); } // the voice stalled: cover it with a short "please stand by"
  if (L.welcomed && adDue({ queued: false, dry: L.dry, lastAdAt: L.lastAdAt, adMs: L.adMs, airMs: L.airMs }, Date.now())) { L.lastAdAt = Date.now(); L.dry = 0; return adItem(L.adn++, ++seq, adCh); }
  if (!L.welcomed) { L.welcomed = true; return welcome(sel); }
  for (let i = 0; i < SEGMENTS.length; i++) {
    const f = SEGMENTS[L.seg++ % SEGMENTS.length]; let it = f(v, sel); if (it === 'recap') it = recap(sel); if (it) { L.dry++; return it; }
  }
  return welcome(sel);
}

// ---------- playback ----------
// AI voice (your OpenAI or Gemini key, via the server). If it fails or is rate limited, the browser voice takes over for a few minutes.
const aiVoiceOn = () => !!(S.health && S.health.tts && S.health.tts.configured) && S.studio.voice !== 'browser' && neuralSupported() && !(S.live && S.live.aiDownUntil > Date.now());
function aiVoiceDown() { const L = S.live; if (!L) return; if (!L.aiDownUntil || L.aiDownUntil < Date.now()) toast('The AI anchor voice is unavailable right now, so the browser voice is reading the news. Check the server log if this keeps happening.', 'info', 6000); L.aiDownUntil = Date.now() + 180000; }
const msPerWord = (it) => Math.round(1000 / ((ANCHORS[it.ch] && ANCHORS[it.ch].wps) || 2.8));
const hist = (c) => Object.assign({}, c, { text: c.base || c.text, replay: false, short: false });
function clear() { clearTimeout(timer); clearTimeout(safety); timer = safety = null; }
const TAIL = 13; // captions show a rolling window of the last words, like TV subtitles
const rolling = (n) => words.slice(Math.max(0, n - TAIL), n).join(' ');
const firstName = (ch) => String(ANCHORS[ch].name).split(/[ &]/)[0];
const tickerSet = () => new Set(((S.view && S.view.companies) || []).map((c) => c.ticker).filter(Boolean));
// Airtime bookkeeping: how long the channel has been on air, and how much of it was ads (see adDue).
function account(it) { const L = S.live; if (!L || !it || it.replay || !L.t0) return; const d = Date.now() - L.t0; L.t0 = 0; L.airMs += d; if (it.kind === 'ad') { L.adMs += d; L.lastAdAt = Date.now(); } }
// AI-written anchor lines (server/newsroom.js): the server checks them against the story before they can air, so a bad answer simply falls back to the built-in script.
const statusOf = (it) => (/Unverified|Rumour|Sources say|Chatter/.test(it.label) ? 'unconfirmed' : it.label === 'Verified' ? 'confirmed' : it.label === 'Correction' ? 'correction' : it.label === 'Denial' ? 'denial' : it.label === 'Analysis' ? 'analysis' : it.ch === 'dailypulse' ? 'banter' : 'breaking');
const scriptOn = () => !!(S.health && S.health.script && S.health.script.configured) && !(S.live && S.live.scriptDownUntil > Date.now());
function scriptFor(it) {
  const L = S.live; if (!L.scripts) L.scripts = new Map(); if (L.scripts.has(it.key)) return L.scripts.get(it.key);
  const names = (it.cos || []).map((id) => ((S.view.companies || []).find((c) => c.id === id) || {}).name).filter(Boolean);
  const p = req('/api/anchor-script', 'POST', { ch: it.ch, label: it.label, status: statusOf(it), headline: it.raw.headline.replace(/\s+/g, ' '), body: it.raw.body, companies: names,
    direction: it.dir > 0 ? 'up' : it.dir < 0 ? 'down' : 'none', size: it.mag >= 0.08 ? 'huge' : it.mag >= 0.04 ? 'big' : 'small', recent: (L.recent || []).slice(-6) }, 8000)
    .then((j) => (j && Array.isArray(j.lines) && j.lines.length ? j.lines : null))
    .catch((e) => { if (e && (e.status === 503 || e.status === 400)) L.scriptDownUntil = Date.now() + 600000; else if (e && e.status === 429) L.scriptDownUntil = Date.now() + 60000; return null; });
  L.scripts.set(it.key, p); if (L.scripts.size > 60) L.scripts.delete(L.scripts.keys().next().value); return p;
}
// Start writing the next story's lines as soon as it is waiting, so it is ready by the time it airs.
function prefetchScripts() { const L = S.live; if (!L || !scriptOn()) return; const q = liveQueue(); if (q.length === 1) { const it = storyItem(q[0]); if (!L.aired[q[0].seq]) scriptFor(it); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function begin(it, replay) {
  const L = S.live; const id = ++run; clear(); stopSpeaking();
  const prev = L.lastCh; const swap = !replay && it.kind !== 'ad' && prev && prev !== it.ch && (it.kind === 'story' || L.rot % 3 === 0); // a real desk hands over on stories, not on every filler
  if (it.kind !== 'ad') L.lastCh = it.ch;
  const handoff = swap ? handoffLine(firstName(prev), L.rot) : ''; const base = it.full || it.base || it.text;
  if (it.kind === 'story' && it.raw && !it.short && scriptOn()) { // wait briefly for the AI-written lines; the built-in script covers any delay or rejection
    L.cur = Object.assign({}, it, { replay: !!replay, text: '', base, prep: true }); L.t0 = Date.now(); L.shown = 0; L.capsDone = false; L.speechDone = true; L.sync = false; words = []; hooks.paint();
    Promise.race([scriptFor(it), sleep(2500).then(() => null)]).then((lines) => { if (id === run) air(it, replay, id, handoff, base, lines); });
  } else air(it, replay, id, handoff, base, null);
}
function air(it, replay, id, handoff, base, script) {
  const L = S.live; const plan = planItem(it, { handoff, rot: L.rot++, tickers: tickerSet(), script });
  L.cur = Object.assign({}, it, { replay: !!replay, text: plan.display, base, ai: !!script }); L.t0 = Date.now();
  L.shown = 0; L.capsDone = false; L.speechDone = true; L.sync = false; L.limit = 0; words = plan.display.split(/\s+/);
  const per = msPerWord(it); const n = words.length; const at = (chars) => Math.round((chars / plan.totalSay) * n);
  const show = (k) => { L.shown = Math.max(L.shown, Math.min(n, k)); hooks.caption(rolling(L.shown), L.shown / n); };
  const feel = (c) => { lip.emotion(c.emotion, c.intensity); };
  feel(plan.chunks[0] || {});
  if (S.studio.sound && !L.paused && !L.blocked && (canSpeak() || aiVoiceOn())) {
    L.speechDone = false;
    const hnd = {
      onChunk: (i, c) => { if (id !== run) return; feel(c); (L.recent = L.recent || []).push(c.say); if (L.recent.length > 10) L.recent.shift(); L.limit = Math.min(n, at(c.off + c.say.length) + 1); show(at(c.off) + 1); },
      onWord: (pos) => { if (id !== run) return; L.sync = true; show(at(pos) + 1); },
      onEnd: () => { if (id !== run) return; L.speechDone = true; show(n); L.capsDone = true; done(id); },
      onFail: (why) => { if (id !== run) return; L.speechDone = true; if (why === 'not-allowed') { L.blocked = true; hooks.paint(); } else L.recover = true; done(id); },
    };
    const browser = () => { if (canSpeak()) { L.sync = false; speakChunks(plan.chunks, hnd); } else hnd.onFail('stalled'); };
    if (aiVoiceOn() && speakNeural(plan.chunks, Object.assign({}, hnd, {
      onFail: (why) => { if (id !== run) return; if (why !== 'neural') return hnd.onFail(why); aiVoiceDown(); browser(); }, // the AI voice failed: carry on with the browser voice
    }))) { /* playing with the AI voice */ } else browser();
  }
  safety = setTimeout(() => { if (id === run) { L.speechDone = true; L.capsDone = true; done(id); } }, Math.max(per * n * 2, plan.estMs * 2) + 8000);
  hooks.paint();
  const step = () => {
    if (id !== run) return; if (L.paused || L.sync) { if (!L.capsDone) timer = setTimeout(step, 350); return; }
    const cap = !L.speechDone && L.limit ? L.limit : n; // while a voice is speaking, captions never run ahead of the sentence being said
    if (L.shown < cap) show(L.shown + 1);
    if (L.speechDone && !L.paused) { lip.sim(words[Math.max(0, L.shown - 1)] || '', 1); const c = plan.chunks.filter((x) => x.off / plan.totalSay <= L.shown / n).pop(); if (c) feel(c); } // sound off: mouth and face follow the captions
    if (L.shown >= n) { L.capsDone = true; done(id); } else timer = setTimeout(step, per);
  };
  timer = setTimeout(step, 200);
}
function done(id) {
  const L = S.live; if (id !== run || !L.capsDone || !L.speechDone) return;
  const it = L.cur; if (it && it.kind === 'story' && !it.replay) addHistory(hist(it)); account(it);
  clearTimeout(safety); clearTimeout(timer); timer = setTimeout(next, GAP_MS);
}
function next() {
  const L = S.live; if (!L || !S.view) return;
  const it = L.replayNext; L.replayNext = null; begin(it || pick(), false);
}

// ---------- public controls ----------
export function liveReset() { // call whenever a game is adopted
  clear(); stopSpeaking(); run++; seq = 0; const v = S.view;
  const L = { cur: null, shown: 0, history: [], aired: {}, seg: 0, tip: 0, recap: 0, paused: false, speechDone: true, capsDone: false, welcomed: false, replayNext: null, follow: [], sinceReact: 1, focus: 0, sel: 'all', lastCh: null, blocked: false, sync: false, enterKey: null, rot: 0, dry: 0, adn: 0, recover: false, aiDownUntil: 0, lastAdAt: Date.now(), adMs: 0, airMs: 0, t0: 0, limit: 0 };
  S.live = L; if (!v) return;
  v.news.forEach((n) => { L.aired[n.seq] = 1; }); // existing stories are history, not news to read out again
  v.news.slice(-SEED_HISTORY).forEach((n) => { L.history.unshift(storyItem(n, 'earlier')); });
  next();
}
export function liveSync() { // call after every view update: new breaking news interrupts a filler segment
  const L = S.live; if (!L || !S.view) return; prefetchScripts();
  if (!L.cur) return next();
  if (L.cur.kind === 'ad' && !L.cur.replay && liveQueue().length && L.shown < words.length * 0.7) { account(L.cur); clear(); stopSpeaking(); L.cur = null; next(); } // news always beats an ad
  else if (L.cur.kind !== 'story' && !L.cur.replay && liveQueue().some((n) => n.breaking)) { account(L.cur); clear(); stopSpeaking(); L.cur = null; next(); }
  else if (L.cur && L.capsDone && L.speechDone && !timer) timer = setTimeout(next, GAP_MS);
}
export function liveSkip() { const L = S.live; if (!L) return; L.replayNext = null; clear(); stopSpeaking(); const c = L.cur; if (c && c.kind === 'story' && !c.replay) addHistory(hist(c)); account(c); next(); }
export function livePause() { const L = S.live; if (!L) return; L.paused = !L.paused; if (L.paused) { stopSpeaking(); L.speechDone = true; } hooks.paint(); if (!L.paused && L.cur) { if (L.capsDone) liveSkip(); else liveRestartSpeech(); } }
export function liveReplay(key) { const L = S.live; if (!L) return; const it = L.history.find((h) => h.key === key); if (!it) return; L.paused = false; clear(); stopSpeaking(); begin(it, true); }
export function liveBackToLive() { const L = S.live; if (!L) return; L.paused = false; liveSkip(); }
export function liveRestartSpeech() { const L = S.live; if (L) L.blocked = false; if (L && L.cur && !L.capsDone) { const c = L.cur; clear(); stopSpeaking(); begin(c, c.replay); } }
export const liveCaptionText = () => { const L = S.live; return L && L.cur ? (L.capsDone ? rolling(words.length) : rolling(L.shown)) : ''; };

// True while the market clock should wait: a published story has not been read out yet, or is being read right now.
export function liveNeedsAir() {
  const L = S.live, v = S.view; if (!L || !v || L.paused) return false;
  if (liveQueue().some((n) => n.treatment !== 'background' && n.tick > 0)) return true;
  const c = L.cur; return !!(c && c.kind === 'story' && c.material && !c.replay && !L.capsDone);
}
