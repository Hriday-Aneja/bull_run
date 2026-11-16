'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const L = require('./learn');

const SCHEMA_VERSION = 2;
const DERIVED = ['orders', 'transactions', 'holdings', 'cash_balances', 'learning_records', 'game_results'];

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  const hadSessions = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='game_sessions'").get();
  if (hadSessions && ver < SCHEMA_VERSION) {
    // Database from version 1: keep users and saved games, rebuild the derived (per-player) tables.
    for (const t of DERIVED) db.exec(`DROP TABLE IF EXISTS ${t}`);
    try { db.exec("ALTER TABLE game_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'solo'"); } catch (_) { /* already there */ }
  }
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ } throw e; }
}
// Persist the authoritative state plus relational projections, atomically. `full` rewrites every candle (first save after creation or load).
function save(db, state, hostUserId, full) {
  const sid = state.id; const players = Object.values(state.players); const host = state.players.p1; const now = Date.now();
  tx(db, () => {
    db.prepare(`INSERT INTO game_sessions (id,user_id,mode,seed,duration,market_name,status,tick,total_ticks,net_worth,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,tick=excluded.tick,net_worth=excluded.net_worth,state=excluded.state,updated_at=excluded.updated_at`)
      .run(sid, hostUserId, state.mode || 'solo', state.seed, state.duration, state.marketName, state.status, state.tick, state.totalTicks, L.netWorth(state, host), JSON.stringify(state), state.createdAt || now, now);
    if (full) {
      const ic = db.prepare('INSERT OR REPLACE INTO companies VALUES (?,?,?,?,?,?,?)');
      for (const c of state.companies) ic.run(sid, c.id, c.ticker, c.name, c.industry, c.description, JSON.stringify({ fund: c.fund, hid: c.hid, shares: c.shares }));
      const ie = db.prepare('INSERT OR REPLACE INTO economic_events VALUES (?,?,?,?,?,?)');
      for (const e of state.events) ie.run(sid, e.id, e.tick, e.kind, e.typeId || null, JSON.stringify({ text: e.text, real: e.real, hidden: e.hidden, impact: e.impact, claim: e.claim, lag: e.lag, dur: e.dur }));
      const icd = db.prepare('INSERT OR REPLACE INTO price_candles VALUES (?,?,?,?,?,?,?,?)');
      for (const c of state.companies) for (const k of c.candles) icd.run(sid, c.id, k.t, k.o, k.h, k.l, k.c, k.v);
    } else {
      const icd = db.prepare('INSERT OR REPLACE INTO price_candles VALUES (?,?,?,?,?,?,?,?)');
      for (const c of state.companies) { const k = c.candles[c.candles.length - 1]; icd.run(sid, c.id, k.t, k.o, k.h, k.l, k.c, k.v); }
    }
    const inn = db.prepare('INSERT OR REPLACE INTO news_publications VALUES (?,?,?,?,?,?,?,?)');
    for (const n of state.news) inn.run(sid, n.id, n.seq, n.tick, n.channel, n.treatment, n.eventId, n.headline);
    const io = db.prepare('INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const it = db.prepare('INSERT OR REPLACE INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    const ih = db.prepare('INSERT INTO holdings VALUES (?,?,?,?,?)');
    const il = db.prepare('INSERT OR REPLACE INTO learning_records VALUES (?,?,?,?,?,?)');
    db.prepare('DELETE FROM holdings WHERE session_id=?').run(sid);
    for (const p of players) {
      for (const o of p.orders) io.run(sid, p.id, o.id, o.companyId, o.side, o.type, o.qty, o.limit, o.stop, o.status, o.createdTick, o.filledTick || null, o.fillPrice || null, o.fee || null, o.key);
      for (const t of p.transactions) it.run(sid, p.id, t.id, t.tick, t.companyId, t.side, t.qty, t.price, t.value, t.fee, t.realized, t.cashAfter);
      for (const [cid, h] of Object.entries(p.holdings)) ih.run(sid, p.id, cid, h.qty, h.cost);
      db.prepare('INSERT OR REPLACE INTO cash_balances VALUES (?,?,?,?)').run(sid, p.id, p.cash, p.reserved);
      for (const r of p.reviews) il.run(sid, p.id, r.id, r.tick, 'trade_review', JSON.stringify(r));
      for (const s of p.situations || []) il.run(sid, p.id, s.id, s.tick, 'situation', JSON.stringify(s));
      if (p.result) db.prepare('INSERT OR REPLACE INTO game_results VALUES (?,?,?,?,?)').run(sid, p.id, p.userId || null, JSON.stringify(p.result), now);
      if (state.mode === 'room') db.prepare('UPDATE room_members SET net_worth=? WHERE session_id=? AND pid=?').run(L.netWorth(state, p), sid, p.id);
    }
  });
}
module.exports = { open, save, tx };
