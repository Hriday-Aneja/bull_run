'use strict';
// The AI newsroom: writes how each anchor would SAY a story, live, the way dualcast's casters write their lines.
// The model only gets the facts of the story and a persona; everything it writes is checked before it can go on air:
//  - no number, company or person that is not in the story
//  - an unconfirmed story must still sound unconfirmed (the game is about telling verified news from rumour), a confirmed one must not
//  - no advice to buy or sell and no firm predictions
//  - short spoken lines, each with a valid emotion
// Anything that fails the check is rejected and the browser uses its built-in script writer instead, so a bad answer never reaches the screen.
const AI = require('./ai');
const { EMOTION } = require('./tts');

const PERSONA = {
  flashwire: 'You are Jax Rourke, the breaking-news anchor on FLASHWIRE. Fast, punchy, urgent, a crowd-starter. Short sentences. You react the way a live anchor does, but you never state an unconfirmed thing as fact.',
  marketline: 'You are Meera Kapoor, the anchor on MARKETLINE. Calm, precise, authoritative. You report only what is verified, and you add one line on why it matters to markets, using only facts you were given.',
  undercurrent: 'You are Nadia Voss, the investigative anchor on THE UNDERCURRENT. Low, deliberate, sceptical. You always make clear what is not yet confirmed and what the evidence is.',
  dailypulse: 'You are Sunny and Tara, the two friendly hosts of DAILY PULSE. Conversational and warm. Alternate the lines: Sunny speaks first, then Tara, and so on.',
};
const EMOS = Object.keys(EMOTION);
const RULES = `How you talk (this is live television, not reading):
- 2 to 5 spoken lines. Each line 4 to 20 words. Never more than 24.
- Use contractions and natural rhythm. React like a person: a lead-in, the facts, then a steady close such as "We will keep you posted."
- Vary the openers. Never start two lines the same way and never reuse a phrase from the recent lines you are given.
- Use ONLY the facts in the story. Do not add numbers, company names, people, causes, quotes or predictions. Do not tell anyone to buy or sell.
- Keep the story's status honest: if it is unconfirmed or a rumour, say so in plain words; if it is confirmed, say it plainly.
- Give each line an emotion from this list: ${EMOS.join(', ')}. Change the emotion when the story changes mood; do not use the same one on every line.
- Output JSON only, exactly: {"lines":[{"text":"...","emotion":"..."}]}. No names before lines, no stage directions, no emojis, no markdown.`;

const HEDGE = /(unconfirmed|not (yet )?(confirmed|verified)|yet to be (confirmed|verified)|rumou?r|reportedly|sources|we are hearing|we're hearing|claims?|alleged|cannot confirm|can't confirm|still checking|not sure|may )/i;
const NO_ADVICE = /\b(buy now|you should buy|should sell|sell now|invest in|guarantee[sd]?|sure thing|can'?t lose|will (rise|fall|double|crash|soar|rally)|is going to (rise|fall|double|crash|soar))\b/i;
const OK_CAPS = new Set(['I', 'India', 'Indian', 'Mumbai', 'Delhi', 'Sensex', 'Nifty', 'NSE', 'BSE', 'RBI', 'SEBI', 'IPO', 'GDP', 'AI', 'CEO', 'CFO', 'Sunny', 'Tara', 'Jax', 'Meera', 'Nadia', 'Flashwire', 'Marketline', 'Undercurrent', 'Daily', 'Pulse', 'BullRun', 'Live', 'The', 'Rourke', 'Kapoor', 'Voss', 'Thanks', 'Thank']);
const words = (t) => String(t).split(/\s+/).filter(Boolean);
const norm = (t) => String(t).toLowerCase();

function validate(raw, inp) {
  const lines = Array.isArray(raw && raw.lines) ? raw.lines : null; if (!lines || lines.length < 1 || lines.length > 6) throw new Error('line count');
  const source = norm([inp.headline, inp.body, (inp.companies || []).join(' '), inp.ch].join(' ')); const out = []; let total = 0;
  for (const l of lines) {
    const text = String((l && l.text) || '').replace(/^[A-Za-z]+:\s+/, '').replace(/[\u201c\u201d"]/g, '').replace(/\s+/g, ' ').trim(); const n = words(text).length;
    if (n < 3 || n > 24) throw new Error('line length'); total += n; if (/[*_#`<>{}]|https?:/.test(text)) throw new Error('markup');
    if (NO_ADVICE.test(text)) throw new Error('advice or prediction');
    for (const m of text.match(/\d+(?:[.,]\d+)*/g) || []) if (!source.includes(m.toLowerCase())) throw new Error('invented number ' + m);
    const toks = text.split(/\s+/);
    toks.forEach((w, i) => { const c = w.replace(/[^A-Za-z]/g, ''); if (c.length < 2 || !/^[A-Z]/.test(c)) return; const first = i === 0 || /[.!?]$/.test(toks[i - 1] || ''); if (first || OK_CAPS.has(c) || source.includes(c.toLowerCase())) return; throw new Error('invented name ' + c); });
    const emo = EMOS.includes(l.emotion) ? l.emotion : 'neutral'; out.push({ text, emotion: emo });
  }
  if (total > 110) throw new Error('too long'); const all = out.map((o) => o.text).join(' ');
  if (inp.status === 'unconfirmed' && !HEDGE.test(all)) throw new Error('rumour stated as fact');
  if (inp.status === 'confirmed' && /(unconfirmed|rumou?r)/i.test(all)) throw new Error('confirmed story sounds unconfirmed');
  const content = new Set((source.match(/[a-z]{5,}/g) || [])); const shared = new Set((norm(all).match(/[a-z]{5,}/g) || []).filter((w) => content.has(w)));
  if (shared.size < 2) throw new Error('does not report the story');
  return out;
}

const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, n);
function sanitize(b) {
  const ch = Object.prototype.hasOwnProperty.call(PERSONA, b.ch) ? b.ch : 'marketline';
  return { ch, label: clean(b.label, 30), status: ['unconfirmed', 'confirmed', 'correction', 'denial', 'analysis', 'breaking', 'banter'].includes(b.status) ? b.status : 'breaking', headline: clean(b.headline, 200), body: clean(b.body, 900),
    companies: (Array.isArray(b.companies) ? b.companies : []).slice(0, 6).map((x) => clean(x, 40)), direction: ['up', 'down', 'mixed', 'none'].includes(b.direction) ? b.direction : 'none', size: ['small', 'big', 'huge'].includes(b.size) ? b.size : 'small',
    recent: (Array.isArray(b.recent) ? b.recent : []).slice(-6).map((x) => clean(x, 200)) };
}
async function writeScript(body) {
  if (!AI.enabled() || /^(0|off|false|no)$/i.test(process.env.AI_SCRIPTS || '')) { const e = new Error('no AI key'); e.code = 'NO_KEY'; e.status = 503; throw e; }
  const inp = sanitize(body || {}); if (!inp.body && !inp.headline) { const e = new Error('empty'); e.code = 'EMPTY'; e.status = 400; throw e; }
  const user = JSON.stringify({ channel: inp.ch, label: inp.label, status: inp.status, headline: inp.headline, story: inp.body, companies: inp.companies, direction_for_prices: inp.direction, size_of_move: inp.size, recent_lines_do_not_repeat: inp.recent });
  const txt = await AI.callLLM(`${PERSONA[inp.ch]}\n${RULES}`, user, { json: true, timeout: Number(process.env.SCRIPT_TIMEOUT_MS) || 7000 });
  let j; try { j = JSON.parse(String(txt).replace(/^```(?:json)?|```$/gim, '').trim()); } catch (_) { const e = new Error('bad json'); e.code = 'BAD_JSON'; e.status = 502; throw e; }
  try { return validate(j, inp); } catch (err) { const e = new Error('rejected: ' + err.message); e.code = 'REJECTED'; e.status = 422; throw e; }
}
module.exports = { writeScript, validate, sanitize, PERSONA };
