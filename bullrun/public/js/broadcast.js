// Broadcast layer: turns a story into something an anchor would SAY, not just read.
// Pure functions only (no DOM), so the same code is unit tested in Node.
//
// Rules this follows (from broadcast-writing guides and the research on newscaster speech):
//  - write for the ear: short sentences, one idea each, spoken numbers, no quote marks
//  - lead-in line first ("Breaking news."), then the facts, with a pause at the end of each grammatical unit
//  - vary delivery: slower and a little higher on the first line, falling pitch on the last line,
//    slower on figures, rising on questions, small steady variation so it never sounds monotone
//  - hand over between anchors ("Thanks, Meera.") like a real desk
//  - acronyms are spelled only when they really are acronyms (I P O); everything else is spoken as a word

import { pickEmotion, browserShape } from './emotion.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const below1000 = (n) => (n < 100 ? below100(n) : ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + below100(n % 100) : ''));

// Indian number words: thousand, lakh, crore.
export function intWords(n) {
  n = Math.floor(Math.abs(n)); if (n === 0) return 'zero';
  const parts = []; const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  if (crore) parts.push((crore >= 100 ? intWords(crore) : below100(crore)) + ' crore');
  if (lakh) parts.push(below100(lakh) + ' lakh');
  if (th) parts.push(below100(th) + ' thousand');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}
const digitsWords = (s) => s.split('').map((d) => ONES[Number(d)]).join(' ');
const decWords = (s) => { const [i, f] = String(s).replace(/,/g, '').split('.'); const w = intWords(Number(i)); return f ? `${w} point ${digitsWords(f)}` : w; };

// Names that must never be spelled out letter by letter. The key is lower case.
const LEXICON = { flashwire: 'Flash wire', marketline: 'Market line', undercurrent: 'Under current', dailypulse: 'Daily Pulse', bullrun: 'Bull run', nifty: 'Nifty', sensex: 'Sensex' };
// Real acronyms: spoken letter by letter on purpose.
const SPELLED = new Set(['IPO', 'GDP', 'RBI', 'NSE', 'BSE', 'FII', 'DII', 'EPS', 'CEO', 'CFO', 'COO', 'AI', 'EV', 'IT', 'US', 'UK', 'USD', 'GST', 'ETF', 'AGM', 'MPC', 'PE', 'FMCG', 'PSU', 'CPI', 'MD', 'TV', 'OK', 'FY', 'GM', 'HR', 'PR', 'AM', 'PM']);
const SAID = { SEBI: 'Sebi', OPEC: 'Opec', NASA: 'Nasa', NATO: 'Nato' }; // acronyms people say as words
const spaced = (s) => s.split('').join(' ');
const cap1 = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Text exactly as the voice should say it.
export function spokenForm(text, ctx = {}) {
  const tickers = ctx.tickers || new Set();
  let t = String(text == null ? '' : text);
  t = t.replace(/[\u201c\u201d"]/g, '').replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/\b(flashwire|marketline|undercurrent|dailypulse|bullrun)\b/gi, (m) => LEXICON[m.toLowerCase()]);
  t = t.replace(/\b(\d{1,2}):(\d{2})\s?(AM|PM)\b/gi, (m, h, mi, ap) => `${below100(Number(h))} ${Number(mi) === 0 ? "o'clock" : Number(mi) < 10 ? 'oh ' + below100(Number(mi)) : below100(Number(mi))} ${spaced(ap.toUpperCase())}`);
  t = t.replace(/\u20b9\s?([\d,]+(?:\.\d+)?)(\s?(?:cr|crore|lakh))?/gi, (m, n, unit) => {
    const u = unit ? unit.trim().toLowerCase() : ''; const d = decWords(n);
    if (u) return `${d} ${u === 'cr' ? 'crore' : u} rupees`;
    const [i, f] = n.replace(/,/g, '').split('.'); const paise = f ? Number((f + '0').slice(0, 2)) : 0;
    return `${intWords(Number(i))} rupees${paise ? ' ' + below100(paise) + ' paise' : ''}`;
  });
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s?cr\b/gi, (m, n) => `${decWords(n)} crore`);
  t = t.replace(/([+\-\u2212\u2013])?\s?(\d+(?:\.\d+)?)\s?%/g, (m, sg, n) => `${sg ? (sg === '+' ? 'up ' : 'down ') : ''}${decWords(n)} percent`);
  t = t.replace(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/g, (m) => decWords(m));
  t = t.replace(/\b\d+\.\d+\b/g, (m) => decWords(m));
  t = t.replace(/\b\d{5,}\b/g, (m) => intWords(Number(m)));
  t = t.replace(/\bP\/E\b/g, 'P E').replace(/\b24\/7\b/g, 'twenty four seven').replace(/\bvs\.?\b/gi, 'versus').replace(/\be\.g\./gi, 'for example').replace(/\bi\.e\./gi, 'that is');
  t = t.replace(/\b[A-Z]{2,}\b/g, (m) => {
    if (SAID[m]) return SAID[m]; if (SPELLED.has(m)) return spaced(m); if (tickers.has(m)) return spaced(m);
    return cap1(m); // any other shouted word (a headline, a channel name) is simply said as a word
  });
  t = t.replace(/&/g, ' and ').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\u2026/g, '...').replace(/\+/g, ' plus ').replace(/(\w)\/(\w)/g, '$1 $2').replace(/[*_#<>[\]{}|\\^~`]/g, ' ');
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

// Split into sentences, then split any very long sentence at a comma or "and" so no utterance is long enough to be cut off by a browser.
export function sentencesOf(text) { return String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).map((s) => s.trim()).filter(Boolean); }
export function chunksOf(text, max = 170) {
  const out = [];
  const cut = (s) => {
    if (s.length <= max) { out.push(s); return; }
    const mid = s.length / 2; let best = -1, bd = 1e9; const re = /[,;:]\s|\s(?:and|but|while|as|which|with)\s/g; let m;
    while ((m = re.exec(s))) { const at = m.index + (m[0].startsWith(' ') ? 0 : m[0].length - 1); const d = Math.abs(at - mid); if (d < bd && at > 20 && at < s.length - 20) { bd = d; best = at; } }
    if (best < 0) { const sp = s.lastIndexOf(' ', max); best = sp > 20 ? sp : max; }
    cut(s.slice(0, best + 1).trim()); cut(s.slice(best + 1).trim());
  };
  for (const s of sentencesOf(text)) cut(s);
  return out;
}

// ---------- delivery: pace and pitch per sentence ----------
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function prosody(base, say, idx, total, mood = 'steady', feel = null) {
  let rate = base.rate, pitch = base.pitch;
  if (feel) { const sh = browserShape(feel.emotion, feel.intensity); rate *= sh.rate; pitch *= sh.pitch; mood = 'steady'; } // the sentence's own emotion replaces the channel's fixed mood
  const jitter = ((hash(say) % 9) - 4) / 100; // -0.04 .. +0.04, the same text always gets the same delivery
  rate *= 1 + jitter * 0.6; pitch *= 1 + jitter * 0.5;
  if (idx === 0) { rate *= 0.96; pitch *= 1.04; } // the first line is the one that has to land
  if (idx === total - 1 && total > 1) { rate *= 0.97; pitch *= 0.94; } // falling close signals the end of the story
  if (/\?$/.test(say)) pitch *= 1.06;
  if (/!$/.test(say)) { pitch *= 1.04; rate *= 1.03; }
  if (/\b(percent|rupees|crore|lakh|point|thousand)\b/.test(say)) rate *= 0.95; // slow down on figures
  if (mood === 'urgent') { rate *= 1.05; pitch *= 1.03; } else if (mood === 'grave') { rate *= 0.93; pitch *= 0.95; }
  return { rate: clamp(rate, 0.7, 1.35), pitch: clamp(pitch, 0.6, 1.5) };
}

// Per-anchor delivery. "key" is also the voice slot used by the speech engine.
export const DELIVERY = {
  flashwire: { rate: 1.1, pitch: 0.92, mood: 'urgent' },
  marketline: { rate: 1.0, pitch: 1.0, mood: 'steady' },
  undercurrent: { rate: 0.94, pitch: 0.9, mood: 'grave' },
  sunny: { rate: 1.06, pitch: 0.96, mood: 'steady' },
  tara: { rate: 1.05, pitch: 1.1, mood: 'steady' },
  announcer: { rate: 1.08, pitch: 0.86, mood: 'steady' },
};

const LEADS = {
  flashwire: { Breaking: ['Breaking news.', 'This just in.', 'We are breaking into our coverage.', 'Developing right now.'], Unverified: ['A developing story, and we stress, it is unconfirmed.', 'We are hearing something, and we are still checking it.'], Correction: ['We have a correction.', 'We need to set something straight.'], General: ['And in the headlines.', 'A story the whole country is talking about.'], _: ['Breaking news.'] },
  marketline: { Verified: ['A confirmed development now.', 'Here is what we can verify.', 'Turning to a verified story.'], Denial: ['A clarification now.', 'We can now put one story to rest.'], General: ['Turning to the wider picture.', 'A broader story now.'], _: ['Now, the latest.'] },
  undercurrent: { 'Sources say': ['Here is what our sources are telling us.', 'This is what we are hearing.'], Rumour: ['A rumour is circulating.', 'Here is something we are tracking.'], Analysis: ['Here is how we read the evidence.', 'Our analysis.'], _: ['Here is what we are looking at.'] },
};
const HANDOFF = (who) => [`Thanks, ${who}.`, `Thank you, ${who}.`];
export const handoffLine = (who, rot = 0) => { const a = HANDOFF(who); return a[rot % a.length]; };

export function cleanBody(body) { return String(body || '').replace(/^[^:"]{2,24}:\s*/, '').replace(/\b(Sunny|Tara):\s*/g, '').replace(/[\u201c\u201d"]/g, '').replace(/\s+/g, ' ').trim(); }
function bantering(body) { // DAILY PULSE writes dialogue: Tara: "..." Sunny: "..."
  const out = []; const re = /\b(Sunny|Tara):\s*"([^"]*)"/g; let m, last = 0;
  while ((m = re.exec(body))) { out.push({ who: m[1].toLowerCase(), text: m[2].trim() }); last = re.lastIndex; }
  const rest = body.slice(last).replace(/[\u201c\u201d"]/g, '').trim(); if (rest) out.push({ who: out.length ? 'tara' : 'sunny', text: rest });
  return out.length ? out : null;
}

// Build what the anchors say for one item. Returns display text (captions) and the utterance chunks for the speech engine.
// item: { kind: 'story'|'segment'|'ad', ch, label, text, raw?: {headline, body}, short?, breaking, spot? }
export function planItem(it, opts = {}) {
  const rot = opts.rot || 0; const ctx = { tickers: opts.tickers }; const beats = [];
  const push = (who, text) => { const t = String(text || '').trim(); if (t) beats.push({ who, text: t }); };
  if (opts.handoff) push(it.ch === 'dailypulse' ? 'sunny' : 'main', opts.handoff);
  if (it.kind === 'ad') {
    push('announcer', it.text);
  } else if (opts.script && opts.script.length) { // lines written by the AI newsroom (server/newsroom.js), each with its own emotion
    opts.script.forEach((l) => { const t = String(l.text || '').trim(); if (t) beats.push({ who: it.ch === 'dailypulse' ? (beats.length % 2 ? 'tara' : 'sunny') : 'main', text: t, emotion: l.emotion, intensity: l.intensity }); });
  } else if (it.kind === 'story' && it.raw) {
    const body = it.raw.body; const talk = it.ch === 'dailypulse' ? bantering(body) : null;
    if (talk) { (it.short ? talk.slice(0, 1) : talk).forEach((b) => push(b.who, b.text)); }
    else {
      const table = LEADS[it.ch] || {}; const pool = (it.breaking && table.Breaking) || table[it.label] || table._ || [];
      if (pool.length) push('main', pool[rot % pool.length]);
      const clean = cleanBody(body); const sents = sentencesOf(clean);
      push('main', it.short ? sents.slice(0, 2).join(' ') : clean);
    }
  } else if (it.ch === 'dailypulse') {
    const s = sentencesOf(it.text); push('sunny', s[0]); push('tara', s.slice(1).join(' '));
  } else push('main', it.text);

  const chunks = []; let off = 0; const display = []; const all = beats.map((b) => chunksOf(spokenForm(b.text, ctx))); const nAll = all.reduce((a, p) => a + p.length, 0); let gi = 0;
  beats.forEach((b, bi) => {
    const key = b.who === 'main' ? it.ch : b.who; const base = DELIVERY[key] || DELIVERY.marketline; const parts = all[bi];
    display.push(b.text);
    parts.forEach((p, i) => {
      const auto = pickEmotion(it, p, gi, nAll); const feel = b.emotion ? { emotion: b.emotion, intensity: b.intensity || auto.intensity } : auto; // AI-written lines bring their own emotion; templates get one from the text
      const pr = prosody(base, p, i, parts.length, base.mood, feel);
      chunks.push({ who: b.who, key, say: p, rate: pr.rate, pitch: pr.pitch, off, emotion: feel.emotion, intensity: feel.intensity }); off += p.length + 1; gi++;
    });
  });
  const totalSay = Math.max(1, off);
  return { beats, chunks, display: display.join(' ').replace(/\s+/g, ' ').trim(), totalSay, estMs: Math.round(totalSay * 68 / ((DELIVERY[it.ch] || { rate: 1 }).rate)) };
}

// ---------- ad breaks ----------
// Fictional sponsors and house promos. Each is short (about 8 seconds spoken). They only air in a content gap.
export const AD_SPOTS = [
  { brand: 'Kesar Chai Company', tag: 'Sip, then trade.', say: 'Long market morning? Reach for Kesar Chai. Slow brewed, strong, and made for the hours between the opening bell and the close. Kesar Chai Company. Sip, then trade.' },
  { brand: 'Ledger Lane Notebooks', tag: 'Write down why.', say: 'Before you buy, write down why. Ledger Lane notebooks, made for people who like to review their own decisions. Ledger Lane. Write down why.' },
  { brand: 'Tiffin Express', tag: 'Lunch before the closing bell.', say: 'Hungry and busy? Tiffin Express brings a hot lunch to your desk before the closing bell. Tiffin Express. Order once, eat well.' },
  { brand: 'Steady Fibre Broadband', tag: 'Steady connection, steady nerves.', say: 'Steady Fibre Broadband. A steady connection, and steadier nerves. Because no one wants the screen to freeze when the market moves.' },
  { brand: 'BullRun Learn', tag: 'Try a practice situation.', say: 'New to this? Open the Learn tab in BullRun and try a practice situation. No real money, just real lessons. BullRun Learn.' },
  { brand: 'BullRun Truth Mode', tag: 'See why prices moved.', say: 'Curious why a price really moved? When the market closes, switch on Truth Mode in BullRun and see what was behind the headlines.' },
];
export const SLATE = { brand: 'BullRun Live', tag: 'Please stand by', say: 'We are having a small technical issue. Please stand by, we will be right back.' };

// Ads are the lowest priority on air: never while a story is waiting, only after a dry spell, never too often, and capped at a small share of airtime.
export const AD_RULES = { dryNeeded: 2, minGapMs: 150000, maxShare: 0.07, warmupMs: 60000, maxMs: 11000 };
export function adDue(st, now, rules = AD_RULES) {
  if (st.queued) return false; if (st.dry < rules.dryNeeded) return false; if (now - st.lastAdAt < rules.minGapMs) return false;
  if (st.airMs > rules.warmupMs && st.adMs / st.airMs > rules.maxShare) return false; return true;
}
export function adItem(n, seq, ch = 'marketline') {
  const s = AD_SPOTS[n % AD_SPOTS.length];
  return { key: 'a' + seq, kind: 'ad', ch, brand: s.brand, tag: s.tag, headline: s.brand, label: 'Advertisement', text: s.say, stamp: '', cos: [] };
}
export function slateItem(seq, ch = 'marketline') { return { key: 'a' + seq, kind: 'ad', slate: true, ch, brand: SLATE.brand, tag: SLATE.tag, headline: 'We will be right back', label: 'Please stand by', text: SLATE.say, stamp: '', cos: [] }; }
