-- Additive, isolated tables; the personal-site and workshop tables are unchanged.
CREATE TABLE IF NOT EXISTS ai4pe_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  visits INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
INSERT OR IGNORE INTO ai4pe_totals (id, visits, likes) VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS ai4pe_actions (
  kind TEXT NOT NULL CHECK (kind IN ('visit', 'like')),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, token)
);
CREATE TRIGGER IF NOT EXISTS ai4pe_action_count
AFTER INSERT ON ai4pe_actions
BEGIN
  UPDATE ai4pe_totals
  SET visits = visits + CASE WHEN NEW.kind = 'visit' THEN 1 ELSE 0 END,
      likes = likes + CASE WHEN NEW.kind = 'like' THEN 1 ELSE 0 END,
      updated_at = NEW.created_at
  WHERE id = 1;
END;
