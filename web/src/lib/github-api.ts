/**
 * GitHub Contents API + workflow_dispatch helpers.
 * Used by Phase 2 (edit/add/delete). Stub-safe: read-side works without auth.
 */
import { REPO_OWNER, REPO_NAME, DEFAULT_BRANCH } from "./schema";

const API_BASE = "https://api.github.com";

export interface AuthState {
  token: string | null;
  user: string | null;
}

const TOKEN_KEY = "f2p:gh_token";
const USER_KEY = "f2p:gh_user";

export function loadAuth(): AuthState {
  return {
    token: localStorage.getItem(TOKEN_KEY),
    user: localStorage.getItem(USER_KEY),
  };
}

export function saveAuth(token: string, user: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, user);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface ContentsResponse {
  sha: string;
  content: string;
  encoding: "base64";
  path: string;
}

export async function getContents(
  pathInRepo: string,
  token: string | null,
): Promise<ContentsResponse | null> {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${pathInRepo}?ref=${DEFAULT_BRANCH}`,
    { headers: authHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET contents ${pathInRepo}: ${res.status}`);
  return (await res.json()) as ContentsResponse;
}

export interface PutContentsInput {
  pathInRepo: string;
  content: string;
  message: string;
  sha?: string;
  token: string;
}

export async function putContents(input: PutContentsInput): Promise<void> {
  const body = {
    message: input.message,
    content: btoa(unescape(encodeURIComponent(input.content))),
    branch: DEFAULT_BRANCH,
    sha: input.sha,
  };
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${input.pathInRepo}`,
    {
      method: "PUT",
      headers: { ...authHeaders(input.token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT contents ${input.pathInRepo}: ${res.status} ${text}`);
  }
}

export async function dispatchWorkflow(
  workflowFile: string,
  token: string,
  inputs?: Record<string, string>,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: DEFAULT_BRANCH, inputs: inputs ?? {} }),
    },
  );
  if (!res.ok) throw new Error(`workflow_dispatch ${workflowFile}: ${res.status}`);
}

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

export async function getRateLimit(token: string | null): Promise<RateLimit | null> {
  try {
    const res = await fetch(`${API_BASE}/rate_limit`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rate as RateLimit;
  } catch {
    return null;
  }
}
