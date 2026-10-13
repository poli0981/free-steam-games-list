import { describe, expect, it } from "vitest";
import { appendLinks, commitFiles, DELETE_FILE, readRepoFiles, type GitHubTransport } from "./git-commit";
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
    for (const path of ["data/data_001.jsonl", "data/index.json", "data/blocklist.jsonl.bak", "data/blocklist_jsonl"]) {
      await expect(commitFiles(env, [{ path, build: () => DELETE_FILE }], "h", "b", fn)).rejects.toThrow(
        /not an allowed path/,
      );
    }
    expect(calls).toEqual([]);
  });

  it("may edit the blocklist", async () => {
    const { fn, calls } = transport({ "data/blocklist.jsonl": "" });
    const sha = await commitFiles(env, [{ path: "data/blocklist.jsonl", build: (c) => c + "x\n" }], "h", "b", fn);
    expect(sha).toBe("newsha");
    expect(calls.at(-1)!.variables.input.fileChanges.additions[0].path).toBe("data/blocklist.jsonl");
  });

  it("refuses to rewrite a file GitHub only gave part of", async () => {
    const calls: Call[] = [];
    const fn: GitHubTransport = async (_env, _path, init) => {
      calls.push(JSON.parse(String(init?.body)) as Call);
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              defaultBranchRef: { target: { oid: "head" } },
              f0: { text: "the first megabyte", isBinary: false, isTruncated: true },
            },
          },
        }),
      );
    };
    await expect(
      commitFiles(env, [{ path: "data/blocklist.jsonl", build: (c) => c + "x" }], "h", "b", fn),
    ).rejects.toThrow(/too large/);
    expect(calls.some((c) => c.query.includes("createCommitOnBranch"))).toBe(false);
  });
});

describe("readRepoFiles", () => {
  it("reads several files at one head, null for a missing one", async () => {
    const { fn } = transport({ "scripts/temp_info.jsonl": "", "data/blocklist.jsonl": null });
    expect(await readRepoFiles(env, ["scripts/temp_info.jsonl", "data/blocklist.jsonl"], fn)).toEqual({
      head: "head",
      files: ["", null],
    });
    await expect(readRepoFiles(env, ["../secrets"], fn)).rejects.toThrow(/refusing/);
  });
});

describe("appendLinks requireEmptyQueue", () => {
  it("commits nothing while the queue file still holds a batch", async () => {
    const { fn, calls } = queueTransport('{"link":"https://store.steampowered.com/app/1/"}\n');
    const out = await appendLinks(env, ["https://store.steampowered.com/app/2/"], { requireEmptyQueue: true }, fn);
    expect(out).toEqual({ sha: null, appended: 0, skipped: [], busy: true });
    expect(calls.some((c) => c.query.includes("createCommitOnBranch"))).toBe(false);
  });

  it("commits when the file is empty", async () => {
    const { fn } = queueTransport("");
    const out = await appendLinks(env, ["https://store.steampowered.com/app/2/"], { requireEmptyQueue: true }, fn);
    expect(out.sha).toBe("newsha");
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
    await appendLinks(env, ["https://store.steampowered.com/app/730/"], { reason: "looks free" }, fn);

    const body = String(calls.at(-1)!.variables.input.message.body);
    expect(body).toContain(`Approved in /admin by ${ADMIN_ATTRIBUTION}.`);
    expect(body).toContain("Reason: looks free");
    expect(body).not.toContain("@");
  });

  it("says when the schedule approved, still naming no person", async () => {
    const { fn, calls } = queueTransport("");
    await appendLinks(
      env,
      ["https://store.steampowered.com/app/730/", "https://store.steampowered.com/app/440/"],
      { reason: "auto", auto: { dailyLimit: 300 } },
      fn,
    );
    const message = calls.at(-1)!.variables.input.message;
    expect(message.headline).toBe("queue: 2 auto-approved games");
    expect(String(message.body)).toContain("Approved automatically by the /admin schedule (at most 300 a day)");
    expect(String(message.body)).not.toContain("@");
  });
});
