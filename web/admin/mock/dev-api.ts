/**
 * The local admin backend, for `npm run dev:admin` and `npm run preview:admin`.
 *
 * A real Worker cannot run the admin locally: every /admin and /api/admin
 * request needs a Cloudflare Access JWT, which cannot be minted offline, so
 * `wrangler dev` answers 404 - the old admin pages could never be seen at all
 * without deploying them. This plugin runs the REAL handlers
 * (worker/routes/admin.ts, edit.ts) inside Vite's dev server against an
 * in-memory D1 with the real migrations, fed by the real ../data shards, with
 * GitHub faked. Nothing leaves the machine and nothing is written to disk.
 *
 * It exists ONLY in this Vite config. Nothing under worker/ or admin/src
 * imports it (admin/security.test.ts checks), and there is no flag in the
 * Worker that could switch authentication off.
 *
 *   MOCK_GITHUB=down, or    health reports GitHub unreachable (a 503)
 *   mock_github=down cookie
 *   x-mock-session header,  "expired" answers like Access does for a lapsed
 *   mock_session cookie     session, so the SPA's re-login path can be tried
 *
 * In preview mode it also serves /admin* through worker/routes/admin-spa.ts
 * and the generated bundle, exactly as production does - the only way to see
 * the real CSP before deploying.
 */
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { isAdminRoute } from "../../shared/admin-routes";

const WEB = join(__dirname, "..", "..");
const REPO = join(WEB, "..");

interface Backend {
  handle(request: Request, url: URL): Promise<Response>;
  serveShell?: (request: Request, url: URL) => Response;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function loadRecords(): Record<string, unknown>[] {
  const dataDir = join(REPO, "data");
  const index = JSON.parse(readFileSync(join(dataDir, "index.json"), "utf-8")) as { files: { name: string }[] };
  const out: Record<string, unknown>[] = [];
  for (const file of index.files) {
    for (const line of readFileSync(join(dataDir, file.name), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

/** Per-request switches, set by the middleware from the environment or a cookie. */
const mock = { githubDown: false };

async function createBackend(server: ViteDevServer, preview: boolean): Promise<Backend> {
  const load = <T>(file: string) => server.ssrLoadModule(join(WEB, file)) as Promise<T>;
  const [{ makeEnv, fakeDeps }, { SqliteD1 }, { handleAdminApi }, { seed }] = await Promise.all([
    load<typeof import("../../worker/testing/fixtures")>("worker/testing/fixtures.ts"),
    load<typeof import("../../worker/testing/sqlite-d1")>("worker/testing/sqlite-d1.ts"),
    load<typeof import("../../worker/routes/admin")>("worker/routes/admin.ts"),
    load<typeof import("./seed")>("admin/mock/seed.ts"),
  ]);

  const records = loadRecords();
  const byAppid: Record<string, any> = {};
  for (const r of records) {
    const appid = /\/app\/(\d+)/.exec(String(r.link ?? ""))?.[1];
    if (appid) byAppid[appid] = r;
  }

  const now = () => new Date();
  const deps = fakeDeps({
    records: byAppid,
    now: now(),
    gh: async () =>
      mock.githubDown ? new Response("unavailable", { status: 503 }) : new Response("[]", { status: 200 }),
  });
  deps.now = now;
  let hidden = new Set<string>();
  deps.fetchRaw = async (path: string) => {
    const full = join(REPO, path);
    if (!existsSync(full)) return null;
    const text = readFileSync(full, "utf-8");
    if (!/^data\/data_\d+\.jsonl$/.test(path) || !hidden.size) return text;
    // The demo queue is built from real, published games; drop the ones the
    // seed wants reconcile to treat as not published yet.
    return text
      .split("\n")
      .filter((line) => !hidden.has(/\/app\/(\d+)/.exec(line)?.[1] ?? ""))
      .join("\n");
  };
  deps.genreCounts = async () => {
    const counts = new Map<string, number>();
    for (const r of records) if (typeof r.genre === "string" && r.genre) counts.set(r.genre, (counts.get(r.genre) ?? 0) + 1);
    return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count);
  };
  deps.listByGenre = async (genre: string, limit: number, offset: number) => {
    const all = records.filter((r) => r.genre === genre);
    return {
      total: all.length,
      items: all.slice(offset, offset + limit).map((r) => ({
        appid: /\/app\/(\d+)/.exec(String(r.link))?.[1] ?? "",
        name: String(r.name ?? ""),
        genre,
        header_image: String(r.header_image ?? ""),
        release_date: String(r.release_date ?? ""),
      })),
    };
  };

  const db = new SqliteD1();
  const env = makeEnv(db);
  hidden = seed(db, deps.repo, records as any, new Date()).hidden;
  const who = { email: "you@localhost", isServiceToken: false };

  const backend: Backend = {
    handle: (request, url) => handleAdminApi(request, url, env, who, deps),
  };

  if (preview) {
    const [{ serveAdmin }, generated] = await Promise.all([
      load<typeof import("../../worker/routes/admin-spa")>("worker/routes/admin-spa.ts"),
      load<{ ADMIN_BUNDLE: import("../../worker/lib/admin-bundle").AdminBundle }>("worker/generated/admin-bundle.ts"),
    ]);
    backend.serveShell = (request, url) => serveAdmin(request, url, generated.ADMIN_BUNDLE);
  }
  return backend;
}

export function adminDevApi(options: { preview: boolean }): Plugin {
  let backend: Promise<Backend> | undefined;

  return {
    name: "f2p-admin-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const [path, search = ""] = (req.url ?? "").split("?");
        const api = path.startsWith("/api/admin/");
        const shell = options.preview && (path === "/admin" || path.startsWith("/admin/"));

        // Dev: Vite serves the app only under its base, "/admin/", and answers
        // "/admin" itself with a did-you-mean page. The app's real URLs have no
        // trailing slash, so hand Vite the base while the address bar keeps
        // the real path.
        if (!options.preview && !api && req.method === "GET" && isAdminRoute(path)) {
          req.url = `/admin/${search ? `?${search}` : ""}`;
          return next();
        }
        if (!api && !shell) return next();

        try {
          // The cookie form exists so the path can be tried from a browser tab:
          // document.cookie = "mock_session=expired; path=/"
          if (
            req.headers["x-mock-session"] === "expired" ||
            /(?:^|;\s*)mock_session=expired(?:;|$)/.test(req.headers.cookie ?? "")
          ) {
            res.statusCode = 302;
            res.setHeader("Location", "https://example.cloudflareaccess.com/cdn-cgi/access/login");
            return res.end();
          }
          mock.githubDown =
            process.env.MOCK_GITHUB === "down" || /(?:^|;\s*)mock_github=down(?:;|$)/.test(req.headers.cookie ?? "");
          backend ??= createBackend(server, options.preview);
          const ready = await backend;
          const url = new URL(req.url ?? "/", "http://localhost");
          const body = await readBody(req);
          const request = new Request(url, {
            method: req.method,
            headers: Object.entries(req.headers).flatMap(([k, v]) =>
              typeof v === "string" ? [[k, v] as [string, string]] : [],
            ),
            body,
          });
          if (api) return await send(res, await ready.handle(request, url));
          return await send(res, ready.serveShell!(request, url));
        } catch (err) {
          server.config.logger.error(`[admin mock] ${err instanceof Error ? err.stack : String(err)}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "mock backend crashed - see the terminal" }));
        }
      });
    },
  };
}
