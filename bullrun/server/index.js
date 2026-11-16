'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// minimal .env loader (no dependency)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env is fine */ }

const D = require('./data');
const E = require('./engine');
const L = require('./learn');
const AI = require('./ai');
const TTS = require('./tts');
const NEWSROOM = require('./newsroom');
const DB = require('./db');
const { generateSession } = require('./generator');
const { CHANNELS } = require('./news');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH ? path.resolve(ROOT, process.env.DB_PATH) : path.join(ROOT, 'data', 'bullrun.sqlite');
const LOG_FILE = path.join(ROOT, 'logs', 'app.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
function log(level, msg, err) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${err ? ' :: ' + (err.stack || err.message || err) : ''}`;
  if (process.env.NODE_ENV !== 'test') console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* ignore */ }
}
const db = DB.open(DB_PATH);
const cache = new Map(); // sessionId -> { state, hostId, full, nextAt }
const clampInt = (x, a, b) => Math.max(a, Math.min(b, Math.floor(Number(x) || 0)));
const fail = (status, error) => Object.assign(new Error(error), { status, friendly: true });

// ---- multiplayer settings ---------------------------------------------------------------------------------------------------
const MAX_PLAYERS = 8;
const SPEEDS = { fast: 2500, normal: 5000, relaxed: 9000 };           // real milliseconds per market hour
const SCALE = Number(process.env.TICK_SCALE) > 0 ? Number(process.env.TICK_SCALE) : 1;   // tests shrink this
const tickMs = (k) => Math.max(30, Math.round((SPEEDS[k] || SPEEDS.normal) * SCALE));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!db.prepare('SELECT 1 AS x FROM rooms WHERE code=?').get(c)) return c;
  }
}

// ---- helpers ------------------------------------------------------------------------------------------------------------------
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(b); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
  });
}
const scriptHits = new Map();
function scriptAllowed(uid) { const now = Date.now(); const a = (scriptHits.get(uid) || []).filter((t) => now - t < 60000); if (a.length >= 40) { scriptHits.set(uid, a); return false; } a.push(now); scriptHits.set(uid, a); return true; }
function authUser(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, ''); if (!t) return null;
  return db.prepare('SELECT id, name FROM users WHERE token=?').get(t) || null;
}
// Saves written by version 1 (solo only, one global situations list) are upgraded on load.
function migrate(s) {
  if (!s.mode) s.mode = 'solo';
  const p1 = s.players.p1;
  if (s.situations) { p1.situations = s.situations.concat(p1.situations || []); delete s.situations; }
  if (s.result && !p1.result) p1.result = s.result; delete s.result;
  for (const p of Object.values(s.players)) { p.situations = p.situations || []; p.sitSeq = p.sitSeq || p.situations.length; p.name = p.name || 'You'; if (p.userId === undefined) p.userId = null; if (p.result === undefined) p.result = null; }
  s.rev = s.rev || 0; return s;
}
function loadEntry(id) {
  let e = cache.get(id); if (e) return e;
  const row = db.prepare('SELECT user_id, state FROM game_sessions WHERE id=?').get(id); if (!row) return null;
  const state = migrate(JSON.parse(row.state)); e = { state, hostId: row.user_id, full: true }; cache.set(id, e);
  if (state.room && state.room.status === 'running') { state.room.status = 'paused'; state.rev++; } // the server restarted: the host resumes manually
  return e;
}
// A solo game belongs to its owner; a room belongs to its members. Returns the entry and which player the caller is.
function access(id, user) {
  const e = loadEntry(id); if (!e) return null;
  if (e.state.mode === 'room') { const m = db.prepare('SELECT pid FROM room_members WHERE session_id=? AND user_id=?').get(id, user.id); return m ? { e, pid: m.pid } : null; }
  return e.hostId === user.id ? { e, pid: 'p1' } : null;
}
const touch = (state) => { state.rev = (state.rev || 0) + 1; };
const persist = (e) => { DB.save(db, e.state, e.hostId, e.full); e.full = false; };
const viewOf = (state, q, pid) => E.view(state, { since: q.since === undefined ? -1e9 : Number(q.since), newsSeq: Number(q.newsSeq) || 0, pid });

function anchorImages() {
  const out = {};
  for (const ch of Object.keys(CHANNELS)) for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'svg']) {
    if (fs.existsSync(path.join(ROOT, 'public', 'img', 'anchors', `${ch}.${ext}`))) { out[ch] = `/img/anchors/${ch}.${ext}`; break; }
  }
  // Optional looping presenter video (muted; it plays only while the anchor is speaking): public/img/anchors/<channel>.mp4 or .webm
  for (const ch of Object.keys(CHANNELS)) for (const ext of ['mp4', 'webm']) {
    if (fs.existsSync(path.join(ROOT, 'public', 'img', 'anchors', `${ch}.${ext}`))) { out[`${ch}:video`] = `/img/anchors/${ch}.${ext}`; break; }
  }
  return out;
}

async function buildState(user, body, mode) {
  const duration = D.DURATIONS[body.duration] ? body.duration : 'standard';
  const seed = (body.seed && String(body.seed).trim().slice(0, 40)) || crypto.randomBytes(4).toString('hex');
  const id = crypto.randomBytes(5).toString('hex');
  let state = generateSession({ id, seed, duration });
  let fallback = { active: true, reason: AI.friendly('NO_KEY'), code: 'NO_KEY' };
  if (AI.enabled()) {
    try { const flavor = await AI.generateFlavor(state); state = generateSession({ id, seed, duration }, flavor); fallback = { active: false, reason: '', code: '' }; }
    catch (e) { log('warn', `AI scenario generation failed (${e.code || 'ERR'}); using local generator`, e); fallback = { active: true, reason: AI.friendly(e.code), code: e.code || 'ERR' }; }
  }
  state.fallback = fallback; state.createdAt = Date.now(); state.mode = mode;
  state.players.p1.name = user.name || 'You'; state.players.p1.userId = user.id;
  return state;
}
async function createSession(user, body) {
  const state = await buildState(user, body || {}, 'solo'); E.addBots(state, clampInt((body || {}).bots || 0, 0, 6)); E.start(state);
  const e = { state, hostId: user.id, full: true }; cache.set(state.id, e); persist(e); return e;
}
async function createRoom(user, body) {
  body = body || {}; const state = await buildState(user, body, 'room'); E.addBots(state, clampInt(body.bots || 0, 0, 4)); E.start(state);
  state.room = { code: newCode(), hostPid: 'p1', status: 'lobby', speed: SPEEDS[body.speed] ? body.speed : 'normal', maxPlayers: MAX_PLAYERS };
  const e = { state, hostId: user.id, full: true }; cache.set(state.id, e);
  persist(e);
  DB.tx(db, () => {
    db.prepare('INSERT INTO rooms (session_id, code, host_user_id, created_at) VALUES (?,?,?,?)').run(state.id, state.room.code, user.id, Date.now());
    db.prepare('INSERT INTO room_members (session_id, user_id, pid, name, net_worth, joined_at) VALUES (?,?,?,?,?,?)').run(state.id, user.id, 'p1', user.name || 'Host', state.players.p1.startCash, Date.now());
  });
  return e;
}
function joinRoom(user, rawCode) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const row = code ? db.prepare('SELECT session_id FROM rooms WHERE code=?').get(code) : null;
  if (!row) throw fail(404, 'No room has that code. Check the letters with your host and try again.');
  const e = loadEntry(row.session_id); const s = e.state;
  const already = db.prepare('SELECT pid FROM room_members WHERE session_id=? AND user_id=?').get(row.session_id, user.id);
  if (already) return { e, pid: already.pid };
  if (s.room.status !== 'lobby') throw fail(409, 'That room has already started. Ask the host to open a new room, or join the next one.');
  const n = Object.values(s.players).filter((x) => !x.bot).length; if (n >= MAX_PLAYERS) throw fail(409, `That room is full (${MAX_PLAYERS} players).`);
  const pid = 'p' + (n + 1); E.addPlayer(s, pid, user.name || 'Player ' + (n + 1), user.id);
  db.prepare('INSERT INTO room_members (session_id, user_id, pid, name, net_worth, joined_at) VALUES (?,?,?,?,?,?)').run(row.session_id, user.id, pid, user.name || 'Player', s.players[pid].startCash, Date.now());
  touch(s); persist(e); return { e, pid };
}
// Host controls: the shared clock runs on the server, so every player sees the same market at the same moment.
function control(e, pid, b) {
  const s = e.state, r = s.room; if (!r) throw fail(400, 'This is not a multiplayer room.'); if (pid !== r.hostPid) throw fail(403, 'Only the host can control the market clock.');
  const act = String(b.action);
  if (act === 'speed') { if (!SPEEDS[b.speed]) throw fail(400, 'Choose fast, normal or relaxed.'); r.speed = b.speed; }
  else if (act === 'start') { if (r.status !== 'lobby') throw fail(409, 'The market has already started.'); r.status = 'running'; }
  else if (act === 'pause') { if (r.status !== 'running') throw fail(409, 'The market is not running.'); r.status = 'paused'; }
  else if (act === 'resume') { if (r.status !== 'paused') throw fail(409, 'The market is not paused.'); r.status = 'running'; }
  else if (act === 'end') { if (s.status !== 'active') throw fail(409, 'The session is already over.'); E.finish(s); }
  else throw fail(400, 'Unknown control.');
  e.nextAt = Date.now() + (act === 'start' || act === 'resume' ? Math.round(tickMs(r.speed) * 0.6) : tickMs(r.speed));
  touch(s); persist(e);
}
let ticker = null;
function roomTick() {
  const now = Date.now();
  for (const e of cache.values()) {
    const s = e.state; if (s.mode !== 'room' || !s.room || s.room.status !== 'running') continue;
    if (!e.nextAt) e.nextAt = now + tickMs(s.room.speed);
    if (now < e.nextAt) continue;
    try { if (E.phaseOf(s) === 'closed') E.nextDay(s); else E.advance(s); touch(s); persist(e); } catch (err) { log('error', `room ${s.room.code} failed to advance; pausing it`, err); s.room.status = 'paused'; touch(s); }
    e.nextAt = Date.now() + tickMs(s.room.speed);
  }
}
const startTicker = () => { if (!ticker) { ticker = setInterval(roomTick, 100); ticker.unref(); } };
const stopTicker = () => { clearInterval(ticker); ticker = null; };

// ---- API ----------------------------------------------------------------------------------------------------------------------
async function api(req, res, url) {
  const p = url.pathname; const q = Object.fromEntries(url.searchParams);
  if (p === '/api/health') return send(res, 200, { ok: true, ai: { configured: AI.enabled(), provider: AI.enabled() ? AI.cfg().provider : null }, tts: { configured: TTS.enabled(), provider: TTS.enabled() ? TTS.cfg().provider : null }, script: { configured: AI.enabled() && !/^(0|off|false|no)$/i.test(process.env.AI_SCRIPTS || '') }, durations: D.DURATIONS, channels: CHANNELS, anchors: anchorImages(), multiplayer: { maxPlayers: MAX_PLAYERS, speeds: Object.keys(SPEEDS) } });
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req); const name = String(b.name || '').trim().slice(0, 24);
    if (!/^[\w .'-]{2,24}$/.test(name)) return send(res, 400, { error: 'Please enter a name of 2 to 24 letters or numbers.' });
    let u = db.prepare('SELECT id, name, token FROM users WHERE name=?').get(name);
    if (!u) { const token = crypto.randomBytes(24).toString('hex'); db.prepare('INSERT INTO users (name, token, created_at) VALUES (?,?,?)').run(name, token, Date.now()); u = db.prepare('SELECT id, name, token FROM users WHERE name=?').get(name); }
    return send(res, 200, { token: u.token, user: { id: u.id, name: u.name } });
  }
  const user = authUser(req); if (!user) return send(res, 401, { error: 'Please sign in to continue.' });
  if (p === '/api/me') return send(res, 200, { user });
  if (p === '/api/anchor-script' && req.method === 'POST') { // AI-written, fact-checked anchor lines; the browser falls back to its own script writer on any error
    const b = await readBody(req); if (!scriptAllowed(user.id)) return send(res, 429, { error: 'Too many script requests.', code: 'RATE_LIMIT' });
    try { const lines = await NEWSROOM.writeScript(b); return send(res, 200, { lines }); }
    catch (err) { log('warn', `AI anchor script not used (${err.code || 'ERR'}): ${err.message}`); return send(res, err.status || 502, { error: 'No AI script.', code: err.code || 'ERR' }); }
  }
  if (p === '/api/tts' && req.method === 'POST') { // natural anchor voice (OpenAI or Gemini); the browser falls back to its own voices on any error
    const b = await readBody(req);
    try { const a = await TTS.synthesize(user.id, String(b.who || ''), b.text, String(b.emotion || ''), b.intensity); res.writeHead(200, { 'content-type': a.type, 'content-length': a.data.length, 'cache-control': 'no-store' }); return res.end(a.data); }
    catch (err) { log('warn', `AI voice failed (${err.code || 'ERR'}): ${err.message}`); return send(res, err.status || 502, { error: 'The AI voice is not available right now.', code: err.code || 'ERR' }); }
  }
  if (p === '/api/sessions' && req.method === 'GET') {
    const solo = db.prepare("SELECT id, mode, seed, duration, market_name, status, tick, total_ticks, net_worth, created_at, updated_at, NULL AS code, 1 AS players FROM game_sessions WHERE user_id=? AND mode='solo'").all(user.id);
    const rooms = db.prepare(`SELECT g.id, g.mode, g.seed, g.duration, g.market_name, g.status, g.tick, g.total_ticks, COALESCE(m.net_worth, 100000) AS net_worth, g.created_at, g.updated_at, r.code,
      (SELECT COUNT(*) FROM room_members x WHERE x.session_id = g.id) AS players FROM room_members m JOIN game_sessions g ON g.id = m.session_id JOIN rooms r ON r.session_id = g.id WHERE m.user_id=?`).all(user.id);
    return send(res, 200, { sessions: solo.concat(rooms).sort((a, b) => b.updated_at - a.updated_at).slice(0, 50) });
  }
  if (p === '/api/sessions' && req.method === 'POST') { const e = await createSession(user, await readBody(req)); return send(res, 200, { view: viewOf(e.state, {}, 'p1') }); }
  if (p === '/api/rooms' && req.method === 'POST') { const e = await createRoom(user, await readBody(req)); return send(res, 200, { view: viewOf(e.state, {}, 'p1') }); }
  if (p === '/api/rooms/join' && req.method === 'POST') { const b = await readBody(req); const { e, pid } = joinRoom(user, b.code); return send(res, 200, { view: viewOf(e.state, {}, pid) }); }
  const m = p.match(/^\/api\/sessions\/([a-f0-9]+)(?:\/(\w+))?(?:\/(\w+))?$/);
  if (!m) return send(res, 404, { error: 'Not found.' });
  const a = access(m[1], user); if (!a) return send(res, 404, { error: 'That game could not be found.' });
  const { e, pid } = a; const state = e.state, act = m[2], room = state.mode === 'room';
  if (!act && req.method === 'GET') {
    if (q.rev !== undefined && q.rev !== '' && Number(q.rev) === state.rev) return send(res, 200, { unchanged: true, rev: state.rev });
    return send(res, 200, { view: viewOf(state, q, pid) });
  }
  if (act === 'ipobid' && req.method === 'POST') { const bd = await readBody(req); const r = E.ipoBid(state, pid, bd); if (!r.ok) return send(res, 400, { error: r.error }); touch(state); persist(e); return send(res, 200, { view: viewOf(state, bd, pid), result: r }); }
  if (act === 'spoil' && req.method === 'POST') { const r = E.spoil(state, pid); if (!r.ok) return send(res, 403, { error: r.error }); touch(state); persist(e); return send(res, 200, { ok: true }); }
  if (act === 'truth' && req.method === 'GET') return send(res, 200, { truth: E.truthView(state, pid) });
  if (act === 'report') { const pl = state.players[pid]; return send(res, 200, { report: pl.result || E.report(state, pid), complete: state.status === 'complete' }); }
  const b = req.method === 'GET' ? {} : await readBody(req);
  if (act === 'control' && req.method === 'POST') { control(e, pid, b); return send(res, 200, { view: viewOf(state, b, pid) }); }
  if (act === 'advance' && req.method === 'POST') {
    if (room) return send(res, 403, { error: 'In a room the market clock is shared, and the host controls it.' });
    if (E.phaseOf(state) === 'closed') return send(res, 409, { error: 'The market is closed for the day. Press Next day to move to tomorrow morning.', view: viewOf(state, b, pid) });
    const n = clampInt(b.ticks || 1, 1, 28); const startNews = state.news.length; let done = 0, stopped = null;
    for (let i = 0; i < n; i++) {
      const r = E.advance(state); if (!r.ok) break; done++;
      if (E.phaseOf(state) === 'closed') { stopped = 'close'; break; }
      if (b.stopOnBreaking) { if (state.news.slice(startNews).some((x) => x.breaking)) { stopped = 'breaking'; break; } if (r.filled) { stopped = 'fill'; break; } }
      if (state.status !== 'active') break;
    }
    touch(state); persist(e); return send(res, 200, { view: viewOf(state, b, pid), ticksDone: done, stopped });
  }
  if (act === 'nextday' && req.method === 'POST') {
    if (room) return send(res, 403, { error: 'In a room the shared clock moves to the next morning by itself.' });
    const r = E.nextDay(state); if (!r.ok) return send(res, 409, { error: r.error, view: viewOf(state, b, pid) });
    touch(state); persist(e); return send(res, 200, { view: viewOf(state, b, pid) });
  }
  if (act === 'finish' && req.method === 'POST') {
    if (room) return send(res, 403, { error: 'In a room only the host can end the session, from the clock controls.' });
    E.finish(state); touch(state); persist(e); return send(res, 200, { view: viewOf(state, b, pid) });
  }
  if (act === 'orders' && m[3] === 'preview' && req.method === 'POST') return send(res, 200, { preview: E.previewOrder(state, pid, b) });
  if (act === 'orders' && !m[3] && req.method === 'POST') {
    const r = E.placeOrder(state, pid, b); if (!r.ok) return send(res, 400, { error: r.error });
    touch(state); persist(e); return send(res, 200, { ok: true, duplicate: !!r.duplicate, order: r.order, tx: r.tx || null, review: r.review || null, view: viewOf(state, b, pid) });
  }
  if (act === 'cancel' && req.method === 'POST') { const r = E.cancelOrder(state, pid, String(b.orderId)); if (!r.ok) return send(res, 400, { error: r.error }); touch(state); persist(e); return send(res, 200, { ok: true, view: viewOf(state, b, pid) }); }
  if (act === 'explain' && req.method === 'POST') {
    const sit = state.players[pid].situations.find((s) => s.id === b.id); if (!sit) return send(res, 404, { error: 'Nothing to explain.' });
    const local = L.explainSituation(sit);
    if (!AI.enabled()) return send(res, 200, { text: local, source: 'local' });
    try {
      const ctx = `Situation: ${sit.title}. Basics: ${sit.body} Recent headlines: ${(sit.related || []).map((r) => r.headline).join(' | ') || 'none'}. Explain what a beginner should understand and what to check next.`;
      return send(res, 200, { text: await AI.explain(ctx), source: 'ai' });
    } catch (err) { log('warn', `AI explanation failed (${err.code || 'ERR'})`, err); return send(res, 200, { text: local, source: 'local', notice: AI.friendly(err.code) }); }
  }
  return send(res, 404, { error: 'Not found.' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon' };
const PUB = path.join(ROOT, 'public');
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  const hdr = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };
  const size = fs.statSync(file).size; const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg && (rg[1] || rg[2])) { // byte ranges: browsers need them to loop and seek video
    const start = rg[1] === '' ? Math.max(0, size - Number(rg[2])) : Number(rg[1]); const end = rg[1] === '' || rg[2] === '' ? size - 1 : Math.min(Number(rg[2]), size - 1);
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, Object.assign({}, hdr, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' }));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign({}, hdr, { 'accept-ranges': 'bytes', 'content-length': size }));
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    if (err.friendly) return send(res, err.status, { error: err.message });
    log('error', `${req.method} ${url.pathname} failed`, err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status === 400 ? 'That request was not understood.' : 'Something went wrong on our side. Your game is safe; please try again.' });
  }
});
server.on('listening', startTicker); server.on('close', stopTicker);
if (require.main === module) {
  server.listen(PORT, () => { log('info', `BullRun running at http://localhost:${PORT}  (AI: ${AI.enabled() ? 'configured' : 'not configured, local generator active'})`); });
}
module.exports = { server, db, createSession, createRoom, joinRoom, cache, startTicker, stopTicker };
