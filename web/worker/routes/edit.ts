/**
 * /admin/api/game and /admin/api/edit — corrections to games already published.
 *
 * The Worker writes exactly the same artifact scripts/edit_game.py writes:
 * data/overrides/<appid>.json. That is the point — this route is presentation
 * over a mechanism that already works without it, and the two are
 * interchangeable. The Worker never touches data/ itself.
 *
 * Validation here is a MIRROR of validate_value() in scripts/core/overrides.py
 * and is deliberately the weaker copy: it exists so the reviewer is told
 * immediately rather than discovering the problem later. The Python one is
 * authoritative, it runs on every pipeline write, and .github/workflows/
 * check-overrides.yml runs it on every push — so a file this route accepts but
 * Python would reject fails CI within a minute rather than sitting inert.
 * Change one, change the other.
 */
import { jsonError, SECURITY_HEADERS, clampLimit, clampOffset } from "../lib/http";
import { audit } from "../lib/audit";
import { serialiseOverride } from "../lib/override-doc";
import type { AccessIdentity } from "../lib/access";
import { DELETE_FILE } from "../lib/git-commit";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import type { GameRecord } from "../lib/records";
import { MAX_EDIT } from "../../shared/queue-rules";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";

/** Mirrors MANUAL_FIELDS in scripts/core/constants.py. */
const MANUAL_FIELDS = [
  "anti_cheat",
  "anti_cheat_note",
  "is_kernel_ac",
  "notes",
  "type_game",
  "safe",
  "genre",
] as const;

const OVERRIDE_SCHEMA = 1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

/** null when acceptable, else why not. Mirror of the Python validate_value(). */
export function validateValue(field: string, value: unknown): string | null {
  if (!(MANUAL_FIELDS as readonly string[]).includes(field)) {
    return "not a manual field";
  }
  if (field === "is_kernel_ac") {
    return value === null || typeof value === "boolean"
      ? null
      : "must be true, false or null";
  }
  if (typeof value !== "string") return "must be a string";
  if (!value.trim()) {
    // Refused for the same reason Python refuses it: a blank value would be
    // refilled by the next scrape and re-blanked by the override layer,
    // rewriting shards on every run. Clearing is what retiring is for.
    return "empty - retire the field instead of blanking it";
  }
  if (field === "type_game" && value !== "online" && value !== "offline") {
    return "must be 'online' or 'offline'";
  }
  if (field === "safe" && !["y", "n", "?"].includes(value)) {
    return "must be 'y', 'n' or '?'";
  }
  if (value.length > 500) return "longer than 500 characters";
  return null;
}

interface OverrideEntry {
  value?: unknown;
  was?: unknown;
  set_by?: unknown;
  set_at?: unknown;
  reason?: unknown;
}

interface OverrideDoc {
  schema: number;
  appid: string;
  link: string;
  name: string;
  fields: Record<string, OverrideEntry>;
  retired: Record<string, unknown>;
}

/**
 * Whether an override document may be deleted, and if not, why.
 *
 * Deleting an override is NOT the same as retiring one (CLAUDE.md): a deleted
 * file can no longer restore `was`, so any value it still pins stays pinned
 * forever. It is therefore allowed only once the document is SETTLED:
 *
 *   - no active field is left (retire them first), and
 *   - every retired value has already been restored by the pipeline - the
 *     catalogue no longer holds the overridden value, or the override never
 *     changed anything (`was` equals `value`).
 *
 * scripts/edit_game.py removes a file only when it has no entries at all; this
 * is the same principle, extended to a file whose retirements have finished
 * their one job.
 */
export function deletable(
  doc: { fields?: unknown; retired?: unknown } | null,
  record: Record<string, unknown>,
): { ok: boolean; reason: string } {
  if (!doc) return { ok: false, reason: "no override file" };
  const fields = doc.fields && typeof doc.fields === "object" ? Object.keys(doc.fields) : [];
  if (fields.length) return { ok: false, reason: `still overriding: ${fields.join(", ")} - retire them first` };
  const retired = (doc.retired && typeof doc.retired === "object" ? doc.retired : {}) as Record<string, OverrideEntry>;
  const pending = Object.entries(retired)
    .filter(([field, entry]) => {
      if (!entry || typeof entry !== "object") return false;
      const same = JSON.stringify(entry.was ?? null) === JSON.stringify(entry.value ?? null);
      return !same && JSON.stringify(record[field] ?? null) === JSON.stringify(entry.value ?? null);
    })
    .map(([field]) => field);
  if (pending.length) {
    return { ok: false, reason: `not restored yet: ${pending.join(", ")} - wait for the pipeline to run` };
  }
  return { ok: true, reason: "" };
}

function asDoc(raw: unknown, appid: string, link: string, name: string): OverrideDoc {
  const d = (raw ?? {}) as Partial<OverrideDoc>;
  return {
    schema: OVERRIDE_SCHEMA,
    appid,
    link,
    name,
    fields: (d.fields && typeof d.fields === "object" ? d.fields : {}) as Record<string, OverrideEntry>,
    retired: (d.retired && typeof d.retired === "object" ? d.retired : {}) as Record<string, unknown>,
  };
}

export async function handleEditApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice(ADMIN_API_PREFIX.length);

  // Current values plus any existing override, for the form.
  if (route === "game" && request.method === "GET") {
    const appid = url.searchParams.get("appid") ?? "";
    if (!/^\d{1,10}$/.test(appid)) return jsonError(400, "appid must be 1-10 digits");

    const record = await deps.findRecord(appid);
    if (!record) return jsonError(404, "not in the catalogue");
    const override = await deps.findOverride(appid);

    // Only the editable fields plus enough to identify the game. The whole
    // record is not the admin screen's business and would be a much larger
    // response for no gain.
    const fields: Record<string, unknown> = {};
    for (const f of MANUAL_FIELDS) fields[f] = record[f] ?? null;

    return json({
      appid,
      link: record.link,
      name: record.name ?? "",
      header_image: record.header_image ?? "",
      release_date: record.release_date ?? "",
      status: record.status ?? "",
      is_dead: record.is_dead ?? false,
      fields,
      override,
      deletable: deletable(override, record),
    });
  }

  // Genres actually in use, most-used first. Populates the dropdown, and the
  // counts are the point: they are how the maintainer spots the vague buckets
  // worth breaking up.
  if (route === "genres" && request.method === "GET") {
    return json({ genres: await deps.genreCounts() });
  }

  // The games carrying one genre, for bulk retagging.
  if (route === "by-genre" && request.method === "GET") {
    const genre = url.searchParams.get("genre") ?? "";
    if (!genre || genre.length > 100) return jsonError(400, "genre required");
    const limit = clampLimit(url.searchParams.get("limit"), 60, 200);
    const offset = clampOffset(url.searchParams.get("offset"));
    const out = await deps.listByGenre(genre, limit, offset);
    return json({ genre, limit, offset, ...out });
  }

  if (route === "edit" && request.method === "POST") {
    let body: {
      appid?: unknown; appids?: unknown;
      set?: unknown; retire?: unknown; reason?: unknown; delete?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }

    // `appid` (singular) is still accepted so the one-game form stays simple;
    // everything below works on the list.
    const raw = Array.isArray(body.appids)
      ? body.appids
      : typeof body.appid === "string"
        ? [body.appid]
        : [];
    const appids = [...new Set(raw.filter((a): a is string => typeof a === "string"))];
    if (!appids.length) return jsonError(400, "appid or appids is required");
    if (appids.length > MAX_EDIT) return jsonError(400, `at most ${MAX_EDIT} games at once`);
    for (const a of appids) {
      if (!/^\d{1,10}$/.test(a)) return jsonError(400, `${a}: appid must be 1-10 digits`);
    }

    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";

    // Deleting a settled override file: one game at a time, nothing else in
    // the same request, re-checked against the file as it is at commit time.
    if (body.delete === true) {
      if (appids.length !== 1) return jsonError(400, "delete takes exactly one appid");
      if (body.set !== undefined || body.retire !== undefined) {
        return jsonError(400, "delete cannot be combined with set or retire");
      }
      const appid = appids[0];
      const record = await deps.findRecord(appid);
      if (!record) return jsonError(404, "not in the catalogue");
      const check = deletable(await deps.findOverride(appid), record);
      if (!check.ok) return jsonError(409, check.reason);

      return commitOverride(env, deps, who, {
        kind: "override.delete",
        appids: [appid],
        targetPath: `data/overrides/${appid}.json`,
        headline: `override: remove settled file for ${record.name || appid}`,
        body:
          `Removed in /admin by ${who.email}.${reason ? `\n\nReason: ${reason}` : ""}\n\n` +
          "Every entry in it was retired and already restored, so it no longer changes anything.",
        edits: [
          {
            path: `data/overrides/${appid}.json`,
            build: (current: string, exists: boolean) => {
              if (!exists) return null;
              let doc: unknown;
              try {
                doc = JSON.parse(current);
              } catch {
                throw new Error(`existing override for ${appid} is not valid JSON`);
              }
              // Re-checked on the text being deleted, not the text read above:
              // a field set in between must not be deleted with the file.
              const again = deletable(doc as { fields?: unknown; retired?: unknown }, record);
              if (!again.ok) throw new Error(`not deletable any more: ${again.reason}`);
              return DELETE_FILE;
            },
          },
        ],
        auditDetail: { appids: [appid], delete: true, reason },
        response: { appids: [appid], deleted: true },
      });
    }

    const set = (body.set && typeof body.set === "object" ? body.set : {}) as Record<string, unknown>;
    const retire = Array.isArray(body.retire)
      ? body.retire.filter((f): f is string => typeof f === "string")
      : [];
    if (!Object.keys(set).length && !retire.length) {
      return jsonError(400, "nothing to set or retire");
    }

    for (const [field, value] of Object.entries(set)) {
      const why = validateValue(field, value);
      if (why) return jsonError(400, `${field}: ${why}`);
    }
    for (const field of retire) {
      if (!(MANUAL_FIELDS as readonly string[]).includes(field)) {
        return jsonError(400, `${field}: not a manual field`);
      }
    }

    // Read every record server-side. `was` must be the value the catalogue
    // actually holds for THAT game, not something the client asserts — it is
    // what a later retire restores, so a client-supplied `was` would let a
    // crafted request rewrite history. It is also why a bulk edit cannot just
    // reuse one `was` across games.
    const records = await Promise.all(appids.map((a) => deps.findRecord(a)));
    const missing = appids.filter((_, i) => !records[i]);
    if (missing.length) {
      return jsonError(404, `not in the catalogue: ${missing.join(", ")}`);
    }

    const now = new Date().toISOString();
    const touched = [...Object.keys(set), ...retire];
    const first = records[0]!;

    const headline =
      appids.length === 1
        ? `override: ${first.name || appids[0]} (${touched.join(", ")})`
        : `override: ${appids.length} games (${touched.join(", ")})`;

    return commitOverride(env, deps, who, {
      kind: "override",
      appids,
      targetPath: appids.length === 1 ? `data/overrides/${appids[0]}.json` : `data/overrides/{${appids.join(",")}}.json`,
      headline,
      body:
        `Edited in /admin by ${who.email}.${reason ? `\n\nReason: ${reason}` : ""}\n\n` +
        `Standing instruction re-applied by save_main() on every write to data/. ` +
        `See scripts/core/overrides.py.`,
      edits: appids.map((appid, i) => {
        const record = records[i]!;
        return {
          path: `data/overrides/${appid}.json`,
          // Rebuilt from the file's CURRENT text on every attempt, so a retry
          // merges with whatever landed in between rather than clobbering it.
          build: (current: string) => {
            let existing: unknown = null;
            if (current.trim()) {
              try {
                existing = JSON.parse(current);
              } catch {
                // Refuse rather than overwrite something we cannot read.
                throw new Error(`existing override for ${appid} is not valid JSON`);
              }
            }
            const doc = asDoc(existing, appid, record.link, (record as GameRecord).name ?? "");

            for (const [field, value] of Object.entries(set)) {
              // `was` is captured the FIRST time a field is overridden and
              // never rewritten: it is the pre-human value, and retiring
              // restores it.
              const prior = doc.fields[field];
              const was = prior && "was" in prior ? prior.was : (record[field] ?? null);
              doc.fields[field] = { value, was, set_by: who.email, set_at: now, reason };
              delete doc.retired[field];
            }

            for (const field of retire) {
              const entry = doc.fields[field];
              if (!entry) continue;
              delete doc.fields[field];
              doc.retired[field] = {
                value: entry.value,
                was: entry.was,
                retired_by: who.email,
                retired_at: now,
              };
            }

            if (!Object.keys(doc.fields).length && !Object.keys(doc.retired).length) {
              return null; // nothing to record for this game
            }
            // Byte-identical to scripts/core/overrides.py::save_override(),
            // so the CLI and this screen never fight over formatting in the
            // diff. Shared rather than inlined so override-doc.test.ts
            // exercises the code that actually runs here.
            return serialiseOverride(doc);
          },
        };
      }),
      auditDetail: { appids, set: Object.keys(set), retire, reason },
      response: {
        appids,
        set: Object.keys(set),
        retired: retire,
        // data/ is untouched until the pipeline runs; say so rather than
        // letting the reviewer assume the catalogue changed.
        applied: false,
      },
    });
  }

  return jsonError(404, "not found");
}

/**
 * One override commit, with its commit_jobs row.
 *
 * Override commits used to leave no job at all - only an audit row written
 * AFTER the commit - so an edit whose Worker died mid-flight left no trace, and
 * the admin "Commit jobs" view never showed an override. The job is written
 * before the attempt, like an approval's.
 */
async function commitOverride(
  env: Env,
  deps: AdminDeps,
  who: AccessIdentity,
  plan: {
    kind: "override" | "override.delete";
    appids: string[];
    targetPath: string;
    headline: string;
    body: string;
    edits: { path: string; build: (current: string, exists: boolean) => string | null | typeof DELETE_FILE }[];
    auditDetail: Record<string, unknown>;
    response: Record<string, unknown>;
  },
): Promise<Response> {
  const jobId = crypto.randomUUID();
  const startedAt = deps.now().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO commit_jobs (id, kind, status, target_path, requested_by, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
    )
      .bind(jobId, plan.kind, plan.targetPath.slice(0, 500), who.email, startedAt)
      .run();
  } catch (err) {
    // The commit is the point; a bookkeeping failure must not block it.
    console.error("override: commit_jobs insert failed", err instanceof Error ? err.message : String(err));
  }

  let sha: string | null;
  try {
    sha = await deps.commitFiles(env, plan.edits, plan.headline, plan.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare("UPDATE commit_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
      .bind(message.slice(0, 500), deps.now().toISOString(), jobId)
      .run()
      .catch(() => undefined);
    await audit(env, who.email, `${plan.kind}.failed`, plan.appids.join(","), { ...plan.auditDetail, message });
    return jsonError(502, "commit failed: " + message);
  }

  await env.DB.prepare("UPDATE commit_jobs SET status='committed', commit_sha=?, error=?, finished_at=? WHERE id=?")
    .bind(sha, sha ? null : "nothing to commit: the files already said this", deps.now().toISOString(), jobId)
    .run()
    .catch((err: unknown) =>
      console.error("override: commit_jobs update failed", err instanceof Error ? err.message : String(err)),
    );

  // Best-effort on purpose: the commit has already landed, so a D1 failure
  // here must not report the override as failed. See lib/audit.ts.
  await audit(env, who.email, plan.kind, plan.appids.join(","), { ...plan.auditDetail, sha, job: jobId });

  return json({ ...plan.response, commit: sha, job: jobId });
}
