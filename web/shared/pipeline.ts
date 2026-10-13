/**
 * The workflows /admin/pipeline shows, keyed by their FILE (a run's `path` in
 * the GitHub API), so renaming a workflow does not break the page.
 *
 * `dataWrite` marks the workflows in `concurrency: {group: data-write}`.
 * Auto-approve commits only while none of them is running or waiting: the
 * group keeps ONE pending run, and the ingest an approval starts would evict a
 * job already waiting (pipeline.test.ts holds this list to the YAML).
 *
 * Pure: no DOM, no Env, no I/O.
 */

export interface DataWorkflow {
  file: string;
  label: string;
  dataWrite: boolean;
}

export const DATA_WORKFLOWS: DataWorkflow[] = [
  { file: ".github/workflows/ingest-new.yml", label: "Ingest new games / apply removals", dataWrite: true },
  { file: ".github/workflows/update-json.yml", label: "Auto update JSON", dataWrite: true },
  { file: ".github/workflows/refresh-store-data.yml", label: "Refresh store data", dataWrite: true },
  { file: ".github/workflows/refresh-peaks.yml", label: "Refresh all-time peaks", dataWrite: true },
  { file: ".github/workflows/update-reviews.yml", label: "Update reviews", dataWrite: true },
  { file: ".github/workflows/top-online.yml", label: "Top online", dataWrite: true },
  { file: ".github/workflows/top-offline.yml", label: "Top offline", dataWrite: true },
  { file: ".github/workflows/check-dead-links.yml", label: "Check dead links", dataWrite: true },
  { file: ".github/workflows/mark-dead-games.yml", label: "Mark dead games", dataWrite: true },
  { file: ".github/workflows/purge-unhealthy.yml", label: "Purge unhealthy games", dataWrite: true },
  { file: ".github/workflows/snapshot-daily.yml", label: "Daily snapshot", dataWrite: true },
  { file: ".github/workflows/refetch-all.yml", label: "Force re-fetch all", dataWrite: true },
  { file: ".github/workflows/discover-new.yml", label: "Discover new games", dataWrite: false },
  { file: ".github/workflows/backfill-discover.yml", label: "Backfill discovery", dataWrite: false },
  { file: ".github/workflows/check-overrides.yml", label: "Check overrides", dataWrite: false },
];

/** A run in any of these is running or waiting for its turn. */
export function isActiveRun(status: string): boolean {
  return status !== "completed";
}
