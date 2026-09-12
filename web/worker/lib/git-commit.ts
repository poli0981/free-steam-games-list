/**
 * Worker → Git commits, via the GraphQL `createCommitOnBranch` mutation.
 *
 * Why GraphQL rather than the REST contents API: commits made through
 * createCommitOnBranch are signed by GitHub itself, so an approval that lands
 * in the repository shows as Verified. The REST path would require carrying a
 * signing key in the Worker, next to a credential that can already write.
 *
 * Scope: this module may append to ONE file, `scripts/temp_info.jsonl`. It
 * cannot touch `data/`. Publication stays the pipeline's job — the Worker only
 * enqueues a request, `ingest_new.py` decides whether the game is real, free
 * and reachable, and Git remains the source of truth either way.
 */
import { gh } from "./github-app";

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

async function graphql<T>(env: Env, query: string, variables: unknown): Promise<T> {
  const res = await gh(env, "/graphql", {
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
async function readHeadAndFile(env: Env, path: string): Promise<HeadAndFile> {
  const data = await graphql<{
    repository: {
      defaultBranchRef: { target: { oid: string } } | null;
      object: { text?: string; isBinary?: boolean } | null;
    };
  }>(
    env,
    `query($owner:String!, $name:String!, $expr:String!) {
       repository(owner:$owner, name:$name) {
         defaultBranchRef { target { oid } }
         object(expression:$expr) { ... on Blob { text isBinary } }
       }
     }`,
    { owner: REPO_OWNER, name: REPO_NAME, expr: `${BRANCH}:${path}` },
  );

  const oid = data.repository?.defaultBranchRef?.target?.oid;
  if (!oid) throw new Error(`cannot read ${BRANCH} head`);

  const obj = data.repository.object;
  // isBinary means GitHub refused to give us text. Rewriting a blob we cannot
  // read would destroy it.
  if (obj?.isBinary) throw new Error(`${path} is not text`);
  return { oid, text: obj?.text ?? "" };
}

export interface CommitResult {
  /** null when every link was already queued and no commit was made. */
  sha: string | null;
  appended: number;
  /** Already queued in the file, so not appended again. */
  skipped: string[];
}

/**
 * Append one `{"link": ...}` line per appid to the queue file.
 *
 * APPEND, never replace. This file has two producers — the browser extension
 * (poli0981/steam-f2p-extension pushes to it directly) and this Worker — and
 * overwriting it silently discards whatever the other queued. That exact bug
 * was found and fixed once already, in the since-removed issue-ingest
 * workflow; do not reintroduce it here.
 */
export async function appendLinks(
  env: Env,
  links: string[],
  actor: string,
): Promise<CommitResult> {
  let lastError = "";

  // One line per appid, which is what this function's contract promises.
  // Callers can legitimately pass the same link twice: admin.ts approves whole
  // ROWS, and two rows can share an appid because uq_queue_open_appid does not
  // cover 'failed'. Hoisted out of the retry loop -- `links` cannot change
  // between attempts. Set preserves insertion order, so line order is stable.
  const wanted = [...new Set(links)];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { oid, text } = await readHeadAndFile(env, TEMP_INFO_PATH);

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

    const headline =
      fresh.length === 1
        ? `queue: 1 approved game`
        : `queue: ${fresh.length} approved games`;

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
              // The reviewer's identity belongs in the commit, not only in the
              // audit table: the audit table is not part of the backup that
              // matters, and Git is.
              body: `Approved in /admin by ${actor}.\n\nQueued for scripts/ingest_new.py, which decides whether each game is actually free, reachable and not already present. This commit is a request, not a publication.`,
            },
            expectedHeadOid: oid,
            fileChanges: {
              additions: [{ path: TEMP_INFO_PATH, contents: b64encode(next) }],
            },
          },
        },
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
          moved = (await readHeadAndFile(env, TEMP_INFO_PATH)).oid !== oid;
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
): Promise<{ oid: string; texts: string[] }> {
  const aliases = paths
    .map((_, i) => `f${i}: object(expression: $e${i}) { ... on Blob { text isBinary } }`)
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
  );

  const repo = data.repository;
  const oid = repo?.defaultBranchRef?.target?.oid;
  if (!oid) throw new Error(`cannot read ${BRANCH} head`);

  const texts = paths.map((path, i) => {
    const obj = repo[`f${i}`];
    if (obj?.isBinary) throw new Error(`${path} is not text`);
    return (obj?.text ?? "") as string;
  });
  return { oid, texts };
}

export interface FileEdit {
  path: string;
  /**
   * Receives the file's CURRENT text (empty when it does not exist) and returns
   * the new text, or null to leave the file alone. Called again on every retry,
   * so it must derive its result from the text it is given rather than from
   * anything captured earlier — that is what makes a retry merge with newer
   * content instead of clobbering it.
   */
  build: (current: string) => string | null;
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
): Promise<string | null> {
  if (!edits.length) return null;
  for (const e of edits) assertWritable(e.path);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const paths = edits.map((e) => e.path);
    const { oid, texts } = await readHeadAndFiles(env, paths);

    const additions: { path: string; contents: string }[] = [];
    edits.forEach((e, i) => {
      const next = e.build(texts[i]);
      if (next !== null && next !== texts[i]) {
        additions.push({ path: e.path, contents: b64encode(next) });
      }
    });
    // Every file already said what it needed to; an empty commit is noise.
    if (!additions.length) return null;

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
            fileChanges: { additions },
          },
        },
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
          moved = (await readHeadAndFile(env, paths[0])).oid !== oid;
        } catch {
          /* cannot tell; surface the original error */
        }
      }
      if (!moved) throw err;
    }
  }

  throw new Error(`branch moved under ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
