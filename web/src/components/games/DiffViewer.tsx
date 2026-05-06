import type { EditPatch } from "../../lib/edits";
import type { GameRecord } from "../../lib/schema";
import { cn } from "../../lib/utils";

interface Props {
  before: GameRecord;
  patch: EditPatch;
}

function fmt(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function DiffViewer({ before, patch }: Props) {
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const oldVal = (before as unknown as Record<string, unknown>)[key];
    if (oldVal === value) continue;
    changes.push({ field: key, old: oldVal, new: value });
  }

  if (changes.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        No changes.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Field</th>
            <th className="px-3 py-2 text-left">Before</th>
            <th className="px-3 py-2 text-left">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field} className="border-t">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {c.field}
              </td>
              <td className={cn("px-3 py-2", "bg-rose-500/10 text-rose-300")}>
                {fmt(c.old)}
              </td>
              <td className={cn("px-3 py-2", "bg-emerald-500/10 text-emerald-300")}>
                {fmt(c.new)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
