'use strict';
// Checks that AI text and the AI anchor voice work with Gemini and OpenAI (ChatGPT) keys. Uses local mock servers, so no real key or network is needed.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `bullrun-ai-${process.pid}.sqlite`);
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { generateSession } = require('../server/generator');

const ENV = ['AI_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_TIMEOUT_MS', 'TTS_PROVIDER', 'TTS_API_KEY', 'TTS_MODEL', 'TTS_BASE_URL', 'TTS_ENABLED'];
const clean = () => ENV.forEach((k) => delete process.env[k]);
// A mock server that records every request and answers with whatever `reply` returns.
async function mock(reply) {
  const calls = []; const srv = http.createServer((req, res) => {
    let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => { const call = { url: req.url, headers: req.headers, body: d ? JSON.parse(d) : null }; calls.push(call); const r = reply(call, calls.length); res.writeHead(r.status || 200, { 'content-type': r.type || 'application/json' }); res.end(r.raw || JSON.stringify(r.json)); });
  });
  await new Promise((r) => srv.listen(0, r)); return { calls, url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() };
}
const flavorFor = (st) => ({ scenarioTitle: 'A CALM WEEK IN THE MARKET', scenarioBullets: ['Growth is steady and calm.', 'Prices move slowly this week.', 'Traders wait for news.'], companies: st.companies.map((c, i) => ({ industry: c.industry, name: 'Zed' + 'abcdefghij'[i], description: 'A perfectly fictional company used for learning how markets work.' })) });

test('Gemini key: native API, key in a header, JSON mode, scenario text applied', async () => {
  clean(); const st = generateSession({ id: 'g1', seed: 'gem', duration: 'quick' });
  const m = await mock(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(flavorFor(st)) }] } }] } }));
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'gem-key', AI_MODEL: 'gemini-2.5-flash', AI_BASE_URL: m.url });
  const AI = require('../server/ai'); assert.ok(AI.enabled()); assert.strictEqual(AI.cfg().provider, 'gemini');
  const f = await AI.generateFlavor(st); assert.strictEqual(f.companies[0].name, 'Zeda');
  const c = m.calls[0]; assert.strictEqual(c.url, '/models/gemini-2.5-flash:generateContent'); assert.strictEqual(c.headers['x-goog-api-key'], 'gem-key'); assert.ok(!c.url.includes('gem-key'), 'key never in the URL');
  assert.strictEqual(c.body.generationConfig.responseMimeType, 'application/json'); assert.ok(c.body.systemInstruction.parts[0].text); assert.ok(!c.body.generationConfig.thinkingConfig, 'no thinking setting that differs by model version');
  m.close(); clean();
});

test('Gemini: bad key, rate limit and blocked answers fall back cleanly', async () => {
  clean(); const AI = require('../server/ai');
  for (const [status, code] of [[403, 'AUTH'], [401, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'HTTP']]) {
    const m = await mock(() => ({ status, json: { error: { message: 'nope' } } }));
    Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'k', AI_BASE_URL: m.url }); await assert.rejects(() => AI.callLLM('s', 'u'), (e) => e.code === code, `${status}`); m.close();
  }
  const m = await mock(() => ({ json: { promptFeedback: { blockReason: 'SAFETY' } } })); process.env.AI_BASE_URL = m.url; await assert.rejects(() => AI.callLLM('s', 'u'), (e) => e.code === 'BAD_JSON'); m.close(); clean();
});

test('ChatGPT / OpenAI key: chat completions, newer models get max_completion_tokens, compatible servers get max_tokens', async () => {
  clean(); const AI = require('../server/ai');
  const m = await mock(() => ({ json: { choices: [{ message: { content: 'hello there' } }] } }));
  Object.assign(process.env, { AI_PROVIDER: 'chatgpt', AI_API_KEY: 'sk-test', AI_MODEL: 'gpt-4o-mini', AI_BASE_URL: m.url + '/api.openai.com/v1' }); // looks like the official host
  assert.strictEqual(AI.cfg().provider, 'openai'); assert.strictEqual(await AI.callLLM('sys', 'usr', { json: true }), 'hello there');
  let c = m.calls[0]; assert.strictEqual(c.headers.authorization, 'Bearer sk-test'); assert.ok(c.body.max_completion_tokens && !c.body.max_tokens); assert.deepStrictEqual(c.body.response_format, { type: 'json_object' });
  process.env.AI_BASE_URL = m.url + '/v1'; await AI.callLLM('sys', 'usr'); c = m.calls[1]; assert.ok(c.body.max_tokens && !c.body.max_completion_tokens, 'local servers keep max_tokens');
  m.close(); clean();
});

test('provider defaults: sensible models and timeouts for Gemini and OpenAI', () => {
  clean(); const AI = require('../server/ai');
  process.env.AI_PROVIDER = 'gemini'; assert.match(AI.cfg().model, /^gemini-/); assert.ok(AI.cfg().timeout >= 15000);
  process.env.AI_PROVIDER = 'openai'; assert.match(AI.cfg().model, /^gpt-/); process.env.AI_TIMEOUT_MS = '3000'; assert.strictEqual(AI.cfg().timeout, 3000); clean();
});

test('OpenAI voice: one request per take, anchor style sent, repeats served from the cache, key stays on the server', async () => {
  clean(); const TTS = require('../server/tts');
  const m = await mock(() => ({ type: 'audio/mpeg', raw: 'ID3fakeaudio' }));
  Object.assign(process.env, { AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test', TTS_BASE_URL: m.url });
  assert.ok(TTS.enabled()); const a = await TTS.synthesize(1, 'flashwire', 'Breaking news. Shares fell today.'); assert.strictEqual(a.type, 'audio/mpeg'); assert.ok(a.data.length > 0);
  const c = m.calls[0]; assert.strictEqual(c.url, '/audio/speech'); assert.strictEqual(c.headers.authorization, 'Bearer sk-test'); assert.strictEqual(c.body.model, 'gpt-4o-mini-tts'); assert.strictEqual(c.body.voice, TTS.VOICES.openai.flashwire);
  assert.match(c.body.instructions, /news/i); assert.strictEqual(c.body.input, 'Breaking news. Shares fell today.');
  await TTS.synthesize(1, 'flashwire', 'Breaking news. Shares fell today.'); assert.strictEqual(m.calls.length, 1, 'cached');
  const b = await TTS.synthesize(1, 'tara', 'Breaking news. Shares fell today.'); assert.strictEqual(m.calls.length, 2, 'a different presenter is a different voice'); assert.strictEqual(m.calls[1].body.voice, TTS.VOICES.openai.tara); assert.ok(b);
  m.close(); clean();
});

test('Gemini voice: raw PCM becomes a playable WAV, voice and style are sent, key in a header', async () => {
  clean(); const TTS = require('../server/tts'); const pcm = Buffer.alloc(4800, 1);
  const m = await mock(() => ({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] } }));
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'gem-key', TTS_BASE_URL: m.url });
  const a = await TTS.synthesize(2, 'marketline', 'Here is what we can verify.'); assert.strictEqual(a.type, 'audio/wav'); assert.strictEqual(a.data.slice(0, 4).toString(), 'RIFF'); assert.strictEqual(a.data.length, 44 + pcm.length); assert.strictEqual(a.data.readUInt32LE(24), 24000);
  const c = m.calls[0]; assert.match(c.url, /^\/models\/gemini-.*:generateContent$/); assert.strictEqual(c.headers['x-goog-api-key'], 'gem-key'); assert.deepStrictEqual(c.body.generationConfig.responseModalities, ['AUDIO']);
  assert.strictEqual(c.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, TTS.VOICES.gemini.marketline); assert.match(c.body.contents[0].parts[0].text, /Here is what we can verify\./);
  m.close(); clean();
});

test('AI voice is never switched on by a Claude key, can use its own key, and can be turned off', () => {
  clean(); const TTS = require('../server/tts');
  Object.assign(process.env, { AI_PROVIDER: 'anthropic', AI_API_KEY: 'claude-key' }); assert.strictEqual(TTS.enabled(), false, 'a Claude key has no voice service');
  Object.assign(process.env, { AI_PROVIDER: 'gemini', AI_API_KEY: 'gem-key' }); assert.strictEqual(TTS.enabled(), true);
  process.env.TTS_ENABLED = 'off'; assert.strictEqual(TTS.enabled(), false); delete process.env.TTS_ENABLED;
  Object.assign(process.env, { AI_PROVIDER: 'anthropic', AI_API_KEY: 'claude-key', TTS_PROVIDER: 'openai', TTS_API_KEY: 'sk-voice' }); assert.strictEqual(TTS.enabled(), true, 'text AI and voice can use different providers');
  clean(); assert.strictEqual(TTS.enabled(), false);
});

test('AI voice errors are coded and limited: bad key, rate limit from the provider, and a per-user cap', async () => {
  clean(); const TTS = require('../server/tts');
  let m = await mock(() => ({ status: 401, json: { error: { message: 'bad key' } } }));
  Object.assign(process.env, { AI_PROVIDER: 'openai', AI_API_KEY: 'x', TTS_BASE_URL: m.url }); await assert.rejects(() => TTS.synthesize(3, 'announcer', 'Hello.'), (e) => e.code === 'AUTH'); m.close();
  m = await mock(() => ({ status: 429, json: {} })); process.env.TTS_BASE_URL = m.url; await assert.rejects(() => TTS.synthesize(3, 'announcer', 'Hello again.'), (e) => e.code === 'RATE_LIMIT'); m.close();
  m = await mock(() => ({ type: 'audio/mpeg', raw: 'x' })); process.env.TTS_BASE_URL = m.url; let n = 0, limited = 0;
  for (let i = 0; i < 50; i++) { try { await TTS.synthesize(77, 'announcer', 'Line number ' + i); n++; } catch (e) { if (e.code === 'RATE_LIMIT') limited++; } }
  assert.strictEqual(n, 45); assert.strictEqual(limited, 5); m.close(); clean();
});

test('HTTP: /api/tts needs sign-in, reports status in /api/health, and streams audio when configured', async () => {
  clean(); const { server } = require('../server/index');
  const m = await mock(() => ({ type: 'audio/mpeg', raw: 'ID3audio' }));
  await new Promise((r) => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, tok) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) });
  assert.strictEqual((await post('/api/tts', { who: 'marketline', text: 'Hi.' })).status, 401);
  const tok = (await (await post('/api/login', { name: 'Voice Tester' })).json()).token;
  assert.strictEqual((await post('/api/tts', { who: 'marketline', text: 'Hi.' }, tok)).status, 503, 'not configured yet');
  assert.strictEqual((await (await fetch(base + '/api/health')).json()).tts.configured, false);
  Object.assign(process.env, { AI_PROVIDER: 'chatgpt', AI_API_KEY: 'sk-x', TTS_BASE_URL: m.url });
  const h = await (await fetch(base + '/api/health')).json(); assert.deepStrictEqual(h.tts, { configured: true, provider: 'openai' });
  const r = await post('/api/tts', { who: 'tara', text: 'Welcome to BullRun Live.' }, tok); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'audio/mpeg'); assert.strictEqual(Buffer.from(await r.arrayBuffer()).toString(), 'ID3audio');
  assert.strictEqual((await post('/api/tts', { who: 'tara', text: '   ' }, tok)).status, 400);
  m.close(); server.close(); clean();
});
