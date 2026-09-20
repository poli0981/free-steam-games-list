import { describe, expect, it } from "vitest";
import { appendLinks, commitFiles, DELETE_FILE, type GitHubTransport } from "./git-commit";
import { ADMIN_ATTRIBUTION } from "../../shared/admin-api";

/**
 * The createCommitOnBranch payload, as GitHub would receive it. The mutation
 * shape is the contract - a deletion that went into `additions`, or a path
 * outside the allowlist, would be a repository write nobody reviewed.
 */

interface Call {
  query: string;
  variables: Record<string, any>;
}

function transport(files: Record<string, string | null>) {
  const calls: Call[] = [];
  const fn: GitHubTransport = async (_env, _path, init) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    if (body.query.includes("createCommitOnBranch")) {
      return new Response(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "newsha" } } } }));
    }
    const repository: Record<string, unknown> = { defaultBranchRef: { target: { oid: "head" } } };
    Object.entries(body.variables).forEach(([k, v]) => {
      if (!/^e\d+$/.test(k)) return;
      const path = String(v).replace(/^main:/, "");
      const text = files[path];
      repository[`f${k.slice(1)}`] = text === null || text === undefined ? null : { text, isBinary: false };
    });
    return new Response(JSON.stringify({ data: { repository } }));
  };
  return { fn, calls };
}

/** The head + queue-file read that appendLinks issues, then the commit. */
function queueTransport(queueFile: string) {
  const calls: Call[] = [];
  const fn: GitHubTransport = async (_env, _path, init) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    if (body.query.includes("createCommitOnBranch")) {
      return new Response(JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: "newsha" } } } }));
    }
    return new Response(
      JSON.stringify({
        data: {
          repository: {
            defaultBranchRef: { target: { oid: "head" } },
            object: { text: queueFile, isBinary: false },
          },
        },
      }),
    );
  };
  return { fn, calls };
}

const env = {} as Env;

describe("commitFiles", () => {
  it("sends additions and deletions in one commit, against the head it read", async () => {
    const { fn, calls } = transport({ "data/overrides/1.json": "{}", "data/overrides/2.json": "old" });
    const sha = await commitFiles(
      env,
      [
        { path: "data/overrides/1.json", build: () => DELETE_FILE },
        { path: "data/overrides/2.json", build: (current) => current + "new" },
      ],
      "headline",
      "body",
      fn,
    );
    expect(sha).toBe("newsha");
    const input = calls.at(-1)!.variables.input;
    expect(input.expectedHeadOid).toBe("head");
    expect(input.fileChanges.deletions).toEqual([{ path: "data/overrides/1.json" }]);
    expect(input.fileChanges.additions.map((a: any) => a.path)).toEqual(["data/overrides/2.json"]);
    expect(atob(input.fileChanges.additions[0].contents)).toBe("oldnew");
  });

  it("skips deleting a file that does not exist, and makes no empty commit", async () => {
    const { fn, calls } = transport({ "data/overrides/1.json": null });
    const sha = await commitFiles(env, [{ path: "data/overrides/1.json", build: () => DELETE_FILE }], "h", "b", fn);
    expect(sha).toBeNull();
    expect(calls.some((c) => c.query.includes("createCommitOnBranch"))).toBe(false);
  });

  it("tells build() whether the file exists", async () => {
    const { fn } = transport({ "data/overrides/1.json": null, "data/overrides/2.json": "" });
    const seen: boolean[] = [];
    await commitFiles(
      env,
      [
        { path: "data/overrides/1.json", build: (_c, exists) => (seen.push(exists), null) },
        { path: "data/overrides/2.json", build: (_c, exists) => (seen.push(exists), null) },
      ],
      "h",
      "b",
      fn,
    );
    expect(seen).toEqual([false, true]);
  });

  it("refuses a path outside the allowlist, before any request", async () => {
    const { fn, calls } = transport({});
    await expect(
      commitFiles(env, [{ path: "data/data_001.jsonl", build: () => DELETE_FILE }], "h", "b", fn),
    ).rejects.toThrow(/not an allowed path/);
    expect(calls).toEqual([]);
  });
});

describe("commit bodies", () => {
  /**
   * These bodies are published forever in a public repository. The reviewer's
   * Cloudflare Access address used to be interpolated into every one of them
   * ("Approved in /admin by someone@example.com"), while the Git AUTHOR was
   * already the app's bot identity. Who approved what stays in D1.
   */
  it("names /admin, never a person", async () => {
    const { fn, calls } = queueTransport("");
    await appendLinks(env, ["https://store.steampowered.com/app/730/"], "looks free", fn);

    const body = String(calls.at(-1)!.variables.input.message.body);
    expect(body).toContain(`Approved in /admin by ${ADMIN_ATTRIBUTION}.`);
    expect(body).toContain("Reason: looks free");
    expect(body).not.toContain("@");
  });
});
