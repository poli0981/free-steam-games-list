/**
 * /admin/api/automation: auto-approve's settings, what it would do next, and a
 * button to run one batch now. The runner is lib/auto-approve.ts.
 */
import { jsonError, SECURITY_HEADERS } from "../lib/http";
import { audit } from "../lib/audit";
import type { AccessIdentity } from "../lib/access";
import { autoApprove, countEligible, selectCandidates } from "../lib/auto-approve";
import { defaultAdminDeps, type AdminDeps } from "../lib/deps";
import { readState, writeState } from "../lib/locks";
import {
  AUTO_DAILY_CEILING,
  AUTO_DEFAULTS,
  AUTO_LAST_KEY,
  AUTO_SETTINGS_KEY,
  autoCountKey,
  parseSettings,
  validateSettings,
  type AutoLast,
} from "../../shared/automation";
import { ADMIN_API_PREFIX } from "../../shared/admin-routes";
import { MAX_DECIDE } from "../../shared/queue-rules";

export const AUTOMATION_ROUTES = ["automation", "automation/run"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

const HISTORY_ACTIONS = ["auto.approve", "auto.approve.failed", "auto.approve.desynced", "automation.settings"];

export async function handleAutomationApi(
  request: Request,
  url: URL,
  env: Env,
  who: AccessIdentity,
  deps: AdminDeps = defaultAdminDeps,
): Promise<Response> {
  const route = url.pathname.slice(ADMIN_API_PREFIX.length);

  if (route === "automation" && request.method === "GET") {
    const now = deps.now();
    const stored = await readState(env.DB, AUTO_SETTINGS_KEY);
    const settings = parseSettings(stored);
    const usedRaw = stored === null ? null : await readState(env.DB, autoCountKey(now));
    const used = Number(usedRaw ?? 0) || 0;
    const limit = Math.min(settings.dailyLimit, AUTO_DAILY_CEILING);
    let last: AutoLast | null = null;
    try {
      const raw = stored === null ? null : await readState(env.DB, AUTO_LAST_KEY);
      last = raw ? (JSON.parse(raw) as AutoLast) : null;
    } catch {
      last = null;
    }

    const batch = Math.max(1, Math.min(settings.batchSize, MAX_DECIDE, Math.max(limit - used, 0) || settings.batchSize));
    const [preview, eligible, sources, inFlight, history] = await Promise.all([
      selectCandidates(env, settings, now, batch),
      countEligible(env, settings, now),
      env.DB.prepare(
        `SELECT source, SUM(status = 'pending') AS pending, SUM(status = 'failed') AS failed, COUNT(*) AS total
           FROM ingest_queue GROUP BY source ORDER BY pending DESC, source`,
      ).all<{ source: string; pending: number; failed: number; total: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM ingest_queue WHERE status = 'approved'").first<{ n: number }>(),
      env.DB.prepare(
        `SELECT id, actor, action, target, detail_json, created_at FROM audit_log
          WHERE action IN (SELECT value FROM json_each(?)) ORDER BY id DESC LIMIT 20`,
      )
        .bind(JSON.stringify(HISTORY_ACTIONS))
        .all(),
    ]);

    return json({
      settings,
      defaults: AUTO_DEFAULTS,
      ceiling: AUTO_DAILY_CEILING,
      maxBatch: MAX_DECIDE,
      stateAvailable: stored !== null,
      today: { date: now.toISOString().slice(0, 10), used, limit },
      last,
      eligible,
      preview: preview.map((r) => ({ id: r.id, appid: r.appid, name: r.name, source: r.source, first_seen_at: r.first_seen_at })),
      sources: sources.results ?? [],
      inFlight: inFlight?.n ?? 0,
      history: history.results ?? [],
    });
  }

  if (route === "automation" && request.method === "POST") {
    let body: { settings?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError(400, "invalid json");
    }
    const checked = validateSettings(body.settings);
    if (!checked.ok) return jsonError(400, checked.error);

    const before = await readState(env.DB, AUTO_SETTINGS_KEY);
    // Without migration 0002 there is nowhere to keep them; say so instead
    // of answering 200 for settings that were never stored.
    if (before === null) return jsonError(503, "admin_state is missing - apply D1 migration 0002 first");
    await writeState(env.DB, AUTO_SETTINGS_KEY, JSON.stringify(checked.settings), deps.now());
    await audit(env, who.email, "automation.settings", null, { before: parseSettings(before), after: checked.settings });
    return json({ settings: checked.settings });
  }

  if (route === "automation/run" && request.method === "POST") {
    // A person asked: runs even while the schedule is off, within every other limit.
    const result = await autoApprove(env, deps, { manual: true, actor: who.email });
    return json(result);
  }

  return jsonError(404, "not found");
}
