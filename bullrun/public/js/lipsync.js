// Lip-sync for the studio anchors. The browser's built-in voices do not expose their audio, so the mouth is driven by the
// words being spoken: every word becomes a run of syllable-shaped mouth openings (wide for "ah", round for "oo", narrow for "ee"),
// with the mouth closing between words and at pauses. When the voice reports word boundaries we lock to them; when it does not
// (many online voices), we follow an estimated word timeline that starts when each sentence starts.
const AMP = { a: 1, o: 0.85, u: 0.65, e: 0.75, i: 0.55, y: 0.5 };
const ROUND = { o: 1, u: 1, a: 0, e: -0.7, i: -1, y: -0.5 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let entries = [];      // { at, dur, syl: [{amp, round}], chunk }
let emo = { name: 'neutral', i: 0.4 }, level = 0, round = 0, raf = 0, active = 0, simTimer = null, extFn = null;

const sylOf = (word) => {
  const g = String(word).toLowerCase().match(/[aeiouy]+/g) || ['a'];
  return g.map((v) => ({ amp: AMP[v[0]] || 0.7, round: ROUND[v[0]] || 0 }));
};
// Rough speaking time of one word at a given voice rate, with a longer rest after punctuation.
export const wordMs = (word, rate = 1) => {
  const w = String(word); const core = w.replace(/[^\w]/g, '');
  return Math.max(120, (60 * Math.max(2, core.length) + 40) / Math.max(0.6, rate)) + (/[,;:]$/.test(w) ? 140 : /[.!?]$/.test(w) ? 280 : 0);
};
const schedule = (at, word, rate, chunk) => { const ms = wordMs(word, rate); const talk = /[.!?,;:]$/.test(word) ? ms - (/[,;:]$/.test(word) ? 140 : 280) : ms; entries.push({ at, dur: Math.max(90, talk), syl: sylOf(word), chunk, adv: ms }); return ms; };

function target(now) {
  for (let i = entries.length - 1; i >= 0; i--) if (now - entries[i].at > entries[i].dur + 400) entries.splice(i, 1);
  let best = 0, rd = 0;
  for (const e of entries) {
    const t = now - e.at; if (t < 0 || t > e.dur) continue;
    const f = t / e.dur, n = e.syl.length, k = Math.min(n - 1, Math.floor(f * n)), sf = f * n - k; const s = e.syl[k];
    const env = Math.pow(Math.sin(Math.PI * clamp(sf, 0, 1)), 0.7) * (0.8 + 0.2 * ((k * 7 + n) % 5) / 4); // mouth closes a little between syllables
    if (s.amp * env > best) { best = s.amp * env; rd = s.round; }
  }
  return { best, rd };
}
function apply() {
  const mouths = document.querySelectorAll('.talent .mouth, .anchor .mouth'); const talents = document.querySelectorAll('.talent');
  const l = clamp(level, 0, 1);
  mouths.forEach((el, i) => {
    const on = mouths.length < 2 || i === active; const v = on ? l : 0;
    el.style.transform = `scale(${(0.95 - 0.16 * round + 0.1 * v).toFixed(3)}, ${(0.08 + v * 3.1).toFixed(3)})`;
  });
  talents.forEach((t) => { t.style.setProperty('--lvl', l.toFixed(3)); t.style.setProperty('--emo-i', String(emo.i)); if (t.dataset.emo !== emo.name) t.dataset.emo = emo.name; });
}
function frame() {
  raf = 0; const now = performance.now(); let { best, rd } = target(now);
  if (extFn) { best = extFn(); rd = 0; } // real audio loudness (natural AI voice) beats the word-by-word estimate
  level += (best - level) * (best > level ? 0.55 : 0.3); round += (rd - round) * 0.35; apply();
  if (entries.length || level > 0.02 || simTimer || extFn) raf = requestAnimationFrame(frame); else { level = 0; apply(); }
}
const kick = () => { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame); };

export const lip = {
  // Which mouth moves when a scene has two presenters (Sunny is 0, Tara is 1).
  speaker(who) { active = who === 'tara' ? 1 : 0; },
  // A sentence began: lay out an estimated timeline for its words. Real boundary events replace it.
  chunkStart(c) {
    entries = entries.filter((e) => e.chunk === c); this.speaker(c.who); let t = performance.now(); c.precise = false;
    for (const m of String(c.say).matchAll(/\S+/g)) t += schedule(t, m[0], c.rate, c);
    kick();
  },
  // The voice reported the start of the word at charIndex: drop the guess and follow the voice.
  word(c, charIndex) {
    if (!c.precise) { c.precise = true; entries = []; }
    const m = /^\S+/.exec(String(c.say).slice(charIndex)); if (!m) return; this.speaker(c.who);
    entries = entries.filter((e) => performance.now() - e.at < 40); schedule(performance.now(), m[0], c.rate, c); kick();
  },
  chunkEnd() { /* the last word's envelope finishes on its own */ },
  // Captions-only mode (sound off): move the mouth to the caption words.
  sim(word, rate = 1, who = 'main') { this.speaker(who); schedule(performance.now(), word, rate, null); kick(); },
  // The feeling of the line being spoken: the anchor's brows, eyes and head follow it (see the data-emo rules in style.css).
  emotion(name, i) { emo = { name: name || 'neutral', i: Math.max(0, Math.min(1, Number(i) || 0.4)) }; kick(); },
  stop() { entries = []; extFn = null; kick(); },
  // Drive the mouth from a function that returns the current voice loudness (0 to 1), or pass null to go back to word timing.
  external(fn) { extFn = fn || null; kick(); },
  level: () => level,
};
