'use strict';
// Optional natural anchor voices using the same key you already use for AI text: OpenAI (ChatGPT API key) or Gemini (Google AI Studio key).
// The browser sends only the words to be spoken; the key stays on the server. Any failure returns an error and the browser falls back to its built-in voices.
const crypto = require('crypto');
const ALIAS = { google: 'gemini', gemini: 'gemini', chatgpt: 'openai', openai: 'openai', fish: 'fish', 'fish-audio': 'fish', elevenlabs: 'elevenlabs', eleven: 'elevenlabs' };
// Emotion briefs. The client picks an emotion and an intensity for every take (see public/js/emotion.js); each engine gets it in its own language:
// a spoken brief for OpenAI and Gemini, a bracket tag plus speed and volume for Fish Audio (the same scheme dualcast uses), stability for ElevenLabs.
const EMOTION = {
  neutral: { tone: 'neutral and clear', fish: '[calm]', speed: 1.0, vol: 0 },
  confident: { tone: 'confident, clear and authoritative', fish: '[confident]', speed: 1.0, vol: 1 },
  urgent: { tone: 'urgent and alert, as if news has just broken; fast, tight, with strong emphasis on the key facts', fish: '[tense]', speed: 1.12, vol: 3 },
  excited: { tone: 'excited and energised, with a lift in the voice and real enthusiasm', fish: '[excited]', speed: 1.1, vol: 3 },
  worried: { tone: 'concerned and uneasy, slightly slower and lower, with weight on the bad news', fish: '[worried]', speed: 0.97, vol: 1 },
  grave: { tone: 'serious and sombre, slow and weighty, low pitch, clear pauses', fish: '[serious]', speed: 0.92, vol: 1 },
  skeptical: { tone: 'careful and sceptical, measured, making it clear the claim is not confirmed', fish: '[curious]', speed: 0.96, vol: 0 },
  reassuring: { tone: 'calm and reassuring, steady, settling the audience', fish: '[calm]', speed: 0.95, vol: 0 },
  warm: { tone: 'warm, friendly and conversational', fish: '[relaxed]', speed: 1.02, vol: 1 },
  impressed: { tone: 'impressed and upbeat, with positive emphasis', fish: '[impressed]', speed: 1.03, vol: 2 },
  thoughtful: { tone: 'thoughtful and analytical, unhurried', fish: '[serious]', speed: 0.95, vol: 0 },
  cheerful: { tone: 'bright and upbeat, like a radio commercial', fish: '[excited]', speed: 1.06, vol: 2 },
};
const feel = (e, i) => { const em = EMOTION[e] ? e : 'neutral'; const k = Math.max(0, Math.min(1, Number(i) || 0.5)); return { name: em, ...EMOTION[em], level: k < 0.4 ? 'subtle' : k < 0.7 ? 'moderate' : 'strong', k }; };

// Voice per presenter. OpenAI: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse. Gemini: Kore, Puck, Charon, Orus, Zephyr, Gacrux, and more.
const VOICES = {
  openai: { flashwire: 'ash', marketline: 'coral', undercurrent: 'sage', sunny: 'echo', tara: 'nova', announcer: 'onyx' },
  gemini: { flashwire: 'Orus', marketline: 'Kore', undercurrent: 'Gacrux', sunny: 'Puck', tara: 'Zephyr', announcer: 'Charon' },
};
// How each presenter should sound. This is the "speak like an anchor" brief handed to the voice model.
const STYLE = {
  flashwire: 'a confident, fast-paced breaking-news TV anchor. Urgent but controlled. Slightly slower on the first line, a clear pause at the end of each sentence, and a falling tone on the last line',
  marketline: 'a calm, authoritative business-news TV anchor. Measured and precise, slower on figures, a clear pause at the end of each sentence, and a falling tone on the last line',
  undercurrent: 'a serious investigative-news TV anchor. Low, deliberate and slightly sceptical, with meaningful pauses and a falling tone on the last line',
  sunny: 'a warm, friendly morning-show co-host. Natural, upbeat and conversational',
  tara: 'a warm, bright morning-show co-host. Natural, lively and conversational',
  announcer: 'a brisk radio commercial announcer. Clear, friendly and upbeat, finishing with the brand name',
};
const cfg = () => {
  const ai = String(process.env.AI_PROVIDER || '').toLowerCase();
  const provider = ALIAS[String(process.env.TTS_PROVIDER || ai).toLowerCase()] || null;
  const sameKeyAsText = provider && ALIAS[ai] === provider;
  const own = provider === 'fish' ? process.env.FISH_API_KEY : provider === 'elevenlabs' ? process.env.ELEVENLABS_API_KEY : '';
  const key = process.env.TTS_API_KEY || own || (sameKeyAsText ? process.env.AI_API_KEY || '' : '');
  const off = /^(0|off|false|no)$/i.test(process.env.TTS_ENABLED || '');
  const DM = { gemini: 'gemini-3.1-flash-tts-preview', fish: 's2.1-pro-free', elevenlabs: 'eleven_flash_v2_5' };
  const model = process.env.TTS_MODEL || DM[provider] || 'gpt-4o-mini-tts';
  return { provider, key, off, model, base: process.env.TTS_BASE_URL || '', timeout: Number(process.env.TTS_TIMEOUT_MS) || 20000 };
};
const enabled = () => { const c = cfg(); return !!(c.provider && c.key && !c.off); };
class TTSError extends Error { constructor(code, msg, status) { super(msg || code); this.code = code; this.status = status || 502; } }

// 16-bit mono PCM to a playable WAV (Gemini returns raw PCM).
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
}
const errText = async (r) => { try { const j = await r.json(); return String((j.error && (j.error.message || j.error.status)) || j.message || '').slice(0, 160); } catch (_) { return ''; } };

const envVoice = (prefix, who) => process.env[`${prefix}_${who.toUpperCase()}`] || process.env[`${prefix}_DEFAULT`] || '';
async function fetchAudio(c, who, text, emo) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), c.timeout);
  const voice = (VOICES[c.provider] || {})[who] || (VOICES[c.provider] || {}).marketline; const style = STYLE[who] || STYLE.marketline;
  try {
    let r;
    if (c.provider === 'openai') {
      r = await fetch((c.base || 'https://api.openai.com/v1') + '/audio/speech', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key },
        body: JSON.stringify({ model: c.model, voice, input: text, response_format: 'mp3', instructions: `Speak as ${style}. Emotion: ${emo.tone} (${emo.level} intensity). Neutral Indian English accent. Perform it like live television, not like reading. Do not add any words.` }) });
    } else if (c.provider === 'gemini') {
      r = await fetch(`${c.base || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Say as ${style}, in a ${emo.tone} tone (${emo.level} intensity), with a neutral Indian English accent: ${text}` }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) });
    } else if (c.provider === 'fish') { // same call shape as dualcast/fish_client.py: the emotion goes in as a bracket tag, speed and volume as prosody
      const ref = envVoice('FISH_VOICE', who); const body = { text: `${emo.fish} ${text}`, format: 'mp3', prosody: { speed: Math.round(emo.speed * (0.96 + emo.k * 0.08) * 100) / 100, volume: emo.vol } }; if (ref) body.reference_id = ref;
      r = await fetch((c.base || 'https://api.fish.audio') + '/v1/tts', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key, model: c.model }, body: JSON.stringify(body) });
    } else { // elevenlabs: lower stability is more expressive, so strong feelings get a lower value
      const vid = envVoice('ELEVENLABS_VOICE', who) || 'pNInz6obpgDQGcFmaJgB';
      r = await fetch(`${c.base || 'https://api.elevenlabs.io'}/v1/text-to-speech/${encodeURIComponent(vid)}?output_format=mp3_44100_128`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'xi-api-key': c.key },
        body: JSON.stringify({ text, model_id: c.model, voice_settings: { stability: Math.round((0.6 - 0.35 * emo.k) * 100) / 100, similarity_boost: 0.75 } }) });
    }
    if (r.status === 429) throw new TTSError('RATE_LIMIT', 'rate limited', 429);
    if (!r.ok) { const why = await errText(r); throw new TTSError(r.status === 401 || r.status === 403 ? 'AUTH' : 'HTTP', `HTTP ${r.status}${why ? ': ' + why : ''}`); }
    if (c.provider !== 'gemini') return { type: 'audio/mpeg', data: Buffer.from(await r.arrayBuffer()) };
    const j = await r.json(); const part = (((j.candidates || [])[0] || {}).content || {}).parts; const inl = part && part.map((x) => x.inlineData || x.inline_data).find(Boolean);
    if (!inl || !inl.data) throw new TTSError('BAD_AUDIO', 'no audio in response');
    const rate = Number((/rate=(\d+)/.exec(inl.mimeType || inl.mime_type || '') || [])[1]) || 24000; return { type: 'audio/wav', data: pcmToWav(Buffer.from(inl.data, 'base64'), rate) };
  } catch (e) {
    if (e instanceof TTSError) throw e; if (e.name === 'AbortError') throw new TTSError('TIMEOUT', 'timed out', 504); throw new TTSError('NETWORK', e.message);
  } finally { clearTimeout(to); }
}

// Same words and voice are never paid for twice (replays, repeated ads and tips). Bounded memory.
const cache = new Map(); let cacheBytes = 0; const CACHE_MAX = 80 * 1024 * 1024;
function remember(k, v) { cache.set(k, v); cacheBytes += v.data.length; while (cacheBytes > CACHE_MAX && cache.size) { const o = cache.keys().next().value; cacheBytes -= cache.get(o).data.length; cache.delete(o); } }
// A simple per-user limit so a runaway page cannot run up a bill: 45 requests a minute.
const hits = new Map();
function allowed(uid) { const now = Date.now(); const a = (hits.get(uid) || []).filter((t) => now - t < 60000); if (a.length >= 45) { hits.set(uid, a); return false; } a.push(now); hits.set(uid, a); return true; }

async function synthesize(uid, who, text, emotion, intensity) {
  const c = cfg(); if (!enabled()) throw new TTSError('NO_KEY', 'AI voice is not configured', 503);
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500); if (!t) throw new TTSError('EMPTY', 'nothing to say', 400);
  const w = Object.prototype.hasOwnProperty.call(STYLE, who) ? who : 'marketline';
  const emo = feel(emotion, intensity); const k = crypto.createHash('sha1').update([c.provider, c.model, w, emo.name, emo.level, t].join('|')).digest('hex'); if (cache.has(k)) return cache.get(k);
  if (!allowed(uid)) throw new TTSError('RATE_LIMIT', 'too many voice requests', 429);
  const out = await fetchAudio(c, w, t, emo); remember(k, out); return out;
}
module.exports = { enabled, cfg, synthesize, pcmToWav, TTSError, VOICES, STYLE, EMOTION };
