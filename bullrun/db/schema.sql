-- BullRun local database (SQLite via node:sqlite), schema version 2.
-- game_sessions.state is the authoritative snapshot of a simulation (solo game or multiplayer room); the other tables are an
-- auditable relational projection written in the same transaction. Per-player tables carry player_id.
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS game_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), mode TEXT NOT NULL DEFAULT 'solo', seed TEXT NOT NULL, duration TEXT NOT NULL,
  market_name TEXT, status TEXT NOT NULL, tick INTEGER NOT NULL, total_ticks INTEGER NOT NULL, net_worth REAL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON game_sessions(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS rooms (session_id TEXT PRIMARY KEY REFERENCES game_sessions(id), code TEXT NOT NULL UNIQUE, host_user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_members (session_id TEXT NOT NULL REFERENCES game_sessions(id), user_id INTEGER NOT NULL REFERENCES users(id), pid TEXT NOT NULL, name TEXT NOT NULL,
  net_worth REAL, joined_at INTEGER NOT NULL, PRIMARY KEY (session_id, user_id));
CREATE INDEX IF NOT EXISTS idx_members_user ON room_members(user_id);
CREATE TABLE IF NOT EXISTS companies (session_id TEXT NOT NULL, id TEXT NOT NULL, ticker TEXT, name TEXT, industry TEXT, description TEXT, fundamentals TEXT, PRIMARY KEY (session_id, id));
CREATE TABLE IF NOT EXISTS price_candles (session_id TEXT NOT NULL, company_id TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (session_id, company_id, t));
CREATE TABLE IF NOT EXISTS economic_events (session_id TEXT NOT NULL, id TEXT NOT NULL, tick INTEGER, kind TEXT, type_id TEXT, truth TEXT, PRIMARY KEY (session_id, id));
CREATE TABLE IF NOT EXISTS news_publications (session_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER, tick INTEGER, channel TEXT, treatment TEXT, event_id TEXT, headline TEXT, PRIMARY KEY (session_id, id));
CREATE TABLE IF NOT EXISTS orders (session_id TEXT NOT NULL, player_id TEXT NOT NULL, id TEXT NOT NULL, company_id TEXT, side TEXT, type TEXT, qty INTEGER, limit_price REAL, stop_price REAL, status TEXT,
  created_tick INTEGER, filled_tick INTEGER, fill_price REAL, fee REAL, idem_key TEXT, PRIMARY KEY (session_id, player_id, id), UNIQUE (session_id, player_id, idem_key));
CREATE TABLE IF NOT EXISTS transactions (session_id TEXT NOT NULL, player_id TEXT NOT NULL, id TEXT NOT NULL, tick INTEGER, company_id TEXT, side TEXT, qty INTEGER, price REAL, value REAL, fee REAL, realized REAL, cash_after REAL, PRIMARY KEY (session_id, player_id, id));
CREATE TABLE IF NOT EXISTS holdings (session_id TEXT NOT NULL, player_id TEXT NOT NULL, company_id TEXT NOT NULL, qty INTEGER NOT NULL, cost_basis REAL NOT NULL, PRIMARY KEY (session_id, player_id, company_id));
CREATE TABLE IF NOT EXISTS cash_balances (session_id TEXT NOT NULL, player_id TEXT NOT NULL, cash REAL NOT NULL, reserved REAL NOT NULL, PRIMARY KEY (session_id, player_id));
CREATE TABLE IF NOT EXISTS learning_records (session_id TEXT NOT NULL, player_id TEXT NOT NULL, id TEXT NOT NULL, tick INTEGER, kind TEXT, payload TEXT, PRIMARY KEY (session_id, player_id, id));
CREATE TABLE IF NOT EXISTS game_results (session_id TEXT NOT NULL, player_id TEXT NOT NULL, user_id INTEGER, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (session_id, player_id));
