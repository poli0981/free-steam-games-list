/**
 * Every call the admin makes to /api/admin/*.
 *
 * Same-origin, and `redirect: "manual"` on purpose. When the Cloudflare Access
 * session lapses, Access answers with a redirect to its login page; followed
 * silently, that redirect lands on HTML from another origin, which the old
 * pages then mis-reported as a server error. Stopped here, it surfaces as an
 * opaque redirect, and the app reloads the page so Access can sign the reviewer
 * in again.
 *
 * Writes carry no token of their own: the edge attaches the Access assertion
 * to same-origin requests, and worker/index.ts additionally rejects any write
 * announcing a cross-site origin.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("Your Cloudflare Access session has expired.");
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  /** Statuses whose JSON body is a normal answer, not an error (health: 503). */
  accept?: number[];
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      redirect: "manual",
      signal: options.signal,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new ApiError(0, "The admin API could not be reached. Check the connection and try again.", null);
  }

  if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401 || res.status === 403) {
    throw new SessionExpiredError();
  }

  const isJson = (res.headers.get("Content-Type") ?? "").includes("application/json");
  const body: unknown = isJson ? await res.json().catch(() => null) : null;

  // Every route under /api/admin answers JSON, errors included (worker/index.ts
  // wraps dispatch in one try/catch). A non-JSON body is therefore reported as
  // what it is. The old pages called it an expired session, and that hid real
  // Worker crashes behind the most misleading message on the screen.
  if (!isJson) {
    throw new ApiError(res.status, `The server answered ${res.status} with a non-JSON body. Check wrangler tail.`, null);
  }

  if (res.ok || options.accept?.includes(res.status)) return body as T;

  const message =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `The server answered ${res.status}.`;
  throw new ApiError(res.status, message, body);
}

/** A readable sentence for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
