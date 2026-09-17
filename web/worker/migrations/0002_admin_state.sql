-- Admin coordination state. Apply BEFORE or AFTER deploying the Worker that
-- uses it - the code tolerates both orders (see worker/lib/locks.ts):
--
--   npx wrangler d1 migrations apply f2p-admin --remote
--
-- Nothing here holds game data or visitor data.

-- ─────────────────────────────────────────────────────────────────────────────
-- Leases, so a job that must not overlap itself cannot - across isolates, not
-- just within one. The reconcile cron and the manual /admin button each fetch
-- the whole ~6 MB dataset; before this, two isolates could run both at once.
-- A lease that is never released (a crashed isolate) simply expires.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_locks (
  name        TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  expires_at  TEXT NOT NULL
) STRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Small named values that must survive between cron ticks. Today: the dataset
-- generation reconcile last swept against, so a tick with nothing new costs one
-- ~600-byte index fetch instead of the whole dataset.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
