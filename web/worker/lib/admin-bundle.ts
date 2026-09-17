/**
 * The shape of worker/generated/admin-bundle.ts, which admin/build/
 * emit-worker-bundle.ts writes at the end of `npm run build:admin`.
 *
 * That file is GITIGNORED and regenerated on every build, so the Worker never
 * ships an admin UI older than its own source. There is deliberately no
 * committed stub: a missing bundle fails typecheck and `wrangler deploy`
 * loudly instead of deploying an empty admin.
 */
export interface AdminAsset {
  contentType: string;
  /** Text assets are stored as-is; fonts and images as base64. */
  encoding: "utf8" | "base64";
  body: string;
}

export interface AdminBundle {
  /** Content hash of the shell and asset list, for logs and cache debugging. */
  buildId: string;
  /** index.html, with `__ADMIN_NONCE__` where the per-response nonce goes. */
  shell: string;
  /** By request path: "/admin/assets/app-1a2b3c.js". */
  assets: Record<string, AdminAsset>;
}

export const NONCE_PLACEHOLDER = "__ADMIN_NONCE__";
