'use strict';
// Emotion, the AI newsroom's fact checks, and emotion in the voice engines (OpenAI, Gemini, Fish Audio, ElevenLabs). Mock servers only; no key or network.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bullrun-emo-${process.pid}.sqlite`);
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { compose } = require('../server/news');
const NR = require('../server/newsroom');
const load = () => Promise.all([import('../public/js/emotion.js'), import('../public/js/broadcast.js')]);
const ENV = ['AI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'TTS_PROVIDER', 'TTS_API_KEY', 'TTS_MODEL', 'TTS_BASE_URL', 'TTS_ENABLED', 'FISH_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_VOICE_FLASHWIRE', 'FISH_VOICE_DEFAULT', 'ELEVENLABS_VOICE_MARKETLINE', 'AI_SCRIPTS'];
const clean = () => ENV.forEach((k) => delete process.env[k]);
async function mock(reply) {
  const calls = []; const srv = http.createServer((req, res) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { calls.push({ url: req.url, headers: req.headers, body: d ? JSON.parse(d) : null }); const r = reply(calls[calls.length - 1], calls.length); res.writeHead(r.status || 200, { 'content-type': r.type || 'application/json' }); res.end(r.raw || JSON.stringify(r.json)); }); });
  await new Promise((r) => srv.listen(0, r)); return { calls, url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() };
}

test('emotion follows the story: breaking is urgent, a rumour is sceptical, a correction is reassuring, bad confirmed news is grave', async () => {
  const [E] = await load();
  assert.strictEqual(E.baseEmotion({ kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true, dir: -1, mag: 0.06 }).emotion, 'urgent');
  assert.strictEqual(E.baseEmotion({ kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true, dir: 1, mag: 0.06 }).emotion, 'excited');
  assert.strictEqual(E.baseEmotion({ kind: 'story', ch: 'undercurrent', label: 'Rumour' }).emotion, 'skeptical');
  assert.strictEqual(E.baseEmotion({ kind: 'story', ch: 'flashwire', label: 'Correction' }).emotion, 'reassuring');
  assert.strictEqual(E.baseEmotion({ kind: 'story', ch: 'marketline', label: 'Verified', dir: -1, mag: 0.07 }).emotion, 'grave');
  assert.strictEqual(E.baseEmotion({ kind: 'ad', ch: 'marketline' }).emotion, 'cheerful');
});

test('emotion moves within a story: loud lead-in, steady close, questions and hedges sound doubtful', async () => {
  const [E] = await load(); const it = { kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true, dir: -1, mag: 0.08 };
  const lead = E.pickEmotion(it, 'Breaking news!', 0, 4), close = E.pickEmotion(it, 'We will keep you posted.', 3, 4);
  assert.ok(lead.intensity > close.intensity, `${lead.intensity} vs ${close.intensity}`);
  assert.strictEqual(E.pickEmotion({ kind: 'story', ch: 'marketline', label: 'Verified' }, 'Could this be the start of something bigger?', 1, 3).emotion, 'skeptical');
  assert.ok(E.pickEmotion({ kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true }, 'A SHOCKING collapse!!', 1, 3).intensity > E.pickEmotion({ kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true }, 'A small change.', 1, 3).intensity);
  const urgent = E.browserShape('urgent', 0.9), grave = E.browserShape('grave', 0.9); assert.ok(urgent.rate > 1 && grave.rate < 1 && urgent.pitch > grave.pitch);
});

test('planned chunks carry an emotion; AI-written lines bring their own', async () => {
  const [, B] = await load(); const ev = { text: { fact: 'Karnex Foods reports a fire at its main plant', rumor: 'the fire may close the plant', deny: 'the fire was small', ctx: 'Analysts expect a short disruption.' }, dir: -1, coName: 'Karnex Foods', industries: ['Food'], kind: 'company', links: {} };
  const n = compose('flashwire', 'default', ev); const it = { kind: 'story', ch: 'flashwire', label: 'Breaking', breaking: true, dir: -1, mag: 0.06, raw: { headline: n.headline, body: n.body }, text: '' };
  const plan = B.planItem(it, { rot: 0 }); assert.ok(plan.chunks.every((c) => c.emotion && c.intensity > 0)); assert.strictEqual(plan.chunks[0].emotion, 'urgent');
  const ai = B.planItem(it, { script: [{ text: 'Breaking news, a fire at Karnex Foods.', emotion: 'urgent' }, { text: 'We will keep you posted.', emotion: 'reassuring' }] });
  assert.deepStrictEqual(ai.chunks.map((c) => c.emotion), ['urgent', 'reassuring']); assert.match(ai.display, /fire at Karnex Foods/);
});

const input = { ch: 'flashwire', label: 'Breaking', status: 'breaking', headline: 'BREAKING: KARNEX FOODS REPORTS A FIRE AT ITS MAIN PLANT', body: 'Jax Rourke: "We are getting this as we go to air. Karnex Foods reports a fire at its main plant. Markets could move fast."', companies: ['Karnex Foods'], direction: 'down', size: 'big', recent: [] };
const good = { lines: [{ text: 'Breaking news right now, a fire at the main plant of Karnex Foods.', emotion: 'urgent' }, { text: 'Markets could move fast on this one.', emotion: 'worried' }, { text: 'We will keep you posted.', emotion: 'reassuring' }] };

test('AI newsroom: a faithful script passes; invented numbers, names, advice, markup and certainty are rejected', () => {
  const ok = NR.validate(good, input); assert.strictEqual(ok.length, 3); assert.strictEqual(ok[1].emotion, 'worried');
  const bad = (lines, inp = input) => assert.throws(() => NR.validate({ lines: lines.map((t) => ({ text: t, emotion: 'urgent' })) }, inp));
  bad(['Breaking news, Karnex Foods reports a fire and losses of 40 crore.']);                 // invented number
  bad(['Breaking news, Zentrix Holdings reports a fire at its main plant.']);                   // invented company
  bad(['Karnex Foods reports a fire at its main plant, so you should buy the dip now.']);       // advice
  bad(['Karnex Foods will crash tomorrow after a fire at its main plant, mark my words.']);     // firm prediction
  bad(['Karnex **Foods** reports a fire at its main plant.']);                                  // markup
  bad(['Fire.']);                                                                               // too short
  bad(['Wow, what a day for the markets, truly a remarkable and astonishing day all around.']); // does not report the story
  const rumour = { ...input, status: 'unconfirmed', body: 'Sources say Karnex Foods may have a fire at its main plant. Nothing is confirmed.' };
  bad(['Karnex Foods has a fire at its main plant, and it is serious.'], rumour);                // rumour stated as fact
  assert.ok(NR.validate({ lines: [{ text: 'Unconfirmed reports of a fire at the main plant of Karnex Foods.', emotion: 'skeptical' }, { text: 'We are still checking this.', emotion: 'skeptical' }] }, rumour));
  bad(['Karnex Foods rumours of a fire at its main plant are going around.'], { ...input, status: 'confirmed' }); // confirmed story must not sound unconfirmed
  assert.strictEqual(NR.validate({ lines: [{ text: 'Breaking news, a fire at the main plant of Karnex Foods.', emotion: 'made-up-emotion' }] }, input)[0].emotion, 'neutral');
});

test('AI newsroom over HTTP: Gemini writes the lines, checked lines are returned, rejected lines give a code the browser falls back on', async () => {
  clean(); const { server } = require('../server/index'); let answer = good;
  const m = await mock(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } }));
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'gem-key', AI_BASE_URL: m.url });
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, tok) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
  assert.strictEqual((await post('/api/anchor-script', input)).status, 401);
  const tok = (await (await post('/api/login', { name: 'Script Tester' })).json()).token;
  assert.strictEqual((await (await fetch(base + '/api/health')).json()).script.configured, true);
  const r = await post('/api/anchor-script', input, tok); assert.strictEqual(r.status, 200); const j = await r.json(); assert.strictEqual(j.lines.length, 3);
  const c = m.calls[0]; assert.match(c.body.systemInstruction.parts[0].text, /Jax Rourke/); assert.match(c.body.systemInstruction.parts[0].text, /Use ONLY the facts/); assert.strictEqual(JSON.parse(c.body.contents[0].parts[0].text).status, 'breaking');
  answer = { lines: [{ text: 'Karnex Foods lost 90 crore in a fire at its main plant.', emotion: 'urgent' }] };
  const bad = await post('/api/anchor-script', input, tok); assert.strictEqual(bad.status, 422); assert.strictEqual((await bad.json()).code, 'REJECTED');
  process.env.AI_SCRIPTS = 'off'; assert.strictEqual((await post('/api/anchor-script', input, tok)).status, 503);
  m.close(); server.close(); clean();
});

test('voice engines receive the emotion: OpenAI and Gemini as a spoken brief, Fish as a tag plus speed, ElevenLabs as stability', async () => {
  clean(); const TTS = require('../server/tts');
  let m = await mock(() => ({ type: 'audio/mpeg', raw: 'ID3a' })); Object.assign(process.env, { AI_PROVIDER: 'openai', AI_API_KEY: 'sk', TTS_BASE_URL: m.url });
  await TTS.synthesize(1, 'flashwire', 'A fire at the plant.', 'urgent', 0.9); assert.match(m.calls[0].body.instructions, /urgent and alert/); assert.match(m.calls[0].body.instructions, /strong intensity/);
  await TTS.synthesize(1, 'flashwire', 'A fire at the plant.', 'grave', 0.3); assert.strictEqual(m.calls.length, 2, 'the same words with another emotion are a new take'); assert.match(m.calls[1].body.instructions, /sombre/);
  m.close(); clean();
  m = await mock(() => ({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: Buffer.alloc(480).toString('base64') } }] } }] } })); Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'k', TTS_BASE_URL: m.url });
  await TTS.synthesize(2, 'marketline', 'Shares fell.', 'worried', 0.8); assert.match(m.calls[0].body.contents[0].parts[0].text, /concerned and uneasy/); m.close(); clean();
  m = await mock(() => ({ type: 'audio/mpeg', raw: 'ID3f' })); Object.assign(process.env, { TTS_PROVIDER: 'fish', FISH_API_KEY: 'fish-key', TTS_BASE_URL: m.url, FISH_VOICE_FLASHWIRE: 'ref123' });
  assert.ok(TTS.enabled()); const f = await TTS.synthesize(3, 'flashwire', 'Breaking news.', 'urgent', 0.9); assert.strictEqual(f.type, 'audio/mpeg');
  const fc = m.calls[0]; assert.strictEqual(fc.url, '/v1/tts'); assert.strictEqual(fc.headers.authorization, 'Bearer fish-key'); assert.strictEqual(fc.headers.model, 's2.1-pro-free'); assert.strictEqual(fc.body.text, '[tense] Breaking news.'); assert.strictEqual(fc.body.reference_id, 'ref123'); assert.ok(fc.body.prosody.speed > 1.05);
  m.close(); clean();
  m = await mock(() => ({ type: 'audio/mpeg', raw: 'ID3e' })); Object.assign(process.env, { TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'el-key', TTS_BASE_URL: m.url, ELEVENLABS_VOICE_MARKETLINE: 'voiceX' });
  await TTS.synthesize(4, 'marketline', 'Markets are calm.', 'reassuring', 0.2); await TTS.synthesize(4, 'marketline', 'Markets are crashing!', 'urgent', 1);
  assert.match(m.calls[0].url, /^\/v1\/text-to-speech\/voiceX\?output_format=mp3_44100_128$/); assert.strictEqual(m.calls[0].headers['xi-api-key'], 'el-key'); assert.ok(m.calls[1].body.voice_settings.stability < m.calls[0].body.voice_settings.stability, 'stronger feeling, more expressive');
  m.close(); clean();
});
