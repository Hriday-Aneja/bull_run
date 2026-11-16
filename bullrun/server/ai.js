'use strict';
// Optional AI layer. It can only change WORDS (names, descriptions, scenario text, explanations). It never touches prices, orders or news timing,
// and every response is validated against a strict schema before use. Any failure throws a coded error and the caller falls back to local content.
const { INDUSTRY_LIST } = require('./data');

// Providers: "gemini" (Google AI Studio key), "openai" (ChatGPT / OpenAI API key), "anthropic", or any OpenAI-compatible server via AI_BASE_URL.
const ALIAS = { google: 'gemini', gemini: 'gemini', chatgpt: 'openai', openai: 'openai', anthropic: 'anthropic', claude: 'anthropic' };
const DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-6' };
const DEFAULT_TIMEOUT = { gemini: 20000, openai: 18000, anthropic: 8000 }; // Gemini and newer OpenAI models can think before answering, so they need longer
const cfg = () => {
  const raw = (process.env.AI_PROVIDER || 'anthropic').toLowerCase(); const provider = ALIAS[raw] || 'compat'; // anything else is treated as an OpenAI-compatible server
  return { key: process.env.AI_API_KEY || '', provider, model: process.env.AI_MODEL || DEFAULT_MODEL[provider] || DEFAULT_MODEL.openai, base: process.env.AI_BASE_URL || '',
    timeout: Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT[provider] || 20000 };
};
const enabled = () => !!cfg().key;
class AIError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const FRIENDLY = { NO_KEY: 'No AI key configured. Using the built-in generator.', TIMEOUT: 'The AI service took too long. Using the built-in generator.', RATE_LIMIT: 'The AI service is busy. Using the built-in generator.',
  NETWORK: 'The AI service could not be reached. Using the built-in generator.', BAD_JSON: 'The AI service returned an unusable answer. Using the built-in generator.', INVALID: 'The AI service returned content that failed validation. Using the built-in generator.',
  HTTP: 'The AI service reported a problem. Using the built-in generator.', AUTH: 'The AI key was not accepted. Check AI_API_KEY. Using the built-in generator.' };
const friendly = (code) => FRIENDLY[code] || FRIENDLY.HTTP;

const errText = async (r) => { try { const j = await r.json(); const m = (j.error && (j.error.message || j.error.status)) || j.message || ''; return String(m).slice(0, 160); } catch (_) { return ''; } };
// One call to whichever provider is configured. json:true asks the provider for strict JSON where it has a switch for that.
async function callLLM(system, user, { json = false, timeout = 0 } = {}) {
  const c = cfg(); const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout || c.timeout);
  try {
    let r;
    if (c.provider === 'anthropic') {
      r = await fetch((c.base || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: c.model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }) });
    } else if (c.provider === 'gemini') {
      // Native Gemini API. The key goes in a header, never in the URL. No thinking setting is sent (Gemini 2.5 and 3 use different ones), so the output limit is generous.
      const gc = { maxOutputTokens: 8192 }; if (json) gc.responseMimeType = 'application/json';
      r = await fetch(`${c.base || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: gc }) });
    } else {
      const official = !c.base || /api\.openai\.com/.test(c.base);
      const body = { model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (official) { body.max_completion_tokens = 4000; if (json) body.response_format = { type: 'json_object' }; } // current OpenAI models reject max_tokens
      else body.max_tokens = 1500; // local and third-party OpenAI-compatible servers
      r = await fetch((c.base || 'https://api.openai.com/v1') + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key }, body: JSON.stringify(body) });
    }
    if (r.status === 429) throw new AIError('RATE_LIMIT');
    if (!r.ok) { const why = await errText(r); throw new AIError(r.status === 401 || r.status === 403 ? 'AUTH' : 'HTTP', `HTTP ${r.status}${why ? ': ' + why : ''}`); }
    const j = await r.json();
    if (c.provider === 'anthropic') return (j.content || []).map((x) => x.text || '').join('');
    if (c.provider === 'gemini') { if (j.promptFeedback && j.promptFeedback.blockReason) throw new AIError('BAD_JSON', 'blocked: ' + j.promptFeedback.blockReason); return (((j.candidates || [])[0] || {}).content || {}).parts ? j.candidates[0].content.parts.filter((x) => !x.thought).map((x) => x.text || '').join('') : ''; }
    return (((j.choices || [])[0] || {}).message || {}).content || '';
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e.name === 'AbortError') throw new AIError('TIMEOUT');
    throw new AIError('NETWORK', e.message);
  } finally { clearTimeout(to); }
}
function parseJSON(text) {
  try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()); } catch (_) { /* try to find an object */ }
  const m = String(text).match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (_) { /* fallthrough */ } }
  throw new AIError('BAD_JSON');
}
const okStr = (s, min, max) => typeof s === 'string' && s.trim().length >= min && s.trim().length <= max && !/[<>{}]/.test(s);
// Strict schema validation. `industries` are the industries present in this session, in company order.
function validateFlavor(obj, industries) {
  if (!obj || typeof obj !== 'object') throw new AIError('INVALID', 'not an object');
  const out = { companies: [] };
  if (obj.scenarioTitle !== undefined) { if (!okStr(obj.scenarioTitle, 8, 60)) throw new AIError('INVALID', 'title'); out.scenarioTitle = obj.scenarioTitle.trim().toUpperCase(); }
  if (obj.scenarioBullets !== undefined) {
    if (!Array.isArray(obj.scenarioBullets) || obj.scenarioBullets.length < 3 || obj.scenarioBullets.length > 6 || !obj.scenarioBullets.every((b) => okStr(b, 10, 160))) throw new AIError('INVALID', 'bullets');
    out.scenarioBullets = obj.scenarioBullets.map((b) => b.trim());
  }
  if (!Array.isArray(obj.companies)) throw new AIError('INVALID', 'companies');
  const names = new Set();
  for (const ind of industries) {
    const f = obj.companies.find((x) => x && x.industry === ind);
    if (!f || !INDUSTRY_LIST.includes(f.industry)) throw new AIError('INVALID', 'missing ' + ind);
    if (typeof f.name !== 'string' || !/^[A-Za-z][A-Za-z0-9 &'-]{2,26}$/.test(f.name.trim())) throw new AIError('INVALID', 'name');
    if (!okStr(f.description, 20, 220)) throw new AIError('INVALID', 'description');
    const key = f.name.trim().toLowerCase(); if (names.has(key)) throw new AIError('INVALID', 'duplicate name'); names.add(key);
    out.companies.push({ industry: ind, name: f.name.trim(), description: f.description.trim() });
  }
  return out;
}
async function generateFlavor(state) {
  if (!enabled()) throw new AIError('NO_KEY');
  const inds = state.companies.map((c) => c.industry);
  const system = 'You write flavour text for a fictional stock-market learning game. All companies are invented; never use real company or brand names. Reply with JSON only, no markdown.';
  const user = `Scenario theme: ${state.scenario.title}.\nReturn JSON: {"scenarioTitle": string (max 60 chars, upper case), "scenarioBullets": [3 to 5 short sentences about the economy, max 150 chars each], "companies": [one object per industry below with {"industry": exact industry name, "name": unique invented company name 3-26 letters, "description": one plain-English sentence 25-200 chars}]}.\nIndustries: ${JSON.stringify(inds)}.`;
  return validateFlavor(parseJSON(await callLLM(system, user, { json: true })), inds);
}
async function explain(context) {
  if (!enabled()) throw new AIError('NO_KEY');
  const system = 'You explain stock-market situations to complete beginners in a fictional training game. Plain language, 2 to 4 sentences, no hype, no instructions to buy or sell, no markdown.';
  const text = String(await callLLM(system, context)).replace(/[*_#`]/g, '').trim();
  if (text.length < 40 || text.length > 700) throw new AIError('INVALID', 'length');
  return text;
}
module.exports = { enabled, generateFlavor, explain, validateFlavor, AIError, friendly, cfg, callLLM };
