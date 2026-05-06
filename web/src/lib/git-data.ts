/**
 * Git Data API — the lower-level commit flow that supports detached signatures.
 * Replaces the Contents API in edits.ts so commits can be GPG-signed → Verified.
 *
 *   getRef        ─┐
 *   createBlob    ─┤
 *   createTree    ─┼─→ commitFile / commitMultiFile
 *   createCommit  ─┤    (signature optional)
 *   updateRef     ─┘
 */
import { REPO_OWNER, REPO_NAME, DEFAULT_BRANCH } from "./schema";

const API = "https://api.github.com";

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function authHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function ghJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${url}: ${body}`);
  }
  return (await res.json()) as T;
}

export interface RefHead {
  commitSha: string;
  treeSha: string;
}

export async function getHead(token: string): Promise<RefHead> {
  const ref = await ghJson<{ object: { sha: string } }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${DEFAULT_BRANCH}`,
    { headers: authHeaders(token) },
  );
  const commit = await ghJson<{ tree: { sha: string } }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${ref.object.sha}`,
    { headers: authHeaders(token) },
  );
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
}

/** Fetch a blob's UTF-8 text content by sha. */
export async function getBlobText(
  sha: string,
  token: string,
): Promise<string> {
  const blob = await ghJson<{ content: string; encoding: "base64" }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${sha}`,
    { headers: authHeaders(token) },
  );
  const cleaned = blob.content.replace(/\s/g, "");
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Look up a single file's blob sha within the head tree, returning null if absent. */
export async function getFileBlobSha(
  path: string,
  token: string,
): Promise<{ sha: string; treeSha: string; commitSha: string } | null> {
  const head = await getHead(token);
  const tree = await ghJson<{
    tree: { path: string; sha: string; type: string }[];
  }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${head.treeSha}?recursive=1`,
    { headers: authHeaders(token) },
  );
  const entry = tree.tree.find((e) => e.path === path && e.type === "blob");
  if (!entry) return null;
  return { sha: entry.sha, treeSha: head.treeSha, commitSha: head.commitSha };
}

export async function createBlob(
  content: string,
  token: string,
): Promise<string> {
  const data = await ghJson<{ sha: string }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ content: utf8ToBase64(content), encoding: "base64" }),
    },
  );
  return data.sha;
}

export interface TreeFile {
  path: string;
  blobSha: string;
}

export async function createTree(
  baseTreeSha: string,
  files: TreeFile[],
  token: string,
): Promise<string> {
  const data = await ghJson<{ sha: string }>(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: files.map((f) => ({
          path: f.path,
          mode: "100644",
          type: "blob",
          sha: f.blobSha,
        })),
      }),
    },
  );
  return data.sha;
}

export interface IdentityInput {
  name: string;
  email: string;
  date: Date;
}

export interface CreateCommitInput {
  treeSha: string;
  parentSha: string;
  message: string;
  author: IdentityInput;
  committer: IdentityInput;
  signature?: string;
}

export interface CommitResult {
  sha: string;
  htmlUrl: string;
  verified: boolean;
  reason: string;
}

/**
 * Build the exact bytes of a Git commit object so OpenPGP.js can sign them.
 * GitHub recomputes this server-side; if our bytes diverge, signature fails
 * with verification.reason="invalid".
 *
 * Format (each \n is literal):
 *   tree HEX\n
 *   parent HEX\n
 *   author NAME <EMAIL> UNIX_TS +0000\n
 *   committer NAME <EMAIL> UNIX_TS +0000\n
 *   \n
 *   MESSAGE              ← NO trailing newline
 *
 * Empirical: GitHub's verification.payload (the bytes it actually verifies
 * the signature against) does NOT include a trailing \n after the message.
 * Earlier we appended one and the signature came back as `reason: "invalid"`
 * because the bytes were 1 byte longer than GitHub's. See
 * GET /repos/{o}/{r}/commits/{sha}.commit.verification.payload to inspect.
 */
export function buildCommitContent(input: CreateCommitInput): string {
  const fmt = (id: IdentityInput) =>
    `${id.name} <${id.email}> ${Math.floor(id.date.getTime() / 1000)} +0000`;
  const headers =
    `tree ${input.treeSha}\n` +
    `parent ${input.parentSha}\n` +
    `author ${fmt(input.author)}\n` +
    `committer ${fmt(input.committer)}\n`;
  const message = input.message.replace(/\n+$/, "");
  return `${headers}\n${message}`;
}

export async function createCommit(
  input: CreateCommitInput,
  token: string,
): Promise<CommitResult> {
  const body = {
    tree: input.treeSha,
    parents: [input.parentSha],
    message: input.message.replace(/\n+$/, ""),
    author: {
      name: input.author.name,
      email: input.author.email,
      date: input.author.date.toISOString(),
    },
    committer: {
      name: input.committer.name,
      email: input.committer.email,
      date: input.committer.date.toISOString(),
    },
    ...(input.signature ? { signature: input.signature } : {}),
  };
  const data = await ghJson<{
    sha: string;
    html_url: string;
    verification: { verified: boolean; reason: string };
  }>(`${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return {
    sha: data.sha,
    htmlUrl: data.html_url,
    verified: data.verification?.verified ?? false,
    reason: data.verification?.reason ?? "unsigned",
  };
}

export async function updateBranchRef(
  newCommitSha: string,
  token: string,
  force = false,
): Promise<void> {
  const res = await fetch(
    `${API}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${DEFAULT_BRANCH}`,
    {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ sha: newCommitSha, force }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 422) throw new RefAdvancedError(body);
    throw new Error(`PATCH ref: ${res.status} ${body}`);
  }
}

/** Thrown when the branch ref moved between getHead() and updateRef(). */
export class RefAdvancedError extends Error {
  constructor(public detail: string) {
    super(`Branch advanced — retry needed: ${detail}`);
    this.name = "RefAdvancedError";
  }
}

export interface CommitFilesInput {
  /** One or more files to land in a single commit. */
  files: { path: string; content: string }[];
  message: string;
  author: { name: string; email: string };
  /** If provided, called with exact commit bytes; must return armored detached sig. */
  signer?: (commitContent: string) => Promise<string>;
  token: string;
}

/**
 * Commit any number of files in a single Git commit. With `signer`, produces
 * a Verified commit.
 *
 * Flow: head → blobs (parallel) → tree → (sign) → commit → update ref.
 */
export async function commitFiles(
  input: CommitFilesInput,
): Promise<CommitResult> {
  if (input.files.length === 0) throw new Error("commitFiles: no files");
  const head = await getHead(input.token);
  const blobShas = await Promise.all(
    input.files.map((f) => createBlob(f.content, input.token)),
  );
  const treeFiles: TreeFile[] = input.files.map((f, i) => ({
    path: f.path,
    blobSha: blobShas[i],
  }));
  const treeSha = await createTree(head.treeSha, treeFiles, input.token);

  // Zero out milliseconds so the ISO timestamp we send to GitHub matches
  // (when truncated to whole seconds) the unix-second value we baked into
  // the signed commit content. Otherwise rounding can flip the timestamp by
  // a second and invalidate the signature.
  const now = new Date();
  now.setMilliseconds(0);
  const author: IdentityInput = { ...input.author, date: now };
  const committer: IdentityInput = { ...author };

  let signature: string | undefined;
  if (input.signer) {
    const commitContent = buildCommitContent({
      treeSha,
      parentSha: head.commitSha,
      message: input.message,
      author,
      committer,
    });
    signature = await input.signer(commitContent);
  }

  const result = await createCommit(
    {
      treeSha,
      parentSha: head.commitSha,
      message: input.message,
      author,
      committer,
      signature,
    },
    input.token,
  );

  await updateBranchRef(result.sha, input.token);
  return result;
}

/** Convenience for the common single-file case. */
export interface CommitFileInput {
  path: string;
  content: string;
  message: string;
  author: { name: string; email: string };
  signer?: (commitContent: string) => Promise<string>;
  token: string;
}

export function commitFile(input: CommitFileInput): Promise<CommitResult> {
  return commitFiles({
    files: [{ path: input.path, content: input.content }],
    message: input.message,
    author: input.author,
    signer: input.signer,
    token: input.token,
  });
}

/** 1 retry on RefAdvancedError (race vs daily pipeline). */
export async function commitFileWithRetry(
  input: CommitFileInput,
): Promise<CommitResult> {
  try {
    return await commitFile(input);
  } catch (err) {
    if (err instanceof RefAdvancedError) return await commitFile(input);
    throw err;
  }
}

export async function commitFilesWithRetry(
  input: CommitFilesInput,
): Promise<CommitResult> {
  try {
    return await commitFiles(input);
  } catch (err) {
    if (err instanceof RefAdvancedError) return await commitFiles(input);
    throw err;
  }
}
