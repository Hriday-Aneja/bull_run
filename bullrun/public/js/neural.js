// Natural anchor voice. The server turns each presenter's lines into audio with your OpenAI (ChatGPT) or Gemini key (see server/tts.js);
// this file plays that audio gaplessly with the Web Audio API, drives the captions from the audio clock, and measures the real
// loudness of the voice so the lips follow what is actually being said. If anything fails, the caller falls back to browser voices.
import { auth } from './api.js';
import { lip } from './lipsync.js';

let ctx = null, analyser = null, tdata = null, token = 0, live = [], ticker = null, level = 0;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const neuralSupported = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

// Merge consecutive sentences by the same speaker into one request, so the voice model delivers them as one natural take.
export function groupChunks(chunks, max = 1200) {
  const out = [];
  chunks.forEach((c, i) => {
    const g = out[out.length - 1];
    if (g && g.who === c.who && g.emotion === c.emotion && g.say.length + c.say.length + 1 <= max) { g.say += ' ' + c.say; g.len = c.off + c.say.length - g.off; g.last = i; }
    else out.push({ who: c.who, key: c.key, say: c.say, off: c.off, len: c.say.length, first: i, last: i, emotion: c.emotion, intensity: c.intensity });
  });
  return out;
}
async function fetchAudio(g) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 22000);
  try {
    const r = await fetch('/api/tts', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: 'Bearer ' + auth.token } : {}) }, body: JSON.stringify({ who: g.key || g.who, text: g.say, emotion: g.emotion, intensity: g.intensity }) });
    if (!r.ok) throw new Error('tts ' + r.status);
    return await r.arrayBuffer();
  } finally { clearTimeout(to); }
}
const measure = () => { // loudness of what is being played right now, 0 to 1
  if (!analyser) return 0; analyser.getFloatTimeDomainData(tdata); let s = 0; for (let i = 0; i < tdata.length; i++) s += tdata[i] * tdata[i];
  const rms = Math.sqrt(s / tdata.length); const target = clamp(rms * 7, 0, 1); level += (target - level) * 0.6; return level;
};
export function stopNeural() {
  token++; clearInterval(ticker); ticker = null; lip.external(null);
  for (const s of live) { try { s.stop(); } catch (_) { /* already stopped */ } } live = [];
}
// Handlers: onChunk(i, chunk) onWord(charIndexInAll, true) onEnd() onFail('not-allowed' | 'neural')
export function speakNeural(chunks, h = {}) {
  if (!neuralSupported() || !chunks.length) return false;
  stopNeural(); const my = ++token;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 512; tdata = new Float32Array(analyser.fftSize); analyser.connect(ctx.destination); }
  } catch (_) { return false; }
  const groups = groupChunks(chunks); const plan = []; let failed = false;
  let done = false, entered = -1;
  const startTicker = () => {
    ticker = setInterval(() => {
      if (my !== token) return; const t = ctx.currentTime;
      const k = plan.findIndex((p) => t >= p.when && t < p.end);
      if (k >= 0) { if (k !== entered) { entered = k; if (h.onChunk) h.onChunk(plan[k].g.first, chunks[plan[k].g.first]); } const p = plan[k]; if (h.onWord) h.onWord(p.g.off + Math.floor(((t - p.when) / (p.end - p.when)) * p.g.len), true); }
      const last = plan[plan.length - 1];
      if (done && last && t >= last.end + 0.05) { clearInterval(ticker); ticker = null; lip.external(null); live = []; if (h.onEnd) h.onEnd(); }
    }, 90);
  };
  (async () => {
    try { if (ctx.state !== 'running') await Promise.race([ctx.resume(), sleep(500)]); } catch (_) { /* needs a tap */ }
    if (my !== token) return;
    if (ctx.state !== 'running') { if (h.onFail) h.onFail('not-allowed'); return; } // the browser wants a tap first
    const pending = groups.map((g) => fetchAudio(g).then((b) => ctx.decodeAudioData(b)));
    pending.forEach((p) => p.catch(() => {}));
    lip.external(measure);
    let at = ctx.currentTime + 0.05;
    for (let i = 0; i < groups.length; i++) {
      let buf; try { buf = await pending[i]; } catch (_) { failed = true; break; }
      if (my !== token) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(analyser); live.push(src);
      const when = Math.max(at, ctx.currentTime + 0.02); src.start(when); at = when + buf.duration + (i + 1 < groups.length ? 0.22 : 0); // a short beat between speakers and after a lead-in
      plan.push({ when, end: when + buf.duration, g: groups[i] });
      if (i === 0) startTicker();
    }
    if (failed && plan.length === 0) { stopNeural(); if (h.onFail) h.onFail('neural'); return; }
    done = !failed ? true : 'partial'; // a later part failed: play what we have, then end
  })();
  return true;
}
