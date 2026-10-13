/**
 * Worker → Git commits, via the GraphQL `createCommitOnBranch` mutation.
 *
 * Why GraphQL rather than the REST contents API: commits made through
 * createCommitOnBranch are signed by GitHub itself, so an approval that lands
 * in the repository shows as Verified. The REST path would require carrying a
 * signing key in the Worker, next to a credential that can already write.
 *
 * Scope: this module may append to `scripts/temp_info.jsonl`, write or
 * delete `data/overrides/<appid>.json`, and edit `data/blocklist.jsonl` (see
 * WRITABLE). It cannot touch the data/ shards. Publication and removal stay
 * the pipeline's job - the Worker only commits a request or a standing
 * instruction, save_main() applies it, and Git remains the source of truth.
 */
import { gh } from "./github-app";
import { ADMIN_ATTRIBUTION } from "../../shared/admin-api";

const REPO_OWNER = "poli0981";
const REPO_NAME = "free-steam-games-list";
const BRANCH = "main";

/** The new-game queue the ingest pipeline consumes. */
export const TEMP_INFO_PATH = "scripts/temp_info.jsonl";

/**
 * Every path this module may write, anchored.
 *
 * The GitHub App credential can write anywhere in the repository; this is what
 * stops a bug upstream from turning that into a general-purpose commit engine.
 * data/ shards are NOT here and must never be: a shard is 1.2 MB, its identity
 * is unstable (save_main re-chunks from scratch every run), and index.json
 * would have to be bumped in the same commit. Overrides exist precisely so the
 * Worker never has to touch a shard.
 */
const WRITABLE = [
  /^scripts\/temp_info\.jsonl$/,
  /^data\/overrides\/\d{1,10}\.json$/,
  // Removed games (shared/removal.ts BLOCKLIST_PATH). Lines are appended or
  // deleted whole, never rewritten.
  /^data\/blocklist\.jsonl$/,
];

function assertWritable(path: string): void {
  if (path.includes("..") || !WRITABLE.some((re) => re.test(path))) {
    throw new Error(`refusing to write ${path}: not an allowed path`);
  }
}

/**
 * Optimistic concurrency retries. The pipeline commits to `main` several times
 * a day and `ingest_new.py` CLEARS this very file at the end of every run, so
 * losing the race is normal rather than exceptional. Each attempt re-reads the
 * file, so a retry appends to whatever is there now instead of resurrecting
 * content the pipeline just consumed.
 */
const MAX_ATTEMPTS = 4;

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string; type?: string }[];
}

/** Error carrying GitHub's machine-readable error types. */
type GraphQlError = Error & { types?: string[] };

function b64encode(text: string): string {
  // btoa() is byte-oriented; game names are routinely non-Latin, so the string
  // has to be UTF-8 encoded before it is base64'd or the commit body is
  // mojibake in the repository.
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** How requests reach GitHub. `gh` in production; a fake in tests. */
export type GitHubTransport = typeof gh;

async function graphql<T>(
  env: Env,
  query: string,
  variables: unknown,
  transport: GitHubTransport = gh,
): Promise<T> {
  const res = await transport(env, "/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
    headers: { "Content-Type": "application/json" },
  });
  const body = (await res.json()) as GraphQlResponse<T>;
  if (body.errors?.length) {
    // Carry the machine-readable types onto the Error. GitHub answers a stale
    // expectedHeadOid with type "STALE_DATA" and the prose "Expected branch to
    // point to ... but it did not." -- the type is stable, the prose is not,
    // and throwing only the message discards the reliable half.
    const err = new Error(body.errors.map((e) => e.message).join("; ")) as GraphQlError;
    err.types = body.errors.map((e) => e.type).filter((t): t is string => !!t);
    throw err;
  }
  if (!res.ok || !body.data) throw new Error(`graphql HTTP ${res.status}`);
  return body.data;
}

interface HeadAndFile {
  oid: string;
  /** Current file text, or "" when the file does not exist on the branch. */
  text: string;
}

/**
 * Branch head and the current contents of one file, read TOGETHER.
 *
 * Reading them in one query is what makes `expectedHeadOid` meaningful: the
 * text and the oid describe the same commit, so if anything lands between this
 * read and the mutation, the mutation is rejected rather than silently
 * overwriting the newer content.
 */
async function readHeadAndFile(env: Env, path: string, transport: GitHubTransport = gh): Promise<HeadAndFile> {
  const data = await graphql<{
    repository: {
      defaultBranchRef: { target: { oid: string } } | null;
      object: { text?: string; isBinary?: boolean; isTruncated?: boolean } | null;
    };
  }>(
    env,
    `query($owner:String!, $name:String!, $expr:String!) {
       repository(owner:$owner, name:$name) {
         defaultBranchRef { target { oid } }
         object(expression:$expr) { ... on Blob { text isBinary isTruncated } }
       }
     }`,
    { owner: REPO_OWNER, name: REPO_NAME, expr: `${BRANCH}:${path}` },
    transport,
  );

  const oid = data.repository?.defaultBranchRef?.target?.oid;
  if (!oid) throw new Error(`cannot read ${BRANCH} head`);

  const obj = data.repository.object;
  // isBinary means GitHub refused to give us text, isTruncated that it gave us
  // only the start of it. Rewriting a blob we cannot read whole would destroy
  // the rest of it.
  if (obj?.isBinary) throw new Error(`${path} is not text`);
  if (obj?.isTruncated) throw new Error(`${path} is too large to read through the API`);
  return { oid, text: obj?.text ?? "" };
}

export interface CommitResult {
  /** null when every link was already queued and no commit was made. */
  sha: string | null;
  appended: number;
  /** Already queued in the file, so not appended again. */
  skipped: string[];
  /** requireEmptyQueue was set and the file was not empty: nothing committed. */
  busy?: true;
}

export interface AppendRequest {
  /** Kept in the commit body. */
  reason?: string;
  /** An auto-approve batch (lib/auto-approve.ts): the commit says so, and names its daily limit. */
  auto?: { dailyLimit: number };
  /**
   * Commit only if the queue file is EMPTY at the very head the commit is made
   * on. Auto-approve uses it to stay out of the way of an ingest run that has
   * not finished with the previous batch - checked here, against the same
   * expectedHeadOid, so an extension push between its own check and this
   * commit cannot slip past.
   */
  requireEmptyQueue?: boolean;
}

/**
 * Append one `{"link": ...}` line per appid to the queue file.
 *
 * APPEND, never replace. This file has two producers — the browser extension
 * (poli0981/steam-f2p-extension pushes to it directly) and this Worker — and
 * overwriting it silently discards whatever the other queued. That exact bug
 * was found and fixed once already, in the since-removed issue-ingest
 * workflow; do not reintroduce it here.
 *
 * It takes no actor. The commit body says ADMIN_ATTRIBUTION, and the parameter
 * that used to carry the reviewer's Access address is gone rather than merely
 * unused at the one call site - a public commit body is not the place for it,
 * and a parameter no one can pass cannot be passed by mistake.
 */
export async function appendLinks(
  env: Env,
  links: string[],
  request: AppendRequest = {},
  transport: GitHubTransport = gh,
): Promise<CommitResult> {
  const reason = request.reason ?? "";
  let lastError = "";

  // One line per appid, which is what this function's contract promises.
  // Callers can legitimately pass the same link twice: admin.ts approves whole
  // ROWS, and two rows can share an appid because uq_queue_open_appid does not
  // cover 'failed'. Hoisted out of the retry loop -- `links` cannot change
  // between attempts. Set preserves insertion order, so line order is stable.
  const wanted = [...new Set(links)];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { oid, text } = await readHeadAndFile(env, TEMP_INFO_PATH, transport);
    if (request.requireEmptyQueue && text.trim()) return { sha: null, appended: 0, skipped: [], busy: true };

    // Dedup against what is already queued. Without this, approving a game
    // twice before the pipeline runs queues it twice; ingest_new.py would
    // survive that, but the second entry is noise in a file a human reads.
    const existing = new Set<string>();
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as { link?: unknown };
        const link = typeof obj === "string" ? obj : obj?.link;
        if (typeof link === "string") existing.add(link);
      } catch {
        // A malformed line is not ours to fix, and must not stop an append:
        // treating it as fatal would let one bad line block every approval.
      }
    }

    const fresh = wanted.filter((l) => !existing.has(l));
    const skipped = wanted.filter((l) => existing.has(l));
    // sha: null, NOT the branch head. Returning oid here made the caller record
    // whatever commit happened to be on main as if this job had produced it --
    // an audit trail pointing at an unrelated `chore(data)` commit. Since
    // readHeadAndFile() throws when the head is unreadable, null here can only
    // mean "no commit was made".
    if (!fresh.length) return { sha: null, appended: 0, skipped };

    const sep = text && !text.endsWith("\n") ? "\n" : "";
    const next =
      text + sep + fresh.map((l) => JSON.stringify({ link: l })).join("\n") + "\n";

    const kind = request.auto ? "auto-approved" : "approved";
    const headline =
      fresh.length === 1
        ? `queue: 1 ${kind} game`
        : `queue: ${fresh.length} ${kind} games`;
    // Who approved it stays in D1; an automatic batch says WHAT approved it.
    const by = request.auto
      ? `Approved automatically by the /admin schedule (at most ${request.auto.dailyLimit} a day), enabled by ${ADMIN_ATTRIBUTION}.`
      : `Approved in /admin by ${ADMIN_ATTRIBUTION}.`;

    try {
      const data = await graphql<{
        createCommitOnBranch: { commit: { oid: string } };
      }>(
        env,
        `mutation($input: CreateCommitOnBranchInput!) {
           createCommitOnBranch(input: $input) { commit { oid } }
         }`,
        {
          input: {
            branch: {
              repositoryNameWithOwner: `${REPO_OWNER}/${REPO_NAME}`,
              branchName: BRANCH,
            },
            message: {
              headline,
              // That the approval came from /admin belongs in the commit, not
              // only in the audit table: the audit table is not part of the
              // backup that matters, and Git is. WHO approved it stays in D1 -
              // this body is public forever.
              body:
                by +
                (reason ? `\n\nReason: ${reason}` : "") +
                `\n\nQueued for scripts/ingest_new.py, which decides whether each game is actually free, reachable and not already present. This commit is a request, not a publication.`,
            },
            expectedHeadOid: oid,
            fileChanges: {
              additions: [{ path: TEMP_INFO_PATH, contents: b64encode(next) }],
            },
          },
        },
        transport,
      );
      return {
        sha: data.createCommitOnBranch.commit.oid,
        appended: fresh.length,
        skipped,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) throw err;

      // Classify by FACT, not by prose.
      //
      // This used to match GitHub's error message against a regex, which meant
      // guessing at undocumented wording. GitHub answers a stale
      // expectedHeadOid with "Expected branch to point to ..." -- no substring
      // the old pattern required -- so the retry never fired and MAX_ATTEMPTS
      // was dead code: every lost race surfaced to the reviewer as a failed
      // approval they had to repeat by hand.
      //
      // Re-reading the head settles it without depending on any string. If the
      // branch moved under us we lost a race and retrying is exactly right. If
      // it did not move, the failure is something else -- bad permissions, a
      // protected branch, a malformed payload -- and will repeat identically,
      // so it belongs in front of the operator now rather than four attempts
      // later. Costs one extra read, and only on the failure path.
      // Fast path: GitHub labels this case "STALE_DATA". Trusting the type
      // costs nothing and avoids a round trip.
      let moved = ((err as GraphQlError).types ?? []).includes("STALE_DATA");
      if (!moved) {
        try {
          moved = (await readHeadAndFile(env, TEMP_INFO_PATH, transport)).oid !== oid;
        } catch {
          // Cannot establish it either way; do not paper over the original error.
        }
      }
      if (!moved) throw err;
    }
  }

  throw new Error(`branch moved under ${MAX_ATTEMPTS} attempts: ${lastError}`);
}


/**
 * Branch head plus the current text of SEVERAL files, in one query.
 *
 * Aliased fields rather than N round trips, and — more importantly — one oid
 * covering every file read, so expectedHeadOid still means what it says when a
 * commit changes ten files at once.
 */
async function readHeadAndFiles(
  env: Env,
  paths: string[],
  transport: GitHubTransport,
): Promise<{ oid: string; files: { text: string; exists: boolean }[] }> {
  const aliases = paths
    .map((_, i) => `f${i}: object(expression: $e${i}) { ... on Blob { text isBinary isTruncated } }`)
    .join("\n         ");
  const params = paths.map((_, i) => `$e${i}:String!`).join(", ");

  const vars: Record<string, string> = { owner: REPO_OWNER, name: REPO_NAME };
  paths.forEach((path, i) => {
    vars[`e${i}`] = `${BRANCH}:${path}`;
  });

  const data = await graphql<Record<string, any>>(
    env,
    `query($owner:String!, $name:String!, ${params}) {
       repository(owner:$owner, name:$name) {
         defaultBranchRef { target { oid } }
         ${aliases}
       }
     }`,
    vars,
    transport,
  );

  const repo = data.repository;
  const oid = repo?.defaultBranchRef?.target?.oid;
  if (!oid) throw new Error(`cannot read ${BRANCH} head`);

  const files = paths.map((path, i) => {
    const obj = repo[`f${i}`];
    if (obj?.isBinary) throw new Error(`${path} is not text`);
    if (obj?.isTruncated) throw new Error(`${path} is too large to read through the API`);
    // A null object is a file that does not exist on the branch - which a
    // deletion must know, because deleting a missing path fails the commit.
    return { text: (obj?.text ?? "") as string, exists: obj !== null && obj !== undefined };
  });
  return { oid, files };
}

/**
 * The current text of repository files on `main`, read through GraphQL in one
 * query - null for a file that does not exist. Fresh, unlike fetchRaw(): a
 * raw.githubusercontent.com copy can trail a commit by minutes, and the
 * callers (the blocklist screens, auto-approve's queue check) act on what the
 * branch says NOW.
 */
export async function readRepoFiles(
  env: Env,
  paths: string[],
  transport: GitHubTransport = gh,
): Promise<{ head: string; files: (string | null)[] }> {
  for (const p of paths) {
    if (p.includes("..") || p.startsWith("/")) throw new Error(`refusing to read ${p}`);
  }
  const { oid, files } = await readHeadAndFiles(env, paths, transport);
  return { head: oid, files: files.map((f) => (f.exists ? f.text : null)) };
}

/** Returned by FileEdit.build() to delete the file in the same commit. */
export const DELETE_FILE = Symbol("delete-file");

export interface FileEdit {
  path: string;
  /**
   * Receives the file's CURRENT text (empty when it does not exist) and
   * whether it exists, and returns the new text, null to leave the file alone,
   * or DELETE_FILE to remove it. Called again on every retry, so it must derive
   * its result from what it is given rather than from anything captured
   * earlier — that is what makes a retry merge with newer content instead of
   * clobbering it.
   */
  build: (current: string, exists: boolean) => string | null | typeof DELETE_FILE;
}

/**
 * Replace one or more allowlisted files in a SINGLE commit, retrying if the
 * branch moves under us.
 *
 * One commit rather than one per file: editing ten games is one decision, and
 * ten commits would be ten pushes, ten workflow triggers, and ten chances to
 * land half a change.
 */
export async function commitFiles(
  env: Env,
  edits: FileEdit[],
  headline: string,
  body: string,
  transport: GitHubTransport = gh,
): Promise<string | null> {
  if (!edits.length) return null;
  // Deletions pass the same allowlist as writes: the App can delete anything.
  for (const e of edits) assertWritable(e.path);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const paths = edits.map((e) => e.path);
    const { oid, files } = await readHeadAndFiles(env, paths, transport);

    const additions: { path: string; contents: string }[] = [];
    const deletions: { path: string }[] = [];
    edits.forEach((e, i) => {
      const next = e.build(files[i].text, files[i].exists);
      if (next === DELETE_FILE) {
        if (files[i].exists) deletions.push({ path: e.path });
      } else if (next !== null && next !== files[i].text) {
        additions.push({ path: e.path, contents: b64encode(next) });
      }
    });
    // Every file already said what it needed to; an empty commit is noise.
    if (!additions.length && !deletions.length) return null;

    try {
      const data = await graphql<{ createCommitOnBranch: { commit: { oid: string } } }>(
        env,
        `mutation($input: CreateCommitOnBranchInput!) {
           createCommitOnBranch(input: $input) { commit { oid } }
         }`,
        {
          input: {
            branch: {
              repositoryNameWithOwner: `${REPO_OWNER}/${REPO_NAME}`,
              branchName: BRANCH,
            },
            message: { headline, body },
            expectedHeadOid: oid,
            fileChanges: deletions.length ? { additions, deletions } : { additions },
          },
        },
        transport,
      );
      return data.createCommitOnBranch.commit.oid;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_ATTEMPTS) throw err;
      // Same fact-based classification as appendLinks: STALE_DATA if GitHub
      // says so, otherwise re-read the head and see whether it actually moved.
      let moved = ((err as GraphQlError).types ?? []).includes("STALE_DATA");
      if (!moved) {
        try {
          moved = (await readHeadAndFile(env, paths[0], transport)).oid !== oid;
        } catch {
          /* cannot tell; surface the original error */
        }
      }
      if (!moved) throw err;
    }
  }

  throw new Error(`branch moved under ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
