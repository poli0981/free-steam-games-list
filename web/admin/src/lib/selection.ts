/**
 * Which rows a reviewer may select, and what "select all" means.
 *
 * Pure functions over plain data, kept out of the components so the rule that
 * matters most on the queue screen - a locked row can never be selected, even
 * by "select all" - has a test of its own (selection.test.ts).
 */
import { isSelectable } from "../../../shared/queue-rules";

interface Row {
  id: string;
  status: string;
  published?: boolean | number | null;
}

/** Ids on this page that may be selected. */
export function selectableIds(rows: Row[]): string[] {
  return rows.filter((r) => isSelectable(r)).map((r) => r.id);
}

export type PageSelection = "none" | "some" | "all";

/** The select-all checkbox's state for this page. Locked rows do not count. */
export function pageSelection(rows: Row[], selected: ReadonlySet<string>): PageSelection {
  const ids = selectableIds(rows);
  if (!ids.length) return "none";
  const chosen = ids.filter((id) => selected.has(id)).length;
  return chosen === 0 ? "none" : chosen === ids.length ? "all" : "some";
}

/**
 * The selection after toggling select-all: every selectable row on the page,
 * or none of them. Ids from other pages are kept; locked ids are never added.
 */
export function toggleAll(rows: Row[], selected: ReadonlySet<string>): Set<string> {
  const ids = selectableIds(rows);
  const next = new Set(selected);
  if (pageSelection(rows, selected) === "all") ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}
