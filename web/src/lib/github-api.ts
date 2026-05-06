/**
 * GitHub Contents API + workflow_dispatch helpers + auth.
 * Uses fine-grained or classic PAT stored in localStorage.
 * Classic PATs auto-sign commits via GitHub web-flow → "Verified" badge.
 */
import { REPO_OWNER, REPO_NAME, DEFAULT_BRANCH } from "./schema";

const API_BASE = "https://api.github.com";

const TOKEN_KEY = "f2p:gh_token";
const USER_KEY = "f2p:gh_user";

export interface AuthState {
  token: string | null;
  user: string | null;
}

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

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
  html_url: string;
}

export async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch(`${API_BASE}/user`, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`Token invalid (${res.status}). Check scopes & expiry.`);
  }
  return (await res.json()) as GitHubUser;
}

/**
 * Sanity check that the token can read+write the target repo.
 * Returns the user's permission level on the repo.
 */
export async function checkRepoAccess(
  token: string,
): Promise<{ ok: boolean; permission?: string; error?: string }> {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
  const data = await res.json();
  const perm = data?.permissions;
  if (!perm) return { ok: false, error: "no permissions field on response" };
  if (!perm.push) {
    return { ok: false, error: "Token lacks push permission on this repo" };
  }
  return { ok: true, permission: perm.admin ? "admin" : "write" };
}

export interface ContentsResponse {
  sha: string;
  content: string;
  encoding: "base64";
  path: string;
  size: number;
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

export interface PutContentsResult {
  sha: string;
  commitSha: string;
  htmlUrl: string;
}

/**
 * Encodes UTF-8 string to base64 safely (handles non-ASCII).
 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function putContents(
  input: PutContentsInput,
): Promise<PutContentsResult> {
  const body = {
    message: input.message,
    content: utf8ToBase64(input.content),
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
  if (res.status === 409) {
    throw new ConflictError(input.pathInRepo);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT contents ${input.pathInRepo}: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    sha: data.content.sha,
    commitSha: data.commit.sha,
    htmlUrl: data.commit.html_url,
  };
}

export class ConflictError extends Error {
  constructor(public path: string) {
    super(`Conflict on ${path} — file changed remotely. Refetch and retry.`);
    this.name = "ConflictError";
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`workflow_dispatch ${workflowFile}: ${res.status} ${text}`);
  }
}

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
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

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  head_sha: string;
}

export async function getRecentWorkflowRuns(
  workflowFile: string,
  token: string | null,
  limit = 5,
): Promise<WorkflowRun[]> {
  const res = await fetch(
    `${API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflowFile}/runs?per_page=${limit}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.workflow_runs ?? []) as WorkflowRun[];
}
