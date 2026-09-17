/**
 * Everything the admin handlers reach outside D1, as one injectable object.
 *
 * Production passes defaultAdminDeps. Tests and the local admin dev server
 * (admin/mock) pass fakes, so the REAL handlers - with their SQL, guards and
 * error mapping - run against an in-memory D1 without a GitHub App or the live
 * dataset. There is deliberately no flag in the Worker that swaps these.
 */
import { appendLinks, commitFiles } from "./git-commit";
import { gh } from "./github-app";
import { fetchRaw, findOverride, findRecord, genreCounts, listByGenre } from "./records";

export interface AdminDeps {
  appendLinks: typeof appendLinks;
  commitFiles: typeof commitFiles;
  gh: typeof gh;
  findRecord: typeof findRecord;
  findOverride: typeof findOverride;
  genreCounts: typeof genreCounts;
  listByGenre: typeof listByGenre;
  fetchRaw: typeof fetchRaw;
  now: () => Date;
}

export const defaultAdminDeps: AdminDeps = {
  appendLinks,
  commitFiles,
  gh,
  findRecord,
  findOverride,
  genreCounts,
  listByGenre,
  fetchRaw,
  now: () => new Date(),
};
