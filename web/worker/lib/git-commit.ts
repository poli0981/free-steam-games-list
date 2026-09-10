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

/** The only path this module is permitted to write. */
export const TEMP_INFO_PATH = "scripts/temp_info.jsonl";

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
 * Branch head and the current contents of the queue file, read TOGETHER.
 *
 * Reading them in one query is what makes `expectedHeadOid` meaningful: the
 * text and the oid describe the same commit, so if anything lands between this
 * read and the mutation, the mutation is rejected rather than silently
 * overwriting the newer content.
 */
async function readHeadAndFile(env: Env): Promise<HeadAndFile> {
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
    { owner: REPO_OWNER, name: REPO_NAME, expr: `${BRANCH}:${TEMP_INFO_PATH}` },
  );

  const oid = data.repository?.defaultBranchRef?.target?.oid;
  if (!oid) throw new Error(`cannot read ${BRANCH} head`);

  const obj = data.repository.object;
  // isBinary means GitHub refused to give us text. Appending to a blob we
  // cannot read would destroy it.
  if (obj?.isBinary) throw new Error(`${TEMP_INFO_PATH} is not text`);
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
 * APPEND, never replace. This file has several producers — the issue workflow,
 * the Telegram bot, and now this — and overwriting it silently discards
 * whatever the others queued. That exact bug has already been fixed once in
 * .github/workflows/ingest-from-issue.yml; do not reintroduce it here.
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
    const { oid, text } = await readHeadAndFile(env);

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
          moved = (await readHeadAndFile(env)).oid !== oid;
        } catch {
          // Cannot establish it either way; do not paper over the original error.
        }
      }
      if (!moved) throw err;
    }
  }

  throw new Error(`branch moved under ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
