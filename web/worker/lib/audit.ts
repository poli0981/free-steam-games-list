/**
 * audit_log writes.
 *
 * Lives here rather than in routes/admin.ts because routes/edit.ts needs it
 * too, and admin.ts already imports edit.ts — importing back the other way
 * would be a cycle. edit.ts previously carried its own copy of the INSERT,
 * with the same defect described below.
 */

/**
 * Record what an identity did. Deliberately incapable of failing the request.
 *
 * Every call site awaits this AFTER the mutation it describes — after a commit
 * has landed in Git, after a queue row has been updated. Throwing on a D1 error
 * propagated out of the handler and told the client the operation had failed
 * when it had in fact succeeded, so the reviewer would retry an approval that
 * already committed.
 *
 * A failure is therefore swallowed and logged loudly. Losing an audit row is
 * bad; misreporting a repository write as failed is worse, and the log line
 * makes the loss visible rather than silent.
 */
export async function audit(
  env: Env,
  actor: string,
  action: string,
  target: string | null,
  detail: unknown = {},
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (actor, action, target, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(actor, action, target, JSON.stringify(detail), new Date().toISOString())
      .run();
  } catch (err) {
    console.error("audit: row LOST", {
      actor,
      action,
      target,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
