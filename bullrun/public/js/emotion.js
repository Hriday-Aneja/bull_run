// Emotion for the anchors. Ported from dualcast's emotion.py: a fixed delivery ("excited" on every line) sounds flat, because when
// everything is hype nothing is. Here every sentence gets its own emotion and intensity, picked from the story (is it breaking?
// confirmed or a rumour? good or bad for prices? how big?) and from the sentence itself (an exclamation, a shouted word, a
// question, a closing line). The result drives the AI voice (see server/tts.js), the browser-voice fallback, and the anchor's face.
export const EMOTIONS = ['neutral', 'confident', 'urgent', 'excited', 'worried', 'grave', 'skeptical', 'reassuring', 'warm', 'impressed', 'thoughtful', 'cheerful'];
const BIG = /\b(record|crash|plunge|plunges|surge|surges|soar|soars|collapse|collapses|jackpot|catastrophe|shock|wipe|wiped|halt|halted|fire|fraud|ban|banned|shutdown|default|bankrupt|bankruptcy|rally|rallies|tumble|tumbles|skyrocket|slump|slumps|breakthrough|blockbuster)\b/i;
const PRAISE = /\b(brilliant|strong|stellar|stunning|impressive|excellent|outstanding|beats?|exceeds?|best)\b/i;
const HEDGE = /\b(unconfirmed|not confirmed|rumou?rs?|sources?|reportedly|alleged|claims?|hearing|still checking|yet to be)\b/i;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const capsRatio = (t) => { const L = String(t).replace(/[^A-Za-z]/g, ''); return L ? L.replace(/[^A-Z]/g, '').length / L.length : 0; };

// The mood of a whole item, before looking at individual sentences.
export function baseEmotion(it) {
  const mag = Number(it.mag) || 0, dir = Number(it.dir) || 0, big = mag >= 0.04;
  if (it.kind === 'ad') return { emotion: 'cheerful', intensity: 0.55 };
  if (it.ch === 'dailypulse') return /Chatter/i.test(it.label || '') ? { emotion: 'skeptical', intensity: 0.4 } : { emotion: 'warm', intensity: 0.5 };
  const lab = String(it.label || '');
  if (it.kind === 'segment') return { emotion: it.ch === 'undercurrent' ? 'thoughtful' : 'confident', intensity: 0.4 };
  if (it.breaking || lab === 'Breaking') return dir > 0 ? { emotion: big ? 'excited' : 'urgent', intensity: big ? 0.85 : 0.65 } : { emotion: 'urgent', intensity: big ? 0.9 : 0.7 };
  if (/Unverified|Rumour|Sources say/.test(lab)) return { emotion: 'skeptical', intensity: 0.5 };
  if (/Correction|Denial/.test(lab)) return { emotion: 'reassuring', intensity: 0.5 };
  if (/Analysis/.test(lab)) return { emotion: 'thoughtful', intensity: 0.45 };
  if (lab === 'Verified') return dir < 0 && big ? { emotion: 'grave', intensity: 0.65 } : dir > 0 && big ? { emotion: 'impressed', intensity: 0.6 } : { emotion: 'confident', intensity: 0.45 };
  return { emotion: 'warm', intensity: 0.45 };
}

// Per-sentence delivery: the same story can open urgent, turn grave on the damage, and close calm and steady.
export function pickEmotion(it, say, idx = 0, total = 1) {
  const base = baseEmotion(it); let { emotion, intensity } = base; const t = String(say || '');
  const bang = (t.match(/!/g) || []).length;
  if (bang) intensity += 0.1 * Math.min(2, bang);
  if (capsRatio(t) > 0.5 && t.length > 6) intensity += 0.15;
  if (BIG.test(t)) intensity += 0.1;
  if (/\?\s*$/.test(t) && emotion !== 'urgent') emotion = 'skeptical';
  if (HEDGE.test(t) && !['urgent', 'excited'].includes(emotion)) emotion = 'skeptical';
  if (PRAISE.test(t) && emotion === 'confident') emotion = 'impressed';
  if (/\b(down|fell|falls|drop|drops|loss|losses|lower)\b/i.test(t) && emotion === 'confident') emotion = 'grave';
  if (idx === 0 && total > 1 && (emotion === 'urgent' || emotion === 'excited')) intensity += 0.1; // the lead-in is the loudest line
  if (idx === total - 1 && total > 2) { intensity -= 0.2; if (emotion === 'urgent' || emotion === 'excited') emotion = intensity > 0.6 ? emotion : 'confident'; } // a steady close, like a real sign-off
  return { emotion, intensity: Math.round(clamp(intensity, 0.2, 1) * 100) / 100 };
}

// How a browser voice (which only has rate, pitch and volume) approximates each emotion.
const SHAPE = { neutral: [1, 1], confident: [1, 1], urgent: [1.09, 1.05], excited: [1.07, 1.1], worried: [0.97, 0.95], grave: [0.9, 0.88], skeptical: [0.95, 0.98], reassuring: [0.94, 1], warm: [1.02, 1.06], impressed: [1, 1.06], thoughtful: [0.94, 0.96], cheerful: [1.06, 1.08] };
export function browserShape(emotion, intensity = 0.5) {
  const [r, p] = SHAPE[emotion] || SHAPE.neutral; const k = clamp(intensity, 0, 1) * 1.4; // stronger feeling, stronger shape
  return { rate: 1 + (r - 1) * k, pitch: 1 + (p - 1) * k, volume: clamp(0.85 + intensity * 0.15, 0.5, 1) };
}
