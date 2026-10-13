/**
 * /admin/api/quality: catalogue records that fail a check in
 * shared/quality.ts - a summary of counts, or one check's games, paged.
 *
 * Computed once per dataset generation (lib/records.ts readCatalogue), so
 * paging through a list does not re-read nine shards per page.
 */
import { jsonError, SECURITY_HEADERS, clampLimit, clampOffset } from "../lib/http";
import type { AccessIdentity } from "../lib/access";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import { readCatalogue } from "../lib/records";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";
import { isQualityCheck, QUALITY_CHECKS } from "../../shared/quality";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

export async function handleQualityApi(
  request: Request,
  url: URL,
  _env: Env,
  _who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice(ADMIN_API_PREFIX.length);
  if (route !== "quality" || request.method !== "GET") return jsonError(404, "not found");

  const catalogue = await readCatalogue(deps.fetchRaw);
  if (!catalogue) return jsonError(503, "the catalogue could not be read - try again shortly");

  const check = url.searchParams.get("check");
  if (check === null) {
    const counts: Record<string, number> = Object.fromEntries(QUALITY_CHECKS.map((c) => [c.key, 0]));
    for (const game of catalogue.games) for (const issue of game.issues) counts[issue]++;
    return json({ total: catalogue.games.length, verified: catalogue.verified, counts });
  }

  if (!isQualityCheck(check)) return jsonError(400, "unknown check");
  const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
  const offset = clampOffset(url.searchParams.get("offset"));
  const matching = catalogue.games.filter((g) => g.issues.includes(check));
  return json({
    check,
    total: matching.length,
    limit,
    offset,
    items: matching.slice(offset, offset + limit).map((g) => ({
      appid: g.appid,
      name: g.name,
      header_image: g.header_image,
      release_date: g.release_date,
      type_game: g.type_game,
      genre: g.genre,
      issues: g.issues,
    })),
  });
}
