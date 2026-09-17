/**
 * Demo state for `npm run dev:admin`: every queue status, rows locked because
 * the game is already published, a rejected row that cannot be reopened, commit
 * jobs in every state, audit history, and an override file to edit.
 *
 * Games are real records from ../data, so artwork, names and genres look like
 * production. Nothing here is ever written anywhere but the in-memory database
 * and the in-memory fake repository.
 */
import type { SqliteD1 } from "../../worker/testing/sqlite-d1";
import type { FakeRepo } from "../../worker/testing/fixtures";

interface Rec {
  link: string;
  name?: string;
  header_image?: string;
  release_date?: string;
  reviews?: string;
  current_players?: string;
}

const HOUR = 3_600_000;

export function seed(sqlite: SqliteD1, repo: FakeRepo, records: Rec[], now: Date): { hidden: Set<string> } {
  const db = sqlite.db;
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const appidOf = (r: Rec) => /\/app\/(\d+)/.exec(r.link)?.[1] ?? "0";
  const pct = (r: Rec) => {
    const m = /(\d+)%/.exec(r.reviews ?? "");
    return m ? Number(m[1]) : null;
  };
  const players = (r: Rec) => {
    const n = Number(String(r.current_players ?? "").replace(/,/g, ""));
    return Number.isFinite(n) && String(r.current_players ?? "").trim() !== "" ? n : null;
  };

  const insert = db.prepare(
    `INSERT INTO ingest_queue (id, appid, link, name, header_image, release_date, app_type, is_free,
                               health_status, reviews_raw, reviews_pct, current_players_raw, current_players_num,
                               payload_json, source, status, decided_by, decided_at, reject_reason,
                               first_seen_at, last_seen_at, seen_count)
     VALUES (?, ?, ?, ?, ?, ?, 'game', 1, 'ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const decide = db.prepare(
    "INSERT OR REPLACE INTO ingest_decisions (appid, decision, reason, decided_by, decided_at) VALUES (?, ?, ?, ?, ?)",
  );

  let n = 0;
  const row = (
    r: Rec,
    status: string,
    extra: { by?: string | null; at?: string | null; reason?: string | null; seenAgo?: number; source?: string } = {},
  ) => {
    const id = `demo-${String(++n).padStart(3, "0")}`;
    const seen = iso(extra.seenAgo ?? n * HOUR);
    insert.run(
      id,
      appidOf(r),
      r.link,
      r.name ?? "",
      r.header_image ?? "",
      r.release_date ?? "",
      r.reviews ?? "N/A",
      pct(r),
      r.current_players ?? "N/A",
      players(r),
      JSON.stringify({ link: r.link, name: r.name, reviews: r.reviews, current_players: r.current_players }),
      extra.source ?? (n % 5 === 0 ? "extension" : "discover"),
      status,
      extra.by ?? null,
      extra.at ?? null,
      extra.reason ?? null,
      seen,
      iso((extra.seenAgo ?? n * HOUR) / 2),
      1 + (n % 4),
    );
    return id;
  };

  const pool = records.filter((r) => r.name && r.header_image).slice(0, 110);
  let i = 0;
  const next = () => pool[i++ % pool.length];
  const reviewer = "you@localhost";

  // Games the fake repository must NOT list in data/, so reconcile sees them
  // as unpublished. Every demo game is a real, published record; without this
  // the first reconcile marks the whole demo queue committed.
  const hidden = new Set<string>();
  const hide = (r: Rec) => {
    hidden.add(appidOf(r));
    return r;
  };

  for (let k = 0; k < 45; k++) row(hide(next()), "pending");
  for (let k = 0; k < 6; k++) row(hide(next()), "deferred", { seenAgo: (60 + k) * HOUR });
  row(hide(next()), "failed", { reason: "never appeared in data/ or removed_games.jsonl - approve again to retry", by: reviewer, at: iso(30 * HOUR) });
  row(hide(next()), "failed", { reason: "rejected by ingest pipeline", by: reviewer, at: iso(50 * HOUR) });
  row(hide(next()), "failed", { reason: "superseded by a duplicate approval", by: reviewer, at: iso(52 * HOUR) });
  // Two approvals the pipeline has published (a manual reconcile commits
  // them) and two it has not reached yet.
  for (let k = 0; k < 4; k++) {
    const r = next();
    if (k >= 2) hide(r);
    row(r, "approved", { by: reviewer, at: iso((k + 1) * HOUR) });
  }

  const committed: Rec[] = [];
  for (let k = 0; k < 12; k++) {
    const r = next();
    committed.push(r);
    row(r, "committed", { by: reviewer, at: iso((20 + k) * HOUR) });
    decide.run(appidOf(r), "approved", "observed in data/", "reconcile", iso((19 + k) * HOUR));
  }
  for (let k = 0; k < 6; k++) {
    const r = hide(next());
    row(r, "rejected", { by: reviewer, at: iso((70 + k) * HOUR), reason: k % 2 ? "not free-to-play" : "duplicate listing" });
    decide.run(appidOf(r), "rejected", "not free-to-play", reviewer, iso((70 + k) * HOUR));
  }

  // Locked because the GAME is published: undecided rows for a game that
  // already has a committed row. Neither may be approved, rejected or deferred.
  const published = committed[0];
  row(published, "pending", { seenAgo: 2 * HOUR, source: "extension" });
  row(published, "failed", { reason: "never appeared in data/ or removed_games.jsonl - approve again to retry", by: reviewer, at: iso(80 * HOUR) });

  // A rejected row that cannot be reopened: another row for the game is open.
  const blocked = hide(next());
  row(blocked, "rejected", { by: reviewer, at: iso(90 * HOUR), reason: "wrong store page" });
  decide.run(appidOf(blocked), "rejected", "wrong store page", reviewer, iso(90 * HOUR));
  row(blocked, "deferred", { seenAgo: 5 * HOUR });

  const job = db.prepare(
    `INSERT INTO commit_jobs (id, kind, status, target_path, commit_sha, error, requested_by, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const sha = (k: number) => createFakeSha(k);
  job.run("job-1", "approve", "committed", "scripts/temp_info.jsonl", sha(1), null, reviewer, iso(1 * HOUR), iso(1 * HOUR));
  job.run("job-2", "approve", "committed", "scripts/temp_info.jsonl", null, "nothing to commit: every link was already queued", reviewer, iso(3 * HOUR), iso(3 * HOUR));
  job.run("job-3", "override", "committed", "data/overrides/730.json", sha(3), null, reviewer, iso(8 * HOUR), iso(8 * HOUR));
  job.run("job-4", "approve", "failed", "scripts/temp_info.jsonl", null, "graphql HTTP 502", reviewer, iso(26 * HOUR), iso(26 * HOUR));
  job.run("job-5", "override.delete", "committed", "data/overrides/440.json", sha(5), null, reviewer, iso(40 * HOUR), iso(40 * HOUR));
  job.run("job-6", "approve", "pending", "scripts/temp_info.jsonl", null, null, reviewer, iso(96 * HOUR), null);

  const audit = db.prepare(
    "INSERT INTO audit_log (actor, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const events: [string, string, string | null, unknown, number][] = [
    ["reconcile", "reconcile.approved", null, { checked: 4, published: 2, removed: 0, stale: 0, swept: 3 }, 0.5],
    [reviewer, "approve", "job-1", { appids: ["1", "2"], sha: sha(1), appended: 2, reason: "checked store pages" }, 1],
    [reviewer, "reject", null, { appids: ["3"], reason: "not free-to-play" }, 2],
    [reviewer, "defer", null, { appids: ["4", "5"] }, 4],
    [reviewer, "override", "730", { appids: ["730"], set: ["genre"], retire: [], sha: sha(3) }, 8],
    [reviewer, "reopen", "demo-001", { appid: "10" }, 12],
    [reviewer, "approve.failed", "job-4", { message: "graphql HTTP 502", count: 3 }, 26],
    ["retention", "admin.prune", null, { audit: 14, jobs: 3 }, 30],
    [reviewer, "ping", null, { at: iso(48 * HOUR) }, 48],
  ];
  // Oldest first: the audit view orders by id, as production rows are written.
  for (const [actor, action, target, detail, hoursAgo] of [...events].sort((a, b) => b[4] - a[4])) {
    audit.run(actor, action, target, JSON.stringify(detail), iso(hoursAgo * HOUR));
  }

  // An override on a real game: one active field and one retired one that has
  // already been restored.
  repo.files.set(
    "data/overrides/730.json",
    JSON.stringify(
      {
        schema: 1,
        appid: "730",
        link: "https://store.steampowered.com/app/730/",
        name: "Counter-Strike 2",
        fields: { anti_cheat_note: { value: "VAC plus server-side detection", was: "", set_by: reviewer, set_at: iso(8 * HOUR), reason: "Valve's own wording" } },
        retired: { genre: { value: "Shooter", was: "FPS", retired_by: reviewer, retired_at: iso(40 * HOUR) } },
      },
      null,
      2,
    ) + "\n",
  );

  return { hidden };
}

function createFakeSha(k: number): string {
  return (k.toString(16).padStart(2, "0") + "5f0c3a9e1b7d2468ace13579bdf02468ace13579").slice(0, 40);
}
