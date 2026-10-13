/**
 * Removing games from the catalogue, and restoring one.
 *
 * A removal is not a deletion the Worker performs: the Worker cannot write a
 * shard (git-commit.ts WRITABLE). It commits a line to data/blocklist.jsonl, a
 * standing instruction that save_main() re-imposes on every write
 * (scripts/core/blocklist.py), and the push starts "Ingest New Game Links",
 * whose first step applies it. The game leaves data/, is logged once in
 * scripts/removed_games.jsonl, and nothing can bring it back but a Restore.
 *
 * D1 is told the same thing, so the review queue agrees with Git: the game's
 * decision becomes `rejected` with reason `removed:<code>` - even over an
 * `approved` one, because unpublishing is a new fact - and every row for it
 * that is not already rejected becomes rejected. Without that its old
 * `committed` row would keep publishedSql() true forever, and after a Restore a
 * failed restore row would sit locked as "published", lost.
 *
 * Restore is the exact inverse, in ONE commit: the blocklist line goes and the
 * store link is queued for ingest_new.py, so the ingest that runs next cannot
 * find the game still blocked. Its D1 side deletes only a `removed:` decision
 * and enters an approved row (source "restore") for reconcile to promote.
 *
 * Remove and Restore share a lease, so the two cannot interleave their D1
 * writes for one game.
 */
import { jsonError, SECURITY_HEADERS, clampLimit } from "../lib/http";
import { audit } from "../lib/audit";
import type { AccessIdentity } from "../lib/access";
import { commitWithJob } from "../lib/commit-job";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import { TEMP_INFO_PATH } from "../lib/git-commit";
import { acquireLease, releaseLease } from "../lib/locks";
import { readCatalogue, type Catalogue, type CatalogueGame } from "../lib/records";
import { ADMIN_ATTRIBUTION } from "../../shared/admin-api";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";
import { OPEN_STATUSES, sqlList } from "../../shared/queue-rules";
import {
  appendEntries,
  BLOCKLIST_PATH,
  cleanText,
  isoSeconds,
  isRemovalReason,
  makeEntry,
  MAX_NOTE,
  MAX_REMOVE,
  parseBlocklist,
  REMOVAL_REASONS,
  REMOVED_DECISION_PREFIX,
  withoutAppid,
  type BlocklistEntry,
} from "../../shared/removal";

const LEASE = "blocklist";
const LEASE_MS = 60_000;

/** The routes this module answers, for admin.ts's delegation. */
export const REMOVE_ROUTES = ["catalogue", "remove", "removed", "restore"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

function summary(game: CatalogueGame) {
  return {
    appid: game.appid,
    name: game.name,
    header_image: game.header_image,
    release_date: game.release_date,
    is_dead: game.is_dead,
    status: game.status,
  };
}

/** The ingest_decisions.reason a removal records. */
function decisionReason(entry: BlocklistEntry): string {
  return `${REMOVED_DECISION_PREFIX}${entry.reason}${entry.note ? ` - ${entry.note}` : ""}`.slice(0, 300);
}

async function readBlocklist(env: Env, deps: AdminDeps): Promise<string> {
  const { files } = await deps.readRepoFiles(env, [BLOCKLIST_PATH]);
  return files[0] ?? "";
}

/** Run `fn` holding the blocklist lease; 409 while someone else holds it. */
async function withLease(env: Env, deps: AdminDeps, fn: () => Promise<Response>): Promise<Response> {
  const owner = crypto.randomUUID();
  const lease = await acquireLease(env.DB, LEASE, owner, LEASE_MS, deps.now());
  if (lease === "held") return jsonError(409, "another removal or restore is in progress - try again in a minute");
  try {
    return await fn();
  } finally {
    if (lease === "acquired") await releaseLease(env.DB, LEASE, owner);
  }
}

/**
 * D1 statements that make the queue say what the blocklist says, for one
 * game. Idempotent, so running them again repairs a desync.
 */
function removalStatements(env: Env, entry: BlocklistEntry, actor: string, now: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `INSERT INTO ingest_decisions (appid, decision, reason, decided_by, decided_at)
       VALUES (?1, 'rejected', ?2, ?3, ?4)
       ON CONFLICT(appid) DO UPDATE SET
         decision = 'rejected', reason = excluded.reason,
         decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
    ).bind(entry.appid, decisionReason(entry), actor, now),
    env.DB.prepare(
      `UPDATE ingest_queue
          SET status = 'rejected', decided_by = ?1, decided_at = ?2, reject_reason = ?3
        WHERE appid = ?4 AND status <> 'rejected'`,
    ).bind(actor, now, `removed from catalogue: ${REMOVAL_REASONS[entry.reason]}`, entry.appid),
  ];
}

export async function handleRemoveApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice(ADMIN_API_PREFIX.length);

  // Published games by name or appid, or a list of appids to preview.
  if (route === "catalogue" && request.method === "GET") {
    const catalogue = await readCatalogue(deps.fetchRaw);
    if (!catalogue) return jsonError(503, "the catalogue could not be read - try again shortly");
    const blocked = parseBlocklist(await readBlocklist(env, deps));

    const list = url.searchParams.get("appids");
    if (list !== null) {
      const appids = [...new Set(list.split(",").map((a) => a.trim()).filter(Boolean))];
      if (appids.length > MAX_REMOVE) return jsonError(400, `at most ${MAX_REMOVE} appids`);
      if (appids.some((a) => !/^\d{1,10}$/.test(a))) return jsonError(400, "appids must be 1-10 digits each");
      return json({
        verified: catalogue.verified,
        items: appids.map((appid) => {
          const game = catalogue.byAppid.get(appid);
          return { appid, found: !!game, game: game ? summary(game) : null, blocked: blocked.get(appid) ?? null };
        }),
      });
    }

    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
    if (!q) return jsonError(400, "q or appids is required");
    const limit = clampLimit(url.searchParams.get("limit"), 30, 100);
    const items = [];
    let total = 0;
    for (const game of catalogue.games) {
      if (!(game.appid === q || game.appid.startsWith(q) || game.name.toLowerCase().includes(q))) continue;
      total++;
      if (items.length < limit) items.push({ ...summary(game), blocked: blocked.get(game.appid) ?? null });
    }
    return json({ q, total, items, verified: catalogue.verified });
  }

  if (route === "removed" && request.method === "GET") {
    const entries = [...parseBlocklist(await readBlocklist(env, deps)).values()];
    // null when the catalogue cannot be read: "unknown", not "removed".
    const catalogue: Catalogue | null = await readCatalogue(deps.fetchRaw);
    const live = (appid: string) => (catalogue ? catalogue.byAppid.has(appid) : null);
    if (url.searchParams.get("summary") === "1") {
      return json({
        total: entries.length,
        pending: catalogue ? entries.filter((e) => live(e.appid)).length : null,
      });
    }
    const decisions = new Map<string, { decision: string; reason: string | null }>();
    if (entries.length) {
      const rows = await env.DB.prepare(
        "SELECT appid, decision, reason FROM ingest_decisions WHERE appid IN (SELECT value FROM json_each(?))",
      )
        .bind(JSON.stringify(entries.map((e) => e.appid)))
        .all<{ appid: string; decision: string; reason: string | null }>();
      for (const r of rows.results ?? []) decisions.set(r.appid, { decision: r.decision, reason: r.reason });
    }
    const items = entries
      .map((e) => ({ ...e, inCatalogue: live(e.appid), decision: decisions.get(e.appid) ?? null }))
      .sort((a, b) => (a.blocked_at < b.blocked_at ? 1 : a.blocked_at > b.blocked_at ? -1 : 0));
    return json({ total: items.length, items });
  }

  if (route === "remove" && request.method === "POST") {
    let body: { appids?: unknown; reason?: unknown; note?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }
    const appids = Array.isArray(body.appids)
      ? [...new Set(body.appids.filter((a): a is string => typeof a === "string"))]
      : [];
    if (!appids.length) return jsonError(400, "appids must be a non-empty array");
    if (appids.length > MAX_REMOVE) return jsonError(400, `at most ${MAX_REMOVE} games at once`);
    if (appids.some((a) => !/^\d{1,10}$/.test(a))) return jsonError(400, "appids must be 1-10 digits each");
    if (!isRemovalReason(body.reason)) return jsonError(400, `reason must be one of ${Object.keys(REMOVAL_REASONS).join(", ")}`);
    const reason = body.reason;
    const note = cleanText(typeof body.note === "string" ? body.note : "", MAX_NOTE);
    if (reason === "other" && !note) return jsonError(400, "a reason of \"other\" needs a note");

    return withLease(env, deps, async () => {
      // Server-side, never from the request: the name and link that go into a
      // public file come from the catalogue itself.
      const catalogue = await readCatalogue(deps.fetchRaw);
      if (!catalogue) return jsonError(503, "the catalogue could not be read - nothing was removed");
      const blocked = parseBlocklist(await readBlocklist(env, deps));

      const now = deps.now();
      const stamp = isoSeconds(now);
      const fresh: BlocklistEntry[] = [];
      const repaired: BlocklistEntry[] = [];
      const skipped: { appid: string; reason: "not-in-catalogue" | "already-removed" }[] = [];
      for (const appid of appids) {
        const already = blocked.get(appid);
        if (already) {
          // Already in Git. Re-applying its D1 side is how a desynced removal
          // is repaired, so it is not an error - but nothing is committed.
          repaired.push(already);
          skipped.push({ appid, reason: "already-removed" });
          continue;
        }
        const game = catalogue.byAppid.get(appid);
        if (!game) {
          skipped.push({ appid, reason: "not-in-catalogue" });
          continue;
        }
        fresh.push(makeEntry(appid, game.name, reason, note, stamp, game.link));
      }
      if (!fresh.length && !repaired.length) {
        return new Response(JSON.stringify({ error: "nothing in that selection can be removed", skipped }), {
          status: 409,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
        });
      }

      let sha: string | null = null;
      let jobId: string | null = null;
      if (fresh.length) {
        const names = fresh.map((e) => e.name || e.appid);
        const out = await commitWithJob(env, deps, who.email, {
          kind: "remove",
          appids: fresh.map((e) => e.appid),
          targetPath: BLOCKLIST_PATH,
          headline:
            fresh.length === 1 ? `blocklist: remove ${names[0]}`.slice(0, 120) : `blocklist: remove ${fresh.length} games`,
          body:
            `Removed in /admin by ${ADMIN_ATTRIBUTION}.\n\nReason: ${REMOVAL_REASONS[reason]}` +
            (note ? `\nNote: ${note}` : "") +
            `\n\n${fresh.map((e) => `- ${e.appid} ${e.name}`).join("\n")}` +
            "\n\nThe next pipeline run takes them out of data/ and logs each one in " +
            "scripts/removed_games.jsonl. Restoring a game is done in /admin.",
          edits: [
            {
              path: BLOCKLIST_PATH,
              // Re-run on every retry against the file as it is THEN: a line
              // that appeared meanwhile is not added twice.
              build: (current) => {
                const present = parseBlocklist(current);
                const add = fresh.filter((e) => !present.has(e.appid));
                return add.length ? appendEntries(current, add) : null;
              },
            },
          ],
          auditDetail: { reason, note, count: fresh.length },
          auditOnSuccess: false,
        });
        // Nothing reached Git, so D1 is left as it was.
        if (!out.ok) return jsonError(502, "commit failed: " + out.message);
        sha = out.sha;
        jobId = out.jobId;
      }

      const nowIso = now.toISOString();
      try {
        await env.DB.batch([...fresh, ...repaired].flatMap((e) => removalStatements(env, e, who.email, nowIso)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await audit(env, who.email, "remove.desynced", jobId, { message, sha, appids: fresh.map((e) => e.appid) });
        return jsonError(
          500,
          `commit ${sha ?? "(none)"} landed but the review queue could not be updated (${message}). ` +
            "Removing the same games again is safe: it commits nothing and repairs the queue.",
        );
      }

      await audit(env, who.email, "remove", jobId, {
        appids: fresh.map((e) => e.appid),
        repaired: repaired.map((e) => e.appid),
        sha,
        reason,
        note,
        skipped: skipped.length,
      });
      return json({
        removed: fresh.map((e) => e.appid),
        repaired: repaired.map((e) => e.appid),
        skipped,
        commit: sha,
        job: jobId,
      });
    });
  }

  if (route === "restore" && request.method === "POST") {
    let body: { appid?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }
    const appid = typeof body.appid === "string" ? body.appid : "";
    if (!/^\d{1,10}$/.test(appid)) return jsonError(400, "appid must be 1-10 digits");

    return withLease(env, deps, async () => {
      const entry = parseBlocklist(await readBlocklist(env, deps)).get(appid);
      if (!entry) {
        return new Response(JSON.stringify({ error: "that game is not removed", reason: "not-removed" }), {
          status: 409,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
        });
      }
      const link = entry.link;

      const out = await commitWithJob(env, deps, who.email, {
        kind: "restore",
        appids: [appid],
        targetPath: `${BLOCKLIST_PATH}, ${TEMP_INFO_PATH}`,
        headline: `blocklist: restore ${entry.name || appid}`.slice(0, 120),
        body:
          `Restored in /admin by ${ADMIN_ATTRIBUTION}.\n\n` +
          "The game leaves data/blocklist.jsonl and its store link is queued for scripts/ingest_new.py in " +
          "this same commit, so the ingest that runs next fetches it fresh from Steam - and cannot find it " +
          "still blocked.",
        edits: [
          {
            path: BLOCKLIST_PATH,
            build: (current) => {
              const out = withoutAppid(current, appid);
              if (!out.removed) throw new Error("the game is no longer in the blocklist");
              return out.text;
            },
          },
          {
            path: TEMP_INFO_PATH,
            // APPEND, never replace: the extension writes this file too.
            build: (current) => {
              for (const line of current.split("\n")) {
                try {
                  if ((JSON.parse(line) as { link?: unknown }).link === link) return null;
                } catch {
                  /* not ours */
                }
              }
              const sep = current && !current.endsWith("\n") ? "\n" : "";
              return current + sep + JSON.stringify({ link }) + "\n";
            },
          },
        ],
        auditDetail: { appid },
        auditOnSuccess: false,
      });
      if (!out.ok) return jsonError(502, "commit failed: " + out.message);

      const now = deps.now().toISOString();
      try {
        await env.DB.batch([
          env.DB.prepare(
            `DELETE FROM ingest_decisions WHERE appid = ? AND decision = 'rejected' AND reason LIKE ?`,
          ).bind(appid, `${REMOVED_DECISION_PREFIX}%`),
          // The approved row reconcile promotes once the game is back in
          // data/ - or ages out to 'failed', which can be approved again.
          env.DB.prepare(
            `INSERT INTO ingest_queue (id, appid, link, name, source, status, decided_by, decided_at,
                                       first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, 'restore', 'approved', ?5, ?6, ?6, ?6)
             ON CONFLICT(appid) WHERE status IN (${sqlList(OPEN_STATUSES)}) DO UPDATE SET
               status = 'approved', decided_by = excluded.decided_by,
               decided_at = excluded.decided_at, reject_reason = NULL`,
          ).bind(crypto.randomUUID(), appid, link, entry.name, who.email, now),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await audit(env, who.email, "restore.desynced", out.jobId, { message, sha: out.sha, appid });
        return jsonError(
          500,
          `commit ${out.sha ?? "(none)"} landed but the review queue could not be updated (${message}). ` +
            "The game is unblocked and will still be ingested; the review queue may go on showing it as " +
            "removed, which does not affect the catalogue.",
        );
      }

      await audit(env, who.email, "restore", out.jobId, { appid, sha: out.sha });
      return json({ restored: appid, commit: out.sha, job: out.jobId });
    });
  }

  return jsonError(404, "not found");
}
