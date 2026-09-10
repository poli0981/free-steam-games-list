-- Admin-only state. Game records are NOT stored here: data/*.jsonl in Git stays
-- the source of truth, and this database holds only work-in-progress — the
-- review queue, decisions worth remembering, and an audit trail.
--
-- Keeping Git canonical is what makes every failure here survivable: if this
-- database is lost, nothing about the published catalogue changes.

-- ─────────────────────────────────────────────────────────────────────────────
-- Candidates awaiting review. One open row per appid.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest_queue (
  id                    TEXT    PRIMARY KEY,          -- uuid
  appid                 TEXT    NOT NULL,             -- parsed from link
  link                  TEXT    NOT NULL,             -- normalized store URL
  name                  TEXT    NOT NULL DEFAULT '',
  header_image          TEXT    NOT NULL DEFAULT '',
  release_date          TEXT    NOT NULL DEFAULT '',

  -- Why this is a candidate at all.
  app_type              TEXT    NOT NULL DEFAULT '',  -- steam "type": game/dlc/demo/...
  is_free               INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0, 1)),
  health_status         TEXT    NOT NULL DEFAULT 'unknown',

  -- Numeric-looking Steam fields are formatted strings in the dataset; keep the
  -- raw form and a parsed companion so the review screen can sort.
  reviews_raw           TEXT    NOT NULL DEFAULT 'N/A',
  reviews_pct           INTEGER,
  current_players_raw   TEXT    NOT NULL DEFAULT 'N/A',
  current_players_num   INTEGER,

  payload_json          TEXT    NOT NULL DEFAULT '{}',  -- full candidate, verbatim

  source                TEXT    NOT NULL DEFAULT 'pipeline',
  status                TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','deferred','approved','committed','rejected','failed')),

  decided_by            TEXT,                           -- Access email
  decided_at            TEXT,
  reject_reason         TEXT,

  first_seen_at         TEXT    NOT NULL,
  last_seen_at          TEXT    NOT NULL,
  seen_count            INTEGER NOT NULL DEFAULT 1
) STRICT;

-- At most one OPEN row per appid; decided rows accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_open_appid
  ON ingest_queue (appid)
  WHERE status IN ('pending','deferred','approved');

CREATE INDEX IF NOT EXISTS idx_queue_review ON ingest_queue (status, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_appid  ON ingest_queue (appid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Long-term memory, so a rejected appid does not reappear in tomorrow's sweep.
-- Survives any pruning of ingest_queue history.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest_decisions (
  appid       TEXT PRIMARY KEY,
  decision    TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  reason      TEXT,
  decided_by  TEXT,
  decided_at  TEXT NOT NULL
) STRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Worker -> Git commits. Recorded before the commit is attempted so a crash
-- mid-flight leaves evidence rather than silence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commit_jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','committed','conflict','failed')),
  target_path   TEXT NOT NULL,
  commit_sha    TEXT,
  error         TEXT,
  requested_by  TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_commit_jobs_created ON commit_jobs (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit trail. Deliberately records the acting Access identity and the target,
-- and NOTHING about visitors — visitors never reach these endpoints. No IP, no
-- User-Agent, no country. docs/PRIVACY_POLICY.md states this; keep them agreed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
