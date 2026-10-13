import { describe, expect, it } from "vitest";
import { ADMIN_ROUTES, isAdminRoute, legacyQueuePath } from "./admin-routes";

describe("legacyQueuePath", () => {
  it("sends an old queue link to /admin/queue, with its parameters", () => {
    expect(legacyQueuePath("/admin", "?status=failed")).toBe("/admin/queue?status=failed");
    expect(legacyQueuePath("/admin", "?q=730&sort=players&page=2")).toBe("/admin/queue?q=730&sort=players&page=2");
  });

  it("leaves the overview and every other page alone", () => {
    expect(legacyQueuePath("/admin", "")).toBeNull();
    expect(legacyQueuePath("/admin", "?tab=removed")).toBeNull();
    expect(legacyQueuePath("/admin/jobs", "?status=failed")).toBeNull();
  });
});

describe("ADMIN_ROUTES", () => {
  it("starts with the overview and keeps the queue routable", () => {
    expect(ADMIN_ROUTES[0]).toBe("/admin");
    expect(isAdminRoute("/admin/queue")).toBe(true);
    expect(new Set(ADMIN_ROUTES).size).toBe(ADMIN_ROUTES.length);
  });
});
