CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT, short_name TEXT, date TEXT, status TEXT, state TEXT,
  home_abbr TEXT, away_abbr TEXT, home_score INTEGER, away_score INTEGER,
  period INTEGER, clock TEXT, replay INTEGER DEFAULT 0, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL, seq INTEGER, created_at TEXT,
  down INTEGER, distance INTEGER, yte INTEGER, offense TEXT, defense TEXT, quarter INTEGER, clock TEXT, field_position TEXT,
  p_pass REAL, jev_play TEXT, play_conf REAL, p_conv REAL, jev_fourth TEXT, jev_fourth_probs TEXT,
  base_p_pass REAL, base_fourth TEXT, base_p_conv REAL,
  status TEXT, actual_play TEXT, actual_fourth TEXT, actual_converted INTEGER, play_text TEXT, graded_at TEXT, play_id TEXT,
  model TEXT, latency_ms INTEGER, state_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_pred_game ON predictions(game_id, seq);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, json TEXT, updated_at TEXT);
