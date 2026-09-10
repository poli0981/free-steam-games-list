/**
 * Secrets are not present in wrangler.jsonc, so `wrangler types` cannot see
 * them — it only knows about `vars`. Declaring them here keeps the Worker
 * typed without putting credentials anywhere near the repository.
 *
 * Set them with:
 *   npx wrangler secret put GH_APP_ID
 *   npx wrangler secret put GH_APP_INSTALLATION_ID
 *   npx wrangler secret put GH_APP_PRIVATE_KEY
 *
 * See docs/ADMIN.md. Never move these into `vars`.
 */
interface Env {
  /** Numeric App ID from the GitHub App settings page. */
  GH_APP_ID: string;
  /** Installation ID — the trailing number in the installation settings URL. */
  GH_APP_INSTALLATION_ID: string;
  /** Full .pem contents, including the BEGIN/END lines. */
  GH_APP_PRIVATE_KEY: string;
}
