/**
 * /api/admin/game and /api/admin/edit — corrections to games already published.
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
import { commitFiles } from "../lib/git-commit";
import { findOverride, findRecord, genreCounts, listByGenre } from "../lib/records";

/**
 * Games one request may change.
 *
 * Bounds the GraphQL read (one aliased field per file), the size of a single
 * commit, and how much one mis-click can do. Ten is the maintainer's number,
 * and it is small enough that a reviewer can still read what they selected.
 */
const MAX_EDIT = 10;

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
): Promise<Response> {
  const route = url.pathname.slice("/api/admin/".length);

  // Current values plus any existing override, for the form.
  if (route === "game" && request.method === "GET") {
    const appid = url.searchParams.get("appid") ?? "";
    if (!/^\d{1,10}$/.test(appid)) return jsonError(400, "appid must be 1-10 digits");

    const record = await findRecord(appid);
    if (!record) return jsonError(404, "not in the catalogue");
    const override = await findOverride(appid);

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
    });
  }

  // Genres actually in use, most-used first. Populates the dropdown, and the
  // counts are the point: they are how the maintainer spots the vague buckets
  // worth breaking up.
  if (route === "genres" && request.method === "GET") {
    return json({ genres: await genreCounts() });
  }

  // The games carrying one genre, for bulk retagging.
  if (route === "by-genre" && request.method === "GET") {
    const genre = url.searchParams.get("genre") ?? "";
    if (!genre || genre.length > 100) return jsonError(400, "genre required");
    const limit = clampLimit(url.searchParams.get("limit"), 60, 200);
    const offset = clampOffset(url.searchParams.get("offset"));
    const out = await listByGenre(genre, limit, offset);
    return json({ genre, limit, offset, ...out });
  }

  if (route === "edit" && request.method === "POST") {
    let body: {
      appid?: unknown; appids?: unknown;
      set?: unknown; retire?: unknown; reason?: unknown;
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

    const set = (body.set && typeof body.set === "object" ? body.set : {}) as Record<string, unknown>;
    const retire = Array.isArray(body.retire)
      ? body.retire.filter((f): f is string => typeof f === "string")
      : [];
    if (!Object.keys(set).length && !retire.length) {
      return jsonError(400, "nothing to set or retire");
    }
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";

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
    const records = await Promise.all(appids.map((a) => findRecord(a)));
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

    const sha = await commitFiles(
      env,
      appids.map((appid, i) => {
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
            const doc = asDoc(existing, appid, record.link, record.name ?? "");

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
      headline,
      `Edited in /admin by ${who.email}.${reason ? `\n\nReason: ${reason}` : ""}\n\n` +
        `Standing instruction re-applied by save_main() on every write to data/. ` +
        `See scripts/core/overrides.py.`,
    );

    // Shared helper, and best-effort on purpose: this runs after commitFiles
    // has already landed a commit, so a D1 failure here must not report the
    // override as failed. See lib/audit.ts.
    await audit(env, who.email, "override", appids.join(","), {
      appids,
      set: Object.keys(set),
      retire,
      sha,
      reason,
    });

    return json({
      appids,
      commit: sha,
      set: Object.keys(set),
      retired: retire,
      // data/ is untouched until the pipeline runs; say so rather than letting
      // the reviewer assume the catalogue changed.
      applied: false,
    });
  }

  return jsonError(404, "not found");
}
