import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Textarea } from "../../ui/textarea";
import type { GameRecord } from "../../../lib/schema";

export function EditJsonView({
  json,
  setJson,
  error,
}: {
  json: string;
  setJson: (s: string) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={20}
        spellCheck={false}
        className="font-mono text-[11px] leading-snug"
      />
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {t("edit.jsonPowerMode", { addedAt: "added_at" })}
        </div>
      )}
    </div>
  );
}

export function JsonDiff({
  before,
  after,
}: {
  before: GameRecord;
  after: GameRecord | null;
}) {
  const { t } = useTranslation();
  if (!after)
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        {t("edit.noValidJsonDiff")}
      </div>
    );
  const changed: { field: string; old: unknown; new: unknown }[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const a = (before as unknown as Record<string, unknown>)[k];
    const b = (after as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push({ field: k, old: a, new: b });
    }
  }
  if (changed.length === 0)
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        {t("diff.noChanges")}
      </div>
    );
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t("diff.field")}</th>
            <th className="px-3 py-2 text-left">{t("diff.before")}</th>
            <th className="px-3 py-2 text-left">{t("diff.after")}</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((c) => (
            <tr key={c.field} className="border-t align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {c.field}
              </td>
              <td className="bg-rose-500/10 px-3 py-2 text-rose-300 font-mono text-[11px] break-all">
                {JSON.stringify(c.old)}
              </td>
              <td className="bg-emerald-500/10 px-3 py-2 text-emerald-300 font-mono text-[11px] break-all">
                {JSON.stringify(c.new)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
