import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowedActions,
  DECIDABLE,
  isSelectable,
  lockReason,
  OPEN_STATUSES,
  QUEUE_STATUSES,
  sqlList,
} from "./queue-rules";

describe("lockReason", () => {
  it("locks every decided status, whatever else is true", () => {
    for (const status of ["approved", "committed", "rejected"]) {
      expect(lockReason({ status })).toBe("decided");
      expect(lockReason({ status, published: true })).toBe("decided");
      expect(isSelectable({ status })).toBe(false);
    }
  });

  it("locks an undecided row whose game is already published", () => {
    for (const status of DECIDABLE) {
      expect(lockReason({ status, published: true })).toBe("published");
      expect(lockReason({ status, published: 1 })).toBe("published");
      expect(isSelectable({ status, published: true })).toBe(false);
    }
  });

  it("leaves an undecided, unpublished row selectable", () => {
    for (const status of DECIDABLE) {
      expect(lockReason({ status, published: false })).toBeNull();
      expect(lockReason({ status, published: 0 })).toBeNull();
      expect(isSelectable({ status })).toBe(true);
    }
  });
});

describe("allowedActions", () => {
  it("offers no action on a locked row", () => {
    expect(allowedActions({ status: "committed" })).toEqual([]);
    expect(allowedActions({ status: "pending", published: true })).toEqual([]);
  });

  it("never offers a move to where the row already is", () => {
    expect(allowedActions({ status: "pending" })).toEqual(["approve", "reject", "defer"]);
    expect(allowedActions({ status: "deferred" })).toEqual(["approve", "reject", "requeue"]);
    expect(allowedActions({ status: "failed" })).toEqual(["approve", "reject", "defer", "requeue"]);
  });
});

describe("sqlList", () => {
  it("quotes closed word lists", () => {
    expect(sqlList(DECIDABLE)).toBe("'pending','deferred','failed'");
  });

  it("refuses anything that is not a lowercase word", () => {
    expect(() => sqlList(["pending'); DROP TABLE x; --"])).toThrow();
    expect(() => sqlList(["Pending"])).toThrow();
  });
});

describe("the constants match the schema", () => {
  const sql = readFileSync(join(process.cwd(), "worker", "migrations", "0001_init.sql"), "utf-8");
  const words = (list: string) => [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

  it("QUEUE_STATUSES is the status CHECK constraint", () => {
    const check = /status\s+TEXT[\s\S]*?CHECK \(status IN \(([^)]+)\)\)/.exec(sql);
    expect(check).not.toBeNull();
    expect(words(check![1])).toEqual([...QUEUE_STATUSES]);
  });

  it("OPEN_STATUSES is the uq_queue_open_appid predicate", () => {
    const index = /uq_queue_open_appid[\s\S]*?WHERE status IN \(([^)]+)\)/.exec(sql);
    expect(index).not.toBeNull();
    expect(words(index![1])).toEqual([...OPEN_STATUSES]);
  });
});
